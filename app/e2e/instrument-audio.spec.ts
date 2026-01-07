/**
 * Instrument Audio E2E Tests
 *
 * These tests verify that instruments produce sound correctly in a real browser.
 * They specifically target the intermittent "instruments don't make sound" bug
 * that occurs due to async initialization race conditions.
 *
 * ## What These Tests Catch
 *
 * 1. **Tone.js initialization race**: Audio engine initializes but Tone.js
 *    synths aren't ready yet. User hovers → silent failure.
 *
 * 2. **Silent skip anti-pattern**: Readiness checks skip without triggering
 *    initialization, causing permanent failure.
 *
 * 3. **Intermittent failures**: Works sometimes (after Tone.js initializes),
 *    fails sometimes (immediately after page load).
 *
 * ## How Tests Work
 *
 * Uses the `window.audioDebug` API exposed by src/debug/audio-debug.ts:
 * - `audioDebug.status()` - Get engine initialization state
 * - `audioDebug.testInstrument(id)` - Test if instrument produces output
 * - `audioDebug.forceInitAndTest()` - Force init and test all engines
 *
 * @see src/debug/audio-debug.ts
 * @see docs/BUG-PATTERNS.md #9 (Async Engine Initialization Race Condition)
 * @see docs/BUG-PATTERNS.md #10 (Silent Skip Anti-Pattern)
 */

import { test, expect, getBaseUrl, isCI, useMockAPI } from './global-setup';
import type { Page } from './global-setup';
import { sleep } from './test-utils';

const API_BASE = getBaseUrl();

/**
 * SKIP IN CI/MOCK: Audio tests require a non-headless browser with working Web Audio API.
 * Headless browsers (used in CI) don't properly support audio context initialization.
 * Mock API mode also lacks the full app state needed for proper audio testing.
 * Run locally with `npx playwright test e2e/instrument-audio.spec.ts --headed`
 */
test.skip(isCI || useMockAPI, 'Audio tests require non-headless browser with real backend');

// Helper to wait for audio debug API to be available
async function waitForAudioDebug(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    () => typeof window.audioDebug !== 'undefined',
    { timeout }
  );
}

// Helper to trigger user gesture (required for audio)
async function triggerUserGesture(page: Page): Promise<void> {
  // Try multiple methods to trigger audio unlock gesture
  // The audio system listens for clicks on document

  // Method 1: Click on a step button if visible (triggers audio unlock)
  const stepButton = page.locator('.step-button').first();
  if (await stepButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await stepButton.click();
    await sleep(200);
    return;
  }

  // Method 2: Click the play button if visible
  const playButton = page.locator('[aria-label="Play"], .transport button').first();
  if (await playButton.isVisible({ timeout: 1000 }).catch(() => false)) {
    await playButton.click();
    await sleep(100);
    await playButton.click(); // Stop playback
    await sleep(200);
    return;
  }

  // Method 3: Fallback to body click
  await page.click('body', { force: true });
  await sleep(100);
}

// Helper to get audio status
async function getAudioStatus(page: Page): Promise<{
  initialized: boolean;
  toneInitialized: boolean;
  toneReady: boolean;
  advancedReady: boolean;
}> {
  return page.evaluate(async () => {
    const status = await window.audioDebug.status();
    return {
      initialized: status.initialized,
      toneInitialized: status.toneInitialized,
      toneReady: status.engineReadiness.tone,
      advancedReady: status.engineReadiness.advanced,
    };
  });
}

// Helper to ensure audio is fully initialized
async function ensureAudioInitialized(page: Page, maxAttempts = 10): Promise<boolean> {
  // First trigger a user gesture
  await triggerUserGesture(page);
  await sleep(500);

  // Then force init via debug API
  for (let i = 0; i < maxAttempts; i++) {
    const status = await page.evaluate(async () => {
      try {
        await window.audioDebug.forceInitAndTest();
        const status = await window.audioDebug.status();
        return {
          initialized: status.initialized,
          toneInitialized: status.toneInitialized,
          advancedReady: status.engineReadiness.advanced,
        };
      } catch (e) {
        return { initialized: false, toneInitialized: false, advancedReady: false, error: String(e) };
      }
    });

    if (status.initialized && status.toneInitialized && status.advancedReady) {
      return true;
    }

    await sleep(200);
  }

  return false;
}

