/**
 * Mobile output routing extracted from PR #98.
 *
 * Mobile Web Audio can follow the physical ringer switch. Routing the final
 * graph through a hidden media element uses the media playback path instead.
 */
import { logger } from '../utils/logger';

/** Detect the operating systems affected by mobile media-output behavior. */
export function needsMediaElementOutput(
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> | undefined =
    typeof navigator === 'undefined' ? undefined : navigator,
): boolean {
  if (!nav) return false;
  if (/iPhone|iPad|iPod|Android/i.test(nav.userAgent)) return true;
  return /Mac/.test(nav.userAgent) && (nav.maxTouchPoints ?? 0) > 2;
}

export interface MediaOutputRoute {
  connect(source: AudioNode, context: AudioContext): boolean;
  unlock(): void;
  dispose(): void;
}

export class MediaElementOutput implements MediaOutputRoute {
  private element: HTMLAudioElement | null = null;
  private streamDestination: MediaStreamAudioDestinationNode | null = null;
  private unlocked = false;
  private readonly handlePause = (): void => {
    this.unlocked = false;
  };

  /** Build the route, or return false so the graph owner can fall back. */
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

  /** Start the media element inside a user gesture. Safe to retry. */
  unlock(): void {
    if (!this.element || this.unlocked) return;
    const playResult = this.element.play();
    void playResult?.then(
      () => {
        this.unlocked = true;
        logger.audio.log('Media-element output playing');
      },
      (error: unknown) => {
        logger.audio.log('Media-element play deferred:', error);
      },
    );
  }

  get isActive(): boolean {
    return this.element !== null;
  }

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
