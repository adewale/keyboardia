/**
 * Feature Flags Unit Tests
 *
 * Tests for the centralized feature flag system.
 * Replaces E2E tests in e2e/feature-flags.spec.ts that only checked flag defaults.
 *
 * @see src/config/features.ts
 */

import { describe, it, expect } from 'vitest';
import { features } from './features';

describe('Feature Flags', () => {
  describe('Default Values', () => {
    it('loopRuler defaults to true (enabled)', () => {
      // Loop ruler UI enabled — loop region state/scheduler integration is stable
      expect(features.loopRuler).toBe(true);
    });

    it('advancedStepInput defaults to true (enabled)', () => {
      // Multi-select and drag-to-paint enabled by default
      expect(features.advancedStepInput).toBe(true);
    });

    it('workletScheduler defaults to false (main-thread scheduler)', () => {
      expect(features.workletScheduler).toBe(false);
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

});
