/**
 * Phase 11: Toast Notification for Player Join/Leave
 *
 * Shows brief notifications when players join or leave the session.
 */

import { useEffect, useState } from 'react';
import './ToastNotification.css';

export interface Toast {
  id: string;
  message: string;
  color?: string;
  type: 'join' | 'leave';
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

  useEffect(() => {
    // Auto-dismiss after 3 seconds
    const timer = setTimeout(() => {
      setIsExiting(true);
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (isExiting) {
      const timer = setTimeout(() => {
        onDismiss(toast.id);
      }, 300); // Match animation duration
      return () => clearTimeout(timer);
    }
  }, [isExiting, toast.id, onDismiss]);

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
