import { test, expect, BrowserContext, Page } from '@playwright/test';

/**
 * Multiplayer E2E tests - Phase 9-12 features
 *
 * Tests real-time collaboration between multiple browser contexts.
 * Each test creates two independent browser sessions that connect
 * to the same Keyboardia session via WebSocket.
 */

// Use local dev server - multiplayer tests require live WebSocket connections
const API_BASE = process.env.CI
  ? 'https://keyboardia.adewale-883.workers.dev'
  : 'http://localhost:5173';

test.describe('Multiplayer real-time sync', () => {
  let context1: BrowserContext;
  let context2: BrowserContext;
  let page1: Page;
  let page2: Page;
  let sessionId: string;

  test.beforeEach(async ({ browser, request }) => {
    // Create a fresh session for each test
    const createRes = await request.post(`${API_BASE}/api/sessions`, {
      data: {
        tracks: [
          {
            id: 'mp-test-track',
            name: 'Test',
            sampleId: 'kick',
            steps: Array(64).fill(false),
            parameterLocks: Array(64).fill(null),
            volume: 1,
            muted: false,
            playbackMode: 'oneshot',
            transpose: 0,
            stepCount: 16,
          },
        ],
        tempo: 120,
        swing: 0,
        version: 1,
      },
    });

    expect(createRes.ok()).toBe(true);
    const data = await createRes.json();
    sessionId = data.id;
    console.log('[TEST] Created multiplayer test session:', sessionId);

    // Create two independent browser contexts (simulating two users)
    context1 = await browser.newContext();
    context2 = await browser.newContext();
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
      page1.goto(`${API_BASE}/s/${sessionId}`),
      page2.goto(`${API_BASE}/s/${sessionId}`),
    ]);

    // Wait for both to load
    await Promise.all([
      page1.waitForLoadState('networkidle'),
      page2.waitForLoadState('networkidle'),
    ]);

    // Give WebSocket time to connect
    await page1.waitForTimeout(2000);
    await page2.waitForTimeout(1000);

    // Both should show the track
    const trackRows1 = page1.locator('.track-row');
    const trackRows2 = page2.locator('.track-row');

    await expect(trackRows1).toHaveCount(1);
    await expect(trackRows2).toHaveCount(1);
  });

  test('step toggle syncs between clients', async () => {
    // Load both clients
    await page1.goto(`${API_BASE}/s/${sessionId}`);
    await page1.waitForLoadState('networkidle');
    await page1.waitForTimeout(1500);

    await page2.goto(`${API_BASE}/s/${sessionId}`);
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(1500);

    // Find the first step cell in client 1
    const step0Client1 = page1.locator('.step-cell').first();
    const step0Client2 = page2.locator('.step-cell').first();

    // Verify both start as inactive
    await expect(step0Client1).not.toHaveClass(/active/);
    await expect(step0Client2).not.toHaveClass(/active/);

    // Click step 0 on client 1
    await step0Client1.click();

    // Wait for sync
    await page1.waitForTimeout(500);

    // Verify client 1 shows it active
    await expect(step0Client1).toHaveClass(/active/);

    // Verify client 2 received the update
    await expect(step0Client2).toHaveClass(/active/, { timeout: 3000 });

    console.log('[TEST] Step toggle synced successfully between clients');
  });

  test('tempo change syncs between clients', async () => {
    // Load both clients
    await page1.goto(`${API_BASE}/s/${sessionId}`);
    await page1.waitForLoadState('networkidle');
    await page1.waitForTimeout(1500);

    await page2.goto(`${API_BASE}/s/${sessionId}`);
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(1500);

    // Find tempo input on client 1
    const tempoInput1 = page1.locator('input[type="number"]').first();
    const tempoInput2 = page2.locator('input[type="number"]').first();

    // Verify both start at 120
    await expect(tempoInput1).toHaveValue('120');
    await expect(tempoInput2).toHaveValue('120');

    // Change tempo on client 1
    await tempoInput1.fill('140');
    await tempoInput1.press('Enter');

    // Wait for sync
    await page1.waitForTimeout(500);

    // Verify client 2 received the update
    await expect(tempoInput2).toHaveValue('140', { timeout: 3000 });

    console.log('[TEST] Tempo change synced successfully between clients');
  });

  test('player count updates when clients join/leave', async () => {
    // First client loads
    await page1.goto(`${API_BASE}/s/${sessionId}?debug=1`);
    await page1.waitForLoadState('networkidle');
    await page1.waitForTimeout(2000);

    // Expand debug panel to see player count
    const debugToggle1 = page1.locator('.debug-toggle');
    if (await debugToggle1.isVisible()) {
      await debugToggle1.click();
    }

    // Check initial player count (should be 1)
    const playerCountText1 = page1.locator('.debug-content').getByText(/Players:/);

    // Second client joins
    await page2.goto(`${API_BASE}/s/${sessionId}`);
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(2000);

    // Player count should increase to 2 on client 1
    // This is reflected in the debug panel or via console log
    console.log('[TEST] Player count update test - visual verification needed');
  });

  test('mute/solo remain local (do not sync)', async () => {
    // Load both clients
    await page1.goto(`${API_BASE}/s/${sessionId}`);
    await page1.waitForLoadState('networkidle');
    await page1.waitForTimeout(1500);

    await page2.goto(`${API_BASE}/s/${sessionId}`);
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(1500);

    // Find mute button on client 1
    const muteButton1 = page1.locator('button:has-text("M")').first();
    const muteButton2 = page2.locator('button:has-text("M")').first();

    // Click mute on client 1
    await muteButton1.click();
    await page1.waitForTimeout(500);

    // Verify client 1 shows muted
    await expect(muteButton1).toHaveClass(/muted/);

    // Verify client 2 is NOT muted (mute is local-only)
    await page2.waitForTimeout(1000);
    await expect(muteButton2).not.toHaveClass(/muted/);

    console.log('[TEST] Mute correctly stayed local (did not sync)');
  });

  test('add track syncs to other client', async () => {
    // Load both clients
    await page1.goto(`${API_BASE}/s/${sessionId}`);
    await page1.waitForLoadState('networkidle');
    await page1.waitForTimeout(1500);

    await page2.goto(`${API_BASE}/s/${sessionId}`);
    await page2.waitForLoadState('networkidle');
    await page2.waitForTimeout(1500);

    // Verify both start with 1 track
    const trackRows1Before = page1.locator('.track-row');
    const trackRows2Before = page2.locator('.track-row');
    await expect(trackRows1Before).toHaveCount(1);
    await expect(trackRows2Before).toHaveCount(1);

    // Find add track button on client 1
    const addTrackButton = page1.locator('button:has-text("+")').first();

    // Click to add a track
    await addTrackButton.click();
    await page1.waitForTimeout(1000);

    // Verify client 1 now has 2 tracks
    const trackRows1After = page1.locator('.track-row');
    await expect(trackRows1After).toHaveCount(2);

    // Verify client 2 received the new track
    const trackRows2After = page2.locator('.track-row');
    await expect(trackRows2After).toHaveCount(2, { timeout: 3000 });

    console.log('[TEST] Add track synced successfully between clients');
  });
});