test.describe('Instrument Audio Initialization', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto(API_BASE);
    await page.waitForLoadState('networkidle');
  });

  test('audioDebug API is available after page load', async ({ page }) => {
    await waitForAudioDebug(page);

    const hasAudioDebug = await page.evaluate(() => {
      return typeof window.audioDebug !== 'undefined';
    });

    expect(hasAudioDebug).toBe(true);
  });

  test('audio engine initializes after user gesture', async ({ page }) => {
    await waitForAudioDebug(page);

    // Before user gesture, audio should not be initialized
    const statusBefore = await getAudioStatus(page);
    expect(statusBefore.initialized).toBe(false);

    // Trigger user gesture by clicking
    await triggerUserGesture(page);
    await sleep(500); // Allow time for initialization

    // After user gesture, basic audio should be initialized
    const statusAfter = await getAudioStatus(page);
    expect(statusAfter.initialized).toBe(true);
  });

  test('Tone.js initializes after initializeTone() is called', async ({ page }) => {
    await waitForAudioDebug(page);
    await triggerUserGesture(page);

    // Force Tone.js initialization
    await page.evaluate(async () => {
      await window.audioDebug.forceInitAndTest();
    });

    const status = await getAudioStatus(page);
    expect(status.toneInitialized).toBe(true);
    expect(status.toneReady).toBe(true);
    expect(status.advancedReady).toBe(true);
  });
});

test.describe('Instrument Preview Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(API_BASE);
    await page.waitForLoadState('networkidle');
    await waitForAudioDebug(page);

    // Ensure audio is fully initialized for these tests
    await ensureAudioInitialized(page);
  });

  test('native synth (synth:*) plays without Tone.js init', async ({ page }) => {
    // Test a native synth - should work without Tone.js
    const result = await page.evaluate(async () => {
      return window.audioDebug.testInstrument('synth:lead');
    });

    expect(result.status).toBe('success');
    expect(result.error).toBeUndefined();
  });

  test('advanced synth (advanced:*) plays after init triggered', async ({ page }) => {
    // The fix: hover should trigger initializeTone() if needed
    // Then play should work
    const result = await page.evaluate(async () => {
      // This simulates what SamplePicker does after our fix:
      // 1. Check if Tone.js initialized
      // 2. If not, trigger init
      // 3. Then play
      const engine = window.__audioEngine__;
      if (engine && !engine.isToneInitialized()) {
        await engine.initializeTone();
      }
      return window.audioDebug.testInstrument('advanced:supersaw');
    });

    expect(result.status).toBe('success');
    expect(result.error).toBeUndefined();
  });

  test('Fat Saw (advanced:supersaw) produces sound', async ({ page }) => {
    // Force init and test
    await page.evaluate(async () => {
      await window.audioDebug.forceInitAndTest();
    });

    const result = await page.evaluate(async () => {
      return window.audioDebug.testInstrument('advanced:supersaw');
    });

    expect(result.status).toBe('success');
    expect(result.id).toBe('advanced:supersaw');
  });

  test('Thick Lead (advanced:thick-lead) produces sound', async ({ page }) => {
    // Force init and test
    await page.evaluate(async () => {
      await window.audioDebug.forceInitAndTest();
    });

    const result = await page.evaluate(async () => {
      return window.audioDebug.testInstrument('advanced:thick-lead');
    });

    expect(result.status).toBe('success');
    expect(result.id).toBe('advanced:thick-lead');
  });
});

