/**
 * Drag-to-Paint E2E Tests
 *
 * Comprehensive end-to-end tests for the drag-to-paint feature.
 * These tests verify the actual user experience of clicking and
 * dragging across step cells to paint patterns.
 *
 * Test Categories:
 * 1. Basic painting (activate multiple steps)
 * 2. Erasing (deactivate multiple steps)
 * 3. Mixed patterns (some active, some inactive)
 * 4. Reverse direction (right to left)
 * 5. Modifier key interactions
 * 6. Edge cases (rapid drags, cross-track, etc.)
 *
 * @see specs/PHASE-31-UI-ENHANCEMENTS.md
 */

import { test, waitForAppReady, waitForDragComplete } from './global-setup';
import { SequencerPage } from './pages/sequencer.page';

test.describe('Drag-to-Paint: Basic Painting', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should activate steps 0-3 when dragging from inactive step 0', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Verify all steps start inactive
    for (let i = 0; i < 4; i++) {
      await sequencer.expectStepInactive(trackIndex, i);
    }

    // Drag from step 0 to step 3
    await sequencer.dragToPaint(trackIndex, 0, 3);
    await waitForDragComplete(page);

    // Verify all painted steps are now active
    await sequencer.expectStepActive(trackIndex, 0);
    await sequencer.expectStepActive(trackIndex, 1);
    await sequencer.expectStepActive(trackIndex, 2);
    await sequencer.expectStepActive(trackIndex, 3);

    // Verify steps beyond the drag range remain inactive
    await sequencer.expectStepInactive(trackIndex, 4);
    await sequencer.expectStepInactive(trackIndex, 5);
  });

  test('should activate only the start step when dragging in place', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Drag from step 0 to step 0 (click and release in same place)
    await sequencer.dragToPaint(trackIndex, 0, 0);
    await waitForDragComplete(page);

    // Only step 0 should be active
    await sequencer.expectStepActive(trackIndex, 0);
    await sequencer.expectStepInactive(trackIndex, 1);
  });

  test('should activate a single step on click (no drag)', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Just click step 2
    await sequencer.toggleStep(trackIndex, 2);

    // Only step 2 should be active
    await sequencer.expectStepActive(trackIndex, 2);
    await sequencer.expectStepInactive(trackIndex, 0);
    await sequencer.expectStepInactive(trackIndex, 1);
    await sequencer.expectStepInactive(trackIndex, 3);
  });
});

test.describe('Drag-to-Paint: Erasing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should deactivate steps 0-3 when dragging from active step', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // First, activate steps 0-3 by clicking each one
    for (let i = 0; i < 4; i++) {
      await sequencer.toggleStep(trackIndex, i);
      await sequencer.expectStepActive(trackIndex, i);
    }

    // Verify steps 4+ remain inactive
    await sequencer.expectStepInactive(trackIndex, 4);

    // Now drag from step 0 to step 3 to erase (step 0 is active, so erase mode)
    await sequencer.dragToPaint(trackIndex, 0, 3);
    await waitForDragComplete(page);

    // Verify all painted steps are now inactive
    await sequencer.expectStepInactive(trackIndex, 0);
    await sequencer.expectStepInactive(trackIndex, 1);
    await sequencer.expectStepInactive(trackIndex, 2);
    await sequencer.expectStepInactive(trackIndex, 3);
  });

  test('should deactivate a single step on click', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Activate step 2
    await sequencer.toggleStep(trackIndex, 2);
    await sequencer.expectStepActive(trackIndex, 2);

    // Click again to deactivate
    await sequencer.toggleStep(trackIndex, 2);
    await sequencer.expectStepInactive(trackIndex, 2);
  });
});

