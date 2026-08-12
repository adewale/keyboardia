/**
 * Multiplayer E2E Tests
 *
 * Tests real-time collaboration between multiple browser contexts.
 * Each test creates two independent browser sessions that connect
 * to the same Keyboardia session via WebSocket.
 *
 * Uses Playwright best practices with proper waits.
 *
 * Note: These tests require a real backend for WebSocket sync, so the whole
 * file skips under USE_MOCK_API. Once past that guard a backend is expected to
 * be present — an unreachable backend fails these tests rather than skipping
 * them, so a dead backend cannot produce a green run.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { BrowserContext, Page } from '@playwright/test';
import { test, expect, getBaseUrl, waitForAppReady, useMockAPI } from './global-setup';
import { createSessionWithRetry } from './test-utils';
import { createE2EContext } from './browser-context';

// Multiplayer tests require real backend - WebSocket sync cannot be mocked
// across multiple browser contexts (each context has independent route mocks)
test.skip(useMockAPI, 'Multiplayer tests require real backend with WebSocket sync');

const baseUrl = getBaseUrl();

test.describe('Multiplayer real-time sync', () => {
  let context1: BrowserContext;
  let context2: BrowserContext;
  let page1: Page;
  let page2: Page;
  let sessionId: string;

  test.beforeEach(async ({ browser, browserName, request }) => {
    // Create a fresh session for each test
    // This file already skips wholesale under USE_MOCK_API (see top), so by the
    // time we get here a real backend is expected. A session that still fails to
    // create after createSessionWithRetry's retries means the backend is broken
    // — that is a failure, not a reason to skip. The previous version caught the
    // error, called test.skip(true, 'Backend unavailable'), and every test in
    // the file then skipped itself again on `if (!sessionId)`, so a dead backend
    // produced an all-green run.
    const data = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'mp-test-track',
          name: 'Test',
          sampleId: 'kick',
          steps: Array(128).fill(false),
          parameterLocks: Array(128).fill(null),
          volume: 1,
          pan: 0,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    });
    sessionId = data.id;
    expect(sessionId, 'backend returned a session with no id').toBeTruthy();

    // Create two independent browser contexts (simulating two users)
    context1 = await createE2EContext(browser, browserName);
    context2 = await createE2EContext(browser, browserName);
    page1 = await context1.newPage();
    page2 = await context2.newPage();
  });

  test.afterEach(async () => {
    await context1?.close();
    await context2?.close();
  });

  test('two clients can connect to the same session', async () => {
    // Both clients navigate to the session
    await Promise.all([
      page1.goto(`${baseUrl}/s/${sessionId}`),
      page2.goto(`${baseUrl}/s/${sessionId}`),
    ]);

    // Wait for both to load using proper waits
    await Promise.all([
      waitForAppReady(page1),
      waitForAppReady(page2),
    ]);

    // Both should show the track
    const trackRows1 = page1.locator('.track-row');
    const trackRows2 = page2.locator('.track-row');

    await expect(trackRows1).toHaveCount(1, { timeout: 10000 });
    await expect(trackRows2).toHaveCount(1, { timeout: 10000 });
  });

  test('step toggle syncs between clients', async () => {
    // Load both clients using proper waits
    await page1.goto(`${baseUrl}/s/${sessionId}`);
    await waitForAppReady(page1);

    await page2.goto(`${baseUrl}/s/${sessionId}`);
    await waitForAppReady(page2);

    // Find the first step cell in client 1
    const step0Client1 = page1.locator('.step-cell').first();
    const step0Client2 = page2.locator('.step-cell').first();

    // Verify both are visible
    await expect(step0Client1).toBeVisible({ timeout: 5000 });
    await expect(step0Client2).toBeVisible({ timeout: 5000 });

    // Verify both start as inactive
    await expect(step0Client1).not.toHaveClass(/active/);
    await expect(step0Client2).not.toHaveClass(/active/);

    // Click step 0 on client 1
    await step0Client1.click();

    // Verify client 1 shows it active (using web-first assertion)
    await expect(step0Client1).toHaveClass(/active/);

    // Verify client 2 received the update
    await expect(step0Client2).toHaveClass(/active/, { timeout: 5000 });

    console.log('[TEST] Step toggle synced successfully between clients');
  });

  test('tempo change syncs between clients', async () => {
    // Load both clients using proper waits
    await page1.goto(`${baseUrl}/s/${sessionId}`);
    await waitForAppReady(page1);

    await page2.goto(`${baseUrl}/s/${sessionId}`);
    await waitForAppReady(page2);

    // Use the visible desktop range controls. `.transport-value` belongs to
    // the mobile-only TransportBar and is intentionally hidden in this project.
    const tempoControl1 = page1.locator('#tempo');
    const tempoControl2 = page2.locator('#tempo');
    await expect(tempoControl1).toBeVisible({ timeout: 5000 });
    await expect(tempoControl2).toBeVisible({ timeout: 5000 });
    await expect(tempoControl1).toHaveValue('120');
    await expect(tempoControl2).toHaveValue('120');

    // A keyboard step fires the same React change path as pointer input while
    // keeping the expected value deterministic.
    await tempoControl1.press('ArrowUp');
    await expect(tempoControl1).toHaveValue('121');
    await expect(tempoControl2).toHaveValue('121', { timeout: 5000 });

    console.log('[TEST] Tempo change synced successfully between clients');
  });

  test('pan reaches the engine after a local edit, remote sync, and reload', async () => {
    await Promise.all([
      page1.goto(`${baseUrl}/s/${sessionId}`),
      page2.goto(`${baseUrl}/s/${sessionId}`),
    ]);
    await Promise.all([waitForAppReady(page1), waitForAppReady(page2)]);

    // Create a lazy bus in each page so the dev inspection hook observes the
    // actual engine boundary, not only React state.
    await page1.locator('.step-cell').first().click();
    await expect(page2.locator('.step-cell').first()).toHaveClass(/active/, { timeout: 5000 });
    await Promise.all([
      page1.getByRole('button', { name: 'Play' }).first().click(),
      page2.getByRole('button', { name: 'Play' }).first().click(),
    ]);
    await page1.waitForTimeout(300);

    await Promise.all([
      page1.getByRole('button', { name: 'Open mixer' }).click(),
      page2.getByRole('button', { name: 'Open mixer' }).click(),
    ]);
    const pan1 = page1.getByRole('slider', { name: 'Test pan' });
    const pan2 = page2.getByRole('slider', { name: 'Test pan' });
    await pan1.fill('-20');
    await expect(pan2).toHaveValue('-20', { timeout: 5000 });

    for (const page of [page1, page2]) {
      await expect.poll(() => page.evaluate(() =>
        window.__audioEngine__?.getTrackPan('mp-test-track')
      )).toBe(-0.2);
    }

    await page2.waitForTimeout(500);
    await page2.reload();
    await waitForAppReady(page2);
    await page2.getByRole('button', { name: 'Play' }).first().click();
    await page2.getByRole('button', { name: 'Open mixer' }).click();
    await expect(page2.getByRole('slider', { name: 'Test pan' })).toHaveValue('-20');
    await expect.poll(() => page2.evaluate(() =>
      window.__audioEngine__?.getTrackPan('mp-test-track')
    )).toBe(-0.2);
  });

  test('scale unlock syncs to the other client and survives reload', async () => {
    await Promise.all([
      page1.goto(`${baseUrl}/s/${sessionId}`),
      page2.goto(`${baseUrl}/s/${sessionId}`),
    ]);
    await Promise.all([waitForAppReady(page1), waitForAppReady(page2)]);

    const selector1 = page1.locator('.scale-selector');
    const selector2 = page2.locator('.scale-selector');
    await expect(selector1).toHaveClass(/locked/);
    await expect(selector2).toHaveClass(/locked/);

    await page1.locator('.scale-lock-btn').click();
    await expect(selector1).not.toHaveClass(/locked/);
    await expect(selector2).not.toHaveClass(/locked/, { timeout: 5000 });

    await page2.reload();
    await waitForAppReady(page2);
    await expect(page2.locator('.scale-selector')).not.toHaveClass(/locked/);
  });

  test('mute/solo remain local (do not sync)', async () => {
    // Load both clients using proper waits
    await page1.goto(`${baseUrl}/s/${sessionId}`);
    await waitForAppReady(page1);

    await page2.goto(`${baseUrl}/s/${sessionId}`);
    await waitForAppReady(page2);

    // Find mute button on client 1
    const muteButton1 = page1.locator('.mute-button, [data-testid="mute-button"]').first();
    const muteButton2 = page2.locator('.mute-button, [data-testid="mute-button"]').first();

    // Every track row renders a mute button; its absence is a regression.
    await expect(muteButton1).toBeVisible({ timeout: 5000 });
    await expect(muteButton2).toBeVisible({ timeout: 5000 });

    // Click mute on client 1
    await muteButton1.click();

    // Verify client 1 shows muted (using web-first assertion)
    await expect(muteButton1).toHaveClass(/active/, { timeout: 2000 });

    // Verify client 2 is NOT muted (mute is local-only)
    // Give a brief moment for any potential (incorrect) sync
    await page2.waitForLoadState('networkidle');
    await expect(muteButton2).not.toHaveClass(/active/);

    console.log('[TEST] Mute correctly stayed local (did not sync)');
  });

  test('add track syncs to other client', async () => {
    // Load both clients using proper waits
    await page1.goto(`${baseUrl}/s/${sessionId}`);
    await waitForAppReady(page1);

    await page2.goto(`${baseUrl}/s/${sessionId}`);
    await waitForAppReady(page2);

    // Verify both start with 1 track
    const trackRows1Before = page1.locator('.track-row');
    const trackRows2Before = page2.locator('.track-row');
    await expect(trackRows1Before).toHaveCount(1, { timeout: 5000 });
    await expect(trackRows2Before).toHaveCount(1, { timeout: 5000 });

    // Find an instrument button to add a track
    const addTrackButton = page1.locator('.instrument-btn, .sample-button').first();
    if (!(await addTrackButton.isVisible({ timeout: 2000 }).catch(() => false))) {
      // Try expanding drums category
      const drumsCategory = page1.locator('.category-header:has-text("Drums")');
      if (await drumsCategory.isVisible()) {
        await drumsCategory.click();
      }
    }

    // Click to add a track
    const instrumentBtn = page1.locator('.instrument-btn, .sample-button').first();
    await expect(instrumentBtn).toBeVisible({ timeout: 5000 });
    await instrumentBtn.click();

    // Verify client 1 now has 2 tracks
    const trackRows1After = page1.locator('.track-row');
    await expect(trackRows1After).toHaveCount(2, { timeout: 5000 });

    // Verify client 2 received the new track
    const trackRows2After = page2.locator('.track-row');
    await expect(trackRows2After).toHaveCount(2, { timeout: 5000 });
  });
});

test.describe('Multiplayer connection resilience', () => {
  test('client reconnects after brief disconnection', async ({ browser, browserName, request }) => {
    // A real backend is guaranteed here (the file skips under USE_MOCK_API), so
    // a failure to create the session is a backend failure, not a skip.
    const result = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'reconnect-test',
          name: 'Test',
          sampleId: 'kick',
          steps: Array(128).fill(false),
          parameterLocks: Array(128).fill(null),
          volume: 1,
          pan: 0,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    });
    const sessionId = result.id;

    const context = await createE2EContext(browser, browserName);
    const page = await context.newPage();

    // Load session using proper waits
    await page.goto(`${baseUrl}/s/${sessionId}`);
    await waitForAppReady(page);

    // Simulate network going offline briefly
    await context.setOffline(true);
    // Brief offline period
    await page.waitForTimeout(1000);

    // Come back online
    await context.setOffline(false);
    // Wait for reconnection
    await page.waitForLoadState('networkidle');

    // Should still be able to interact
    const step0 = page.locator('.step-cell').first();
    await expect(step0).toBeVisible({ timeout: 5000 });
    await step0.click();
    await expect(step0).toHaveClass(/active/, { timeout: 5000 });

    await context.close();
  });
});

test.describe('Multiplayer input validation', () => {
  test('invalid tempo values are rejected by the HTTP boundary', async ({ request }) => {
    const response = await request.post(`${baseUrl}/api/sessions`, {
      data: {
        tracks: [],
        tempo: 999,
        swing: 0,
        version: 1,
      },
    });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Validation failed',
      details: expect.arrayContaining([expect.stringContaining('Tempo')]),
    });
  });
});
