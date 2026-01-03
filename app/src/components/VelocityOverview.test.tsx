/**
 * Phase 31H: VelocityOverview Component Tests
 *
 * Tests for the velocity overview visualization.
 * Verifies that velocity dots render correctly and show dynamics.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { VelocityOverview } from './VelocityOverview';
import type { Track } from '../types';
import { MAX_STEPS, STEPS_PER_PAGE } from '../types';

/**
 * Create a test track with default values
 */
function createTestTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: `track-${Date.now()}-${Math.random()}`,
    name: 'Test Track',
    sampleId: 'kick',
    steps: Array(MAX_STEPS).fill(false),
    parameterLocks: Array(MAX_STEPS).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: STEPS_PER_PAGE,
    ...overrides,
  };
}

describe('VelocityOverview', () => {
  describe('basic rendering', () => {
    it('should render nothing when there are no tracks', () => {
      const { container } = render(
        <VelocityOverview tracks={[]} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render the component when there are tracks', () => {
      const track = createTestTrack();

      const { container } = render(
        <VelocityOverview tracks={[track]} />
      );

      expect(container.querySelector('.velocity-overview')).toBeTruthy();
    });

    it('should display correct header with track count', () => {
      const track = createTestTrack();

      const { container } = render(<VelocityOverview tracks={[track]} />);

      expect(container.querySelector('.velocity-overview-info')?.textContent).toContain('1 track');
    });

    it('should display plural "tracks" for multiple tracks', () => {
      const track1 = createTestTrack({ id: 'track-1' });
      const track2 = createTestTrack({ id: 'track-2' });

      const { container } = render(<VelocityOverview tracks={[track1, track2]} />);

      expect(container.querySelector('.velocity-overview-info')?.textContent).toContain('2 tracks');
    });

    it('should display percentage labels on y-axis', () => {
      const track = createTestTrack();

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const labels = container.querySelectorAll('.range-label');
      expect(labels[0].textContent).toBe('100%');
      expect(labels[1].textContent).toBe('50%');
      expect(labels[2].textContent).toBe('0%');
    });
  });

  describe('velocity dot visibility', () => {
    it('should show no velocity dots for a track with no active steps', () => {
      const track = createTestTrack({
        steps: Array(MAX_STEPS).fill(false),
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[track]} />
      );

      const dots = container.querySelectorAll('.velocity-dot');
      expect(dots.length).toBe(0);
    });

    it('should show velocity dots for active steps', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[4] = true;
      steps[8] = true;

      const track = createTestTrack({
        steps,
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[track]} />
      );

      const dots = container.querySelectorAll('.velocity-dot');
      expect(dots.length).toBe(3);
    });

    it('should show dots disappear when steps are deactivated', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[4] = true;

      const track = createTestTrack({
        steps,
        stepCount: 16,
      });

      const { container, rerender } = render(
        <VelocityOverview tracks={[track]} />
      );

      expect(container.querySelectorAll('.velocity-dot').length).toBe(2);

      // Deactivate step 4
      const updatedSteps = [...steps];
      updatedSteps[4] = false;
      const updatedTrack = { ...track, steps: updatedSteps };

      rerender(<VelocityOverview tracks={[updatedTrack]} />);

      expect(container.querySelectorAll('.velocity-dot').length).toBe(1);
    });

    it('should not show dots for muted tracks', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[4] = true;

      const mutedTrack = createTestTrack({
        steps,
        muted: true,
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[mutedTrack]} />
      );

      const dots = container.querySelectorAll('.velocity-dot');
      expect(dots.length).toBe(0);
    });
  });

  describe('velocity levels (color coding)', () => {
    it('should show level-ff class for 100% velocity (no p-lock)', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const track = createTestTrack({
        steps,
        parameterLocks: Array(MAX_STEPS).fill(null), // No p-locks = 100%
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[track]} />
      );

      const dot = container.querySelector('.velocity-dot');
      expect(dot).toBeTruthy();
      expect(dot?.classList.contains('level-ff')).toBe(true);
    });

    it('should show level-mf class for 50% velocity', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { volume: 0.5 };

      const track = createTestTrack({
        steps,
        parameterLocks,
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[track]} />
      );

      const dot = container.querySelector('.velocity-dot');
      expect(dot).toBeTruthy();
      expect(dot?.classList.contains('level-mf')).toBe(true);
    });

    it('should show level-pp class for very soft velocity (<20%)', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { volume: 0.1 };

      const track = createTestTrack({
        steps,
        parameterLocks,
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[track]} />
      );

      const dot = container.querySelector('.velocity-dot');
      expect(dot).toBeTruthy();
      expect(dot?.classList.contains('level-pp')).toBe(true);
    });

    it('should show extreme-low class for very soft velocities', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { volume: 0.15 }; // Below 0.2

      const track = createTestTrack({
        steps,
        parameterLocks,
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[track]} />
      );

      const dot = container.querySelector('.velocity-dot');
      expect(dot).toBeTruthy();
      expect(dot?.classList.contains('extreme-low')).toBe(true);
    });

    it('should show extreme-high class for very loud velocities', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { volume: 0.98 }; // Above 0.95

      const track = createTestTrack({
        steps,
        parameterLocks,
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[track]} />
      );

      const dot = container.querySelector('.velocity-dot');
      expect(dot).toBeTruthy();
      expect(dot?.classList.contains('extreme-high')).toBe(true);
    });
  });

  describe('multi-track aggregation', () => {
    it('should show multiple dots for multiple tracks on the same step', () => {
      const steps1 = Array(MAX_STEPS).fill(false);
      steps1[0] = true;

      const steps2 = Array(MAX_STEPS).fill(false);
      steps2[0] = true;

      const track1 = createTestTrack({
        id: 'track-1',
        steps: steps1,
        stepCount: 16,
      });

      const track2 = createTestTrack({
        id: 'track-2',
        steps: steps2,
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[track1, track2]} />
      );

      // Should show 2 dots (one per track)
      const dots = container.querySelectorAll('.velocity-dot');
      expect(dots.length).toBe(2);
    });

    it('should show has-conflict class when velocity spread is large', () => {
      const steps1 = Array(MAX_STEPS).fill(false);
      steps1[0] = true;

      const steps2 = Array(MAX_STEPS).fill(false);
      steps2[0] = true;

      const pLocks1 = Array(MAX_STEPS).fill(null);
      pLocks1[0] = { volume: 0.2 }; // 20%

      const pLocks2 = Array(MAX_STEPS).fill(null);
      pLocks2[0] = { volume: 0.9 }; // 90% - spread of 70% > 50%

      const track1 = createTestTrack({
        id: 'track-1',
        steps: steps1,
        parameterLocks: pLocks1,
        stepCount: 16,
      });

      const track2 = createTestTrack({
        id: 'track-2',
        steps: steps2,
        parameterLocks: pLocks2,
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[track1, track2]} />
      );

      const cell = container.querySelector('.velocity-dot-cell');
      expect(cell?.classList.contains('has-conflict')).toBe(true);
    });
  });

  describe('step count handling', () => {
    it('should handle different step counts across tracks', () => {
      const steps16 = Array(MAX_STEPS).fill(false);
      steps16[0] = true;

      const steps32 = Array(MAX_STEPS).fill(false);
      steps32[16] = true; // Beyond 16-step track

      const track16 = createTestTrack({
        id: 'track-16',
        steps: steps16,
        stepCount: 16,
      });

      const track32 = createTestTrack({
        id: 'track-32',
        steps: steps32,
        stepCount: 32,
      });

      const { container } = render(
        <VelocityOverview tracks={[track16, track32]} />
      );

      // Should have 32 dot cells (max step count)
      const dotCells = container.querySelectorAll('.velocity-dot-cell');
      expect(dotCells.length).toBe(32);

      // Should have 3 velocity dots:
      // - Step 0: track16 has note (1 dot)
      // - Step 16: track16 wraps (16%16=0 is true) + track32 has note (2 dots)
      const dots = container.querySelectorAll('.velocity-dot');
      expect(dots.length).toBe(3);
    });

    it('should show max step count in header', () => {
      const track32 = createTestTrack({
        id: 'track-32',
        stepCount: 32,
      });

      const track64 = createTestTrack({
        id: 'track-64',
        stepCount: 64,
      });

      const { container } = render(<VelocityOverview tracks={[track32, track64]} />);

      // Should show "0/64 active" for max step count
      expect(container.querySelector('.velocity-overview-info')?.textContent).toContain('0/64 active');
    });

    it('should show correct active step count in header', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[4] = true;
      steps[8] = true;

      const track = createTestTrack({
        steps,
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      expect(container.querySelector('.velocity-overview-info')?.textContent).toContain('3/16 active');
    });
  });

  describe('dynamic range display', () => {
    it('should show velocity range in header when there is variation', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[4] = true;

      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { volume: 0.5 }; // 50%
      parameterLocks[4] = { volume: 1 };   // 100%

      const track = createTestTrack({
        steps,
        parameterLocks,
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      // Should show "50–100%"
      expect(container.querySelector('.velocity-overview-info')?.textContent).toContain('50–100%');
    });

    it('should not show range when all velocities are the same', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      // Only one note = no variation
      const track = createTestTrack({
        steps,
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      // Should not show range when no variation
      expect(container.querySelector('.velocity-overview-info')?.textContent).not.toContain('–');
    });

    it('should show quality warning for very soft notes', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { volume: 0.1 }; // Very soft

      const track = createTestTrack({
        steps,
        parameterLocks,
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      // Should show warning for soft notes
      const warning = container.querySelector('.quality-warning');
      expect(warning).toBeTruthy();
      expect(warning?.textContent).toContain('soft');
    });
  });

  describe('playhead indication', () => {
    it('should highlight current step when playing', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[4] = true;

      const track = createTestTrack({
        steps,
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[track]} currentStep={4} isPlaying={true} />
      );

      const dotCells = container.querySelectorAll('.velocity-dot-cell');
      expect(dotCells[4].classList.contains('playing')).toBe(true);
      expect(dotCells[0].classList.contains('playing')).toBe(false);
    });

    it('should not highlight when not playing', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[4] = true;

      const track = createTestTrack({
        steps,
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[track]} currentStep={4} isPlaying={false} />
      );

      const dotCells = container.querySelectorAll('.velocity-dot-cell');
      expect(dotCells[4].classList.contains('playing')).toBe(false);
    });
  });

  describe('page end markers', () => {
    it('should add page-end class every 16 steps', () => {
      const track = createTestTrack({
        stepCount: 32,
      });

      const { container } = render(
        <VelocityOverview tracks={[track]} />
      );

      const dotCells = container.querySelectorAll('.velocity-dot-cell');

      // Step 15 (index 15) should have page-end class (16th step)
      expect(dotCells[15].classList.contains('page-end')).toBe(true);

      // Step 31 should NOT have page-end (it's the last step)
      expect(dotCells[31].classList.contains('page-end')).toBe(false);
    });
  });

  describe('beat start markers', () => {
    it('should add beat-start class every 4 steps', () => {
      const track = createTestTrack({
        stepCount: 16,
      });

      const { container } = render(
        <VelocityOverview tracks={[track]} />
      );

      const dotCells = container.querySelectorAll('.velocity-dot-cell');

      // Steps 0, 4, 8, 12 should have beat-start class
      expect(dotCells[0].classList.contains('beat-start')).toBe(true);
      expect(dotCells[4].classList.contains('beat-start')).toBe(true);
      expect(dotCells[8].classList.contains('beat-start')).toBe(true);
      expect(dotCells[12].classList.contains('beat-start')).toBe(true);

      // Other steps should not have beat-start
      expect(dotCells[1].classList.contains('beat-start')).toBe(false);
      expect(dotCells[5].classList.contains('beat-start')).toBe(false);
    });
  });

  describe('instrument category', () => {
    it('should show drum class for drum instruments', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const track = createTestTrack({
        sampleId: 'kick',
        steps,
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const dot = container.querySelector('.velocity-dot');
      expect(dot?.classList.contains('drum')).toBe(true);
    });

    it('should show melodic class for melodic instruments', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const track = createTestTrack({
        sampleId: 'synth:lead',
        steps,
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const dot = container.querySelector('.velocity-dot');
      expect(dot?.classList.contains('melodic')).toBe(true);
    });
  });
});
