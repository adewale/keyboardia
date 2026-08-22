import { describe, expect, it } from 'vitest';
import { SYNTH_PRESETS } from './synth';
import {
  PUBLISHED_NATIVE_SYNTH_PRESETS,
  SYNTH_RENDERER_MIGRATION_MANIFEST,
  isSynthRendererApproved,
} from './synth-renderer-migration';

describe('per-preset synth renderer migration manifest', () => {
  it('covers the entire published native preset registry', () => {
    expect([...PUBLISHED_NATIVE_SYNTH_PRESETS].sort()).toEqual(Object.keys(SYNTH_PRESETS).sort());
    expect(Object.keys(SYNTH_RENDERER_MIGRATION_MANIFEST).sort()).toEqual(Object.keys(SYNTH_PRESETS).sort());
  });

  it('fails closed while any T3 evidence is absent', () => {
    for (const preset of Object.keys(SYNTH_PRESETS)) {
      expect(isSynthRendererApproved(preset)).toBe(false);
    }
    expect(isSynthRendererApproved('unknown')).toBe(false);
  });
});
