/**
 * Instrument Picker Page Object
 *
 * Abstracts the sample/instrument picker UI for E2E tests.
 * Provides methods for browsing categories and adding tracks.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { Page, Locator, expect } from '@playwright/test';

/**
 * Known instrument categories
 */
export type InstrumentCategory =
  | 'Drums'
  | 'Bass'
  | 'Synths'
  | 'Keys'
  | 'Melodic'
  | 'FX'
  | 'Samples';

export class PickerPage {
  readonly page: Page;

  // Main container
  readonly picker: Locator;
  readonly categories: Locator;
  readonly instruments: Locator;

  // Search
  readonly searchInput: Locator;

  constructor(page: Page) {
    this.page = page;

    // Main container
    this.picker = page.locator('.sample-picker');
    this.categories = page.locator('.category-header');
    this.instruments = page.locator('.instrument-btn, .sample-button');

    // Search
    this.searchInput = page.locator('.sample-picker input[type="search"], .sample-picker input[type="text"]');
  }

  // ===== Visibility =====

  /**
   * Check if picker is visible
   */
  async isVisible(): Promise<boolean> {
    return this.picker.isVisible();
  }

  /**
   * Wait for picker to be visible
   */
  async waitForVisible(): Promise<void> {
    await expect(this.picker).toBeVisible({ timeout: 5000 });
  }

  // ===== Category Navigation =====

  /**
   * Get all category names
   */
  async getCategoryNames(): Promise<string[]> {
    const names: string[] = [];
    const count = await this.categories.count();

    for (let i = 0; i < count; i++) {
      const text = await this.categories.nth(i).textContent();
      if (text) names.push(text.trim());
    }

    return names;
  }

  /**
   * Expand a category by name
   */
  async expandCategory(categoryName: InstrumentCategory | string): Promise<void> {
    const category = this.page.locator(`.category-header:has-text("${categoryName}")`);
    await expect(category).toBeVisible();

    // Check if already expanded
    const isExpanded = await category.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await category.click();
      await this.page.waitForTimeout(200); // Wait for animation
    }
  }

  /**
   * Collapse a category by name
   */
  async collapseCategory(categoryName: InstrumentCategory | string): Promise<void> {
    const category = this.page.locator(`.category-header:has-text("${categoryName}")`);
    await expect(category).toBeVisible();

    // Check if already collapsed
    const isExpanded = await category.getAttribute('aria-expanded');
    if (isExpanded === 'true') {
      await category.click();
      await this.page.waitForTimeout(200);
    }
  }

  /**
   * Check if category is expanded
   */
  async isCategoryExpanded(categoryName: InstrumentCategory | string): Promise<boolean> {
    const category = this.page.locator(`.category-header:has-text("${categoryName}")`);
    const isExpanded = await category.getAttribute('aria-expanded');
    return isExpanded === 'true';
  }

  // ===== Instrument Selection =====

  /**
   * Get instrument button by name
   */
  getInstrument(instrumentName: string): Locator {
    return this.picker.locator(`.instrument-btn:has-text("${instrumentName}"), .sample-button:has-text("${instrumentName}")`);
  }

  /**
   * Get instrument button by data attribute
   */
  getInstrumentById(instrumentId: string): Locator {
    return this.picker.locator(`[data-instrument="${instrumentId}"], [data-sample="${instrumentId}"]`);
  }

  /**
   * Click an instrument to add as track
   */
  async addTrack(instrumentName: string): Promise<void> {
    const instrument = this.getInstrument(instrumentName);
    await expect(instrument).toBeVisible({ timeout: 3000 });
    await instrument.click();
  }

  /**
   * Add track by instrument ID
   */
  async addTrackById(instrumentId: string): Promise<void> {
    const instrument = this.getInstrumentById(instrumentId);
    await expect(instrument).toBeVisible({ timeout: 3000 });
    await instrument.click();
  }

  /**
   * Hover over instrument to preview sound
   */
  async previewInstrument(instrumentName: string): Promise<void> {
    const instrument = this.getInstrument(instrumentName);
    await expect(instrument).toBeVisible({ timeout: 3000 });
    await instrument.hover();
    // Wait for preview to play
    await this.page.waitForTimeout(300);
  }

  /**
   * Get all visible instrument names
   */
  async getVisibleInstruments(): Promise<string[]> {
    const names: string[] = [];
    const instruments = this.picker.locator('.instrument-btn:visible, .sample-button:visible');
    const count = await instruments.count();

    for (let i = 0; i < count; i++) {
      const text = await instruments.nth(i).textContent();
      if (text) names.push(text.trim());
    }

    return names;
  }

  // ===== Search =====

  /**
   * Search for instruments
   */
  async search(query: string): Promise<void> {
    if (await this.searchInput.isVisible()) {
      await this.searchInput.fill(query);
      await this.page.waitForTimeout(300); // Wait for filter
    }
  }

  /**
   * Clear search
   */
  async clearSearch(): Promise<void> {
    if (await this.searchInput.isVisible()) {
      await this.searchInput.clear();
      await this.page.waitForTimeout(300);
    }
  }

  // ===== Common Workflows =====

  /**
   * Add a drum track (expands Drums category first)
   */
  async addDrumTrack(drumName: string): Promise<void> {
    await this.expandCategory('Drums');
    await this.addTrack(drumName);
  }

  /**
   * Add a synth track (expands Synths category first)
   */
  async addSynthTrack(synthName: string): Promise<void> {
    await this.expandCategory('Synths');
    await this.addTrack(synthName);
  }

  /**
   * Add a bass track
   */
  async addBassTrack(bassName: string): Promise<void> {
    await this.expandCategory('Bass');
    await this.addTrack(bassName);
  }

  // ===== Assertions =====

  /**
   * Assert picker contains instrument
   */
  async expectInstrumentVisible(instrumentName: string): Promise<void> {
    const instrument = this.getInstrument(instrumentName);
    await expect(instrument).toBeVisible();
  }

  /**
   * Assert picker does not contain instrument (or it's hidden)
   */
  async expectInstrumentHidden(instrumentName: string): Promise<void> {
    const instrument = this.getInstrument(instrumentName);
    await expect(instrument).not.toBeVisible();
  }

  /**
   * Assert category exists
   */
  async expectCategoryVisible(categoryName: InstrumentCategory | string): Promise<void> {
    const category = this.page.locator(`.category-header:has-text("${categoryName}")`);
    await expect(category).toBeVisible();
  }
}
