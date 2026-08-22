/**
 * Tone.js Advanced Synths Integration
 *
 * This module provides Tone.js synthesizers for advanced sound design,
 * following the spec in specs/SYNTHESIS-ENGINE.md
 *
 * Synth Types:
 * - FMSynth: Frequency modulation (DX7-style electric piano, bells)
 * - AMSynth: Amplitude modulation (tremolo-rich sounds)
 * - MembraneSynth: Drum synthesis (kicks, toms)
 * - MetalSynth: Metallic percussion (hi-hats, cymbals)
 * - PluckSynth: Karplus-Strong (plucked strings)
 * - DuoSynth: Two parallel synths (rich leads)
 */

import * as Tone from 'tone';
import { logger } from '../utils/logger';
import { parseInstrumentId } from './instrument-types';
import { NOTE_NAMES } from '../music/music-theory';
import { TONE_SOURCE_GAIN_DB, dbToGain } from './source-calibration';
import type { TrackEnvelope } from '../shared/sync-types';
import { clampTrackEnvelope, DEFAULT_TRACK_ENVELOPE } from '../shared/envelope';

/**
 * Synth type identifiers used in sample IDs
 * Format: "tone:{type}" e.g., "tone:fm-epiano"
 */
export type ToneSynthType =
  | 'fm-epiano'
  | 'fm-bass'
  | 'fm-bell'
  | 'am-bell'
  | 'am-tremolo'
  | 'membrane-kick'
  | 'membrane-tom'
  | 'metal-cymbal'
  | 'metal-hihat'
  | 'pluck-string'
  | 'duo-lead';

/**
 * Base synth types in Tone.js
 */
type BaseSynthType = 'fm' | 'am' | 'membrane' | 'metal' | 'pluck' | 'duo';

/**
 * Preset configuration for advanced synths
 */
export interface ToneSynthPreset {
  type: BaseSynthType;
  config: Record<string, unknown>;
}

/**
 * Preset definitions for advanced synths
 * Based on classic synthesizer sounds (DX7, 808, etc.)
 */
export const TONE_SYNTH_PRESETS: Record<ToneSynthType, ToneSynthPreset> = {
  // FM Synths (DX7-style)
  'fm-epiano': {
    type: 'fm',
    config: {
      harmonicity: 3.01,
      modulationIndex: 14,
      envelope: {
        attack: 0.01,
        decay: 0.3,
        sustain: 0.2,
        release: 0.8,
      },
      modulation: {
        type: 'square',
      },
      modulationEnvelope: {
        attack: 0.01,
        decay: 0.4,
        sustain: 0.3,
        release: 0.8,
      },
    },
  },
  'fm-bass': {
    type: 'fm',
    config: {
      harmonicity: 2,
      modulationIndex: 8,
      envelope: {
        attack: 0.01,
        decay: 0.2,
        sustain: 0.4,
        release: 0.3,
      },
      modulation: {
        type: 'sine',
      },
    },
  },
  'fm-bell': {
    type: 'fm',
    config: {
      harmonicity: 5.01,
      modulationIndex: 20,
      envelope: {
        attack: 0.001,
        decay: 2,
        sustain: 0,
        release: 2,
      },
    },
  },

  // AM Synths
  'am-bell': {
    type: 'am',
    config: {
      harmonicity: 3.5,
      envelope: {
        attack: 0.001,
        decay: 1.5,
        sustain: 0,
        release: 1.5,
      },
    },
  },
  'am-tremolo': {
    type: 'am',
    config: {
      harmonicity: 1,
      envelope: {
        attack: 0.1,
        decay: 0.12,
        sustain: 0.8,
        release: 0.5,
      },
    },
  },

  // Membrane Synths (drum synthesis)
  'membrane-kick': {
    type: 'membrane',
    config: {
      pitchDecay: 0.05,
      octaves: 8,
      envelope: {
        attack: 0.001,
        decay: 0.4,
        sustain: 0.01,
        release: 1.4,
      },
    },
  },
  'membrane-tom': {
    type: 'membrane',
    config: {
      pitchDecay: 0.08,
      octaves: 4,
      envelope: {
        attack: 0.001,
        decay: 0.3,
        sustain: 0.02,
        release: 0.8,
      },
    },
  },

  // Metal Synths (cymbal synthesis)
  'metal-cymbal': {
    type: 'metal',
    config: {
      frequency: 200,
      harmonicity: 5.1,
      modulationIndex: 32,
      resonance: 4000,
      octaves: 1.5,
      envelope: {
        attack: 0.001,
        decay: 1.2,
        release: 0.8,
      },
    },
  },
  'metal-hihat': {
    type: 'metal',
    config: {
      frequency: 250,
      harmonicity: 5.1,
      modulationIndex: 40,
      resonance: 5000,
      octaves: 1,
      envelope: {
        attack: 0.001,
        decay: 0.1,
        release: 0.1,
      },
    },
  },

  // Pluck Synth (Karplus-Strong)
  'pluck-string': {
    type: 'pluck',
    config: {
      attackNoise: 1,
      dampening: 4000,
      resonance: 0.98,
    },
  },

  // Duo Synth (rich leads)
  'duo-lead': {
    type: 'duo',
    config: {
      harmonicity: 1.5,
      vibratoAmount: 0.5,
      vibratoRate: 5,
      voice0: {
        portamento: 0,
        oscillator: { type: 'sawtooth' },
        filterEnvelope: {
          attack: 0.01,
          decay: 0.2,
          sustain: 0.4,
          release: 0.5,
        },
        envelope: {
          attack: 0.01,
          decay: 0.2,
          sustain: 0.5,
          release: 0.5,
        },
      },
      voice1: {
        portamento: 0,
        oscillator: { type: 'square' },
        filterEnvelope: {
          attack: 0.01,
          decay: 0.2,
          sustain: 0.4,
          release: 0.5,
        },
        envelope: {
          attack: 0.01,
          decay: 0.2,
          sustain: 0.5,
          release: 0.5,
        },
      },
    },
  },
};