test.describe('Drag-to-Paint: Mixed Patterns', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should paint over inactive steps only when starting from inactive', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Create a checkerboard pattern: steps 1, 3 active
    await sequencer.toggleStep(trackIndex, 1);
    await sequencer.toggleStep(trackIndex, 3);

    await sequencer.expectStepInactive(trackIndex, 0);
    await sequencer.expectStepActive(trackIndex, 1);
    await sequencer.expectStepInactive(trackIndex, 2);
    await sequencer.expectStepActive(trackIndex, 3);

    // Drag from step 0 (inactive) to step 3
    // Paint mode should be "on", so steps 0 and 2 should become active
    // Steps 1 and 3 were already active, so they should stay active
    await sequencer.dragToPaint(trackIndex, 0, 3);
    await waitForDragComplete(page);

    // All steps 0-3 should now be active
    await sequencer.expectStepActive(trackIndex, 0);
    await sequencer.expectStepActive(trackIndex, 1);
    await sequencer.expectStepActive(trackIndex, 2);
    await sequencer.expectStepActive(trackIndex, 3);
  });

  test('should erase only active steps when starting from active', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Create pattern: steps 0, 1, 3 active, step 2 inactive
    await sequencer.toggleStep(trackIndex, 0);
    await sequencer.toggleStep(trackIndex, 1);
    await sequencer.toggleStep(trackIndex, 3);

    await sequencer.expectStepActive(trackIndex, 0);
    await sequencer.expectStepActive(trackIndex, 1);
    await sequencer.expectStepInactive(trackIndex, 2);
    await sequencer.expectStepActive(trackIndex, 3);

    // Drag from step 0 (active) to step 3
    // Paint mode should be "off", so active steps become inactive
    await sequencer.dragToPaint(trackIndex, 0, 3);
    await waitForDragComplete(page);

    // All steps 0-3 should now be inactive
    await sequencer.expectStepInactive(trackIndex, 0);
    await sequencer.expectStepInactive(trackIndex, 1);
    await sequencer.expectStepInactive(trackIndex, 2);
    await sequencer.expectStepInactive(trackIndex, 3);
  });
});

test.describe('Drag-to-Paint: Reverse Direction', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should paint when dragging right to left', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Verify steps start inactive
    for (let i = 4; i <= 7; i++) {
      await sequencer.expectStepInactive(trackIndex, i);
    }

    // Drag from step 7 to step 4 (right to left)
    await sequencer.dragToPaint(trackIndex, 7, 4);
    await waitForDragComplete(page);

    // Steps 4-7 should all be active
    await sequencer.expectStepActive(trackIndex, 4);
    await sequencer.expectStepActive(trackIndex, 5);
    await sequencer.expectStepActive(trackIndex, 6);
    await sequencer.expectStepActive(trackIndex, 7);

    // Steps before 4 should remain inactive
    await sequencer.expectStepInactive(trackIndex, 3);
  });

  test('should erase when dragging right to left from active step', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Activate steps 4-7
    for (let i = 4; i <= 7; i++) {
      await sequencer.toggleStep(trackIndex, i);
      await sequencer.expectStepActive(trackIndex, i);
    }

    // Drag from step 7 to step 4 (right to left, erasing)
    await sequencer.dragToPaint(trackIndex, 7, 4);
    await waitForDragComplete(page);

    // Steps 4-7 should all be inactive
    await sequencer.expectStepInactive(trackIndex, 4);
    await sequencer.expectStepInactive(trackIndex, 5);
    await sequencer.expectStepInactive(trackIndex, 6);
    await sequencer.expectStepInactive(trackIndex, 7);
  });
});

test.describe('Drag-to-Paint: Long Drags', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should paint 8 consecutive steps', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Drag from step 0 to step 7
    await sequencer.dragToPaint(trackIndex, 0, 7);
    await waitForDragComplete(page);

    // Verify all 8 steps are active
    for (let i = 0; i < 8; i++) {
      await sequencer.expectStepActive(trackIndex, i);
    }
  });

  test('should paint 16 consecutive steps', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Drag from step 0 to step 15 (full pattern)
    await sequencer.dragToPaint(trackIndex, 0, 15);
    await waitForDragComplete(page);

    // Verify all 16 steps are active
    for (let i = 0; i < 16; i++) {
      await sequencer.expectStepActive(trackIndex, i);
    }
  });
});

