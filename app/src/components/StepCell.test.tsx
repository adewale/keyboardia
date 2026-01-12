/**
 * StepCell Unit Tests
 *
 * Tests for StepCell component rendering, tooltip generation, and accessibility.
 * Replaces E2E tests in e2e/plock-editor.spec.ts and e2e/accessibility.spec.ts
 * that only checked tooltip attributes and accessibility properties.
 *
 * @see src/components/StepCell.tsx
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { StepCell } from './StepCell';

// Clean up after each test to prevent element accumulation
afterEach(() => {
  cleanup();
});

// Mock the useLongPress hook to simplify testing
vi.mock('../hooks/useLongPress', () => ({
  useLongPress: () => ({
    onPointerDown: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerLeave: vi.fn(),
    onPointerCancel: vi.fn(),
  }),
}));

describe('StepCell', () => {
  const defaultProps = {
    active: false,
    playing: false,
    stepIndex: 0,
    parameterLock: null,
    swing: 0,
    selected: false,
    onClick: vi.fn(),
    onSelect: vi.fn(),
  };

  describe('Tooltip Content Generation', () => {
    it('SC-T01: inactive step has no tooltip', () => {
      render(<StepCell {...defaultProps} active={false} />);
      const button = screen.getByRole('button');
      expect(button.getAttribute('title')).toBeNull();
    });

    it('SC-T02: active step shows step number in tooltip', () => {
      render(<StepCell {...defaultProps} active={true} stepIndex={0} />);
      const button = screen.getByRole('button');
      expect(button.getAttribute('title')).toContain('Step 1');
    });

    it('SC-T03: active step shows pitch 0 correctly', () => {
      render(<StepCell {...defaultProps} active={true} />);
      const button = screen.getByRole('button');
      expect(button.getAttribute('title')).toContain('Pitch: 0');
    });

    it('SC-T04: active step shows positive pitch with + sign', () => {
      render(
        <StepCell
          {...defaultProps}
          active={true}
          parameterLock={{ pitch: 5 }}
        />
      );
      const button = screen.getByRole('button');
      expect(button.getAttribute('title')).toContain('Pitch: +5');
    });

    it('SC-T05: active step shows negative pitch with - sign', () => {
      render(
        <StepCell
          {...defaultProps}
          active={true}
          parameterLock={{ pitch: -3 }}
        />
      );
      const button = screen.getByRole('button');
      expect(button.getAttribute('title')).toContain('Pitch: -3');
    });

    it('SC-T06: active step shows volume as percentage', () => {
      render(<StepCell {...defaultProps} active={true} />);
      const button = screen.getByRole('button');
      expect(button.getAttribute('title')).toContain('Vol: 100%');
    });

    it('SC-T07: active step shows reduced volume percentage', () => {
      render(
        <StepCell
          {...defaultProps}
          active={true}
          parameterLock={{ volume: 0.5 }}
        />
      );
      const button = screen.getByRole('button');
      expect(button.getAttribute('title')).toContain('Vol: 50%');
    });

    it('SC-T08: tooltip includes edit instruction', () => {
      render(<StepCell {...defaultProps} active={true} />);
      const button = screen.getByRole('button');
      expect(button.getAttribute('title')).toContain('Shift+Click to edit');
    });

    it('SC-T09: tied step shows tie indicator in tooltip', () => {
      render(
        <StepCell
          {...defaultProps}
          active={true}
          parameterLock={{ tie: true }}
        />
      );
      const button = screen.getByRole('button');
      expect(button.getAttribute('title')).toContain('Tied');
    });

    it('SC-T10: step 10 shows Step 10 in tooltip (1-indexed)', () => {
      render(<StepCell {...defaultProps} active={true} stepIndex={9} />);
      const button = screen.getByRole('button');
      expect(button.getAttribute('title')).toContain('Step 10');
    });
  });

  describe('Accessibility Attributes', () => {
    it('SC-A01: renders as a button element', () => {
      render(<StepCell {...defaultProps} />);
      const button = screen.getByRole('button');
      expect(button).toBeDefined();
    });

    it('SC-A02: has aria-label with step number', () => {
      render(<StepCell {...defaultProps} stepIndex={0} />);
      const button = screen.getByRole('button');
      expect(button.getAttribute('aria-label')).toContain('Step 1');
    });

    it('SC-A03: aria-label indicates inactive state', () => {
      render(<StepCell {...defaultProps} active={false} />);
      const button = screen.getByRole('button');
      expect(button.getAttribute('aria-label')).toContain('inactive');
    });

    it('SC-A04: aria-label indicates active state', () => {
      render(<StepCell {...defaultProps} active={true} />);
      const button = screen.getByRole('button');
      expect(button.getAttribute('aria-label')).toContain('active');
    });

    it('SC-A05: aria-label indicates parameter lock presence', () => {
      render(
        <StepCell
          {...defaultProps}
          active={true}
          parameterLock={{ pitch: 5 }}
        />
      );
      const button = screen.getByRole('button');
      expect(button.getAttribute('aria-label')).toContain('has parameter lock');
    });

    it('SC-A06: has data-step-index attribute', () => {
      render(<StepCell {...defaultProps} stepIndex={7} />);
      const button = screen.getByRole('button');
      expect(button.getAttribute('data-step-index')).toBe('7');
    });
  });

  describe('CSS Classes', () => {
    it('SC-C01: has step-cell base class', () => {
      render(<StepCell {...defaultProps} />);
      const button = screen.getByRole('button');
      expect(button.classList.contains('step-cell')).toBe(true);
    });

    it('SC-C02: has active class when active', () => {
      render(<StepCell {...defaultProps} active={true} />);
      const button = screen.getByRole('button');
      expect(button.classList.contains('active')).toBe(true);
    });

    it('SC-C03: has playing class when playing', () => {
      render(<StepCell {...defaultProps} playing={true} />);
      const button = screen.getByRole('button');
      expect(button.classList.contains('playing')).toBe(true);
    });

    it('SC-C04: has beat-start class on beat boundaries', () => {
      render(<StepCell {...defaultProps} stepIndex={0} />);
      const button = screen.getByRole('button');
      expect(button.classList.contains('beat-start')).toBe(true);
    });

    it('SC-C05: no beat-start class on non-beat steps', () => {
      render(<StepCell {...defaultProps} stepIndex={1} />);
      const button = screen.getByRole('button');
      expect(button.classList.contains('beat-start')).toBe(false);
    });

    it('SC-C06: has selected class when selected', () => {
      render(<StepCell {...defaultProps} selected={true} />);
      const button = screen.getByRole('button');
      expect(button.classList.contains('selected')).toBe(true);
    });

    it('SC-C07: has has-lock class when has parameter lock', () => {
      render(
        <StepCell
          {...defaultProps}
          parameterLock={{ pitch: 5 }}
        />
      );
      const button = screen.getByRole('button');
      expect(button.classList.contains('has-lock')).toBe(true);
    });

    it('SC-C08: has dimmed class when dimmed', () => {
      render(<StepCell {...defaultProps} dimmed={true} />);
      const button = screen.getByRole('button');
      expect(button.classList.contains('dimmed')).toBe(true);
    });
  });

  describe('Lock Badges', () => {
    it('SC-L01: shows pitch badge for positive pitch lock', () => {
      render(
        <StepCell
          {...defaultProps}
          parameterLock={{ pitch: 5 }}
        />
      );
      const badge = screen.getByText('↑');
      expect(badge.classList.contains('pitch')).toBe(true);
      expect(badge.getAttribute('title')).toContain('Pitch: +5');
    });

    it('SC-L02: shows pitch badge for negative pitch lock', () => {
      render(
        <StepCell
          {...defaultProps}
          parameterLock={{ pitch: -3 }}
        />
      );
      const badge = screen.getByText('↓');
      expect(badge.classList.contains('pitch')).toBe(true);
      expect(badge.getAttribute('title')).toContain('Pitch: -3');
    });

    it('SC-L03: shows volume badge for volume lock < 1', () => {
      render(
        <StepCell
          {...defaultProps}
          parameterLock={{ volume: 0.5 }}
        />
      );
      const badge = screen.getByText('−');
      expect(badge.classList.contains('volume')).toBe(true);
      expect(badge.getAttribute('title')).toContain('Volume: 50%');
    });

    it('SC-L04: shows tie badge for tied notes', () => {
      render(
        <StepCell
          {...defaultProps}
          parameterLock={{ tie: true }}
        />
      );
      const badge = screen.getByText('⌒');
      expect(badge.classList.contains('tie')).toBe(true);
    });
  });
});