// NOTE_NAMES imported from ../music/music-theory (canonical source)

/**
 * ToneSynthManager - Manages Tone.js synthesizers
 *
 * Features:
 * - Lazy initialization of synth instances
 * - Proper cleanup on disposal
 * - Semitone to frequency/note conversion
 */
export class ToneSynthManager {
  private synths: Map<BaseSynthType, Tone.FMSynth | Tone.AMSynth | Tone.MembraneSynth | Tone.MetalSynth | Tone.PluckSynth | Tone.DuoSynth> = new Map();
  private output: Tone.Gain | null = null;
  private sourceGains: Map<BaseSynthType, Tone.Gain> = new Map();
  private pluckEnvelope: Tone.AmplitudeEnvelope | null = null;
  private activePresets: Map<BaseSynthType, ToneSynthType> = new Map();
  private fmOverride: { harmonicity: number; modulationIndex: number } | null = null;
  private envelopeOverride: TrackEnvelope | null = null;
  private appliedEnvelopeSignatures = new Map<BaseSynthType, string>();
  private ready = false;
  // Track last scheduled time per synth to prevent "time must be greater than previous" errors
  private lastScheduledTime: Map<BaseSynthType, number> = new Map();

  /**
   * Initialize the synth manager
   */
  async initialize(): Promise<void> {
    if (this.ready) return;

    logger.audio.log('Initializing ToneSynthManager...');

    // Create output gain node
    this.output = new Tone.Gain(1);

    this.ready = true;
    logger.audio.log('ToneSynthManager initialized');
  }

  /**
   * Get the output node for connecting to effects
   */
  getOutput(): Tone.Gain | null {
    return this.output;
  }

  /**
   * Check if manager is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Get or create a synth instance for the given type
   */
  private getSynth(type: BaseSynthType): Tone.FMSynth | Tone.AMSynth | Tone.MembraneSynth | Tone.MetalSynth | Tone.PluckSynth | Tone.DuoSynth {
    let synth = this.synths.get(type);

    if (!synth) {
      synth = this.createSynth(type);
      if (this.output) {
        const sourceGain = new Tone.Gain(1);
        synth.connect(sourceGain);
        this.sourceGains.set(type, sourceGain);
        if (type === 'pluck') {
          this.pluckEnvelope = new Tone.AmplitudeEnvelope({
            ...DEFAULT_TRACK_ENVELOPE,
            attackCurve: 'linear',
            decayCurve: 'linear',
            releaseCurve: 'exponential',
          });
          sourceGain.connect(this.pluckEnvelope);
          this.pluckEnvelope.connect(this.output);
        } else {
          sourceGain.connect(this.output);
        }
      }
      this.synths.set(type, synth);
    }

    return synth;
  }

