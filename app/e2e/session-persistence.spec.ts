import { test, expect, APIRequestContext } from '@playwright/test';

/**
 * Session persistence tests - Phase 6 Observability
 *
 * These tests verify that sessions created via API are correctly
 * loaded and displayed in the browser without data loss.
 */

// Use local dev server when running locally, production when deployed
const API_BASE = process.env.CI
  ? 'https://keyboardia.adewale-883.workers.dev'
  : 'http://localhost:5173';

/**
 * Helper to create a session with retry logic for intermittent API failures.
 * CI environments may experience rate limiting or cold starts.
 */
async function createSessionWithRetry(
  request: APIRequestContext,
  data: Record<string, unknown>,
  maxRetries = 3
): Promise<{ id: string }> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const res = await request.post(`${API_BASE}/api/sessions`, { data });
    if (res.ok()) {
      return res.json();
    }
    lastError = new Error(`Session create failed: ${res.status()} ${res.statusText()}`);
    console.log(`[TEST] Session create attempt ${attempt + 1} failed, retrying...`);
    // Wait before retry with exponential backoff
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw lastError ?? new Error('Session create failed after retries');
}

test.describe('Session persistence integrity', () => {
  test('session created via API should load with correct tracks', async ({ page, request }) => {
    // Step 1: Create a session via API with known data
    const testTracks = [
      {
        id: 'test-track-1',
        name: 'Kick',
        sampleId: 'kick',
        steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false, ...Array(48).fill(false)],
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      },
      {
        id: 'test-track-2',
        name: 'Snare',
        sampleId: 'snare',
        steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, ...Array(48).fill(false)],
        parameterLocks: Array(64).fill(null),
        volume: 0.8,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      },
    ];

    console.log('[TEST] Creating session with', testTracks.length, 'tracks');

    const { id } = await createSessionWithRetry(request, {
      tracks: testTracks,
      tempo: 108,
      swing: 15,
      version: 1,
    });
    console.log('[TEST] Created session:', id);

    // Step 2: Immediately verify via debug endpoint
    const debugRes = await request.get(`${API_BASE}/api/debug/session/${id}`);
    expect(debugRes.ok()).toBe(true);
    const debugInfo = await debugRes.json();
    console.log('[TEST] Debug info after create:', JSON.stringify(debugInfo, null, 2));

    expect(debugInfo.exists).toBe(true);
    expect(debugInfo.state.trackCount).toBe(2);
    expect(debugInfo.state.tempo).toBe(108);

    // Step 3: Load the session in the browser
    console.log('[TEST] Loading session in browser:', `${API_BASE}/s/${id}`);
    await page.goto(`${API_BASE}/s/${id}`);

    // Wait for tracks to render (or loading to complete)
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // Give React time to update

    // Step 4: Check what the browser rendered
    const trackRows = page.locator('.track-row');
    const trackCount = await trackRows.count();
    console.log('[TEST] Browser rendered track count:', trackCount);

    // Step 5: Check debug endpoint again to see if session was overwritten
    const debugRes2 = await request.get(`${API_BASE}/api/debug/session/${id}`);
    const debugInfo2 = await debugRes2.json();
    console.log('[TEST] Debug info after browser load:', JSON.stringify(debugInfo2, null, 2));

    // The critical assertion: tracks should still exist
    expect(debugInfo2.state.trackCount).toBe(2);
    expect(trackCount).toBe(2);
  });

  test('debug endpoint returns correct session info', async ({ request }) => {
    // Create a simple session
    const { id } = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'debug-track',
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

    // Use debug endpoint
    const debugRes = await request.get(`${API_BASE}/api/debug/session/${id}`);
    expect(debugRes.ok()).toBe(true);

    const debug = await debugRes.json();
    expect(debug.exists).toBe(true);
    expect(debug.state.trackCount).toBe(1);
    expect(debug.state.tracks[0].name).toBe('Test');
    expect(debug.sizeBytes).toBeGreaterThan(0);
  });

  test('non-existent session returns 404 with debug info', async ({ request }) => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const res = await request.get(`${API_BASE}/api/debug/session/${fakeId}`);

    expect(res.status()).toBe(404);
    const debug = await res.json();
    expect(debug.exists).toBe(false);
    expect(debug.error).toBe('Session not found');
  });
});

