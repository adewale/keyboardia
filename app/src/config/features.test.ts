/**
 * Feature Flags Unit Tests
 *
 * Tests for the centralized feature flag system.
 * Replaces E2E tests in e2e/feature-flags.spec.ts that only checked flag defaults.
 *
 * @see src/config/features.ts
 */

import { describe, it, expect } from 'vitest';
import { features, isFeatureEnabled, getAllFeatureFlags, type FeatureFlag } from './features';

describe('Feature Flags', () => {
  describe('Default Values', () => {
    it('loopRuler defaults to false (disabled)', () => {
      // Loop ruler UI is off by default while we assess UX impact
      expect(features.loopRuler).toBe(false);
    });

    it('advancedStepInput defaults to true (enabled)', () => {
      // Multi-select and drag-to-paint enabled by default
      expect(features.advancedStepInput).toBe(true);
    });

    it('mixerPanel defaults to true (stable feature)', () => {
      expect(features.mixerPanel).toBe(true);
    });

    it('pitchOverview defaults to true (stable feature)', () => {
      expect(features.pitchOverview).toBe(true);
    });

    it('effectsPanel defaults to true (stable feature)', () => {
      expect(features.effectsPanel).toBe(true);
    });

    it('velocityLane defaults to true (stable feature)', () => {
      expect(features.velocityLane).toBe(true);
    });

    it('multiplayer defaults to true (stable feature)', () => {
      expect(features.multiplayer).toBe(true);
    });
  });

  describe('isFeatureEnabled helper', () => {
    it('returns correct value for each flag', () => {
      const flags: FeatureFlag[] = [
        'loopRuler',
        'mixerPanel',
        'pitchOverview',
        'effectsPanel',
        'velocityLane',
        'multiplayer',
        'advancedStepInput',
      ];

      for (const flag of flags) {
        expect(isFeatureEnabled(flag)).toBe(features[flag]);
      }
    });
  });

  describe('getAllFeatureFlags helper', () => {
    it('returns all flags as an object', () => {
      const allFlags = getAllFeatureFlags();

      // Should have all expected flags
      expect(allFlags).toHaveProperty('loopRuler');
      expect(allFlags).toHaveProperty('mixerPanel');
      expect(allFlags).toHaveProperty('pitchOverview');
      expect(allFlags).toHaveProperty('effectsPanel');
      expect(allFlags).toHaveProperty('velocityLane');
      expect(allFlags).toHaveProperty('multiplayer');
      expect(allFlags).toHaveProperty('advancedStepInput');

      // Should match the features object
      expect(allFlags).toEqual(features);
    });

    it('returns a copy (not the original object)', () => {
      const allFlags = getAllFeatureFlags();
      expect(allFlags).not.toBe(features);
    });
  });

  describe('Type Safety', () => {
    it('features object is immutable (as const)', () => {
      // TypeScript ensures this at compile time via 'as const'
      // At runtime, we verify the object structure is correct
      expect(typeof features.loopRuler).toBe('boolean');
      expect(typeof features.advancedStepInput).toBe('boolean');
    });
  });
});