  /**
   * Create a new synth instance
   */
  private createSynth(type: BaseSynthType): Tone.FMSynth | Tone.AMSynth | Tone.MembraneSynth | Tone.MetalSynth | Tone.PluckSynth | Tone.DuoSynth {
    switch (type) {
      case 'fm':
        return new Tone.FMSynth();
      case 'am':
        return new Tone.AMSynth();
      case 'membrane':
        return new Tone.MembraneSynth();
      case 'metal':
        return new Tone.MetalSynth();
      case 'pluck':
        return new Tone.PluckSynth();
      case 'duo':
        return new Tone.DuoSynth();
      default:
        throw new Error(`Unknown synth type: ${type}`);
    }
  }

  private configWithEnvelope(
    preset: ToneSynthPreset,
    noteEnvelope?: TrackEnvelope,
  ): Record<string, unknown> {
    const envelope = noteEnvelope ?? this.envelopeOverride;
    if (!envelope || preset.type === 'pluck') return preset.config;
    const value = clampTrackEnvelope(envelope);
    const canonical = {
      ...value,
      attackCurve: 'linear',
      decayCurve: 'linear',
      releaseCurve: 'exponential',
    };
    if (preset.type === 'duo') {
      const voice0 = (preset.config.voice0 ?? {}) as Record<string, unknown>;
      const voice1 = (preset.config.voice1 ?? {}) as Record<string, unknown>;
      return {
        ...preset.config,
        voice0: { ...voice0, envelope: canonical },
        voice1: { ...voice1, envelope: canonical },
      };
    }
    return { ...preset.config, envelope: canonical };
  }

  private applyPresetConfig(
    synth: Tone.FMSynth | Tone.AMSynth | Tone.MembraneSynth | Tone.MetalSynth | Tone.PluckSynth | Tone.DuoSynth,
    presetName: ToneSynthType,
    preset: ToneSynthPreset,
    noteEnvelope?: TrackEnvelope,
  ): void {
    const envelope = noteEnvelope ?? this.envelopeOverride;
    const signature = envelope ? JSON.stringify(clampTrackEnvelope(envelope)) : 'preset';
    if (this.activePresets.get(preset.type) === presetName
        && this.appliedEnvelopeSignatures.get(preset.type) === signature) return;

    synth.set(this.configWithEnvelope(preset, envelope ?? undefined));
    this.activePresets.set(preset.type, presetName);
    this.appliedEnvelopeSignatures.set(preset.type, signature);
    if (preset.type === 'fm' && this.fmOverride && synth instanceof Tone.FMSynth) {
      synth.harmonicity.value = this.fmOverride.harmonicity;
      synth.modulationIndex.value = this.fmOverride.modulationIndex;
    }
  }

