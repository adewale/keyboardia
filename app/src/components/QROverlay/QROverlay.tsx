/**
 * QR Overlay Component
 *
 * Main container for QR code display mode. Adapts layout based on viewport:
 * - large (≥1024px): Side panel that pushes content
 * - medium (768px - 1023px): Floating card in bottom-right
 * - small (<768px): Fullscreen modal with backdrop
 */

import { useEffect, useCallback, useRef } from 'react';
import { QRPanel } from './QRPanel';
import { useDisplayMode } from '../../hooks/useDisplayMode';
import './QROverlay.css';

interface QROverlayProps {
  /** URL to encode in the QR code */
  targetURL: string;
  /** Session name (null for untitled) */
  sessionName: string | null;
  /** Number of connected players */
  playerCount: number;
  /** Close handler */
  onClose: () => void;
}

export function QROverlay({
  targetURL,
  sessionName,
  playerCount,
  onClose,
}: QROverlayProps) {
  const displayMode = useDisplayMode();
  const overlayRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Store the element that had focus before opening
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus the overlay for keyboard navigation
    if (overlayRef.current) {
      overlayRef.current.focus();
    }

    // Restore focus when closing
    return () => {
      if (previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    };
  }, []);

  // Lock body scroll on mobile (small display) to prevent background scrolling
  useEffect(() => {
    if (displayMode !== 'small') return;

    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    // Prevent layout shift from scrollbar disappearing
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [displayMode]);

  // Handle Escape key to close
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  // Handle backdrop click for mobile
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  // QR sizes based on display mode
  const qrSizes = {
    large: 200,
    medium: 160,
    small: 240,
  };

  const qrSize = qrSizes[displayMode];

  // Large display: side panel
  if (displayMode === 'large') {
    return (
      <div
        ref={overlayRef}
        className="qr-overlay qr-overlay-large"
        role="dialog"
        aria-modal="false"
        aria-label="QR code for sharing session"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <QRPanel
          targetURL={targetURL}
          sessionName={sessionName}
          playerCount={playerCount}
          qrSize={qrSize}
          onClose={onClose}
          showExitButton={true}
        />
      </div>
    );
  }

  // Medium display: floating card
  if (displayMode === 'medium') {
    return (
      <div
        ref={overlayRef}
        className="qr-overlay qr-overlay-medium"
        role="dialog"
        aria-modal="false"
        aria-label="QR code for sharing session"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <QRPanel
          targetURL={targetURL}
          sessionName={sessionName}
          playerCount={playerCount}
          qrSize={qrSize}
          onClose={onClose}
          showExitButton={false}
        />
      </div>
    );
  }

  // Small display: fullscreen modal
  return (
    <div
      ref={overlayRef}
      className="qr-overlay qr-overlay-small"
      role="dialog"
      aria-modal="true"
      aria-label="QR code for sharing session"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onClick={handleBackdropClick}
    >
      <QRPanel
        targetURL={targetURL}
        sessionName={sessionName}
        playerCount={playerCount}
        qrSize={qrSize}
        onClose={onClose}
        showExitButton={false}
      />
      <p className="qr-dismiss-hint">Tap anywhere to close</p>
    </div>
  );
}
