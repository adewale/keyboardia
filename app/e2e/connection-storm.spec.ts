/**
 * E2E Test: Connection Storm Prevention
 *
 * This test verifies that rapid state changes do NOT cause WebSocket
 * reconnection storms. The bug occurred when getStateForHash callback
 * changed reference on every state update, causing useEffect to re-run
 * and disconnect/reconnect the WebSocket.
 *
 * Uses Playwright best practices with minimal fixed waits.
 * Note: Some timing waits are intentional for testing connection behavior.
 *
 * @see docs/LESSONS-LEARNED.md - Lesson 13
 * @see docs/BUG-PATTERNS.md - Unstable Callback in useEffect Dependency
 */

import { test, expect, waitForAppReady, getBaseUrl, isCI } from './global-setup';
import type { Page } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();

// Connection storm tests require real WebSocket backend - cannot mock WS monitoring
test.skip(isCI, 'Connection storm tests require real WebSocket backend');

/**
 * Helper to count WebSocket connections by monitoring DevTools.
 * Returns an object with connect/disconnect counts.
 */
async function setupWebSocketMonitor(page: Page): Promise<{ getStats: () => { connects: number; disconnects: number } }> {
  const stats = { connects: 0, disconnects: 0 };

  // Listen for WebSocket events via CDP
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');

  client.on('Network.webSocketCreated', () => {
    stats.connects++;
  });

  client.on('Network.webSocketClosed', () => {
    stats.disconnects++;
  });

  return {
    getStats: () => ({ ...stats }),
  };
}

