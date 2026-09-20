import { describe, expect, it } from 'vitest';
import inventory from '../e2e/verification-impact.json';
import { selectVerificationScope } from '../scripts/select-verification-scope.mjs';

describe('cost-aware verification impact selection', () => {
  it('does not spend browser minutes for documentation-only changes', () => {
    const result = selectVerificationScope([
      'docs/TEST-AUDIT-2026-07.md',
      'specs/ADSR-OVERHAUL-v2.md',
    ], inventory);

    expect(result.selected).toEqual({
      browser: false,
      worker: false,
      audio: false,
      visual: false,
      samples: false,
    });
  });

  it('selects overlapping contracts for an audio engine change', () => {
    const result = selectVerificationScope(['app/src/audio/sample-voice.ts'], inventory);

    expect(result.selected).toMatchObject({ browser: true, audio: true, samples: true });
    expect(result.selected.worker).toBe(false);
    expect(result.selected.visual).toBe(false);
  });

  it('selects every T1 profile for an unclassified code path', () => {
    const result = selectVerificationScope(['tooling/new-runtime-check.ts'], inventory);

    expect(Object.values(result.selected)).toEqual([true, true, true, true, true]);
    expect(result.reasons[0]).toContain('unmatched path');
  });

  it('selects every T1 profile when the policy itself changes', () => {
    const result = selectVerificationScope(['.github/workflows/ci.yml'], inventory);

    expect(Object.values(result.selected)).toEqual([true, true, true, true, true]);
  });
});
