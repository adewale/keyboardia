/**
 * Editor dock (specs/PIANO-ROLL-DOCK.md): the per-track pitch panel moves out
 * of the rows into one dock under the grid, inside the same scroller, and its
 * roll is the Notes pane (the Grid view is gone; its scale-lock, key and range
 * coverage lives at the end of this file).
 *
 * jsdom has no layout, so the unit tests pin the state machine and wiring;
 * this spec measures what only a browser can show: the dock pins to the
 * scroller, rows stay contiguous, and the dock's step columns sit on the rows'.
 */

import { test, expect, getBaseUrl, waitForCollaborationReady, type Page } from './global-setup';
import { createSessionWithRetry } from './test-utils';
import { DESKTOP_STEP_GEOMETRY, stepToX } from '../src/components/step-geometry';

const API_BASE = getBaseUrl();
const DESKTOP = { width: 1280, height: 800 };

function track(id: string, name: string, sampleId: string, activeSteps: number[] = [0, 4], stepCount = 16) {
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
    stepCount,
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
const paneChip = (page: Page, name: string) => dock(page)
  .getByRole('group', { name: 'Dock pane' })
  .getByRole('button', { name, exact: true });
const tools = (page: Page) => dock(page).locator('.dock-tools');

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
  await expect(dock(page).locator('.piano-roll-editor')).toHaveCount(0);
}

async function openRoll(page: Page, name: string) {
  await pitchToggle(page, name).click();
  await expectDocked(page, name);
  await expect(dock(page).locator('.piano-roll-editor')).toBeVisible();
}

