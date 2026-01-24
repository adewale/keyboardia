/**
 * Portrait Action Drawer Component
 *
 * Swipe-up drawer for portrait mode that reveals:
 * - Share button
 * - QR code for pattern sharing
 *
 * Uses a pull-up handle gesture to reveal content.
 */

import { useState, useCallback, useRef, memo } from 'react';
import './PortraitActionDrawer.css';

interface PortraitActionDrawerProps {
  /** Called when user wants to share the current pattern */
  onShare?: () => void;
  /** Whether a shareable session exists */
  canShare?: boolean;
  /** Session URL for QR code */
  sessionUrl?: string;
}

export const PortraitActionDrawer = memo(function PortraitActionDrawer({
  onShare,
  canShare = false,
  sessionUrl,
}: PortraitActionDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number>(0);
  const drawerRef = useRef<HTMLDivElement>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startYRef.current = e.touches[0].clientY;
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;

    const currentY = e.touches[0].clientY;
    const deltaY = startYRef.current - currentY;

    // If dragging up more than 30px, open the drawer
    if (deltaY > 30 && !isOpen) {
      setIsOpen(true);
      setIsDragging(false);
    }
    // If dragging down more than 30px, close the drawer
    else if (deltaY < -30 && isOpen) {
      setIsOpen(false);
      setIsDragging(false);
    }
  }, [isDragging, isOpen]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleToggle = useCallback(() => {
    setIsOpen(prev => !prev);
  }, []);

  const handleShare = useCallback(() => {
    onShare?.();
  }, [onShare]);

  return (
    <div
      className={`portrait-action-drawer ${isOpen ? 'open' : ''}`}
      ref={drawerRef}
    >
      {/* Pull handle */}
      <div
        className="portrait-drawer-handle"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onClick={handleToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Close drawer' : 'Open drawer'}
      >
        <div className="portrait-drawer-handle-bar" />
        <span className="portrait-drawer-hint">
          {isOpen ? 'Close' : 'Swipe up to share'}
        </span>
      </div>

      {/* Drawer content */}
      <div className="portrait-drawer-content">
        {/* Share button */}
        <button
          className="portrait-share-btn"
          onClick={handleShare}
          disabled={!canShare}
          aria-label="Share pattern"
        >
          <span className="portrait-share-icon">↗</span>
          <span className="portrait-share-text">Share</span>
        </button>

        {/* QR Code placeholder - would integrate with actual QR generation */}
        {sessionUrl && (
          <div className="portrait-qr-section">
            <div className="portrait-qr-placeholder" aria-label="QR code for sharing">
              <span className="portrait-qr-icon">⊞</span>
              <span className="portrait-qr-text">Scan to view</span>
            </div>
          </div>
        )}

        {/* Info text */}
        <p className="portrait-drawer-info">
          Share your pattern with others
        </p>
      </div>
    </div>
  );
});
