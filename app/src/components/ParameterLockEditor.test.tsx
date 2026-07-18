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
  it('names the icon-only clear action and invokes the clear callback', () => {
    const { props } = renderEditor();

    const clearButton = screen.getByRole('button', { name: 'Clear parameter lock' });
    expect(clearButton.getAttribute('title')).toBe('Clear parameter lock');

    fireEvent.click(clearButton);
    expect(props.onClearLock).toHaveBeenCalledOnce();
  });

  it('does not render the clear action when no parameter is locked', () => {
    renderEditor({ lock: null });
    expect(screen.queryByRole('button', { name: 'Clear parameter lock' })).toBeNull();
  });
});
