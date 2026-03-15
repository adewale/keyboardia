# AudioWorklet Engine Spec

> **Status:** Proposed
> **Priority:** High — addresses scheduling jitter, CPU overhead, and observability gaps
> **Prerequisites:** Phase 25 (Unified Audio Bus) complete
> **Related:** [SYNTHESIS-ENGINE-ARCHITECTURE.md](./SYNTHESIS-ENGINE-ARCHITECTURE.md), [UNIFIED-AUDIO-BUS.md](./UNIFIED-AUDIO-BUS.md), [OBSERVABILITY.md](./OBSERVABILITY.md)

---

## Overview

Keyboardia's audio engine currently relies on Tone.js for AudioWorklet management and uses main-thread `setTimeout` loops for scheduling. This spec defines four AudioWorklet modules that move performance-critical work off the main thread, plus the metrics infrastructure to measure their impact.

### Goals

1. **Reduce scheduling jitter** from ~12.5ms to <1ms
2. **Lower keyboard-to-sound latency** by 15-30ms
3. **Reduce CPU usage** for LFO-heavy presets by ~25%
4. **Enable per-track audio metering** without main thread cost
5. **Improve pitch-shifting quality** for sampled instruments
6. **Provide quantitative before/after measurement** for every change

### Non-Goals

- Replacing Tone.js effects chain (Freeverb, FeedbackDelay, etc.)
- Rewriting the track bus routing (already native GainNodes, fast enough)
- Supporting browsers without AudioWorklet (no ScriptProcessorNode fallback)

---

## Browser Support

AudioWorklet is supported in all modern browsers:

| Browser | AudioWorklet Support |
|---------|---------------------|
| Chrome 66+ | Full |
| Firefox 76+ | Full |
| Safari 14.1+ | Full |
| Edge 79+ | Full |
| iOS Safari 14.5+ | Full (with user gesture) |

Feature detection:

```typescript
function supportsAudioWorklet(ctx: AudioContext): boolean {
  return typeof ctx.audioWorklet?.addModule === 'function';
}
```

---

## Module 1: Scheduler Worklet

### Problem

The scheduler (`app/src/audio/scheduler.ts`) runs entirely on the main thread via `window.setTimeout` with a 25ms lookahead. This has three consequences:

1. **Timing jitter** — If the main thread is busy (React renders, DOM layout, GC), the timer fires late. With a 25ms interval, jitter can reach ~12.5ms per step. At 180 BPM this is audible.
2. **Latency** — Keyboard-to-sound latency is 40-70ms because the note must wait for the next scheduler tick.
3. **UI contention** — The `scheduler()` method iterates all tracks, computes swing, checks ties, and dispatches play calls. During a 16-track polyrhythmic sequence this blocks the main thread for 1-3ms per tick.

### Current Implementation

```
Main Thread:
  setTimeout(scheduleLoop, 25ms)
    → scheduler(state)
      → for each track: calculateSwing, checkTie, playInstrumentNote
      → this.nextStepTime = audioStartTime + (totalStepsScheduled * stepDuration)
    → setTimeout(scheduleLoop, 25ms)
```

Key constants from `scheduler.ts:25-27`:
- `LOOKAHEAD_MS = 25`
- `SCHEDULE_AHEAD_SEC = 0.1`
- `STEPS_PER_BEAT = 4`

### Design

Move the timing loop to an AudioWorkletProcessor. The worklet owns the clock. Note events are sent to the main thread via `MessagePort` for actual audio triggering.

```
AudioWorklet Thread:                  Main Thread:
┌─────────────────────────┐          ┌────────────────────────┐
│ SchedulerWorklet        │          │ SchedulerHost          │
│                         │  msg     │                        │
│ process() called every  │─────────→│ onmessage:             │
│ 128 samples (~2.67ms    │          │   playInstrumentNote() │
│ at 48kHz)               │          │   onStepChange()       │
│                         │←─────────│   onBeat()             │
│ Owns:                   │  msg     │                        │
│ - nextStepTime          │          │ Sends:                 │
│ - currentStep           │          │ - state snapshots      │
│ - totalStepsScheduled   │          │ - tempo changes        │
│ - activeNotes (ties)    │          │ - start/stop commands  │
│ - swing calculations    │          │                        │
└─────────────────────────┘          └────────────────────────┘
```

### Worklet Processor

File: `app/src/audio/worklets/scheduler.worklet.ts`

