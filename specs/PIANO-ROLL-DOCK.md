# Piano Roll Dock

> **Status:** Proposal
> **Created:** October 2026
> **Companions:** [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md), [CHROMATIC-GRID-REDESIGN.md](./CHROMATIC-GRID-REDESIGN.md), [MOBILE-INTERFACE-SIMPLIFICATION.md](./MOBILE-INTERFACE-SIMPLIFICATION.md), [research/PITCH-VISUALIZATION-RESEARCH.md](./research/PITCH-VISUALIZATION-RESEARCH.md), and on the roadmap branch (PR #61) `AFFORDANCES.md` and `LOOP-RULER-LESSONS.md`
> **Mocks:** [mocks/piano-roll-dock.html](./mocks/piano-roll-dock.html) (interactive exploration), [mocks/piano-roll-layout-options.html](./mocks/piano-roll-layout-options.html) (ranked arrangements and the two-rolls test), [mocks/piano-roll-dock-storyboard.html](./mocks/piano-roll-dock-storyboard.html) (layer stack, scenario storyboard, roadmap impact). This spec's agreed targets supersede conflicting geometry, styling and phase text in those source mocks; the mocks must be reconciled before serving as acceptance references.
> **Scope:** PR #127 remains spec and mocks only. The supplied design audit measured a separate implementation (commit `8e49032` against `origin/main`); its findings inform these requirements. This document neither claims that implementation exists in this PR nor that its measurements have been reproduced here.

## The Problem

The piano roll (Phase 31H) is a panel inserted between the track it edits and the next track. Three things follow from that placement, and none can be fixed by restyling it.

1. **The keyboard is the control column.** The roll's step columns must align with the step cells above, so its left edge is pinned to the right edge of `.track-left`. The keyboard is therefore 512px wide (`--track-left-width`, `app/src/index.css:189`), and it is drawn as ivory gradients on a wood body, which the rest of the app does not do.
2. **An open roll splits the grid.** Keyboardia's sea of cells works because every row sits on the same 39px step pitch and rows butt against each other, so the eye can scan a column to see which instruments hit a beat together. A 400px panel under one track breaks that scan. Two open rolls (Lead and Bass) push the drums two panels away.
3. **The notes ignore the data.** Each active step draws as one 36px block. A step whose lock carries `tie: true` looks like a new hit, and `volume` is not drawn at all, so a whisper and an accent are the same orange.

The roll also shares the track row's sprawl: a row can stack seven surfaces below it with no accordion (TrackDrawer, instrument picker, PatternToolsPanel, VelocityLane, the legacy InlineDrawer, the FM panel, the pitch panel, and the ParameterLockEditor strip), every one with its own `useState` in `TrackRow.tsx:163-171`.

## The Proposal

One **editor dock** under the sea of cells, inside the same horizontal scroller, pinned to the bottom of the viewport while the tracks scroll above it. It shows one track at a time, chosen by its name, a tab in the dock, or a melodic track's pitch toggle. Every track, including drums and other nonmelodic tracks, can open the Track and Step panes. Notes is disabled for nonmelodic tracks; selecting one while Notes is active switches to Track. All tracks have dock tabs, and step disclosure opens Step regardless of instrument type. Other melodic tracks appear as ghost notes. The dock's keyboard fills the same 134px column as the track names, so keys and names share one left edge and the dock grid starts where the step cells start. The dock's own controls sit in a toolbar under its header. Rows never gain or lose a panel between them.

The dock has three panes over one grid:

| Pane | Shows | Absorbs |
|---|---|---|
| Notes (melodic only) | Absolute MIDI grid, bars, ties, shared velocity colour, ghosts of other melodic tracks, ghost toggles, best-range bracket, insertion velocity | ChromaticGrid, PianoRoll |
| Step (all tracks) | The selected step's supported locks: pitch, volume, tie, envelope stages; highlights the step's column in the grid. Unsupported parameters are disabled using the existing instrument capability rules | ParameterLockEditor strip, the envelope editor from PR #87 |
| Track (all tracks) | Transpose, step count, instrument, pattern tools, copy / clear / delete, supported FM parameters | PatternToolsPanel, FM panel, instrument picker, the landscape TrackDrawer's contents |

The velocity lane stays inline as a property lane under its row, because it is a row of cells on the column grid and tessellates. Melodic cells gain a **pitch contour mark**, so the melody stays readable in the grid while the dock shows another track.

**The rule this encodes:** rows of cells stay inline; editors dock.

### Decisions already taken

- The dock opens only on request (melodic pitch toggle, any track name, any dock tab, Shift+click / long-press on a step). Adding any track does not open it. Drum-only sessions retain access to every Track action and supported Step lock.
- The dock has two height detents, compact (252px grid) and tall (432px grid), toggled from the dock header.
- Which track is docked is not persisted. The dock starts closed on load.
- The **row diet** ships with working Track controls, as a **two-line control block**. Line one is identity: category tick, name, transpose readout. Line two is state and disclosure: mute and solo, then badge, pitch toggle and lane toggle. The pitch toggle is disabled for nonmelodic tracks; the name still opens Track. Identity 17px + gap 2px + controls 17px = 36px, matching the cells. Desktop row height is 44px including 4px padding above and below; a 2px gap between rows gives a 46px row pitch. This is a target, not a claim that the existing row geometry is unchanged. Step count, instrument, pattern tools and actions are edited in the Track pane. See Constraints for what the width change costs.

## Visual Representation

Normative geometry; source mocks must use these same targets:

| Element | Value | Source |
|---|---|---|
| Step pitch | 36px cell + ordinary 3px gap = 39px within a page | `StepCell.css`, `TrackRow.css`; target |
| Page boundary | 11px from cell 16's right edge to cell 17's left edge: ordinary 3px + extra 8px page gap, repeated every 16 steps in rows, ruler, dock and lanes | shared column geometry |
| Control column | Grip 12px + body 110px + column gap 4px + horizontal padding 8px (4px each side) = 134px, border-box | agreed target |
| Desktop row | Identity 17px + line gap 2px + controls 17px = 36px; vertical padding 4px each side gives 44px; inter-row gap 2px gives 46px pitch | agreed target |
| Landscape row | Identity 17px + line gap 2px + controls 28px = 47px inside a 48px row; inter-row gap 2px gives 50px pitch; column remains 134px | agreed target |
| Line one (identity) | 17px high: 3px category tick · name · transpose readout, right-aligned, mono 10px | agreed target |
| Line two (desktop controls) | Five items, each 20×17px: M · S, then badge · ♪ · lane; gaps 2px within groups, 4px between groups. Width = 5×20 + 2 + 4 + 2 + 2 = 110px | agreed target |
| Dock left panel | 134px: 18px range rail · 116px keyboard, with borders included in the total | agreed target |
| Dock toolbar | Under the header, sticky-left, sized to the scrollport; fixed 48px for Notes, Step and Track, each a single horizontal line with overflow-x scrolling and no wrapping | agreed target |
| Dock controls | All dock chrome controls 28px high, radius 4px: track/pane/ghost chips, tool buttons, tie toggle, pattern buttons and dropdowns; both dropdowns use the existing dropdown variables for a 28px variant | agreed target |
| Dock grid row height | 18px | retained proposal |
| Dock grid height | 252px compact, 432px tall | decided |
| Pitch range | All 97 semitone rows, absolute MIDI 12..108 inclusive (C0..C8), high to low; vertical scrolling initially centres on the docked track's notes | agreed target |
| Note bar | 14px tall, 3px radius; width from shared start/end column edges including page gaps; shared accent-to-surface velocity formula below | agreed target |
| Ghost note | dashed 1px border in the other track's category colour, 12px tall | mock |
| Keyboard | matte warm grey white keys at real proportions (C, E, F, B short; D, G, A long), black keys 58% of the white key length, labels on C only and under the pointer | mock |
| Line weights | Named CSS tokens: step 4.5%, beat 10%, bar 22% white; octave rule on C 16%; black-key rows banded 22% black | token contract below |
| Loop ruler | 24px, inside the scroller on the shared column geometry, with a sticky 134px spacer and the common 8px gap before step 1; keeps drag, Shift+click, double-click and the playhead; adds bar.beat labels | agreed target, `LoopRuler.tsx` behaviour |

The common 8px gap after the 134px column places step 1 at x=142px relative to the scroller content. For zero-based step index `i`, every surface uses `x(i) = 142 + 39*i + 8*floor(i/16)`. A bar starting at `i` with length `len` ends at `x(i+len-1)+36`; its width is that endpoint minus `x(i)`. Hit testing, page dividers, loop bounds, ghost repeats and playheads must use the same mapping rather than uniform `i*39` arithmetic. Fractional row-top accumulation is forbidden.

### Pitch visibility and editing bounds

The grid is absolute pitch, not a filtered list of scale degrees or an instrument's recommended range. Each attack and ghost is drawn at `SCHEDULER_BASE_MIDI_NOTE + transpose + (pitchLock ?? 0)`; the scheduler base is MIDI 60. A tied continuation inherits its attack's effective pitch and volume, as playback does, so its cell contour and colour match the bar. Its ignored pitch/volume controls are disabled and explain the inheritance; turning Tie off makes them editable as a new attack. Stored continuation locks are preserved until explicitly edited or cleared. Transpose and pitch lock each allow -24..+24 semitones, so valid combined pitches span MIDI 12..108. Recommended instrument ranges may be shown by the range bracket, but must not trim rows or hide notes. Scale lock may dim out-of-scale rows and snap new placements; it must never remove rows or hide existing out-of-scale notes, ties or ghosts.

Placement, paint and vertical drag compute `pitchLock = targetMidi - SCHEDULER_BASE_MIDI_NOTE - transpose`. Only integer locks within `MIN_PLOCK_PITCH..MAX_PLOCK_PITCH` (-24..+24) may commit. Rows beyond the current track's writable interval remain visible; placement there is inert with a disabled preview, and an invalid drag leaves the original note unchanged. Validate the requested row before snapping; for a valid row, scale snapping chooses the nearest in-scale MIDI pitch within that writable interval (lower pitch on an exact tie), then validates the result before audition or mutation. It must never clamp a stored lock after previewing a different pitch or silently change transpose to reach a row. Track controls enforce `MIN_TRANSPOSE..MAX_TRANSPOSE` (-24..+24) independently. Step pitch edits use the same lock bounds; changing transpose preserves existing locks and redraws every resulting absolute note.

Drag previews are reversible: releasing on an invalid row or cancelling restores the original steps and locks, including when the pointer passed through valid rows first. An attempted invalid drag must never fall through to click-to-delete. Switching tracks or closing the dock cancels an unfinished drag. Refresh the Step controls after grid edits without replacing a slider during its input gesture; discrete toolbar edits preserve keyboard focus inside the dock. Disclosing a step on the already docked track preserves pitch scroll, and switching tracks clears the previous row's step selection.

### Shared colour, state and typography contract

Plan the named palette, key, grid and velocity tokens in `app/src/index.css`; this is a future implementation requirement, not an app edit in this PR. Every source mock must use identical CSS variable names, values and formulas when reconciled. Reuse the app's `--color-accent`, `--color-surface`, `--color-drums`, `--color-bass`, `--color-keys`, `--color-leads`, `--color-pads`, `--color-fx`, `--color-purple-dark` for the lock border, and `--font-mono`. Mocks copy the app's mono stack (`'SF Mono', 'Consolas', monospace`) rather than keeping a separate Menlo stack. Accent RGB/hex numbers and velocity colour arithmetic must never live in TypeScript or mock JavaScript; code supplies only normalized velocity and category token references.

Define the common tokens and formula in CSS:

```css
/* Planned in app/src/index.css; identical declarations in the mocks. */
--piano-key-white: #c9c5bc;
--piano-key-white-hover: #ddd9d0;
--piano-key-black: #131211;
--piano-key-black-hover: #2a2826;
--piano-key-label: #3f3c37;
--piano-key-surface: #0f0e0d;
--piano-grid-step: rgb(255 255 255 / 4.5%);
--piano-grid-beat: rgb(255 255 255 / 10%);
--piano-grid-bar: rgb(255 255 255 / 22%);
--piano-grid-octave: rgb(255 255 255 / 16%);
--piano-grid-black-row: rgb(0 0 0 / 22%);
--note-velocity-accent: var(--color-accent);
--note-velocity-surface: var(--color-surface);
--note-velocity: 1;
--note-velocity-fill: color-mix(in srgb,
  var(--note-velocity-accent) calc(var(--note-velocity) * 100%),
  var(--note-velocity-surface));
```

Evaluate `--note-velocity-fill` on each active cell and note bar, alongside its local `--note-velocity` override, so CSS inheritance cannot freeze the mix at the root's default. Both use `volumeLock ?? 1.0`, bounded to 0..1, as `--note-velocity` and the same opaque surface endpoint. Unlocked/default is 1.0, never the prototype's 0.8; an explicit 1.0 lock and no lock have identical fill. Here velocity means the normalized per-step volume multiplier, not a new MIDI velocity or track-volume policy. The insertion velocity control starts at 1.0; a lower chosen value writes an explicit volume lock for new notes without changing the unlocked default or existing steps.

Cells carry at most three persistent data signals: colour for velocity; a contour mark for pitch and tie on melodic cells; and a purple border for "has a lock" on any cell. Remove white volume fills/overlays and all per-cell pitch, tie and volume badges. Do not add a white wash or brightness gradient to bars that breaks cell/bar fill equality. Selection, playback and remote flashes remain transient state overlays, not duplicate data encodings.

The only docked-row indicator is a 2px accent left edge on the control block, inside its existing width; no full inset row outline, top/bottom control-block edges or cell-region border. Active chips and the active melodic ♪ retain accent state. Category colour stays on identity ticks and ghost borders. All displayed values use `--font-mono` (transpose, step count, pitch, velocity, envelope/FM values, ruler, keyboard and bar labels). Toolbar labels are 11px / weight 500 / 0.5px tracking / uppercase; line-two glyphs are 10px / 700; keyboard and bar labels are both 10px / 500. These styles apply across panes and devices.

### Layering

| z | Layer | Contents |
|---|---|---|
| 0 | Grid surface | Track rows, step cells, page dividers. The only layer that scrolls in both axes. |
| 1 | In-row lanes | Pitch contour marks, velocity lane rows. Rows of cells on the column grid. |
| 2 | Row state | Playing outline, remote-change flash and selection. The docked state contributes only a 2px accent left edge on the control block. |
| 3 | Sticky chrome, left | Control column and ruler spacer. |
| 5 | Sticky chrome, top | Loop ruler. |
| 6 | Editor dock | Sticky to the scroller's bottom edge; its control panel is sticky-left at z 7 inside it. |
| 8 | Transient, inside the dock | Ghost note under the pointer, hover crosshair, drag preview, tooltip chip. `pointer-events: none`. |
| 10 | Playheads | Ruler line, dock line, per-cell outline, all from the scheduler's position. |
| 100 | Global overlays | QR, shortcuts, the planned bottom sheet. Never the roll. |

Rules: only opening, closing or changing the dock detent changes its layout height; switching panes does not. One horizontal scroller serves ruler, rows and dock on desktop. Docked state uses only the control block's 2px accent left edge, never a full row outline or category colour. Transient layers never take pointer events; one hit layer computes step and absolute pitch from the shared coordinates and validates editing bounds.

## Interaction Design

Every row below is an existing gesture applied to a new noun. Nothing adds a gesture to the app.

| Gesture | On | Result | Vocabulary (AFFORDANCES.md) |
|---|---|---|---|
| Click | Melodic ♪ on a row; any track name or dock tab | ♪ opens Notes; name opens Track; a tab retains a supported pane, falling back from Notes to Track for a nonmelodic track | Chip row (N1) |
| Click / drag | Empty dock cell | Place a note / paint a run within the current track's valid pitch-lock interval; scale lock snaps without hiding rows | Tap = act; drag-to-paint |
| Drag vertical | A bar | Re-pitch and audition valid targets only; an invalid release preserves the original note | Drag-to-adjust; pointer capture allowed (C-11) |
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
| Open from a row | Dock grows 0 → height over 200ms; tracks above are pushed up only if the viewport cannot hold both | Every row, cell, the ruler, the column | Control block gains its 2px accent left edge; a melodic ♪ turns orange when Notes is active; cells pulse once (150ms); dock title and tab carry the same name and category tick |
| Switch track | Melodic notes crossfade over 120ms; the previous melodic track's notes become ghosts; pitch scroll eases to the new notes; selecting drums disables Notes and shows Track if needed | Dock height and position, shared grid geometry, all columns | Left-edge state moves to the new control block; tab chip changes; no layout shift |
| Switch pane | Only toolbar content changes; disabled Notes cannot be selected for a nonmelodic track | Toolbar 48px, dock height, detent, grid viewport, horizontal and pitch scroll positions | Active pane chip changes; no wrapping or vertical movement |
| Close (♪, Escape, ×) | Dock collapses over 200ms; track scroll position preserved | Everything else | Left-edge state and orange toggle clear together; Escape only acts with focus inside the dock, so it does not fight copy mode |
| Playing | Three playheads from one clock: ruler, dock, per-cell outline; the sounding bar gets a white outline, no transform | Nothing scrolls on its own; there is no auto-scroll today and the dock adds none | Playheads align because they share the step pitch; a shorter docked track wraps where its row wraps |
| Draw | The bar follows the pointer; the row's cells update on the same frame | Dock, grid, keyboard | Dashed ghost bar before commit; cursor changes at a bar's right edge; under scale lock the ghost sits on the row it will snap to |
| Select a step | Dock switches to the Step pane on any track, including drums; opens if closed | The grid; no strip between rows | Cell keeps the blue selection ring; the Step pane names step and track; the shared grid highlights the column |
| Remote edit | The affected bar flashes in that player's colour for 150ms (`useRemoteChanges`) | Your dock, selection and drag; dock state is local | Flash appears in the dock and the row cell at once; cursor overlay stays on the grid |
| Reorder, delete, add | Rows move as today; deleting the docked track closes the dock; adding a track does not open it | Row width and drop geometry | The control block's docked left edge travels with its row |
| Published session | Dock opens and plays; keys audition | No ghost bar, drag cursors or Step edits | The dock takes the published scrim, which panels do not today |

### Two rolls at once

The question that separated this design from the shipped one. Opening Bass while Lead is docked switches the dock to Bass and keeps Lead as dashed ghost notes in the same grid, the way ghost notes work in Ableton, Logic and FL Studio. Both melodic rows show their contour marks. The alternatives (stacked lanes, per-track rolls fitted to their notes, per-track rolls as shipped, a modal) are ranked in [mocks/piano-roll-layout-options.html](./mocks/piano-roll-layout-options.html).

## UI Philosophy Alignment

| Principle | Score | Notes |
|---|---|---|
| Controls on target | ⚠️ | The editor is not under its row. Mitigated three ways: docked left edge on the control block, the same name and tick on the dock tab, the cells pulse on open. The row's own controls (mute, solo, toggle) stay on the row. |
| Immediate feedback | ✅ | Edits in the dock update the row's cells on the same frame; every pitch auditions. |
| Modes visible | ✅ | Which track is docked, which pane, which ghosts are on, and the loop region are all visible in the dock header and on the row. |
| Progressive disclosure | ✅ | Click acts, Shift+click discloses the Step pane, the Track pane holds the controls the row diet removed. |
| One screen | ✅ | The grid never disappears. The dock is a region of the one screen, not a view. |

## Constraints

| Constraint | What it means for the dock | Source |
|---|---|---|
| Column alignment | Dock, rows, ruler and lanes use the shared `x(i)` mapping: 39px within pages, an extra 8px after each 16 steps. Dock left panel, ruler spacer and control column are 134px, followed by the same 8px gap | `TrackRow.css` (`.track-left`), `PianoRoll.css:39`, `VelocityLane.css:25`, `ChromaticGrid.css:40`; target geometry above |
| Row rhythm and tessellation | Nothing but rows of cells between rows; desktop 44px rows + 2px gap = 46px pitch, landscape 48px + 2px = 50px pitch. The dock takes space from the bottom only; reserve its full height so the last row remains reachable above it | this spec; `AFFORDANCES.md` "column integrity" (PR #61) |
| Row width is load-bearing | The two-line block changes `.track-left` from 508 to 134px, which is the hazard lesson 62 records for drag-reorder during playback. The block therefore ships with a fix or a re-validation of the drag/auto-scroll interaction, and the three reorder specs run repeatedly against a real Worker before merge | `docs/LESSONS-LEARNED.md` lesson 62 |
| Every `.track-left` child has an explicit grid placement | The block is a two-column, two-row grid: grip spans both rows, name on the identity row, the control groups on the controls row; nothing is auto-placed | lesson 61 |
| Two column templates | Editable rows carry the instrument toggle; on the two-line block it takes the badge slot on the controls row, so both variants are the same width | `TrackRow.css:114-127` |
| Track access is independent of pitch capability | All tracks have name/tab access to Track and step disclosure to Step. Notes alone is melodic-only; a drum-only session must not lose step count, instrument, transpose, pattern tools or actions when rows shrink | this spec |
| Absolute pitch coverage and mutation bounds | All MIDI 12..108 rows remain in the grid under scale lock. Pitch locks and transpose each stay within their existing -24..+24 bounds; valid visibility does not make every row writable at every transpose | `shared/constants.ts`, `audio/constants.ts`; pitch contract above |
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
| Line-two controls are 17px tall on desktop | Exact 36px identity/control stack matches the cells inside a target 44px row; 46px row pitch includes the gap | Two-line block |
| `.track-left` width changes | Nothing, if the drag/auto-scroll interaction is fixed first; a known fragility otherwise | Lesson 62 |
| Dock height taken from the viewport | No panel ever between rows | Layer rules |
| A new vertical scroller for `.tracks` | A dock that pins and a ruler that stays visible | Sticky positioning |

## What We Remove

Remove each original only in the phase that delivers its working replacement on that device. Until then, keep its entry point and editor reachable; a readout alone cannot replace a transpose control.

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
- **Landscape:** the same two-line block at 134px width. Identity 17px + gap 2px + controls 28px = 47px inside a 48px row; keep the spare 1px below the stack rather than centring on half pixels. Add 2px between rows for exactly 50px pitch. Line two carries mute, solo and the melodic pitch toggle at 28px tall; for drums the toggle is disabled, while name and step disclosure still open Track and Step. Badge and lane toggle are hidden only when their replacements are available in the dock, including velocity-lane access. The 134px spacer, 18px rail and 116px keyboard match desktop. The bottom dock takes about 45% of the height, with all three panes available by capability, a fixed 48px single-line scrolling toolbar and 28px / radius 4px controls. It aligns with the docked row through synchronized horizontal scroll, including page gaps (see Constraints). Reserve space for the whole dock and keep the final row scrollable above it. Landscape row/drawer/panel changes ship atomically with working replacements; the planned dock addresses the pitch-editor gap recorded in MOBILE-INTERFACE-SIMPLIFICATION.md.
- **Portrait:** PortraitGrid's row label becomes the same line-one identity element (tick, name), so the name component is one component on three surfaces.
- **Tablet:** desktop above 768 wide and 500 tall.

## Very Complex Pieces

- Sixteen tracks at 128 steps: the dock draws one track as bars, so it is cheaper than today's roll of up to 4,608 buttons. Tracks scroll under the pinned dock.
- Polymeter: the dock's grid is the docked track's length with the same page dividers; ghosts repeat modulo their own length and use destination column coordinates, including page gaps.
- Many melodic tracks: ghosts default on for the two nearest melodic tracks, off beyond that, each a toggle.
- Any track length (#119) changes only where page dividers fall.
- Patterns and song mode (#121): the dock edits the current pattern and re-renders at a queued switch; the dock title carries the pattern name from day one.

## Layout Principles

The sequencer is a tessellation: identical tiles on one grid, and the eye reads meaning from where tiles sit. Robin Williams' four principles, applied as rules this spec can be checked against.

**Contrast.** Only two things are loud: the step cells and the dock. Cells are 36px squares using the shared velocity fill; desktop line-two controls are 17px and muted, so the content outweighs the chrome. The dock is the one elevated surface (shadow, lighter border). State is the only use of the accent on chrome: the control block's 2px docked left edge, the active pitch toggle, the active chip. Category colour is confined to the 3px identity tick and ghost borders, never a row edge or chrome fill.

**Repetition.** One control block anatomy on every row and on every device: identity line, controls line, with groups in the same order. One width, 134px, for the control column, ruler spacer and dock left panel (rail plus keyboard). Desktop lines are 17px with a 2px gap inside 44px rows on a 46px row pitch; landscape uses a 28px controls line inside 48px rows on a 50px pitch. Dock pitch rows stay 18px; cells stay 36px on the shared horizontal geometry. All dock chrome controls are 28px high with radius 4px, and every pane's toolbar is 48px. One chip component serves track tabs, pane tabs and ghost toggles; typography and tokens repeat across surfaces. Shift+click or long-press discloses details on cells, bars and the ruler.

**Alignment.** Two edges carry the whole layout. The left edge at x=0 of the column: grip, tick, name, keys, ruler spacer. The step edge at x=134+8: every cell column, the ruler's marks, the dock grid, the loop region, the playheads. Nothing sits between those edges except the control block. Vertical alignment follows from the row grid: line one of every row is on one baseline, line two on another, and the dock's 18px rows sit on their own regular grid.

**Proximity.** What belongs to a track sits inside its 134×44 desktop tile (134×48 in landscape), in two groups: identity (tick, name, transpose), then state and disclosure (mute, solo | badge, pitch toggle, lane). The 4px gap between the two line-two groups separates them; each group's internal gaps are 2px. What belongs to the docked track's editing session sits in the dock, linked by the control block's 2px left edge. What belongs to a step sits in its column: the cell, contour mark, dock bar and Step highlight.

Consistency gains this buys across desktop and mobile:

| Today | With the two-line block |
|---|---|
| Three control-column templates (desktop ten columns, desktop with instrument toggle, landscape three columns) | One block, identity 17px everywhere, controls 17px desktop / 28px landscape, one width |
| Landscape drawer, desktop expanders, mobile edit panel, p-lock strip: four disclosure models | The dock on desktop and landscape; portrait discloses nothing |
| Transpose as a dropdown on desktop and a stepper in drawers | A readout on line one everywhere; the stepper in the Track toolbar everywhere |
| Category colour painted by a row edge, a badge and the picker | The name tick, on PortraitGrid's labels, landscape rows and desktop rows alike |
| Keyboard 512px on desktop, none on mobile | 116px on both |

## Implementation Phases

Each future implementation phase is a shippable PR with its own relevant tests and reviewed baselines. Replacement availability is a release gate: no intermediate PR may remove an entry point before its equivalent works. PR #127 covers phase 1 only; the phases below do not describe completed app work.

1. **Spec and mocks.** Reconcile `specs/mocks/` to this spec's exact geometry, CSS tokens, velocity formula, typography and state indicators. Treat the C-1 / C-4 roadmap amendment as a companion requirement (see Interactions with Roadmap Features). No app code.
2. **Desktop dock shell and access.** Move the existing desktop pitch editors into a dock with tabs for every track, capability-aware panes, the 2px control-block left edge, animation and Escape. Make `.tracks` the vertical scroller and reserve dock space. Track and Step may reuse the existing editor content; their original controls remain reachable until the later cutovers. Give every pane the fixed 48px toolbar and 28px / radius 4px chrome from the start. Opening Notes must preserve all valid absolute pitches and existing out-of-scale notes; fix visibility and bounds as part of the move rather than shipping a dock that hides them. Keep the original row template and landscape paths in this phase.
3. **Desktop Track pane and row diet, together.** Deliver working transpose, step count, instrument, pattern tools, copy / clear / delete, supported FM controls and lane disclosure for all tracks, including a drum-only session. Only then remove their desktop originals and adopt the 134px block in both editable/published variants, 17px lines, five 20×17px controls, 44px row and 46px pitch. Retain the editable transpose control until the Track replacement is usable; the identity readout alone is insufficient. Fix or revalidate drag/auto-scroll against a real Worker, run reorder checks repeatedly, and update all left spacers and column offsets in this same phase. Landscape stays on its old path until phase 7.
4. **Shared rendering and column geometry.** Deliver bars/ties, the proportioned keyboard, ruler in the scroller, validated draw/drag, two detents, and page spacing across rows, ruler, dock and lanes in one cutover. Introduce the planned `index.css` tokens and shared cell/bar velocity formula together: unlocked 1.0, no white volume fill or volume badge, equal fill at every velocity. Keep the full MIDI 12..108 grid and scale-lock visibility/bounds contract. Source mocks are references only after reconciliation to the normative targets above.
5. **Step pane cutover.** Complete the supported locks and PR #87 envelope editor for all track types; verify step selection, reset, edit and read-only behaviour. Remove the ParameterLockEditor strip only in the same PR that makes its replacement work on desktop. Preserve the landscape path until its atomic cutover.
6. **Ghosts and contour cutover.** Add truthful ghosts on absolute MIDI rows and pitch/tie contour marks on melodic cells. Remove pitch/tie badges when the contour replacement lands. The final cell budget is shared velocity colour, contour and purple has-lock border only; no new persistent signal may accompany the contour.
7. **Atomic landscape cutover.** In one PR, land the 134px column, 17+2+28px stack inside 48px rows on 50px pitch, working Track/Step for every track and Notes for melodic tracks, fixed toolbar/control geometry, lane access, shared page gaps and synchronized scrolling. Reserve dock space so rows clear it. Remove or replace TrackDrawer buttons, force-hidden panel containers and the dead InlineDrawer/mobile-edit-panel path only alongside these usable replacements. Check portrait remains unchanged and orientation transitions are safe.

## Test Plan

These are acceptance requirements for future implementation, not claims that tests or measurements have run in this spec-only PR. Use seeded sessions and assert resulting mutations, DOM rectangles and computed styles, as well as reviewed screenshots.

- **Access and replacement parity:** in a drum-only session, open Track by name/tab and Step by Shift+click/long-press. Notes is disabled and cannot become active by keyboard or pointer. Edit every supported lock, reset it, and use step count, instrument, transpose, pattern tools, copy, clear and delete. Switching melodic Notes to drums falls back to Track without closing or resizing the dock. For each cutover, verify the replacement before removing originals; transpose remains editable throughout. Published sessions permit supported navigation/audition but no mutations.
- **Pitch coverage and scale lock:** seed MIDI 12 and 108 with transpose/lock pairs (-24, -24) and (+24, +24), plus notes below 36 and above 84, existing out-of-scale notes and ties. Scroll to and assert every bar, keyboard row and ghost at its absolute pitch before/after scale lock and transpose changes. All 97 rows remain present; dimming and range brackets do not remove notes. Only initial open/track switch recentres pitch; playback does not auto-scroll.
- **Editing bounds:** at transpose -24, 0 and +24, exercise placement, painting, drag and Step pitch input at each valid boundary and one semitone beyond it. Assert stored locks stay -24..+24, invalid placement causes no activation/lock mutation, invalid drag preserves the original, and audition matches the committed pitch. Test scale snapping near both ends, including the tie rule; all snapped targets remain valid. Track transpose rejects/clamps attempts beyond its independent -24..+24 range through the existing mutation contract.
- **Velocity and signal equality:** seed unlocked notes and explicit volume locks 0, 0.3, 0.5, 0.8 and 1.0. Compare computed cell/bar background colours for every pair; unlocked equals 1.0 fill while a lock may still have its purple border. Check insertion velocity starts at 1.0 and a lower selection affects only new notes through locks. Assert there are no white volume overlays or per-cell pitch/tie/volume badges, and contour replacement leaves only the three specified data signals. Verify reconciled mocks use the same tokens/formula and that TypeScript/mock JavaScript contain no accent RGB numbers or colour ramps.
- **Geometry and pane stability:** measure 134px columns (12+110+4+8), 17px identity and desktop controls, 36px stack, five 20×17px items with the exact 2/4/2/2px gaps, 44px desktop rows and 46px top-to-top pitch. Switch Notes/Step/Track with short and overflowing content; toolbar stays 48px, every chrome control stays 28px / radius 4px, content stays on one horizontal scrolling line, and dock/grid bounds, detent and scroll positions do not shift. Check the docked indicator is only the control block's 2px left edge, inside its width. Assert values use `--font-mono` and the three required label/glyph styles.
- **Page/scroll alignment:** on 32-, 64- and 128-step tracks, measure 11px from cell 16's right to cell 17's left and at every later page boundary. Compare step edges in rows, ruler, dock and velocity lanes, including after horizontal scroll. Test a tied bar crossing a page, click hit testing, loop bounds, all playheads and repeated shorter-track ghosts against the shared coordinate mapping; no cumulative column drift or extra scrollbar on desktop.
- **Mobile and dock clearance:** landscape column 134px, identity 17px + gap 2px + controls 28px = 47px inside 48px rows, with 50px top-to-top pitch and integer row tops. Check name alignment with desktop, drum-only access, toolbar overflow, touch disclosure/draw, synchronized row/dock scrolling across page bands and orientation changes. The last row must be fully reachable above both dock detents; closed dock is inert and intercepts no input. Portrait still has no dock or track rows; tablet uses the documented desktop breakpoint.
- **Reorder and local state:** during real-Worker playback, reorder after the width change and verify correct drop position, auto-scroll and stable column alignment; deleting the docked track closes the dock without changing another track. Remote edits flash the corresponding cell/bar without replacing local track/pane/ghost/detent/scroll state. Escape acts only with dock focus; reduced motion removes transitions.

Extend or add `e2e/piano-roll-dock.spec.ts` for the access, editing, pane and style checks; extend `scrollbar.spec.ts`, `pitch-contour-alignment.spec.ts`, `mobile-orientation.spec.ts` and `landscape-alignment.spec.ts` for measured geometry. Move `plock-editor.spec.ts` and `chromatic-grid.spec.ts` coverage with their editor cutovers. Run `track-reorder.spec.ts` and the `state/grid.test.ts` case "reorder during playback" repeatedly after phase 3, and revalidate landscape reorder in phase 7.

## Visual Baseline Safety

`sequencer-grid`, `track-row-with-steps`, `desktop-wide` and the Holby populated set change with the shell, row diet, rendering and contour phases; landscape baselines change at phase 7. For each implementation phase that changes visuals, run the manual `visual-baselines.yml` workflow and review the image diff by hand against the numeric acceptance targets. The macOS Holby baselines have no regeneration workflow and are updated locally. Phase 1 validates the document and reconciled mocks; app baseline regeneration belongs to the later implementation PRs.

## Alternatives Considered

Six arrangements for shrinking the keyboard and five answers to "two rolls at once" are ranked, with exploratory mocks, in [mocks/piano-roll-layout-options.html](./mocks/piano-roll-layout-options.html). Their adopted-option dimensions defer to this spec:

| Arrangement | Why not |
|---|---|
| Split controls left and right of the row | Keeps all ten controls visible with no width change, but the inline roll still splits rows while open. The fallback if the dock is rejected. |
| Responsive column that shrinks while a roll is open | Width changes on toggle, which is exactly lesson 62, and controls vanish while editing pitch. |
| Two-line header at 60px rows | Taller than the adopted target: a 36px stack inside 44px desktop rows on 46px pitch. This does not assert that today's row geometry is already 44px. |
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

- "Two nearest melodic tracks" is the agreed ghost default count; the ordering used to determine nearest (row distance or another rule) still needs to be specified. This does not affect all-track access, pitch visibility or the numeric acceptance targets.

## Interactions with Roadmap Features

- **PR #61 (AFFORDANCES, EVOLUTION-ROADMAP, PATTERN-MODE, mocks).** C-1 adopts "inline expansion below the row" as the one disclosure mechanism and C-4 proposes the row diet. This spec amends C-1: lanes that are rows of cells stay inline (N3); editors dock. It adopts C-4 as the two-line control block and ships it with the dock; C-4's "13 controls → 6 visible" becomes "ten columns → one 134px tile". The amendment should land in the same change as #61, or this spec should be merged referencing it; the two must not disagree.
- **PR #87 (envelope v2 authoring).** Merge first. Phase 5 moves its editor into the Step pane wholesale, before removing the original strip on each device.
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