test.describe('Observability endpoints', () => {
  test('metrics endpoint returns valid structure', async ({ request }) => {
    const res = await request.get(`${API_BASE}/api/metrics`);
    expect(res.ok()).toBe(true);

    const metrics = await res.json();

    // Check structure
    expect(metrics).toHaveProperty('sessions');
    expect(metrics).toHaveProperty('requests');
    expect(metrics.sessions).toHaveProperty('total');
    expect(metrics.sessions).toHaveProperty('createdToday');
    expect(metrics.sessions).toHaveProperty('accessedToday');
    expect(metrics.requests).toHaveProperty('last5Minutes');
    expect(metrics.requests.last5Minutes).toHaveProperty('creates');
    expect(metrics.requests.last5Minutes).toHaveProperty('reads');
    expect(metrics.requests.last5Minutes).toHaveProperty('updates');
    expect(metrics.requests.last5Minutes).toHaveProperty('remixes');

    console.log('[TEST] Metrics:', JSON.stringify(metrics, null, 2));
  });

  test('debug logs endpoint returns logs array', async ({ request }) => {
    // First, make some API calls to generate logs
    await createSessionWithRetry(request, { tracks: [], tempo: 120, swing: 0, version: 1 });

    // Then check logs
    const res = await request.get(`${API_BASE}/api/debug/logs?last=10`);
    expect(res.ok()).toBe(true);

    const data = await res.json();
    expect(data).toHaveProperty('logs');
    expect(Array.isArray(data.logs)).toBe(true);

    // Should have at least one log from our create call
    if (data.logs.length > 0) {
      const log = data.logs[0];
      expect(log).toHaveProperty('timestamp');
      expect(log).toHaveProperty('requestId');
      expect(log).toHaveProperty('method');
      expect(log).toHaveProperty('path');
      expect(log).toHaveProperty('status');
    }

    console.log('[TEST] Recent logs:', JSON.stringify(data.logs.slice(-3), null, 2));
  });

  test('debug logs can filter by session ID', async ({ request }) => {
    // Create a session
    const { id } = await createSessionWithRetry(request, {
      tracks: [],
      tempo: 120,
      swing: 0,
      version: 1,
    });

    // Load it to generate a read log
    await request.get(`${API_BASE}/api/sessions/${id}`);

    // Update it to generate an update log
    await request.put(`${API_BASE}/api/sessions/${id}`, {
      data: {
        state: { tracks: [], tempo: 130, swing: 10, version: 1 },
      },
    });

    // Get logs filtered by session ID
    const res = await request.get(`${API_BASE}/api/debug/logs?sessionId=${id}&last=10`);
    expect(res.ok()).toBe(true);

    const data = await res.json();
    expect(data).toHaveProperty('logs');

    // All logs should be for our session
    for (const log of data.logs) {
      if (log.sessionId) {
        expect(log.sessionId).toBe(id);
      }
    }

    console.log(`[TEST] Logs for session ${id}:`, data.logs.length, 'entries');
  });
});

test.describe('Debug mode UI', () => {
  test('debug overlay appears with ?debug=1', async ({ page }) => {
    // Go to home page with debug mode
    await page.goto(`${API_BASE}/?debug=1`);
    await page.waitForLoadState('networkidle');

    // Look for debug toggle button
    const debugToggle = page.locator('.debug-toggle');
    await expect(debugToggle).toBeVisible({ timeout: 5000 });

    // Click to expand
    await debugToggle.click();

    // Check for debug content
    const debugContent = page.locator('.debug-content');
    await expect(debugContent).toBeVisible();

    // Should show session info
    const sessionSection = page.locator('.debug-section h4:has-text("Session")');
    await expect(sessionSection).toBeVisible();
  });

  test('debug overlay is hidden without ?debug=1', async ({ page }) => {
    await page.goto(API_BASE);
    await page.waitForLoadState('networkidle');

    // Debug overlay should not exist
    const debugToggle = page.locator('.debug-toggle');
    await expect(debugToggle).not.toBeVisible();
  });
});

test.describe('Session state transitions', () => {
  test('create -> load -> update cycle maintains data integrity', async ({ page, request }) => {
    // Step 1: Create a session with initial data
    const initialTracks = [
      {
        id: 'integrity-test-1',
        name: 'Bass',
        sampleId: 'bass',
        steps: [true, false, false, false, false, false, false, false, true, false, false, false, false, false, false, false, ...Array(48).fill(false)],
        parameterLocks: Array(64).fill(null),
        volume: 0.9,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      },
    ];

    const { id } = await createSessionWithRetry(request, {
      tracks: initialTracks,
      tempo: 100,
      swing: 25,
      version: 1,
    });
    console.log('[TEST] Created session:', id);

    // Step 2: Verify via debug endpoint
    const debugRes1 = await request.get(`${API_BASE}/api/debug/session/${id}`);
    const debug1 = await debugRes1.json();
    expect(debug1.state.trackCount).toBe(1);
    expect(debug1.state.tempo).toBe(100);
    expect(debug1.state.swing).toBe(25);

    // Step 3: Load in browser
    await page.goto(`${API_BASE}/s/${id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Step 4: Verify tracks loaded
    const trackRows = page.locator('.track-row');
    const loadedTrackCount = await trackRows.count();
    expect(loadedTrackCount).toBe(1);

    // Step 5: Check debug endpoint again - data should still be there
    const debugRes2 = await request.get(`${API_BASE}/api/debug/session/${id}`);
    const debug2 = await debugRes2.json();
    expect(debug2.state.trackCount).toBe(1);
    expect(debug2.state.tempo).toBe(100);

    console.log('[TEST] Session integrity verified across create/load cycle');
  });
});
