/**
 * Transport Page Object
 *
 * Abstracts the transport controls (play, stop, tempo, swing)
 * for E2E tests.
 *
 * Uses semantic locators (getByRole, getByLabel) per Playwright best practices.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { Page, Locator, expect } from '@playwright/test';

export class TransportPage {
  readonly page: Page;

  // Controls - using semantic locators with fallbacks
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

    // Play/Stop buttons - prefer semantic locators
    this.playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('[data-testid="play-button"]'))
      .or(page.locator('[aria-label="Play"]'))
      .or(page.locator('.transport button').first());

    this.stopButton = page.getByRole('button', { name: /stop/i })
      .or(page.locator('[data-testid="stop-button"]'))
      .or(page.locator('[aria-label="Stop"]'));

    // Tempo - use label-based locators with fallbacks
    this.tempoControl = page.getByLabel(/tempo/i)
      .or(page.locator('[data-testid="tempo-control"]'))
      .or(page.locator('.transport-value:has-text("BPM")'))
      .or(page.locator('.transport-value').first());

    this.tempoDisplay = page.getByLabel(/tempo/i).locator('.transport-number')
      .or(page.locator('[data-testid="tempo-display"]'))
      .or(page.locator('.transport-number').first());

    // Swing - use label-based locators with fallbacks
    this.swingControl = page.getByLabel(/swing/i)
      .or(page.locator('[data-testid="swing-control"]'))
      .or(page.locator('.transport-value:has-text("Swing")'))
      .or(page.locator('.transport-value').nth(1));

    this.swingDisplay = page.getByLabel(/swing/i).locator('.transport-number')
      .or(page.locator('[data-testid="swing-display"]'))
      .or(page.locator('.transport-number').nth(1));

    // Playhead
    this.playhead = page.locator('[data-testid="playhead"]')
      .or(page.locator('.playhead'));
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
   * Check if currently playing using semantic attributes
   */
  async isPlaying(): Promise<boolean> {
    // Prefer aria-pressed (semantic)
    const ariaPressed = await this.playButton.getAttribute('aria-pressed');
    if (ariaPressed !== null) return ariaPressed === 'true';
    // Fallback to class check
    const classes = await this.playButton.getAttribute('class');
    return classes?.includes('playing') ?? false;
  }

  /**
   * Assert playback is active using web-first assertions
   */
  async expectPlaying(): Promise<void> {
    // Use web-first assertion with semantic attribute
    await expect(this.playButton).toHaveAttribute('aria-pressed', 'true')
      .catch(() => expect(this.playhead).toBeVisible());
  }

  /**
   * Assert playback is stopped using web-first assertions
   */
  async expectStopped(): Promise<void> {
    // Use web-first assertion - no waitForTimeout needed
    await expect(this.playButton).toHaveAttribute('aria-pressed', 'false')
      .catch(() => expect(this.playButton).not.toHaveClass(/playing/));
  }

  // ===== Tempo Control =====

  /**
   * Get current tempo
   */
  async getTempo(): Promise<number> {
    await this.tempoDisplay.waitFor({ state: 'visible' });
    const text = await this.tempoDisplay.textContent();
    return parseInt(text ?? '120', 10);
  }

  /**
   * Set tempo by dragging.
   * Uses Playwright's mouse API with minimal waits for drag stability.
   */
  async setTempo(targetBpm: number): Promise<void> {
    const currentBpm = await this.getTempo();
    const delta = targetBpm - currentBpm;

    if (delta === 0) return;

    await this.tempoControl.waitFor({ state: 'visible' });
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

    // Single smooth drag motion instead of many small steps with timeouts
    await this.page.mouse.move(centerX, centerY + dragDistance, { steps: 10 });

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
   * Assert tempo value using web-first assertion
   */
  async expectTempo(expected: number): Promise<void> {
    await expect(this.tempoDisplay).toHaveText(String(expected));
  }

  // ===== Swing Control =====

  /**
   * Get current swing value
   */
  async getSwing(): Promise<number> {
    await this.swingDisplay.waitFor({ state: 'visible' });
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

    await this.swingControl.waitFor({ state: 'visible' });
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
    await this.page.mouse.move(centerX, centerY + dragDistance, { steps: 5 });
    await this.page.mouse.up();
  }

  /**
   * Assert swing value using web-first assertion
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
   * Wait for playhead to reach a specific step using polling.
   * This is an acceptable use of polling since we're waiting for animation state.
   */
  async waitForPlayheadAt(stepIndex: number, timeoutMs = 5000): Promise<void> {
    await expect(async () => {
      const position = await this.getPlayheadPosition();
      expect(position).toBe(stepIndex);
    }).toPass({ timeout: timeoutMs, intervals: [50, 100, 200] });
  }

  // ===== Effects Panel =====

  /**
   * Open effects panel using semantic locator
   */
  async openEffectsPanel(): Promise<void> {
    const effectsButton = this.page.getByRole('button', { name: /effects|fx/i })
      .or(this.page.locator('[data-testid="effects-button"]'))
      .or(this.page.locator('.effects-toggle'));
    await effectsButton.click();
    // Wait for panel using proper Playwright wait
    const panel = this.page.getByRole('dialog', { name: /effects/i })
      .or(this.page.locator('.effects-panel'));
    await panel.waitFor({ state: 'visible', timeout: 2000 });
  }

  /**
   * Close effects panel
   */
  async closeEffectsPanel(): Promise<void> {
    const closeButton = this.page.getByRole('button', { name: /close/i })
      .or(this.page.locator('.effects-panel .close-button'));
    if (await closeButton.isVisible()) {
      await closeButton.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    // Verify it closed
    await expect(this.page.locator('.effects-panel')).not.toBeVisible();
  }

  // ===== Mixer Panel =====

  /**
   * Open mixer panel using semantic locator
   */
  async openMixerPanel(): Promise<void> {
    const mixerButton = this.page.getByRole('button', { name: /mixer|mix/i })
      .or(this.page.locator('[data-testid="mixer-button"]'))
      .or(this.page.locator('.mixer-toggle'));
    await mixerButton.click();
    // Wait for panel using proper Playwright wait
    const panel = this.page.getByRole('dialog', { name: /mixer/i })
      .or(this.page.locator('.mixer-panel'));
    await panel.waitFor({ state: 'visible', timeout: 2000 });
  }

  /**
   * Close mixer panel
   */
  async closeMixerPanel(): Promise<void> {
    const closeButton = this.page.getByRole('button', { name: /close/i })
      .or(this.page.locator('.mixer-panel .close-button'));
    if (await closeButton.isVisible()) {
      await closeButton.click();
    } else {
      await this.page.keyboard.press('Escape');
    }
    // Verify it closed
    await expect(this.page.locator('.mixer-panel')).not.toBeVisible();
  }
}
