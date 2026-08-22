/**
 * Mobile output routing (Phase 44 Change 1).
 *
 * Web Audio connected to `AudioContext.destination` on iOS obeys the physical
 * ringer switch: with the switch on silent the whole app is mute while the UI
 * keeps animating — the most common "no sound on mobile" report
 * (specs/research/MOBILE-LESSONS.md). Audio that reaches the speaker through
 * an HTMLMediaElement uses the media pipeline instead, which the switch does
 * not gate. So on mobile the master chain terminates in a
 * MediaStreamAudioDestinationNode whose stream feeds a hidden
 * `<audio playsinline>` element; on desktop the graph connects to
 * `destination` exactly as before.
 *
 * The element can only start inside a user gesture; `unlock()` is called from
 * the engine's existing gesture handlers and is idempotent.
 */

import { logger } from '../utils/logger';

/**
 * OS-level mobile detection (not viewport width): the ringer-switch problem
 * follows the operating system, not the window size. iPadOS 13+ reports a
 * Mac UA but exposes multi-touch, hence the second clause.
 */
export function needsMediaElementOutput(
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | undefined =
    typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  if (!nav) return false;
  if (/iPhone|iPad|iPod|Android/i.test(nav.userAgent)) return true;
  return /Mac/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 2;
}

export class MediaElementOutput {
  private element: HTMLAudioElement | null = null;
  private streamDestination: MediaStreamAudioDestinationNode | null = null;
  private unlocked = false;
  private readonly handlePause = (): void => {
    // The OS/media session can pause the element behind our back. Clear the
    // latch so the next explicit play gesture actually restarts the route.
    this.unlocked = false;
  };

  /**
   * Route `source` into a hidden media element. Returns true when the media
   * path was built; false means the caller must connect `source` to
   * `context.destination` itself (missing DOM or MediaStream support — the
   * graph must never be left dangling).
   */
  connect(source: AudioNode, context: AudioContext): boolean {
    if (
      typeof document === 'undefined'
      || typeof Audio === 'undefined'
      || typeof context.createMediaStreamDestination !== 'function'
    ) {
      return false;
    }
    try {
      this.streamDestination = context.createMediaStreamDestination();
      source.connect(this.streamDestination);
      const element = new Audio();
      element.srcObject = this.streamDestination.stream;
      element.muted = false;
      element.setAttribute('playsinline', '');
      element.style.display = 'none';
      element.addEventListener('pause', this.handlePause);
      document.body.appendChild(element);
      this.element = element;
      logger.audio.log('Mobile media-element output connected');
      return true;
    } catch (error) {
      logger.audio.warn('Media-element output failed; falling back to destination:', error);
      this.dispose();
      return false;
    }
  }

  /** Start the element inside a user gesture. Safe to call repeatedly. */
  unlock(): void {
    if (!this.element || this.unlocked) return;
    const playResult = this.element.play();
    // play() returns undefined in some fakes/older engines.
    void playResult?.then(
      () => {
        this.unlocked = true;
        logger.audio.log('Media-element output playing');
      },
      (error: unknown) => {
        // Not yet inside a valid gesture — a later gesture retries.
        logger.audio.log('Media-element play deferred:', error);
      },
    );
  }

  get isActive(): boolean {
    return this.element !== null;
  }

  /** Terminal node shared by native and Tone.js master chains. */
  getInput(): AudioNode | null {
    return this.streamDestination;
  }

  dispose(): void {
    this.element?.removeEventListener('pause', this.handlePause);
    this.element?.pause();
    this.element?.remove();
    this.element = null;
    this.streamDestination?.disconnect();
    this.streamDestination = null;
    this.unlocked = false;
  }
}