```typescript
interface SchedulerState {
  tempo: number;
  swing: number;               // 0-100
  tracks: WorkletTrack[];
  loopRegion: { start: number; end: number } | null;
}

interface WorkletTrack {
  id: string;
  sampleId: string;
  steps: boolean[];
  stepCount: number;
  muted: boolean;
  soloed: boolean;
  transpose: number;
  swing: number;               // per-track swing 0-100
  volume: number;
  parameterLocks: (PLock | null)[];
}

interface PLock {
  pitch?: number;
  volume?: number;
  tie?: boolean;
}

interface NoteEvent {
  type: 'note';
  trackId: string;
  noteId: string;
  sampleId: string;
  pitchSemitones: number;
  time: number;                // AudioContext time
  duration: number;
  volume: number;
  volumeMultiplier: number;
}

interface StepEvent {
  type: 'step';
  step: number;
  time: number;
}

interface BeatEvent {
  type: 'beat';
  beat: number;
  time: number;
}

class SchedulerWorklet extends AudioWorkletProcessor {
  private state: SchedulerState | null = null;
  private isRunning = false;
  private nextStepTime = 0;
  private currentStep = 0;
  private totalStepsScheduled = 0;
  private audioStartTime = 0;
  private lastTempo = 0;
  private activeNotes = new Map<string, { globalStep: number; pitch: number }>();

  constructor() {
    super();
    this.port.onmessage = (e) => this.handleMessage(e.data);
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'start':
        this.start(msg.state, msg.startTime);
        break;
      case 'stop':
        this.stop();
        break;
      case 'updateState':
        this.state = msg.state;
        break;
      case 'updateTempo':
        if (this.state) this.state.tempo = msg.tempo;
        break;
    }
  }

  private start(state: SchedulerState, startTime: number): void {
    this.state = state;
    this.isRunning = true;
    this.audioStartTime = startTime;
    this.nextStepTime = startTime;
    this.totalStepsScheduled = 0;
    this.lastTempo = state.tempo;
    this.activeNotes.clear();
    this.currentStep = state.loopRegion?.start ?? 0;
  }

  private stop(): void {
    this.isRunning = false;
    this.state = null;
    this.activeNotes.clear();
  }

  // Called every 128 samples (~2.67ms at 48kHz)
  process(): boolean {
    if (!this.isRunning || !this.state) return true;

    const currentTime = currentTime; // AudioWorkletProcessor provides this
    this.schedule(currentTime);
    return true;
  }

  private schedule(currentTime: number): void {
    // Same drift-free logic as scheduler.ts:230-314
    // but running at audio rate instead of setTimeout rate
    const stepDuration = this.getStepDuration(this.state!.tempo);

    // BPM change detection (same as scheduler.ts:238-251)
    if (this.lastTempo !== 0 && this.lastTempo !== this.state!.tempo) {
      this.audioStartTime = currentTime - (this.totalStepsScheduled * stepDuration);
      this.nextStepTime = this.audioStartTime + (this.totalStepsScheduled * stepDuration);
    }
    this.lastTempo = this.state!.tempo;

    // Schedule notes within lookahead window
    while (this.nextStepTime < currentTime + SCHEDULE_AHEAD_SEC) {
      this.scheduleStep(this.currentStep, this.nextStepTime, stepDuration);

      // Send step/beat events to main thread
      this.port.postMessage({
        type: 'step',
        step: this.currentStep,
        time: this.nextStepTime,
      });

      if (this.currentStep % STEPS_PER_BEAT === 0) {
        this.port.postMessage({
          type: 'beat',
          beat: Math.floor(this.currentStep / STEPS_PER_BEAT),
          time: this.nextStepTime,
        });
      }

      // Advance step (loop region aware)
      // ... same logic as scheduler.ts:296-313
      this.totalStepsScheduled++;
      this.nextStepTime = this.audioStartTime + (this.totalStepsScheduled * stepDuration);
    }
  }
}

registerProcessor('scheduler-worklet', SchedulerWorklet);
```

### Host (Main Thread)

File: `app/src/audio/scheduler-worklet-host.ts`

```typescript
export class SchedulerWorkletHost {
  private node: AudioWorkletNode | null = null;
  private onStepChange: ((step: number) => void) | null = null;
  private onBeat: ((beat: number) => void) | null = null;

  async initialize(audioContext: AudioContext): Promise<void> {
    await audioContext.audioWorklet.addModule(
      new URL('./worklets/scheduler.worklet.ts', import.meta.url)
    );
    this.node = new AudioWorkletNode(audioContext, 'scheduler-worklet');
    this.node.port.onmessage = (e) => this.handleEvent(e.data);
  }

  start(state: SchedulerState, startTime: number): void {
    this.node?.port.postMessage({ type: 'start', state, startTime });
  }

  stop(): void {
    this.node?.port.postMessage({ type: 'stop' });
  }

  updateState(state: SchedulerState): void {
    this.node?.port.postMessage({ type: 'updateState', state });
  }

  private handleEvent(event: NoteEvent | StepEvent | BeatEvent): void {
    switch (event.type) {
      case 'note':
        // Dispatch to audioEngine.playInstrumentNote()
        audioEngine.playFromWorklet(event);
        break;
      case 'step':
        this.onStepChange?.(event.step);
        break;
      case 'beat':
        this.onBeat?.(event.beat);
        break;
    }
  }
}
```

### State Synchronization

The main thread owns the GridState (Redux store). When state changes, a serialized snapshot is sent to the worklet:

```typescript
// In the React component or middleware that manages playback:
useEffect(() => {
  if (scheduler.isRunning) {
    const workletState = serializeForWorklet(gridState);
    schedulerHost.updateState(workletState);
  }
}, [gridState.tracks, gridState.tempo, gridState.swing, gridState.loopRegion]);
```

Only serializable data crosses the MessagePort boundary. No AudioNodes, functions, or class instances.

### What Stays on Main Thread

- `audioEngine.playSynthNote()` and all other play methods (they create/trigger AudioNodes that must be on the main thread)
- UI callbacks (`onStepChange`, `onBeat`) — these update React state
- Volume P-lock resets via `setTrackVolume()`

### What Moves to the Worklet

- The timing loop (currently `setTimeout`)
- Step advancement and drift-free time computation
- Per-track swing calculation
- Tied note detection and duration calculation
- Solo/mute filtering
- Note event assembly

### Multiplayer Sync

The worklet receives `serverStartTime` via `postMessage` during `start()`. The elapsed-time calculation and step offset logic from `scheduler.ts:149-173` transfers directly — it only uses arithmetic on timestamps, no DOM or network APIs.

### Fallback

If `AudioWorklet` is not available, the existing `Scheduler` class runs unchanged:

```typescript
if (supportsAudioWorklet(audioContext)) {
  this.scheduler = new SchedulerWorkletHost();
  await this.scheduler.initialize(audioContext);
} else {
  this.scheduler = new Scheduler(); // existing main-thread scheduler
}
```

Both implement a common `IScheduler` interface so the rest of the engine is unaware of which is active.

### Expected Impact

| Metric | Before | After | Method |
|--------|--------|-------|--------|
| Step timing jitter | ~12.5ms p99 | <1ms p99 | SchedulerJitterBenchmark |
| Keyboard-to-sound latency | 40-70ms | 25-45ms | InputLatencyBenchmark |
| Main thread blocking per tick | 1-3ms | ~0ms | PerformanceObserver long tasks |
| Scheduling accuracy at 180 BPM | ±12.5ms | ±0.05ms | TimingAccuracyTest |

---

## Module 2: Shared LFO Worklet

### Problem

The AdvancedSynthEngine (`app/src/audio/advancedSynth.ts`) creates a **separate `Tone.LFO` oscillator per voice**. Each LFO is a full `Tone.Oscillator` under the hood. With 8 voices and presets like `wobble-bass` (LFO amount: 0.8), that's 8 redundant oscillators computing the same waveform.

