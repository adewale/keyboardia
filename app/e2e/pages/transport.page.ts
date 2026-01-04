/**
 * Transport Page Object
 *
 * Abstracts the transport controls (play, stop, tempo, swing)
 * for E2E tests.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { Page, Locator, expect } from '@playwright/test';

export class TransportPage {
  readonly page: Page;

  // Controls
  readonly playButton: Locator;
  readonly stopButton: Locator;
  readonly tempoControl: Locator;
  readonly tempoDisplay: Locator;
  readonly swingControl: Locator;
  readonly swingDisplay: Locator;

  // Playhead
  readonly playhead: Locator;

  constructor(page: Page) {
    this.page = page;

    // Play/Stop buttons
    this.playButton = page.locator('[data-testid="play-button"], [aria-label="Play"], .transport button').first();
    this.stopButton = page.locator('[data-testid="stop-button"], [aria-label="Stop"]');

    // Tempo - use multiple fallback selectors for robustness
    this.tempoControl = page.locator(
      '[data-testid="tempo-control"], .transport-value:has-text("BPM"), .transport-value'
    ).first();
    this.tempoDisplay = page.locator(
      '[data-testid="tempo-display"], .transport-number'
    ).first();

    // Swing - use label/testid fallback, then nth as last resort
    this.swingControl = page.locator(
      '[data-testid="swing-control"], .transport-value:has-text("Swing"), .transport-value >> nth=1'
    ).first();
    this.swingDisplay = page.locator(
      '[data-testid="swing-display"], .transport-value:has-text("Swing") .transport-number, .transport-number >> nth=1'
    ).first();

    // Playhead
    this.playhead = page.locator('.playhead, [data-testid="playhead"]');
  }

  // ===== Playback Control =====

  /**
   * Start playback
   */
  async play(): Promise<void> {
    await this.playButton.click();
  }

  /**
   * Stop playback
   */
  async stop(): Promise<void> {
    // Click play button again to stop (it's a toggle)
    await this.playButton.click();
  }

  /**
   * Check if currently playing
   */
  async isPlaying(): Promise<boolean> {
    const playButton = this.playButton;
    const classes = await playButton.getAttribute('class');
    const ariaPressed = await playButton.getAttribute('aria-pressed');
    return classes?.includes('playing') || ariaPressed === 'true' || false;
  }

  /**
   * Assert playback is active
   */
  async expectPlaying(): Promise<void> {
    // Look for visual indicator of playing state
    await expect(this.playhead).toBeVisible();
  }

  /**
   * Assert playback is stopped
   */
  async expectStopped(): Promise<void> {
    // Playhead should not be animating
    await this.page.waitForTimeout(100);
    const isPlaying = await this.isPlaying();
    expect(isPlaying).toBe(false);
  }

  // ===== Tempo Control =====

  /**
   * Get current tempo
   */
  async getTempo(): Promise<number> {
    const text = await this.tempoDisplay.textContent();
    return parseInt(text ?? '120', 10);
  }

  /**
   * Set tempo by dragging
   */
  async setTempo(targetBpm: number): Promise<void> {
    const currentBpm = await this.getTempo();
    const delta = targetBpm - currentBpm;

    if (delta === 0) return;

    const box = await this.tempoControl.boundingBox();
    if (!box) {
      throw new Error('Could not get tempo control bounding box');
    }

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Drag vertically (up = increase, down = decrease)
    // ~2 pixels per BPM
    const dragDistance = -delta * 2;

    await this.page.mouse.move(centerX, centerY);
    await this.page.mouse.down();

    // Drag in small increments for accuracy
    const steps = Math.abs(dragDistance) / 10;
    const stepSize = dragDistance / steps;

    for (let i = 0; i < steps; i++) {
      await this.page.mouse.move(centerX, centerY + stepSize * (i + 1));
      await this.page.waitForTimeout(20);
    }

    await this.page.mouse.up();
  }

  /**
   * Increase tempo by amount
   */
  async increaseTempo(amount: number): Promise<void> {
    const current = await this.getTempo();
    await this.setTempo(current + amount);
  }

  /**
   * Decrease tempo by amount
   */
  async decreaseTempo(amount: number): Promise<void> {
    const current = await this.getTempo();
    await this.setTempo(current - amount);
  }

  /**
   * Assert tempo value
   */
  async expectTempo(expected: number): Promise<void> {
    await expect(this.tempoDisplay).toHaveText(String(expected));
  }

  // ===== Swing Control =====

  /**
   * Get current swing value
   */
  async getSwing(): Promise<number> {
    const text = await this.swingDisplay.textContent();
    return parseInt(text ?? '0', 10);
  }

  /**
   * Set swing by dragging
   */
  async setSwing(targetSwing: number): Promise<void> {
    const currentSwing = await this.getSwing();
    const delta = targetSwing - currentSwing;

    if (delta === 0) return;

    const box = await this.swingControl.boundingBox();
    if (!box) {
      throw new Error('Could not get swing control bounding box');
    }

    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Drag vertically
    const dragDistance = -delta * 3; // ~3 pixels per swing unit

    await this.page.mouse.move(centerX, centerY);
    await this.page.mouse.down();
    await this.page.mouse.move(centerX, centerY + dragDistance);
    await this.page.mouse.up();
  }

  /**
   * Assert swing value
   */
  async expectSwing(expected: number): Promise<void> {
    await expect(this.swingDisplay).toHaveText(String(expected));
  }

  // ===== Playhead =====

  /**
   * Get playhead position (step index)
   */
  async getPlayheadPosition(): Promise<number> {
    const style = await this.playhead.getAttribute('style');
    if (!style) return 0;

    // Parse transform or left position
    const match = style.match(/(?:translateX|left)\s*[:(]\s*([\d.]+)/);
    if (match) {
      // Convert pixel position to step index (approximate)
      const pixelPos = parseFloat(match[1]);
      const stepWidth = 39; // 36px cell + 3px gap
      return Math.floor(pixelPos / stepWidth);
    }

    return 0;
  }

  /**
   * Wait for playhead to reach a specific step
   */
  async waitForPlayheadAt(stepIndex: number, timeoutMs = 5000): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const position = await this.getPlayheadPosition();
      if (position === stepIndex) {
        return;
      }
      await this.page.waitForTimeout(50);
    }

    throw new Error(`Playhead did not reach step ${stepIndex} within ${timeoutMs}ms`);
  }

  // ===== Effects Panel =====

  /**
   * Open effects panel
   */
  async openEffectsPanel(): Promise<void> {
    const effectsButton = this.page.locator('[data-testid="effects-button"], .effects-toggle');
    await effectsButton.click();
    await this.page.waitForSelector('.effects-panel', { timeout: 2000 });
  }

  /**
   * Close effects panel
   */
  async closeEffectsPanel(): Promise<void> {
    const closeButton = this.page.locator('.effects-panel .close-button');
    if (await closeButton.isVisible()) {
      await closeButton.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
  }

  // ===== Mixer Panel =====

  /**
   * Open mixer panel
   */
  async openMixerPanel(): Promise<void> {
    const mixerButton = this.page.locator('[data-testid="mixer-button"], .mixer-toggle');
    await mixerButton.click();
    await this.page.waitForSelector('.mixer-panel', { timeout: 2000 });
  }

  /**
   * Close mixer panel
   */
  async closeMixerPanel(): Promise<void> {
    const closeButton = this.page.locator('.mixer-panel .close-button');
    if (await closeButton.isVisible()) {
      await closeButton.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
  }
}
