/**
 * Editor dock, phase 2 (specs/PIANO-ROLL-DOCK.md): the per-track pitch panel
 * moves out of the rows into one dock under the grid, inside the same scroller.
 *
 * jsdom has no layout, so the unit tests pin the state machine and wiring;
 * this spec measures what only a browser can show: the dock pins to the
 * scroller, rows stay contiguous, and the dock's step columns sit on the rows'.
 */

import { test, expect, getBaseUrl, waitForCollaborationReady, type Page } from './global-setup';
import { createSessionWithRetry } from './test-utils';

const API_BASE = getBaseUrl();
const DESKTOP = { width: 1280, height: 800 };

function track(id: string, name: string, sampleId: string, activeSteps: number[] = [0, 4]) {
  const steps = Array(128).fill(false);
  for (const step of activeSteps) steps[step] = true;
  return {
    id,
    name,
    sampleId,
    steps,
    parameterLocks: Array(128).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
  };
}

async function openSession(page: Page, request: Parameters<typeof createSessionWithRetry>[0], tracks: unknown[]) {
  await page.setViewportSize(DESKTOP);
  const { id } = await createSessionWithRetry(request, { tracks, tempo: 120, swing: 0, version: 1 });
  await page.goto(`${API_BASE}/s/${id}`);
  await expect(page.locator('[data-testid="grid"]')).toBeVisible({ timeout: 10000 });
  await waitForCollaborationReady(page);
  await expect(page.locator('.track-row-wrapper')).toHaveCount(tracks.length, { timeout: 5000 });
}

const row = (page: Page, name: string) => page.locator('.track-row-wrapper', {
  has: page.locator('.track-name', { hasText: name }),
});
const pitchToggle = (page: Page, name: string) => row(page, name).locator('.expand-toggle');
const dock = (page: Page) => page.getByTestId('editor-dock');

async function expectDocked(page: Page, name: string) {
  await expect(dock(page)).toHaveClass(/\bopen\b/);
  await expect(dock(page).locator('.dock-title b')).toHaveText(name);
  await expect(page.locator('.track-row-wrapper.docked')).toHaveCount(1);
  await expect(row(page, name)).toHaveClass(/\bdocked\b/);
  await expect(page.locator('.expand-toggle.expanded')).toHaveCount(1);
  await expect(pitchToggle(page, name)).toHaveClass(/\bexpanded\b/);
  await expect(dock(page).locator('.dock-track-tab.active')).toHaveText(name);
}

async function expectClosed(page: Page) {
  await expect(dock(page)).not.toHaveClass(/\bopen\b/);
  await expect(dock(page)).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.track-row-wrapper.docked')).toHaveCount(0);
  await expect(page.locator('.expand-toggle.expanded')).toHaveCount(0);
  // The roll unmounts once the dock has collapsed.
  await expect(dock(page).locator('.chromatic-grid, .piano-roll')).toHaveCount(0);
}

const threeTracks = [
  track('lead', 'Lead', 'synth:lead'),
  track('kick', 'Kick', 'kick', [0, 8]),
  track('bass', 'Bass', 'synth:bass', [2, 6]),
];