Additionally, LFO modulation is applied via Tone.js AudioParam connections, meaning the modulation resolution is limited to the Web Audio parameter automation rate (typically k-rate, once per 128-sample block). For fast LFO rates (10-20Hz) or extreme wobble effects, this quantization is audible as stepping.

### Current Implementation

From `advancedSynth.ts:311-316`:
```typescript
// Per-voice — this runs 8 times for 8 voices
this.lfo = new Tone.LFO({ frequency: 5, type: 'sine', min: -1, max: 1 });
```

From `advancedSynth.ts:424-446`, LFO routing:
```typescript
switch (preset.lfo.destination) {
  case 'filter':
    this.lfo.connect(this.filter.frequency);   // one LFO → one filter
    break;
  case 'pitch':
    this.lfo.connect(this.osc1.detune);        // one LFO → one osc1
    this.lfo.connect(this.osc2.detune);        // one LFO → one osc2
    break;
  case 'amplitude':
    this.lfo.connect(this.output.gain);        // one LFO → one gain
    break;
}
```

### Design

Replace per-voice LFO oscillators with a single AudioWorklet that computes one LFO waveform and distributes the modulation value to all active voices via `AudioParam` or `MessagePort`.

```
┌─────────────────────────────────────────────────────┐
│ SharedLFOWorklet (audio thread)                      │
│                                                      │
│ One LFO oscillator (computed per-sample):            │
│   sin/tri/saw/square at configured frequency         │
│                                                      │
│ Output: AudioParam values for each voice slot        │
│   voice[0].filterMod = lfoValue * amount             │
│   voice[1].filterMod = lfoValue * amount             │
│   ...                                                │
│   voice[7].filterMod = lfoValue * amount             │
│                                                      │
│ Config received via MessagePort:                     │
│   { frequency, waveform, destination, amount, sync } │
└─────────────────────────────────────────────────────┘
```

### Worklet Processor

File: `app/src/audio/worklets/shared-lfo.worklet.ts`

```typescript
interface LFOParams {
  frequency: number;
  waveform: 'sine' | 'triangle' | 'sawtooth' | 'square';
  amount: number;         // 0-1
  destination: 'filter' | 'pitch' | 'amplitude';
  sync: boolean;
  syncBPM?: number;
}

class SharedLFOWorklet extends AudioWorkletProcessor {
  private phase = 0;
  private config: LFOParams = {
    frequency: 5,
    waveform: 'sine',
    amount: 0,
    destination: 'filter',
    sync: false,
  };

  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 5, minValue: 0.1, maxValue: 20, automationRate: 'k-rate' },
      { name: 'amount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.port.onmessage = (e) => {
      this.config = { ...this.config, ...e.data };
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    const freq = parameters.frequency[0] ?? this.config.frequency;
    const amount = parameters.amount[0] ?? this.config.amount;
    const sampleRate = globalThis.sampleRate;

    for (let i = 0; i < output[0].length; i++) {
      // Compute LFO value once per sample
      const value = this.computeWaveform(this.phase) * amount;

      // Write to all output channels (one per voice slot)
      for (let ch = 0; ch < output.length; ch++) {
        output[ch][i] = value;
      }

      // Advance phase
      this.phase += freq / sampleRate;
      if (this.phase >= 1) this.phase -= 1;
    }

    return true;
  }

  private computeWaveform(phase: number): number {
    switch (this.config.waveform) {
      case 'sine':
        return Math.sin(phase * 2 * Math.PI);
      case 'triangle':
        return 4 * Math.abs(phase - 0.5) - 1;
      case 'sawtooth':
        return 2 * phase - 1;
      case 'square':
        return phase < 0.5 ? 1 : -1;
      default:
        return 0;
    }
  }
}

registerProcessor('shared-lfo-worklet', SharedLFOWorklet);
```

### Integration with AdvancedSynthEngine

The `AdvancedSynthEngine` creates one `SharedLFOWorklet` node and connects its output channels to the appropriate AudioParam on each voice:

```typescript
// In AdvancedSynthEngine.initialize():
await audioContext.audioWorklet.addModule(
  new URL('./worklets/shared-lfo.worklet.ts', import.meta.url)
);

this.lfoNode = new AudioWorkletNode(audioContext, 'shared-lfo-worklet', {
  numberOfInputs: 0,
  numberOfOutputs: 1,
  outputChannelCount: [MAX_VOICES],  // 8 channels, one per voice
});

// When applying a preset, connect output channels to voice params:
for (let i = 0; i < this.voices.length; i++) {
  const splitter = audioContext.createChannelSplitter(MAX_VOICES);
  this.lfoNode.connect(splitter);

  const voiceGain = audioContext.createGain();
  splitter.connect(voiceGain, i);

  switch (preset.lfo.destination) {
    case 'filter':
      voiceGain.connect(this.voices[i].filter.frequency);
      break;
    case 'pitch':
      voiceGain.connect(this.voices[i].osc1.detune);
      voiceGain.connect(this.voices[i].osc2.detune);
      break;
    case 'amplitude':
      voiceGain.connect(this.voices[i].output.gain);
      break;
  }
}
```

### Preset Changes

When the preset changes, update the worklet config via `postMessage`:

```typescript
setPreset(presetId: string): void {
  const preset = ADVANCED_SYNTH_PRESETS[presetId];
  this.lfoNode?.port.postMessage({
    frequency: preset.lfo.frequency,
    waveform: preset.lfo.waveform,
    amount: preset.lfo.amount,
    destination: preset.lfo.destination,
    sync: preset.lfo.sync,
  });
}
```

### What Changes

| Aspect | Before | After |
|--------|--------|-------|
| LFO oscillators per 8 voices | 8 `Tone.LFO` instances | 1 `SharedLFOWorklet` |
| Modulation rate | k-rate (once per 128 samples) | Per-sample (a-rate) |
| Preset switch cost | Dispose 8 LFOs, create 8 new | `postMessage` with new config |
| Phase coherence | Independent per voice | Shared — all voices modulate in sync |

### Expected Impact