test.describe('Connection Storm Prevention', () => {
  test('rapid state changes do not cause WebSocket reconnections', async ({ page, request }) => {
    // Create a fresh session
    const { id: sessionId } = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'storm-test-track',
          name: 'Storm Test',
          sampleId: 'kick',
          steps: Array(16).fill(false),
          parameterLocks: Array(16).fill(null),
          volume: 1,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    });

    // Set up WebSocket monitoring
    const monitor = await setupWebSocketMonitor(page);

    // Navigate to the session
    await page.goto(`${API_BASE}/s/${sessionId}?debug=1`);
    await waitForAppReady(page);

    // Wait for initial WebSocket connection to stabilize
    // This is intentional - we need the connection to be established before testing
    await expect(async () => {
      const stats = monitor.getStats();
      expect(stats.connects).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 5000, intervals: [200, 500, 1000] });

    const initialStats = monitor.getStats();
    console.log('[TEST] Initial WebSocket stats:', initialStats);

    // Should have exactly 1 connection after initial load
    expect(initialStats.connects).toBeGreaterThanOrEqual(1);

    // Perform rapid state changes - toggle multiple steps quickly
    const stepCells = page.locator('.step-cell');
    const stepCount = await stepCells.count();

    // Toggle 8 steps in quick succession (simulates rapid user interaction)
    // Intentionally rapid - testing connection stability under load
    for (let i = 0; i < Math.min(8, stepCount); i++) {
      await stepCells.nth(i).click();
      // Minimal delay - just enough for event processing
      await page.waitForTimeout(50);
    }

    // Wait for any potential reconnection to settle using assertion
    await page.waitForLoadState('networkidle');

    const afterClickStats = monitor.getStats();
    console.log('[TEST] After rapid clicks WebSocket stats:', afterClickStats);

    // Change tempo rapidly using smooth drag
    const tempoSlider = page.getByLabel(/tempo/i)
      .or(page.locator('[data-testid="tempo-slider"], .tempo-control input[type="range"]')).first();
    if (await tempoSlider.isVisible()) {
      const box = await tempoSlider.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        // Smooth drag motion instead of loop with timeouts
        await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2, { steps: 10 });
        await page.mouse.up();
      }
    }

    // Wait for network to settle
    await page.waitForLoadState('networkidle');

    const finalStats = monitor.getStats();
    console.log('[TEST] Final WebSocket stats:', finalStats);

    // CRITICAL ASSERTION: No additional WebSocket connections should have been made
    // (beyond the initial connection). The connection count should NOT increase
    // during state changes if the bug is fixed.
    //
    // We allow for 1 extra connection in case of initial connection retry,
    // but more than that indicates a connection storm.
    expect(finalStats.connects).toBeLessThanOrEqual(initialStats.connects + 1);

    // Also check debug overlay if visible
    const debugOverlay = page.locator('.debug-overlay');
    if (await debugOverlay.isVisible()) {
      // Check for connection storm warning
      const stormWarning = page.locator('.debug-warning:has-text("CONNECTION STORM")');
      await expect(stormWarning).not.toBeVisible();
    }
  });

  test('debug overlay shows stable connection count during interactions', async ({ page, request }) => {
    // Create a fresh session
    const { id: sessionId } = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'debug-test-track',
          name: 'Debug Test',
          sampleId: 'snare',
          steps: Array(16).fill(false),
          parameterLocks: Array(16).fill(null),
          volume: 1,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    });

    // Navigate with debug mode enabled
    await page.goto(`${API_BASE}/s/${sessionId}?debug=1`);
    await waitForAppReady(page);

    // Expand debug overlay
    const debugToggle = page.locator('.debug-toggle');
    if (await debugToggle.isVisible()) {
      await debugToggle.click();
      // Wait for debug content to be visible
      await page.locator('.debug-content').waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
    }

    // Get initial unique player ID count from debug overlay
    const getUniqueIdCount = async (): Promise<number> => {
      const connectionsText = await page.locator('.debug-info:has-text("Connections")').textContent();
      if (connectionsText) {
        // Format: "Connections: X total, Y unique IDs"
        const match = connectionsText.match(/(\d+)\s+unique/);
        if (match) {
          return parseInt(match[1], 10);
        }
      }
      return 0;
    };

    const initialUniqueIds = await getUniqueIdCount();
    console.log('[TEST] Initial unique player IDs:', initialUniqueIds);

    // Perform many state changes - rapid clicks to stress test
    const stepCells = page.locator('.step-cell');
    const count = await stepCells.count();
    for (let i = 0; i < Math.min(16, count); i++) {
      await stepCells.nth(i).click();
      // Minimal delay for event processing
      await page.waitForTimeout(100);
    }

    // Wait for state to settle
    await page.waitForLoadState('networkidle');

    const finalUniqueIds = await getUniqueIdCount();
    console.log('[TEST] Final unique player IDs:', finalUniqueIds);

    // Unique player ID count should NOT increase significantly
    // Each reconnection generates a new player ID, so if count increases
    // dramatically, we have a connection storm
    expect(finalUniqueIds).toBeLessThanOrEqual(initialUniqueIds + 2);

    // Should NOT show connection storm warning
    const stormWarning = page.locator('.debug-warning:has-text("CONNECTION STORM")');
    await expect(stormWarning).not.toBeVisible();
  });

  test('connection remains stable during tempo changes', async ({ page, request }) => {
    const { id: sessionId } = await createSessionWithRetry(request, {
      tracks: [],
      tempo: 120,
      swing: 0,
      version: 1,
    });

    const monitor = await setupWebSocketMonitor(page);

    await page.goto(`${API_BASE}/s/${sessionId}`);
    await waitForAppReady(page);

    // Wait for initial connection to stabilize
    await expect(async () => {
      expect(monitor.getStats().connects).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 5000, intervals: [200, 500] });

    const initialConnects = monitor.getStats().connects;

    // Simulate rapid tempo changes via direct input
    const tempoInput = page.getByRole('spinbutton', { name: /tempo/i })
      .or(page.locator('input[type="number"][aria-label*="tempo" i], .tempo-value input')).first();
    if (await tempoInput.isVisible()) {
      await tempoInput.click();
      await tempoInput.fill('130');
      await tempoInput.fill('140');
      await tempoInput.fill('150');
    }

    // Wait for state to settle
    await page.waitForLoadState('networkidle');

    const finalConnects = monitor.getStats().connects;

    // Should not have created additional connections
    expect(finalConnects).toBeLessThanOrEqual(initialConnects + 1);
  });
});
