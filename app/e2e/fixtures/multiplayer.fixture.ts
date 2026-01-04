/**
 * Multiplayer Fixtures
 *
 * Provides two-client setup for testing real-time synchronization.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test as base, expect, BrowserContext, Page } from '@playwright/test';
import { API_BASE, createSessionWithRetry, SessionState } from '../test-utils';
import { createTrack, TrackData } from './session.fixture';

/**
 * Two-client fixture result
 */
export interface TwoClientFixture {
  context1: BrowserContext;
  context2: BrowserContext;
  page1: Page;
  page2: Page;
  sessionId: string;
  sessionUrl: string;
}

/**
 * Multiplayer test fixture that extends base test
 */
export const test = base.extend<{
  twoClients: TwoClientFixture;
  twoClientsWithTracks: TwoClientFixture & { tracks: TrackData[] };
}>({
  /**
   * Two independent browser contexts connected to the same session
   */
  twoClients: async ({ browser, request }, use) => {
    // Create a fresh session
    const { id: sessionId } = await createSessionWithRetry(request, {
      tracks: [
        createTrack({ id: 'test-track', name: 'Test', sampleId: 'kick' }),
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    });

    // Create two independent browser contexts
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await use({
      context1,
      context2,
      page1,
      page2,
      sessionId,
      sessionUrl: `/s/${sessionId}`,
    });

    // Cleanup
    await context1.close();
    await context2.close();
  },

  /**
   * Two clients with pre-populated tracks
   */
  twoClientsWithTracks: async ({ browser, request }, use) => {
    const tracks: TrackData[] = [
      createTrack({ id: 'kick', name: 'Kick', sampleId: 'kick' }),
      createTrack({ id: 'snare', name: 'Snare', sampleId: 'snare' }),
    ];

    const { id: sessionId } = await createSessionWithRetry(request, {
      tracks,
      tempo: 120,
      swing: 0,
      version: 1,
    });

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    await use({
      context1,
      context2,
      page1,
      page2,
      sessionId,
      sessionUrl: `/s/${sessionId}`,
      tracks,
    });

    await context1.close();
    await context2.close();
  },
});

/**
 * Navigate both clients to the session and wait for load
 */
export async function navigateBothClients(
  page1: Page,
  page2: Page,
  sessionUrl: string
): Promise<void> {
  await Promise.all([
    page1.goto(sessionUrl),
    page2.goto(sessionUrl),
  ]);

  await Promise.all([
    page1.waitForLoadState('networkidle'),
    page2.waitForLoadState('networkidle'),
  ]);

  // Give WebSocket time to connect
  await page1.waitForTimeout(1500);
  await page2.waitForTimeout(1000);
}

/**
 * Wait for state to sync between clients
 */
export async function waitForSync(page1: Page, page2: Page, timeoutMs = 3000): Promise<void> {
  // Wait for any pending network activity to settle
  await Promise.all([
    page1.waitForTimeout(500),
    page2.waitForTimeout(500),
  ]);
}

/**
 * Verify both clients show the same step state
 */
export async function verifyStepSync(
  page1: Page,
  page2: Page,
  trackIndex: number,
  stepIndex: number,
  expectedActive: boolean
): Promise<void> {
  const step1 = page1.locator('.track-row').nth(trackIndex).locator('.step-cell').nth(stepIndex);
  const step2 = page2.locator('.track-row').nth(trackIndex).locator('.step-cell').nth(stepIndex);

  if (expectedActive) {
    await expect(step1).toHaveClass(/active/);
    await expect(step2).toHaveClass(/active/, { timeout: 3000 });
  } else {
    await expect(step1).not.toHaveClass(/active/);
    await expect(step2).not.toHaveClass(/active/, { timeout: 3000 });
  }
}

/**
 * Verify both clients show the same track count
 */
export async function verifyTrackCountSync(
  page1: Page,
  page2: Page,
  expectedCount: number
): Promise<void> {
  await expect(page1.locator('.track-row')).toHaveCount(expectedCount);
  await expect(page2.locator('.track-row')).toHaveCount(expectedCount, { timeout: 3000 });
}

/**
 * Simulate network disconnect for one client
 */
export async function simulateDisconnect(context: BrowserContext): Promise<void> {
  await context.setOffline(true);
}

/**
 * Simulate network reconnect for one client
 */
export async function simulateReconnect(context: BrowserContext): Promise<void> {
  await context.setOffline(false);
}

/**
 * Simulate slow network conditions
 */
export async function simulateSlowNetwork(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 500, // 500ms latency
    downloadThroughput: 50 * 1024, // 50kb/s
    uploadThroughput: 50 * 1024,
  });
}

/**
 * Reset network conditions to normal
 */
export async function resetNetworkConditions(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1, // No throttling
    uploadThroughput: -1,
  });
}

export { expect } from '@playwright/test';
