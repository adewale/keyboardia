import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { EffectsPanel } from './EffectsPanel';
import type { EffectsState } from '../audio/toneEffects';

/**
 * Verification Tests for EffectsPanel
 *
 * Per specs/SYNTHESIS-ENGINE.md Section 8.1 and 9.3:
 * - EffectsPanel should display all 4 effects (reverb, delay, chorus, distortion)
 * - Each effect should have wet/mix control
 * - Reverb: decay slider
 * - Delay: time dropdown, feedback slider
 * - Chorus: rate slider, depth slider
 * - Distortion: drive slider
 * - Changes should call onEffectsChange callback
 * - Panel should be disabled when disabled prop is true
 */

// Mock the audio engine
vi.mock('../audio/engine', () => ({
  audioEngine: {
    setReverbWet: vi.fn(),
    setReverbDecay: vi.fn(),
    setDelayWet: vi.fn(),
    setDelayTime: vi.fn(),
    setDelayFeedback: vi.fn(),
    setChorusWet: vi.fn(),
    setChorusFrequency: vi.fn(),
    setChorusDepth: vi.fn(),
    setDistortionWet: vi.fn(),
    setDistortionAmount: vi.fn(),
    applyEffectsState: vi.fn(),
    isToneInitialized: vi.fn(() => true), // Phase 22: Mock as initialized
  },
}));

const DEFAULT_EFFECTS: EffectsState = {
  reverb: { decay: 2.0, wet: 0 },
  delay: { time: '8n', feedback: 0.3, wet: 0 },
  chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
  distortion: { amount: 0.4, wet: 0 },
};

// Helper to get the FX toggle button
function getToggleButton() {
  return screen.getByRole('button', { name: 'FX' });
}

