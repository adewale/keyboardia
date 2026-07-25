/**
 * Core Functionality Tests (P0)
 *
 * Critical path tests for the most important user workflows.
 * These tests must pass for any release.
 *
 * Uses Playwright best practices:
 * - Web-first assertions instead of waitForTimeout
 * - Semantic locators (getByRole) where possible
 * - Proper test isolation
 *
 * @see specs/research/PLAYWRIGHT-TESTING.md
 */

import { test, expect, waitForAppReady } from './global-setup';

/**
 * Add a track to an empty session by clicking an instrument in the picker.
 *
 * Tests here used to add tracks best-effort inside a try/catch and
 * `test.skip(true, 'Could not add track')` on failure, which turned "the app
 * can no longer add a track" — a P0 regression — into a skipped test.
 */
async function addTrack(page: import('@playwright/test').Page): Promise<void> {
  const kickButton = page.getByRole('button', { name: /808 Kick/i });
  await expect(kickButton).toBeVisible({ timeout: 10000 });
  await kickButton.click();
}

// NOTE: "Drag to Paint Steps" test suite was removed.
// These tests had visibility-dependent runtime skips and are fully covered by:
// - e2e/drag-to-paint.spec.ts (comprehensive drag-to-paint E2E tests that pass)
// - src/state/grid.test.ts (TOGGLE_STEP reducer tests)
// - src/components/keyboard-handlers.test.ts (step toggle state tests)

// NOTE: "Tempo Control" test suite was removed.
// These tests had visibility-dependent runtime skips and are fully covered by:
// - src/components/tempo-change.test.ts (32 comprehensive tests including):
//   - Tempo drag calculation unit tests
//   - Property-based tests for bounds, integers, sensitivity
//   - Integration tests with gridReducer
//   - Mutation commutativity tests

test.describe('Track Management', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);
  });

  // This test used to try a delete button, fall back to a right-click context
  // menu, and on failing both do `console.log('Delete button not found ...')`
  // and pass. Delete being entirely broken produced a green test. It also
  // chased three selectors that do not exist in TrackRow.tsx — the real control
  // is `.action-btn.delete` in `.track-actions`, rendered unconditionally
  // (StepSequencer.tsx passes canDelete={true}) and not behind any menu.
  test('can delete a track', async ({ page }) => {
    const trackRows = page.locator('.track-row');
    await expect(trackRows).toHaveCount(0);

    await addTrack(page);
    await expect(trackRows).toHaveCount(1);

    const deleteBtn = trackRows.first().locator('.action-btn.delete');
    await expect(deleteBtn).toBeVisible();
    await deleteBtn.click();

    await expect(trackRows, 'clicking Delete should remove the track').toHaveCount(0);
  });

  // Reorder-by-drag is covered in depth by e2e/track-reorder*.spec.ts (five
  // files, including a precision matrix). This version added tracks
  // best-effort, then `test.skip(true, ...)` if it could not, then returned
  // early on a missing drag handle or bounding box — three separate ways to
  // pass without testing anything. The dedicated specs use the real
  // `.track-drag-handle` selector; this duplicate is removed rather than
  // reimplemented.
});

// NOTE: "Swing Control" test suite was removed.
// These tests had visibility-dependent runtime skips and are fully covered by:
// - src/components/swing-control.test.ts (27 comprehensive tests including):
//   - Swing drag calculation unit tests
//   - Property-based tests for bounds and sensitivity
//   - State flow integration tests

test.describe('Session Name', () => {
  // SessionName.tsx renders a <button class="session-name"> that swaps to an
  // <input class="session-name-input" aria-label="Session name"> while editing.
  // The old version guessed at a heading, three testids and two class names, and
  // logged "Session name input not found after clicking" on failure — so a
  // rename that silently stopped working still passed.
  test('can edit session name', async ({ page }) => {
    await page.goto('/');
    await waitForAppReady(page);

    const sessionName = page.locator('button.session-name');
    await expect(sessionName).toBeVisible({ timeout: 5000 });

    const originalName = await sessionName.textContent();
    await sessionName.click();

    const nameInput = page.getByRole('textbox', { name: 'Session name' });
    await expect(nameInput, 'clicking the name should open an editable input').toBeVisible();

    await nameInput.fill('Test Session Name');
    await page.keyboard.press('Enter');

    await expect(sessionName).toHaveText(/Test Session Name/, { timeout: 5000 });
    expect(originalName).not.toBe('Test Session Name');
  });
});

// NOTE: "Step Count Control" test suite was removed.
// It looked for `.step-count-select` / `select[data-testid="step-count"]` inside
// a `.track-row` on a session with no tracks. Neither selector exists — the real
// control is `select.drawer-select` inside the track's inline drawer, which has
// to be opened first — so the locator never resolved, the surrounding try/catch
// logged "Step count select not found", and the test passed without exercising
// anything. The behaviour is covered by:
// - src/state/grid.test.ts:132  (SET_TRACK_STEP_COUNT behavior)
// - src/state/grid.test.ts:191  (SET_TRACK_STEP_COUNT fixed-length arrays)
// - src/sync/multiplayer.test.ts:639 (action -> set_track_step_count message)
