/**
 * Phase 11: Toast Notification for Player Join/Leave
 * Extended: URL fallback toast for clipboard failures
 *
 * Shows brief notifications when players join or leave the session.
 * Also shows URL fallback when clipboard copy fails (iOS compatibility).
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { copyToClipboard } from '../utils/clipboard';
import './ToastNotification.css';

export interface Toast {
  id: string;
  message: string;
  color?: string;
  type: 'join' | 'leave' | 'url';
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
    if (isExiting) {
      const timer = setTimeout(() => {
        onDismiss(toast.id);
      }, 300); // Match animation duration
      return () => clearTimeout(timer);
    }
  }, [isExiting, toast.id, onDismiss]);

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

  // URL toast has special rendering
  if (toast.type === 'url' && toast.url) {
    return (
      <div
        className={`toast toast-url ${isExiting ? 'exiting' : ''}`}
        onClick={handleUrlTap}
      >
        <div className="toast-url-header">
          <span className="toast-message">{toast.message}</span>
          <button className="toast-dismiss" onClick={(e) => { e.stopPropagation(); handleDismiss(); }}>×</button>
        </div>
        <div className="toast-url-content">
          <span className="toast-url-text">{toast.url}</span>
        </div>
        <div className="toast-url-hint">
          {copyAttempted ? '✓ Copied!' : 'Tap to copy'}
        </div>
      </div>
    );
  }

  // Standard join/leave toast
  return (
    <div
      className={`toast ${toast.type} ${isExiting ? 'exiting' : ''}`}
      style={{ '--toast-color': toast.color ?? '#666' } as React.CSSProperties}
    >
      <span className="toast-icon">{toast.type === 'join' ? '→' : '←'}</span>
      <span className="toast-message">{toast.message}</span>
    </div>
  );
}
