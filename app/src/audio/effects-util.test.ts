/**
 * Tests for effects-util.ts
 *
 * Verifies that unknown parameters and edge cases are handled gracefully
 * with appropriate warnings instead of silent drops.
 */

import { describe, it, expect, vi } from 'vitest';
import { applyEffectToEngine } from './effects-util';
import type { EffectsState } from './toneEffects';

// Mock the audio engine to avoid Tone.js initialization
vi.mock('./engine', () => ({
  audioEngine: {
    setReverbWet: vi.fn(),
    setReverbDecay: vi.fn(),
    setDelayWet: vi.fn(),
    setDelayTime: vi.fn(),
    setDelayFeedback: vi.fn(),
    setChorusWet: vi.fn(),
    setChorusFrequency: vi.fn(),
    setChorusDepth: vi.fn(),
    setDistortionWet: vi.fn(),
    setDistortionAmount: vi.fn(),
  },
}));

describe('applyEffectToEngine', () => {
  it('warns on unknown param within a known effect', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyEffectToEngine('reverb', 'unknownParam', 0.5);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown'),
    );
    warnSpy.mockRestore();
  });

  it('handles bypass as effectName without crashing', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => applyEffectToEngine('bypass', 'anything', 0)).not.toThrow();
    // Should not warn for bypass
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('warns on completely unknown effectName', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyEffectToEngine('unknownEffect' as keyof EffectsState, 'wet', 0.5);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown'),
    );
    warnSpy.mockRestore();
  });
});
