/**
 * Toast Event Utilities
 *
 * Custom event system for showing toasts from anywhere in the app.
 * This avoids prop drilling and circular dependencies.
 */

export type ToastType = 'join' | 'leave' | 'url' | 'error';

/**
 * Dispatch a toast event that will be picked up by App.tsx
 * Use this to show toasts from components that don't have direct access to the toast state
 */
export function dispatchToastEvent(message: string, type: ToastType = 'error') {
  const event = new CustomEvent('show-toast', {
    detail: { message, type },
  });
  window.dispatchEvent(event);
}
