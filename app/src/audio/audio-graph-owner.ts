import {
  MediaElementOutput,
  needsMediaElementOutput,
  type MediaOutputRoute,
} from './mobile-media-output';

export type AudioOutputKind = 'direct' | 'media-element';

interface AudioGraphOwnerOptions {
  shouldUseMediaElement?: () => boolean;
  createMediaElementOutput?: () => MediaOutputRoute;
}

/**
 * Owns the one terminal for an AudioEngine runtime generation.
 *
 * Every native and Tone graph ends at `terminal`; only this owner decides how
 * that terminal reaches the user. Generation checks prevent delayed async
 * initialization from connecting nodes into a replacement runtime.
 */
export class AudioGraphOwner {
  private readonly terminal: GainNode;
  private readonly context: AudioContext;
  private readonly generation: number;
  private mediaOutput: MediaOutputRoute | null = null;
  private disposed = false;
  readonly kind: AudioOutputKind;

  constructor(
    context: AudioContext,
    generation: number,
    options: AudioGraphOwnerOptions = {},
  ) {
    this.context = context;
    this.generation = generation;
    this.terminal = context.createGain();
    this.terminal.gain.value = 1;

    const shouldUseMediaElement = options.shouldUseMediaElement ?? needsMediaElementOutput;
    const createMediaElementOutput = options.createMediaElementOutput
      ?? (() => new MediaElementOutput());

    if (shouldUseMediaElement()) {
      const mediaOutput = createMediaElementOutput();
      if (mediaOutput.connect(this.terminal, context)) {
        this.mediaOutput = mediaOutput;
        this.kind = 'media-element';
        return;
      }
      mediaOutput.dispose();
    }

    this.terminal.connect(context.destination);
    this.kind = 'direct';
  }

  getOutputInput(generation: number): AudioNode {
    this.assertCurrent(generation);
    return this.terminal;
  }

  connect(source: AudioNode, generation: number): void {
    source.connect(this.getOutputInput(generation));
  }

  assertCurrent(generation: number): void {
    if (this.disposed) throw new Error('Audio graph has been disposed');
    if (generation !== this.generation) {
      throw new Error(
        `Stale audio graph generation ${generation}; current generation is ${this.generation}`,
      );
    }
    if (this.context.state === 'closed') {
      throw new Error('Audio graph context is closed');
    }
  }

  unlock(): void {
    if (this.disposed) return;
    this.mediaOutput?.unlock();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.mediaOutput?.dispose();
    this.mediaOutput = null;
    this.terminal.disconnect();
  }
}