describe('EffectsPanel', () => {
  let mockOnEffectsChange: (effects: EffectsState) => void;

  beforeEach(() => {
    mockOnEffectsChange = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('rendering', () => {
    it('renders the FX toggle button', () => {
      render(<EffectsPanel />);
      const button = getToggleButton();
      expect(button).toBeTruthy();
    });

    it('shows FX text in toggle button', () => {
      render(<EffectsPanel />);
      const button = getToggleButton();
      expect(button.textContent).toContain('FX');
    });

    it('does not show effects panel by default (collapsed)', () => {
      render(<EffectsPanel />);
      const reverbText = screen.queryByText('Reverb');
      expect(reverbText).toBeNull();
    });

    it('expands to show all 4 effects when clicked', () => {
      render(<EffectsPanel />);
      fireEvent.click(getToggleButton());

      expect(screen.getByText('Reverb')).toBeTruthy();
      expect(screen.getByText('Delay')).toBeTruthy();
      expect(screen.getByText('Chorus')).toBeTruthy();
      expect(screen.getByText('Distortion')).toBeTruthy();
    });
  });

  describe('Section 9.3: Effects Controls', () => {
    beforeEach(() => {
      render(
        <EffectsPanel
          initialState={DEFAULT_EFFECTS}
          onEffectsChange={mockOnEffectsChange}
        />
      );
      // Expand the panel
      fireEvent.click(getToggleButton());
    });

    it('has reverb controls: Mix and Decay', () => {
      // Find reverb section
      const reverbLabel = screen.getByText('Reverb');
      expect(reverbLabel).toBeTruthy();

      // Should have Mix and Decay labels
      const mixLabels = screen.getAllByText('Mix');
      expect(mixLabels.length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Decay')).toBeTruthy();
    });

    it('has delay controls: Mix, Time dropdown, Feedback', () => {
      expect(screen.getByText('Delay')).toBeTruthy();
      expect(screen.getByText('Time')).toBeTruthy();
      expect(screen.getByText('Feedback')).toBeTruthy();
    });

    it('has chorus controls: Mix, Rate, Depth', () => {
      expect(screen.getByText('Chorus')).toBeTruthy();
      expect(screen.getByText('Rate')).toBeTruthy();
      const depthLabels = screen.getAllByText('Depth');
      expect(depthLabels.length).toBeGreaterThanOrEqual(1);
    });

    it('has distortion controls: Mix, Drive', () => {
      expect(screen.getByText('Distortion')).toBeTruthy();
      expect(screen.getByText('Drive')).toBeTruthy();
    });

    it('delay time has musical notation options (8n, 4n, 16n)', () => {
      const timeSelect = screen.getByRole('combobox');
      expect(timeSelect).toBeTruthy();

      // Check some options exist
      const options = screen.getAllByRole('option');
      const optionValues = options.map(o => o.getAttribute('value'));
      expect(optionValues).toContain('8n');
      expect(optionValues).toContain('4n');
      expect(optionValues).toContain('16n');
    });
  });

  describe('Section 9.9: Published Session Behavior', () => {
    it('disables all controls when disabled prop is true', () => {
      render(<EffectsPanel disabled={true} />);

      const toggleButton = getToggleButton() as HTMLButtonElement;
      expect(toggleButton.disabled).toBe(true);
    });

    it('shows disabled state visually', () => {
      const { container } = render(<EffectsPanel disabled={true} />);
      const panel = container.querySelector('.effects-panel.disabled');
      expect(panel).toBeTruthy();
    });
  });

  describe('Section 8.1: Effects Chain behavior', () => {
    it('shows indicator when effects are active (wet > 0)', () => {
      const activeEffects: EffectsState = {
        ...DEFAULT_EFFECTS,
        reverb: { decay: 2.0, wet: 0.5 }, // Active
      };

      const { container } = render(<EffectsPanel initialState={activeEffects} />);
      const indicator = container.querySelector('.effects-indicator');
      expect(indicator).toBeTruthy();
    });

    it('does not show indicator when all effects are dry', () => {
      const { container } = render(<EffectsPanel initialState={DEFAULT_EFFECTS} />);
      const indicator = container.querySelector('.effects-indicator');
      expect(indicator).toBeNull();
    });
  });

  describe('callback behavior', () => {
    it('calls onEffectsChange when reverb wet is changed', () => {
      render(
        <EffectsPanel
          initialState={DEFAULT_EFFECTS}
          onEffectsChange={mockOnEffectsChange}
        />
      );

      // Expand panel
      fireEvent.click(getToggleButton());

      // Find and change a slider
      const sliders = screen.getAllByRole('slider');
      fireEvent.change(sliders[0], { target: { value: '0.5' } });

      expect(mockOnEffectsChange).toHaveBeenCalled();
    });
  });

  describe('initial state', () => {
    it('reflects initialState prop values', () => {
      const customState: EffectsState = {
        reverb: { decay: 5.0, wet: 0.7 },
        delay: { time: '4n', feedback: 0.5, wet: 0.3 },
        chorus: { frequency: 2.0, depth: 0.8, wet: 0.4 },
        distortion: { amount: 0.6, wet: 0.2 },
      };

      render(<EffectsPanel initialState={customState} />);

      // Expand panel
      fireEvent.click(getToggleButton());

      // Check that 70% is displayed for reverb wet
      expect(screen.getByText('70%')).toBeTruthy();
    });
  });
});

describe('EffectsPanel Section 9.5.1 Alignment', () => {
  afterEach(() => {
    cleanup();
  });

  it('UI surface exists - EffectsPanel component renders', () => {
    const { container } = render(<EffectsPanel />);
    const panel = container.querySelector('.effects-panel');
    expect(panel).toBeTruthy();
  });

  it('State surface - accepts EffectsState as initialState', () => {
    const state: EffectsState = {
      reverb: { decay: 2.0, wet: 0 },
      delay: { time: '8n', feedback: 0.3, wet: 0 },
      chorus: { frequency: 1.5, depth: 0.5, wet: 0 },
      distortion: { amount: 0.4, wet: 0 },
    };

    // Should not throw
    expect(() => render(<EffectsPanel initialState={state} />)).not.toThrow();
  });

  it('API surface - calls audioEngine methods on change', async () => {
    const { audioEngine } = await import('../audio/engine');

    render(<EffectsPanel initialState={DEFAULT_EFFECTS} />);

    // Expand panel
    fireEvent.click(getToggleButton());

    // Change a slider
    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[0], { target: { value: '0.5' } });

    // Should have called audio engine
    expect(audioEngine.setReverbWet).toHaveBeenCalled();
  });
});
