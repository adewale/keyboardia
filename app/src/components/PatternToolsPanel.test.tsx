// @vitest-environment jsdom
/**
 * PatternToolsPanel: the pattern tools in the editor dock's Track pane
 * (specs/PIANO-ROLL-DOCK.md, phase 7). StepSequencer.dock.test.tsx covers the
 * dock's wiring; this pins the panel's own contract.
 */
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PatternToolsPanel } from './PatternToolsPanel';

afterEach(cleanup);

function renderPanel(overrides: Partial<ComponentProps<typeof PatternToolsPanel>> = {}) {
  const props: ComponentProps<typeof PatternToolsPanel> = {
    hasSteps: true,
    stepCount: 16,
    activeStepCount: 4,
    swing: 0,
    onRotate: vi.fn(),
    onInvert: vi.fn(),
    onReverse: vi.fn(),
    onMirror: vi.fn(),
    onEuclideanFill: vi.fn(),
    onSwingChange: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<PatternToolsPanel {...props} />) };
}

describe('PatternToolsPanel', () => {
  it('reports each tool', () => {
    const { props } = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Rotate pattern left' }));
    expect(props.onRotate).toHaveBeenCalledWith('left');
    fireEvent.click(screen.getByRole('button', { name: 'Invert pattern' }));
    expect(props.onInvert).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Smart mirror pattern' }));
    expect(props.onMirror).toHaveBeenCalledOnce();
    fireEvent.change(screen.getByRole('slider', { name: 'Euclidean hits' }), { target: { value: '5' } });
    expect(props.onEuclideanFill).toHaveBeenCalledWith(5);
    fireEvent.change(screen.getByRole('slider', { name: 'Track swing' }), { target: { value: '30' } });
    expect(props.onSwingChange).toHaveBeenCalledWith(30);
  });

  it('disables the tools that need steps on an empty track, but not Invert', () => {
    renderPanel({ hasSteps: false, activeStepCount: 0 });

    expect(screen.getByRole('button', { name: 'Rotate pattern right' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Reverse pattern' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Invert pattern' }).hasAttribute('disabled')).toBe(false);
  });

  it('disables every control in a published session', () => {
    renderPanel({ disabled: true });

    const controls = [...screen.getAllByRole('button'), ...screen.getAllByRole('slider')];
    expect(controls).toHaveLength(7);
    for (const control of controls) expect(control.hasAttribute('disabled')).toBe(true);
  });
});