/** Height of the roll's grid viewport, once the detent transition settles. */
const rollHeight = (page: Page) => dock(page).locator('.piano-roll-editor .dock-scroll')
  .evaluate(el => Math.round(el.getBoundingClientRect().height));

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
    // The roll is the Notes pane; there is no other view to choose.
    await expect(dock(page).locator('.dock-body .piano-roll-editor')).toBeVisible();
    await expect(dock(page).getByRole('button', { name: /^(Grid|Piano Roll)$/ })).toHaveCount(0);
    // No pitch panel is left in any row.
    await expect(page.locator('.track-row-wrapper .piano-roll-editor')).toHaveCount(0);

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

    // Tabs list every track: Step and Track apply to drums too.
    await expect(dock(page).locator('.dock-track-tab')).toHaveText(['Lead', 'Kick', 'Bass']);
    await dock(page).locator('.dock-track-tab', { hasText: 'Lead' }).click();
    await expectDocked(page, 'Lead');
    await expect(dock(page).locator('.dock-body .piano-roll-editor')).toBeVisible();
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
    await dock(page).getByRole('group', { name: 'Dock pane' }).getByRole('button', { name: 'Notes' }).focus();
    await page.keyboard.press('Escape');
    await expectClosed(page);
  });

  test('keeps rows contiguous and the dock columns on the row columns', async ({ page, request }) => {
    await openSession(page, request, threeTracks);
    await pitchToggle(page, 'Lead').click();
    await expectDocked(page, 'Lead');
    await expect(dock(page).locator('.piano-roll-editor .note').first()).toBeVisible();

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
        // The loop ruler row comes first, then the rows, then the dock.
        dockAfterRows: children.indexOf(document.getElementById('editor-dock')!)
          === children.indexOf(wrappers[wrappers.length - 1]) + 1,
        between,
        gaps,
      };
    });
    expect(layout.lastIsDock).toBe(true);
    expect(layout.dockAfterRows).toBe(true);
    // Nothing but rows between rows, and no panel-sized gap either.
    expect(layout.between.every(Boolean)).toBe(true);
    for (const gap of layout.gaps) expect(gap).toBeLessThanOrEqual(4);

    // The roll shares the rows' horizontal scroller and step pitch.
    const rowCells = row(page, 'Lead').locator('.step-cell');
    const grid = dock(page).locator('.piano-roll-editor .dock-scroll > :first-child');
    for (const step of [0, 4, 8]) {
      const [rowBox, gridBox] = await Promise.all([rowCells.nth(step).boundingBox(), grid.boundingBox()]);
      expect(rowBox).not.toBeNull();
      expect(gridBox).not.toBeNull();
      expect(Math.abs(rowBox!.x - (gridBox!.x + stepToX(step, DESKTOP_STEP_GEOMETRY)))).toBeLessThan(1);
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
    await expect(dock(page).locator('.piano-roll-editor')).toBeVisible();

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

    // The loop ruler pins to the top of the same scroller while rows pass under it.
    await tracks.evaluate(el => { el.scrollTop = 200; });
    await expect.poll(() => tracks.evaluate(el => el.scrollTop)).toBe(200);
    const [rulerTop, scrollerTop] = await Promise.all([
      page.locator('.ruler-row').evaluate(el => el.getBoundingClientRect().top),
      tracks.evaluate(el => el.getBoundingClientRect().top + el.clientTop),
    ]);
    expect(Math.abs(rulerTop - scrollerTop)).toBeLessThanOrEqual(1);
  });

  test('a track name docks a melodic track; adding or deleting tracks behaves', async ({ page, request }) => {
    await openSession(page, request, threeTracks);

    await row(page, 'Bass').locator('.track-name').click();
    await expectDocked(page, 'Bass');

    // The rows carry no actions: Delete is in the Track pane, and deleting
    // the docked track there closes the dock.
    await expect(page.locator('.track-row-wrapper').getByRole('button', { name: /^(Copy|Clear|Delete|Paste)$/ })).toHaveCount(0);
    await paneChip(page, 'Track').click();
    await tools(page).getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('.track-row-wrapper')).toHaveCount(2);
    await expectClosed(page);
    await expect(row(page, 'Bass')).toHaveCount(0);
  });

  test('renders the piano roll editor and toggles its detent', async ({ page, request }) => {
    await openSession(page, request, threeTracks);
    await openRoll(page, 'Lead');

    const roll = dock(page).locator('.piano-roll-editor');
    await expect(roll).not.toHaveClass(/piano-roll-editor--tall/);
    await expect(dock(page).locator('.piano-roll-editor .note')).toHaveCount(2);
    await expect.poll(() => rollHeight(page)).toBe(252);

    const tall = dock(page).getByRole('button', { name: 'Tall' });
    await expect(tall).toHaveAttribute('aria-pressed', 'false');
    await tall.click();
    await expect(roll).toHaveClass(/piano-roll-editor--tall/);
    await expect.poll(() => rollHeight(page)).toBe(432);
    const compact = dock(page).getByRole('button', { name: 'Compact' });
    await expect(compact).toHaveAttribute('aria-pressed', 'true');

    // The roll's grid is the dock's only vertical scroller.
    const scrollers = await dock(page).evaluate(el => Array.from(el.querySelectorAll('*'))
      .filter(node => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY))
      .map(node => node.getAttribute('class')));
    expect(scrollers).toEqual(['dock-scroll']);

    await compact.click();
    await expect(roll).not.toHaveClass(/piano-roll-editor--tall/);
    await expect.poll(() => rollHeight(page)).toBe(252);
  });

  test('a tall dock keeps its header inside the scroller on a short viewport', async ({ page, request }) => {
    const many = Array.from({ length: 12 }, (_, index) => index % 2 === 0
      ? track(`lead-${index}`, `Lead ${index}`, 'synth:lead')
      : track(`kick-${index}`, `Kick ${index}`, 'kick'));
    await openSession(page, request, many);
    await page.setViewportSize({ width: 1280, height: 560 });
    await openRoll(page, 'Lead 0');
    await dock(page).getByRole('button', { name: 'Tall' }).click();
    await expect(dock(page).locator('.piano-roll-editor')).toHaveClass(/piano-roll-editor--tall/);

    // The scroller is shorter than header + 432px, so the grid is clamped.
    await expect.poll(() => rollHeight(page)).toBeLessThan(432);
    const tracks = page.locator('.tracks');
    await expect.poll(async () => {
      const [head, top] = await Promise.all([
        dock(page).locator('.dock-head').boundingBox(),
        tracks.evaluate(el => el.getBoundingClientRect().top + el.clientTop),
      ]);
      return head ? head.y - top : -Infinity;
    }).toBeGreaterThanOrEqual(-1);
  });

  test('a ghost chip shows and hides the other melodic track as ghost bars', async ({ page, request }) => {
    const tracks = [
      track('lead', 'Lead', 'synth:lead'),
      track('kick', 'Kick', 'kick', [0, 8]),
      track('bass', 'Bass', 'synth:bass', [2, 6]),
      track('pad', 'Pad', 'synth:pad', [1]),
      track('keys', 'Keys', 'synth:rhodes', [3, 5, 7]),
    ];
    await openSession(page, request, tracks);
    await openRoll(page, 'Lead');

    const chips = dock(page).getByRole('group', { name: 'Ghost notes' }).getByRole('button');
    await expect(chips).toHaveText(['Bass', 'Pad', 'Keys']);
    // The two nearest melodic tracks show by default; Keys is further away.
    await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(chips.nth(2)).toHaveAttribute('aria-pressed', 'false');
    const ghosts = (id?: string) => dock(page).locator(id ? `.gnote[data-ghost-track="${id}"]` : '.gnote');
    await expect(ghosts('bass')).toHaveCount(2);
    await expect(ghosts('pad')).toHaveCount(1);
    await expect(ghosts()).toHaveCount(3);

    await chips.nth(0).click();
    await expect(chips.nth(0)).toHaveAttribute('aria-pressed', 'false');
    await expect(ghosts('bass')).toHaveCount(0);
    await expect(ghosts()).toHaveCount(1);

    await chips.nth(2).click();
    await expect(ghosts('keys')).toHaveCount(3);
    await expect(ghosts()).toHaveCount(4);

    // Ghosts wear their track's category colour as a dashed border.
    const border = await ghosts('pad').first().evaluate(el => getComputedStyle(el).borderTopStyle);
    expect(border).toBe('dashed');
  });

  test('keeps the roll columns on the row columns and the keyboard pinned while scrolling', async ({ page, request }) => {
    const wide = [
      track('lead', 'Lead', 'synth:lead', [0, 4, 8, 40], 64),
      track('kick', 'Kick', 'kick', [0, 8], 64),
    ];
    await openSession(page, request, wide);
    await openRoll(page, 'Lead');

    const tracks = page.locator('.tracks');
    const canScroll = await tracks.evaluate(el => el.scrollWidth > el.clientWidth);
    expect(canScroll).toBe(true);

    const leadCells = row(page, 'Lead').locator('.step-cell');
    const kickCells = row(page, 'Kick').locator('.step-cell');
    const note = (start: number) => dock(page).locator(`.piano-roll-editor .note[data-start="${start}"]`);

    const expectAligned = async () => {
      for (const step of [0, 4, 8]) {
        const [leadBox, kickBox, noteBox] = await Promise.all([
          leadCells.nth(step).boundingBox(),
          kickCells.nth(step).boundingBox(),
          note(step).boundingBox(),
        ]);
        expect(leadBox, `lead step ${step} should be measurable`).not.toBeNull();
        expect(kickBox, `kick step ${step} should be measurable`).not.toBeNull();
        expect(noteBox, `dock note ${step} should be measurable`).not.toBeNull();
        if (!leadBox || !kickBox || !noteBox) throw new Error(`step ${step} must exist in rows and dock`);
        expect(Math.abs(leadBox.x - kickBox.x)).toBeLessThan(3);
        expect(Math.abs(leadBox.x - noteBox.x)).toBeLessThan(3);
      }
    };

    await expectAligned();
    const left = dock(page).locator('.piano-roll-editor__left');
    const head = dock(page).locator('.dock-head');
    const [leftBefore, headBefore] = await Promise.all([left.boundingBox(), head.boundingBox()]);

    await tracks.evaluate(el => { el.scrollLeft = 300; });
    await expect.poll(() => tracks.evaluate(el => el.scrollLeft)).toBe(300);

    await expectAligned();
    // The keyboard column and the dock header are sticky-left: they stay put.
    const [leftAfter, headAfter] = await Promise.all([left.boundingBox(), head.boundingBox()]);
    expect(Math.abs(leftAfter!.x - leftBefore!.x)).toBeLessThan(1);
    expect(Math.abs(headAfter!.x - headBefore!.x)).toBeLessThan(1);
  });

  test('puts the loop ruler on the step pitch: page 2 is step 17 in the rows and the dock', async ({ page, request }) => {
    // Three pages, so two page gaps: page 2 starts at step 17, page 3 at step 33.
    const wide = [
      track('lead', 'Lead', 'synth:lead', [0, 16, 32], 48),
      track('kick', 'Kick', 'kick', [0, 8], 48),
    ];
    await openSession(page, request, wide);
    await openRoll(page, 'Lead');

    const tracks = page.locator('.tracks');
    const ruler = page.locator('.loop-ruler');
    const pageMarker = (step: number) => ruler.locator(`.ruler-marker.page[data-step="${step}"]`);
    await expect(pageMarker(16).locator('.marker-label')).toHaveText('2');
    await expect(pageMarker(32).locator('.marker-label')).toHaveText('3');
    await expect(ruler.locator('.ruler-marker.beat[data-step="4"] .marker-label')).toHaveText('1.2');
    await expect(ruler.locator('.ruler-marker.beat[data-step="28"] .marker-label')).toHaveText('2.4');

    // The ruler is the first row inside the scroller, not a strip above it.
    const placement = await page.evaluate(() => {
      const inner = document.querySelector('.tracks-inner')!;
      return inner.firstElementChild?.classList.contains('ruler-row') ?? false;
    });
    expect(placement).toBe(true);

    const dockGrid = dock(page).locator('.piano-roll-editor .dock-scroll > :first-child');
    const expectPagesAligned = async () => {
      for (const step of [16, 32]) {
        const [markerBox, cellBox, noteBox, gridBox] = await Promise.all([
          pageMarker(step).boundingBox(),
          row(page, 'Lead').locator('.step-cell').nth(step).boundingBox(),
          dock(page).locator(`.piano-roll-editor .note[data-start="${step}"]`).boundingBox(),
          dockGrid.boundingBox(),
        ]);
        if (!markerBox || !cellBox || !noteBox || !gridBox) throw new Error(`step ${step + 1} must be measurable everywhere`);
        // The rows keep their page gap; the ruler and the roll honour it.
        expect(Math.abs(markerBox.x - cellBox.x), `ruler page mark at step ${step + 1}`).toBeLessThan(1);
        expect(Math.abs(markerBox.x - noteBox.x), `roll note at step ${step + 1}`).toBeLessThan(1);
        // The roll's column for this step: step pitches plus one page gap per page.
        expect(Math.abs(markerBox.x - (gridBox.x + stepToX(step, DESKTOP_STEP_GEOMETRY))), `roll column ${step + 1}`).toBeLessThan(1);
      }
      // The page gap is really there in the rows: 8px more than the 3px cell gap.
      const [last, first] = await Promise.all([
        row(page, 'Lead').locator('.step-cell').nth(15).boundingBox(),
        row(page, 'Lead').locator('.step-cell').nth(16).boundingBox(),
      ]);
      expect(Math.round(first!.x - (last!.x + last!.width))).toBe(3 + 8);
    };
    await expectPagesAligned();

    // The strip ends where the last cell ends.
    const [rulerBox, lastCell, firstCell] = await Promise.all([
      ruler.boundingBox(),
      row(page, 'Lead').locator('.step-cell').nth(47).boundingBox(),
      row(page, 'Lead').locator('.step-cell').nth(0).boundingBox(),
    ]);
    expect(Math.abs(rulerBox!.x - firstCell!.x)).toBeLessThan(1);
    expect(Math.abs(rulerBox!.x + rulerBox!.width - (lastCell!.x + lastCell!.width))).toBeLessThan(1);

    // Dragging steps 17-20 sets a region whose edges are those cells' edges.
    const y = rulerBox!.y + rulerBox!.height / 2;
    const cellX = async (step: number) => (await row(page, 'Lead').locator('.step-cell').nth(step).boundingBox())!;
    const [from, to] = [await cellX(16), await cellX(19)];
    await page.mouse.move(from.x + 10, y);
    await page.mouse.down();
    await page.mouse.move(to.x + 10, y, { steps: 4 });
    await page.mouse.up();
    await expect(ruler).toHaveClass(/\bhas-loop\b/);
    await expect(ruler).toHaveAttribute('title', 'Loop: steps 17-20 (double-click to clear)');
    const regionBox = await ruler.locator('.loop-region').boundingBox();
    expect(Math.abs(regionBox!.x - from.x)).toBeLessThan(1);
    expect(Math.abs(regionBox!.x + regionBox!.width - (to.x + to.width))).toBeLessThan(1);

    // Horizontal scroll moves the strip with the cells; the spacer stays pinned.
    const spacer = page.locator('.ruler-spacer');
    const spacerBefore = await spacer.boundingBox();
    await tracks.evaluate(el => { el.scrollLeft = 200; });
    await expect.poll(() => tracks.evaluate(el => el.scrollLeft)).toBe(200);
    await expectPagesAligned();
    const spacerAfter = await spacer.boundingBox();
    expect(Math.abs(spacerAfter!.x - spacerBefore!.x)).toBeLessThan(1);

    await ruler.dblclick({ position: { x: 700, y: 12 } });
    await expect(ruler).not.toHaveClass(/\bhas-loop\b/);
  });
});

