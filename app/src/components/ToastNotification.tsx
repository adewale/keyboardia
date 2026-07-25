/**
 * Phase 11: Toast Notification Component
 *
 * Displays temporary notifications for player join/leave events
 * and copy/share feedback.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import type { AnimationEvent, FocusEvent } from 'react';
import { copyToClipboard } from '../utils/clipboard';
import { AudioWarning, Check, Close, PlayerJoin, PlayerLeave, Warning } from '../icons';
import './ToastNotification.css';

export interface Toast {
  id: string;
  message: string;
  type: 'join' | 'leave' | 'error' | 'warning' | 'url';
  color?: string;
  url?: string;
}

interface ToastNotificationProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastNotification({ toasts, onDismiss }: ToastNotificationProps) {
  return (
    // The polite live region lives on the persistent container, not on each
    // toast. Screen readers announce changes to a region that already exists;
    // a region inserted together with its text is commonly missed. Urgent
    // toasts additionally use role="alert", which does announce on insertion.
    <div className="toast-container" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocusWithin, setHasFocusWithin] = useState(false);
  const [copyAttempted, setCopyAttempted] = useState(false);
  const isPaused = isHovered || hasFocusWithin;
  const urlTapTimerRef = useRef<number | undefined>(undefined);
  const dismissedRef = useRef(false);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => () => {
    if (urlTapTimerRef.current !== undefined) {
      window.clearTimeout(urlTapTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (isPaused || isExiting) return;

    // URL toasts stay longer so users can copy; focused/hovered toasts pause.
    const duration = toast.type === 'url' ? 8000 : 2500;
    const timer = window.setTimeout(() => setIsExiting(true), duration);
    return () => window.clearTimeout(timer);
  }, [isExiting, isPaused, toast.type]);

  const completeDismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    const focusTarget = previousFocusRef.current;
    onDismiss(toast.id);
    if (focusTarget?.isConnected) {
      requestAnimationFrame(() => focusTarget.focus());
    }
  }, [onDismiss, toast.id]);

  useEffect(() => {
    if (!isExiting) return;

    // animationend is authoritative; this fallback prevents a stuck toast if
    // animations are unavailable or interrupted by browser/UI settings.
    const fallback = window.setTimeout(completeDismiss, 350);
    return () => window.clearTimeout(fallback);
  }, [completeDismiss, isExiting]);

  useEffect(() => {
    if (!copyAttempted || isPaused || isExiting) return;

    if (urlTapTimerRef.current !== undefined) {
      window.clearTimeout(urlTapTimerRef.current);
    }
    urlTapTimerRef.current = window.setTimeout(() => {
      urlTapTimerRef.current = undefined;
      setIsExiting(true);
    }, 500);
    return () => {
      if (urlTapTimerRef.current !== undefined) {
        window.clearTimeout(urlTapTimerRef.current);
        urlTapTimerRef.current = undefined;
      }
    };
  }, [copyAttempted, isExiting, isPaused]);

  const handleUrlTap = useCallback(async () => {
    if (!toast.url) return;

    const success = await copyToClipboard(toast.url);
    if (success) setCopyAttempted(true);
  }, [toast.url]);

  const handleDismiss = useCallback(() => setIsExiting(true), []);

  const handleAnimationEnd = useCallback((event: AnimationEvent<HTMLDivElement>) => {
    if (!isExiting || event.target !== event.currentTarget) return;
    if (event.animationName !== 'toast-exit' && event.animationName !== 'toast-reduced-exit') return;
    completeDismiss();
  }, [completeDismiss, isExiting]);

  const handleFocusCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!event.currentTarget.contains(relatedTarget)) {
      previousFocusRef.current = event.relatedTarget instanceof HTMLElement
        ? event.relatedTarget
        : null;
    }
    setHasFocusWithin(true);
  }, []);

  const handleBlurCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (!event.currentTarget.contains(relatedTarget)) {
      // Focus restoration belongs only to a dismissal initiated while focus is
      // still inside this toast. Once the user deliberately moves elsewhere,
      // an eventual auto-dismiss must not pull them back to stale history.
      previousFocusRef.current = null;
      setHasFocusWithin(false);
    }
  }, []);

  if (toast.type === 'url' && toast.url) {
    return (
      <div
        className={`toast toast-url ${isExiting ? 'exiting' : ''}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onFocusCapture={handleFocusCapture}
        onBlurCapture={handleBlurCapture}
        onAnimationEnd={handleAnimationEnd}
      >
        <div className="toast-url-header">
          <span className="toast-message">
            {toast.message}
            {/* Status of the copy action itself. This region is mounted with
              * the toast and then updated, so the update does get announced. */}
            <span className="toast-announcement" role="status" aria-live="polite" aria-atomic="true">
              {copyAttempted ? 'Link copied.' : ''}
            </span>
          </span>
          <button
            type="button"
            className="toast-dismiss"
            aria-label="Dismiss"
            onClick={handleDismiss}
          >
            <Close size={14} aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          className="toast-url-copy"
          // This toast exists because the clipboard failed, so the URL itself
          // must stay in the accessible name rather than being replaced by it.
          aria-label={`Copy URL ${toast.url}`}
          onClick={handleUrlTap}
        >
          <span className="toast-url-content">
            <span className="toast-url-text">{toast.url}</span>
          </span>
          <span className="toast-url-hint">
            {copyAttempted ? <><Check size={12} aria-hidden="true" /> Copied!</> : 'Copy URL'}
          </span>
        </button>
      </div>
    );
  }

  const getIcon = () => {
    switch (toast.type) {
      case 'join': return <PlayerJoin size={14} aria-hidden="true" />;
      case 'leave': return <PlayerLeave size={14} aria-hidden="true" />;
      case 'error': return <Warning size={14} aria-hidden="true" />;
      case 'warning': return <AudioWarning size={14} aria-hidden="true" />;
      default: return '•';
    }
  };

  const isUrgent = toast.type === 'error' || toast.type === 'warning';
  return (
    <div
      className={`toast ${toast.type} ${isExiting ? 'exiting' : ''}`}
      style={{ '--toast-color': toast.type === 'error' ? '#e74c3c' : toast.type === 'warning' ? '#f39c12' : (toast.color ?? '#666') } as React.CSSProperties}
      // Urgent toasts announce on insertion via role="alert". Non-urgent ones
      // rely on the container's polite region; a second nested live region
      // here would risk duplicate announcements.
      role={isUrgent ? 'alert' : undefined}
      aria-atomic={isUrgent ? 'true' : undefined}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onAnimationEnd={handleAnimationEnd}
    >
      <span className="toast-icon">{getIcon()}</span>
      <span className="toast-message">{toast.message}</span>
    </div>
  );
}