  /**
   * Play a note with the specified preset
   * @param volume Volume multiplier from P-lock (0-1, default 1)
   */
  playNote(
    presetName: ToneSynthType,
    note: string | number,
    duration: string | number,
    time: number,
    volume: number = 1,
    noteEnvelope?: TrackEnvelope,
  ): void {
    if (!this.ready) {
      logger.audio.warn('ToneSynthManager not ready');
      return;
    }

    const preset = TONE_SYNTH_PRESETS[presetName];
    if (!preset) {
      throw new Error(`Unknown preset: ${presetName}`);
    }

    const synth = this.getSynth(preset.type);
    const sourceGain = this.sourceGains.get(preset.type);

    // Presets describe instrument changes, not note events. Reapplying on every
    // note erased live FM controls immediately before the attack.
    this.applyPresetConfig(synth, presetName, preset, noteEnvelope);

    // Convert note if it's a semitone number
    const noteValue = typeof note === 'number' ? this.semitoneToNoteName(note) : note;

    // Phase 22: Ensure time is always positive and in the future
    // The scheduler passes a relative offset from now, but it can be 0 or negative
    // if audio context time advanced between calculation and playback.
    // Use a minimum of 1ms to ensure Tone.js synths always have valid timing.
    const safeTime = Math.max(0.001, time);
    let startTime = Tone.now() + safeTime;

    // Ensure startTime is strictly greater than the last scheduled time for this synth type
    // This prevents "time must be greater than previous" errors during BPM changes
    const lastTime = this.lastScheduledTime.get(preset.type) ?? 0;
    if (startTime <= lastTime) {
      // Add a small offset to ensure strictly greater time
      startTime = lastTime + 0.001;
    }
    this.lastScheduledTime.set(preset.type, startTime);
    sourceGain?.gain.setValueAtTime(dbToGain(TONE_SOURCE_GAIN_DB[presetName]), startTime);

    // PluckSynth doesn't have triggerAttackRelease
    // Use try-catch to handle cases where Tone.js internal state rejects the time
    // This can happen during rapid BPM changes where Tone.js's StateTimeline
    // has events scheduled at later times from previous notes' release phases
    // Volume P-lock is passed as velocity (4th param of triggerAttackRelease)
    try {
      if (preset.type === 'pluck') {
        const envelope = clampTrackEnvelope(noteEnvelope ?? this.envelopeOverride ?? DEFAULT_TRACK_ENVELOPE);
        if (this.pluckEnvelope) {
          this.pluckEnvelope.attack = envelope.attack;
          this.pluckEnvelope.decay = envelope.decay;
          this.pluckEnvelope.sustain = envelope.sustain;
          this.pluckEnvelope.release = envelope.release;
          this.pluckEnvelope.attackCurve = 'linear';
          this.pluckEnvelope.decayCurve = 'linear';
          this.pluckEnvelope.releaseCurve = 'exponential';
          this.pluckEnvelope.triggerAttackRelease(duration, startTime, volume);
        }
        (synth as Tone.PluckSynth).triggerAttack(noteValue, startTime);
      } else {
        (synth as Tone.FMSynth | Tone.AMSynth | Tone.MembraneSynth | Tone.MetalSynth | Tone.DuoSynth)
          .triggerAttackRelease(noteValue, duration, startTime, volume);
      }
    } catch (_err) {
      // If Tone.js rejects the time, retry with current time + buffer
      // This gracefully handles edge cases during BPM changes
      const retryTime = Tone.now() + 0.01;
      this.lastScheduledTime.set(preset.type, retryTime);
      logger.audio.warn(`Tone.js timing retry: original=${startTime.toFixed(3)}, retry=${retryTime.toFixed(3)}`);
      try {
        if (preset.type === 'pluck') {
          const envelope = clampTrackEnvelope(noteEnvelope ?? this.envelopeOverride ?? DEFAULT_TRACK_ENVELOPE);
          if (this.pluckEnvelope) {
            this.pluckEnvelope.attack = envelope.attack;
            this.pluckEnvelope.decay = envelope.decay;
            this.pluckEnvelope.sustain = envelope.sustain;
            this.pluckEnvelope.release = envelope.release;
            this.pluckEnvelope.attackCurve = 'linear';
            this.pluckEnvelope.decayCurve = 'linear';
            this.pluckEnvelope.releaseCurve = 'exponential';
            this.pluckEnvelope.triggerAttackRelease(duration, retryTime, volume);
          }
          (synth as Tone.PluckSynth).triggerAttack(noteValue, retryTime);
        } else {
          (synth as Tone.FMSynth | Tone.AMSynth | Tone.MembraneSynth | Tone.MetalSynth | Tone.DuoSynth)
            .triggerAttackRelease(noteValue, duration, retryTime, volume);
        }
      } catch (retryErr) {
        // If retry also fails, log and skip this note
        logger.audio.error('Tone.js timing error - note skipped:', retryErr);
      }
    }
  }

  /**
   * Play a note using semitone offset from C4
   */
  playNoteSemitone(
    presetName: ToneSynthType,
    semitone: number,
    duration: string | number,
    time: number,
    volume: number = 1,
    noteEnvelope?: TrackEnvelope,
  ): void {
    const noteName = this.semitoneToNoteName(semitone);
    this.playNote(presetName, noteName, duration, time, volume, noteEnvelope);
  }

  /**
   * Set FM synthesis parameters for the FM synth
   * This affects all FM presets (fm-epiano, fm-bass, fm-bell) since they share the synth
   * @param harmonicity Frequency ratio between modulator and carrier (0.5-10)
   * @param modulationIndex Intensity of modulation (0-20)
   */
  setFMParams(harmonicity: number, modulationIndex: number): void {
    this.fmOverride = { harmonicity, modulationIndex };
    if (!this.ready) {
      logger.audio.warn('ToneSynthManager not ready for FM params');
      return;
    }

    const synth = this.synths.get('fm');
    if (synth && synth instanceof Tone.FMSynth) {
      synth.harmonicity.value = harmonicity;
      synth.modulationIndex.value = modulationIndex;
      logger.audio.log(`FM params set: harmonicity=${harmonicity}, modIndex=${modulationIndex}`);
    }
  }

