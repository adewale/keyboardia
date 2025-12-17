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

import { isSampledInstrument, type SampledInstrumentId } from './sampled-instrument';

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
  isMelodicInstrument: boolean;  // true if pitch can be adjusted musically
}

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
    if (isSampledInstrument(presetId)) {
      return {
        type: 'sampled',
        presetId,
        originalId: sampleId,
        isMelodicInstrument: true,
      };
    }

    return {
      type: 'synth',
      presetId,
      originalId: sampleId,
      isMelodicInstrument: true,
    };
  }

  // Check sampled: prefix (explicit sampled instrument namespace)
  if (sampleId.startsWith('sampled:')) {
    const presetId = sampleId.slice(8); // Remove 'sampled:'
    return {
      type: 'sampled',
      presetId,
      originalId: sampleId,
      isMelodicInstrument: true,
    };
  }

  // Check tone: prefix (Tone.js synths)
  if (sampleId.startsWith('tone:')) {
    const presetId = sampleId.slice(5); // Remove 'tone:'
    return {
      type: 'tone',
      presetId,
      originalId: sampleId,
      isMelodicInstrument: true,
    };
  }

  // Check advanced: prefix (advanced dual-oscillator synths)
  if (sampleId.startsWith('advanced:')) {
    const presetId = sampleId.slice(9); // Remove 'advanced:'
    return {
      type: 'advanced',
      presetId,
      originalId: sampleId,
      isMelodicInstrument: true,
    };
  }

  // No prefix - plain sample
  return {
    type: 'sample',
    presetId: sampleId,
    originalId: sampleId,
    isMelodicInstrument: false, // Drums/samples generally aren't melodic
  };
}

/**
 * Check if a sampleId refers to any type of melodic instrument
 * (synth, sampled, tone, advanced)
 */
export function isMelodicInstrument(sampleId: string): boolean {
  return parseInstrumentId(sampleId).isMelodicInstrument;
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
export function getSampledInstrumentId(sampleId: string): SampledInstrumentId | null {
  const info = parseInstrumentId(sampleId);
  if (info.type === 'sampled') {
    return info.presetId as SampledInstrumentId;
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