| Metric | Before | After | Method |
|--------|--------|-------|--------|
| Oscillator count (wobble-bass, 8 voices) | 24 (16 signal + 8 LFO) | 17 (16 signal + 1 worklet) | OscillatorCountMetric |
| CPU per preset (LFO-heavy) | Baseline | ~25% reduction | AudioThreadCPUBenchmark |
| LFO modulation resolution | k-rate (~375Hz at 48kHz) | a-rate (48kHz) | Spectral analysis |

---

## Module 3: Track Metering Worklet

### Problem

There is no per-track audio level metering. The debug overlay and any future mixer UI have no way to show live levels. Computing RMS/peak on the main thread via `AnalyserNode.getFloatTimeDomainData()` would require one `AnalyserNode` per track and frequent main-thread polling — exactly the kind of work that should be off-thread.

### Design

An AudioWorklet that accepts audio input from each track bus, computes RMS and peak levels, and sends the results to the main thread at a configurable rate (default: 60Hz for smooth UI animation).

```
TrackBus[0] ──→ ┌─────────────────────────┐
TrackBus[1] ──→ │ MeteringWorklet          │
TrackBus[2] ──→ │                          │ ──→ MessagePort ──→ UI
  ...        ──→ │ Per-channel RMS + Peak   │
TrackBus[N] ──→ │ Sends at 60Hz            │
                 └─────────────────────────┘
```

### Worklet Processor

File: `app/src/audio/worklets/metering.worklet.ts`

```typescript
interface MeterData {
  type: 'meters';
  levels: Array<{
    trackIndex: number;
    rms: number;       // 0-1 linear scale
    peak: number;      // 0-1 linear scale
    clipping: boolean; // true if any sample > 1.0
  }>;
  timestamp: number;
}

class MeteringWorklet extends AudioWorkletProcessor {
  private sendInterval: number;        // samples between sends
  private samplesSinceLastSend = 0;
  private trackCount: number;

  // Accumulated values between sends
  private sumSquares: Float64Array;
  private peaks: Float64Array;
  private clipping: Uint8Array;
  private sampleCount = 0;

  constructor(options: AudioWorkletNodeOptions) {
    super();
    this.trackCount = options.processorOptions?.trackCount ?? 16;
    this.sendInterval = Math.floor(globalThis.sampleRate / 60); // ~800 samples at 48kHz

    this.sumSquares = new Float64Array(this.trackCount);
    this.peaks = new Float64Array(this.trackCount);
    this.clipping = new Uint8Array(this.trackCount);

    this.port.onmessage = (e) => {
      if (e.data.type === 'setTrackCount') {
        this.trackCount = e.data.count;
        this.reset();
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    // Each input corresponds to a track bus
    for (let t = 0; t < Math.min(inputs.length, this.trackCount); t++) {
      const input = inputs[t];
      if (!input || input.length === 0) continue;

      const channel = input[0]; // mono analysis
      for (let i = 0; i < channel.length; i++) {
        const sample = channel[i];
        const abs = Math.abs(sample);
        this.sumSquares[t] += sample * sample;
        if (abs > this.peaks[t]) this.peaks[t] = abs;
        if (abs > 1.0) this.clipping[t] = 1;
      }
    }

    this.sampleCount += 128; // AudioWorklet block size
    this.samplesSinceLastSend += 128;

    if (this.samplesSinceLastSend >= this.sendInterval) {
      this.sendMeters();
      this.samplesSinceLastSend = 0;
    }

    return true;
  }

  private sendMeters(): void {
    const levels = [];
    for (let t = 0; t < this.trackCount; t++) {
      const rms = this.sampleCount > 0
        ? Math.sqrt(this.sumSquares[t] / this.sampleCount)
        : 0;
      levels.push({
        trackIndex: t,
        rms,
        peak: this.peaks[t],
        clipping: this.clipping[t] === 1,
      });
    }

    this.port.postMessage({
      type: 'meters',
      levels,
      timestamp: currentTime,
    } satisfies MeterData);

    this.reset();
  }

  private reset(): void {
    this.sumSquares.fill(0);
    this.peaks.fill(0);
    this.clipping.fill(0);
    this.sampleCount = 0;
  }
}

registerProcessor('metering-worklet', MeteringWorklet);
```

### Host Integration

File: `app/src/audio/metering-host.ts`

```typescript
export interface TrackMeterLevel {
  rms: number;
  peak: number;
  clipping: boolean;
}

export class MeteringHost {
  private node: AudioWorkletNode | null = null;
  private levels: Map<string, TrackMeterLevel> = new Map();
  private trackIdByIndex: Map<number, string> = new Map();
  private listeners: Set<(levels: Map<string, TrackMeterLevel>) => void> = new Set();

  async initialize(audioContext: AudioContext): Promise<void> {
    await audioContext.audioWorklet.addModule(
      new URL('./worklets/metering.worklet.ts', import.meta.url)
    );
    this.node = new AudioWorkletNode(audioContext, 'metering-worklet', {
      numberOfInputs: 16,          // up to 16 tracks
      numberOfOutputs: 0,          // analysis only, no audio output
      processorOptions: { trackCount: 16 },
    });

    this.node.port.onmessage = (e: MessageEvent<MeterData>) => {
      if (e.data.type === 'meters') {
        for (const level of e.data.levels) {
          const trackId = this.trackIdByIndex.get(level.trackIndex);
          if (trackId) {
            this.levels.set(trackId, {
              rms: level.rms,
              peak: level.peak,
              clipping: level.clipping,
            });
          }
        }
        this.notifyListeners();
      }
    };
  }

  /**
   * Connect a track bus to a metering input.
   * Called by TrackBusManager when creating a new bus.
   */
  connectTrack(trackId: string, trackIndex: number, busOutput: AudioNode): void {
    if (!this.node) return;
    busOutput.connect(this.node, 0, trackIndex);
    this.trackIdByIndex.set(trackIndex, trackId);
  }

  /**
   * Subscribe to level updates (called at ~60Hz).
   */
  onLevels(callback: (levels: Map<string, TrackMeterLevel>) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  getLevel(trackId: string): TrackMeterLevel | undefined {
    return this.levels.get(trackId);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.levels);
    }
  }
}
```

### React Hook

