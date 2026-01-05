/**
 * E2E Test: Connection Storm Prevention
 *
 * This test verifies that rapid state changes do NOT cause WebSocket
 * reconnection storms. The bug occurred when getStateForHash callback
 * changed reference on every state update, causing useEffect to re-run
 * and disconnect/reconnect the WebSocket.
 *
 * @see docs/LESSONS-LEARNED.md - Lesson 13
 * @see docs/BUG-PATTERNS.md - Unstable Callback in useEffect Dependency
 */

import { test, expect, Page } from '@playwright/test';
import { API_BASE, createSessionWithRetry } from './test-utils';

// Skip in CI - requires real backend infrastructure
test.skip(!!process.env.CI, 'Skipped in CI - requires real backend');

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
    await page.waitForLoadState('networkidle');

    // Wait for initial WebSocket connection
    await page.waitForTimeout(2000);

    const initialStats = monitor.getStats();
    console.log('[TEST] Initial WebSocket stats:', initialStats);

    // Should have exactly 1 connection after initial load
    expect(initialStats.connects).toBeGreaterThanOrEqual(1);

    // Perform rapid state changes - toggle multiple steps quickly
    const stepCells = page.locator('.step-cell');
    const stepCount = await stepCells.count();

    // Toggle 8 steps in quick succession (simulates rapid user interaction)
    for (let i = 0; i < Math.min(8, stepCount); i++) {
      await stepCells.nth(i).click();
      await page.waitForTimeout(50); // Small delay between clicks
    }

    // Wait for any potential reconnection to settle
    await page.waitForTimeout(1000);

    const afterClickStats = monitor.getStats();
    console.log('[TEST] After rapid clicks WebSocket stats:', afterClickStats);

    // Change tempo rapidly
    const tempoSlider = page.locator('[data-testid="tempo-slider"], .tempo-control input[type="range"]').first();
    if (await tempoSlider.isVisible()) {
      // Simulate dragging the tempo slider
      const box = await tempoSlider.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        for (let i = 0; i < 10; i++) {
          await page.mouse.move(box.x + box.width / 2 + i * 5, box.y + box.height / 2);
          await page.waitForTimeout(30);
        }
        await page.mouse.up();
      }
    }

    await page.waitForTimeout(1000);

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
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Expand debug overlay
    const debugToggle = page.locator('.debug-toggle');
    if (await debugToggle.isVisible()) {
      await debugToggle.click();
      await page.waitForTimeout(500);
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

    // Perform many state changes
    const stepCells = page.locator('.step-cell');
    for (let i = 0; i < 16; i++) {
      if (i < await stepCells.count()) {
        await stepCells.nth(i).click();
        await page.waitForTimeout(100);
      }
    }

    await page.waitForTimeout(1000);

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
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const initialConnects = monitor.getStats().connects;

    // Simulate rapid tempo changes via keyboard (if supported)
    // Or via direct input manipulation
    const tempoInput = page.locator('input[type="number"][aria-label*="tempo" i], .tempo-value input').first();
    if (await tempoInput.isVisible()) {
      await tempoInput.click();
      await tempoInput.fill('130');
      await page.waitForTimeout(200);
      await tempoInput.fill('140');
      await page.waitForTimeout(200);
      await tempoInput.fill('150');
      await page.waitForTimeout(200);
    }

    await page.waitForTimeout(1000);

    const finalConnects = monitor.getStats().connects;

    // Should not have created additional connections
    expect(finalConnects).toBeLessThanOrEqual(initialConnects + 1);
  });
});
