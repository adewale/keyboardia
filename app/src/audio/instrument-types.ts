/**
 * Instrument Type Utilities - Phase 23
 *
 * Centralized module for parsing and identifying instrument types from sampleId.
 *
 * Track sampleId formats:
 * - synth:lead      - Web Audio synth presets (lead, pad, bass, etc.)
 * - synth:piano     - Sampled instruments accessed via synth namespace
 * - tone:fm-epiano  - Tone.js synths (FM, AM, etc.)
 * - advanced:supersaw - Advanced dual-oscillator synths
 * - sampled:piano   - Explicit sampled instrument namespace
 * - kick, snare     - Plain samples (no prefix)
 * - recording-123   - User recordings
 *
 * This module provides a single source of truth for parsing these formats.
 */

import {
  isQuarantinedSampledInstrument,
  isSampledInstrument,
  type QuarantinedSampledInstrumentId,
  type SampledInstrumentId,
} from './sampled-instrument';

/**
 * Instrument type categories
 */
export type InstrumentType =
  | 'synth'      // Web Audio synth (synth:lead, synth:pad)
  | 'sampled'    // Sampled instrument (synth:piano, sampled:piano)
  | 'tone'       // Tone.js synth (tone:fm-epiano)
  | 'advanced'   // Advanced synth (advanced:supersaw)
  | 'sample';    // Plain sample (kick, snare, recording-*)

/**
 * Parsed instrument info from sampleId
 */
export interface InstrumentInfo {
  type: InstrumentType;
  presetId: string;      // The preset/instrument ID without prefix
  originalId: string;    // Original sampleId
}

/**
 * Deliberately absent: `isMelodicInstrument`.
 *
 * This module used to carry that field and a matching exported helper, both
 * derived from the engine prefix. The prefix cannot answer the question — it
 * says which synthesis path renders a sound, not whether the sound has a
 * pitch. `sampled:` and `tone:` each contain both drums and pitched
 * instruments, and the procedural presets have no prefix at all, so the field
 * disagreed with the catalogue on 24 of its 99 ids: 16 drums reported melodic
 * (every 808 and acoustic kit piece, every Tone membrane and metal drum) and 8
 * pitched instruments reported percussive (bass, subbass, lead, pluck, pad,
 * chord, zap, noise).
 *
 * It survived because nothing outside its own tests ever read it — every
 * production caller of parseInstrumentId destructures `type` and `presetId`
 * only — so the 14 assertions covering it were describing a decision no user
 * could reach.
 *
 * Ask `isDrumInstrument` from shared/instrument-classification.ts instead. It
 * is a catalogue of ids rather than a guess from a prefix, it lives in shared/
 * so the worker can use it too, and it is the single answer to this question.
 */

/**
 * Parse a sampleId into its component parts.
 *
 * @example
 * parseInstrumentId('synth:piano') // { type: 'sampled', presetId: 'piano', ... }
 * parseInstrumentId('synth:lead')  // { type: 'synth', presetId: 'lead', ... }
 * parseInstrumentId('tone:fm-epiano') // { type: 'tone', presetId: 'fm-epiano', ... }
 * parseInstrumentId('kick')        // { type: 'sample', presetId: 'kick', ... }
 */
export function parseInstrumentId(sampleId: string): InstrumentInfo {
  // Check synth: prefix (can be synth preset OR sampled instrument)
  if (sampleId.startsWith('synth:')) {
    const presetId = sampleId.slice(6); // Remove 'synth:'

    // Check if this is actually a sampled instrument masquerading as synth
    if (isSampledInstrument(presetId) || isQuarantinedSampledInstrument(presetId)) {
      return {
        type: 'sampled',
        presetId,
        originalId: sampleId,
      };
    }

    return {
      type: 'synth',
      presetId,
      originalId: sampleId,
    };
  }

  // Check sampled: prefix (explicit sampled instrument namespace)
  if (sampleId.startsWith('sampled:')) {
    const presetId = sampleId.slice(8); // Remove 'sampled:'
    return {
      type: 'sampled',
      presetId,
      originalId: sampleId,
    };
  }

  // Check tone: prefix (Tone.js synths)
  if (sampleId.startsWith('tone:')) {
    const presetId = sampleId.slice(5); // Remove 'tone:'
    return {
      type: 'tone',
      presetId,
      originalId: sampleId,
    };
  }

  // Check advanced: prefix (advanced dual-oscillator synths)
  if (sampleId.startsWith('advanced:')) {
    const presetId = sampleId.slice(9); // Remove 'advanced:'
    return {
      type: 'advanced',
      presetId,
      originalId: sampleId,
    };
  }

  // No prefix - plain sample
  return {
    type: 'sample',
    presetId: sampleId,
    originalId: sampleId,
  };
}

/**
 * Check if a sampleId requires Tone.js
 * (tone: or advanced: presets)
 */
export function requiresToneJs(sampleId: string): boolean {
  const { type } = parseInstrumentId(sampleId);
  return type === 'tone' || type === 'advanced';
}

/**
 * Get the sampled instrument ID if applicable, or null
 */
export function getSampledInstrumentId(sampleId: string): SampledInstrumentId | QuarantinedSampledInstrumentId | null {
  const info = parseInstrumentId(sampleId);
  if (info.type === 'sampled'
      && (isSampledInstrument(info.presetId) || isQuarantinedSampledInstrument(info.presetId))) {
    return info.presetId as SampledInstrumentId | QuarantinedSampledInstrumentId;
  }
  return null;
}

/**
 * Collect sampled instruments from a list of tracks.
 * Used for preloading before playback.
 *
 * @example
 * const tracks = [{ sampleId: 'synth:piano' }, { sampleId: 'kick' }];
 * collectSampledInstruments(tracks); // Set(['piano'])
 */
export function collectSampledInstruments(tracks: { sampleId: string }[]): Set<string> {
  const instruments = new Set<string>();

  for (const track of tracks) {
    const instrumentId = getSampledInstrumentId(track.sampleId);
    if (instrumentId) {
      instruments.add(instrumentId);
    }
  }

  return instruments;
}