test.describe('Piano roll dock: Step and Track panes', () => {
  test('Shift+click on a bar opens the Step pane and highlights its column under every pane', async ({ page, request }) => {
    await openSession(page, request, threeTracks);
    await openRoll(page, 'Lead');
    await expect(paneChip(page, 'Notes')).toHaveAttribute('aria-pressed', 'true');

    // Bars take no pointer events (one hit layer computes step and pitch), so
    // click through the bar at its position.
    await dock(page).locator('.piano-roll-editor .note[data-start="4"]').click({ modifiers: ['Shift'], force: true });
    await expect(dock(page)).toHaveAttribute('data-pane', 'step');
    await expect(tools(page).locator('.plock-step')).toHaveText('Step 5');
    await expect(dock(page).locator('.piano-roll-editor .sel-col')).toBeVisible();
    // The row cell carries the same selection.
    await expect(row(page, 'Lead').locator('.step-cell').nth(4)).toHaveClass(/\bselected\b/);

    // The roll stays visible under the Track pane.
    await paneChip(page, 'Track').click();
    await expect(dock(page).locator('.piano-roll-editor')).toBeVisible();
    await expect(row(page, 'Lead').locator('.step-cell.selected')).toHaveCount(0);
  });

  test('a drum track docks from Shift+click with Step, no Notes and no roll', async ({ page, request }) => {
    await openSession(page, request, threeTracks);
    await row(page, 'Kick').locator('.step-cell').nth(8).click({ modifiers: ['Shift'] });

    await expect(dock(page)).toHaveClass(/\bopen\b/);
    await expect(dock(page).locator('.dock-title b')).toHaveText('Kick');
    await expect(dock(page)).toHaveAttribute('data-pane', 'step');
    await expect(paneChip(page, 'Notes')).toBeDisabled();
    await expect(dock(page).locator('.dock-no-pitch')).toHaveText('No pitch for drum tracks');
    await expect(dock(page).locator('.piano-roll-editor')).toHaveCount(0);
    // The ♪ toggle stays melodic-only.
    await expect(row(page, 'Kick').locator('.expand-toggle')).toHaveCount(0);

    await paneChip(page, 'Track').click();
    await expect(tools(page).getByText('Transpose')).toHaveCount(0);
    await tools(page).getByRole('button', { name: 'Rotate pattern right' }).click();
    await expect(row(page, 'Kick').locator('.step-cell.active')).toHaveCount(2);
    await expect(row(page, 'Kick').locator('.step-cell').nth(1)).toHaveClass(/\bactive\b/);
    await expect(row(page, 'Kick').locator('.step-cell').nth(9)).toHaveClass(/\bactive\b/);
  });

  test('the Track pane holds the row controls and stays on screen while the grid scrolls', async ({ page, request }) => {
    const wide = [
      track('lead', 'Lead', 'synth:lead', [0, 4, 8, 40], 64),
      track('bell', 'Bell', 'tone:fm-bell', [2], 64),
    ];
    await openSession(page, request, wide);
    await pitchToggle(page, 'Lead').click();
    await expectDocked(page, 'Lead');
    await paneChip(page, 'Track').click();

    // Transpose, steps and instrument reuse the existing controls.
    await expect(tools(page).locator('.transpose-trigger')).toBeVisible();
    await expect(tools(page).locator('.step-count-trigger')).toBeVisible();
    await expect(tools(page).getByTestId('dock-change-instrument-lead')).toBeVisible();
    await expect(tools(page).locator('.pattern-tools-panel')).toBeVisible();
    await expect(tools(page).getByRole('group', { name: 'Track actions' }).getByRole('button')).toHaveText(['Copy', 'Clear', 'Delete']);
    // FM parameters only for an FM track.
    await expect(tools(page).locator('.fm-slider')).toHaveCount(0);
    await dock(page).locator('.dock-track-tab', { hasText: 'Bell' }).click();
    await expect(tools(page).locator('.fm-slider')).toHaveCount(2);
    // No panel opened between the rows.
    await expect(page.locator('.track-row-wrapper .pattern-tools-panel, .track-row-wrapper .fm-controls-panel')).toHaveCount(0);

    // The toolbar is sticky-left and sized to the scroller, like the header.
    const tracks = page.locator('.tracks');
    const before = await tools(page).boundingBox();
    await tracks.evaluate(el => { el.scrollLeft = 400; });
    await expect.poll(() => tracks.evaluate(el => el.scrollLeft)).toBe(400);
    const [after, scroller] = await Promise.all([tools(page).boundingBox(), tracks.boundingBox()]);
    expect(Math.abs(after!.x - before!.x)).toBeLessThan(1);
    expect(after!.x).toBeGreaterThanOrEqual(scroller!.x - 1);
    expect(after!.x + after!.width).toBeLessThanOrEqual(scroller!.x + scroller!.width + 1);
  });

  test('the step-count control in the Track pane changes the docked track', async ({ page, request }) => {
    await openSession(page, request, threeTracks);
    await pitchToggle(page, 'Bass').click();
    await expectDocked(page, 'Bass');
    await paneChip(page, 'Track').click();

    await tools(page).locator('.step-count-trigger').click();
    await page.getByRole('option', { name: /^32\b/ }).click();
    await expect(row(page, 'Bass').locator('.step-cell')).toHaveCount(32);
    await expect(row(page, 'Lead').locator('.step-cell')).toHaveCount(16);
  });

  test('a published session shows the panes read-only', async ({ page, request }) => {
    await page.setViewportSize(DESKTOP);
    const { id } = await createSessionWithRetry(request, { tracks: threeTracks, tempo: 120, swing: 0, version: 1 });
    const published = await request.post(`${API_BASE}/api/sessions/${id}/publish`);
    expect(published.status()).toBe(201);
    const { id: publishedId } = await published.json();
    await page.goto(`${API_BASE}/s/${publishedId}`);
    await expect(page.locator('.track-row-wrapper')).toHaveCount(3, { timeout: 10000 });

    await pitchToggle(page, 'Lead').click();
    await expect(dock(page)).toHaveClass(/\bread-only\b/);
    await paneChip(page, 'Track').click();
    const controls = tools(page).locator('button, input');
    expect(await controls.count()).toBeGreaterThan(5);
    for (const control of await controls.all()) await expect(control).toBeDisabled();
    // The instrument is a readout: no picker in a published session.
    await expect(tools(page).getByTestId('dock-change-instrument-lead')).toHaveCount(0);

    await paneChip(page, 'Step').click();
    await expect(tools(page).locator('.dock-pane-hint')).toBeVisible();
  });
});

