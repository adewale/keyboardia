/**
 * Session Loading Race Condition Tests
 *
 * Verifies that loaded session data is NOT overwritten by auto-save.
 * Tests the skipNextSaveRef fix for the race condition.
 * Uses Playwright best practices with proper waits.
 *
 * Note: These tests require real backend for proper race condition testing.
 * They will automatically skip if the backend is unavailable.
 *
 * @see src/hooks/useSession.ts - skipNextSaveRef logic
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect, getBaseUrl, waitForAppReady, useMockAPI } from './global-setup';
import { createSessionWithRetry, getSessionWithRetry } from './test-utils';

// Race condition tests are inherently timing-dependent and require real backend
// to properly test the skipNextSaveRef behavior with actual network latency
test.skip(useMockAPI, 'Race condition tests require real backend with actual latency');

test.describe('Session Loading Race Condition', () => {
  const baseUrl = getBaseUrl();

  test('loaded session data persists after initial load', async ({ page, request }) => {
    // Create a session with specific, recognizable data
    const originalTracks = [
      {
        id: 'race-track-1',
        name: 'Race Test Kick',
        sampleId: 'kick',
        steps: [true, false, false, false, true, false, false, false, true, false, false, false, true, false, false, false, ...Array(112).fill(false)],
        parameterLocks: Array(128).fill(null),
        volume: 0.8,
        muted: false,
        transpose: 0,
        stepCount: 16,
      },
      {
        id: 'race-track-2',
        name: 'Race Test Snare',
        sampleId: 'snare',
        steps: [false, false, false, false, true, false, false, false, false, false, false, false, true, false, false, false, ...Array(112).fill(false)],
        parameterLocks: Array(128).fill(null),
        volume: 0.9,
        muted: false,
        transpose: 0,
        stepCount: 16,
      },
    ];

    // This file skips wholesale under USE_MOCK_API, so a real backend is
    // expected here. A session that will not create is a backend failure to
    // report, not a reason to mark the test skipped and move on.
    const result = await createSessionWithRetry(request, {
      tracks: originalTracks,
      tempo: 135,
      swing: 15,
      version: 1,
    });
    const sessionId = result.id;

    console.log('[TEST] Created session with 2 tracks:', sessionId);

    // Navigate to the session
    await page.goto(`${baseUrl}/s/${sessionId}`);
    await waitForAppReady(page);

    // Verify the tracks are displayed
    const trackRows = page.locator('.track-row');
    await expect(trackRows).toHaveCount(2, { timeout: 10000 });

    // Check that the tracks exist
    await expect(trackRows.first()).toBeVisible();
    await expect(trackRows.last()).toBeVisible();

    // Wait for auto-save to complete (debounced 5s) - intentional timing for race test
    await page.waitForTimeout(5000);

    // Reload the page and verify data is still there
    await page.reload();
    await waitForAppReady(page);

    // Should still have 2 tracks
    await expect(page.locator('.track-row')).toHaveCount(2, { timeout: 10000 });

    // Verify via API that the session still has correct data
    const sessionData = await getSessionWithRetry(request, sessionId);
    expect(sessionData.state.tracks).toHaveLength(2);
    expect(sessionData.state.tracks[0].id).toBe('race-track-1');
    expect(sessionData.state.tracks[1].id).toBe('race-track-2');
    expect(sessionData.state.tempo).toBe(135);
    expect(sessionData.state.swing).toBe(15);
  });

  test('session data survives rapid page refresh', async ({ page, request }) => {
    // This file skips wholesale under USE_MOCK_API, so a real backend is
    // expected here. A session that will not create is a backend failure to
    // report, not a reason to mark the test skipped and move on.
    const result = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'refresh-track',
          name: 'Refresh Test',
          sampleId: 'hihat',
          steps: [true, true, true, true, true, true, true, true, false, false, false, false, false, false, false, false, ...Array(112).fill(false)],
          parameterLocks: Array(128).fill(null),
          volume: 0.7,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 128,
      swing: 0,
      version: 1,
    });
    const sessionId = result.id;

    // Load the page
    await page.goto(`${baseUrl}/s/${sessionId}`);
    await waitForAppReady(page);

    // Rapid refresh - testing race condition behavior
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.reload();
    await waitForAppReady(page);

    // Should still have 1 track
    await expect(page.locator('.track-row')).toHaveCount(1, { timeout: 10000 });

    // Verify via API with retry for KV consistency
    const sessionData = await getSessionWithRetry(request, sessionId);
    expect(sessionData.state.tracks).toHaveLength(1);
    expect(sessionData.state.tracks[0].id).toBe('refresh-track');
    expect(sessionData.state.tempo).toBe(128);
  });

  test('edits made after load are saved correctly', async ({ page, request }) => {
    // This file skips wholesale under USE_MOCK_API, so a real backend is
    // expected here. A session that will not create is a backend failure to
    // report, not a reason to mark the test skipped and move on.
    const result = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'edit-track',
          name: 'Edit Test',
          sampleId: 'kick',
          steps: Array(128).fill(false),
          parameterLocks: Array(128).fill(null),
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
    const sessionId = result.id;

    // Load the page
    await page.goto(`${baseUrl}/s/${sessionId}`);
    await waitForAppReady(page);

    // Toggle first step (making it active)
    const firstStep = page.locator('.step-cell').first();
    await expect(firstStep).toBeVisible({ timeout: 5000 });
    await firstStep.click();

    // Wait for debounced save (5s debounce + margin) - intentional timing for save test
    await page.waitForTimeout(6000);

    // Reload and verify the edit persisted
    await page.reload();
    await waitForAppReady(page);

    // The first step should still be active
    const firstStepAfterReload = page.locator('.step-cell').first();
    const isActive = await firstStepAfterReload.evaluate((el) => {
      return el.classList.contains('active') || el.getAttribute('data-active') === 'true';
    });

    expect(isActive).toBe(true);

    // Also verify via API with retry for KV consistency
    const sessionData = await getSessionWithRetry(request, sessionId);
    expect(sessionData.state.tracks[0].steps[0]).toBe(true);
  });

  test('new session can be created and edited without data loss', async ({ page, request }) => {
    // Navigate to create a new session (root URL creates new session)
    await page.goto(baseUrl);
    await waitForAppReady(page);

    // Get the session ID from the URL
    let sessionId: string | null = null;
    const url = page.url();
    const sessionIdMatch = url.match(/\/s\/([a-f0-9-]+)/);

    if (sessionIdMatch) {
      sessionId = sessionIdMatch[1];
    } else {
      // If no session in URL, we might be on a landing page
      const newSessionButton = page.getByRole('button', { name: /new/i })
        .or(page.locator('button:has-text("New"), a:has-text("New Session")')).first();
      if (await newSessionButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await newSessionButton.click();
        await waitForAppReady(page);

        const newUrl = page.url();
        const newMatch = newUrl.match(/\/s\/([a-f0-9-]+)/);
        if (newMatch) {
          sessionId = newMatch[1];
        }
      }
    }

    if (!sessionId) {
      throw new Error('New-session journey did not produce a session URL');
    }

    // Add a track if none exist
    const trackCount = await page.locator('.track-row').count();
    if (trackCount === 0) {
      const addButton = page.locator('.instrument-btn, .sample-button').first();
      await expect(addButton).toBeVisible({ timeout: 5000 });
      await addButton.click();
      await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 5000 });
    }

    // Toggle a step
    const firstStep = page.locator('.step-cell').first();
    await expect(firstStep).toBeVisible({ timeout: 5000 });
    await firstStep.click();
    // Wait for debounced save - intentional timing for save test
    await page.waitForTimeout(6000);

    // Verify via API
    const verifyRes = await request.get(`${baseUrl}/api/sessions/${sessionId}`);
    expect(verifyRes.ok(), `session verification returned ${verifyRes.status()}`).toBe(true);
    const verifiedSession = await verifyRes.json();
    expect(verifiedSession.state.tracks.length).toBeGreaterThanOrEqual(1);
  });
});
