/**
 * FakeAdvancedSynthEngine — purpose-built test double that implements
 * the same shape as `AdvancedSynthEngine` with TypeScript catching any
 * drift at compile time. See FakeToneSynthManager.ts for rationale.
 */
import type * as Tone from 'tone';
import type {
  AdvancedSynthEngine as RealAdvancedSynthEngine,
  AdvancedSynthDiagnostics,
} from '../advancedSynth';

interface PlayNoteSemitoneCall {
  semitone: number;
  duration: number | string;
  time?: number;
  volume: number;
}

interface PlayNoteCall {
  note: string;
  duration: number | string;
  time?: number;
}

type AdvancedSynthEngineSurface = Pick<
  RealAdvancedSynthEngine,
  | 'initialize'
  | 'getOutput'
  | 'isReady'
  | 'setPreset'
  | 'playNote'
  | 'playNoteSemitone'
  | 'getDiagnostics'
  | 'getPresetNames'
  | 'setFilterFrequency'
  | 'setFilterResonance'
  | 'setLfoRate'
  | 'setLfoAmount'
  | 'setAttack'
  | 'setRelease'
  | 'setOscMix'
  | 'dispose'
>;

/** Minimal duck-type for the parts of Tone.Gain that callers actually touch. */
interface FakeOutputNode {
  connect: (...args: unknown[]) => void;
  disconnect: (...args: unknown[]) => void;
}

export class FakeAdvancedSynthEngine implements AdvancedSynthEngineSurface {
  private ready = false;
  private currentPreset: string | null = null;

  /**
   * Cast to `Tone.Gain` because that's what the real `getOutput()`
   * returns. Tests only care about `.connect()` / `.disconnect()`,
   * so the duck-type is sufficient at runtime.
   */
  readonly fakeOutput: FakeOutputNode = {
    connect: () => {},
    disconnect: () => {},
  };

  readonly playNoteCalls: PlayNoteCall[] = [];
  readonly playNoteSemitoneCalls: PlayNoteSemitoneCall[] = [];
  readonly setPresetCalls: string[] = [];
  readonly setFilterFrequencyCalls: number[] = [];
  readonly setFilterResonanceCalls: number[] = [];
  readonly setLfoRateCalls: number[] = [];
  readonly setLfoAmountCalls: number[] = [];
  readonly setAttackCalls: number[] = [];
  readonly setReleaseCalls: number[] = [];
  readonly setOscMixCalls: number[] = [];
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

  setPreset(presetId: string): void {
    this.currentPreset = presetId;
    this.setPresetCalls.push(presetId);
  }

  // The real signature: playNote(note, duration, time?) — no volume param.
  playNote(note: string, duration: number | string, time?: number): void {
    this.playNoteCalls.push({ note, duration, time });
  }

  // The real signature: playNoteSemitone(semitone, duration, time?, volume = 1)
  playNoteSemitone(
    semitone: number,
    duration: number | string,
    time?: number,
    volume: number = 1,
  ): void {
    this.playNoteSemitoneCalls.push({ semitone, duration, time, volume });
  }

  getDiagnostics(): AdvancedSynthDiagnostics {
    return {
      ready: this.ready,
      voiceCount: 8,
      activeVoices: 0,
      outputConnected: true,
      currentPreset: this.currentPreset,
      lastPlayAttempt: 0,
      lastSuccessfulPlay: 0,
      playAttempts: 0,
      playSuccesses: 0,
      playFailures: 0,
      failureReasons: [],
      toneContextState: 'running',
      toneContextSampleRate: 48000,
    };
  }

  getPresetNames(): string[] {
    return ['supersaw'];
  }

  setFilterFrequency(hz: number): void { this.setFilterFrequencyCalls.push(hz); }
  setFilterResonance(q: number): void { this.setFilterResonanceCalls.push(q); }
  setLfoRate(hz: number): void { this.setLfoRateCalls.push(hz); }
  setLfoAmount(amount: number): void { this.setLfoAmountCalls.push(amount); }
  setAttack(seconds: number): void { this.setAttackCalls.push(seconds); }
  setRelease(seconds: number): void { this.setReleaseCalls.push(seconds); }
  setOscMix(mix: number): void { this.setOscMixCalls.push(mix); }

  dispose(): void {
    this.disposed = true;
    this.ready = false;
  }

  reset(): void {
    this.playNoteCalls.length = 0;
    this.playNoteSemitoneCalls.length = 0;
    this.setPresetCalls.length = 0;
    this.setFilterFrequencyCalls.length = 0;
    this.setFilterResonanceCalls.length = 0;
    this.setLfoRateCalls.length = 0;
    this.setLfoAmountCalls.length = 0;
    this.setAttackCalls.length = 0;
    this.setReleaseCalls.length = 0;
    this.setOscMixCalls.length = 0;
    this.disposed = false;
    this.currentPreset = null;
    this.ready = false;
  }
}

// Compile-time check: this assignment fails to type-check if the fake's
// public surface drifts from `AdvancedSynthEngineSurface`.
const _surfaceCheck: AdvancedSynthEngineSurface = new FakeAdvancedSynthEngine();
void _surfaceCheck;
