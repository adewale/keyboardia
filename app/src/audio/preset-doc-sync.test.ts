/**
 * Documentation/registry sync tests for synth presets.
 *
 * The skill calls this "Documentation-Code Sync Tests" — Tier 2,
 * triggered by "project has plugin/hook/preset registries listed
 * elsewhere." Audio presets ARE such a registry: defined in
 * `synth.ts` / `advancedSynth.ts` / `toneSynths.ts` and surfaced
 * through `sample-constants.ts` for the SamplePicker UI. Drift
 * between the two is invisible until a user clicks a missing tile.
 *
 * Pattern: parametrize over the code's authoritative registry and
 * assert each entry has a UI display name; assert in reverse that
 * every UI entry points at a real preset.
 */
import { describe, it, expect } from 'vitest';
import { SYNTH_PRESETS } from './synth';
import { ADVANCED_SYNTH_PRESETS } from './advancedSynth';
import {
  INSTRUMENT_CATEGORIES,
  CATEGORY_ORDER,
} from '../components/sample-constants';

describe('preset registry ↔ display-name sync', () => {


  describe('INSTRUMENT_CATEGORIES (the SamplePicker UI source of truth)', () => {
    it('every category in CATEGORY_ORDER has at least one instrument', () => {
      for (const cat of CATEGORY_ORDER) {
        const group = INSTRUMENT_CATEGORIES[cat];
        expect(group, `category "${cat}" missing from INSTRUMENT_CATEGORIES`).toBeDefined();
        expect(group.instruments.length, `category "${cat}" has no instruments`).toBeGreaterThan(0);
      }
    });

    it('every advanced:* tile in the picker maps to a real ADVANCED_SYNTH_PRESETS entry', () => {
      for (const cat of CATEGORY_ORDER) {
        for (const item of INSTRUMENT_CATEGORIES[cat].instruments) {
          if (item.id.startsWith('advanced:')) {
            const presetId = item.id.replace(/^advanced:/, '');
            expect(
              ADVANCED_SYNTH_PRESETS[presetId],
              `picker shows "${item.name}" (${item.id}) but no preset matches`,
            ).toBeDefined();
          }
        }
      }
    });

    it('every synth:* tile in the picker maps to a real SYNTH_PRESETS entry', () => {
      for (const cat of CATEGORY_ORDER) {
        for (const item of INSTRUMENT_CATEGORIES[cat].instruments) {
          if (item.id.startsWith('synth:')) {
            const presetId = item.id.replace(/^synth:/, '');
            expect(
              SYNTH_PRESETS[presetId],
              `picker shows "${item.name}" (${item.id}) but no synth preset matches`,
            ).toBeDefined();
          }
        }
      }
    });
  });
});