test.describe('Drag-to-Paint: Modifier Keys', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should NOT paint when Ctrl+clicking (selection mode)', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Ctrl+click step 0 - this should toggle selection, not paint
    await sequencer.ctrlClickStep(trackIndex, 0);

    // Step should still be inactive (Ctrl+click doesn't toggle step state, just selection)
    // Note: The visual "selected" state is different from "active" state
    await sequencer.expectStepInactive(trackIndex, 0);
  });

  test('should NOT start painting when Shift+clicking (p-lock mode)', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // First activate a step
    await sequencer.toggleStep(trackIndex, 0);
    await sequencer.expectStepActive(trackIndex, 0);

    // Shift+click should open p-lock editor, not start painting
    // The step state should not change
    await sequencer.shiftClickStep(trackIndex, 0);

    // Step should still be active (not toggled)
    await sequencer.expectStepActive(trackIndex, 0);
  });
});

test.describe('Drag-to-Paint: Sequential Drags', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should handle multiple paint operations in sequence', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // First drag: paint steps 0-3
    await sequencer.dragToPaint(trackIndex, 0, 3);
    await waitForDragComplete(page);

    for (let i = 0; i <= 3; i++) {
      await sequencer.expectStepActive(trackIndex, i);
    }

    // Second drag: paint steps 8-11
    await sequencer.dragToPaint(trackIndex, 8, 11);
    await waitForDragComplete(page);

    for (let i = 8; i <= 11; i++) {
      await sequencer.expectStepActive(trackIndex, i);
    }

    // Verify gap between painted regions remains inactive
    for (let i = 4; i <= 7; i++) {
      await sequencer.expectStepInactive(trackIndex, i);
    }

    // Third drag: erase steps 0-3 (they're active now)
    await sequencer.dragToPaint(trackIndex, 0, 3);
    await waitForDragComplete(page);

    for (let i = 0; i <= 3; i++) {
      await sequencer.expectStepInactive(trackIndex, i);
    }

    // Steps 8-11 should still be active
    for (let i = 8; i <= 11; i++) {
      await sequencer.expectStepActive(trackIndex, i);
    }
  });

  test('should correctly handle paint then erase on overlapping region', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Paint steps 2-6
    await sequencer.dragToPaint(trackIndex, 2, 6);
    await waitForDragComplete(page);

    for (let i = 2; i <= 6; i++) {
      await sequencer.expectStepActive(trackIndex, i);
    }

    // Erase steps 4-8 (overlapping and extending)
    await sequencer.dragToPaint(trackIndex, 4, 8);
    await waitForDragComplete(page);

    // Steps 2-3 should still be active (not in erase range)
    await sequencer.expectStepActive(trackIndex, 2);
    await sequencer.expectStepActive(trackIndex, 3);

    // Steps 4-8 should be inactive (erased)
    for (let i = 4; i <= 8; i++) {
      await sequencer.expectStepInactive(trackIndex, i);
    }
  });
});

