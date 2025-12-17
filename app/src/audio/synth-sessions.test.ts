import { describe, it, expect } from 'vitest';
import { SYNTH_PRESETS } from './synth';

/**
 * Test sessions for each synth preset.
 * These sessions contain a single track with a simple pattern to verify the synth is audible.
 *
 * To regenerate: npx tsx scripts/create-test-sessions.ts
 */

const BASE_URL = 'https://keyboardia.adewale-883.workers.dev';

export const SYNTH_TEST_SESSIONS: Record<string, string> = {
  // Core
  bass: '/s/e04377db-e425-4394-a557-40144bdfc81b',
  lead: '/s/72e9f6b7-324d-4039-ae02-3992d776853d',
  pad: '/s/9e049b98-72ba-4600-8d7d-81dd37435f18',
  pluck: '/s/f5b62dab-5efc-4b60-88af-9d60506829e0',
  acid: '/s/b5ea9658-fe2a-4d4b-8a0f-bef54e475040',

  // Keys
  rhodes: '/s/f1b09891-4c92-4d98-97ad-41cd88a0aee7',
  organ: '/s/77508613-1db6-4b97-b342-a0ab24df8dff',
  wurlitzer: '/s/16492e9c-5587-4217-89cc-8d6170164aef',
  clavinet: '/s/0bd8c479-d4b7-400d-b762-c6f94ae8bff4',

  // Genre
  funkbass: '/s/213be3b0-11b3-4fdf-8a15-fa5703fa9895',
  discobass: '/s/b7b041f9-5b67-4037-be6a-063fd8f64480',
  strings: '/s/af89bdd0-414e-40da-843b-d8e0e165762f',
  brass: '/s/b2fffe79-e432-44ad-9dc6-b83778885d86',
  stab: '/s/733cbb31-d787-4852-bcac-f6168589168c',
  sub: '/s/6bd332c8-b400-4f04-9acf-50a2d2c21f13',

  // Ambient
  shimmer: '/s/75ae6162-71c5-483d-838b-02bdf137de0f',
  jangle: '/s/6416472b-3592-4d93-af52-d40232e86bf6',
  dreampop: '/s/e016d984-ac33-4ff3-ada3-d3eeae50bee2',
  bell: '/s/36a9fcd3-d286-4180-a51f-cadd598b4ac4',

  // Phase 22 Enhanced Electronic
  supersaw: '/s/00000000-0000-0000-0000-000000000001',
  hypersaw: '/s/00000000-0000-0000-0000-000000000002',
  wobble: '/s/00000000-0000-0000-0000-000000000003',
  growl: '/s/00000000-0000-0000-0000-000000000004',

  // Phase 22 Enhanced Atmospheric
  evolving: '/s/00000000-0000-0000-0000-000000000005',
  sweep: '/s/00000000-0000-0000-0000-000000000006',
  warmpad: '/s/00000000-0000-0000-0000-000000000007',
  glass: '/s/00000000-0000-0000-0000-000000000008',

  // Phase 22 Enhanced Keys
  epiano: '/s/00000000-0000-0000-0000-000000000009',
  vibes: '/s/00000000-0000-0000-0000-00000000000a',
  organphase: '/s/00000000-0000-0000-0000-00000000000b',

  // Phase 22 Enhanced Bass
  reese: '/s/00000000-0000-0000-0000-00000000000c',
  hoover: '/s/00000000-0000-0000-0000-00000000000d',
};

describe('Synth test sessions', () => {
  it('should have a test session for every synth preset', () => {
    const presetNames = Object.keys(SYNTH_PRESETS);
    const sessionPresets = Object.keys(SYNTH_TEST_SESSIONS);

    const missingFromSessions = presetNames.filter(p => !sessionPresets.includes(p));
    const extraInSessions = sessionPresets.filter(p => !presetNames.includes(p));

    expect(missingFromSessions).toEqual([]);
    expect(extraInSessions).toEqual([]);

    if (missingFromSessions.length > 0) {
      throw new Error(
        `Missing test sessions for presets: ${missingFromSessions.join(', ')}\n` +
        `Run: npx tsx scripts/create-test-sessions.ts`
      );
    }
  });

  it('should have valid session URL format', () => {
    for (const [_preset, path] of Object.entries(SYNTH_TEST_SESSIONS)) {
      expect(path).toMatch(/^\/s\/[a-f0-9-]{36}$/);
    }
  });

  it('should have exactly 32 test sessions (Phase 22)', () => {
    // 19 original + 13 Phase 22 enhanced presets = 32
    expect(Object.keys(SYNTH_TEST_SESSIONS).length).toBe(32);
  });
});

/**
 * Helper to get full URL for a synth preset test session
 */
export function getSynthTestSessionUrl(preset: string): string {
  const path = SYNTH_TEST_SESSIONS[preset];
  if (!path) {
    throw new Error(`No test session for preset: ${preset}`);
  }
  return `${BASE_URL}${path}`;
}

/**
 * All test session URLs for manual testing
 */
export const ALL_SYNTH_TEST_URLS = Object.fromEntries(
  Object.entries(SYNTH_TEST_SESSIONS).map(([preset, path]) => [
    preset,
    `${BASE_URL}${path}`,
  ])
);
