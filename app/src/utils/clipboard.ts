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
 * Copy text from a Promise to clipboard - iOS/Safari compatible
 *
 * CRITICAL: This function must be called synchronously within a user gesture.
 * The clipboard.write() call happens immediately, but the content is provided
 * via a Promise that can resolve later (after async operations like network calls).
 *
 * @param textPromise A promise that resolves to the text to copy
 * @returns true if copy succeeded, false otherwise
 */
export async function copyToClipboardAsync(textPromise: Promise<string>): Promise<boolean> {
  // ClipboardItem with Promise content - the key to iOS compatibility
  // We call write() synchronously, but provide a Promise for the content
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      // Create ClipboardItem with a Promise that resolves to a Blob
      const clipboardItem = new ClipboardItem({
        'text/plain': textPromise.then(text => new Blob([text], { type: 'text/plain' }))
      });
      // This write() call happens synchronously within user gesture
      await navigator.clipboard.write([clipboardItem]);
      return true;
    } catch (err) {
      // Phase 21.5: Log clipboard errors for debugging
      logger.log('Clipboard async write failed, trying fallback:', err);
    }
  }

  // Fallback: wait for the promise and use standard methods
  // This may fail on iOS if the gesture has expired
  try {
    const text = await textPromise;
    return copyToClipboard(text);
  } catch (err) {
    // Phase 21.5: Log clipboard errors for debugging
    logger.error('Clipboard async fallback failed:', err);
    return false;
  }
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
