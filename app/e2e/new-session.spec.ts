import { test, expect, waitForAppReady, getBaseUrl, useMockAPI } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();

/**
 * New Session tests - verifies clicking "New" creates a fresh session
 *
 * Bug reported: When clicking "New" from a published session, the title
 * and possibly play/stopped state carry over incorrectly.
 *
 * Uses Playwright best practices with proper waits.
 *
 * Expected behavior:
 * - Session name should reset to null (displayed as "Untitled Session")
 * - Tracks should be empty
 * - Playback should be stopped
 * - A new session ID should be created
 * - Published state should be false
 *
 * Note: These tests require real backend for publish/session-name workflows.
 */

test.describe('New session from published session', () => {
  // Skip in mock mode - publishing workflow needs real backend
  test.skip(useMockAPI, 'New session tests require real backend for publishing workflow');
  test('clicking New should reset session name to empty', async ({ page, request }) => {
    // Step 1: Create a session with a specific name via API (use name field in POST)
    const { id } = await createSessionWithRetry(request, {
      name: 'My Published Session',
      tracks: [
        {
          id: 'test-track-1',
          name: 'Test Track',
          sampleId: 'kick',
          steps: [true, false, false, false, ...Array(60).fill(false)],
          parameterLocks: Array(64).fill(null),
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

    // Step 2: Publish the session (make it immutable)
    const publishRes = await request.post(`${API_BASE}/api/sessions/${id}/publish`);
    expect(publishRes.ok()).toBe(true);
    const published = await publishRes.json();
    const publishedId = published.id;

    // Step 3: Navigate to the published session
    await page.goto(`${API_BASE}/s/${publishedId}`);
    await waitForAppReady(page);

    // Verify the session name is displayed
    const sessionNameElement = page.locator('.session-name');
    await expect(sessionNameElement).toBeVisible();
    const displayedName = await sessionNameElement.textContent();
    expect(displayedName).toContain('My Published Session');

    // Step 5: Get the current URL before clicking New
    const urlBeforeNew = page.url();

    // Step 6: Click the "New" button
    const newButton = page.getByRole('button', { name: /new/i })
      .or(page.locator('.new-btn'));
    await expect(newButton).toBeVisible();
    await newButton.click();

    // Step 7: Wait for navigation and new session to be created
    await expect(async () => {
      const currentUrl = page.url();
      expect(currentUrl).not.toBe(urlBeforeNew);
    }).toPass({ timeout: 5000 });
    await waitForAppReady(page);

    // Step 8: Verify URL changed (new session ID)
    const urlAfterNew = page.url();
    expect(urlAfterNew).not.toBe(urlBeforeNew);
    expect(urlAfterNew).toContain('/s/');

    // Step 9: Verify session name is reset to "Untitled Session"
    const newSessionName = page.locator('.session-name');
    await expect(newSessionName).toBeVisible();
    const newDisplayedName = await newSessionName.textContent();

    // BUG CHECK: This assertion will fail if session name carries over
    expect(newDisplayedName).toBe('Untitled Session');
    expect(newDisplayedName).not.toContain('My Published Session');
  });

  test('clicking New should clear all tracks', async ({ page, request }) => {
    // Step 1: Create a session with tracks
    const { id } = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'track-1',
          name: 'Kick',
          sampleId: 'kick',
          steps: [true, false, false, false, ...Array(60).fill(false)],
          parameterLocks: Array(64).fill(null),
          volume: 1,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
        {
          id: 'track-2',
          name: 'Snare',
          sampleId: 'snare',
          steps: [false, false, false, false, true, ...Array(59).fill(false)],
          parameterLocks: Array(64).fill(null),
          volume: 0.8,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 120,
      swing: 0,
      version: 1,
    });

    // Step 2: Publish the session
    const publishRes = await request.post(`${API_BASE}/api/sessions/${id}/publish`);
    expect(publishRes.ok()).toBe(true);
    const published = await publishRes.json();

    // Step 3: Navigate to the published session
    await page.goto(`${API_BASE}/s/${published.id}`);
    await waitForAppReady(page);

    // Verify tracks are present
    const tracksBeforeNew = page.locator('.track-row');
    await expect(tracksBeforeNew).toHaveCount(2);

    // Step 4: Click the "New" button
    const newButton = page.getByRole('button', { name: /new/i })
      .or(page.locator('.new-btn'));
    await newButton.click();

    // Step 5: Wait for new session using web-first assertion
    await expect(tracksBeforeNew).toHaveCount(0, { timeout: 5000 });
    await waitForAppReady(page);

    // Step 6: Verify tracks are cleared
    const tracksAfterNew = page.locator('.track-row');
    await expect(tracksAfterNew).toHaveCount(0);
  });

  test('clicking New should stop playback', async ({ page, request }) => {
    // Step 1: Create a session with a track
    const { id } = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'track-1',
          name: 'Kick',
          sampleId: 'kick',
          steps: [true, false, false, false, ...Array(60).fill(false)],
          parameterLocks: Array(64).fill(null),
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

    // Step 2: Publish the session
    const publishRes = await request.post(`${API_BASE}/api/sessions/${id}/publish`);
    expect(publishRes.ok()).toBe(true);
    const published = await publishRes.json();

    // Step 3: Navigate to the published session
    await page.goto(`${API_BASE}/s/${published.id}`);
    await waitForAppReady(page);

    // Step 4: Start playback by clicking the play button
    const playButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('.play-button'));
    await expect(playButton).toBeVisible();

    // Click to start playback
    await playButton.click();

    // Verify playback started (play button has 'playing' class)
    await expect(playButton).toHaveClass(/playing/, { timeout: 2000 });

    // Step 5: Click the "New" button while playing
    const newButton = page.getByRole('button', { name: /new/i })
      .or(page.locator('.new-btn'));
    await newButton.click();

    // Step 6: Wait for new session - playback should stop
    const newPlayButton = page.getByRole('button', { name: /play/i })
      .or(page.locator('.play-button'));
    await expect(newPlayButton).not.toHaveClass(/playing/, { timeout: 5000 });

    // Step 7: Verify playback is stopped (no 'playing' class)
    await expect(newPlayButton).toBeVisible();
    await expect(newPlayButton).not.toHaveClass(/playing/);
  });

  test('clicking New should create a different session ID', async ({ page, request }) => {
    // Step 1: Create and publish a session
    const { id } = await createSessionWithRetry(request, {
      tracks: [],
      tempo: 120,
      swing: 0,
      version: 1,
    });

    const publishRes = await request.post(`${API_BASE}/api/sessions/${id}/publish`);
    expect(publishRes.ok()).toBe(true);
    const published = await publishRes.json();

    // Step 2: Navigate to the published session
    await page.goto(`${API_BASE}/s/${published.id}`);
    await waitForAppReady(page);

    // Get the published session ID from URL
    const publishedSessionId = published.id;

    // Step 3: Click the "New" button
    const newButton = page.getByRole('button', { name: /new/i })
      .or(page.locator('.new-btn'));
    await newButton.click();

    // Step 4: Wait for URL to change (new session created)
    await expect(async () => {
      const newUrl = page.url();
      expect(newUrl).not.toContain(publishedSessionId);
    }).toPass({ timeout: 5000 });
    await waitForAppReady(page);

    // Step 5: Extract the new session ID from URL
    const newUrl = page.url();
    const newSessionIdMatch = newUrl.match(/\/s\/([a-f0-9-]+)/);
    expect(newSessionIdMatch).not.toBeNull();
    const newSessionId = newSessionIdMatch![1];

    // Step 6: Verify the session ID is different
    expect(newSessionId).not.toBe(publishedSessionId);
    expect(newSessionId.length).toBeGreaterThan(0);
  });

  test('clicking New should not mark new session as published', async ({ page, request }) => {
    // Step 1: Create and publish a session
    const { id } = await createSessionWithRetry(request, {
      tracks: [
        {
          id: 'track-1',
          name: 'Test',
          sampleId: 'kick',
          steps: Array(64).fill(false),
          parameterLocks: Array(64).fill(null),
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

    const publishRes = await request.post(`${API_BASE}/api/sessions/${id}/publish`);
    expect(publishRes.ok()).toBe(true);
    const published = await publishRes.json();

    // Step 2: Navigate to the published session
    await page.goto(`${API_BASE}/s/${published.id}`);
    await waitForAppReady(page);

    // Verify published badge is visible
    const publishedBadge = page.locator('.published-badge');
    await expect(publishedBadge).toBeVisible();

    // Step 3: Click the "New" button
    const newButton = page.getByRole('button', { name: /new/i })
      .or(page.locator('.new-btn'));
    await newButton.click();

    // Step 4: Wait for new session - badge should disappear
    await expect(publishedBadge).not.toBeVisible({ timeout: 5000 });
    await waitForAppReady(page);

    // Step 5: Verify published badge is NOT visible (new session is editable)
    const newPublishedBadge = page.locator('.published-badge');
    await expect(newPublishedBadge).not.toBeVisible();

    // Step 6: Verify session name is editable (not disabled)
    const sessionName = page.locator('.session-name');
    await expect(sessionName).toBeVisible();
    await expect(sessionName).not.toHaveClass(/session-name-disabled/);
  });
});

test.describe('New session from regular session', () => {
  test('clicking New from editable session should also reset state', async ({ page, request }) => {
    // Step 1: Create an editable session with a name and tracks (use name field in POST)
    const { id } = await createSessionWithRetry(request, {
      name: 'My Editable Session',
      tracks: [
        {
          id: 'track-1',
          name: 'My Track',
          sampleId: 'kick',
          steps: [true, false, false, false, ...Array(60).fill(false)],
          parameterLocks: Array(64).fill(null),
          volume: 1,
          muted: false,
          transpose: 0,
          stepCount: 16,
        },
      ],
      tempo: 140,
      swing: 25,
      version: 1,
    });

    // Step 2: Navigate to the session (not published)
    await page.goto(`${API_BASE}/s/${id}`);
    await waitForAppReady(page);

    // Verify the session name and tracks
    const sessionNameElement = page.locator('.session-name');
    await expect(sessionNameElement).toContainText('My Editable Session');

    const tracks = page.locator('.track-row');
    await expect(tracks).toHaveCount(1);

    // Step 3: Click the "New" button
    const newButton = page.getByRole('button', { name: /new/i })
      .or(page.locator('.new-btn'));
    await newButton.click();

    // Step 4: Wait for state reset using web-first assertions
    await expect(tracks).toHaveCount(0, { timeout: 5000 });
    await waitForAppReady(page);

    // Step 5: Verify state is reset
    const newSessionName = page.locator('.session-name');
    await expect(newSessionName).toContainText('Untitled Session');

    const newTracks = page.locator('.track-row');
    await expect(newTracks).toHaveCount(0);
  });
});
