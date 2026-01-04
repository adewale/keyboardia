/**
 * Phase 31H: VelocityOverview Component Tests (Simplified)
 *
 * Tests for the simplified accent pattern visualization.
 * Verifies that accent markers (★ accent, ○ ghost, · normal) render correctly.
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

    it('should display title "Velocity"', () => {
      const track = createTestTrack();

      const { container } = render(<VelocityOverview tracks={[track]} />);

      expect(container.querySelector('.velocity-overview-title')?.textContent).toBe('Velocity');
    });

    it('should show "No dynamics variation" when all notes are in normal range', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[4] = true;

      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { volume: 0.6 }; // normal range
      parameterLocks[4] = { volume: 0.7 }; // normal range

      const track = createTestTrack({
        steps,
        parameterLocks,
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      // No accents, no ghosts = "No dynamics variation"
      expect(container.querySelector('.velocity-overview-info')?.textContent).toContain('No dynamics variation');
    });
  });

  describe('accent strip rendering', () => {
    it('should render accent cells for each step', () => {
      const track = createTestTrack({ stepCount: 16 });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const cells = container.querySelectorAll('.accent-cell');
      expect(cells.length).toBe(16);
    });

    it('should show empty cells for steps with no active notes', () => {
      const track = createTestTrack({
        steps: Array(MAX_STEPS).fill(false),
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const cells = container.querySelectorAll('.accent-cell');
      expect(cells[0].classList.contains('empty')).toBe(true);
    });
  });

  describe('accent type classification', () => {
    it('should show accent (★) for loud notes (>80%)', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { volume: 0.9 }; // 90% > 80%

      const track = createTestTrack({
        steps,
        parameterLocks,
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const cell = container.querySelectorAll('.accent-cell')[0];
      expect(cell.classList.contains('accent')).toBe(true);

      const symbol = cell.querySelector('.accent-symbol');
      expect(symbol?.textContent).toBe('★');
    });

    it('should show accent for default velocity (100%)', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const track = createTestTrack({
        steps,
        parameterLocks: Array(MAX_STEPS).fill(null), // No p-lock = 100%
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const cell = container.querySelectorAll('.accent-cell')[0];
      expect(cell.classList.contains('accent')).toBe(true);
    });

    it('should show ghost (○) for quiet notes (<40%)', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { volume: 0.3 }; // 30% < 40%

      const track = createTestTrack({
        steps,
        parameterLocks,
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const cell = container.querySelectorAll('.accent-cell')[0];
      expect(cell.classList.contains('ghost')).toBe(true);

      const symbol = cell.querySelector('.accent-symbol');
      expect(symbol?.textContent).toBe('○');
    });

    it('should show normal (·) for mid-range notes (40-80%)', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { volume: 0.6 }; // 60% in normal range

      const track = createTestTrack({
        steps,
        parameterLocks,
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const cell = container.querySelectorAll('.accent-cell')[0];
      expect(cell.classList.contains('normal')).toBe(true);

      const symbol = cell.querySelector('.accent-symbol');
      expect(symbol?.textContent).toBe('·');
    });
  });

  describe('header summary', () => {
    it('should show accent count in header', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true; // 100% = accent
      steps[4] = true; // 100% = accent
      steps[8] = true; // 100% = accent

      const track = createTestTrack({
        steps,
        parameterLocks: Array(MAX_STEPS).fill(null),
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      expect(container.querySelector('.velocity-overview-info')?.textContent).toContain('★ 3 accents');
    });

    it('should show ghost count in header', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[4] = true;

      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { volume: 0.2 }; // ghost
      parameterLocks[4] = { volume: 0.3 }; // ghost

      const track = createTestTrack({
        steps,
        parameterLocks,
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      expect(container.querySelector('.velocity-overview-info')?.textContent).toContain('○ 2 ghosts');
    });

    it('should show singular "accent" for 1 accent', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const track = createTestTrack({
        steps,
        parameterLocks: Array(MAX_STEPS).fill(null),
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      expect(container.querySelector('.velocity-overview-info')?.textContent).toContain('★ 1 accent');
      expect(container.querySelector('.velocity-overview-info')?.textContent).not.toContain('accents');
    });
  });

  describe('multi-track aggregation', () => {
    it('should show accent if ANY track is loud on that step', () => {
      const steps1 = Array(MAX_STEPS).fill(false);
      steps1[0] = true;

      const steps2 = Array(MAX_STEPS).fill(false);
      steps2[0] = true;

      const pLocks1 = Array(MAX_STEPS).fill(null);
      pLocks1[0] = { volume: 0.3 }; // quiet

      const pLocks2 = Array(MAX_STEPS).fill(null);
      pLocks2[0] = { volume: 0.9 }; // loud

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

      const { container } = render(<VelocityOverview tracks={[track1, track2]} />);

      // Should be accent because track2 is >80%
      const cell = container.querySelectorAll('.accent-cell')[0];
      expect(cell.classList.contains('accent')).toBe(true);
    });

    it('should show ghost only if ALL tracks are quiet on that step', () => {
      const steps1 = Array(MAX_STEPS).fill(false);
      steps1[0] = true;

      const steps2 = Array(MAX_STEPS).fill(false);
      steps2[0] = true;

      const pLocks1 = Array(MAX_STEPS).fill(null);
      pLocks1[0] = { volume: 0.2 };

      const pLocks2 = Array(MAX_STEPS).fill(null);
      pLocks2[0] = { volume: 0.3 };

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

      const { container } = render(<VelocityOverview tracks={[track1, track2]} />);

      // Both are <40%, so should be ghost
      const cell = container.querySelectorAll('.accent-cell')[0];
      expect(cell.classList.contains('ghost')).toBe(true);
    });
  });

  describe('muted tracks', () => {
    it('should not include muted tracks in accent calculation', () => {
      const steps1 = Array(MAX_STEPS).fill(false);
      steps1[0] = true;

      const track = createTestTrack({
        steps: steps1,
        muted: true,
        parameterLocks: Array(MAX_STEPS).fill(null), // Would be accent if not muted
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      // Muted track shouldn't contribute, so step should be empty
      const cell = container.querySelectorAll('.accent-cell')[0];
      expect(cell.classList.contains('empty')).toBe(true);
    });
  });

  describe('step count handling', () => {
    it('should use max step count for strip length', () => {
      const track16 = createTestTrack({
        id: 'track-16',
        stepCount: 16,
      });

      const track32 = createTestTrack({
        id: 'track-32',
        stepCount: 32,
      });

      const { container } = render(<VelocityOverview tracks={[track16, track32]} />);

      const cells = container.querySelectorAll('.accent-cell');
      expect(cells.length).toBe(32);
    });

    it('should wrap shorter tracks using modulo', () => {
      const steps16 = Array(MAX_STEPS).fill(false);
      steps16[0] = true; // Only step 0 is active

      const track16 = createTestTrack({
        id: 'track-16',
        steps: steps16,
        stepCount: 16,
      });

      const track32 = createTestTrack({
        id: 'track-32',
        stepCount: 32,
      });

      const { container } = render(<VelocityOverview tracks={[track16, track32]} />);

      // Step 0 and step 16 should both show accent (16 % 16 = 0)
      const cells = container.querySelectorAll('.accent-cell');
      expect(cells[0].classList.contains('accent')).toBe(true);
      expect(cells[16].classList.contains('accent')).toBe(true);
    });
  });

  describe('playhead indication', () => {
    it('should highlight current step when playing', () => {
      const track = createTestTrack({ stepCount: 16 });

      const { container } = render(
        <VelocityOverview tracks={[track]} currentStep={4} isPlaying={true} />
      );

      const cells = container.querySelectorAll('.accent-cell');
      expect(cells[4].classList.contains('playing')).toBe(true);
      expect(cells[0].classList.contains('playing')).toBe(false);
    });

    it('should not highlight when not playing', () => {
      const track = createTestTrack({ stepCount: 16 });

      const { container } = render(
        <VelocityOverview tracks={[track]} currentStep={4} isPlaying={false} />
      );

      const cells = container.querySelectorAll('.accent-cell');
      expect(cells[4].classList.contains('playing')).toBe(false);
    });
  });

  describe('beat and page markers', () => {
    it('should add beat-start class every 4 steps', () => {
      const track = createTestTrack({ stepCount: 16 });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const cells = container.querySelectorAll('.accent-cell');

      expect(cells[0].classList.contains('beat-start')).toBe(true);
      expect(cells[4].classList.contains('beat-start')).toBe(true);
      expect(cells[8].classList.contains('beat-start')).toBe(true);
      expect(cells[12].classList.contains('beat-start')).toBe(true);

      expect(cells[1].classList.contains('beat-start')).toBe(false);
      expect(cells[5].classList.contains('beat-start')).toBe(false);
    });

    it('should add page-end class every 16 steps (except last)', () => {
      const track = createTestTrack({ stepCount: 32 });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const cells = container.querySelectorAll('.accent-cell');

      // Step 15 (16th step) should have page-end
      expect(cells[15].classList.contains('page-end')).toBe(true);

      // Step 31 should NOT have page-end (it's the last step)
      expect(cells[31].classList.contains('page-end')).toBe(false);
    });
  });

  describe('tooltip content', () => {
    it('should show track count and max velocity in tooltip for active steps', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const parameterLocks = Array(MAX_STEPS).fill(null);
      parameterLocks[0] = { volume: 0.85 };

      const track = createTestTrack({
        steps,
        parameterLocks,
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const cell = container.querySelectorAll('.accent-cell')[0];
      expect(cell.getAttribute('title')).toContain('Step 1');
      expect(cell.getAttribute('title')).toContain('1 track');
      expect(cell.getAttribute('title')).toContain('85% max');
    });

    it('should show "no notes" in tooltip for empty steps', () => {
      const track = createTestTrack({
        steps: Array(MAX_STEPS).fill(false),
        stepCount: 16,
      });

      const { container } = render(<VelocityOverview tracks={[track]} />);

      const cell = container.querySelectorAll('.accent-cell')[0];
      expect(cell.getAttribute('title')).toContain('no notes');
    });
  });
});