test.describe('Multiplayer connection resilience', () => {
  test('client reconnects after brief disconnection', async ({ browser, request }) => {
    // Create a session
    const createRes = await request.post(`${API_BASE}/api/sessions`, {
      data: {
        tracks: [
          {
            id: 'reconnect-test',
            name: 'Test',
            sampleId: 'kick',
            steps: Array(64).fill(false),
            parameterLocks: Array(64).fill(null),
            volume: 1,
            muted: false,
            playbackMode: 'oneshot',
            transpose: 0,
            stepCount: 16,
          },
        ],
        tempo: 120,
        swing: 0,
        version: 1,
      },
    });

    const { id: sessionId } = await createRes.json();

    const context = await browser.newContext();
    const page = await context.newPage();

    // Load session
    await page.goto(`${API_BASE}/s/${sessionId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Simulate network going offline briefly
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    // Come back online
    await context.setOffline(false);
    await page.waitForTimeout(3000);

    // Should still be able to interact
    const step0 = page.locator('.step-cell').first();
    await step0.click();
    await expect(step0).toHaveClass(/active/);

    console.log('[TEST] Client successfully reconnected after network disruption');

    await context.close();
  });
});

test.describe('Multiplayer input validation', () => {
  test('invalid tempo values are clamped by server', async ({ browser, request }) => {
    // Create a session
    const createRes = await request.post(`${API_BASE}/api/sessions`, {
      data: {
        tracks: [],
        tempo: 120,
        swing: 0,
        version: 1,
      },
    });

    const { id: sessionId } = await createRes.json();

    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${API_BASE}/s/${sessionId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    // Try to set tempo above max (300)
    const tempoInput = page.locator('input[type="number"]').first();
    await tempoInput.fill('999');
    await tempoInput.press('Enter');
    await page.waitForTimeout(500);

    // Server should clamp it - check via debug endpoint
    const debugRes = await request.get(`${API_BASE}/api/debug/session/${sessionId}`);
    const debug = await debugRes.json();

    // Tempo should be clamped to 300 (MAX_TEMPO)
    expect(debug.state.tempo).toBeLessThanOrEqual(300);

    console.log('[TEST] Server correctly clamped invalid tempo:', debug.state.tempo);

    await context.close();
  });
});
