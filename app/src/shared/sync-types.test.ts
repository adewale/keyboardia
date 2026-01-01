/**
 * Shared Sync Types Tests
 *
 * Verifies that the canonical type definitions in sync-types.ts
 * are correctly importable and usable from both frontend and worker contexts.
 */

import { describe, it, expect } from 'vitest';
import type {
  ParameterLock,
  FMParams,
  EffectsState,
} from './sync-types';

// Also import from the re-export locations to verify they work
import type {
  ParameterLock as FrontendParameterLock,
  FMParams as FrontendFMParams,
  EffectsState as FrontendEffectsState,
} from '../types';

import type {
  ParameterLock as WorkerParameterLock,
  FMParams as WorkerFMParams,
  EffectsState as WorkerEffectsState,
} from '../worker/types';

// ============================================================================
// Compile-time type parity checks
// ============================================================================
// These assignments will fail at compile time if types drift apart

// ParameterLock parity
const _plockFrontend: FrontendParameterLock = {} as ParameterLock;
const _plockWorker: WorkerParameterLock = {} as ParameterLock;
const _plockShared: ParameterLock = {} as FrontendParameterLock;

// FMParams parity
const _fmFrontend: FrontendFMParams = { harmonicity: 1, modulationIndex: 1 } as FMParams;
const _fmWorker: WorkerFMParams = { harmonicity: 1, modulationIndex: 1 } as FMParams;
const _fmShared: FMParams = { harmonicity: 1, modulationIndex: 1 } as FrontendFMParams;

// EffectsState parity
const _effectsFrontend: FrontendEffectsState = {
  reverb: { decay: 1, wet: 0.5 },
  delay: { time: '8n', feedback: 0.5, wet: 0.5 },
  chorus: { frequency: 1, depth: 0.5, wet: 0.5 },
  distortion: { amount: 0.5, wet: 0.5 },
} as EffectsState;
const _effectsWorker: WorkerEffectsState = _effectsFrontend as EffectsState;
const _effectsShared: EffectsState = _effectsFrontend as FrontendEffectsState;

// Suppress unused variable warnings
void _plockFrontend;
void _plockWorker;
void _plockShared;
void _fmFrontend;
void _fmWorker;
void _fmShared;
void _effectsFrontend;
void _effectsWorker;
void _effectsShared;

// ============================================================================
// Runtime tests
// ============================================================================

describe('Shared Sync Types', () => {
  describe('ParameterLock', () => {
    it('should allow empty parameter lock', () => {
      const empty: ParameterLock = {};
      expect(empty).toEqual({});
    });

    it('should allow pitch-only parameter lock', () => {
      const pitchOnly: ParameterLock = { pitch: 12 };
      expect(pitchOnly.pitch).toBe(12);
      expect(pitchOnly.volume).toBeUndefined();
    });

    it('should allow volume-only parameter lock', () => {
      const volumeOnly: ParameterLock = { volume: 0.5 };
      expect(volumeOnly.volume).toBe(0.5);
      expect(volumeOnly.pitch).toBeUndefined();
    });

    it('should allow full parameter lock', () => {
      const full: ParameterLock = { pitch: -7, volume: 0.8 };
      expect(full.pitch).toBe(-7);
      expect(full.volume).toBe(0.8);
    });

    // Phase 29B: Tie tests
    it('should allow tie-only parameter lock', () => {
      const tieOnly: ParameterLock = { tie: true };
      expect(tieOnly.tie).toBe(true);
      expect(tieOnly.pitch).toBeUndefined();
      expect(tieOnly.volume).toBeUndefined();
    });

    it('should allow tie with pitch', () => {
      const tiePitch: ParameterLock = { pitch: 5, tie: true };
      expect(tiePitch.pitch).toBe(5);
      expect(tiePitch.tie).toBe(true);
    });

    it('should allow full parameter lock with tie', () => {
      const full: ParameterLock = { pitch: -7, volume: 0.8, tie: true };
      expect(full.pitch).toBe(-7);
      expect(full.volume).toBe(0.8);
      expect(full.tie).toBe(true);
    });
  });

  describe('FMParams', () => {
    it('should require both harmonicity and modulationIndex', () => {
      const fm: FMParams = { harmonicity: 2.5, modulationIndex: 5 };
      expect(fm.harmonicity).toBe(2.5);
      expect(fm.modulationIndex).toBe(5);
    });
  });

  describe('EffectsState', () => {
    it('should have all required effect sections', () => {
      const effects: EffectsState = {
        reverb: { decay: 2.5, wet: 0.3 },
        delay: { time: '4n', feedback: 0.4, wet: 0.2 },
        chorus: { frequency: 2, depth: 0.6, wet: 0.25 },
        distortion: { amount: 0.1, wet: 0.15 },
      };

      expect(effects.reverb.decay).toBe(2.5);
      expect(effects.reverb.wet).toBe(0.3);
      expect(effects.delay.time).toBe('4n');
      expect(effects.delay.feedback).toBe(0.4);
      expect(effects.delay.wet).toBe(0.2);
      expect(effects.chorus.frequency).toBe(2);
      expect(effects.chorus.depth).toBe(0.6);
      expect(effects.chorus.wet).toBe(0.25);
      expect(effects.distortion.amount).toBe(0.1);
      expect(effects.distortion.wet).toBe(0.15);
    });
  });
});