test.describe('Drag-to-Paint: Pointer Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should end paint mode when pointer released outside grid', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;
    const steps = sequencer.getSteps(trackIndex);

    // Start drag on step 0
    const step0 = steps.nth(0);
    await step0.waitFor({ state: 'visible' });
    const box = await step0.boundingBox();
    if (!box) throw new Error('Could not get bounding box');

    // Mouse down on step 0
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();

    // Move to step 2
    const step2 = steps.nth(2);
    const box2 = await step2.boundingBox();
    if (!box2) throw new Error('Could not get bounding box');
    await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2, { steps: 2 });

    // Move far outside the grid area
    await page.mouse.move(0, 0, { steps: 2 });

    // Release pointer outside
    await page.mouse.up();
    await waitForDragComplete(page);

    // Steps 0-2 should be active (paint completed before moving outside)
    await sequencer.expectStepActive(trackIndex, 0);
    await sequencer.expectStepActive(trackIndex, 1);
    await sequencer.expectStepActive(trackIndex, 2);

    // Verify paint mode ended: clicking step 4 should start a new paint, not continue
    await sequencer.toggleStep(trackIndex, 4);
    await sequencer.expectStepActive(trackIndex, 4);

    // Step 3 should still be inactive (not painted)
    await sequencer.expectStepInactive(trackIndex, 3);
  });

  test('should use smooth mouse movement for reliable painting', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;
    const steps = sequencer.getSteps(trackIndex);

    // Get bounding boxes for steps 0 and 7
    const step0 = steps.nth(0);
    const step7 = steps.nth(7);
    await step0.waitFor({ state: 'visible' });
    await step7.waitFor({ state: 'visible' });

    const box0 = await step0.boundingBox();
    const box7 = await step7.boundingBox();
    if (!box0 || !box7) throw new Error('Could not get bounding boxes');

    // Perform smooth drag with multiple intermediate steps
    await page.mouse.move(box0.x + box0.width / 2, box0.y + box0.height / 2);
    await page.mouse.down();

    // Move through each step with smooth motion
    for (let i = 1; i <= 7; i++) {
      const stepBox = await steps.nth(i).boundingBox();
      if (stepBox) {
        await page.mouse.move(
          stepBox.x + stepBox.width / 2,
          stepBox.y + stepBox.height / 2,
          { steps: 3 } // Use 3 intermediate steps for smoother motion
        );
      }
    }

    await page.mouse.up();
    await waitForDragComplete(page);

    // All 8 steps should be active
    for (let i = 0; i <= 7; i++) {
      await sequencer.expectStepActive(trackIndex, i);
    }
  });
});

test.describe('Drag-to-Paint: State Consistency', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should maintain consistent state after rapid paint operations', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;

    // Rapidly paint and erase multiple times
    for (let round = 0; round < 3; round++) {
      // Paint steps 0-3
      await sequencer.dragToPaint(trackIndex, 0, 3);
      await waitForDragComplete(page);

      // Immediately erase
      await sequencer.dragToPaint(trackIndex, 0, 3);
      await waitForDragComplete(page);
    }

    // After 3 paint/erase cycles, all steps should be inactive
    for (let i = 0; i <= 3; i++) {
      await sequencer.expectStepInactive(trackIndex, i);
    }
  });

  test('should not leave paint mode stuck after interrupted drag', async ({ page }) => {
    const sequencer = new SequencerPage(page);
    const trackIndex = 0;
    const steps = sequencer.getSteps(trackIndex);

    // Start a drag
    const step0 = steps.nth(0);
    await step0.waitFor({ state: 'visible' });
    const box = await step0.boundingBox();
    if (!box) throw new Error('Could not get bounding box');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();

    // Simulate interruption by pressing Escape
    await page.keyboard.press('Escape');

    // Release
    await page.mouse.up();
    await waitForDragComplete(page);

    // Now try a normal click on step 4 - it should work independently
    await sequencer.toggleStep(trackIndex, 4);
    await sequencer.expectStepActive(trackIndex, 4);

    // Click again to toggle off
    await sequencer.toggleStep(trackIndex, 4);
    await sequencer.expectStepInactive(trackIndex, 4);
  });
});

test.describe('Drag-to-Paint: Multiple Tracks', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  test('should paint independently on different tracks', async ({ page }) => {
    const sequencer = new SequencerPage(page);

    const trackCount = await sequencer.getTrackCount();
    if (trackCount < 2) {
      test.skip(true, 'Need at least 2 tracks for this test');
      return;
    }

    // Paint on track 0
    await sequencer.dragToPaint(0, 0, 3);
    await waitForDragComplete(page);

    // Paint on track 1
    await sequencer.dragToPaint(1, 4, 7);
    await waitForDragComplete(page);

    // Verify track 0: steps 0-3 active
    for (let i = 0; i <= 3; i++) {
      await sequencer.expectStepActive(0, i);
    }
    for (let i = 4; i <= 7; i++) {
      await sequencer.expectStepInactive(0, i);
    }

    // Verify track 1: steps 4-7 active
    for (let i = 0; i <= 3; i++) {
      await sequencer.expectStepInactive(1, i);
    }
    for (let i = 4; i <= 7; i++) {
      await sequencer.expectStepActive(1, i);
    }
  });
});
