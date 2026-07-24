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
