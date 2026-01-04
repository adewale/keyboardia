/**
 * Session Fixtures
 *
 * Provides pre-configured sessions for E2E tests with automatic cleanup.
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test as base, expect } from '@playwright/test';
import { API_BASE, createSessionWithRetry, SessionState } from '../test-utils';

/**
 * Track data for session fixtures
 */
export interface TrackData {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: (null | Record<string, number>)[];
  volume: number;
  muted: boolean;
  transpose: number;
  stepCount: number;
}

/**
 * Session fixture result
 */
export interface SessionFixture {
  id: string;
  url: string;
}

/**
 * Session with tracks fixture result
 */
export interface SessionWithTracksFixture extends SessionFixture {
  tracks: TrackData[];
}

/**
 * Create a minimal track definition
 */
export function createTrack(overrides: Partial<TrackData> = {}): TrackData {
  const id = overrides.id || `track-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: overrides.name || 'Test Track',
    sampleId: overrides.sampleId || 'kick',
    steps: overrides.steps || Array(64).fill(false),
    parameterLocks: overrides.parameterLocks || Array(64).fill(null),
    volume: overrides.volume ?? 1,
    muted: overrides.muted ?? false,
    transpose: overrides.transpose ?? 0,
    stepCount: overrides.stepCount ?? 16,
  };
}

/**
 * Default tracks for multi-track sessions
 */
export const DEFAULT_TRACKS: TrackData[] = [
  createTrack({ id: 'kick', name: 'Kick', sampleId: 'kick' }),
  createTrack({ id: 'snare', name: 'Snare', sampleId: 'snare' }),
  createTrack({ id: 'hihat', name: 'Hi-Hat', sampleId: 'hihat-closed' }),
];

/**
 * Session test fixture that extends base test
 */
export const test = base.extend<{
  freshSession: SessionFixture;
  sessionWithTracks: SessionWithTracksFixture;
  sessionWithSteps: SessionWithTracksFixture;
}>({
  /**
   * Fresh empty session
   */
  freshSession: async ({ request }, use) => {
    const { id } = await createSessionWithRetry(request, {
      tracks: [],
      tempo: 120,
      swing: 0,
      version: 1,
    });

    await use({
      id,
      url: `/s/${id}`,
    });

    // No cleanup needed - sessions are ephemeral
  },

  /**
   * Session with default drum tracks
   */
  sessionWithTracks: async ({ request }, use) => {
    const tracks = DEFAULT_TRACKS;

    const { id } = await createSessionWithRetry(request, {
      tracks,
      tempo: 120,
      swing: 0,
      version: 1,
    });

    await use({
      id,
      url: `/s/${id}`,
      tracks,
    });
  },

  /**
   * Session with tracks that have active steps (for playback testing)
   */
  sessionWithSteps: async ({ request }, use) => {
    // Create tracks with a simple pattern
    const tracks: TrackData[] = [
      createTrack({
        id: 'kick',
        name: 'Kick',
        sampleId: 'kick',
        steps: [
          true, false, false, false,  // Beat 1
          true, false, false, false,  // Beat 2
          true, false, false, false,  // Beat 3
          true, false, false, false,  // Beat 4
          ...Array(48).fill(false),
        ],
      }),
      createTrack({
        id: 'snare',
        name: 'Snare',
        sampleId: 'snare',
        steps: [
          false, false, false, false, // Beat 1
          true, false, false, false,  // Beat 2
          false, false, false, false, // Beat 3
          true, false, false, false,  // Beat 4
          ...Array(48).fill(false),
        ],
      }),
      createTrack({
        id: 'hihat',
        name: 'Hi-Hat',
        sampleId: 'hihat-closed',
        steps: [
          true, false, true, false,   // Beat 1
          true, false, true, false,   // Beat 2
          true, false, true, false,   // Beat 3
          true, false, true, false,   // Beat 4
          ...Array(48).fill(false),
        ],
      }),
    ];

    const { id } = await createSessionWithRetry(request, {
      tracks,
      tempo: 120,
      swing: 0,
      version: 1,
    });

    await use({
      id,
      url: `/s/${id}`,
      tracks,
    });
  },
});

/**
 * Helper to wait for session to load in browser
 */
export async function waitForSessionLoad(page: import('@playwright/test').Page): Promise<void> {
  // Wait for the sequencer grid to be visible
  await page.waitForSelector('.sequencer-grid, .track-row', { timeout: 10000 });
  // Wait for network to settle
  await page.waitForLoadState('networkidle');
}

/**
 * Helper to verify session state matches expected
 */
export async function verifySessionState(
  page: import('@playwright/test').Page,
  expectedTracks: number,
  expectedTempo?: number
): Promise<void> {
  // Verify track count
  const trackRows = page.locator('.track-row');
  await expect(trackRows).toHaveCount(expectedTracks);

  // Verify tempo if provided
  if (expectedTempo !== undefined) {
    const tempoDisplay = page.locator('.transport-number').first();
    await expect(tempoDisplay).toHaveText(String(expectedTempo));
  }
}

export { expect } from '@playwright/test';