/**
 * Pitch guardrails, moved from the retired chromatic-grid.spec.ts: scale lock
 * constrains new notes but never hides a note, the key's root and fifth are
 * marked, pitches beyond the instrument stay visible and are marked, and a
 * click places a note.
 */
test.describe('Piano roll dock: scale, key and range', () => {
  function pianoTrack(locks: Array<[number, number]>) {
    const steps = Array(128).fill(false);
    const parameterLocks = Array(128).fill(null);
    for (const [step, pitch] of locks) {
      steps[step] = true;
      parameterLocks[step] = { pitch };
    }
    return {
      id: 'piano', name: 'Piano', sampleId: 'sampled:piano', steps, parameterLocks,
      volume: 1, muted: false, soloed: false, transpose: 0, stepCount: 16,
    };
  }

  async function openPianoSession(
    page: Page,
    request: Parameters<typeof createSessionWithRetry>[0],
    locks: Array<[number, number]>,
    scale?: { root: string; scaleId: string; locked: boolean },
  ) {
    await page.setViewportSize(DESKTOP);
    const { id } = await createSessionWithRetry(request, {
      tracks: [pianoTrack(locks)],
      tempo: 120,
      swing: 0,
      ...(scale ? { scale } : {}),
      version: 1,
    });
    await page.goto(`${API_BASE}/s/${id}`);
    await expect(page.locator('.track-row-wrapper')).toHaveCount(1, { timeout: 10000 });
    await waitForCollaborationReady(page);
    await openRoll(page, 'Piano');
  }

  const key = (page: Page, midi: number) => dock(page).locator(`.piano-roll-editor .key[data-midi="${midi}"]`);
  const note = (page: Page, start: number) => dock(page).locator(`.piano-roll-editor .note[data-start="${start}"]`);

  /** Click the roll at a step and pitch, scrolling that pitch row into view first. */
  async function clickRoll(page: Page, step: number, midi: number) {
    const scroller = dock(page).locator('.piano-roll-editor .dock-scroll');
    await scroller.evaluate((element, top) => { element.scrollTop = top; }, (84 - midi) * 18 - 60);
    const grid = await dock(page).locator('.piano-roll-editor .dock-scroll > :first-child').boundingBox();
    if (!grid) throw new Error('the roll grid must be measurable');
    await page.mouse.click(grid.x + stepToX(step, DESKTOP_STEP_GEOMETRY) + 12, grid.y + (84 - midi) * 18 + 9);
  }

  test('shows notes at any pitch, key intervals or not (guardrail #1)', async ({ page, request }) => {
    await openPianoSession(page, request, [[0, -8], [1, -9], [2, -10], [3, -11]]);
    for (const [step, pitch] of [[0, -8], [1, -9], [2, -10], [3, -11]]) {
      await expect(note(page, step)).toHaveAttribute('data-midi', String(60 + pitch));
    }
  });

  test('scale lock marks out-of-scale rows, keeps old notes, snaps new ones', async ({ page, request }) => {
    await openPianoSession(page, request, [[0, 0], [1, 1], [2, 3], [3, 7]], {
      root: 'C', scaleId: 'major', locked: true,
    });
    await expect(page.locator('.scale-selector')).toHaveClass(/locked/);

    // C# and D# are out of C major: their rows are marked, their notes stay.
    await expect(key(page, 61)).toHaveClass(/\bscale-out\b/);
    await expect(key(page, 63)).toHaveClass(/\bscale-out\b/);
    await expect(key(page, 60)).not.toHaveClass(/\bscale-out\b/);
    await expect(note(page, 1)).toHaveAttribute('data-midi', '61');
    await expect(note(page, 2)).toHaveAttribute('data-midi', '63');

    // Click-to-place: a click on the C# row lands on C, the nearest in-scale pitch.
    await clickRoll(page, 6, 61);
    await expect(note(page, 6)).toHaveAttribute('data-midi', '60');
    await expect(row(page, 'Piano').locator('.step-cell').nth(6)).toHaveClass(/\bactive\b/);

    // Unlocking clears the marks; locking again restores them.
    await page.locator('.scale-lock-btn').click();
    await expect(key(page, 61)).not.toHaveClass(/\bscale-out\b/);
    await page.locator('.scale-lock-btn').click();
    await expect(key(page, 61)).toHaveClass(/\bscale-out\b/);
  });

  test('marks the root and fifth of the session key', async ({ page, request }) => {
    await openPianoSession(page, request, [[0, 0]], { root: 'D', scaleId: 'major', locked: false });
    await expect(key(page, 62)).toHaveClass(/\broot\b/);
    await expect(key(page, 69)).toHaveClass(/\bfifth\b/);
    await expect(key(page, 60)).not.toHaveClass(/\broot\b/);
  });

  test('keeps a note beyond the instrument visible and marks its row', async ({ page, request }) => {
    // The piano sample plays up to MIDI 78; MIDI 80 is beyond it.
    await openPianoSession(page, request, [[0, 20], [1, 0]]);
    await expect(note(page, 0)).toHaveAttribute('data-midi', '80');
    await expect(key(page, 80)).toHaveClass(/\bout\b/);
    await expect(key(page, 60)).not.toHaveClass(/\bout\b/);
    // The row's cell carries the same warning.
    await expect(row(page, 'Piano').locator('.step-cell').nth(0)).toHaveClass(/out-of-range/);
  });

  test('five clicks on a fresh session stay inside C minor pentatonic', async ({ page, request }) => {
    await openPianoSession(page, request, []);
    await expect(page.locator('.scale-selector')).toHaveClass(/locked/);
    await expect(page.locator('.scale-root-select')).toHaveValue('C');
    await expect(page.locator('.scale-type-select')).toHaveValue('minor-pentatonic');

    const targets: Array<[number, number]> = [[0, 61], [1, 64], [2, 66], [3, 69], [4, 71]];
    for (const [step, midi] of targets) await clickRoll(page, step, midi);
    for (const [step] of targets) {
      const midi = Number(await note(page, step).getAttribute('data-midi'));
      expect([0, 3, 5, 7, 10]).toContain(((midi - 60) % 12 + 12) % 12);
    }
    await expect(row(page, 'Piano').locator('.step-cell.active')).toHaveCount(5);
  });
});
