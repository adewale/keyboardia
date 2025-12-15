import { useState, useCallback, useRef, useEffect } from 'react';
import { recorder } from '../audio/recorder';
import { requireAudioEngine, tryGetEngineForPreview } from '../audio/audioTriggers';
import { detectTransients } from '../audio/slicer';
import { Waveform } from './Waveform';
import './Recorder.css';

interface RecorderProps {
  onSampleRecorded: (sampleId: string, name: string) => void;
  disabled?: boolean;
  trackCount: number;
  maxTracks: number;
}

const MAX_RECORDING_TIME = 5000; // 5 seconds

export function Recorder({ onSampleRecorded, disabled, trackCount, maxTracks }: RecorderProps) {
  const [hasMicAccess, setHasMicAccess] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBuffer, setRecordedBuffer] = useState<AudioBuffer | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);

  // Auto-slice state
  const [slicePoints, setSlicePoints] = useState<number[]>([]);
  const [sensitivity, setSensitivity] = useState(50);
  const [autoSliceEnabled, setAutoSliceEnabled] = useState(false);

  const timerRef = useRef<number | null>(null);

  // NOTE: We do NOT auto-request mic access on mount.
  // This was removed because:
  // 1. It triggers a permission dialog immediately on page load (bad UX)
  // 2. Users who denied permission saw "Enable Microphone" which confused them
  // 3. Mic access is only needed when user wants to record
  // Mic access is now requested on first recording attempt (handleStartRecording)

  // Define handleStopRecording before the useEffect that uses it
  // Tier 1 - recording stop requires audio engine for decoding
  const handleStopRecording = useCallback(async () => {
    if (!recorder.isRecording()) return;

    const blob = await recorder.stopRecording();
    setIsRecording(false);

    // Decode to buffer (Tier 1 - requires audio engine)
    const audioEngine = await requireAudioEngine('record_stop');
    const arrayBuffer = await recorder.blobToArrayBuffer(blob);
    const buffer = await audioEngine.decodeAudio(arrayBuffer);
    setRecordedBuffer(buffer);
  }, []);

  // Handle recording timer
  useEffect(() => {
    if (isRecording) {
      const startTime = Date.now();
      timerRef.current = window.setInterval(() => {
        const elapsed = Date.now() - startTime;
        setRecordingTime(elapsed);

        if (elapsed >= MAX_RECORDING_TIME) {
          handleStopRecording();
        }
      }, 100);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setRecordingTime(0);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isRecording, handleStopRecording]);

  // Recalculate slice points when sensitivity changes
  // Only runs when audio is loaded (recordedBuffer exists means we already loaded)
  useEffect(() => {
    if (!recordedBuffer || !autoSliceEnabled) {
      setSlicePoints([]);
      return;
    }

    // Get audio context asynchronously if audio is loaded
    const calculateSlices = async () => {
      // Use preview trigger - don't block if not loaded
      const audioEngine = await tryGetEngineForPreview('preview_slice');
      if (!audioEngine) return;

      const audioContext = audioEngine.getAudioContext();
      if (!audioContext) return;

      // Sensitivity: 0 = few slices (high threshold), 100 = many slices (low threshold)
      const threshold = 1 - (sensitivity / 100) * 0.8; // Range: 0.2 to 1.0
      const transients = detectTransients(recordedBuffer, threshold, 0.05);

      // Convert to normalized positions
      const duration = recordedBuffer.duration;
      const points = transients
        .map(t => t / duration)
        .filter(p => p > 0.02 && p < 0.98); // Skip very start/end

      setSlicePoints(points);
    };

    calculateSlices();
  }, [recordedBuffer, sensitivity, autoSliceEnabled]);

  const handleStartRecording = useCallback(async () => {
    if (!hasMicAccess) {
      const granted = await recorder.requestMicAccess();
      if (!granted) return;
      setHasMicAccess(true);
    }

    setRecordedBuffer(null);
    setSlicePoints([]);
    setAutoSliceEnabled(false);
    recorder.startRecording();
    setIsRecording(true);
  }, [hasMicAccess]);

  // Play a slice of the recording (Preview - only if audio already loaded)
  const handlePlaySlice = useCallback(async (startPercent: number, endPercent: number) => {
    if (!recordedBuffer) return;

    // Use tryGetEngineForPreview - won't block if not ready
    const audioEngine = await tryGetEngineForPreview('preview_slice');
    if (!audioEngine) return;

    const audioContext = audioEngine.getAudioContext();
    if (!audioContext) return;

    // Ensure audio context is running (may be suspended on mobile)
    if (audioContext.state === 'suspended') {
      try {
        await audioContext.resume();
      } catch (e) {
        console.warn('Failed to resume audio context:', e);
        return;
      }
    }

    const startTime = startPercent * recordedBuffer.duration;
    const endTime = endPercent * recordedBuffer.duration;

    // Create a slice buffer
    const sampleRate = recordedBuffer.sampleRate;
    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.floor(endTime * sampleRate);
    const sliceBuffer = audioContext.createBuffer(1, endSample - startSample, sampleRate);
    sliceBuffer.copyToChannel(recordedBuffer.getChannelData(0).slice(startSample, endSample), 0);

    // Play it
    const source = audioContext.createBufferSource();
    source.buffer = sliceBuffer;
    source.connect(audioContext.destination);
    source.start();
  }, [recordedBuffer]);

  // Add recorded sample(s) to the grid (Tier 1 - requires audio engine)
  const handleAddToGrid = useCallback(async () => {
    if (!recordedBuffer) return;

    // Tier 1: Adding to grid requires audio immediately
    const audioEngine = await requireAudioEngine('add_to_grid');

    if (autoSliceEnabled && slicePoints.length > 0) {
      // Add each slice as a separate track
      const audioContext = audioEngine.getAudioContext();
      if (!audioContext) return;

      const allPoints = [0, ...slicePoints, 1].sort((a, b) => a - b);
      const tracksToAdd = Math.min(allPoints.length - 1, maxTracks - trackCount);

      for (let i = 0; i < tracksToAdd; i++) {
        const startTime = allPoints[i] * recordedBuffer.duration;
        const endTime = allPoints[i + 1] * recordedBuffer.duration;

        const sampleRate = recordedBuffer.sampleRate;
        const startSample = Math.floor(startTime * sampleRate);
        const endSample = Math.floor(endTime * sampleRate);
        const sliceBuffer = audioContext.createBuffer(1, endSample - startSample, sampleRate);
        sliceBuffer.copyToChannel(recordedBuffer.getChannelData(0).slice(startSample, endSample), 0);

        const sampleId = `slice-${Date.now()}-${i}`;
        const name = `Slice ${i + 1}`;

        audioEngine.addSample({ id: sampleId, name, buffer: sliceBuffer, url: '' });
        onSampleRecorded(sampleId, name);
      }
    } else {
      // Add whole recording as single track
      const sampleId = `recording-${Date.now()}`;
      const name = `Rec ${new Date().toLocaleTimeString()}`;

      audioEngine.addSample({ id: sampleId, name, buffer: recordedBuffer, url: '' });
      onSampleRecorded(sampleId, name);
    }

    // Clear
    setRecordedBuffer(null);
    setSlicePoints([]);
    setAutoSliceEnabled(false);
  }, [recordedBuffer, autoSliceEnabled, slicePoints, onSampleRecorded, trackCount, maxTracks]);

  const handleDiscard = useCallback(() => {
    setRecordedBuffer(null);
    setSlicePoints([]);
    setAutoSliceEnabled(false);
  }, []);

  // No longer show "Enable Microphone" gate - just show Hold to Record
  // Mic permission is requested on first recording attempt

  return (
    <div className="recorder">
      {/* Recording button */}
      {!recordedBuffer && (
        <div className="recorder-main">
          <button
            className={`mic-button ${isRecording ? 'recording' : ''} ${disabled ? 'disabled' : ''}`}
            onMouseDown={disabled ? undefined : handleStartRecording}
            onMouseUp={handleStopRecording}
            onMouseLeave={isRecording ? handleStopRecording : undefined}
            onTouchStart={disabled ? undefined : handleStartRecording}
            onTouchEnd={handleStopRecording}
            disabled={disabled}
          >
            {disabled ? 'Max tracks' : isRecording ? `${(recordingTime / 1000).toFixed(1)}s` : 'Hold to Record'}
          </button>
          {isRecording && (
            <div className="recording-bar">
              <div className="recording-progress" style={{ width: `${(recordingTime / MAX_RECORDING_TIME) * 100}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Waveform with slice UI */}
      {recordedBuffer && (
        <div className="recorder-edit">
          <div className="waveform-section">
            <Waveform
              buffer={recordedBuffer}
              slicePoints={slicePoints}
              onSlicePointsChange={setSlicePoints}
              onPlaySlice={handlePlaySlice}
              height={60}
            />
            <div className="waveform-hint">Click to preview • Drag markers to adjust</div>
          </div>

          {/* Auto-slice controls - always visible */}
          <div className="slice-controls">
            <button
              className={`slice-toggle ${autoSliceEnabled ? 'active' : ''}`}
              onClick={() => setAutoSliceEnabled(!autoSliceEnabled)}
            >
              ✂ Auto-Slice
            </button>

            {autoSliceEnabled && (
              <div className="sensitivity-control">
                <span className="sensitivity-label">Sensitivity</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={sensitivity}
                  onChange={(e) => setSensitivity(Number(e.target.value))}
                  className="sensitivity-slider"
                />
                <span className="sensitivity-value">{sensitivity}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="recorder-actions">
            <button className="action-button add" onClick={handleAddToGrid} disabled={disabled}>
              + Add {autoSliceEnabled && slicePoints.length > 0 ? `${slicePoints.length + 1} Tracks` : 'Track'}
            </button>
            <button className="action-button discard" onClick={handleDiscard}>
              ✕ Discard
            </button>
          </div>
        </div>
      )}

      <span className="track-count">{trackCount}/{maxTracks}</span>
    </div>
  );
}
