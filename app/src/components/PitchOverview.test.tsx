/**
 * Phase 31H: PitchOverview Component Tests
 *
 * Tests for the pitch overview minimap visualization.
 * Verifies that dots only appear for steps that have been input.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PitchOverview } from './PitchOverview';
import type { Track } from '../types';
import { MAX_STEPS, STEPS_PER_PAGE } from '../types';

/**
 * Create a test track with default values
 */
function createTestTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: `track-${Date.now()}`,
    name: 'Test Track',
    sampleId: 'sampled:piano',
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

describe('PitchOverview', () => {
  describe('dot visibility', () => {
    it('should render nothing when there are no melodic tracks', () => {
      const drumTrack = createTestTrack({
        sampleId: 'kick', // Drum, not melodic
      });

      const { container } = render(
        <PitchOverview tracks={[drumTrack]} />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should show no pitch dots for a fresh piano track with 128 steps (no steps input)', () => {
      // Scenario: User adds a piano track with 128 steps but hasn't clicked any cells
      const pianoTrack = createTestTrack({
        id: 'piano-128',
        name: 'Piano',
        sampleId: 'sampled:piano',
        steps: Array(MAX_STEPS).fill(false), // No steps active
        parameterLocks: Array(MAX_STEPS).fill(null),
        stepCount: 128, // 128 steps
      });

      const { container } = render(
        <PitchOverview tracks={[pianoTrack]} />
      );

      // Should render the component (has melodic track)
      expect(container.querySelector('.pitch-overview')).toBeTruthy();

      // Should have NO pitch dots (no steps are active)
      const dots = container.querySelectorAll('.pitch-dot');
      expect(dots.length).toBe(0);
    });

    it('should show pitch dots only for active steps', () => {
      // Scenario: User clicks on steps 0, 4, and 8
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[4] = true;
      steps[8] = true;

      const pianoTrack = createTestTrack({
        id: 'piano-active',
        sampleId: 'sampled:piano',
        steps,
        stepCount: 16,
      });

      const { container } = render(
        <PitchOverview tracks={[pianoTrack]} />
      );

      // Should have exactly 3 pitch dots (one for each active step)
      const dots = container.querySelectorAll('.pitch-dot');
      expect(dots.length).toBe(3);
    });

    it('should show dots disappear when steps are deactivated', () => {
      // Initial: 2 active steps
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[4] = true;

      const pianoTrack = createTestTrack({
        sampleId: 'sampled:piano',
        steps,
        stepCount: 16,
      });

      const { container, rerender } = render(
        <PitchOverview tracks={[pianoTrack]} />
      );

      expect(container.querySelectorAll('.pitch-dot').length).toBe(2);

      // Deactivate step 4
      const updatedSteps = [...steps];
      updatedSteps[4] = false;
      const updatedTrack = { ...pianoTrack, steps: updatedSteps };

      rerender(<PitchOverview tracks={[updatedTrack]} />);

      // Should now have only 1 dot
      expect(container.querySelectorAll('.pitch-dot').length).toBe(1);
    });

    it('should not show dots for muted tracks', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[4] = true;

      const mutedTrack = createTestTrack({
        sampleId: 'sampled:piano',
        steps,
        muted: true, // Muted
        stepCount: 16,
      });

      const { container } = render(
        <PitchOverview tracks={[mutedTrack]} />
      );

      // Muted tracks should not contribute dots
      const dots = container.querySelectorAll('.pitch-dot');
      expect(dots.length).toBe(0);
    });

    it('should show correct number of dots for 128-step track with some active steps', () => {
      // Scenario: 128-step track with active steps at 0, 32, 64, 96
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;
      steps[32] = true;
      steps[64] = true;
      steps[96] = true;

      const pianoTrack = createTestTrack({
        sampleId: 'sampled:piano',
        steps,
        stepCount: 128,
      });

      const { container } = render(
        <PitchOverview tracks={[pianoTrack]} />
      );

      // Should have exactly 4 pitch dots
      const dots = container.querySelectorAll('.pitch-dot');
      expect(dots.length).toBe(4);
    });

    it('should aggregate dots from multiple melodic tracks', () => {
      const steps1 = Array(MAX_STEPS).fill(false);
      steps1[0] = true; // Step 0
      steps1[4] = true; // Step 4

      const steps2 = Array(MAX_STEPS).fill(false);
      steps2[2] = true; // Step 2
      steps2[6] = true; // Step 6

      const piano = createTestTrack({
        id: 'piano',
        sampleId: 'sampled:piano',
        steps: steps1,
        stepCount: 16,
      });

      const synth = createTestTrack({
        id: 'synth',
        sampleId: 'synth:lead',
        steps: steps2,
        stepCount: 16,
      });

      const { container } = render(
        <PitchOverview tracks={[piano, synth]} />
      );

      // Should have 4 total dots (2 from each track)
      const dots = container.querySelectorAll('.pitch-dot');
      expect(dots.length).toBe(4);
    });

    it('should show multiple dots on the same step from different tracks', () => {
      // Both tracks have step 0 active
      const steps1 = Array(MAX_STEPS).fill(false);
      steps1[0] = true;

      const steps2 = Array(MAX_STEPS).fill(false);
      steps2[0] = true;

      const piano = createTestTrack({
        id: 'piano',
        sampleId: 'sampled:piano',
        steps: steps1,
        transpose: 0,
        stepCount: 16,
      });

      const synth = createTestTrack({
        id: 'synth',
        sampleId: 'synth:lead',
        steps: steps2,
        transpose: 12, // Different pitch
        stepCount: 16,
      });

      const { container } = render(
        <PitchOverview tracks={[piano, synth]} />
      );

      // Should have 2 dots at step 0 (one from each track)
      const dots = container.querySelectorAll('.pitch-dot');
      expect(dots.length).toBe(2);
    });
  });

  describe('header info', () => {
    it('should display correct track count and step count', () => {
      const pianoTrack = createTestTrack({
        sampleId: 'sampled:piano',
        stepCount: 64,
      });

      render(<PitchOverview tracks={[pianoTrack]} />);

      expect(screen.getByText(/1 track.*64 steps/)).toBeTruthy();
    });

    it('should show max step count across tracks', () => {
      const track32 = createTestTrack({
        id: 'track-32',
        sampleId: 'sampled:piano',
        stepCount: 32,
      });

      const track128 = createTestTrack({
        id: 'track-128',
        sampleId: 'synth:lead',
        stepCount: 128,
      });

      render(<PitchOverview tracks={[track32, track128]} />);

      expect(screen.getByText(/2 tracks.*128 steps/)).toBeTruthy();
    });
  });

  describe('playhead indicator', () => {
    it('should highlight the correct cell when playing', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const pianoTrack = createTestTrack({
        sampleId: 'sampled:piano',
        steps,
        stepCount: 16,
      });

      const { container } = render(
        <PitchOverview tracks={[pianoTrack]} isPlaying={true} currentStep={0} />
      );

      const playingCells = container.querySelectorAll('.pitch-bar-cell.playing');
      expect(playingCells.length).toBe(1);
    });

    it('should highlight step 5 when currentStep is 5', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[5] = true;

      const pianoTrack = createTestTrack({
        sampleId: 'sampled:piano',
        steps,
        stepCount: 16,
      });

      const { container } = render(
        <PitchOverview tracks={[pianoTrack]} isPlaying={true} currentStep={5} />
      );

      const playingCells = container.querySelectorAll('.pitch-bar-cell.playing');
      expect(playingCells.length).toBe(1);
    });

    it('should NOT highlight any cell when not playing', () => {
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const pianoTrack = createTestTrack({
        sampleId: 'sampled:piano',
        steps,
        stepCount: 16,
      });

      const { container } = render(
        <PitchOverview tracks={[pianoTrack]} isPlaying={false} currentStep={5} />
      );

      const playingCells = container.querySelectorAll('.pitch-bar-cell.playing');
      expect(playingCells.length).toBe(0);
    });

    it('should wrap playhead when currentStep exceeds maxStepCount (64-step track, step 64)', () => {
      // BUG REPRODUCTION: 64-step track, but scheduler currentStep goes 0-127
      // When currentStep is 64, it should wrap to highlight step 0
      const steps = Array(MAX_STEPS).fill(false);
      steps[0] = true;

      const pianoTrack = createTestTrack({
        sampleId: 'sampled:piano',
        steps,
        stepCount: 64, // 64-step pattern
      });

      const { container } = render(
        <PitchOverview
          tracks={[pianoTrack]}
          isPlaying={true}
          currentStep={64}  // Scheduler at step 64, should wrap to 0
        />
      );

      // Should still have exactly 1 playing cell (wrapped to step 0)
      const playingCells = container.querySelectorAll('.pitch-bar-cell.playing');
      expect(playingCells.length).toBe(1);
    });

    it('should wrap playhead when currentStep is 80 on 64-step track (should highlight step 16)', () => {
      // currentStep 80 % 64 = 16
      const steps = Array(MAX_STEPS).fill(false);
      steps[16] = true;

      const pianoTrack = createTestTrack({
        sampleId: 'sampled:piano',
        steps,
        stepCount: 64,
      });

      const { container } = render(
        <PitchOverview
          tracks={[pianoTrack]}
          isPlaying={true}
          currentStep={80}  // 80 % 64 = 16
        />
      );

      const playingCells = container.querySelectorAll('.pitch-bar-cell.playing');
      expect(playingCells.length).toBe(1);
    });

    it('should wrap playhead when currentStep is 127 on 64-step track (should highlight step 63)', () => {
      // currentStep 127 % 64 = 63
      const steps = Array(MAX_STEPS).fill(false);
      steps[63] = true;

      const pianoTrack = createTestTrack({
        sampleId: 'sampled:piano',
        steps,
        stepCount: 64,
      });

      const { container } = render(
        <PitchOverview
          tracks={[pianoTrack]}
          isPlaying={true}
          currentStep={127}  // 127 % 64 = 63
        />
      );

      const playingCells = container.querySelectorAll('.pitch-bar-cell.playing');
      expect(playingCells.length).toBe(1);
    });
  });

  describe('melodic instrument detection', () => {
    it('should include synth: instruments', () => {
      const track = createTestTrack({ sampleId: 'synth:lead' });
      const { container } = render(<PitchOverview tracks={[track]} />);
      expect(container.querySelector('.pitch-overview')).toBeTruthy();
    });

    it('should include advanced: instruments', () => {
      const track = createTestTrack({ sampleId: 'advanced:supersaw' });
      const { container } = render(<PitchOverview tracks={[track]} />);
      expect(container.querySelector('.pitch-overview')).toBeTruthy();
    });

    it('should include sampled: instruments', () => {
      const track = createTestTrack({ sampleId: 'sampled:piano' });
      const { container } = render(<PitchOverview tracks={[track]} />);
      expect(container.querySelector('.pitch-overview')).toBeTruthy();
    });

    it('should include tone:fm-epiano (melodic tone synth)', () => {
      const track = createTestTrack({ sampleId: 'tone:fm-epiano' });
      const { container } = render(<PitchOverview tracks={[track]} />);
      expect(container.querySelector('.pitch-overview')).toBeTruthy();
    });

    it('should exclude drum samples', () => {
      const drumTrack = createTestTrack({ sampleId: 'kick' });
      const { container } = render(<PitchOverview tracks={[drumTrack]} />);
      expect(container.firstChild).toBeNull();
    });

    it('should exclude tone:membrane-kick (drum tone synth)', () => {
      const track = createTestTrack({ sampleId: 'tone:membrane-kick' });
      const { container } = render(<PitchOverview tracks={[track]} />);
      expect(container.firstChild).toBeNull();
    });
  });
});