test.describe('Piano roll dock', () => {
  test('is closed on load and opens from a row pitch toggle', async ({ page, request }) => {
    await openSession(page, request, threeTracks);
    await expectClosed(page);

    await pitchToggle(page, 'Lead').click();
    await expectDocked(page, 'Lead');
    await expect(dock(page).locator('.dock-body .chromatic-grid')).toBeVisible();
    // No pitch panel is left in any row.
    await expect(page.locator('.track-row-wrapper .chromatic-grid, .track-row-wrapper .piano-roll')).toHaveCount(0);

    // The docked outline is drawn: an inset accent ring on the row.
    const shadow = await row(page, 'Lead').locator('.track-row').evaluate(el => getComputedStyle(el).boxShadow);
    expect(shadow).toContain('inset');
    expect(shadow).toContain('rgb(232, 90, 48)');
  });

  test('switches track from another row toggle and from a dock tab', async ({ page, request }) => {
    await openSession(page, request, threeTracks);
    await pitchToggle(page, 'Lead').click();
    await expectDocked(page, 'Lead');

    await pitchToggle(page, 'Bass').click();
    await expectDocked(page, 'Bass');

    // Tabs list the melodic tracks only.
    await expect(dock(page).locator('.dock-track-tab')).toHaveText(['Lead', 'Bass']);
    await dock(page).locator('.dock-track-tab', { hasText: 'Lead' }).click();
    await expectDocked(page, 'Lead');

    // The view mode tabs moved with the panel.
    await dock(page).getByRole('button', { name: 'Piano Roll' }).click();
    await expect(dock(page).locator('.dock-body .piano-roll')).toBeVisible();
    await expect(dock(page).locator('.dock-body .chromatic-grid')).toHaveCount(0);
  });

  test('closes from the docked row toggle, the close button, and Escape inside the dock', async ({ page, request }) => {
    await openSession(page, request, threeTracks);

    await pitchToggle(page, 'Lead').click();
    await expectDocked(page, 'Lead');
    await pitchToggle(page, 'Lead').click();
    await expectClosed(page);

    await pitchToggle(page, 'Bass').click();
    await expectDocked(page, 'Bass');
    await dock(page).getByRole('button', { name: 'Close pitch editor' }).click();
    await expectClosed(page);
    // Focus returns to the row the dock was editing.
    await expect(pitchToggle(page, 'Bass')).toBeFocused();

    await pitchToggle(page, 'Lead').click();
    await expectDocked(page, 'Lead');
    await dock(page).getByRole('button', { name: 'Grid' }).focus();
    await page.keyboard.press('Escape');
    await expectClosed(page);
  });

  test('keeps rows contiguous and the dock columns on the row columns', async ({ page, request }) => {
    await openSession(page, request, threeTracks);
    await pitchToggle(page, 'Lead').click();
    await expectDocked(page, 'Lead');
    await expect(dock(page).locator('.chromatic-cell').first()).toBeVisible();

    const layout = await page.evaluate(() => {
      const inner = document.querySelector('.tracks-inner')!;
      const children = Array.from(inner.children);
      const wrappers = children.filter(child => child.classList.contains('track-row-wrapper'));
      const gaps = wrappers.slice(1).map((wrapper, index) =>
        wrapper.getBoundingClientRect().top - wrappers[index].getBoundingClientRect().bottom);
      const between = wrappers.slice(0, -1).map(wrapper =>
        wrapper.nextElementSibling?.classList.contains('track-row-wrapper') ?? false);
      return {
        lastIsDock: children[children.length - 1]?.id === 'editor-dock',
        dockAfterRows: children.indexOf(document.getElementById('editor-dock')!) === wrappers.length,
        between,
        gaps,
      };
    });
    expect(layout.lastIsDock).toBe(true);
    expect(layout.dockAfterRows).toBe(true);
    // Nothing but rows between rows, and no panel-sized gap either.
    expect(layout.between.every(Boolean)).toBe(true);
    for (const gap of layout.gaps) expect(gap).toBeLessThanOrEqual(4);

    // The dock grid shares the rows' horizontal scroller and step pitch.
    const rowCells = row(page, 'Lead').locator('.step-cell');
    const dockRow = dock(page).locator('.chromatic-row').first();
    for (const step of [0, 4, 8]) {
      const rowBox = await rowCells.nth(step).boundingBox();
      const dockBox = await dockRow.locator('.chromatic-cell').nth(step).boundingBox();
      expect(rowBox).not.toBeNull();
      expect(dockBox).not.toBeNull();
      expect(Math.abs(rowBox!.x - dockBox!.x)).toBeLessThan(3);
    }
  });

  test('pins to the bottom of the track scroller while tracks scroll above it', async ({ page, request }) => {
    const many = Array.from({ length: 14 }, (_, index) => index % 2 === 0
      ? track(`lead-${index}`, `Lead ${index}`, 'synth:lead')
      : track(`kick-${index}`, `Kick ${index}`, 'kick'));
    await openSession(page, request, many);

    const tracks = page.locator('.tracks');
    const scroll = await tracks.evaluate(el => ({
      overflowY: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scroll.overflowY).toBe('auto');
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);

    await pitchToggle(page, 'Lead 0').click();
    await expectDocked(page, 'Lead 0');
    await expect(dock(page).locator('.chromatic-grid')).toBeVisible();

    // Wait for the open transition, then compare the dock's bottom edge with
    // the scroller's visible bottom edge (its padding box, above the scrollbar).
    await expect.poll(async () => {
      const [dockBox, edge] = await Promise.all([
        dock(page).boundingBox(),
        tracks.evaluate(el => el.getBoundingClientRect().top + el.clientTop + el.clientHeight),
      ]);
      return dockBox ? Math.abs(dockBox.y + dockBox.height - edge) : Infinity;
    }).toBeLessThanOrEqual(1);

    // The header stays within the scroller's visible width.
    const [head, scroller] = await Promise.all([
      dock(page).locator('.dock-head').boundingBox(),
      tracks.boundingBox(),
    ]);
    expect(head!.x).toBeGreaterThanOrEqual(scroller!.x - 1);
    expect(head!.x + head!.width).toBeLessThanOrEqual(scroller!.x + scroller!.width + 1);
  });

  test('a track name docks a melodic track; adding or deleting tracks behaves', async ({ page, request }) => {
    await openSession(page, request, threeTracks);

    await row(page, 'Bass').locator('.track-name').click();
    await expectDocked(page, 'Bass');

    // Deleting another track leaves the dock alone; deleting the docked one closes it.
    await row(page, 'Lead').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.track-row-wrapper')).toHaveCount(2);
    await expectDocked(page, 'Bass');
    await row(page, 'Bass').getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.track-row-wrapper')).toHaveCount(1);
    await expectClosed(page);
  });
});