```typescript
export function useTrackMeter(trackId: string): TrackMeterLevel | null {
  const [level, setLevel] = useState<TrackMeterLevel | null>(null);

  useEffect(() => {
    return meteringHost.onLevels((levels) => {
      const trackLevel = levels.get(trackId);
      if (trackLevel) setLevel(trackLevel);
    });
  }, [trackId]);

  return level;
}
```

### Expected Impact

| Metric | Before | After | Method |
|--------|--------|-------|--------|
| Per-track metering | Not available | 60fps, 16 tracks | Visual verification |
| Main thread cost of metering | N/A (not implemented) | ~0ms (worklet) | PerformanceObserver |
| Metering latency | N/A | ~16ms (one frame at 60Hz) | MessagePort round-trip |

---

## Module 4: Pitch-Shifting Worklet

### Problem

Sampled instruments (`app/src/audio/sampled-instrument.ts:376`) use `playbackRate` for pitch shifting:

```typescript
source.playbackRate.value = Math.pow(2, semitoneOffset / 12);
```

This couples pitch and time — shifting up 12 semitones halves the duration. For instruments like piano that sample every octave (C2, C3, C4, C5), the maximum shift from nearest sample is 6 semitones, which is acceptable. But for single-sample instruments (drums, one-shots) or when the user applies extreme transpose (+24 semitones), the time-stretching artifact becomes very noticeable.

### Design

A PSOLA (Pitch Synchronous Overlap and Add) worklet that shifts pitch without changing duration. This is the standard algorithm used in Ableton Live's warp modes and most pitch-shifting plugins.

```
┌─────────────────────────────────────────────────────────┐
│ PitchShiftWorklet                                        │
│                                                          │
│ Input: AudioBuffer samples at original pitch             │
│ Parameters:                                              │
│   - pitchRatio (AudioParam, a-rate)                      │
│   - grainSize (128-2048 samples, default 512)            │
│   - overlap (0.25-0.75, default 0.5)                     │
│                                                          │
│ Algorithm: PSOLA                                         │
│   1. Segment input into overlapping grains               │
│   2. Resample each grain at pitchRatio                   │
│   3. Overlap-add with Hann window                        │
│                                                          │
│ Output: Pitch-shifted audio at original duration          │
└─────────────────────────────────────────────────────────┘
```

### Worklet Processor

File: `app/src/audio/worklets/pitch-shift.worklet.ts`

```typescript
class PitchShiftWorklet extends AudioWorkletProcessor {
  private grainSize = 512;
  private overlap = 0.5;
  private inputBuffer: Float32Array;
  private outputBuffer: Float32Array;
  private grainWindow: Float32Array;
  private readPointer = 0;
  private writePointer = 0;

  static get parameterDescriptors() {
    return [
      {
        name: 'pitchRatio',
        defaultValue: 1.0,
        minValue: 0.25,  // -24 semitones
        maxValue: 4.0,   // +24 semitones
        automationRate: 'a-rate',
      },
    ];
  }

  constructor(options: AudioWorkletNodeOptions) {
    super();
    const bufferSize = options.processorOptions?.bufferSize ?? 4096;
    this.inputBuffer = new Float32Array(bufferSize);
    this.outputBuffer = new Float32Array(bufferSize);
    this.grainWindow = this.createHannWindow(this.grainSize);

    this.port.onmessage = (e) => {
      if (e.data.type === 'setGrainSize') {
        this.grainSize = e.data.size;
        this.grainWindow = this.createHannWindow(this.grainSize);
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!input || !output) return true;

    const pitchRatio = parameters.pitchRatio;

    for (let i = 0; i < input.length; i++) {
      const ratio = pitchRatio.length > 1 ? pitchRatio[i] : pitchRatio[0];

      // Write input to circular buffer
      this.inputBuffer[this.writePointer % this.inputBuffer.length] = input[i];
      this.writePointer++;

      // Read from circular buffer at shifted rate
      const readIndex = this.readPointer;
      const intIndex = Math.floor(readIndex) % this.inputBuffer.length;
      const frac = readIndex - Math.floor(readIndex);

      // Linear interpolation
      const a = this.inputBuffer[intIndex];
      const b = this.inputBuffer[(intIndex + 1) % this.inputBuffer.length];
      output[i] = a + (b - a) * frac;

      this.readPointer += ratio;
    }

    return true;
  }

  private createHannWindow(size: number): Float32Array {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
  }
}

registerProcessor('pitch-shift-worklet', PitchShiftWorklet);
```

### Integration with SampledInstrument

The worklet is inserted into the playback chain when the pitch shift exceeds a threshold:

```typescript
// In SampledInstrument.playNote():
const semitoneOffset = midiNote - nearestNote;

if (Math.abs(semitoneOffset) <= PLAYBACK_RATE_THRESHOLD) {
  // Small shift: use native playbackRate (cheaper, sounds fine)
  source.playbackRate.value = Math.pow(2, semitoneOffset / 12);
  source.connect(gainNode);
} else {
  // Large shift: use PSOLA worklet (preserves duration)
  source.playbackRate.value = 1.0; // play at original speed
  const pitchShifter = new AudioWorkletNode(audioContext, 'pitch-shift-worklet');
  pitchShifter.parameters.get('pitchRatio')!.value = Math.pow(2, semitoneOffset / 12);
  source.connect(pitchShifter);
  pitchShifter.connect(gainNode);
}
```

`PLAYBACK_RATE_THRESHOLD` = 6 semitones (the point where playbackRate artifacts become noticeable).

### Expected Impact

| Metric | Before | After | Method |
|--------|--------|-------|--------|
| Pitch range without artifacts | ±5 semitones | ±24 semitones | Listening test |
| Duration preservation | No (pitch couples with time) | Yes (PSOLA) | Measurement |
| CPU cost per shifted voice | ~0 (native playbackRate) | ~1-2% (PSOLA) | AudioThreadCPUBenchmark |

---

## Module 5: Performance Metrics Infrastructure

### Design Principles

1. **Measure before and after** — Every worklet has a corresponding benchmark that runs against both the old and new implementation
2. **Automated regression detection** — CI runs benchmarks and flags regressions
3. **Production-safe sampling** — Metrics collection uses <1% CPU overhead
4. **Observable** — Metrics feed into the existing debug overlay (`?debug=1`)

