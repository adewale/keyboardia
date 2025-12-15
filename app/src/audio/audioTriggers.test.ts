/**
 * Tests for centralized audio trigger system
 */

import { describe, it, expect } from 'vitest';
import {
  // Gesture validation
  VALID_AUDIO_GESTURES,
  INVALID_AUDIO_GESTURES,
  isValidAudioGesture,
  // Trigger types
  TIER_1_TRIGGERS,
  TIER_2_TRIGGERS,
  PREVIEW_TRIGGERS,
  // Decision functions
  shouldRequireAudio,
  shouldPreloadAudio,
  isPreviewTrigger,
  shouldTriggerAudioLoad,
} from './audioTriggers';

describe('audioTriggers', () => {
  describe('gesture validation', () => {
    describe('VALID_AUDIO_GESTURES', () => {
      it('includes click events', () => {
        expect(VALID_AUDIO_GESTURES).toContain('click');
        expect(VALID_AUDIO_GESTURES).toContain('mousedown');
        expect(VALID_AUDIO_GESTURES).toContain('mouseup');
        expect(VALID_AUDIO_GESTURES).toContain('dblclick');
      });

      it('includes touch events', () => {
        expect(VALID_AUDIO_GESTURES).toContain('touchend');
        expect(VALID_AUDIO_GESTURES).toContain('pointerup');
      });

      it('includes keyboard events', () => {
        expect(VALID_AUDIO_GESTURES).toContain('keydown');
        expect(VALID_AUDIO_GESTURES).toContain('keyup');
      });

      it('does NOT include hover events', () => {
        expect(VALID_AUDIO_GESTURES).not.toContain('mouseenter');
        expect(VALID_AUDIO_GESTURES).not.toContain('mouseover');
        expect(VALID_AUDIO_GESTURES).not.toContain('mousemove');
      });
    });

    describe('INVALID_AUDIO_GESTURES', () => {
      it('includes hover events', () => {
        expect(INVALID_AUDIO_GESTURES).toContain('mouseenter');
        expect(INVALID_AUDIO_GESTURES).toContain('mouseover');
        expect(INVALID_AUDIO_GESTURES).toContain('mousemove');
      });

      it('includes passive events', () => {
        expect(INVALID_AUDIO_GESTURES).toContain('scroll');
        expect(INVALID_AUDIO_GESTURES).toContain('wheel');
        expect(INVALID_AUDIO_GESTURES).toContain('focus');
        expect(INVALID_AUDIO_GESTURES).toContain('blur');
      });

      it('includes lifecycle events', () => {
        expect(INVALID_AUDIO_GESTURES).toContain('load');
        expect(INVALID_AUDIO_GESTURES).toContain('resize');
      });
    });

    describe('isValidAudioGesture', () => {
      it('returns true for valid gestures', () => {
        expect(isValidAudioGesture('click')).toBe(true);
        expect(isValidAudioGesture('touchend')).toBe(true);
        expect(isValidAudioGesture('keydown')).toBe(true);
      });

      it('returns false for invalid gestures', () => {
        expect(isValidAudioGesture('mouseenter')).toBe(false);
        expect(isValidAudioGesture('scroll')).toBe(false);
        expect(isValidAudioGesture('load')).toBe(false);
      });

      it('returns false for unknown events', () => {
        expect(isValidAudioGesture('unknown')).toBe(false);
        expect(isValidAudioGesture('')).toBe(false);
      });
    });
  });

  describe('trigger classification', () => {
    describe('TIER_1_TRIGGERS (require audio now)', () => {
      it('includes play', () => {
        expect(TIER_1_TRIGGERS).toContain('play');
      });

      it('includes recording actions', () => {
        expect(TIER_1_TRIGGERS).toContain('record');
        expect(TIER_1_TRIGGERS).toContain('record_stop');
        expect(TIER_1_TRIGGERS).toContain('add_to_grid');
      });

      it('does NOT include step_toggle', () => {
        expect(TIER_1_TRIGGERS).not.toContain('step_toggle');
      });

      it('does NOT include preview triggers', () => {
        expect(TIER_1_TRIGGERS).not.toContain('preview_hover');
        expect(TIER_1_TRIGGERS).not.toContain('preview_transpose');
      });
    });

    describe('TIER_2_TRIGGERS (preload in background)', () => {
      it('includes step_toggle', () => {
        expect(TIER_2_TRIGGERS).toContain('step_toggle');
      });

      it('includes add_track', () => {
        expect(TIER_2_TRIGGERS).toContain('add_track');
      });

      it('includes chromatic_click', () => {
        expect(TIER_2_TRIGGERS).toContain('chromatic_click');
      });

      it('does NOT include play', () => {
        expect(TIER_2_TRIGGERS).not.toContain('play');
      });
    });

    describe('PREVIEW_TRIGGERS (only if already loaded)', () => {
      it('includes hover preview', () => {
        expect(PREVIEW_TRIGGERS).toContain('preview_hover');
      });

      it('includes transpose preview', () => {
        expect(PREVIEW_TRIGGERS).toContain('preview_transpose');
      });

      it('includes pitch preview', () => {
        expect(PREVIEW_TRIGGERS).toContain('preview_pitch');
      });

      it('includes slice preview', () => {
        expect(PREVIEW_TRIGGERS).toContain('preview_slice');
      });
    });
  });

  describe('decision functions', () => {
    describe('shouldRequireAudio', () => {
      it('returns true for Tier 1 triggers', () => {
        expect(shouldRequireAudio('play')).toBe(true);
        expect(shouldRequireAudio('record')).toBe(true);
        expect(shouldRequireAudio('record_stop')).toBe(true);
        expect(shouldRequireAudio('add_to_grid')).toBe(true);
      });

      it('returns false for Tier 2 triggers', () => {
        expect(shouldRequireAudio('step_toggle')).toBe(false);
        expect(shouldRequireAudio('add_track')).toBe(false);
      });

      it('returns false for preview triggers', () => {
        expect(shouldRequireAudio('preview_hover')).toBe(false);
        expect(shouldRequireAudio('preview_transpose')).toBe(false);
      });
    });

    describe('shouldPreloadAudio', () => {
      it('returns true for Tier 2 triggers', () => {
        expect(shouldPreloadAudio('step_toggle')).toBe(true);
        expect(shouldPreloadAudio('add_track')).toBe(true);
        expect(shouldPreloadAudio('chromatic_click')).toBe(true);
      });

      it('returns false for Tier 1 triggers', () => {
        expect(shouldPreloadAudio('play')).toBe(false);
        expect(shouldPreloadAudio('record')).toBe(false);
      });

      it('returns false for preview triggers', () => {
        expect(shouldPreloadAudio('preview_hover')).toBe(false);
      });
    });

    describe('isPreviewTrigger', () => {
      it('returns true for preview triggers', () => {
        expect(isPreviewTrigger('preview_hover')).toBe(true);
        expect(isPreviewTrigger('preview_transpose')).toBe(true);
        expect(isPreviewTrigger('preview_pitch')).toBe(true);
        expect(isPreviewTrigger('preview_slice')).toBe(true);
      });

      it('returns false for Tier 1 triggers', () => {
        expect(isPreviewTrigger('play')).toBe(false);
        expect(isPreviewTrigger('record')).toBe(false);
      });

      it('returns false for Tier 2 triggers', () => {
        expect(isPreviewTrigger('step_toggle')).toBe(false);
        expect(isPreviewTrigger('add_track')).toBe(false);
      });
    });

    describe('shouldTriggerAudioLoad', () => {
      it('returns true for Tier 1 triggers', () => {
        expect(shouldTriggerAudioLoad('play')).toBe(true);
        expect(shouldTriggerAudioLoad('record')).toBe(true);
      });

      it('returns true for Tier 2 triggers', () => {
        expect(shouldTriggerAudioLoad('step_toggle')).toBe(true);
        expect(shouldTriggerAudioLoad('add_track')).toBe(true);
      });

      it('returns false for preview triggers', () => {
        expect(shouldTriggerAudioLoad('preview_hover')).toBe(false);
        expect(shouldTriggerAudioLoad('preview_transpose')).toBe(false);
      });
    });
  });

  describe('trigger categorization completeness', () => {
    it('all triggers are categorized exactly once', () => {
      const allTriggers = [
        ...TIER_1_TRIGGERS,
        ...TIER_2_TRIGGERS,
        ...PREVIEW_TRIGGERS,
      ];

      // Check for duplicates
      const seen = new Set<string>();
      for (const trigger of allTriggers) {
        expect(seen.has(trigger)).toBe(false);
        seen.add(trigger);
      }
    });

    it('Tier 1 and Tier 2 are mutually exclusive', () => {
      for (const trigger of TIER_1_TRIGGERS) {
        expect(TIER_2_TRIGGERS).not.toContain(trigger);
      }
    });

    it('Preview triggers are separate from loading triggers', () => {
      for (const trigger of PREVIEW_TRIGGERS) {
        expect(TIER_1_TRIGGERS).not.toContain(trigger);
        expect(TIER_2_TRIGGERS).not.toContain(trigger);
      }
    });
  });

  describe('add_track trigger', () => {
    it('is classified as Tier 2 (preload)', () => {
      expect(shouldPreloadAudio('add_track')).toBe(true);
    });

    it('should trigger audio load', () => {
      expect(shouldTriggerAudioLoad('add_track')).toBe(true);
    });

    it('does not require audio immediately', () => {
      expect(shouldRequireAudio('add_track')).toBe(false);
    });
  });
});
