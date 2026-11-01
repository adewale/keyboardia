export type AudioRuntimeStage = 'starting' | 'preparing' | 'runtime';

export type AudioRuntimeState =
  | { readonly status: 'locked'; readonly generation: number }
  | { readonly status: 'starting'; readonly generation: number }
  | { readonly status: 'base-ready'; readonly generation: number }
  | {
      readonly status: 'preparing';
      readonly generation: number;
      readonly instruments: readonly string[];
    }
  | {
      readonly status: 'ready';
      readonly generation: number;
      readonly instruments: readonly string[];
    }
  | {
      readonly status: 'failed';
      readonly generation: number;
      readonly stage: AudioRuntimeStage;
      readonly message: string;
    }
  | { readonly status: 'disposed'; readonly generation: number };

type Listener = (state: AudioRuntimeState) => void;

/**
 * Small deterministic state machine for audio startup and preparation.
 * Generation checks make late async completions harmless after disposal.
 */
export class AudioRuntimeReadiness {
  private state: AudioRuntimeState = Object.freeze({ status: 'locked', generation: 0 });
  private readonly listeners = new Set<Listener>();

  getState(): AudioRuntimeState {
    return this.state;
  }

  isCurrent(generation: number): boolean {
    return generation === this.state.generation && this.state.status !== 'disposed';
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  beginStart(): number {
    if (this.state.status === 'starting') return this.state.generation;
    if (
      this.state.status === 'base-ready'
      || this.state.status === 'preparing'
      || this.state.status === 'ready'
    ) {
      return this.state.generation;
    }
    const generation = this.state.generation + 1;
    this.publish(Object.freeze({ status: 'starting', generation }));
    return generation;
  }

  markBaseReady(generation: number): boolean {
    if (!this.isCurrent(generation)) return false;
    this.requireStatus('starting', 'base-ready');
    this.publish(Object.freeze({ status: 'base-ready', generation }));
    return true;
  }

  beginPreparing(generation: number, instruments: readonly string[]): boolean {
    if (!this.isCurrent(generation)) return false;
    if (this.state.status !== 'base-ready' && this.state.status !== 'ready') {
      this.invalidTransition('preparing');
    }
    this.publish(Object.freeze({
      status: 'preparing',
      generation,
      instruments: Object.freeze([...new Set(instruments)].sort()),
    }));
    return true;
  }

  markReady(generation: number): boolean {
    if (!this.isCurrent(generation)) return false;
    if (this.state.status !== 'preparing') this.invalidTransition('ready');
    this.publish(Object.freeze({
      status: 'ready',
      generation,
      instruments: this.state.instruments,
    }));
    return true;
  }

  fail(generation: number, stage: AudioRuntimeStage, error: unknown): boolean {
    if (!this.isCurrent(generation)) return false;
    const message = error instanceof Error ? error.message : String(error);
    this.publish(Object.freeze({ status: 'failed', generation, stage, message }));
    return true;
  }

  dispose(): void {
    this.publish(Object.freeze({
      status: 'disposed',
      generation: this.state.generation + 1,
    }));
    this.listeners.clear();
  }

  private requireStatus(
    expected: AudioRuntimeState['status'],
    target: AudioRuntimeState['status'],
  ): void {
    if (this.state.status !== expected) this.invalidTransition(target);
  }

  private invalidTransition(target: AudioRuntimeState['status']): never {
    throw new Error(`Cannot transition audio runtime from ${this.state.status} to ${target}`);
  }

  private publish(next: AudioRuntimeState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}
