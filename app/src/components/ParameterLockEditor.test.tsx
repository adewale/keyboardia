// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ParameterLockEditor } from './ParameterLockEditor';

afterEach(cleanup);

function renderEditor(overrides: Partial<ComponentProps<typeof ParameterLockEditor>> = {}) {
  const props: ComponentProps<typeof ParameterLockEditor> = {
    step: 0,
    lock: { pitch: 4 },
    onPitchChange: vi.fn(),
    onVolumeChange: vi.fn(),
    onTieToggle: vi.fn(),
    onClearLock: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ParameterLockEditor {...props} />) };
}

describe('ParameterLockEditor accessibility', () => {
  it('keeps the destructive clear action visibly labeled', () => {
    const { props } = renderEditor();

    const clearButton = screen.getByRole('button', { name: 'Clear lock' });
    expect(clearButton.textContent).toContain('Clear lock');

    fireEvent.click(clearButton);
    expect(props.onClearLock).toHaveBeenCalledOnce();
  });

  it('does not render the clear action when no parameter is locked', () => {
    renderEditor({ lock: null });
    expect(screen.queryByRole('button', { name: 'Clear lock' })).toBeNull();
  });

  it('associates names with both sliders', () => {
    renderEditor();
    expect(screen.getByRole('slider', { name: 'Pitch' })).toBeDefined();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeDefined();
  });

  it('exposes tie as a visibly labeled pressed toggle', () => {
    const { props } = renderEditor({ step: 1, lock: { tie: true } });
    const tie = screen.getByRole('button', { name: 'Tie' });

    expect(tie.textContent).toContain('Tie');
    expect(tie.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(tie);
    expect(props.onTieToggle).toHaveBeenCalledOnce();
  });

  it('describes an out-of-range pitch as silent', () => {
    renderEditor({ sampleId: 'sampled:808-kick', transpose: 24, lock: { pitch: 24 } });
    const pitch = screen.getByRole('slider', { name: 'Pitch' });
    const descriptionId = pitch.getAttribute('aria-describedby');

    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toMatch(/outside.*playable range.*silent/i);
  });
});

describe('ParameterLockEditor envelope v2 locks', () => {
  it('shows only the active, capability-approved timed stages including Hold', () => {
    renderEditor({
      envelopeStages: ['attack', 'hold', 'decay'],
      onEnvelopeLockChange: vi.fn(),
    });

    expect(screen.getByRole('spinbutton', { name: 'Attack envelope lock value' })).toBeDefined();
    expect(screen.getByRole('spinbutton', { name: 'Hold envelope lock value' })).toBeDefined();
    expect(screen.getByRole('spinbutton', { name: 'Decay envelope lock value' })).toBeDefined();
    expect(screen.queryByRole('spinbutton', { name: 'Release envelope lock value' })).toBeNull();
  });

  it('commits an exact typed duration once when editing finishes', () => {
    const onEnvelopeLockChange = vi.fn();
    renderEditor({
      lock: { holdDuration: { value: 1, unit: 'steps' } },
      envelopeStages: ['hold'],
      onEnvelopeLockChange,
    });
    const hold = screen.getByRole('spinbutton', { name: 'Hold envelope lock value' });

    fireEvent.change(hold, { target: { value: '2.5' } });
    expect(onEnvelopeLockChange).not.toHaveBeenCalled();
    fireEvent.blur(hold);

    expect(onEnvelopeLockChange).toHaveBeenCalledOnce();
    expect(onEnvelopeLockChange).toHaveBeenCalledWith('hold', { value: 2.5, unit: 'steps' });
  });

  it('preserves wall-clock time when a lock switches unit', () => {
    const onEnvelopeLockChange = vi.fn();
    renderEditor({
      lock: { attackDuration: { value: 0.5, unit: 'seconds' } },
      envelopeStages: ['attack'],
      bpm: 120,
      onEnvelopeLockChange,
    });

    fireEvent.change(screen.getByRole('combobox', { name: 'Attack envelope lock unit' }), {
      target: { value: 'steps' },
    });

    expect(onEnvelopeLockChange).toHaveBeenCalledOnce();
    expect(onEnvelopeLockChange).toHaveBeenCalledWith('attack', { value: 4, unit: 'steps' });
  });

  it('displays legacy numeric locks without rewriting them until edited', () => {
    const onEnvelopeLockChange = vi.fn();
    renderEditor({
      lock: { attack: 0.25 },
      envelopeStages: ['attack'],
      envelopeTimeUnit: 'steps',
      onEnvelopeLockChange,
    });
    const attack = screen.getByRole('spinbutton', { name: 'Attack envelope lock value' });

    expect((attack as HTMLInputElement).value).toBe('0.25');
    expect(screen.getByText('Legacy')).toBeDefined();
    expect(onEnvelopeLockChange).not.toHaveBeenCalled();

    fireEvent.change(attack, { target: { value: '0.5' } });
    fireEvent.blur(attack);
    expect(onEnvelopeLockChange).toHaveBeenCalledWith('attack', { value: 0.5, unit: 'steps' });
  });

  it('clears a typed lock with one discrete mutation', () => {
    const onEnvelopeLockChange = vi.fn();
    renderEditor({
      lock: { releaseDuration: { value: 1, unit: 'seconds' } },
      envelopeStages: ['release'],
      onEnvelopeLockChange,
    });
    const release = screen.getByRole('spinbutton', { name: 'Release envelope lock value' });

    fireEvent.change(release, { target: { value: '' } });
    fireEvent.blur(release);

    expect(onEnvelopeLockChange).toHaveBeenCalledOnce();
    expect(onEnvelopeLockChange).toHaveBeenCalledWith('release', undefined);
  });
});
