import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { XYPadController, XY_PAD_PRESETS } from './xyPad';

const presetId = fc.constantFrom(...Object.keys(XY_PAD_PRESETS));
const normalized = fc.double({ min: 0, max: 1, noNaN: true });

describe('XYPadController production properties', () => {
  it('clamps every requested position before mapping it', () => {
    fc.assert(fc.property(
      presetId,
      fc.double({ min: -10, max: 10, noNaN: true }),
      fc.double({ min: -10, max: 10, noNaN: true }),
      (preset, x, y) => {
        const controller = new XYPadController(preset);
        controller.setPosition(x, y);
        expect(controller.getX()).toBe(Math.max(0, Math.min(1, x)));
        expect(controller.getY()).toBe(Math.max(0, Math.min(1, y)));
      },
    ));
  });

  it('emits every mapping in the active production preset exactly once per update', () => {
    fc.assert(fc.property(presetId, normalized, normalized, (preset, x, y) => {
      const controller = new XYPadController(preset);
      const callback = vi.fn();
      controller.setCallback(callback);
      controller.setPosition(x, y);

      const emitted = callback.mock.calls.map(([parameter]) => parameter);
      const expected = XY_PAD_PRESETS[preset].mappings.map(mapping => mapping.parameter);
      expect(emitted).toEqual(expected);
    }));
  });

  it('serializes and restores the active mappings and position', () => {
    fc.assert(fc.property(presetId, normalized, normalized, (preset, x, y) => {
      const original = new XYPadController(preset);
      original.setPosition(x, y);

      const restored = new XYPadController();
      restored.applyState(original.getState());

      expect(restored.getState()).toEqual(original.getState());
      expect(restored.getAllParameterValues()).toEqual(original.getAllParameterValues());
    }));
  });

  it('replaces old mappings when a new preset is loaded', () => {
    const controller = new XYPadController('filter-sweep');
    controller.loadPreset('lfo-control');
    expect(controller.getMappings()).toEqual(XY_PAD_PRESETS['lfo-control'].mappings);
    expect(controller.getAllParameterValues()).not.toHaveProperty('filterFrequency');
  });
});