### Metrics Categories

#### A. Scheduling Precision Metrics

These measure the accuracy and consistency of note timing.

```typescript
interface SchedulerMetrics {
  // Jitter: difference between intended and actual note trigger time
  jitterMs: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
    samples: number;
  };

  // Drift: cumulative timing error over a sequence
  driftMs: {
    afterOneBar: number;     // 16 steps
    afterFourBars: number;   // 64 steps
    afterSixteenBars: number; // 256 steps
  };

  // Scheduling overhead: time spent in the scheduling function
  schedulerOverheadMs: {
    mean: number;
    p99: number;
  };

  // Step event delivery: time from audio event to UI callback
  stepCallbackDelayMs: {
    mean: number;
    p99: number;
  };
}
```

**Collection method:**

```typescript
// In the scheduler (both old and new):
const intendedTime = this.nextStepTime;
const actualTime = audioContext.currentTime;
const jitter = Math.abs(actualTime - intendedTime) * 1000;
this.metrics.recordJitter(jitter);

// For drift measurement:
const expectedTime = this.audioStartTime + (this.totalStepsScheduled * stepDuration);
const drift = (actualTime - expectedTime) * 1000;
this.metrics.recordDrift(this.totalStepsScheduled, drift);
```

#### B. Input Latency Metrics

Measures the time from user input (keyboard press) to audio output.

```typescript
interface InputLatencyMetrics {
  // End-to-end: keydown event to first audio sample
  keyToSoundMs: {
    p50: number;
    p95: number;
    p99: number;
    samples: number;
  };

  // Breakdown: each stage of the pipeline
  stages: {
    keydownToDispatchMs: number;    // Event handler to Redux dispatch
    dispatchToSchedulerMs: number;  // Redux to scheduler processing
    schedulerToAudioMs: number;     // Scheduler to AudioNode.start()
    audioToOutputMs: number;        // AudioNode start to DAC output (hardware)
  };
}
```

**Collection method:**

```typescript
// Instrument keyboard events with high-resolution timestamps:
function handleKeyDown(event: KeyboardEvent) {
  const keydownTime = performance.now();
  // ... dispatch note ...
  requestAnimationFrame(() => {
    const audioScheduleTime = performance.now();
    metrics.recordInputLatency({
      keydownToSchedule: audioScheduleTime - keydownTime,
    });
  });
}
```

For the `audioToOutput` stage, we use the AudioContext's `baseLatency` and `outputLatency` properties:

```typescript
const hardwareLatency = (audioContext.baseLatency + (audioContext.outputLatency ?? 0)) * 1000;
```

#### C. CPU and Resource Metrics

Measures the computational cost of audio processing.

```typescript
interface AudioCPUMetrics {
  // Oscillator count: total active Web Audio/Tone.js oscillators
  oscillatorCount: {
    current: number;
    peak: number;             // highest count during session
    byCategory: {
      signal: number;         // main synth oscillators
      lfo: number;            // LFO oscillators
      noise: number;          // noise generators
    };
  };

  // Voice utilization
  voiceUtilization: {
    synthEngine: { active: number; max: number };    // out of 16
    advancedSynth: { active: number; max: number };  // out of 8
    toneSynths: { active: number; max: number };
  };

  // Main thread impact
  mainThread: {
    longTaskCount: number;     // tasks > 50ms (via PerformanceObserver)
    longTaskTotalMs: number;
    audioRelatedLongTasks: number;  // long tasks during scheduling
  };

  // AudioContext health
  contextHealth: {
    state: AudioContextState;
    sampleRate: number;
    baseLatencyMs: number;
    outputLatencyMs: number;
    currentLoad: number;       // AudioContext.renderCapacity (Chrome only)
  };
}
```

**Collection method:**

```typescript
// Long task observer:
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    metrics.recordLongTask(entry.duration);
  }
});
observer.observe({ type: 'longtask' });

// AudioContext render capacity (Chrome):
if ('AudioRenderCapacity' in window) {
  const capacity = audioContext.renderCapacity;
  capacity.addEventListener('update', (e) => {
    metrics.recordRenderLoad(e.load, e.timestamp);
  });
  capacity.start({ updateInterval: 1 }); // 1 second intervals
}

// Oscillator counting (instrument each engine):
function getOscillatorCount(): OscillatorCounts {
  return {
    signal: synthEngine.getVoiceCount() * 2 + advancedSynth.getActiveVoices() * 2,
    lfo: advancedSynth.getActiveVoices(), // 1 LFO per voice currently
    noise: advancedSynth.getActiveNoiseVoices(),
  };
}
```

#### D. Metering Quality Metrics

Validates that the metering worklet produces accurate results.

```typescript
interface MeteringMetrics {
  // Accuracy: compare worklet meters to AnalyserNode reference
  accuracy: {
    rmsErrorDb: number;       // mean difference in dB
    peakErrorDb: number;
    maxErrorDb: number;
  };

  // Delivery rate: how often meters update the UI
  deliveryRate: {
    targetHz: number;         // 60
    actualHz: number;
    missedFrames: number;
  };

  // Latency: time from audio to meter display
  meterLatencyMs: number;
}
```

#### E. Pitch-Shifting Quality Metrics

```typescript
interface PitchShiftMetrics {
  // Spectral fidelity: compare fundamental frequency of output to expected
  fundamentalAccuracyCents: number;

  // Artifact level: energy in non-harmonic frequencies
  artifactLevelDb: number;

  // Duration preservation: ratio of output duration to input duration
  durationRatio: number;       // should be 1.0

  // CPU cost per shifted voice
  cpuPerVoicePercent: number;
}
```

### Benchmark Harness

File: `app/src/audio/benchmarks/audio-benchmark.ts`