  /** Apply or clear the authored per-track amplitude envelope. */
  setEnvelope(envelope: TrackEnvelope | null): void {
    this.envelopeOverride = envelope ? clampTrackEnvelope(envelope) : null;
    this.appliedEnvelopeSignatures.clear();
    for (const [type, synth] of this.synths) {
      const presetName = this.activePresets.get(type);
      if (presetName) this.applyPresetConfig(synth, presetName, TONE_SYNTH_PRESETS[presetName]);
    }
  }

  /**
   * Clear the persisted FM override without replacing the live synth.
   * The active preset values are restored synchronously so a state reset
   * during playback cannot drop the next scheduled note while rebuilding.
   */
  resetFMParams(): void {
    this.fmOverride = null;
    if (!this.ready) return;

    const synth = this.synths.get('fm');
    const presetName = this.activePresets.get('fm');
    if (!(synth instanceof Tone.FMSynth) || !presetName) return;

    const config = TONE_SYNTH_PRESETS[presetName].config;
    if (typeof config.harmonicity === 'number') {
      synth.harmonicity.value = config.harmonicity;
    }
    if (typeof config.modulationIndex === 'number') {
      synth.modulationIndex.value = config.modulationIndex;
    }
  }

  /**
   * Get current FM params from the active FM synth
   */
  getFMParams(): { harmonicity: number; modulationIndex: number } | null {
    if (this.fmOverride) return { ...this.fmOverride };
    const synth = this.synths.get('fm');
    if (synth && synth instanceof Tone.FMSynth) {
      return {
        harmonicity: synth.harmonicity.value,
        modulationIndex: synth.modulationIndex.value,
      };
    }
    return null;
  }

  /**
   * Convert semitone offset from C4 to note name
   * @param semitone Semitone offset (0 = C4, 12 = C5, -12 = C3)
   * @returns Note name like "C4", "F#5", etc.
   */
  semitoneToNoteName(semitone: number): string {
    // C4 is semitone 0
    const baseOctave = 4;
    const baseSemitone = 0; // C

    const absoluteSemitone = semitone + (baseOctave * 12) + baseSemitone;
    const octave = Math.floor(absoluteSemitone / 12);
    const noteIndex = ((absoluteSemitone % 12) + 12) % 12;

    return `${NOTE_NAMES[noteIndex]}${octave}`;
  }

  /**
   * Get available preset names
   */
  getPresetNames(): ToneSynthType[] {
    return Object.keys(TONE_SYNTH_PRESETS) as ToneSynthType[];
  }

  /**
   * Dispose all synth instances
   */
  dispose(): void {
    if (!this.ready) return;

    logger.audio.log('Disposing ToneSynthManager...');

    // Dispose all synth instances
    for (const synth of this.synths.values()) {
      synth.dispose();
    }
    this.synths.clear();
    this.activePresets.clear();
    this.appliedEnvelopeSignatures.clear();
    this.fmOverride = null;
    this.envelopeOverride = null;

    for (const gain of this.sourceGains.values()) {
      gain.dispose();
    }
    this.sourceGains.clear();
    this.pluckEnvelope?.dispose();
    this.pluckEnvelope = null;

    // Dispose output
    this.output?.dispose();
    this.output = null;

    this.ready = false;
    logger.audio.log('ToneSynthManager disposed');
  }
}

// NOTE: Singleton pattern removed in Phase 22.
// Singletons cache Tone.js nodes across HMR (Hot Module Reload), causing
// "cannot connect to an AudioNode belonging to a different audio context" errors.
// Always use `new ToneSynthManager()` to ensure nodes are in the current AudioContext.
// See audio-context-safety.test.ts for comprehensive documentation.

/**
 * Check if a sample ID is a Tone.js synth
 */
export function isToneSynth(sampleId: string): boolean {
  // Use centralized instrument-types.ts utility to avoid namespace inconsistency
  return parseInstrumentId(sampleId).type === 'tone';
}

/**
 * Extract the preset name from a Tone.js synth sample ID
 */
export function getToneSynthPreset(sampleId: string): ToneSynthType | null {
  if (!isToneSynth(sampleId)) return null;
  const preset = sampleId.replace('tone:', '') as ToneSynthType;
  return TONE_SYNTH_PRESETS[preset] ? preset : null;
}
