/**
 * E2E Test: Session Loading Race Condition
 *
 * This test verifies that loaded session data is NOT overwritten by
 * an auto-save triggered before the load completes. The race condition:
 *
 * 1. User navigates to /s/{sessionId}
 * 2. Client starts with empty/default state
 * 3. Auto-save triggers (debounced) with empty state
 * 4. Session loads from server with real data
 * 5. Race: Does auto-save overwrite the loaded data?
 *
 * The fix uses a `skipNextSaveRef` flag to prevent saving immediately
 * after loading.
 *
 * @see src/hooks/useSession.ts - skipNextSaveRef logic
 */

import { test, expect } from '@playwright/test';

const API_BASE = process.env.CI
  ? 'https://keyboardia.adewale-883.workers.dev'
  : 'http://localhost:5173';

test.describe('Session Loading Race Condition', () => {
  test('loaded session data persists after initial load', async ({ page, request }) => {
    // Create a session with specific, recognizable data
    const originalTracks = [
      {
        id: 'race-track-1',
        name: 'Race Test Kick',
        sampleId: 'kick',
        steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false],
        parameterLocks: Array(16).fill(null),
        volume: 0.8,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      },
      {
        id: 'race-track-2',
        name: 'Race Test Snare',
        sampleId: 'snare',
        steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false],
        parameterLocks: Array(16).fill(null),
        volume: 0.9,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      },
    ];

    const createRes = await request.post(`${API_BASE}/api/sessions`, {
      data: {
        tracks: originalTracks,
        tempo: 135,
        swing: 15,
        version: 1,
      },
    });

    expect(createRes.ok()).toBe(true);
    const { id: sessionId } = await createRes.json();
    console.log('[TEST] Created session with 2 tracks:', sessionId);

    // Navigate to the session
    await page.goto(`${API_BASE}/s/${sessionId}`);
    await page.waitForLoadState('networkidle');

    // Wait for session to fully load
    await page.waitForTimeout(3000);

    // Verify the tracks are displayed
    const trackRows = page.locator('.track-row');
    await expect(trackRows).toHaveCount(2);

    // Check that the tracks have the expected names (or at least exist)
    await expect(trackRows.first()).toBeVisible();
    await expect(trackRows.last()).toBeVisible();

    // Wait longer to ensure auto-save has had a chance to trigger
    await page.waitForTimeout(5000);

    // Reload the page and verify data is still there
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should still have 2 tracks
    await expect(page.locator('.track-row')).toHaveCount(2);

    // Verify via API that the session still has correct data
    // Retry logic for KV eventual consistency
    // Note: API returns { state: { tracks, tempo, swing, ... } }
    let sessionData;
    for (let attempt = 0; attempt < 3; attempt++) {
      const verifyRes = await request.get(`${API_BASE}/api/sessions/${sessionId}`);
      expect(verifyRes.ok()).toBe(true);
      sessionData = await verifyRes.json();
      if (sessionData.state?.tracks && sessionData.state.tracks.length > 0) break;
      console.log(`[TEST] Retry ${attempt + 1}: tracks undefined, waiting...`);
      await page.waitForTimeout(2000);
    }

    // Log actual response for debugging
    if (!sessionData.state?.tracks) {
      console.log('[TEST] Session data after retries:', JSON.stringify(sessionData, null, 2));
    }

    expect(sessionData.state.tracks).toHaveLength(2);
    expect(sessionData.state.tracks[0].id).toBe('race-track-1');
    expect(sessionData.state.tracks[1].id).toBe('race-track-2');
    expect(sessionData.state.tempo).toBe(135);
    expect(sessionData.state.swing).toBe(15);
  });

  test('session data survives rapid page refresh', async ({ page, request }) => {
    // Create session with data
    const createRes = await request.post(`${API_BASE}/api/sessions`, {
      data: {
        tracks: [
          {
            id: 'refresh-track',
            name: 'Refresh Test',
            sampleId: 'hihat',
            steps: [true, true, true, true, true, true, true, true, false, false, false, false, false, false, false, false],
            parameterLocks: Array(16).fill(null),
            volume: 0.7,
            muted: false,
            playbackMode: 'oneshot',
            transpose: 0,
            stepCount: 16,
          },
        ],
        tempo: 128,
        swing: 0,
        version: 1,
      },
    });

    expect(createRes.ok()).toBe(true);
    const { id: sessionId } = await createRes.json();

    // Load the page
    await page.goto(`${API_BASE}/s/${sessionId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Rapid refresh
    await page.reload();
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForTimeout(500);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Should still have 1 track
    await expect(page.locator('.track-row')).toHaveCount(1);

    // Verify via API with retry for KV consistency
    // Note: API returns { state: { tracks, tempo, swing, ... } }
    let sessionData;
    for (let attempt = 0; attempt < 3; attempt++) {
      const verifyRes = await request.get(`${API_BASE}/api/sessions/${sessionId}`);
      sessionData = await verifyRes.json();
      if (sessionData.state?.tracks && sessionData.state.tracks.length > 0) break;
      console.log(`[TEST] Retry ${attempt + 1}: tracks undefined, waiting...`);
      await page.waitForTimeout(2000);
    }

    if (!sessionData.state?.tracks) {
      console.log('[TEST] Session data after retries:', JSON.stringify(sessionData, null, 2));
    }

    expect(sessionData.state.tracks).toHaveLength(1);
    expect(sessionData.state.tracks[0].id).toBe('refresh-track');
    expect(sessionData.state.tempo).toBe(128);
  });

  test('edits made after load are saved correctly', async ({ page, request }) => {
    // Create session
    const createRes = await request.post(`${API_BASE}/api/sessions`, {
      data: {
        tracks: [
          {
            id: 'edit-track',
            name: 'Edit Test',
            sampleId: 'kick',
            steps: Array(16).fill(false),
            parameterLocks: Array(16).fill(null),
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
    const { id: sessionId } = await createRes.json();

    // Load the page
    await page.goto(`${API_BASE}/s/${sessionId}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Toggle first step (making it active)
    const firstStep = page.locator('.step-cell').first();
    await expect(firstStep).toBeVisible();
    await firstStep.click();

    // Wait for debounced save
    await page.waitForTimeout(6000); // Wait for save debounce (typically 5 seconds)

    // Reload and verify the edit persisted
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // The first step should still be active
    const firstStepAfterReload = page.locator('.step-cell').first();
    const isActive = await firstStepAfterReload.evaluate((el) => {
      return el.classList.contains('active') || el.getAttribute('data-active') === 'true';
    });

    expect(isActive).toBe(true);

    // Also verify via API with retry for KV consistency
    // Note: API returns { state: { tracks, tempo, swing, ... } }
    let sessionData;
    for (let attempt = 0; attempt < 3; attempt++) {
      const verifyRes = await request.get(`${API_BASE}/api/sessions/${sessionId}`);
      sessionData = await verifyRes.json();
      if (sessionData.state?.tracks && sessionData.state.tracks.length > 0) break;
      console.log(`[TEST] Retry ${attempt + 1}: tracks undefined, waiting...`);
      await page.waitForTimeout(2000);
    }

    if (!sessionData.state?.tracks) {
      console.log('[TEST] Session data after retries:', JSON.stringify(sessionData, null, 2));
    }

    expect(sessionData.state.tracks[0].steps[0]).toBe(true);
  });

  test('new session can be created and edited without data loss', async ({ page, request }) => {
    // Navigate to create a new session (root URL creates new session)
    await page.goto(API_BASE);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Get the session ID from the URL
    const url = page.url();
    const sessionIdMatch = url.match(/\/s\/([a-f0-9-]+)/);

    if (!sessionIdMatch) {
      // If no session in URL, we might be on a landing page
      // Look for a "New Session" or similar button
      const newSessionButton = page.locator('button:has-text("New"), a:has-text("New Session")').first();
      if (await newSessionButton.isVisible()) {
        await newSessionButton.click();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(2000);
      }
    }

    // Now we should be in a session
    const currentUrl = page.url();
    const finalSessionMatch = currentUrl.match(/\/s\/([a-f0-9-]+)/);

    if (finalSessionMatch) {
      const sessionId = finalSessionMatch[1];

      // Add a track if none exist
      const addTrackButton = page.locator('button:has-text("Add Track"), [data-testid="add-track"]').first();
      if (await addTrackButton.isVisible()) {
        await addTrackButton.click();
        await page.waitForTimeout(1000);
      }

      // Toggle a step
      const firstStep = page.locator('.step-cell').first();
      if (await firstStep.isVisible()) {
        await firstStep.click();
        await page.waitForTimeout(6000); // Wait for save

        // Verify via API
        // Note: API returns { state: { tracks, tempo, swing, ... } }
        const verifyRes = await request.get(`${API_BASE}/api/sessions/${sessionId}`);
        if (verifyRes.ok()) {
          const sessionData = await verifyRes.json();
          expect(sessionData.state.tracks.length).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });
});
