/**
 * FakeToneSynthManager — a purpose-built test double that implements
 * the same shape as the real `ToneSynthManager` so TypeScript catches
 * drift between the fake and the real class at compile time.
 *
 * Exposes simple instance state and call recorders so tests can assert
 * on observable behaviour (which methods were called, with what args)
 * without reaching for `vi.mock`.
 *
 * If a method on the real class is renamed, this file fails to compile.
 * That's the whole point — the runtime mock-fidelity test (now deleted)
 * is replaced by static type checking.
 */
import type * as Tone from 'tone';
import type { ToneSynthManager as RealToneSynthManager, ToneSynthType } from '../toneSynths';

interface PlayNoteCall {
  presetName: string;
  note: string | number;
  duration: string | number;
  time: number;
  volume: number;
}

/**
 * Compile-time guard: this type alias is the structural shape of
 * `ToneSynthManager` as seen by callers. If a real-class method is
 * renamed or removed, the line below fails type-check.
 */
type ToneSynthManagerSurface = Pick<
  RealToneSynthManager,
  | 'initialize'
  | 'getOutput'
  | 'isReady'
  | 'playNote'
  | 'playNoteSemitone'
  | 'semitoneToNoteName'
  | 'getPresetNames'
  | 'setFMParams'
  | 'getFMParams'
  | 'dispose'
>;

interface FakeOutputNode {
  connect: (...args: unknown[]) => void;
  disconnect: (...args: unknown[]) => void;
}

export class FakeToneSynthManager implements ToneSynthManagerSurface {
  private ready = false;
  private fmParams: { harmonicity: number; modulationIndex: number } | null = null;

  /**
   * Public output node — duck-typed since callers only need
   * connect/disconnect. Cast to `Tone.Gain` at the boundary so the fake
   * conforms to the real surface.
   */
  readonly fakeOutput: FakeOutputNode = {
    connect: () => {},
    disconnect: () => {},
  };

  /** Recorder for playNote / playNoteSemitone calls. Tests assert on this. */
  readonly playNoteCalls: PlayNoteCall[] = [];
  readonly setFMParamsCalls: Array<{ harmonicity: number; modulationIndex: number }> = [];
  /** Set to true after `dispose()` has been called. */
  disposed = false;

  async initialize(): Promise<void> {
    this.ready = true;
  }

  getOutput(): Tone.Gain | null {
    return this.fakeOutput as unknown as Tone.Gain;
  }

  isReady(): boolean {
    return this.ready;
  }

  playNote(
    presetName: ToneSynthType,
    note: string | number,
    duration: string | number = '8n',
    time: number = 0,
    volume: number = 1,
  ): void {
    this.playNoteCalls.push({ presetName, note, duration, time, volume });
  }

  playNoteSemitone(
    presetName: ToneSynthType,
    semitone: number,
    duration: string | number = '8n',
    time: number = 0,
    volume: number = 1,
  ): void {
    this.playNote(presetName, this.semitoneToNoteName(semitone), duration, time, volume);
  }

  semitoneToNoteName(semitone: number): string {
    return `note-${semitone}`;
  }

  getPresetNames(): ToneSynthType[] {
    return ['fm-bass' as ToneSynthType];
  }

  setFMParams(harmonicity: number, modulationIndex: number): void {
    this.fmParams = { harmonicity, modulationIndex };
    this.setFMParamsCalls.push({ harmonicity, modulationIndex });
  }

  getFMParams(): { harmonicity: number; modulationIndex: number } | null {
    return this.fmParams;
  }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
  }

  // ── Test helpers (not part of the real class's surface) ──────────────
  // Anything below here is fake-only convenience; nothing in production
  // code can read these fields because the surface above is what the
  // type system exposes.

  reset(): void {
    this.playNoteCalls.length = 0;
    this.setFMParamsCalls.length = 0;
    this.disposed = false;
    this.fmParams = null;
    this.ready = false;
  }
}

/**
 * Compile-time check: assigning `FakeToneSynthManager` to the surface
 * type fails if any required method is missing or has a different
 * signature. Equivalent to a runtime mock-fidelity test, only stricter.
 */
const _surfaceCheck: ToneSynthManagerSurface = new FakeToneSynthManager();
void _surfaceCheck;
