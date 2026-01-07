/**
 * iOS-compatible clipboard utility
 *
 * Chrome iOS uses WebKit (not Blink), which enforces strict user gesture requirements.
 * When there's an async operation between the user click and clipboard.writeText(),
 * WebKit considers the user gesture "expired" and blocks the clipboard write.
 *
 * The key insight: ClipboardItem accepts a Promise for its content. By calling
 * navigator.clipboard.write() synchronously within the user gesture (passing a
 * Promise that resolves later), WebKit keeps the gesture context active.
 *
 * @see specs/research/IOS-CHROME-COMPATIBILITY.md
 */

import { logger } from './logger';

/**
 * Copy text to clipboard with iOS/Safari compatibility
 * @param text The text to copy
 * @returns true if copy succeeded, false otherwise
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Try ClipboardItem API first (works on iOS Safari/Chrome)
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = new Blob([text], { type: 'text/plain' });
      const clipboardItem = new ClipboardItem({ 'text/plain': blob });
      await navigator.clipboard.write([clipboardItem]);
      return true;
    } catch (err) {
      // Phase 21.5: Log clipboard errors for debugging
      logger.log('Clipboard write via ClipboardItem failed, trying writeText:', err);
    }
  }

  // Try standard writeText (works on desktop browsers)
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      // Phase 21.5: Log clipboard errors for debugging
      logger.log('Clipboard writeText failed, trying fallback:', err);
    }
  }

  // Fallback: execCommand (deprecated but widely supported)
  return fallbackCopyTextToClipboard(text);
}

/**
 * Fallback using deprecated execCommand
 * Required for older browsers and some edge cases
 */
function fallbackCopyTextToClipboard(text: string): boolean {
  const textArea = document.createElement('textarea');
  textArea.value = text;

  // Prevent scrolling and visual artifacts
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  textArea.style.opacity = '0';

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const success = document.execCommand('copy');
    if (!success) {
      logger.log('Clipboard execCommand returned false');
    }
    return success;
  } catch (err) {
    // Phase 21.5: Log clipboard errors for debugging
    logger.error('Clipboard execCommand failed:', err);
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}
