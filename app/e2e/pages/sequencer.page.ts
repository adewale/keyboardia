/**
 * Sequencer Page Object
 *
 * Abstracts the main sequencer UI for E2E tests.
 * Provides methods for common interactions like toggling steps,
 * reordering tracks, and adjusting parameters.
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

  // Transport controls (delegated to TransportPage for detailed control)
  readonly playButton: Locator;
  readonly tempoDisplay: Locator;

  constructor(page: Page) {
    this.page = page;

    // Main sections
    this.sequencerGrid = page.locator('.sequencer-grid');
    this.trackRows = page.locator('.track-row');
    this.samplePicker = page.locator('.sample-picker');

    // Transport
    this.playButton = page.locator('[data-testid="play-button"], .transport button').first();
    this.tempoDisplay = page.locator('.transport-number').first();
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
   * Wait for sequencer to be ready for interaction
   */
  async waitForSequencerReady(): Promise<void> {
    // Wait for at least one track row or the sample picker
    await this.page.waitForSelector('.track-row, .sample-picker', { timeout: 10000 });
  }

  // ===== Step Operations =====

  /**
   * Get a specific step cell
   */
  getStep(trackIndex: number, stepIndex: number): Locator {
    return this.trackRows.nth(trackIndex).locator('.step-cell').nth(stepIndex);
  }

  /**
   * Toggle a step on/off
   */
  async toggleStep(trackIndex: number, stepIndex: number): Promise<void> {
    const step = this.getStep(trackIndex, stepIndex);
    await step.click();
  }

  /**
   * Check if a step is active
   */
  async isStepActive(trackIndex: number, stepIndex: number): Promise<boolean> {
    const step = this.getStep(trackIndex, stepIndex);
    const classes = await step.getAttribute('class');
    return classes?.includes('active') ?? false;
  }

  /**
   * Assert step is active
   */
  async expectStepActive(trackIndex: number, stepIndex: number): Promise<void> {
    const step = this.getStep(trackIndex, stepIndex);
    await expect(step).toHaveClass(/active/);
  }

  /**
   * Assert step is inactive
   */
  async expectStepInactive(trackIndex: number, stepIndex: number): Promise<void> {
    const step = this.getStep(trackIndex, stepIndex);
    await expect(step).not.toHaveClass(/active/);
  }

  /**
   * Drag to paint multiple steps
   */
  async dragToPaint(
    trackIndex: number,
    startStep: number,
    endStep: number
  ): Promise<void> {
    const startCell = this.getStep(trackIndex, startStep);
    const endCell = this.getStep(trackIndex, endStep);

    const startBox = await startCell.boundingBox();
    const endBox = await endCell.boundingBox();

    if (!startBox || !endBox) {
      throw new Error('Could not get step cell bounding boxes');
    }

    await this.page.mouse.move(
      startBox.x + startBox.width / 2,
      startBox.y + startBox.height / 2
    );
    await this.page.mouse.down();
    await this.page.mouse.move(
      endBox.x + endBox.width / 2,
      endBox.y + endBox.height / 2
    );
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
   * Get track count
   */
  async getTrackCount(): Promise<number> {
    return this.trackRows.count();
  }

  /**
   * Assert track count
   */
  async expectTrackCount(expected: number): Promise<void> {
    await expect(this.trackRows).toHaveCount(expected);
  }

  /**
   * Get track name
   */
  async getTrackName(trackIndex: number): Promise<string> {
    const track = this.getTrack(trackIndex);
    const nameElement = track.locator('.track-name, .track-label').first();
    return (await nameElement.textContent()) ?? '';
  }

  /**
   * Reorder track by dragging
   */
  async reorderTrack(fromIndex: number, toIndex: number): Promise<void> {
    const fromTrack = this.getTrack(fromIndex);
    const toTrack = this.getTrack(toIndex);

    const dragHandle = fromTrack.locator('.drag-handle, [data-testid="drag-handle"]');
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
   * Toggle track mute
   */
  async toggleMute(trackIndex: number): Promise<void> {
    const track = this.getTrack(trackIndex);
    const muteButton = track.locator('.mute-button, [data-testid="mute-button"]');
    await muteButton.click();
  }

  /**
   * Toggle track solo
   */
  async toggleSolo(trackIndex: number): Promise<void> {
    const track = this.getTrack(trackIndex);
    const soloButton = track.locator('.solo-button, [data-testid="solo-button"]');
    await soloButton.click();
  }

  /**
   * Delete track
   */
  async deleteTrack(trackIndex: number): Promise<void> {
    const track = this.getTrack(trackIndex);
    const deleteButton = track.locator('.delete-button, [data-testid="delete-track"]');
    await deleteButton.click();
  }

  // ===== Velocity Lane =====

  /**
   * Toggle velocity lane visibility
   */
  async toggleVelocityLane(trackIndex: number): Promise<void> {
    const track = this.getTrack(trackIndex);
    const velocityToggle = track.locator('[data-testid="velocity-toggle"], .velocity-toggle');
    await velocityToggle.click();
  }

  /**
   * Check if velocity lane is visible
   */
  async isVelocityLaneVisible(trackIndex: number): Promise<boolean> {
    const track = this.getTrack(trackIndex);
    const velocityLane = track.locator('.velocity-lane');
    return velocityLane.isVisible();
  }

  // ===== Parameter Locks =====

  /**
   * Open parameter lock editor for a step
   */
  async openPlockEditor(trackIndex: number, stepIndex: number): Promise<void> {
    await this.shiftClickStep(trackIndex, stepIndex);
    // Wait for editor to appear
    await this.page.waitForSelector('.plock-editor, [data-testid="plock-editor"]', {
      timeout: 2000,
    });
  }

  /**
   * Close parameter lock editor
   */
  async closePlockEditor(): Promise<void> {
    // Click outside or press Escape
    await this.page.keyboard.press('Escape');
  }

  // ===== Chromatic Grid =====

  /**
   * Toggle chromatic grid for a track
   */
  async toggleChromaticGrid(trackIndex: number): Promise<void> {
    const track = this.getTrack(trackIndex);
    const expandButton = track.locator('.chromatic-toggle, [data-testid="chromatic-toggle"]');
    await expandButton.click();
  }

  // ===== Utilities =====

  /**
   * Wait for a state change after an action
   */
  async waitForStateChange(timeoutMs = 500): Promise<void> {
    await this.page.waitForTimeout(timeoutMs);
  }

  /**
   * Take a screenshot of the sequencer grid
   */
  async screenshot(name: string): Promise<Buffer> {
    return this.sequencerGrid.screenshot({ path: `test-results/${name}.png` });
  }
}