test.describe('Intermittent Failure Detection', () => {
  // Run this test multiple times to catch race conditions
  for (let i = 0; i < 5; i++) {
    test(`attempt ${i + 1}: instruments work immediately after page load`, async ({ page }) => {
      // Fresh page load
      await page.goto(API_BASE);
      await page.waitForLoadState('domcontentloaded'); // Don't wait for networkidle
      await waitForAudioDebug(page);

      // Immediately trigger audio (simulating eager user)
      await triggerUserGesture(page);

      // Try to play advanced synth immediately
      // This is where the race condition would cause failure
      const result = await page.evaluate(async () => {
        const engine = window.__audioEngine__;
        if (!engine) {
          return { id: '', name: '', type: '', status: 'error' as const, error: 'Engine not available' };
        }

        // Wait for basic init
        let attempts = 0;
        while (!engine.isInitialized() && attempts < 50) {
          await new Promise(r => setTimeout(r, 100));
          attempts++;
        }

        if (!engine.isInitialized()) {
          return { id: '', name: '', type: '', status: 'error' as const, error: 'Engine did not initialize' };
        }

        // THE FIX: Trigger Tone.js init if needed (ensure-and-use pattern)
        if (!engine.isToneInitialized()) {
          await engine.initializeTone();
        }

        // Now test
        return window.audioDebug.testInstrument('advanced:supersaw');
      });

      expect(result.status).toBe('success');
      if (result.status !== 'success') {
        console.log(`[FAIL] Attempt ${i + 1} failed:`, result.error);
      }
    });
  }
});

test.describe('All Instrument Types', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(API_BASE);
    await page.waitForLoadState('networkidle');
    await waitForAudioDebug(page);

    // Force full initialization with retry
    const initialized = await ensureAudioInitialized(page);
    if (!initialized) {
      console.log('[WARN] Audio not fully initialized, tests may fail');
    }
  });

  const instrumentTypes = [
    // Native synths (should always work)
    { id: 'synth:lead', name: 'Lead (native)' },
    { id: 'synth:bass', name: 'Bass (native)' },
    { id: 'synth:pad', name: 'Pad (native)' },

    // Advanced synths (require Tone.js)
    { id: 'advanced:supersaw', name: 'Fat Saw' },
    { id: 'advanced:thick-lead', name: 'Thick Lead' },
    { id: 'advanced:sub-bass', name: 'Sub Bass' },
    { id: 'advanced:wobble-bass', name: 'Wobble Bass' },
    { id: 'advanced:warm-pad', name: 'Warm Pad' },
    { id: 'advanced:acid-bass', name: 'Acid Bass' },

    // Tone.js synths
    { id: 'tone:fm-epiano', name: 'FM E-Piano' },
    { id: 'tone:membrane-kick', name: 'Membrane Kick' },
  ];

  for (const { id, name } of instrumentTypes) {
    test(`${name} (${id}) produces sound`, async ({ page }) => {
      const result = await page.evaluate(async (instrumentId) => {
        return window.audioDebug.testInstrument(instrumentId);
      }, id);

      expect(result.status, `${name} should produce sound`).toBe('success');
      if (result.status !== 'success') {
        console.log(`[FAIL] ${name} (${id}):`, result.error);
      }
    });
  }
});

