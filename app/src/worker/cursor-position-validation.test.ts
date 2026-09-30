import { describe, it, expect } from 'vitest';

// =============================================================================
// CURSOR POSITION VALIDATION TESTS
// =============================================================================

import {
  MIN_CURSOR_POSITION,
  MAX_CURSOR_POSITION,
} from '../shared/constants';
import { validateCursorPosition } from './invariants';

describe('Cursor Position Validation', () => {
  describe('validateCursorPosition', () => {
    it('should return null for non-object input', () => {
      expect(validateCursorPosition(null)).toBeNull();
      expect(validateCursorPosition(undefined)).toBeNull();
      expect(validateCursorPosition('string')).toBeNull();
      expect(validateCursorPosition(123)).toBeNull();
      expect(validateCursorPosition([1, 2])).toBeNull();
    });

    it('should return null for missing x or y', () => {
      expect(validateCursorPosition({})).toBeNull();
      expect(validateCursorPosition({ x: 50 })).toBeNull();
      expect(validateCursorPosition({ y: 50 })).toBeNull();
    });

    it('should return null for non-numeric x or y', () => {
      expect(validateCursorPosition({ x: 'string', y: 50 })).toBeNull();
      expect(validateCursorPosition({ x: 50, y: 'string' })).toBeNull();
      expect(validateCursorPosition({ x: NaN, y: 50 })).toBeNull();
      expect(validateCursorPosition({ x: 50, y: NaN })).toBeNull();
      expect(validateCursorPosition({ x: Infinity, y: 50 })).toBeNull();
      expect(validateCursorPosition({ x: 50, y: -Infinity })).toBeNull();
    });

    it('should accept valid cursor positions', () => {
      expect(validateCursorPosition({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
      expect(validateCursorPosition({ x: 50, y: 50 })).toEqual({ x: 50, y: 50 });
      expect(validateCursorPosition({ x: 100, y: 100 })).toEqual({ x: 100, y: 100 });
    });

    it('should clamp x below minimum to 0', () => {
      const result = validateCursorPosition({ x: -50, y: 50 });
      expect(result).toEqual({ x: MIN_CURSOR_POSITION, y: 50 });
    });

    it('should clamp x above maximum to 100', () => {
      const result = validateCursorPosition({ x: 999999, y: 50 });
      expect(result).toEqual({ x: MAX_CURSOR_POSITION, y: 50 });
    });

    it('should clamp y below minimum to 0', () => {
      const result = validateCursorPosition({ x: 50, y: -100 });
      expect(result).toEqual({ x: 50, y: MIN_CURSOR_POSITION });
    });

    it('should clamp y above maximum to 100', () => {
      const result = validateCursorPosition({ x: 50, y: 999999 });
      expect(result).toEqual({ x: 50, y: MAX_CURSOR_POSITION });
    });

    it('should clamp both x and y when both are out of bounds', () => {
      const result = validateCursorPosition({ x: -999, y: 999 });
      expect(result).toEqual({ x: MIN_CURSOR_POSITION, y: MAX_CURSOR_POSITION });
    });

    it('should preserve valid trackId', () => {
      const result = validateCursorPosition({ x: 50, y: 50, trackId: 'track-123' });
      expect(result).toEqual({ x: 50, y: 50, trackId: 'track-123' });
    });

    it('should ignore non-string trackId', () => {
      const result = validateCursorPosition({ x: 50, y: 50, trackId: 123 });
      expect(result).toEqual({ x: 50, y: 50 });
    });

    it('should preserve valid step', () => {
      const result = validateCursorPosition({ x: 50, y: 50, step: 7 });
      expect(result).toEqual({ x: 50, y: 50, step: 7 });
    });

    it('should floor non-integer step', () => {
      const result = validateCursorPosition({ x: 50, y: 50, step: 7.9 });
      expect(result).toEqual({ x: 50, y: 50, step: 7 });
    });

    it('should ignore negative step', () => {
      const result = validateCursorPosition({ x: 50, y: 50, step: -5 });
      expect(result).toEqual({ x: 50, y: 50 });
    });

    it('should ignore non-numeric step', () => {
      const result = validateCursorPosition({ x: 50, y: 50, step: 'invalid' });
      expect(result).toEqual({ x: 50, y: 50 });
    });

    it('should handle extreme values without crashing', () => {
      // This is the attack scenario we're protecting against
      // Note: Number.MIN_VALUE is smallest positive (5e-324), use -Number.MAX_VALUE for negative
      const extreme = validateCursorPosition({ x: Number.MAX_VALUE, y: -Number.MAX_VALUE });
      expect(extreme).toEqual({ x: MAX_CURSOR_POSITION, y: MIN_CURSOR_POSITION });
    });

    it('should preserve all valid optional fields together', () => {
      const result = validateCursorPosition({
        x: 25.5,
        y: 75.3,
        trackId: 'my-track',
        step: 12,
      });
      expect(result).toEqual({
        x: 25.5,
        y: 75.3,
        trackId: 'my-track',
        step: 12,
      });
    });
  });
});