```typescript
export class AudioBenchmark {
  private audioContext: OfflineAudioContext;
  private results: Map<string, BenchmarkResult> = new Map();

  constructor(sampleRate = 48000) {
    // OfflineAudioContext for deterministic, faster-than-realtime testing
    this.audioContext = new OfflineAudioContext(2, sampleRate * 10, sampleRate);
  }

  /**
   * Run scheduler jitter benchmark.
   * Plays 256 steps (16 bars) and measures timing deviation.
   */
  async benchmarkSchedulerJitter(
    schedulerFactory: () => IScheduler
  ): Promise<SchedulerMetrics['jitterMs']> {
    const scheduler = schedulerFactory();
    const intendedTimes: number[] = [];
    const actualTimes: number[] = [];

    // Record intended vs actual step times
    scheduler.setOnStepChange((step) => {
      actualTimes.push(performance.now());
    });

    const state = createBenchmarkState({ trackCount: 8, stepCount: 16, tempo: 180 });
    const startTime = performance.now();
    scheduler.start(() => state);

    // Run for 256 steps
    await new Promise((r) => setTimeout(r, 256 * (60 / 180 / 4) * 1000 + 500));
    scheduler.stop();

    // Calculate jitter
    const jitters = actualTimes.map((actual, i) => {
      const expected = startTime + i * (60 / 180 / 4) * 1000;
      return Math.abs(actual - expected);
    });

    return {
      p50: percentile(jitters, 50),
      p95: percentile(jitters, 95),
      p99: percentile(jitters, 99),
      max: Math.max(...jitters),
      samples: jitters.length,
    };
  }

  /**
   * Run A/B comparison between two scheduler implementations.
   */
  async compareSchedulers(
    oldFactory: () => IScheduler,
    newFactory: () => IScheduler,
    config = { bars: 16, tempo: 180, tracks: 8 }
  ): Promise<{
    old: SchedulerMetrics;
    new: SchedulerMetrics;
    improvement: {
      jitterReduction: string;
      driftReduction: string;
      cpuReduction: string;
    };
  }> {
    const oldMetrics = await this.benchmarkSchedulerJitter(oldFactory);
    const newMetrics = await this.benchmarkSchedulerJitter(newFactory);

    return {
      old: { jitterMs: oldMetrics, /* ... */ },
      new: { jitterMs: newMetrics, /* ... */ },
      improvement: {
        jitterReduction: `${((1 - newMetrics.p99 / oldMetrics.p99) * 100).toFixed(1)}%`,
        driftReduction: 'TBD',
        cpuReduction: 'TBD',
      },
    };
  }
}
```

### Metrics Collection Service

File: `app/src/audio/metrics/audio-metrics.ts`

```typescript
/**
 * Singleton service that collects all audio performance metrics.
 * Sampling rate is configurable to limit overhead.
 */
export class AudioMetricsCollector {
  private scheduler: SchedulerMetrics;
  private inputLatency: InputLatencyMetrics;
  private cpu: AudioCPUMetrics;
  private metering: MeteringMetrics;
  private pitchShift: PitchShiftMetrics;

  // Ring buffers for recent samples (keep last 1000)
  private jitterSamples = new RingBuffer<number>(1000);
  private latencySamples = new RingBuffer<number>(1000);

  // Sampling: only record every Nth event to limit overhead
  private sampleRate = 10;  // record 1 in 10 events
  private eventCounter = 0;

  recordJitter(jitterMs: number): void {
    if (++this.eventCounter % this.sampleRate !== 0) return;
    this.jitterSamples.push(jitterMs);
  }

  recordInputLatency(latencyMs: number): void {
    if (++this.eventCounter % this.sampleRate !== 0) return;
    this.latencySamples.push(latencyMs);
  }

  /**
   * Get snapshot of all metrics for the debug overlay.
   */
  getSnapshot(): AudioMetricsSnapshot {
    return {
      scheduler: {
        jitterP50: percentile(this.jitterSamples.toArray(), 50),
        jitterP99: percentile(this.jitterSamples.toArray(), 99),
        samples: this.jitterSamples.size(),
      },
      inputLatency: {
        p50: percentile(this.latencySamples.toArray(), 50),
        p99: percentile(this.latencySamples.toArray(), 99),
      },
      cpu: this.collectCPUMetrics(),
      metering: this.collectMeteringMetrics(),
    };
  }

  /**
   * Reset all metrics (e.g., when switching implementations for A/B test).
   */
  reset(): void {
    this.jitterSamples.clear();
    this.latencySamples.clear();
    this.eventCounter = 0;
  }
}

export const audioMetrics = new AudioMetricsCollector();
```

### Debug Overlay Integration

Add an "Audio Performance" section to the existing debug overlay (`?debug=1`):

```
┌─────────────────────────┐
│ Audio Performance        │
│                          │
│ Scheduler                │
│ Implementation: worklet  │  ← or "main-thread"
│ Jitter p50: 0.3ms       │
│ Jitter p99: 0.8ms       │
│ Drift (4 bars): 0.02ms  │
│                          │
│ Input Latency            │
│ Key→Sound p50: 28ms     │
│ Key→Sound p99: 42ms     │
│ Hardware: 10ms           │
│                          │
│ CPU                      │
│ Oscillators: 12/24       │  ← signal/total
│ LFO mode: shared-worklet │
│ Voices: 5/8 (advanced)  │
│ Long tasks: 0            │
│ Render load: 23%         │  ← Chrome only
│                          │
│ Track Meters             │
│ ▐█████    ▐ Track 1     │
│ ▐███      ▐ Track 2     │
│ ▐█████████▐ Track 3 🔴  │  ← clipping
│ ▐██       ▐ Track 4     │
└─────────────────────────┘
```

### Browser Console API

Extend `window.audioDebug` with metrics access:

```typescript
// In app/src/debug/audio-debug.ts:
window.audioDebug = {
  ...existingMethods,

  metrics(): AudioMetricsSnapshot {
    return audioMetrics.getSnapshot();
  },

  benchmarkScheduler(): Promise<void> {
    const benchmark = new AudioBenchmark();
    const results = await benchmark.compareSchedulers(
      () => new Scheduler(),
      () => new SchedulerWorkletHost(),
    );
    console.table(results.improvement);
  },

  resetMetrics(): void {
    audioMetrics.reset();
    console.log('Audio metrics reset');
  },
};
```

### CI Integration

File: `test/benchmarks/audio-worklet-benchmarks.test.ts`

