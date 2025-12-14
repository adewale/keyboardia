/**
 * QR Panel Component
 *
 * The panel containing the QR code, session metadata, and action buttons.
 * Used by QROverlay in different display modes.
 */

import { useState, useCallback } from 'react';
import { QRCode } from './QRCode';
import { copyToClipboard } from '../../utils/clipboard';

interface QRPanelProps {
  /** URL to encode in the QR code */
  targetURL: string;
  /** Session name (null for untitled) */
  sessionName: string | null;
  /** Number of connected players */
  playerCount: number;
  /** QR code size in pixels */
  qrSize?: number;
  /** Close button handler (null to hide button) */
  onClose?: (() => void) | null;
  /** Whether to show the exit button */
  showExitButton?: boolean;
}

export function QRPanel({
  targetURL,
  sessionName,
  playerCount,
  qrSize = 200,
  onClose,
  showExitButton = true,
}: QRPanelProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = useCallback(async () => {
    const success = await copyToClipboard(targetURL);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [targetURL]);

  const displayName = sessionName || 'Untitled Session';
  const playerText = playerCount <= 1 ? 'Just you' : `${playerCount} people jamming`;

  return (
    <div className="qr-panel">
      <div className="qr-panel-content">
        {/* QR Code */}
        <div className="qr-code-container">
          <QRCode value={targetURL} size={qrSize} />
        </div>

        {/* Accent line */}
        <div className="qr-accent-line" />

        {/* Text info with staggered animation */}
        <div className="qr-panel-text">
          <span className="qr-action-text">Scan to join</span>
          <span className="qr-session-name" title={displayName}>
            "{displayName}"
          </span>
          <span className="qr-player-count">{playerText}</span>
        </div>

        {/* Divider */}
        <div className="qr-panel-divider" />

        {/* Action buttons */}
        <div className="qr-panel-actions">
          <button
            className="qr-btn qr-btn-copy"
            onClick={handleCopyLink}
            aria-label="Copy session link to clipboard"
          >
            {copied ? 'Copied!' : 'Copy Link'}
          </button>
          {showExitButton && onClose && (
            <button
              className="qr-btn qr-btn-exit"
              onClick={onClose}
              aria-label="Hide QR code"
            >
              Hide QR Code
            </button>
          )}
        </div>
      </div>

      {/* Close button for floating/mobile modes */}
      {onClose && !showExitButton && (
        <button
          className="qr-close-btn"
          onClick={onClose}
          aria-label="Close QR code overlay"
        >
          ✕
        </button>
      )}
    </div>
  );
}
