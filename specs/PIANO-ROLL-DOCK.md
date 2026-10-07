# Piano Roll Dock

> **Status:** Proposal
> **Created:** October 2026
> **Companions:** [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md), [CHROMATIC-GRID-REDESIGN.md](./CHROMATIC-GRID-REDESIGN.md), [MOBILE-INTERFACE-SIMPLIFICATION.md](./MOBILE-INTERFACE-SIMPLIFICATION.md), [research/PITCH-VISUALIZATION-RESEARCH.md](./research/PITCH-VISUALIZATION-RESEARCH.md), and on the roadmap branch (PR #61) `AFFORDANCES.md` and `LOOP-RULER-LESSONS.md`
> **Mocks:** [mocks/piano-roll-dock.html](./mocks/piano-roll-dock.html) (interactive prototype, the source of every geometry number below), [mocks/piano-roll-layout-options.html](./mocks/piano-roll-layout-options.html) (ranked arrangements and the two-rolls test), [mocks/piano-roll-dock-storyboard.html](./mocks/piano-roll-dock-storyboard.html) (layer stack, scenario storyboard, roadmap impact)

## The Problem

The piano roll (Phase 31H) is a panel inserted between the track it edits and the next track. Three things follow from that placement, and none can be fixed by restyling it.

1. **The keyboard is the control column.** The roll's step columns must align with the step cells above, so its left edge is pinned to the right edge of `.track-left`. The keyboard is therefore 512px wide (`--track-left-width`, `app/src/index.css:189`), and it is drawn as ivory gradients on a wood body, which the rest of the app does not do.
2. **An open roll splits the grid.** Keyboardia's sea of cells works because every row sits on the same 39px step pitch and rows butt against each other, so the eye can scan a column to see which instruments hit a beat together. A 400px panel under one track breaks that scan. Two open rolls (Lead and Bass) push the drums two panels away.
3. **The notes ignore the data.** Each active step draws as one 36px block. A step whose lock carries `tie: true` looks like a new hit, and `volume` is not drawn at all, so a whisper and an accent are the same orange.

The roll also shares the track row's sprawl: a row can stack seven surfaces below it with no accordion (TrackDrawer, instrument picker, PatternToolsPanel, VelocityLane, the legacy InlineDrawer, the FM panel, the pitch panel, and the ParameterLockEditor strip), every one with its own `useState` in `TrackRow.tsx:163-171`.

## The Proposal

One **editor dock** under the sea of cells, inside the same horizontal scroller, pinned to the bottom of the viewport while the tracks scroll above it. It shows one track at a time, chosen by that track's pitch toggle, its name, or a tab in the dock. Other melodic tracks appear as ghost notes. The dock's keyboard fills the same 134px column as the track names, so keys and names share one left edge and the dock grid starts where the step cells start. The dock's own controls sit in a toolbar under its header. Rows never gain or lose a panel between them.

The dock has three panes over one grid:

| Pane | Shows | Absorbs |
|---|---|---|
| Notes | The roll: bars, ties, velocity as brightness, ghosts of other melodic tracks, ghost toggles, best-range bracket, default velocity | ChromaticGrid, PianoRoll |
| Step | The selected step's lock: pitch, volume, tie, envelope stages; highlights the step's column in the grid | ParameterLockEditor strip, the envelope editor from PR #87 |
| Track | Transpose, step count, instrument, pattern tools, copy / clear / delete, FM parameters | PatternToolsPanel, FM panel, instrument picker, the landscape TrackDrawer's contents |

The velocity lane stays inline as a property lane under its row, because it is a row of cells on the column grid and tessellates. Melodic cells gain a **pitch contour mark**, so the melody stays readable in the grid while the dock shows another track.

**The rule this encodes:** rows of cells stay inline; editors dock.

### Decisions already taken

- The dock opens only on request (pitch toggle, track name, dock tab, Shift+click on a step). Adding a melodic track does not open it.
- The dock has two height detents, compact (252px grid) and tall (432px grid), toggled from the dock header.
- Which track is docked is not persisted. The dock starts closed on load.
- The **row diet** ships with the dock, as a **two-line control block**. Line one is identity: category tick, name, transpose readout. Line two is state and disclosure: mute and solo, then badge, pitch toggle and lane toggle. Two 18px lines fit inside the existing 44px row, so the column drops from 508px to 134px with no change to row height. Step count, instrument, pattern tools and actions are edited in the Track pane. See Constraints for what the width change costs.

## Visual Representation

Geometry, taken from the prototype:

| Element | Value | Source |
|---|---|---|
| Step pitch | 36px cell + 3px gap = 39px | `StepCell.css`, `TrackRow.css` |
| Control column | Two-line block: `[drag] 16px [body] 110px`, rows `[identity] 18px [controls] 18px`, row gap 2px, column gap 4px, padding 0 4px = 134px × 44px | this spec, mock |
| Line one (identity) | 3px category tick · name · transpose readout, right-aligned, mono 10px | mock |
| Line two (controls) | state group M · S (20×18px), 4px, disclosure group badge (26×18px) · ♪ · lane (20×18px), 2px gaps | mock |
| Dock left panel | 134px: 18px range rail · 116px keyboard | mock |
| Dock toolbar | Under the dock header, sticky-left, sized to the scroller; holds the Notes, Step or Track controls | mock |
| Dock grid row height | 18px | mock |
| Dock grid height | 252px compact, 432px tall | decided |
| Pitch range | C2 to C6 (MIDI 36 to 84); the grid scrolls vertically and centres on the docked track's notes | mock |
| Note bar | `len × 39 − 3` wide, 14px tall, 3px radius, orange mixed toward a dark base by `volume` | mock |
| Ghost note | dashed 1px border in the other track's category colour, 12px tall | mock |
| Keyboard | matte warm grey white keys at real proportions (C, E, F, B short; D, G, A long), black keys 58% of the white key length, labels on C only and under the pointer | mock |
| Line weights | step 4.5%, beat 10%, bar 22% white; octave rule on C 16%; black-key rows banded 22% black | mock |
| Loop ruler | 24px, inside the scroller on the step pitch, with a sticky 340px spacer; keeps drag, Shift+click, double-click and the playhead; adds bar.beat labels | mock, `LoopRuler.tsx` |

### Layering

| z | Layer | Contents |
|---|---|---|
| 0 | Grid surface | Track rows, step cells, page dividers. The only layer that scrolls in both axes. |
| 1 | In-row lanes | Pitch contour marks, velocity lane rows. Rows of cells on the column grid. |
| 2 | Row state | Playing outline, remote-change flash, selection, and the **docked** outline on the row the dock is editing. |
| 3 | Sticky chrome, left | Control column and ruler spacer. |
| 5 | Sticky chrome, top | Loop ruler. |
| 6 | Editor dock | Sticky to the scroller's bottom edge; its control panel is sticky-left at z 7 inside it. |
| 8 | Transient, inside the dock | Ghost note under the pointer, hover crosshair, drag preview, tooltip chip. `pointer-events: none`. |
| 10 | Playheads | Ruler line, dock line, per-cell outline, all from the scheduler's position. |
| 100 | Global overlays | QR, shortcuts, the planned bottom sheet. Never the roll. |

Rules: only the dock's height changes layout; one horizontal scroller for ruler, rows and dock; the docked outline is state and uses the row edge in accent orange, never the category colour; transient layers never take pointer events (one hit layer computes step and pitch from coordinates).

## Interaction Design

Every row below is an existing gesture applied to a new noun. Nothing adds a gesture to the app.

| Gesture | On | Result | Vocabulary (AFFORDANCES.md) |
|---|---|---|---|
| Click | ♪ on a row, track name, dock tab | Dock shows that track | Chip row (N1) |
| Click / drag | Empty dock cell | Place a note / paint a run | Tap = act; drag-to-paint |
| Drag vertical | A bar | Re-pitch, auditioning each pitch | Drag-to-adjust; pointer capture allowed (C-11) |
| Drag right edge | A bar | Lengthen; writes `tie: true` on the added steps | Same |
| Click | A bar | Remove | Tap = act (matches the chromatic grid) |
| Shift+click / long-press | A bar or a cell | Step pane for that step | Universal disclose (N4) |
| Click | A key | Audition | Tap = act |
| Click | Ghost toggle | Show or hide that track's ghosts | Toggle |
| Escape | Focus inside the dock | Close | One meaning per key (C-8) |

### Scenarios

Durations reuse the app's own: 200ms ease-out is the `.panel-animation-container` transition; 150ms is the remote-change flash. Under `prefers-reduced-motion` every transition is a cut.

| Scenario | Moves | Stays | How you know |
|---|---|---|---|
| Open from a row | Dock grows 0 → height over 200ms; tracks above are pushed up only if the viewport cannot hold both | Every row, cell, the ruler, the column | Row gets the docked outline, its ♪ turns orange, its cells pulse once (150ms); dock title and tab carry the same name and category tick |
| Switch track | Notes crossfade over 120ms; the previous track's notes become ghosts; pitch scroll eases to the new notes | Dock height and position, the grid, all columns | Outline jumps rows; tab chip changes; no layout shift |
| Close (♪, Escape, ×) | Dock collapses over 200ms; track scroll position preserved | Everything else | Outline and orange toggle clear together; Escape only acts with focus inside the dock, so it does not fight copy mode |
| Playing | Three playheads from one clock: ruler, dock, per-cell outline; the sounding bar gets a white outline, no transform | Nothing scrolls on its own; there is no auto-scroll today and the dock adds none | Playheads align because they share the step pitch; a shorter docked track wraps where its row wraps |
| Draw | The bar follows the pointer; the row's cells update on the same frame | Dock, grid, keyboard | Dashed ghost bar before commit; cursor changes at a bar's right edge; under scale lock the ghost sits on the row it will snap to |
| Select a step | Dock switches to the Step pane; opens if closed | The grid; no strip between rows | Cell keeps the blue selection ring; the Step pane names step and track; the Notes grid highlights the column |
| Remote edit | The affected bar flashes in that player's colour for 150ms (`useRemoteChanges`) | Your dock, selection and drag; dock state is local | Flash appears in the dock and the row cell at once; cursor overlay stays on the grid |
| Reorder, delete, add | Rows move as today; deleting the docked track closes the dock; adding a track does not open it | Row width and drop geometry | The docked outline travels with its row |
| Published session | Dock opens and plays; keys audition | No ghost bar, drag cursors or Step edits | The dock takes the published scrim, which panels do not today |

### Two rolls at once

The question that separated this design from the shipped one. Opening Bass while Lead is docked switches the dock to Bass and keeps Lead as dashed ghost notes in the same grid, the way ghost notes work in Ableton, Logic and FL Studio. Both melodic rows show their contour marks. The alternatives (stacked lanes, per-track rolls fitted to their notes, per-track rolls as shipped, a modal) are ranked in [mocks/piano-roll-layout-options.html](./mocks/piano-roll-layout-options.html).

## UI Philosophy Alignment

| Principle | Score | Notes |
|---|---|---|
| Controls on target | ⚠️ | The editor is not under its row. Mitigated three ways: docked outline on the row, the same name and tick on the dock tab, the cells pulse on open. The row's own controls (mute, solo, toggle) stay on the row. |
| Immediate feedback | ✅ | Edits in the dock update the row's cells on the same frame; every pitch auditions. |
| Modes visible | ✅ | Which track is docked, which pane, which ghosts are on, and the loop region are all visible in the dock header and on the row. |
| Progressive disclosure | ✅ | Click acts, Shift+click discloses the Step pane, the Track pane holds the controls the row diet removed. |
| One screen | ✅ | The grid never disappears. The dock is a region of the one screen, not a view. |

## Constraints

| Constraint | What it means for the dock | Source |
|---|---|---|
| Column alignment | Dock step columns sit on the 39px pitch inside the same scroller as the rows; the dock's left panel, the ruler spacer and the control column are one width, 134px, so the keyboard and the names share a left edge | `TrackRow.css` (`.track-left`), `PianoRoll.css:39`, `VelocityLane.css:25`, `ChromaticGrid.css:40` |
| Row rhythm and tessellation | Nothing but rows of cells between rows; the dock takes space from the bottom of the scroller only | this spec; `AFFORDANCES.md` "column integrity" (PR #61) |
| Row width is load-bearing | The two-line block changes `.track-left` from 508 to 134px, which is the hazard lesson 62 records for drag-reorder during playback. The block therefore ships with a fix or a re-validation of the drag/auto-scroll interaction, and the three reorder specs run repeatedly against a real Worker before merge | `docs/LESSONS-LEARNED.md` lesson 62 |
| Every `.track-left` child has an explicit grid placement | The block is a two-column, two-row grid: grip spans both rows, name on the identity row, the control groups on the controls row; nothing is auto-placed | lesson 61 |
| Two column templates | Editable rows carry the instrument toggle; on the two-line block it takes the badge slot on the controls row, so both variants are the same width | `TrackRow.css:114-127` |
| One horizontal scroller | Desktop: `.tracks` scrolls all rows together. To pin the dock, `.tracks` (or a wrapper) also becomes the vertical scroller with a max height, which is what makes `position: sticky; bottom: 0` work. Below 768px each row's `.steps` scrolls on its own, so the dock aligns with the docked row only, by syncing the two scrollers | `StepSequencer.css:101-118`, `TrackRow.css:266, 1645` |
| Mobile portrait renders no rows | No dock in portrait | `StepSequencer.tsx:667` |
| Mobile landscape hides every panel container | The dock replaces them; today the TrackDrawer's pitch, velocity and pattern buttons change state but nothing opens | `TrackRow.css:1678-1681`, `TrackDrawer.tsx` |
| Published mode | `.published .track-row { pointer-events: none }` does not cover panels; the dock must take the scrim explicitly and honour `readOnly` | `StepSequencer.css:170`, `TrackRow.tsx:696` |
| Dock state is local | Which track, pane, ghosts, detent and scroll never sync; the 64KB message cap is untouched | `shared/constants.ts:18`, `sync/sync-classification.ts:88-95` |
| Every edit is an existing mutation | Toggle step, set parameter lock, set transpose. The MCP note surface in #92 should share them | `shared/state-mutations.ts` |
| Ghosts must be truthful | A ghost from a track of a different length repeats modulo that length, drawn lighter | `LOOP-RULER-LESSONS.md` §3.3 (PR #61) |

## Trade-offs

| Gives up | Buys | Exposed by |
|---|---|---|
| The roll is no longer under its track | Rows stay contiguous however many rolls are open | The two-rolls test |
| One track editable at a time | Two parts compared in one pitch space, one keyboard | Ghost notes |
| Step count and instrument one click deeper; transpose a readout, edited in the dock | A 134px column, a 116px keyboard on the names' edge, and about ten more visible steps at 1300px | Two-line block |
| Line-two controls are 18px tall on desktop | Row height unchanged at 44px; cells stay the dominant element | Two-line block |
| `.track-left` width changes | Nothing, if the drag/auto-scroll interaction is fixed first; a known fragility otherwise | Lesson 62 |
| Dock height taken from the viewport | No panel ever between rows | Layer rules |
| A new vertical scroller for `.tracks` | A dock that pins and a ruler that stays visible | Sticky positioning |

## What We Remove

- The per-track pitch panel and its Grid / Piano Roll tabs (`TrackRow.tsx:1167-1217`).
- The ParameterLockEditor strip between rows (`TrackRow.tsx:1220-1232`); the component's content moves into the Step pane.
- PatternToolsPanel, the always-on FM panel and the instrument picker's inline placement; their content moves into the Track pane.
- The legacy InlineDrawer and `mobile-edit-panel` (`TrackRow.css:27-34, 310-425`), which are unreachable now that portrait renders no rows.
- The transpose dropdown, step-count dropdown and pattern-tools toggle from `.track-left`, and the single-line, ten-column `.track-left` template itself.
- The full-width proportional LoopRuler outside the scroller; its behaviour moves into the scroller on the step pitch.

## Multiplayer Considerations

- Dock state is component or `focus`-slice state, never synced. The existing `focus { context, trackId, stepIndex }` slice (`types.ts:33-37`) has no UI dispatching it; "docked track" can be that slice.
- Remote edits to the docked track flash in the dock with the same `useRemoteChanges` hook the cells use.
- `CursorOverlay` keeps mapping percentages onto the grid container; it does not map into the dock.
- Published sessions open the dock read-only.

## Mobile

- **Portrait:** unchanged. No rows, no dock.
- **Landscape:** the same two-line block at the same 134px width. Line one is identical to desktop. Line two carries mute, solo and the pitch toggle at 28px tall, so the row is 48px instead of 44px and the targets match today's landscape M and S. Badge and lane toggle are hidden; their content is in the dock. Because the column width is the same on both devices, the ruler spacer, the dock toolbar and the 116px keyboard are the same element at the same size. The dock itself is a bottom dock at about 45% of the height with the Notes toolbar. It aligns with the docked row only (see Constraints). This is the first working pitch editor on mobile; the feature matrix in MOBILE-INTERFACE-SIMPLIFICATION.md already promises the chromatic grid in landscape.
- **Portrait:** PortraitGrid's row label becomes the same line-one identity element (tick, name), so the name component is one component on three surfaces.
- **Tablet:** desktop above 768 wide and 500 tall.

## Very Complex Pieces

- Sixteen tracks at 128 steps: the dock draws one track as bars, so it is cheaper than today's roll of up to 4,608 buttons. Tracks scroll under the pinned dock.
- Polymeter: the dock's grid is the docked track's length with the same page dividers; ghosts repeat modulo their own length.
- Many melodic tracks: ghosts default on for the two nearest melodic tracks, off beyond that, each a toggle.
- Any track length (#119) changes only where page dividers fall.
- Patterns and song mode (#121): the dock edits the current pattern and re-renders at a queued switch; the dock title carries the pattern name from day one.

## Layout Principles

The sequencer is a tessellation: identical tiles on one grid, and the eye reads meaning from where tiles sit. Robin Williams' four principles, applied as rules this spec can be checked against.

**Contrast.** Only two things are loud: the step cells and the dock. Cells are 36px squares in the accent; line-two controls are 18px and muted, so the content outweighs the chrome. The dock is the one elevated surface (shadow, lighter border). State is the only use of the accent on chrome: the docked row's outline, the active pitch toggle, the active chip. Category colour is confined to the 3px tick on the name, never to an edge or a fill, so class and state never compete.

**Repetition.** One control block anatomy on every row and on every device: identity line, controls line, with the groups in the same order. One width, 134px, for the control column, the ruler spacer, the dock toolbar's sticky part and the keyboard. One height scale: 18px lines inside 44px rows, 18px pitch rows in the dock, 36px cells on a 39px pitch. One chip component for track tabs, pane tabs and ghost toggles. One disclosure gesture, Shift+click or long-press, on cells, bars and the ruler.

**Alignment.** Two edges carry the whole layout. The left edge at x=0 of the column: grip, tick, name, keys, ruler spacer. The step edge at x=134+8: every cell column, the ruler's marks, the dock grid, the loop region, the playheads. Nothing sits between those edges except the control block. Vertical alignment follows from the row grid: line one of every row is on one baseline, line two on another, and the dock's 18px rows sit on their own regular grid.

**Proximity.** What belongs to a track sits inside its 134×44 tile, in two groups: identity (tick, name, transpose), then state and disclosure (mute, solo | badge, pitch toggle, lane). The 4px gap between the two line-two groups is the only gap wider than 2px inside the tile. What belongs to the docked track's editing session sits in the dock, and the row outline is the one thing that crosses the boundary. What belongs to a step sits in its column: the cell, the contour mark, the dock bar, the Step toolbar's highlight.

Consistency gains this buys across desktop and mobile:

| Today | With the two-line block |
|---|---|
| Three control-column templates (desktop ten columns, desktop with instrument toggle, landscape three columns) | One block, two sizes (18px lines on desktop, 28px controls line on landscape), one width |
| Landscape drawer, desktop expanders, mobile edit panel, p-lock strip: four disclosure models | The dock on desktop and landscape; portrait discloses nothing |
| Transpose as a dropdown on desktop and a stepper in drawers | A readout on line one everywhere; the stepper in the Track toolbar everywhere |
| Category colour painted by a row edge, a badge and the picker | The name tick, on PortraitGrid's labels, landscape rows and desktop rows alike |
| Keyboard 512px on desktop, none on mobile | 116px on both |

## Implementation Phases

Each phase is a shippable PR with its own baseline run.

1. **Spec and mocks.** This document and `specs/mocks/`; amend `AFFORDANCES.md` C-1 and C-4 (see Interactions with Roadmap Features). No code.
2. **Dock shell.** Move the existing ChromaticGrid and PianoRoll into a dock under the grid with track tabs, the docked outline, open and close animation, Escape. Make `.tracks` the vertical scroller. No visual redesign of the roll. This phase proves tessellation and alignment.
3. **Two-line control block.** Fix or fence the drag/auto-scroll interaction, replace the `.track-left` template with the two-row block in both variants and in landscape, move transpose to the line-one readout, run the reorder specs repeatedly, regenerate baselines.
4. **New roll rendering.** Bars, ties, velocity brightness, the proportioned keyboard filling the column, the dock toolbar, the ruler in the scroller, drag editing, two detents. The prototype is the reference.
5. **Ghost notes and pitch contour marks.**
6. **Step pane.** Absorb the ParameterLockEditor strip and PR #87's envelope editor.
7. **Track pane.** Absorb pattern tools, FM params, instrument, step count, actions.
8. **Landscape dock.** Delete the dead InlineDrawer path; make the TrackDrawer's buttons do something.

## Test Plan

- A new `e2e/piano-roll-dock.spec.ts`: open, switch, close, draw, select a step, ghost toggle, detents, published read-only. There is no piano roll e2e spec today.
- `scrollbar.spec.ts` (single scrollbar, columns aligned) and `pitch-contour-alignment.spec.ts` extend to the dock.
- `plock-editor.spec.ts` and `chromatic-grid.spec.ts` change home to the dock.
- `mobile-orientation.spec.ts` gains the landscape dock, including the inert-when-closed check. `landscape-alignment.spec.ts` asserts that the landscape column is 134px and that desktop and landscape rows place the name on the same left edge.
- `track-reorder.spec.ts` plus the unit case `state/grid.test.ts` ("reorder during playback") run repeatedly after phase 3.

## Visual Baseline Safety

`sequencer-grid`, `track-row-with-steps`, `desktop-wide` and the Holby populated set change in phases 2, 3 and 4. Run the manual `visual-baselines.yml` workflow once per phase and review the image diff by hand. The macOS Holby baselines have no regeneration workflow and are updated locally.

## Alternatives Considered

Six arrangements for shrinking the keyboard and five answers to "two rolls at once" are ranked, with mocks, in [mocks/piano-roll-layout-options.html](./mocks/piano-roll-layout-options.html). In short:

| Arrangement | Why not |
|---|---|
| Split controls left and right of the row | Keeps all ten controls visible with no width change, but the inline roll still splits rows while open. The fallback if the dock is rejected. |
| Responsive column that shrinks while a roll is open | Width changes on toggle, which is exactly lesson 62, and controls vanish while editing pitch. |
| Two-line header at 60px rows | Rows grow by a third across every track. The adopted block keeps two lines inside the existing 44px row instead. |
| Compact row with a per-track drawer | A row without cells between rows with cells; breaks the vertical scan. |
| Keyboard view replacing the grid | Other tracks vanish while editing, against the one-screen principle. |
| Per-track rolls fitted to their notes | Affordable multi-open, but the grid is still split once per roll. |

### Decided against

- **A modal or floating window.** Covers the grid, or floats with columns aligned to nothing, so the beat you edit has to be read from a ruler instead of from the kick below it. Two rolls become two windows to manage. Against UI-PHILOSOPHY anti-patterns 1 and 4.
- **Full-width ivory keys as shipped.** What made them read badly was the gloss, the wood body and a label on every key, not the width; the dock makes the width moot.
- **Opening the dock when a melodic track is added.** Decided: only on request.
- **Persisting the docked track.** Decided: no.

## Non-goals

- Polyphonic tracks, chords, or an arpeggiator.
- Changing the data model. Steps, parameter locks and transpose are untouched.
- Auto-scroll during playback.
- The mobile bottom-sheet primitive (Phase 38 / C-7). The dock is row-local disclosure, not a global sheet.

## Open Questions

- Whether the Track pane should also host the velocity default, or whether that stays a Notes pane control.
- Whether ghost defaults should be "the two nearest melodic tracks" or "all melodic tracks up to three".

## Interactions with Roadmap Features

- **PR #61 (AFFORDANCES, EVOLUTION-ROADMAP, PATTERN-MODE, mocks).** C-1 adopts "inline expansion below the row" as the one disclosure mechanism and C-4 proposes the row diet. This spec amends C-1: lanes that are rows of cells stay inline (N3); editors dock. It adopts C-4 as the two-line control block and ships it with the dock; C-4's "13 controls → 6 visible" becomes "ten columns → one 134px tile". The amendment should land in the same change as #61, or this spec should be merged referencing it; the two must not disagree.
- **PR #87 (envelope v2 authoring).** Merge first. Phase 6 moves its editor into the Step pane wholesale.
- **PRs #85 and #58 (grip and gear glyphs).** Compatible; the grip stays on the row, the gear moves to the Track pane.
- **Issue #92 (MCP pitched notes).** The dock is its UI counterpart; share the domain operation.
- **Issues #119 and #121.** Covered above; neither blocks the dock.
- **Issue #118 (step-count labels).** Settle the wording before the Track pane renders the control.
- **Branch `claude/keyboardia-take-five-8brx26`** (tracks run free): the dock's playhead wrap assumes it.

## References

- Ableton Live manual, Clip View and Editing MIDI notes
- Bitwig user guide, Arrange view and tracks; Inspector panel
- FL Studio manual, Channel Rack
- Reaper MIDI editor guide (inline and floating editor)
- Maschine software manual, basic concepts (Group view and Keyboard view)
- Hydrogen manual, Piano Roll Editor
- `docs/LESSONS-LEARNED.md` lessons 61 and 62
- `specs/LOOP-RULER-LESSONS.md` and `specs/AFFORDANCES.md` on the PR #61 branch
