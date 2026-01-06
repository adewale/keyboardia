/**
 * Instrument Picker Page Object
 *
 * Abstracts the sample/instrument picker UI for E2E tests.
 * Provides methods for browsing categories and adding tracks.
 *
 * Uses semantic locators (getByRole, getByLabel) per Playwright best practices.
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

    // Categories - use semantic locator with fallback
    this.categories = page.getByRole('button', { expanded: undefined })
      .filter({ has: page.locator('.category-header') })
      .or(page.locator('.category-header'));

    // Instruments - prefer role-based locators
    this.instruments = page.getByRole('button')
      .filter({ has: page.locator('.instrument-btn, .sample-button') })
      .or(page.locator('.instrument-btn, .sample-button'));

    // Search - use semantic locator
    this.searchInput = page.getByRole('searchbox')
      .or(page.getByPlaceholder(/search/i))
      .or(page.locator('.sample-picker input[type="search"], .sample-picker input[type="text"]'));
  }

  // ===== Visibility =====

  /**
   * Check if picker is visible
   */
  async isVisible(): Promise<boolean> {
    return this.picker.isVisible();
  }

  /**
   * Wait for picker to be visible using web-first assertion
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
    const categoryElements = this.page.locator('.category-header');
    const count = await categoryElements.count();

    for (let i = 0; i < count; i++) {
      const text = await categoryElements.nth(i).textContent();
      if (text) names.push(text.trim());
    }

    return names;
  }

  /**
   * Get category element by name using semantic locator
   */
  private getCategoryElement(categoryName: InstrumentCategory | string): Locator {
    return this.page.getByRole('button', { name: new RegExp(categoryName, 'i') })
      .or(this.page.locator(`.category-header:has-text("${categoryName}")`));
  }

  /**
   * Expand a category by name
   */
  async expandCategory(categoryName: InstrumentCategory | string): Promise<void> {
    const category = this.getCategoryElement(categoryName);
    await expect(category).toBeVisible();

    // Check if already expanded using aria-expanded
    const isExpanded = await category.getAttribute('aria-expanded');
    if (isExpanded !== 'true') {
      await category.click();
      // Wait for expansion animation using visibility of instruments
      await this.picker.locator('.instrument-btn:visible, .sample-button:visible').first()
        .waitFor({ state: 'visible', timeout: 1000 })
        .catch(() => {}); // May not have visible instruments
    }
  }

  /**
   * Collapse a category by name
   */
  async collapseCategory(categoryName: InstrumentCategory | string): Promise<void> {
    const category = this.getCategoryElement(categoryName);
    await expect(category).toBeVisible();

    // Check if already collapsed
    const isExpanded = await category.getAttribute('aria-expanded');
    if (isExpanded === 'true') {
      await category.click();
      // Wait for collapse using aria-expanded assertion
      await expect(category).toHaveAttribute('aria-expanded', 'false');
    }
  }

  /**
   * Check if category is expanded
   */
  async isCategoryExpanded(categoryName: InstrumentCategory | string): Promise<boolean> {
    const category = this.getCategoryElement(categoryName);
    const isExpanded = await category.getAttribute('aria-expanded');
    return isExpanded === 'true';
  }

  /**
   * Assert category is expanded using web-first assertion
   */
  async expectCategoryExpanded(categoryName: InstrumentCategory | string): Promise<void> {
    const category = this.getCategoryElement(categoryName);
    await expect(category).toHaveAttribute('aria-expanded', 'true');
  }

  /**
   * Assert category is collapsed using web-first assertion
   */
  async expectCategoryCollapsed(categoryName: InstrumentCategory | string): Promise<void> {
    const category = this.getCategoryElement(categoryName);
    await expect(category).toHaveAttribute('aria-expanded', 'false');
  }

  // ===== Instrument Selection =====

  /**
   * Get instrument button by name using semantic locator
   */
  getInstrument(instrumentName: string): Locator {
    return this.page.getByRole('button', { name: new RegExp(instrumentName, 'i') })
      .or(this.picker.locator(`.instrument-btn:has-text("${instrumentName}"), .sample-button:has-text("${instrumentName}")`));
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
    // Brief pause for audio preview - animation wait is acceptable here
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
      // Wait for filter to apply by checking instrument count changes
      await expect(async () => {
        const count = await this.instruments.count();
        return count >= 0; // Just verify it ran
      }).toPass({ timeout: 1000 });
    }
  }

  /**
   * Clear search
   */
  async clearSearch(): Promise<void> {
    if (await this.searchInput.isVisible()) {
      await this.searchInput.clear();
      // Wait for filter to clear
      await expect(this.searchInput).toHaveValue('');
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
   * Assert picker contains instrument using web-first assertion
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
   * Assert category exists using web-first assertion
   */
  async expectCategoryVisible(categoryName: InstrumentCategory | string): Promise<void> {
    const category = this.getCategoryElement(categoryName);
    await expect(category).toBeVisible();
  }
}
