// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EnvelopeCapability } from '../shared/envelope-capabilities';
import type { TrackEnvelopeV2 } from '../shared/envelope-contract-v2';
import { EnvelopeEditor } from './EnvelopeEditor';

afterEach(cleanup);

const ADSR: TrackEnvelopeV2 = {
  model: 'adsr',
  attack: { value: 0.01, unit: 'seconds' },
  decay: { value: 0.2, unit: 'seconds' },
  sustain: 0.7,
  release: { value: 2, unit: 'steps' },
};

const OSCILLATOR: EnvelopeCapability = {
  models: ['adsr'],
  sustainSource: 'oscillator',
  releaseSource: 'gain-only',
  lockableStages: ['attack', 'decay', 'release'],
  defaultModel: 'adsr',
};

const FINITE_SAMPLE: EnvelopeCapability = {
  models: ['ahd', 'ar'],
  samplePlaybackModes: ['trigger', 'gate'],
  sustainSource: 'finite-buffer',
  releaseSource: 'source-tail',
  lockableStages: ['attack', 'hold', 'decay', 'release'],
  defaultModel: 'ahd',
  defaultPlaybackMode: 'trigger',
};

function renderEditor(overrides: Partial<React.ComponentProps<typeof EnvelopeEditor>> = {}) {
  const props: React.ComponentProps<typeof EnvelopeEditor> = {
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.7, release: 0.5 },
    envelopeV2: ADSR,
    capability: OSCILLATOR,
    overridden: true,
    timeUnit: 'seconds',
    gate: 90,
    onChange: vi.fn(),
    onEnvelopeV2Change: vi.fn(),
    onReset: vi.fn(),
    onTimeUnitChange: vi.fn(),
    onGateChange: vi.fn(),
    ...overrides,
  };
  return { ...render(<EnvelopeEditor {...props} />), props };
}

function expand() {
  fireEvent.click(screen.getByRole('button', { name: /ADSR/ }));
}

