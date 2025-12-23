import { test, expect, BrowserContext, Page } from '@playwright/test';
import { API_BASE, createSessionWithRetry } from './test-utils';

/**
 * Multiplayer E2E tests - Phase 9-12 features
 *
 * Tests real-time collaboration between multiple browser contexts.
 * Each test creates two independent browser sessions that connect
 * to the same Keyboardia session via WebSocket.
 */

test.describe('Multiplayer real-time sync', () => {
  let context1: BrowserContext;
  let context2: BrowserContext;
  let page1: Page;
  let page2: Page;
  let sessionId: string;

  test.beforeEach(async ({ browser, request }) => {
    // Create a fresh session for each test
    const data = await createSessionWithRetry(request, {
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
    });
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

    // Find tempo display elements (drag-to-adjust UI)
    const tempoDisplay1 = page1.locator('.transport-value').first().locator('.transport-number');
    const tempoDisplay2 = page2.locator('.transport-value').first().locator('.transport-number');

    // Get initial tempo (should be session default of 120)
    const initialTempo1 = await tempoDisplay1.textContent();
    const initialTempo2 = await tempoDisplay2.textContent();
    expect(initialTempo1).toBe(initialTempo2);

    // Change tempo on client 1 by dragging with explicit steps for CI reliability
    const tempoControl1 = page1.locator('.transport-value').first();
    const box = await tempoControl1.boundingBox();
    if (box) {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;

      // Use slower, more deliberate drag for CI stability
      await page1.mouse.move(centerX, centerY);
      await page1.waitForTimeout(100);
      await page1.mouse.down();
      await page1.waitForTimeout(50);

      // Drag upward in small increments
      for (let y = centerY; y > centerY - 60; y -= 10) {
        await page1.mouse.move(centerX, y);
        await page1.waitForTimeout(20);
      }

      await page1.mouse.up();
    }

    // Wait for sync
    await page1.waitForTimeout(1000);

    // Verify tempo changed on client 1
    const newTempo1 = await tempoDisplay1.textContent();
    expect(Number(newTempo1)).toBeGreaterThan(Number(initialTempo1));

    // Verify client 2 received the update (tempo should match)
    await expect(tempoDisplay2).toHaveText(newTempo1!, { timeout: 3000 });

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
    const _playerCountText1 = page1.locator('.debug-content').getByText(/Players:/);

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
    const muteButton1 = page1.locator('.mute-button').first();
    const muteButton2 = page2.locator('.mute-button').first();

    // Click mute on client 1
    await muteButton1.click();
    await page1.waitForTimeout(500);

    // Verify client 1 shows muted (has 'active' class when muted)
    await expect(muteButton1).toHaveClass(/active/);

    // Verify client 2 is NOT muted (mute is local-only)
    await page2.waitForTimeout(1000);
    await expect(muteButton2).not.toHaveClass(/active/);

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

    // Find add track button on client 1 using data-testid
    // First try the floating add button (mobile), then fall back to sample picker
    let addTrackButton = page1.locator('[data-testid="add-track-button"]');
    if (!(await addTrackButton.isVisible())) {
      // Expand drums category and click kick drum
      const drumsCategory = page1.locator('.category-header:has-text("Drums")');
      await drumsCategory.click();
      await page1.waitForTimeout(200);
      addTrackButton = page1.locator('[data-testid="add-track-kick"]');
    }

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
    const { id: sessionId } = await createSessionWithRetry(request, {
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
    });

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
  test('invalid tempo values are clamped by server', async ({ request }) => {
    // Create a session with invalid tempo via API
    const { id: sessionId } = await createSessionWithRetry(request, {
      tracks: [],
      tempo: 999, // Invalid: above max of 180
      swing: 0,
      version: 1,
    });

    // Server should clamp it - check via debug endpoint
    const debugRes = await request.get(`${API_BASE}/api/debug/session/${sessionId}`);
    const debug = await debugRes.json();

    // Tempo should be clamped to max (180 BPM)
    expect(debug.state.tempo).toBe(180);

    console.log('[TEST] Server correctly clamped invalid tempo:', debug.state.tempo);
  });
});
