/**
 * Phase 11: Toast Notification for Player Join/Leave
 * Extended: URL fallback toast for clipboard failures
 *
 * Shows brief notifications when players join or leave the session.
 * Also shows URL fallback when clipboard copy fails (iOS compatibility).
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { copyToClipboard } from '../utils/clipboard';
import { AudioWarning, Check, Close, PlayerJoin, PlayerLeave, Warning } from '../icons';
import './ToastNotification.css';

export interface Toast {
  id: string;
  message: string;
  color?: string;
  type: 'join' | 'leave' | 'url' | 'error' | 'warning';
  /** For url type: the full URL to display */
  url?: string;
}

interface ToastNotificationProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastNotification({ toasts, onDismiss }: ToastNotificationProps) {
  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);
  const [copyAttempted, setCopyAttempted] = useState(false);
  const urlTapTimerRef = useRef<number | undefined>(undefined);

  // Cleanup timer on unmount to prevent state update on unmounted component
  useEffect(() => {
    return () => {
      if (urlTapTimerRef.current) {
        clearTimeout(urlTapTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // URL toasts stay longer (8s) so user can copy; others dismiss after 2.5s
    const duration = toast.type === 'url' ? 8000 : 2500;
    const timer = setTimeout(() => {
      setIsExiting(true);
    }, duration);

    return () => clearTimeout(timer);
  }, [toast.type]);

  useEffect(() => {
    if (!isExiting) return;

    // animationend is authoritative; this fallback prevents a stuck toast if
    // animations are unavailable or interrupted by browser/UI settings.
    const fallback = window.setTimeout(() => onDismiss(toast.id), 350);
    return () => window.clearTimeout(fallback);
  }, [isExiting, onDismiss, toast.id]);

  const handleUrlTap = useCallback(async () => {
    if (toast.url) {
      const success = await copyToClipboard(toast.url);
      if (success) {
        setCopyAttempted(true);
        // Auto-dismiss after successful copy (timer cleaned up on unmount)
        urlTapTimerRef.current = window.setTimeout(() => setIsExiting(true), 500);
      }
    }
  }, [toast.url]);

  const handleDismiss = useCallback(() => {
    setIsExiting(true);
  }, []);

  const handleAnimationEnd = useCallback(() => {
    if (isExiting) onDismiss(toast.id);
  }, [isExiting, onDismiss, toast.id]);

  // URL toast has special rendering
  if (toast.type === 'url' && toast.url) {
    return (
      <div
        className={`toast toast-url ${isExiting ? 'exiting' : ''}`}
        onClick={handleUrlTap}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleUrlTap(); }}
        role="button"
        tabIndex={0}
        onAnimationEnd={handleAnimationEnd}
      >
        <div className="toast-url-header">
          <span className="toast-message">{toast.message}</span>
          <button
            className="toast-dismiss"
            aria-label="Dismiss"
            onClick={(e) => { e.stopPropagation(); handleDismiss(); }}
          >
            <Close size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="toast-url-content">
          <span className="toast-url-text">{toast.url}</span>
        </div>
        <div className="toast-url-hint">
          {copyAttempted ? <><Check size={12} aria-hidden="true" /> Copied!</> : 'Tap to copy'}
        </div>
      </div>
    );
  }

  // Standard join/leave/error/warning toast
  const getIcon = () => {
    switch (toast.type) {
      case 'join': return <PlayerJoin size={14} aria-hidden="true" />;
      case 'leave': return <PlayerLeave size={14} aria-hidden="true" />;
      case 'error': return <Warning size={14} aria-hidden="true" />;
      case 'warning': return <AudioWarning size={14} aria-hidden="true" />;
      default: return '•';
    }
  };

  return (
    <div
      className={`toast ${toast.type} ${isExiting ? 'exiting' : ''}`}
      style={{ '--toast-color': toast.type === 'error' ? '#e74c3c' : toast.type === 'warning' ? '#f39c12' : (toast.color ?? '#666') } as React.CSSProperties}
      onAnimationEnd={handleAnimationEnd}
    >
      <span className="toast-icon">{getIcon()}</span>
      <span className="toast-message">{toast.message}</span>
    </div>
  );
}