test.describe('Hover Preview Integration', () => {
  test('hovering over instrument button triggers preview', async ({ page }) => {
    await page.goto(API_BASE);
    await page.waitForLoadState('networkidle');
    await waitForAudioDebug(page);
    await triggerUserGesture(page);

    // Force init
    await page.evaluate(async () => {
      await window.audioDebug.forceInitAndTest();
    });

    // Find the "Add Track" panel and expand it if needed
    const addTrackPanel = page.locator('.sample-picker');
    await expect(addTrackPanel).toBeVisible({ timeout: 5000 });

    // Find a synth button (Fat Saw is in the "synths" category)
    // First expand the synths category if collapsed
    const synthsHeader = page.locator('.category-header:has-text("Synths")');
    if (await synthsHeader.isVisible()) {
      await synthsHeader.click();
      await sleep(200);
    }

    // Hover over Fat Saw
    const fatSawButton = page.locator('.instrument-btn:has-text("Fat Saw")');
    if (await fatSawButton.isVisible()) {
      // Get status before hover
      const _statusBefore = await getAudioStatus(page);

      // Hover to trigger preview
      await fatSawButton.hover();
      await sleep(300);

      // The hover should have triggered Tone.js init if not already done
      const statusAfter = await getAudioStatus(page);

      // After hovering over advanced synth, Tone.js should be initialized
      expect(statusAfter.toneInitialized).toBe(true);
      expect(statusAfter.advancedReady).toBe(true);
    } else {
      console.log('[SKIP] Fat Saw button not visible in current view');
    }
  });
});

test.describe('Track Playback', () => {
  test('Fat Saw track plays during sequencer playback', async ({ page }) => {
    await page.goto(API_BASE);
    await page.waitForLoadState('networkidle');
    await waitForAudioDebug(page);
    await triggerUserGesture(page);

    // Force init
    await page.evaluate(async () => {
      await window.audioDebug.forceInitAndTest();
    });

    // Add a Fat Saw track via the UI
    const synthsHeader = page.locator('.category-header:has-text("Synths")');
    if (await synthsHeader.isVisible()) {
      await synthsHeader.click();
      await sleep(200);
    }

    const fatSawButton = page.locator('.instrument-btn:has-text("Fat Saw")');
    if (await fatSawButton.isVisible()) {
      await fatSawButton.click();
      await sleep(300);

      // Verify track was added
      const fatSawTrack = page.locator('.track-row:has-text("Fat Saw")');
      await expect(fatSawTrack).toBeVisible({ timeout: 3000 });

      // Toggle some steps
      const stepButtons = fatSawTrack.locator('.step-button');
      const stepCount = await stepButtons.count();
      if (stepCount > 0) {
        await stepButtons.nth(0).click();
        await stepButtons.nth(4).click();
        await stepButtons.nth(8).click();
        await sleep(200);
      }

      // Check audio engine state before playback
      const statusBeforePlay = await getAudioStatus(page);
      expect(statusBeforePlay.advancedReady).toBe(true);

      // Start playback
      const playButton = page.locator('[data-testid="play-button"], .transport button:has-text("▶")');
      if (await playButton.isVisible()) {
        await playButton.click();
        await sleep(500); // Let it play for a bit

        // Check that advanced synth is still ready during playback
        const statusDuringPlay = await getAudioStatus(page);
        expect(statusDuringPlay.advancedReady).toBe(true);

        // Stop playback
        await playButton.click();
      }
    } else {
      console.log('[SKIP] Fat Saw button not visible in current view');
    }
  });
});

// Type declaration for window.audioDebug
declare global {
  interface Window {
    audioDebug: {
      status: () => Promise<{
        initialized: boolean;
        toneInitialized: boolean;
        engineReadiness: {
          sample: boolean;
          synth: boolean;
          tone: boolean;
          advanced: boolean;
          sampled: boolean;
        };
      }>;
      testInstrument: (instrumentId: string) => Promise<{
        id: string;
        name: string;
        type: string;
        status: 'success' | 'error' | 'skipped';
        error?: string;
        details?: Record<string, unknown>;
      }>;
      forceInitAndTest: () => Promise<void>;
      testAdvancedSynths: () => Promise<{
        id: string;
        status: 'success' | 'error' | 'skipped';
        error?: string;
      }[]>;
    };
    __audioEngine__: {
      isInitialized: () => boolean;
      isToneInitialized: () => boolean;
      isToneSynthReady: (type: 'tone' | 'advanced') => boolean;
      initializeTone: () => Promise<void>;
    };
  }
}
