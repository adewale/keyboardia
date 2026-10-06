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

One **editor dock** under the sea of cells, inside the same horizontal scroller, pinned to the bottom of the viewport while the tracks scroll above it. It shows one track at a time, chosen by that track's pitch toggle, its name, or a tab in the dock. Other melodic tracks appear as ghost notes. The control column becomes the dock's own control panel with a 96px keyboard against the grid. Rows never gain or lose a panel between them.

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
- The **row diet** ships with the dock: the control column keeps grip, name, mute, solo, badge, pitch toggle and lane toggle. Transpose shows as a small readout in the name slot and is edited in the Track pane, together with step count, instrument, pattern tools and actions. Column width becomes 340px. See Constraints for what that costs.

## Visual Representation

Geometry, taken from the prototype:

| Element | Value | Source |
|---|---|---|
| Step pitch | 36px cell + 3px gap = 39px | `StepCell.css`, `TrackRow.css` |
| Control column (after the diet) | `[drag] 20 [name] 100 [mute] 36 [solo] 36 [badge] 36 [pitch-view] 36 [velocity] 36` + 6 gaps × 4 + padding 16 = 340px | this spec |
| Dock left panel | 340px: pane · 18px range rail · 96px keyboard | mock |
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
| Column alignment | Dock step columns sit on the 39px pitch inside the same scroller as the rows; the dock's left panel is as wide as the control column | `TrackRow.css` (`.track-left`), `PianoRoll.css:39`, `VelocityLane.css:25`, `ChromaticGrid.css:40` |
| Row rhythm and tessellation | Nothing but rows of cells between rows; the dock takes space from the bottom of the scroller only | this spec; `AFFORDANCES.md` "column integrity" (PR #61) |
| Row width is load-bearing | The row diet changes `.track-left` from 508 to 340px, which is the hazard lesson 62 records for drag-reorder during playback. The diet therefore ships with a fix or a re-validation of the drag/auto-scroll interaction, and the three reorder specs run repeatedly against a real Worker before merge | `docs/LESSONS-LEARNED.md` lesson 62 |
| Every `.track-left` child has an explicit grid column | The diet template has seven named columns; nothing is auto-placed | lesson 61 |
| Two column templates | Editable rows carry the instrument toggle paid for out of name and badge slack; the diet needs both variants | `TrackRow.css:114-127` |
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
| Transpose and step count one click deeper | A 340px column and a 96px keyboard; a row that scans in one glance | Row diet |
| `.track-left` width changes | Nothing, if the drag/auto-scroll interaction is fixed first; a known fragility otherwise | Lesson 62 |
| Dock height taken from the viewport | No panel ever between rows | Layer rules |
| A new vertical scroller for `.tracks` | A dock that pins and a ruler that stays visible | Sticky positioning |

## What We Remove

- The per-track pitch panel and its Grid / Piano Roll tabs (`TrackRow.tsx:1167-1217`).
- The ParameterLockEditor strip between rows (`TrackRow.tsx:1220-1232`); the component's content moves into the Step pane.
- PatternToolsPanel, the always-on FM panel and the instrument picker's inline placement; their content moves into the Track pane.
- The legacy InlineDrawer and `mobile-edit-panel` (`TrackRow.css:27-34, 310-425`), which are unreachable now that portrait renders no rows.
- The transpose dropdown, step-count dropdown and pattern-tools toggle from `.track-left`.
- The full-width proportional LoopRuler outside the scroller; its behaviour moves into the scroller on the step pitch.

## Multiplayer Considerations

- Dock state is component or `focus`-slice state, never synced. The existing `focus { context, trackId, stepIndex }` slice (`types.ts:33-37`) has no UI dispatching it; "docked track" can be that slice.
- Remote edits to the docked track flash in the dock with the same `useRemoteChanges` hook the cells use.
- `CursorOverlay` keeps mapping percentages onto the grid container; it does not map into the dock.
- Published sessions open the dock read-only.

## Mobile

- **Portrait:** unchanged. No rows, no dock.
- **Landscape:** a bottom dock at about 45% of the height with a 56px keyboard and the Notes pane. 44px targets in the control panel, 36px cells as the landscape grid already uses. The dock aligns with the docked row only (see Constraints). This is the first working pitch editor on mobile; the feature matrix in MOBILE-INTERFACE-SIMPLIFICATION.md already promises the chromatic grid in landscape.
- **Tablet:** desktop above 768 wide and 500 tall.

## Very Complex Pieces

- Sixteen tracks at 128 steps: the dock draws one track as bars, so it is cheaper than today's roll of up to 4,608 buttons. Tracks scroll under the pinned dock.
- Polymeter: the dock's grid is the docked track's length with the same page dividers; ghosts repeat modulo their own length.
- Many melodic tracks: ghosts default on for the two nearest melodic tracks, off beyond that, each a toggle.
- Any track length (#119) changes only where page dividers fall.
- Patterns and song mode (#121): the dock edits the current pattern and re-renders at a queued switch; the dock title carries the pattern name from day one.

## Implementation Phases

Each phase is a shippable PR with its own baseline run.

1. **Spec and mocks.** This document and `specs/mocks/`; amend `AFFORDANCES.md` C-1 and C-4 (see Interactions with Roadmap Features). No code.
2. **Dock shell.** Move the existing ChromaticGrid and PianoRoll into a dock under the grid with track tabs, the docked outline, open and close animation, Escape. Make `.tracks` the vertical scroller. No visual redesign of the roll. This phase proves tessellation and alignment.
3. **Row diet.** Fix or fence the drag/auto-scroll interaction, change the `.track-left` template to the seven-column diet in both variants, move transpose to a readout, run the reorder specs repeatedly, regenerate baselines.
4. **New roll rendering.** Bars, ties, velocity brightness, the proportioned keyboard, the ruler in the scroller, drag editing, two detents. The prototype is the reference.
5. **Ghost notes and pitch contour marks.**
6. **Step pane.** Absorb the ParameterLockEditor strip and PR #87's envelope editor.
7. **Track pane.** Absorb pattern tools, FM params, instrument, step count, actions.
8. **Landscape dock.** Delete the dead InlineDrawer path; make the TrackDrawer's buttons do something.

## Test Plan

- A new `e2e/piano-roll-dock.spec.ts`: open, switch, close, draw, select a step, ghost toggle, detents, published read-only. There is no piano roll e2e spec today.
- `scrollbar.spec.ts` (single scrollbar, columns aligned) and `pitch-contour-alignment.spec.ts` extend to the dock.
- `plock-editor.spec.ts` and `chromatic-grid.spec.ts` change home to the dock.
- `mobile-orientation.spec.ts` gains the landscape dock, including the inert-when-closed check.
- `track-reorder.spec.ts` plus the unit case `state/grid.test.ts` ("reorder during playback") run repeatedly after phase 3.

## Visual Baseline Safety

`sequencer-grid`, `track-row-with-steps`, `desktop-wide` and the Holby populated set change in phases 2, 3 and 4. Run the manual `visual-baselines.yml` workflow once per phase and review the image diff by hand. The macOS Holby baselines have no regeneration workflow and are updated locally.

## Alternatives Considered

Six arrangements for shrinking the keyboard and five answers to "two rolls at once" are ranked, with mocks, in [mocks/piano-roll-layout-options.html](./mocks/piano-roll-layout-options.html). In short:

| Arrangement | Why not |
|---|---|
| Split controls left and right of the row | Keeps all ten controls visible with no width change, but the inline roll still splits rows while open. The fallback if the dock is rejected. |
| Responsive column that shrinks while a roll is open | Width changes on toggle, which is exactly lesson 62, and controls vanish while editing pitch. |
| Two-line header | Rows grow by a third across every track. |
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

- **PR #61 (AFFORDANCES, EVOLUTION-ROADMAP, PATTERN-MODE, mocks).** C-1 adopts "inline expansion below the row" as the one disclosure mechanism and C-4 proposes the row diet. This spec amends C-1: lanes that are rows of cells stay inline (N3); editors dock. It adopts C-4 and ships it with the dock. The amendment should land in the same change as #61, or this spec should be merged referencing it; the two must not disagree.
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