describe('EnvelopeEditor v2', () => {
  it('starts as a semantic compact summary and exposes the exact editor on demand', () => {
    renderEditor();

    const summary = screen.getByRole('button', { name: /ADSR/ });
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Override')).toBeDefined();
    expect(screen.getByRole('img', { name: /Attack \/ Decay \/ Sustain \/ Release envelope/ })).toBeDefined();
    expect(screen.queryByRole('combobox', { name: 'Envelope model' })).toBeNull();

    fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Envelope model' })).toBeDefined();
    expect(screen.getByRole('spinbutton', { name: 'Attack exact value' })).toBeDefined();
    expect(screen.getByRole('combobox', { name: 'Release unit' })).toHaveProperty('value', 'st');
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('shows only model-appropriate stages and capability-approved sample behavior', () => {
    renderEditor({
      envelopeV2: {
        model: 'ahd',
        attack: { value: 0.002, unit: 'seconds' },
        hold: { value: 0.5, unit: 'steps' },
        decay: { value: 0.4, unit: 'seconds' },
      },
      capability: FINITE_SAMPLE,
      playbackMode: 'trigger',
      onPlaybackModeChange: vi.fn(),
    });
    fireEvent.click(screen.getByRole('button', { name: /AHD/ }));

    expect(screen.getByRole('spinbutton', { name: 'Attack exact value' })).toBeDefined();
    expect(screen.getByRole('spinbutton', { name: 'Hold exact value' })).toBeDefined();
    expect(screen.getByRole('spinbutton', { name: 'Decay exact value' })).toBeDefined();
    expect(screen.queryByRole('spinbutton', { name: 'Release exact value' })).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: 'Sustain exact value' })).toBeNull();
    expect((screen.getByRole('radio', { name: 'Trigger' }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole('radio', { name: 'Gate' })).toBeDefined();
    expect(screen.queryByRole('radio', { name: 'Loop' })).toBeNull();
    expect((screen.getByRole('slider', { name: 'Gate' }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/Trigger plays the source independently/)).toBeDefined();
  });

  it('previews locally but commits exactly once at pointer-up', () => {
    const onEnvelopeV2Change = vi.fn();
    const onEnvelopePreview = vi.fn();
    renderEditor({ onEnvelopeV2Change, onEnvelopePreview });
    expand();
    const attack = screen.getByRole('slider', { name: 'Attack envelope shape' });

    fireEvent.pointerDown(attack, { pointerId: 1 });
    fireEvent.change(attack, { target: { value: 0.25 } });
    fireEvent.change(attack, { target: { value: 0.5 } });
    fireEvent.change(attack, { target: { value: 0.75 } });

    expect(onEnvelopePreview).toHaveBeenCalledTimes(3);
    expect(onEnvelopeV2Change).not.toHaveBeenCalled();

    fireEvent.pointerUp(attack, { pointerId: 1 });
    expect(onEnvelopeV2Change).toHaveBeenCalledOnce();
    expect(onEnvelopeV2Change.mock.calls[0][0].attack.value).toBeCloseTo(1.6875);
  });

  it('commits pointer cancellation and lost capture exactly once without a duplicate pointer-up', () => {
    const onEnvelopeV2Change = vi.fn();
    const onEnvelopePreview = vi.fn();
    renderEditor({ onEnvelopeV2Change, onEnvelopePreview });
    expand();
    const attack = screen.getByRole('slider', { name: 'Attack envelope shape' });

    fireEvent.pointerDown(attack, { pointerId: 4 });
    fireEvent.change(attack, { target: { value: 0.8 } });
    fireEvent.pointerCancel(attack, { pointerId: 4 });
    fireEvent.lostPointerCapture(attack, { pointerId: 4 });
    fireEvent.pointerUp(attack, { pointerId: 4 });

    expect(onEnvelopeV2Change).toHaveBeenCalledOnce();
    expect(onEnvelopeV2Change.mock.calls[0][0].attack.value).toBeCloseTo(2.048);

    onEnvelopeV2Change.mockClear();
    fireEvent.pointerDown(attack, { pointerId: 5 });
    fireEvent.change(attack, { target: { value: 0.6 } });
    fireEvent.lostPointerCapture(attack, { pointerId: 5 });
    fireEvent.pointerUp(attack, { pointerId: 5 });
    fireEvent.pointerCancel(attack, { pointerId: 5 });

    expect(onEnvelopeV2Change).toHaveBeenCalledOnce();
    expect(onEnvelopeV2Change.mock.calls[0][0].attack.value).toBeCloseTo(0.864);
  });

  it('rolls Escape back to the pointer baseline without committing', () => {
    const onEnvelopeV2Change = vi.fn();
    const onEnvelopePreview = vi.fn();
    renderEditor({ onEnvelopeV2Change, onEnvelopePreview });
    expand();
    const attack = screen.getByRole('slider', { name: 'Attack envelope shape' });

    fireEvent.pointerDown(attack, { pointerId: 6 });
    fireEvent.change(attack, { target: { value: 0.6 } });
    fireEvent.keyDown(attack, { key: 'Escape' });
    fireEvent.lostPointerCapture(attack, { pointerId: 6 });
    fireEvent.pointerUp(attack, { pointerId: 6 });
    expect(onEnvelopeV2Change).not.toHaveBeenCalled();
    expect(onEnvelopePreview.mock.calls.at(-1)?.[0]).toEqual(ADSR);
  });

  it('converts a single stage between exact ms, seconds, and step units', () => {
    const onEnvelopeV2Change = vi.fn();
    renderEditor({ onEnvelopeV2Change, bpm: 120 });
    expand();

    const attackUnit = screen.getByRole('combobox', { name: 'Attack unit' });
    expect(attackUnit).toHaveProperty('value', 'ms');
    fireEvent.change(attackUnit, { target: { value: 'st' } });

    expect(onEnvelopeV2Change).toHaveBeenCalledOnce();
    expect(onEnvelopeV2Change.mock.calls[0][0].attack).toEqual({ value: 0.08, unit: 'steps' });
    expect(onEnvelopeV2Change.mock.calls[0][0].release).toEqual({ value: 2, unit: 'steps' });
  });

  it('requests one atomic mutation when converting every timed stage', () => {
    const onConvertAllUnits = vi.fn();
    const onEnvelopeV2Change = vi.fn();
    renderEditor({ onConvertAllUnits, onEnvelopeV2Change });
    expand();

    fireEvent.click(screen.getByRole('button', { name: 'All to steps' }));

    expect(onConvertAllUnits).toHaveBeenCalledOnce();
    expect(onConvertAllUnits).toHaveBeenCalledWith('steps');
    expect(onEnvelopeV2Change).not.toHaveBeenCalled();
  });

  it('updates exact fields when an authoritative whole-envelope conversion changes canonical units', () => {
    const view = renderEditor({ onConvertAllUnits: vi.fn() });
    expand();
    expect(screen.getByRole('combobox', { name: 'Attack unit' })).toHaveProperty('value', 'ms');

    view.rerender(<EnvelopeEditor
      {...view.props}
      envelopeV2={{
        ...ADSR,
        attack: { value: 0.08, unit: 'steps' },
        decay: { value: 1.6, unit: 'steps' },
      }}
    />);

    expect(screen.getByRole('combobox', { name: 'Attack unit' })).toHaveProperty('value', 'st');
    expect(screen.getByRole('spinbutton', { name: 'Attack exact value' })).toHaveProperty('value', '0.08');
  });

  it('retains and explains an inactive authored model while offering Reset', () => {
    const onReset = vi.fn();
    renderEditor({
      capability: FINITE_SAMPLE,
      inactiveReason: 'ADSR is retained but this finite sample has no validated sustain loop.',
      onReset,
    });

    expect(screen.getByText('Inactive')).toBeDefined();
    expand();
    expect(screen.getByText(/ADSR is retained.*no validated sustain loop/)).toBeDefined();
    expect(screen.getByRole('option', { name: /inactive/ })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it('adapts a legacy track to seconds when no v2 callback is available', () => {
    const onChange = vi.fn();
    const onTimeUnitChange = vi.fn();
    renderEditor({
      envelopeV2: undefined,
      timeUnit: 'steps',
      onEnvelopeV2Change: undefined,
      onChange,
      onTimeUnitChange,
      bpm: 120,
    });
    expand();
    const sustain = screen.getByRole('slider', { name: 'Sustain envelope shape' });
    fireEvent.pointerDown(sustain, { pointerId: 2 });
    fireEvent.change(sustain, { target: { value: 0.4 } });
    fireEvent.pointerUp(sustain, { pointerId: 2 });

    expect(onTimeUnitChange).toHaveBeenCalledWith('seconds');
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ sustain: 0.4 }));
  });
});
