/**
 * Portrait Header Component
 *
 * Minimal header for portrait consumption mode:
 * - Play/stop button (left)
 * - App name / session name (center)
 * - BPM display
 * - Share button (right)
 *
 * This header replaces the full transport in portrait mode,
 * providing only the essential playback controls.
 */

import { memo, useState, useCallback, useEffect, useRef } from 'react';
import { Check, Play, Qr, Share, Stop } from '../icons';
import { useQRMode } from '../hooks/useQRMode';
import './PortraitHeader.css';

interface PortraitHeaderProps {
  isPlaying: boolean;
  tempo: number;
  sessionName?: string;
  sessionUrl?: string;
  onPlayPause: () => void;
  beatPulse?: boolean;
  beatPulseDuration?: number;
}

export const PortraitHeader = memo(function PortraitHeader({
  isPlaying,
  tempo,
  sessionName,
  sessionUrl,
  onPlayPause,
  beatPulse = false,
  beatPulseDuration = 100,
}: PortraitHeaderProps) {
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<number | undefined>(undefined);
  const { activate: showQR } = useQRMode();

  useEffect(() => () => {
    if (copiedTimerRef.current !== undefined) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  const handleShare = useCallback(async () => {
    if (!sessionUrl) return;

    // Try native Web Share API first (available on mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: sessionName ? `${sessionName} — Keyboardia` : 'Keyboardia',
          text: 'Check out this beat!',
          url: sessionUrl,
        });
        return;
      } catch (err) {
        // User cancelled or share failed, fall through to clipboard
        if ((err as Error).name === 'AbortError') return;
      }
    }

    // Fallback to clipboard
    try {
      await navigator.clipboard.writeText(sessionUrl);
      setCopied(true);
      if (copiedTimerRef.current !== undefined) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = undefined;
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [sessionUrl, sessionName]);

  return (
    <header className="portrait-header" role="banner">
      {/* Play/Stop button - stopping resets the playhead */}
      <button
        className={`portrait-play-btn ${isPlaying ? 'playing' : ''} ${beatPulse ? 'beat-pulse' : ''}`}
        onClick={onPlayPause}
        aria-label={isPlaying ? 'Stop' : 'Play'}
        style={{ '--beat-pulse-duration': `${beatPulseDuration}ms` } as React.CSSProperties}
      >
        {isPlaying
          ? <Stop size={20} fill="currentColor" aria-hidden="true" />
          : <Play size={20} fill="currentColor" aria-hidden="true" />}
      </button>

      {/* App/Session name - center */}
      <div className="portrait-title">
        <span className="portrait-app-name">Keyboardia</span>
        {sessionName && (
          <span className="portrait-session-name">{sessionName}</span>
        )}
      </div>

      {/* BPM display - read-only */}
      <div className="portrait-bpm" aria-label={`Tempo: ${tempo} beats per minute`}>
        <span className="portrait-bpm-value">{tempo}</span>
        <span className="portrait-bpm-label">BPM</span>
      </div>

      {/* QR and Share buttons */}
      {sessionUrl && (
        <div className="portrait-header-actions">
          <button
            className="portrait-qr-btn"
            onClick={showQR}
            aria-label="Show QR code"
            title="Show QR code"
          >
            <Qr size={20} aria-hidden="true" />
          </button>
          <button
            className={`portrait-share-btn ${copied ? 'copied' : ''}`}
            onClick={handleShare}
            aria-label="Share session"
            title={copied ? 'Copied!' : 'Share'}
          >
            {copied
              ? <Check size={20} aria-hidden="true" />
              : <Share size={20} aria-hidden="true" />}
          </button>
          <span className="portrait-share-status" role="status" aria-live="polite">
            {copied ? 'Link copied' : ''}
          </span>
        </div>
      )}
    </header>
  );
});
