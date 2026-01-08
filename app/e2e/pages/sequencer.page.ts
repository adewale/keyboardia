/**
 * Sequencer Page Object
 *
 * Abstracts the main sequencer UI for E2E tests.
 * Provides methods for common interactions like toggling steps,
 * reordering tracks, and adjusting parameters.
 *
 * Uses semantic locators (getByRole, getByLabel) per Playwright best practices.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { Page, Locator, expect } from '@playwright/test';

export class SequencerPage {
  readonly page: Page;

  // Main sections
  readonly sequencerGrid: Locator;
  readonly trackRows: Locator;
  readonly samplePicker: Locator;

  // Transport controls - use semantic locators with fallbacks
  readonly playButton: Locator;
  readonly stopButton: Locator;
  readonly tempoDisplay: Locator;

  constructor(page: Page) {
    this.page = page;

    // Main sections (these are custom elements, CSS selectors appropriate)
    this.sequencerGrid = page.locator('.sequencer-grid');
    this.trackRows = page.locator('.track-row');
    this.samplePicker = page.locator('.sample-picker');

    // Transport - prefer semantic locators
    // Try getByRole first, fallback to data-testid, then CSS
    this.playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('[data-testid="play-button"]'))
      .or(page.locator('.transport button').first());

    this.stopButton = page.getByRole('button', { name: /stop/i })
      .or(page.locator('[data-testid="stop-button"]'));

    this.tempoDisplay = page.getByLabel(/tempo/i)
      .or(page.locator('[data-testid="tempo-display"]'))
      .or(page.locator('.transport-number').first());
  }

  /**
   * Navigate to a session URL and wait for load
   */
  async goto(sessionUrl: string): Promise<void> {
    await this.page.goto(sessionUrl);
    await this.page.waitForLoadState('networkidle');
    await this.waitForSequencerReady();
  }

  /**
   * Wait for sequencer to be ready for interaction.
   * Uses proper Playwright waits - no arbitrary timeouts.
   */
  async waitForSequencerReady(): Promise<void> {
    // Wait for either track rows or sample picker to be visible
    await this.trackRows.first()
      .or(this.samplePicker)
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  // ===== Step Operations =====

  /**
   * Get a specific step cell.
   * Step cells are custom interactive elements - uses aria attributes when available.
   */
  getStep(trackIndex: number, stepIndex: number): Locator {
    const track = this.trackRows.nth(trackIndex);
    // Try to use semantic locator if steps have proper ARIA roles
    return track.getByRole('checkbox', { name: new RegExp(`step ${stepIndex + 1}`, 'i') })
      .or(track.locator('.step-cell').nth(stepIndex));
  }

  /**
   * Get all step cells in a track
   */
  getSteps(trackIndex: number): Locator {
    return this.trackRows.nth(trackIndex).locator('.step-cell');
  }

  /**
   * Toggle a step on/off
   */
  async toggleStep(trackIndex: number, stepIndex: number): Promise<void> {
    const step = this.getStep(trackIndex, stepIndex);
    await step.click();
  }

  /**
   * Check if a step is active using web-first assertions pattern
   */
  async isStepActive(trackIndex: number, stepIndex: number): Promise<boolean> {
    const step = this.getStep(trackIndex, stepIndex);
    // Try aria-pressed/aria-checked first (semantic), fallback to class
    const ariaPressed = await step.getAttribute('aria-pressed');
    const ariaChecked = await step.getAttribute('aria-checked');
    if (ariaPressed !== null) return ariaPressed === 'true';
    if (ariaChecked !== null) return ariaChecked === 'true';
    // Fallback to class check
    return (await step.getAttribute('class'))?.includes('active') ?? false;
  }

  /**
   * Assert step is active using web-first assertions
   */
  async expectStepActive(trackIndex: number, stepIndex: number): Promise<void> {
    const step = this.getStep(trackIndex, stepIndex);
    // Prefer semantic assertions, fallback to class
    await expect(step).toHaveAttribute('aria-pressed', 'true')
      .catch(() => expect(step).toHaveAttribute('aria-checked', 'true'))
      .catch(() => expect(step).toHaveClass(/active/));
  }

  /**
   * Assert step is inactive using web-first assertions
   */
  async expectStepInactive(trackIndex: number, stepIndex: number): Promise<void> {
    const step = this.getStep(trackIndex, stepIndex);
    await expect(step).not.toHaveClass(/active/);
  }

  /**
   * Drag to paint multiple steps.
   *
   * IMPORTANT: Must move through each intermediate step to trigger pointerenter
   * events for the drag-to-paint feature to work correctly.
   */
  async dragToPaint(
    trackIndex: number,
    startStep: number,
    endStep: number
  ): Promise<void> {
    const track = this.trackRows.nth(trackIndex);
    const stepCells = track.locator('.step-cell');

    // Wait for first step to be visible
    const startCell = stepCells.nth(startStep);
    await startCell.waitFor({ state: 'visible' });

    const startBox = await startCell.boundingBox();
    if (!startBox) {
      throw new Error('Could not get start step bounding box');
    }

    // Move to start and press mouse down
    await this.page.mouse.move(
      startBox.x + startBox.width / 2,
      startBox.y + startBox.height / 2
    );
    await this.page.mouse.down();

    // Move through each intermediate step to trigger pointerenter events
    const direction = endStep >= startStep ? 1 : -1;
    for (let i = startStep + direction; direction > 0 ? i <= endStep : i >= endStep; i += direction) {
      const cell = stepCells.nth(i);
      const box = await cell.boundingBox();
      if (box) {
        await this.page.mouse.move(
          box.x + box.width / 2,
          box.y + box.height / 2,
          { steps: 2 }  // Smooth motion for reliable event triggering
        );
      }
    }

    await this.page.mouse.up();
  }

  /**
   * Multi-select steps with Ctrl+Click
   */
  async ctrlClickStep(trackIndex: number, stepIndex: number): Promise<void> {
    const step = this.getStep(trackIndex, stepIndex);
    await step.click({ modifiers: ['Control'] });
  }

  /**
   * Shift+Click for parameter lock editor
   */
  async shiftClickStep(trackIndex: number, stepIndex: number): Promise<void> {
    const step = this.getStep(trackIndex, stepIndex);
    await step.click({ modifiers: ['Shift'] });
  }

  // ===== Track Operations =====

  /**
   * Get track row by index
   */
  getTrack(trackIndex: number): Locator {
    return this.trackRows.nth(trackIndex);
  }

  /**
   * Get track count using web-first pattern
   */
  async getTrackCount(): Promise<number> {
    return this.trackRows.count();
  }

  /**
   * Assert track count using web-first assertions
   */
  async expectTrackCount(expected: number): Promise<void> {
    await expect(this.trackRows).toHaveCount(expected);
  }

  /**
   * Get track name
   */
  async getTrackName(trackIndex: number): Promise<string> {
    const track = this.getTrack(trackIndex);
    // Try semantic locator first
    const nameElement = track.getByRole('heading')
      .or(track.locator('.track-name, .track-label').first());
    return (await nameElement.textContent()) ?? '';
  }

  /**
   * Reorder track by dragging
   */
  async reorderTrack(fromIndex: number, toIndex: number): Promise<void> {
    const fromTrack = this.getTrack(fromIndex);
    const toTrack = this.getTrack(toIndex);

    // Use semantic locator for drag handle
    const dragHandle = fromTrack.getByRole('button', { name: /drag|reorder|move/i })
      .or(fromTrack.locator('.drag-handle, [data-testid="drag-handle"]'));

    await dragHandle.waitFor({ state: 'visible' });
    const handleBox = await dragHandle.boundingBox();
    const toBox = await toTrack.boundingBox();

    if (!handleBox || !toBox) {
      throw new Error('Could not get track bounding boxes for reorder');
    }

    await this.page.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2
    );
    await this.page.mouse.down();

    // Move to target position
    const targetY = toIndex > fromIndex
      ? toBox.y + toBox.height + 5
      : toBox.y - 5;

    await this.page.mouse.move(handleBox.x + handleBox.width / 2, targetY);
    await this.page.mouse.up();
  }

  /**
   * Toggle track mute using semantic locator
   */
  async toggleMute(trackIndex: number): Promise<void> {
    const track = this.getTrack(trackIndex);
    const muteButton = track.getByRole('button', { name: /mute/i })
      .or(track.locator('.mute-button, [data-testid="mute-button"]'));
    await muteButton.click();
  }

  /**
   * Toggle track solo using semantic locator
   */
  async toggleSolo(trackIndex: number): Promise<void> {
    const track = this.getTrack(trackIndex);
    const soloButton = track.getByRole('button', { name: /solo/i })
      .or(track.locator('.solo-button, [data-testid="solo-button"]'));
    await soloButton.click();
  }

  /**
   * Delete track using semantic locator
   */
  async deleteTrack(trackIndex: number): Promise<void> {
    const track = this.getTrack(trackIndex);
    const deleteButton = track.getByRole('button', { name: /delete|remove/i })
      .or(track.locator('.delete-button, [data-testid="delete-track"]'));
    await deleteButton.click();
  }

  // ===== Velocity Lane =====

  /**
   * Toggle velocity lane visibility
   */
  async toggleVelocityLane(trackIndex: number): Promise<void> {
    const track = this.getTrack(trackIndex);
    const velocityToggle = track.getByRole('button', { name: /velocity/i })
      .or(track.locator('[data-testid="velocity-toggle"], .velocity-toggle'));
    await velocityToggle.click();
  }

  /**
   * Assert velocity lane is visible
   */
  async expectVelocityLaneVisible(trackIndex: number): Promise<void> {
    const track = this.getTrack(trackIndex);
    const velocityLane = track.locator('.velocity-lane');
    await expect(velocityLane).toBeVisible();
  }

  /**
   * Assert velocity lane is hidden
   */
  async expectVelocityLaneHidden(trackIndex: number): Promise<void> {
    const track = this.getTrack(trackIndex);
    const velocityLane = track.locator('.velocity-lane');
    await expect(velocityLane).not.toBeVisible();
  }

  // ===== Parameter Locks =====

  /**
   * Open parameter lock editor for a step
   */
  async openPlockEditor(trackIndex: number, stepIndex: number): Promise<void> {
    await this.shiftClickStep(trackIndex, stepIndex);
    // Wait for editor using proper Playwright wait
    const editor = this.page.getByRole('dialog', { name: /parameter|lock/i })
      .or(this.page.locator('.plock-editor, [data-testid="plock-editor"]'));
    await editor.waitFor({ state: 'visible', timeout: 2000 });
  }

  /**
   * Close parameter lock editor
   */
  async closePlockEditor(): Promise<void> {
    await this.page.keyboard.press('Escape');
    // Verify it closed
    const editor = this.page.locator('.plock-editor, [data-testid="plock-editor"]');
    await expect(editor).not.toBeVisible();
  }

  // ===== Chromatic Grid =====

  /**
   * Toggle chromatic grid for a track
   */
  async toggleChromaticGrid(trackIndex: number): Promise<void> {
    const track = this.getTrack(trackIndex);
    const expandButton = track.getByRole('button', { name: /chromatic|expand|keyboard/i })
      .or(track.locator('.chromatic-toggle, [data-testid="chromatic-toggle"]'));
    await expandButton.click();
  }

  // ===== Utilities =====

  /**
   * Take a screenshot of the sequencer grid
   */
  async screenshot(name: string): Promise<Buffer> {
    await this.sequencerGrid.waitFor({ state: 'visible' });
    return this.sequencerGrid.screenshot({ path: `test-results/${name}.png` });
  }
}