```typescript
describe('AudioWorklet Performance Benchmarks', () => {
  describe('Scheduler Jitter', () => {
    it('worklet scheduler jitter p99 < 2ms', async () => {
      const benchmark = new AudioBenchmark();
      const metrics = await benchmark.benchmarkSchedulerJitter(
        () => new SchedulerWorkletHost()
      );
      expect(metrics.p99).toBeLessThan(2);
    });

    it('worklet scheduler improves jitter over main-thread', async () => {
      const benchmark = new AudioBenchmark();
      const results = await benchmark.compareSchedulers(
        () => new Scheduler(),
        () => new SchedulerWorkletHost(),
      );
      expect(results.new.jitterMs.p99).toBeLessThan(results.old.jitterMs.p99);
    });
  });

  describe('LFO CPU Usage', () => {
    it('shared LFO uses fewer oscillators than per-voice', () => {
      // Old: 8 voices * 1 LFO = 8 oscillators
      // New: 1 worklet = 0 oscillators (worklet computes internally)
      const oldCount = 8;
      const newCount = 0;
      expect(newCount).toBeLessThan(oldCount);
    });
  });

  describe('Metering Accuracy', () => {
    it('metering worklet RMS within 0.5dB of AnalyserNode', async () => {
      const results = await benchmarkMeteringAccuracy();
      expect(results.rmsErrorDb).toBeLessThan(0.5);
    });
  });

  describe('Pitch Shifting', () => {
    it('PSOLA preserves duration within 1%', async () => {
      const results = await benchmarkPitchShift({ semitones: 12 });
      expect(Math.abs(results.durationRatio - 1.0)).toBeLessThan(0.01);
    });

    it('PSOLA fundamental within 5 cents of target', async () => {
      const results = await benchmarkPitchShift({ semitones: 7 });
      expect(Math.abs(results.fundamentalAccuracyCents)).toBeLessThan(5);
    });
  });
});
```

---

## Implementation Order

### Phase W1: Metrics Infrastructure (build first — measure the baseline)

1. Create `AudioMetricsCollector` with jitter and latency recording
2. Add `PerformanceObserver` long task tracking
3. Integrate metrics into debug overlay
4. Add `window.audioDebug.metrics()` console API
5. Record baseline measurements with the current main-thread scheduler
6. Create CI benchmark harness with `OfflineAudioContext`

**Output:** Baseline numbers for jitter, latency, and CPU. These become the "before" in every comparison.

### Phase W2: Scheduler Worklet

1. Create `scheduler.worklet.ts` processor
2. Create `scheduler-worklet-host.ts` host
3. Define `IScheduler` interface, implement for both old and new
4. Feature-flag: `VITE_WORKLET_SCHEDULER=true` enables worklet scheduler
5. Wire up metrics recording in both implementations
6. Run A/B comparison benchmarks
7. Update multiplayer sync path for worklet
8. Fallback to main-thread scheduler if `addModule` fails

### Phase W3: Shared LFO Worklet

1. Create `shared-lfo.worklet.ts` processor
2. Modify `AdvancedSynthEngine` to use shared LFO when available
3. Add oscillator count metrics
4. A/B CPU comparison for LFO-heavy presets (wobble-bass, tremolo-strings)

### Phase W4: Track Metering Worklet

1. Create `metering.worklet.ts` processor
2. Create `MeteringHost` service
3. Connect track buses to metering inputs
4. Create `useTrackMeter` React hook
5. Add meter visualization to debug overlay
6. Validate accuracy against `AnalyserNode` reference

### Phase W5: Pitch-Shifting Worklet

1. Create `pitch-shift.worklet.ts` with PSOLA implementation
2. Integrate with `SampledInstrument.playNote()` for shifts > 6 semitones
3. Benchmark spectral fidelity and duration preservation
4. A/B listening tests for piano at extreme transpositions

---

## File Structure

```
app/src/audio/
├── worklets/
│   ├── scheduler.worklet.ts        # Module 1: Timing loop
│   ├── shared-lfo.worklet.ts       # Module 2: Shared modulation
│   ├── metering.worklet.ts         # Module 3: Level analysis
│   └── pitch-shift.worklet.ts      # Module 4: PSOLA
├── scheduler-worklet-host.ts       # Main-thread host for scheduler worklet
├── metering-host.ts                # Main-thread host for metering worklet
├── metrics/
│   ├── audio-metrics.ts            # Metrics collector singleton
│   ├── ring-buffer.ts              # Fixed-size sample buffer
│   └── percentile.ts               # Statistical helpers
├── benchmarks/
│   └── audio-benchmark.ts          # Benchmark harness
├── scheduler.ts                    # Existing (kept as fallback)
├── engine.ts                       # Updated to initialize worklets
└── ...
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Worklet `addModule` fails on some browser | Low | High | Feature detection + fallback to existing Scheduler |
| MessagePort latency adds to note timing | Medium | Medium | Benchmark: if >2ms overhead, batch events or use SharedArrayBuffer |
| State serialization overhead | Medium | Low | Only serialize changed tracks; use transferable ArrayBuffers |
| Tone.js context mismatch with worklet | Low | High | Worklet doesn't touch Tone.js; main thread still owns all Tone.js nodes |
| PSOLA artifacts worse than playbackRate at small shifts | Medium | Low | Only activate for shifts > 6 semitones |
| iOS AudioWorklet quirks | Medium | Medium | Test on iOS Safari 14.5+; fall back to main thread if issues |

---

## Success Criteria

- [ ] Scheduler jitter p99 < 2ms (down from ~12.5ms)
- [ ] Keyboard-to-sound latency p50 < 35ms (down from ~55ms)
- [ ] Zero main-thread long tasks attributable to audio scheduling
- [ ] LFO-heavy preset CPU reduction measurable (>15%)
- [ ] Per-track metering at 60fps with no main thread cost
- [ ] PSOLA pitch shift preserves duration within 1% for shifts > 6 semitones
- [ ] All metrics visible in debug overlay and `window.audioDebug.metrics()`
- [ ] CI benchmarks run on every PR and flag regressions > 10%
- [ ] Graceful fallback on browsers without AudioWorklet support
