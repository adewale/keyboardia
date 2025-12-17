/**
 * Tests for XY Pad / Macro Controls
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  XYPadController,
  XY_PAD_PRESETS,
  PARAMETER_RANGES,
  mapValue,
  unmapValue,
  createXYPad,
  getXYPadPresetIds,
  getXYPadPresetInfo,
  type XYPadParameter,
  type XYPadMapping,
  type XYPadState,
} from './xyPad';

describe('XYPadController', () => {
  let controller: XYPadController;

  beforeEach(() => {
    controller = new XYPadController();
  });

  describe('initialization', () => {
    it('starts at center position (0.5, 0.5)', () => {
      expect(controller.getX()).toBe(0.5);
      expect(controller.getY()).toBe(0.5);
    });

    it('starts with no mappings by default', () => {
      expect(controller.getMappings()).toHaveLength(0);
    });

    it('can initialize with preset', () => {
      const presetController = new XYPadController('filter-sweep');
      expect(presetController.getMappings()).toHaveLength(2);
    });

    it('starts enabled', () => {
      expect(controller.isEnabled()).toBe(true);
    });
  });

  describe('position control', () => {
    it('sets X position', () => {
      controller.setX(0.75);
      expect(controller.getX()).toBe(0.75);
    });

    it('sets Y position', () => {
      controller.setY(0.25);
      expect(controller.getY()).toBe(0.25);
    });

    it('sets both positions', () => {
      controller.setPosition(0.3, 0.7);
      expect(controller.getX()).toBe(0.3);
      expect(controller.getY()).toBe(0.7);
    });

    it('clamps X to 0-1 range', () => {
      controller.setX(-0.5);
      expect(controller.getX()).toBe(0);

      controller.setX(1.5);
      expect(controller.getX()).toBe(1);
    });

    it('clamps Y to 0-1 range', () => {
      controller.setY(-0.5);
      expect(controller.getY()).toBe(0);

      controller.setY(1.5);
      expect(controller.getY()).toBe(1);
    });

    it('resets to center', () => {
      controller.setPosition(0.1, 0.9);
      controller.reset();
      expect(controller.getX()).toBe(0.5);
      expect(controller.getY()).toBe(0.5);
    });
  });

  describe('preset loading', () => {
    it('loads filter-sweep preset', () => {
      controller.loadPreset('filter-sweep');
      const mappings = controller.getMappings();
      expect(mappings).toHaveLength(2);
      expect(mappings[0].parameter).toBe('filterFrequency');
      expect(mappings[1].parameter).toBe('filterResonance');
    });

    it('loads lfo-control preset', () => {
      controller.loadPreset('lfo-control');
      const mappings = controller.getMappings();
      expect(mappings[0].parameter).toBe('lfoRate');
      expect(mappings[1].parameter).toBe('lfoAmount');
    });

    it('loads space-control preset', () => {
      controller.loadPreset('space-control');
      const mappings = controller.getMappings();
      expect(mappings[0].parameter).toBe('reverbWet');
      expect(mappings[1].parameter).toBe('delayWet');
    });

    it('ignores unknown presets', () => {
      controller.loadPreset('filter-sweep');
      controller.loadPreset('unknown-preset');
      // Should still have filter-sweep mappings
      expect(controller.getMappings()).toHaveLength(2);
    });
  });

  describe('custom mappings', () => {
    it('sets custom mappings', () => {
      const customMappings: XYPadMapping[] = [
        { parameter: 'oscMix', axis: 'x', min: 0, max: 1, curve: 'linear' },
      ];
      controller.setMappings(customMappings);
      expect(controller.getMappings()).toHaveLength(1);
      expect(controller.getMappings()[0].parameter).toBe('oscMix');
    });

    it('replaces existing mappings', () => {
      controller.loadPreset('filter-sweep');
      controller.setMappings([
        { parameter: 'attack', axis: 'x', min: 0.001, max: 1, curve: 'exponential' },
      ]);
      expect(controller.getMappings()).toHaveLength(1);
    });
  });

  describe('callback invocation', () => {
    it('calls callback on position change', () => {
      const callback = vi.fn();
      controller.setCallback(callback);
      controller.loadPreset('filter-sweep');
      controller.setX(0.8);

      expect(callback).toHaveBeenCalled();
      // Filter frequency is on X axis
      expect(callback).toHaveBeenCalledWith('filterFrequency', expect.any(Number));
    });

    it('calls callback for all mapped parameters', () => {
      const callback = vi.fn();
      controller.setCallback(callback);
      controller.loadPreset('filter-sweep');
      callback.mockClear(); // Clear calls from loadPreset

      controller.setPosition(0.5, 0.5);

      // Should be called for both X and Y parameters
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('does not call callback when disabled', () => {
      const callback = vi.fn();
      controller.setCallback(callback);
      controller.loadPreset('filter-sweep');
      controller.setEnabled(false);
      callback.mockClear();

      controller.setX(0.8);
      expect(callback).not.toHaveBeenCalled();
    });

    it('calls callback when re-enabled', () => {
      const callback = vi.fn();
      controller.setCallback(callback);
      controller.loadPreset('filter-sweep');
      controller.setEnabled(false);
      callback.mockClear();

      controller.setEnabled(true);
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('parameter value calculation', () => {
    beforeEach(() => {
      controller.loadPreset('filter-sweep');
    });

    it('returns null for unmapped parameters', () => {
      expect(controller.getParameterValue('attack')).toBeNull();
    });

    it('calculates parameter value for mapped parameter', () => {
      controller.setX(0);
      const value = controller.getParameterValue('filterFrequency');
      expect(value).not.toBeNull();
      // At X=0, should be minimum value (100)
      expect(value).toBe(100);
    });

    it('calculates max value at position 1', () => {
      controller.setX(1);
      const value = controller.getParameterValue('filterFrequency');
      // At X=1, should be maximum value (8000)
      expect(value).toBe(8000);
    });

    it('returns all parameter values', () => {
      controller.setPosition(0.5, 0.5);
      const values = controller.getAllParameterValues();
      expect(values.filterFrequency).toBeDefined();
      expect(values.filterResonance).toBeDefined();
    });
  });

  describe('state serialization', () => {
    it('returns serializable state', () => {
      controller.loadPreset('filter-sweep');
      controller.setPosition(0.3, 0.7);

      const state = controller.getState();
      expect(state.x).toBe(0.3);
      expect(state.y).toBe(0.7);
      expect(state.mappings).toHaveLength(2);
    });

    it('applies state from serialized data', () => {
      const state: XYPadState = {
        x: 0.2,
        y: 0.8,
        mappings: [
          { parameter: 'oscMix', axis: 'x', min: 0, max: 1, curve: 'linear' },
        ],
      };

      controller.applyState(state);
      expect(controller.getX()).toBe(0.2);
      expect(controller.getY()).toBe(0.8);
      expect(controller.getMappings()).toHaveLength(1);
    });

    it('triggers callback on state apply', () => {
      const callback = vi.fn();
      controller.setCallback(callback);

      const state: XYPadState = {
        x: 0.2,
        y: 0.8,
        mappings: [
          { parameter: 'oscMix', axis: 'x', min: 0, max: 1, curve: 'linear' },
        ],
      };

      controller.applyState(state);
      expect(callback).toHaveBeenCalled();
    });
  });

  describe('enable/disable', () => {
    it('can be disabled', () => {
      controller.setEnabled(false);
      expect(controller.isEnabled()).toBe(false);
    });

    it('can be re-enabled', () => {
      controller.setEnabled(false);
      controller.setEnabled(true);
      expect(controller.isEnabled()).toBe(true);
    });
  });
});

describe('mapValue', () => {
  describe('linear curve', () => {
    it('maps 0 to min', () => {
      expect(mapValue(0, 0, 100, 'linear')).toBe(0);
    });

    it('maps 1 to max', () => {
      expect(mapValue(1, 0, 100, 'linear')).toBe(100);
    });

    it('maps 0.5 to midpoint', () => {
      expect(mapValue(0.5, 0, 100, 'linear')).toBe(50);
    });

    it('works with non-zero min', () => {
      expect(mapValue(0.5, 100, 200, 'linear')).toBe(150);
    });
  });

  describe('exponential curve', () => {
    it('maps 0 to min', () => {
      expect(mapValue(0, 100, 8000, 'exponential')).toBe(100);
    });

    it('maps 1 to max', () => {
      expect(mapValue(1, 100, 8000, 'exponential')).toBe(8000);
    });

    it('maps 0.5 to less than linear midpoint (curve shape)', () => {
      const linear = mapValue(0.5, 100, 8000, 'linear');
      const exponential = mapValue(0.5, 100, 8000, 'exponential');
      // Exponential curve at 0.5 gives 0.25 of range
      expect(exponential).toBeLessThan(linear);
    });
  });
});

describe('unmapValue', () => {
  describe('linear curve', () => {
    it('unmaps min to 0', () => {
      expect(unmapValue(0, 0, 100, 'linear')).toBe(0);
    });

    it('unmaps max to 1', () => {
      expect(unmapValue(100, 0, 100, 'linear')).toBe(1);
    });

    it('unmaps midpoint to 0.5', () => {
      expect(unmapValue(50, 0, 100, 'linear')).toBe(0.5);
    });
  });

  describe('exponential curve', () => {
    it('unmaps min to 0', () => {
      expect(unmapValue(100, 100, 8000, 'exponential')).toBe(0);
    });

    it('unmaps max to 1', () => {
      expect(unmapValue(8000, 100, 8000, 'exponential')).toBe(1);
    });

    it('is inverse of mapValue', () => {
      const original = 0.7;
      const mapped = mapValue(original, 100, 8000, 'exponential');
      const unmapped = unmapValue(mapped, 100, 8000, 'exponential');
      expect(unmapped).toBeCloseTo(original, 5);
    });
  });
});

describe('XY_PAD_PRESETS', () => {
  it('has all expected presets', () => {
    const expectedPresets = [
      'filter-sweep',
      'lfo-control',
      'envelope-shape',
      'space-control',
      'delay-modulation',
      'oscillator-filter',
    ];
    for (const preset of expectedPresets) {
      expect(XY_PAD_PRESETS[preset]).toBeDefined();
    }
  });

  it('all presets have name and mappings', () => {
    for (const [_id, preset] of Object.entries(XY_PAD_PRESETS)) {
      expect(preset.name).toBeDefined();
      expect(preset.mappings).toBeDefined();
      expect(preset.mappings.length).toBeGreaterThan(0);
    }
  });

  it('all mappings have valid axis', () => {
    for (const preset of Object.values(XY_PAD_PRESETS)) {
      for (const mapping of preset.mappings) {
        expect(['x', 'y']).toContain(mapping.axis);
      }
    }
  });

  it('all mappings have valid curve', () => {
    for (const preset of Object.values(XY_PAD_PRESETS)) {
      for (const mapping of preset.mappings) {
        expect(['linear', 'exponential']).toContain(mapping.curve);
      }
    }
  });
});

describe('PARAMETER_RANGES', () => {
  it('has ranges for all parameters', () => {
    const expectedParams: XYPadParameter[] = [
      'filterFrequency',
      'filterResonance',
      'lfoRate',
      'lfoAmount',
      'oscMix',
      'attack',
      'release',
      'reverbWet',
      'delayWet',
      'delayFeedback',
      'chorusWet',
      'distortionWet',
    ];
    for (const param of expectedParams) {
      expect(PARAMETER_RANGES[param]).toBeDefined();
      expect(PARAMETER_RANGES[param].min).toBeDefined();
      expect(PARAMETER_RANGES[param].max).toBeDefined();
      expect(PARAMETER_RANGES[param].curve).toBeDefined();
    }
  });

  it('all ranges have min < max', () => {
    for (const [_param, range] of Object.entries(PARAMETER_RANGES)) {
      expect(range.min).toBeLessThan(range.max);
    }
  });
});

describe('helper functions', () => {
  describe('createXYPad', () => {
    it('creates controller with default preset', () => {
      const pad = createXYPad();
      expect(pad.getMappings()).toHaveLength(2);
    });

    it('creates controller with specified preset', () => {
      const pad = createXYPad('lfo-control');
      const mappings = pad.getMappings();
      expect(mappings[0].parameter).toBe('lfoRate');
    });
  });

  describe('getXYPadPresetIds', () => {
    it('returns all preset IDs', () => {
      const ids = getXYPadPresetIds();
      expect(ids).toContain('filter-sweep');
      expect(ids).toContain('lfo-control');
      expect(ids).toContain('space-control');
    });
  });

  describe('getXYPadPresetInfo', () => {
    it('returns preset info for valid ID', () => {
      const info = getXYPadPresetInfo('filter-sweep');
      expect(info).not.toBeNull();
      expect(info?.name).toBe('Filter Sweep');
    });

    it('returns null for invalid ID', () => {
      const info = getXYPadPresetInfo('invalid-preset');
      expect(info).toBeNull();
    });
  });
});

describe('real-world usage scenarios', () => {
  it('simulates filter sweep performance', () => {
    const controller = createXYPad('filter-sweep');
    const changes: Array<{ parameter: XYPadParameter; value: number }> = [];

    controller.setCallback((param, value) => {
      changes.push({ parameter: param, value });
    });

    // Simulate sweeping from bottom-left to top-right
    controller.setPosition(0, 0);
    controller.setPosition(0.5, 0.5);
    controller.setPosition(1, 1);

    // Should have recorded 6 changes (2 params × 3 positions)
    expect(changes.length).toBe(6);

    // Check that filter frequency increased
    const freqChanges = changes.filter(c => c.parameter === 'filterFrequency');
    expect(freqChanges[2].value).toBeGreaterThan(freqChanges[0].value);
  });

  it('simulates saving and restoring performance state', () => {
    const controller1 = createXYPad('space-control');
    controller1.setPosition(0.3, 0.8);

    // Save state
    const savedState = controller1.getState();

    // Create new controller and restore
    const controller2 = new XYPadController();
    controller2.applyState(savedState);

    expect(controller2.getX()).toBe(0.3);
    expect(controller2.getY()).toBe(0.8);
    expect(controller2.getMappings()).toEqual(controller1.getMappings());
  });
});
