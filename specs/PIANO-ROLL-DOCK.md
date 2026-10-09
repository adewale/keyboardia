# Piano Roll Dock

> **Status:** Proposal
> **Created:** October 2026
> **Companions:** [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md), [CHROMATIC-GRID-REDESIGN.md](./CHROMATIC-GRID-REDESIGN.md), [MOBILE-INTERFACE-SIMPLIFICATION.md](./MOBILE-INTERFACE-SIMPLIFICATION.md), [research/PITCH-VISUALIZATION-RESEARCH.md](./research/PITCH-VISUALIZATION-RESEARCH.md), and on the roadmap branch (PR #61) `AFFORDANCES.md` and `LOOP-RULER-LESSONS.md`
> **Mocks:** [mocks/piano-roll-dock.html](./mocks/piano-roll-dock.html) (interactive exploration), [mocks/piano-roll-layout-options.html](./mocks/piano-roll-layout-options.html) (ranked arrangements and the two-rolls test), [mocks/piano-roll-dock-storyboard.html](./mocks/piano-roll-dock-storyboard.html) (layer stack, scenario storyboard, roadmap impact). This spec's agreed targets supersede conflicting geometry, styling and phase text in those source mocks; the mocks must be reconciled before serving as acceptance references.
> **Scope:** PR #127 remains spec and mocks only. The supplied design audit measured a separate implementation (commit `8e49032` against `origin/main`); its findings inform these requirements. This document neither claims that implementation exists in this PR nor that its measurements have been reproduced here.
> **Proposal PR scope:** PR #127 aligns this specification, the local Markdown companion amendments and all three proposal mocks: `mocks/piano-roll-dock.html`, `mocks/piano-roll-layout-options.html` and `mocks/piano-roll-dock-storyboard.html`. Audit findings, saved prototype observations and current `app/src` supply distinct evidence; prototype behavior is not production integration or measurement. Production implementation and baseline regeneration remain future phases. This document is the source of truth for the aligned proposal and rollout acceptance.

## The Problem

The piano roll (Phase 31H) is a panel inserted between the track it edits and the next track. Three things follow from that placement, and none can be fixed by restyling it.

1. **The keyboard is the control column.** The roll's step columns must align with the step cells above, so its left edge is pinned to the right edge of `.track-left`. The keyboard is therefore 512px wide (`--track-left-width`, `app/src/index.css:189`), and it is drawn as ivory gradients on a wood body, which the rest of the app does not do.
2. **An open roll splits the grid.** Keyboardia's sea of cells works because every row sits on the same 39px step pitch and rows butt against each other, so the eye can scan a column to see which instruments hit a beat together. A 400px panel under one track breaks that scan. Two open rolls (Lead and Bass) push the drums two panels away.
3. **The notes ignore the data.** Each active step draws as one 36px block. A step whose lock carries `tie: true` looks like a new hit, and `volume` is not drawn at all, so a whisper and an accent are the same orange.

The roll also shares the track row's sprawl: a row can stack seven surfaces below it with no accordion (TrackDrawer, instrument picker, PatternToolsPanel, VelocityLane, the legacy InlineDrawer, the FM panel, the pitch panel, and the ParameterLockEditor strip), every one with its own `useState` in `TrackRow.tsx:163-171`.

## The Proposal

One **editor dock** under the sea of cells on desktop, inside the same horizontal scroller, pinned to the bottom of the viewport while the tracks scroll above it. Mobile landscape uses an expanded fixed sheet within the current sequencer, with an 8px viewport inset and no route change. It shows one track at a time, chosen by its name, a tab in the dock, or a melodic track's Notes ♪ control. Every track, including drums and other nonmelodic tracks, can open the Track and Step panes. Notes is disabled for nonmelodic tracks; selecting one while Notes is active switches to Track. All tracks have dock tabs, and step disclosure opens Step regardless of instrument type. Other melodic tracks appear as ghost notes. The desktop dock's left panel fills the same 154px column as the track names, so keys and names share one left edge and the dock grid starts where the step cells start. The dock's controls sit in a toolbar under its header; meaningful Step and Track details fill its body. Rows never gain or lose an editor between them. Copy/Paste, Clear and Delete remain on their target row outside the left column.

The dock has three panes over one grid:

| Pane | Shows | Absorbs |
|---|---|---|
| Notes (melodic only) | Absolute MIDI grid, bars, ties, shared velocity colour, comparison ghosts/toggles, best-range bracket, insertion velocity; native Loop start/end inputs and Clear loop in the Notes toolbar (32px desktop / 44px mobile) | ChromaticGrid, PianoRoll |
| Step (all tracks) | Persistent selected-step identity, supported locks (pitch, volume, tie, envelope stages), effective values and inheritance explanations, preview and explicit Clear lock; unsupported parameters remain visibly disabled by capability. A toolbar Step picker (32px desktop / 44px mobile) provides an alternative to tiny grid targets | ParameterLockEditor strip, the envelope editor from PR #87 |
| Track (all tracks) | Transpose, step count, instrument, pattern tools, supported FM parameters, lane disclosure, meaningful capability details and preview | PatternToolsPanel, FM panel, instrument picker, the landscape TrackDrawer's editor contents; Copy/Paste, Clear and Delete stay on the row |

The velocity lane stays inline as a property lane under its row, because it is a row of cells on the column grid and tessellates. Melodic cells gain a **pitch contour mark**, so the melody stays readable in the grid while the dock shows another track.

**The rule this encodes:** rows of cells stay inline; editors dock.

### Decisions already taken

- The dock opens only on request (melodic pitch toggle, any track name, any dock tab, Shift+click / long-press on a step). Adding any track does not open it. Drum-only sessions retain access to every Track action and supported Step lock.
- Desktop has two body-height detents, compact (252px body) and tall (432px body), toggled from the dock header. Header 84px + toolbar 48px + status 24px + external top border 1px makes total dock heights 409px compact and 589px tall; internal header/toolbar boundaries are included in their stated heights. Landscape has one expanded sheet whose body fills the remaining height.
- Which track is docked is not persisted. The dock starts closed on load.
- The **row diet** ships with working Track controls. Desktop has a **two-line control block**: category tick, name and transpose readout on the identity line; mute, solo, instrument audition badge, Notes ♪ and lane disclosure on the controls line. Identity 24px + gap 2px + controls 24px = 50px; 4px padding above and below gives a 58px row, with a 2px gap for 60px pitch. The 154px column contains grip 12px + gap 4px + body 130px + horizontal padding 8px. Landscape uses one horizontal 216px block: name 64px, M/S/Edit each 44px, three 4px gaps and 8px padding, inside a 48px row on 50px pitch. These are targets, not claims about existing geometry. Step count, instrument and pattern tools move to Track; row actions stay on the row. See Constraints for the width-change cost.

## Visual Representation

Normative geometry; source mocks must use these same targets:

| Element | Value | Source |
|---|---|---|
| Step pitch | 36px cell + ordinary 3px gap = 39px within a page | `StepCell.css`, `TrackRow.css`; target |
| Page boundary | 11px from cell 16's right edge to cell 17's left edge: ordinary 3px + extra 8px page gap, repeated every 16 steps in rows, ruler, dock and lanes | shared column geometry |
| Desktop control column | Grip 12px + gap 4px + body 130px + horizontal padding 8px (4px each side) = 154px, border-box | chosen contract |
| Desktop row | Identity 24px + gap 2px + controls 24px = 50px stack; vertical padding 4px each side gives 58px; inter-row gap 2px gives 60px pitch | chosen contract |
| Landscape control column / row | One horizontal line: name 64px + M 44px + S 44px + Edit 44px + three 4px gaps + padding 8px = 216px; controls 44px high + vertical padding 2px each side = 48px row; gap 2px gives 50px pitch | chosen contract |
| Desktop identity | 24px high: 3px category tick · name · transpose readout, right-aligned, mono 10px | chosen contract |
| Desktop controls | Five 24×24px items: M · S, then instrument audition badge · Notes ♪ · lane. Gaps 2/4/2/2px give 5×24 + 2 + 4 + 2 + 2 = 130px | chosen contract |
| Row actions | Copy/Paste, Clear, Delete outside the left column, on the same row; minimum 32×32px desktop and 44×44px landscape targets, visible and reachable when horizontally scrolled | chosen contract |
| Dock left panel | Desktop 154px = range rail 18px + keyboard 136px; landscape editor 84px = rail 18px + keys 66px, independent of the row's 216px column | chosen desktop alignment / refined landscape contract |
| Desktop dock header | 84px: top/bottom padding 8px + visible title/context row 32px + gap 4px + track/pane-chip row 32px; close/detent and overflow buttons 32×32px | chosen contract |
| Landscape dock header | 88px: two 44px rows with no vertical padding or gap; visible track, pattern and selected-step context with close on row one, track/pane tabs on row two | refined contract |
| Dock toolbar | 48px on both devices; landscape 44px controls + 4px total vertical padding, desktop 32px controls; same height for every pane, single horizontal line with overflow-x scrolling and no wrapping; overflow buttons 32px desktop / 44px landscape | refined contract |
| Dock chrome controls | Desktop 32px high / icon targets at least 32×32px; landscape at least 44×44px; radius 4px. Dropdowns use corresponding variants of existing variables. The Step picker is in the toolbar, 32px desktop / 44px mobile; desktop exceeds the 24px minimum target and remains operable at tiny-object zoom | chosen contract |
| Pitch row height | Shared dynamic `H = --pitch-row-height`, JS supplies 2..36px, default 18px; same geometry in keys, grid, bars, ghosts and hit testing on both devices | zoom contract below |
| Dock body | Desktop 252px compact / 432px tall across all panes; landscape fills remainder: `--dock-grid-h: calc(100dvh - 170px)`. At 568×320, inset 8px leaves 304px sheet − header 88px − toolbar 48px − status 16px − borders 2px = 150px body | refined contract |
| Desktop status / total height | Status 24px, one line with full accessible text + external top border 1px; 84 + 48 + 252 + 24 + 1 = 409px compact, 84 + 48 + 432 + 24 + 1 = 589px tall. Reserve total dock height for row clearance; include any external separation separately | reconciled source contract |
| Landscape status / borders | Status 16px contains bar.beat timeline labels at `92 + stepX(s) - body.scrollLeft`, text ≥4.5:1; cursor context uses a visually hidden live status and visible title updates. Sheet borders total 2px, outside body; no extra margin, padding or ruler may subtract from the 150px minimum | reconciled source contract |
| Pitch range | All 97 rows, absolute MIDI 12..108 inclusive (C0..C8), high to low, retained at every zoom; Fit on initial Notes display and track/ghost switches | chosen contract |
| Note bar | Height `h = max(1px, 14/18 × H)`, centred in the pitch row at `(H-h)/2`, radius `min(3px, h/2)`; constant high-contrast outline, including volume 0; width uses shared column edges/page gaps; orange-to-surface fill formula below | chosen contract |
| Ghost note | Height `h = max(1px, 12/18 × H)`, centred in the pitch row at `(H-h)/2`, radius `min(3px, h/2)`; constant dashed 1px category outline with sufficient contrast | chosen contract |
| Keyboard | Matte warm grey white keys at real proportions (C, E, F, B short; D, G, A long), black keys 58% of white-key length; vertical proportions derive from H even at 2px. White-key labels use `--piano-key-label`; range/scale decoration never dims label contrast or disables audition | retained proportions, shared zoom / contrast |
| Line weights | Named CSS tokens: step 4.5%, beat 10%, bar 22% white; octave rule on C 16%; black-key rows banded 22% black | token contract below |
| Loop ruler | Desktop 24px, inside the scroller with a sticky 154px spacer and common 8px gap before step 1; landscape row timeline uses left column 216px and editor timeline left column 84px, with 44px alternative endpoint controls; keeps drag, Shift+click, double-click and playhead; adds bar.beat/step labels and keyboard endpoints | `LoopRuler.tsx` behaviour plus accessibility contract |

The common 8px gap after the column places step 1 at desktop x=162px, landscape row x=224px and landscape editor x=92px relative to each scroller's content. For zero-based step index `i`, every surface uses `x(i) = L + 8 + stepX(i)` with `stepX(i) = 39*i + 8*floor(i/16)`: L=154px on desktop, 216px in landscape rows and 84px in the landscape dock. Desktop uses one shared horizontal scroller and physical column alignment. The expanded landscape dock has its own horizontal body scroller and a separate focus-editor timeline, preserving stepX/page mapping. The existing 16px status strip displays bar.beat labels at `92 + stepX(s) - body.scrollLeft`, updated on body scroll with no body-height cost. The title visibly updates to the keyboard cursor's track/step/pitch; full context is announced through an associated visually hidden live status. This supplies the separate timeline without another ruler or a route. Initial disclosure may reveal the selected step in the editor without altering the invoking row's scroll; later editor scrolling never changes row scroll. Returning restores the prior row scroll unchanged.

A bar starting at `i` with length `len` ends at `x(i+len-1)+36`; its width is that endpoint minus `x(i)`. Hit testing, page dividers, loop bounds, ghost repeats and playheads use the same mapping rather than uniform `i*39` arithmetic. Landscape cells are 36px wide × 44px high; desktop cells remain 36px squares centred inside the 58px row. Row tops use exact 60px / 50px pitch; pitch-grid positions are computed directly from H rather than accumulated rounded offsets. Row actions stay outside L and never shift step1. Desktop and landscape at width≥440 use sticky-right actions; reserve scroll-end padding at least the action group's measured width plus separation, so the final step can scroll fully clear of the overlay and remains clickable/keyboard-reachable. Use a muted opaque background/edge to distinguish the sticky action surface from cells passing behind it; that edge alone does not replace end-padding or prove final-cell access. In landscape at width<440, actions instead use static positioning at the far end of the same horizontal row after its steps, reachable by scrolling the row to its end. They must not cover name/M/S/Edit or wrap onto an extra line. Preserve left216, row48/pitch50 and all stepX/page arithmetic; neither action placement nor end-padding introduces height or changes musical coordinates.

### Shared pitch zoom and Fit

One CSS `--pitch-row-height` is the sole vertical geometry input. JS supplies H in the inclusive range 2..36px, default 18px; no independent mobile height, fixed 18px hit map or separately scaled keyboard. All 97 MIDI rows stay mounted/represented and scrollable. Manual zoom preserves the MIDI pitch at the body viewport's centre, with scroll clamped only at the absolute bounds. The body height and horizontal step pitch do not change with zoom.

**Fit comparison** measures the current usable Notes body height B and effective absolute pitch extrema of the active track's notes and all enabled ghosts, including ties/repeated ghosts. The chosen zoom budget `N = hi-lo+5` requests two semitone rows of padding at each end. Explicit and ghost-switch Fit choose fractional `H = min(36, max(2, B/(hi-lo+5)))`, without rounding. Clip the displayed padded extent to `[max(12, lo-2), min(108, hi+2)]`; retain the chosen zoom formula at the boundaries, but never add synthetic rows or gutters beyond MIDI12..108. Reveal that extent from its upper edge with scroll clamped to actual bounds; notes at MIDI12/108 must remain visible and reachable even when their outer padding is clipped. Manual zoom preserves centre. Automatic initial/track-switch Fit caps H at18. A track first opened in Track or Step keeps that initial Fit pending until its first Notes display; this one-time deferred Fit is an intentional exception to ordinary pane-switch scroll retention. Initial Step disclosure minimally reveals the selected effective pitch at the current H, without triggering Fit. Later pane changes retain the Notes mount, H and scroll.

Fit runs on initial Notes display, track/ghost switches, explicit Fit comparison, desktop detent changes and viewport resize. After resize/detent, wait for layout and measure the new body height before computing H; do not reuse the old B or an assumed compact height. Manual zoom persists until a defined Fit event. At the 2px minimum, keep all rows and allow scrolling if the extent cannot fit; empty active/comparison content defaults to H18 centred on absolute MIDI60, independent of track transpose. Playback does not recenter. The interactive dock mock demonstrates these Fit events, including deferred first-Notes Fit and resize refit.

At H<12px use overview rendering: hide bar labels and crowded key labels, retain constant high-contrast outlines for every bar and ghost, and keep effective pitch/volume/tie available via accessible names and the Step picker. Outline thickness does not scale with H or velocity. Musical targets may be tiny; the always-available toolbar Step picker (32px desktop / 44px mobile) and supported Step pitch controls provide equivalent selection, placement, re-pitch, toggle and erasure without requiring those targets. Keyboard proportions remain relative to H, not a stack of identical rectangular keys.

### Pitch visibility and editing bounds

The grid is absolute pitch, not a filtered list of scale degrees or an instrument's recommended range. Each attack and ghost is drawn at `SCHEDULER_BASE_MIDI_NOTE + transpose + (pitchLock ?? 0)`; the scheduler base is MIDI 60. A tied continuation inherits its attack's effective pitch and volume, as playback does, so its cell contour and colour match the bar. Its ignored pitch/volume controls are disabled and explain the inheritance; turning Tie off makes them editable as a new attack. Stored continuation locks are preserved until explicitly edited or cleared. Transpose and pitch lock each allow -24..+24 semitones, so valid combined pitches span MIDI 12..108. Recommended instrument ranges may be shown by the range bracket, but must not trim rows or hide notes. Scale lock may dim out-of-scale rows and snap new placements; it must never remove rows or hide existing out-of-scale notes, ties or ghosts.

Placement, paint and vertical drag compute `pitchLock = targetMidi - SCHEDULER_BASE_MIDI_NOTE - transpose`. Only integer locks within `MIN_PLOCK_PITCH..MAX_PLOCK_PITCH` (-24..+24) may commit. Rows beyond the current track's writable interval remain visible; placement there is inert with a disabled preview, and an invalid drag leaves the original note unchanged. Validate the requested row before snapping; for a valid row, scale snapping chooses the nearest in-scale MIDI pitch within that writable interval (lower pitch on an exact tie), then validates the result before audition or mutation. It must never clamp a stored lock after previewing a different pitch or silently change transpose to reach a row. Track controls enforce `MIN_TRANSPOSE..MAX_TRANSPOSE` (-24..+24) independently. Step pitch edits use the same lock bounds; changing transpose preserves existing locks and redraws every resulting absolute note.

Drag previews are reversible: any invalid target or collision encountered during paint, re-pitch or resize invalidates the entire gesture until pointer-up. Returning to a valid target does not recover that gesture: restore its original steps and locks, discard all previews and require a fresh gesture. Cancellation also restores the snapshot. An attempted invalid drag must never fall through to click-to-delete. Switching panes or tracks, closing the dock, pointer cancellation or changing Pan/Draw cancels an unfinished gesture before changing context. Refresh Step controls without replacing a slider during input; discrete toolbar edits preserve focus. Step disclosure retains H and existing scroll when the selected pitch is already visible; otherwise it minimally scrolls to reveal that pitch without Fit or wholesale recentering. Selected-step identity and blue selection/column highlight persist in Notes/Track; switching tracks clears the previous row's step selection. Keyboard cursor movement updates visible title/live context without silently replacing the disclosed Step selection.

### Mutation, collision and onset policy

Ordinary row/bar activation toggles, Step Activate/Deactivate and grid Enter on an addressed existing bar change only `steps`; they preserve the stored parameter lock, matching `toggle_step`. Enter on an empty valid destination is explicit placement, subject to the placement and collision rules. Pitch, volume, tie and envelope edits merge only the requested fields into the existing lock: `set_parameter_lock` replaces the whole object, so callers must preserve unrelated fields explicitly. Explicit placement/paint creates a new attack with `tie: false`, deliberately replaces the stored pitch (including pitch0), and preserves stored volume and envelope fields. It must neither resurrect a stale pitch nor inherit a dormant `tie: true`. Insertion velocity supplies the default only when no stored volume exists; ordinary reactivation and tie extension retain their lock-preserving semantics. Explicit **Clear lock** sets the selected lock to null, leaving activation unchanged. Explicit **Erase note** / Delete uses the existing selected-step erase semantics (`batch_clear_steps`): deactivate only the addressed steps and clear only their locks. Dock Delete prioritizes an existing range selection over the cursor/bar; without a range it erases only the addressed note. Row Clear likewise keeps its existing explicit whole-pattern clear semantics. These explicit erasures must not be used for ordinary toggling or drag rollback.

Tracks remain monophonic. Painting or placement rejects an occupied destination step, including another pitch or another note's tie chain; an empty pitch row at that step is not a free polyphonic slot. Retain the destination and restore the whole rejected paint gesture, with a visible collision explanation. Enter at an existing addressed bar toggles that bar; Enter at a different empty pitch on its occupied step rejects placement rather than erasing or overwriting the other bar. Tie extension may merge `tie: true` into free continuation steps while preserving their other stored fields, but rejects before another attack or foreign tie chain. Retraction releases only continuations created by that extension and restores their prior activation and Tie field while leaving unrelated dormant fields unchanged. Invalid/colliding resize or re-pitch restores the entire gesture snapshot; no partially committed preview and no overwritten destination. Live previews must be isolated from authoritative state until validated commit; cancellation must not overwrite a remote edit received during the gesture. A conflicting remote edit cancels the local gesture and retains authoritative state.

The same occupied-step rejection applies to pointer click and keyboard placement, not just painting. Tie continuations retain dormant pitch, volume and envelope fields byte-for-byte while inheriting effective pitch/volume from the attack; extension must not copy attack values over those fields. Changing the attack or toggling Tie must not erase dormant fields. Turning Tie off reveals their stored values; only an explicit field edit, Clear lock or Erase may change them. Retraction in a later gesture after a committed extension must also restore each introduced continuation's prior activation and exact Tie field, including absent versus explicitly false/true; it must not simply force Tie false or replace the whole lock object. The prototype retains these origins in a local Map. Production mutation/history handling must retain equivalent extension origins across commits, merge the Tie restoration without overwriting other fields, and reject restoration after a conflicting authoritative edit. A fresh gesture snapshot alone is insufficient to reconstruct pre-extension Tie values.

A no-movement click anywhere on a bar, including its right edge, performs the ordinary lock-preserving off toggle. Resize starts only after crossing the drag threshold; a completed/cancelled resize never falls through to click-off, even when the pointer returns to the original length. Clicking the right edge without movement must not manufacture a resize, a tie edit or an explicit erasure.

**Onset movement:** bar-body drag is vertical re-pitch only in this proposal; it never changes start step. Horizontal onset changes remain through existing range operations (selection cut/copy/paste, rotate and move where supported), whose overwrite/move semantics remain explicit and unchanged. Horizontal bar-body onset drag is excluded. Use a vertical-adjust cursor and a right-edge length-resize cursor only; no generic grab or left/right movement affordance promising onset dragging.

### Pane body and persistent context

Desktop header row one always visibly names the docked track, current pattern and selected step (or “No step selected”); row two contains track and pane chips. Landscape uses the same context in its first 44px header row and its second 44px tabs row. Identity cannot be hidden in an unused DOM element or disappear when Notes is active. The Notes ♪ control has `aria-pressed=true` and accent only when that track is docked in Notes. Clicking it from Step or Track switches to Notes; clicking the active Notes control closes the dock. Nonmelodic Notes is visibly disabled; Track and Step remain available. Solo has a visible yellow active state using `--color-yellow` / `--color-yellow-muted`, with `aria-pressed` reflecting actual state.

Selected-step context visibly includes effective pitch and volume. Active ties use their attack's inherited values; inactive steps use stored pitch/volume when present, otherwise pitch0/volume1, with absolute pitch `MIDI60 + transpose + storedPitch`. Do not omit pitch merely because activation is off. Cursor updates retain visible step/pitch context and the associated live announcement includes activation, effective pitch, volume and tie/inheritance state; a cursor's requested pitch must be distinguishable from an occupied note's effective pitch.

All panes use the same body-height budget, including drum Step. Track shows instrument/category, transpose and length, supported pattern/FM details, preview and disabled explanations for unsupported capabilities. Step has the toolbar picker (32px desktop / 44px mobile) and shows activation, effective pitch/volume/tie, stored versus inherited values, supported envelope controls, preview and Clear lock; drums show their supported details rather than an empty pitch grid. If no step is selected, the picker and an explanatory selection prompt remain usable. Keep the Notes grid mount and its scroll/zoom state retained when hidden; only panes not showing notes hide that grid from visual display, focus and the accessibility tree. Details occupy the same body region with internal scrolling, not an empty retained grid or toolbar-only content. Pane switching does not remount the grid, resize the body or recenter pitch.

Step exposes separate **Activate** / **Deactivate** and **Erase note** controls at 32px desktop / 44px mobile. Activation changes only the selected step's activation and preserves all stored locks; Erase explicitly clears its activation and locks. These controls provide the same operations for drums and tiny overview targets, with read-only mutation gates and clear accessible names.

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

The contour uses fixed relative effective pitch-lock bounds -24..+24, with 0 at the same midline in every row. For contour height C and inner padding P, `y = P + (24 - effectivePitchLock) / 48 * (C - 2*P)`. Tied continuations use their attack's effective lock; changing the pattern's min/max never rescales existing marks. Transpose changes absolute note position in the dock but does not remap the row's relative contour. No white velocity encoding accompanies it.

Recommended-range and scale cues use the range bracket and grid decoration; they do not apply opacity to key labels or key controls. White-key labels retain `--piano-key-label`, black-key labels keep an appropriate light contrast foreground, and every key remains auditionable regardless of recommendation/scale. Muting a track must not reduce opacity on its row controls, names or informative values; scope muted decoration to musical content without violating the text contrast targets.

The only docked-row indicator is a 2px accent left edge on the control block, inside its existing width; no full inset row outline, top/bottom control-block edges or cell-region border. Active chips and the active melodic ♪ retain accent state; solo is the yellow-state exception. Category colour stays on identity ticks and ghost borders. All displayed values use `--font-mono` (transpose, step count, pitch, velocity, envelope/FM values, ruler, keyboard and bar labels). Toolbar labels are 11px / weight 500 / 0.5px tracking / uppercase; desktop line-two glyphs are 10px / 700; keyboard and bar labels are both 10px / 500 when visible. These styles apply across panes and devices.

Note labels use contrast foregrounds: dark on bright velocity fill, white on dark fill, with at least 4.5:1 contrast against the actual composited fill. Plan shared CSS tokens `--note-label-dark`, `--note-label-light`, `--note-presence-outline` and `--color-focus: var(--color-blue)`; foreground selection may follow measured fill luminance but must not change the orange-to-surface formula or duplicate colour arithmetic in JS. A constant outline at least 3:1 against adjacent surfaces establishes bar presence even at explicit volume 0, independently of selection/playback and H. Ghost boundaries, informative control/key boundaries and focus indicators also meet 3:1; decorative beat/grid rules may retain the existing subtle tokens. Informative labels, status, values, inherited/disabled explanations and muted text meet 4.5:1 against their composited surface, using `--color-text-muted` or a verified stronger token. `--color-text-dimmed` is decorative only and cannot carry essential text. Focus and selection use blue tokens; orange remains the active editing state and velocity endpoint. Verify actual computed/composited colours, including label foreground on unlocked/full-volume bright bars, rather than assuming one white foreground works everywhere.

### Layering

| z | Layer | Contents |
|---|---|---|
| 0 | Grid surface | Track rows, step cells, page dividers; Notes body scrolls in both axes, details bodies vertically. |
| 1 | In-row lanes | Pitch contour marks, velocity lane rows. Rows of cells on the column grid. |
| 2 | Row state | Playing outline, remote-change flash and selection. The docked state contributes only a 2px accent left edge on the control block. |
| 3 | Sticky chrome, left | Control column and ruler spacer. |
| 5 | Sticky chrome, top | Loop ruler. |
| 6 | Editor dock | Desktop sticky to the scroller's bottom edge; landscape fixed inset 8px within the current sequencer. Its key panel is sticky-left at z 7 inside its body. |
| 8 | Transient, inside the dock | Ghost note under the pointer, hover crosshair, drag preview, tooltip chip. `pointer-events: none`. |
| 10 | Playheads | Ruler line, dock line, per-cell outline, all from the scheduler's position. |
| 100 | Global overlays | QR, shortcuts and global sheets; the landscape editor remains within the sequencer's stacking context. |

Rules: only opening, closing, orientation/viewport changes or changing the desktop detent changes dock height; switching panes does not. One horizontal scroller serves ruler, rows and dock on desktop. The landscape editor body has its own horizontal scroller and timeline using the same stepX/page mapping and an 84px key column. Docked state uses only the control block's 2px accent left edge, never a full row outline or category colour. Transient layers never take pointer events; one hit layer computes step and absolute pitch from shared stepX and H, adjusted for the current scroller origin, and validates editing bounds.

## Interaction Design

Retain the app's existing action/disclosure/selection vocabulary, with the explicit keyboard and Pan/Draw contracts below. Name click changes purpose; its audition replacement must ship at the same time.

| Gesture | On | Result | Vocabulary (AFFORDANCES.md) |
|---|---|---|---|
| Click / keyboard activate | Melodic Notes ♪, landscape Edit, any track name or dock tab | ♪ opens/switches to Notes, closing only when already active in Notes; name opens Track after 200ms pointer-click delay, Enter/Space opens immediately; Edit opens Track; tab retains a supported pane, falling back from Notes to Track for nonmelodic tracks | Chip row (N1) |
| Double-click | Track name | Cancel pending 200ms opener and rename inline; autofocus/select all, Enter/blur saves a valid name, Escape cancels; no audition or delayed dock open | Existing rename |
| Click / Enter / Space | Instrument audition badge | Immediately preview the instrument on every track, including drums, using current transpose and existing preview pipeline; no rename delay and no dock navigation | Tap = act |
| Click / drag in Draw | Empty dock cell | Place a note / paint a run within valid pitch-lock bounds; scale lock snaps without hiding rows; collisions preserve destination | Tap = act; drag-to-paint |
| Drag vertical | A bar | Re-pitch and audition valid targets only; an invalid release preserves the original note | Drag-to-adjust; pointer capture allowed (C-11) |
| Drag right edge | A bar | Lengthen; writes `tie: true` on the added steps | Same |
| Click / Enter | An addressed existing bar or Step activation control | Toggle activation only; stored locks survive. Enter on an empty cell follows explicit attack-placement rules | Existing toggle / placement |
| Delete / explicit Erase note | Focused note or range selection | Dock Delete prioritizes an existing range, otherwise the addressed note; only addressed activation and locks clear | Explicit erase |
| Ctrl/Cmd+click | A bar or cell | Toggle membership in existing step selection; no paint or audition | Existing multi-selection |
| Shift+click | A bar or cell | Extend from anchor when a range selection exists; otherwise disclose Step without mutation | Existing selection / disclose (N4) |
| Long-press / Shift+Enter | A bar or cell | Disclose Step; suppress subsequent toggle/paint/delete/click | Universal disclose (N4) |
| Click | A key | Audition | Tap = act |
| Click | Ghost toggle | Show or hide that track's ghosts | Toggle |
| Pan toggle / Draw toggle | Landscape toolbar | Explicit mutually exclusive modes with `aria-pressed`; Pan uses native body scroll, Draw edits through the hit layer | Visible modes |
| Escape | Sequencer interaction scope | Cancel active drag first, then copy mode, then close dock if focus is inside; one action per keypress | Priority contract below |

### Row access, copy and compatibility

`TrackNameEditor.tsx` currently delays single-click audition by 200ms and cancels it for inline rename. Replace that delayed callback with Track opening, keeping double-click cancellation, 32-character name validation and editing focus behaviour. Cancel pending openers on rename, unmount, track deletion or orientation exit so stale callbacks cannot open a different context. Instrument audition badge replaces the name's preview action directly for **all** tracks using `TrackRow.tsx`'s existing instrument/transpose-aware preview path and sustained-instrument duration handling. The badge does not open an instrument picker; instrument changes are in Track. Landscape Track includes a 44px audition control because its 216px row has only name/M/S/Edit. Update accessible labels/tooltips to distinguish “Open Track” from “Audition instrument”. Read-only/published mode allows supported navigation and audition while preventing rename and mutations.

Copy/Paste, Clear and Delete stay on the actual target row outside the 154px/216px left column: sticky-right on desktop and landscape width≥440, static at the horizontally scrollable row's far end in landscape width<440. Copy enters the existing source→destination flow: source row visibly says “Copy source” and its control indicates active copy; each eligible destination row shows “Paste here” and a destination indicator. Copy is visibly disabled for an empty source and cannot enter copy mode through pointer or keyboard activation. Copy does not select another dock track or navigate. Paste is destination-row activation, uses `COPY_SEQUENCE`/`copy_sequence` semantics (steps, all locks and step count; destination instrument/identity/transpose retained), then clears copy mode. Existing deliberate destination-pattern replacement remains explicit; the grid collision rule must not silently change row paste semantics. Preserve eligibility, empty-source restrictions, same-source prevention, clear/delete rules and selected-range clipboard operations. Source deletion cancels copy. Clear/Delete are real mutations, not explanatory or cosmetic buttons; omit/disable them by the same read-only rules as today and do not relocate them to Track.

One keyboard arbiter consumes Escape once: **active drag > copy mode > dock**. Drag cancellation restores the gesture without closing the dock or clearing copy; next Escape cancels copy without closing the dock; next Escape with focus inside closes, even when a range selection exists. Range-selection Escape handling applies only outside the dock; it must not intercept dock closure or clear the range as a side effect. Preserve existing help/selection handling outside that scope without a second listener also acting. Inline rename inputs and open menus consume their own Escape first. Close by × or active ♪ restores the exact invoking control with `preventScroll` and restores row horizontal/vertical scroll; deleting that track uses a deterministic surviving row/transport fallback. A closed dock is inert and has no focusable or pointer-intercepting content.

Retain scheduler/playhead timing, effective tie pitch/volume, instrument/envelope capability rules, local mute/solo, published/read-only gates, selection modifiers, range operations, loop gestures, pattern/queued switches, remote attribution, sync message limits and current mutation payloads. Dock/zoom/pan state is local UI state. A prototype does not justify replacing these with mock-only mutations or changing existing copy, read-only or playback semantics.

### Keyboard and touch access

Cursor-reveal calculations use the unobscured grid viewport: exclude the sticky keyboard column (84px in the landscape dock, 154px on desktop) and its adjoining gap. Home must reveal step1 to the right of the keyboard, not behind it; End must reveal the final step within the remaining visible width. Keep row scroll unchanged when revealing either endpoint in the landscape editor.

The Notes timeline is a named, focusable keyboard `role="group"` with one tab stop and a roving logical step/pitch cursor, visibly marked and announced through an associated status region. Do not claim ARIA grid/cell semantics unless real accessible cells and their indices are implemented. Left/Right move step, Up/Down move one semitone among all 97 rows, revealing focus without recentering the whole extent. Home/End reach timeline endpoints and horizontally reveal the cursor, including across page gaps and at the final step. Status announces track, step, note/MIDI, activation and effective lock/tie state. Enter performs lock-preserving toggle/valid placement; Shift+Enter discloses Step; Delete explicitly erases the addressed bar or existing range selection, never a track. Consume Delete locally even when no addressed note exists, editing is read-only or the operation is rejected; it must not bubble to row/track deletion or another global handler. An empty cursor pitch on an occupied step does not address the other-pitch bar for erasure. Space auditions current pitch and consumes the key without also toggling transport. Resolve Ctrl/Cmd membership selection and Shift range extension before toggle, placement, audition or drag initiation on bars and cells, including continuation cells. Shift extends an existing range; without one it discloses Step. Inputs/sliders retain their keys and global transport/help shortcuts retain their existing context. Keyboard keys are focusable and auditionable with Enter/Space, with note names even when visual labels hide. The toolbar Step picker and named controls remain an operable alternative at overview zoom: 32px desktop / 44px mobile, without adding a desktop body selector.

The loop ruler is a focusable `role="group"`, not a false slider whose value only reports region length. Its label names current loop start/end (step and bar.beat), or “Full pattern”, and the keyboard instructions. Left/Right adjusts start; Shift+Left/Right adjusts end; Delete/Backspace clears only the loop. Preserve pointer drag, Shift+click/double-click reset and existing bounds/minimum length. Equivalent **Loop start**, **Loop end** native number inputs and **Clear loop** live in the **Notes toolbar**, 32px desktop / 44px mobile. They reflect the same loop state and mutations, with current labels, validation and Clear disabled for full-pattern playback. Toolbar overflow keeps them reachable without body-height cost. The interactive dock mock supplies this touch alternative; no Track-details controls or independent sliders are required.

The explicit **Pan** toggle uses `aria-pressed`: on means body/hit surface `touch-action: auto`, native horizontal/vertical scroll with no editing capture; off means Draw with `touch-action: none` on the editing hit surface and single-pointer paint/re-pitch/resize. Landscape opens in Pan; toolbar, details and keyboard stay independently operable. Mode and pointer cancellation restore previews. Long-press disclosure waits before any irreversible mutation and consumes the eventual click, fixing the audited delete-on-long-press failure. Step picker/control editing remains available in either mode.

Accept one pointer ID for each editing or disclosure gesture. While it is active, ignore additional pointers' down/move/up events: they cannot change targets, commit, cancel or release the accepted pointer's gesture. Pointer cancellation/lost capture for the accepted pointer restores previews and clears pending hold timers. Native Pan movement/scroll and switching to Pan cancel pending long-press disclosure; a hold must not fire after scrolling, mode change or cancellation. Gesture completion and cancellation clear timers and suppress any delayed editing click.

### Scenarios

Durations reuse the app's own: 200ms ease-out is the `.panel-animation-container` transition; 150ms is the remote-change flash. Under `prefers-reduced-motion` every transition is a cut.

| Scenario | Moves | Stays | How you know |
|---|---|---|---|
| Open from a row | Desktop grows 0 → height over 200ms; landscape opens fixed inset 8px without routing; initial Notes Fit includes enabled ghosts | Row horizontal/vertical scroll and invoking control identity | 2px control-block edge; ♪ orange only in Notes; cells pulse 150ms; visible track/pattern/step context |
| Switch track | Notes crossfade 120ms; previous track becomes an enabled ghost where applicable; Fit includes active and enabled ghosts; drums fall back to Track | Header/toolbar/body budgets, detent and row scroll | Left-edge state moves; visible title/tab update; nonmelodic Notes disabled |
| Switch pane | Toolbar and meaningful body content change; Notes mount retained while hidden in details panes | Toolbar 48px, body height, detent, H and retained horizontal/pitch scroll | Pane chip changes; step identity persists; ♪ clears outside Notes; no recenter or layout shift |
| Close (active Notes ♪, Escape, ×) | Desktop collapses over 200ms; landscape sheet closes; Escape consumes drag, then copy, then dock | Invoking row horizontal/vertical scroll | Left-edge/♪ state clears; invoking control receives focus without scrolling |
| Playing | Ruler, dock and per-cell playheads share one scheduler clock; sounding bar gets an additional white outline, no transform | No auto-scroll | Desktop playheads align physically; landscape timelines show the same numbered step and shorter-track wrap |
| Draw | The bar follows the pointer; the row's cells update on the same frame | Dock, grid, keyboard | Dashed ghost bar before commit; cursor changes at a bar's right edge; under scale lock the ghost sits on the row it will snap to |
| Select a step | Disclosure opens Step on all tracks, including drums; range modifiers retain existing selection semantics | No strip between rows; Notes mount, H and pitch scroll retained | Blue selection/column highlight and visible step/track identity persist when returning to Notes |
| Remote edit | Bar flashes in player's colour 150ms; conflicting edits cancel local drag | Local dock track/pane, ghosts, detent, H and scroll | Cell/bar attribution agrees; authoritative locks survive cancellation |
| Reorder, delete, add | Rows move as today; deleting the docked track closes the dock; adding a track does not open it | Row width and drop geometry | The control block's docked left edge travels with its row |
| Published session | Dock opens and plays; keys audition | No ghost bar, drag cursors or Step edits | The dock takes the published scrim, which panels do not today |

### Two rolls at once

The question that separated this design from the shipped one. Opening Bass while Lead is docked switches the dock to Bass and keeps Lead as dashed ghost notes in the same grid, the way ghost notes work in Ableton, Logic and FL Studio. Both melodic rows show their contour marks. The alternatives (stacked lanes, per-track rolls fitted to their notes, per-track rolls as shipped, a modal) are ranked in [mocks/piano-roll-layout-options.html](./mocks/piano-roll-layout-options.html).

## UI Philosophy Alignment

| Principle | Score | Notes |
|---|---|---|
| Controls on target | ⚠️ | Editors dock, linked by left-edge state, track/step context and open pulse. Mute, solo, audition/disclosure and Copy/Paste, Clear, Delete remain on the actual row; copy source/destination indicators preserve proximity. |
| Immediate feedback | ✅ | Edits in the dock update the row's cells on the same frame; every pitch auditions. |
| Modes visible | ✅ | Which track is docked, which pane, which ghosts are on, and the loop region are all visible in the dock header and on the row. |
| Progressive disclosure | ✅ | Click acts, Shift+click discloses the Step pane, the Track pane holds the controls the row diet removed. |
| One screen | ✅ | Desktop grid remains above dock. Landscape expanded sheet stays within the current sequencer with explicit editor timeline/context and unchanged returning row scroll; no route. Portrait consumption preview uses the stated viewport condition. |

## Constraints

| Constraint | What it means for the dock | Source |
|---|---|---|
| Column alignment | Shared stepX: 39px within pages, extra 8px every 16. Desktop L=154px physically aligns rows/ruler/lanes/dock in one horizontal scroller. Landscape row L=216px, editor L=84px with independent horizontal body scroller/timeline; same stepX/page map, different origins | Current CSS components; normative geometry above |
| Row rhythm and tessellation | Cell lanes only between rows; desktop 58px + 2px = 60px pitch, landscape 48px + 2px = 50px pitch. Reserve desktop dock height for final-row access. Landscape inset sheet restores row scroll on close | This spec; AFFORDANCES column integrity (PR #61) |
| Row width is load-bearing | Current index.css token is 512px; desktop .track-left template is approximately 508px. Adopting 154px desktop / 216px landscape requires fixing or revalidating drag/auto-scroll during real-Worker playback, including sticky-right actions | LESSONS-LEARNED lesson 62; index.css, TrackRow.css |
| Every `.track-left` child has explicit placement | Desktop grip spans both rows; identity/controls occupy named rows. Landscape places name/M/S/Edit on one line, with no desktop grip slot or auto-placement | Lesson 61; chosen geometry |
| Editable and published templates | Same left width per device; badge auditions, instrument picker moves to Track. Published action/mutation gates do not change step origins | TrackRow.css, TrackRow.tsx; compatibility contract |
| Track access is independent of pitch capability | All tracks have name/tab access to Track and step disclosure to Step. Notes alone is melodic-only; a drum-only session must not lose step count, instrument, transpose, pattern tools or actions when rows shrink | this spec |
| Absolute pitch coverage and mutation bounds | All MIDI 12..108 rows remain in the grid under scale lock. Pitch locks and transpose each stay within their existing -24..+24 bounds; valid visibility does not make every row writable at every transpose | `shared/constants.ts`, `audio/constants.ts`; pitch contract above |
| Scroller ownership | Desktop tracks/wrapper gets max-height vertical scrolling, reserves sticky-bottom dock and uses one horizontal scroller. Landscape row scrollers remain unchanged while expanded editor owns its body scroller; no row/editor synchronization | StepSequencer.css, TrackRow.css; refined mobile contract |
| Shared mode / portrait preview | JS chooses desktop at width>=768 AND height≥500; otherwise landscape at height<500 OR width>height; else portrait. Root data-display-mode controls CSS/behavior, with no independent orientation/max-height queries. Only width<768 AND portrait AND height≥500 hides sequencer for consumption preview | useDisplayMode/useOrientationMode path; existing thresholds and source provenance below |
| Mobile landscape hides every panel container | The dock replaces them; today the TrackDrawer's pitch, velocity and pattern buttons change state but nothing opens | `TrackRow.css:1678-1681`, `TrackDrawer.tsx` |
| Published mode | `.published .track-row { pointer-events: none }` does not cover panels; the dock must take the scrim explicitly and honour `readOnly` | `StepSequencer.css:170`, `TrackRow.tsx:696` |
| Dock state is local | Which track, pane, ghosts, detent and scroll never sync; the 64KB message cap is untouched | `shared/constants.ts:18`, `sync/sync-classification.ts:88-95` |
| Every edit is an existing mutation | Toggle preserves locks; parameter-lock edits merge at caller; explicit erase/clear and sequence/range operations retain documented semantics. MCP note surface #92 shares operations | shared/state-mutations.ts; mutation/compatibility contract |
| Ghosts must be truthful | A ghost from a track of a different length repeats modulo that length, drawn lighter | `LOOP-RULER-LESSONS.md` §3.3 (PR #61) |

## Trade-offs

| Gives up | Buys | Exposed by |
|---|---|---|
| The roll is no longer under its track | Rows stay contiguous however many rolls are open | The two-rolls test |
| One track editable at a time | Two parts compared in one pitch space, one keyboard | Ghost notes |
| Step count/instrument one disclosure deeper; transpose readout edited in Track; name no longer auditions | 154px desktop column, 136px keyboard, direct all-track audition badge and usable Track replacement | Desktop access contract |
| Desktop rows increase to 58px | 24px identity/control targets, 50px stack, 60px row pitch | Chosen geometry |
| `.track-left` width changes | Nothing, if the drag/auto-scroll interaction is fixed first; a known fragility otherwise | Lesson 62 |
| Dock height taken from the viewport | No editor between rows; landscape sheet gains a 150px body at 568×320 with 84px key column and unchanged returning scroll | Layer/mobile rules |
| A new vertical scroller for `.tracks` | A dock that pins and a ruler that stays visible | Sticky positioning |

## What We Remove

Remove each original only in the phase that delivers its working replacement on that device. Until then, keep its entry point and editor reachable; a readout alone cannot replace a transpose control.

- The per-track pitch panel and its Grid / Piano Roll tabs (`TrackRow.tsx:1167-1217`).
- The ParameterLockEditor strip between rows (`TrackRow.tsx:1220-1232`); the component's content moves into the Step pane.
- PatternToolsPanel, the always-on FM panel and the instrument picker's inline placement; their content moves into the Track pane.
- The legacy InlineDrawer and `mobile-edit-panel` (`TrackRow.css:27-34, 310-425`), only after working landscape replacement and the conditional portrait preview are delivered.
- The transpose dropdown, step-count dropdown and pattern-tools toggle from `.track-left`, and the single-line, ten-column `.track-left` template itself.
- The full-width proportional LoopRuler outside the scroller; its behaviour moves into the scroller on the step pitch.

## Multiplayer Considerations

- Dock state is component or `focus`-slice state, never synced. The existing `focus { context, trackId, stepIndex }` slice (`types.ts:33-37`) has no UI dispatching it; "docked track" can be that slice.
- Remote edits to the docked track flash in the dock with the same `useRemoteChanges` hook the cells use.
- `CursorOverlay` keeps mapping percentages onto the grid container; it does not map into the dock.
- Published sessions open the dock read-only.

## Mobile

### One JavaScript mode decision

Use the orientation-mode decision from the `useDisplayMode`/`useOrientationMode` path as one shared JS source for behavior and styling, with the existing app thresholds below:

```js
const mode = width >= 768 && height >= 500 ? 'desktop'
  : height < 500 || width > height ? 'landscape'
  : 'portrait';
```

Publish that decision as root `data-display-mode`; CSS selects `[data-display-mode="desktop"]`, `landscape` or `portrait`. Do not independently recompute mode with orientation/max-height media queries. In particular, height500 is not a blanket landscape cutoff:700×600 is landscape,768/769px width at height≥500 is desktop,1024×500 is desktop, and even a geometrically portrait viewport at height499 uses landscape. The portrait-preview conjunction stays width<768 AND portrait AND height≥500, derived from this JS mode rather than a competing CSS query. Resize/orientation handling updates the shared mode, cancels active gestures and measures layout before refitting.

From the same JS mode/width snapshot, publish root `data-narrow-landscape` for `mode === 'landscape' && width < 440`. This flag selects only row-action positioning; it introduces no display mode, route or height change. CSS consumes the root flag rather than independently deciding the narrow variant. Update both root attributes together on resize; width440 retains sticky-right actions.

Source provenance: reuse the verified `getOrientationMode`/`useOrientationMode` decision in `app/src/hooks/useDisplayMode.ts`, including its existing `>=768` desktop boundary and branch ordering. The main prototype uses the same decision for root CSS and lifecycle. The separate QR-size `getDisplayMode` helper retains its existing large/medium/small behavior; the dock does not redefine it or change app code.

### Device-specific dock layout

- **Portrait consumption preview:** only `(width <768px) AND (orientation: portrait) AND (height ≥500px)` hides the full sequencer. Show session/pattern/track context, listening preview and an explicit rotate-to-edit instruction. No editable track rows, dock or hidden focusable editing controls in that mode. PortraitGrid labels can reuse tick/name presentation without a dock opener or rename action. A short geometrically portrait viewport at height499 selects the landscape sequencer through the shared JS rule.
- **Landscape rows:** 216px single horizontal left block: name 64px, M/S/Edit 44px each, 3×4px gaps, 8px padding; 48px row / 50px pitch. Cells 36px wide × 44px high. Row Copy/Paste, Clear and Delete remain outside the column with 44px targets. Name/Edit opens Track; disclosure/picker opens Step; Notes is melodic-only. Dock audition and lane access must work before their desktop row slots are absent on mobile.
- **Landscape expanded dock:** fixed `inset: 8px` within the current sequencer, no route change. Header 88px (two 44px rows, no vertical padding/gap), toolbar 48px (44px controls + 4px total padding), status 16px, total borders 2px. Planned main CSS: `--dock-grid-h: calc(100dvh - 170px)`. At 568×320 the body is exactly 150px and must remain at least 150px across Notes, Step and Track: `320 - 16 - 88 - 48 - 16 - 2 = 150`. No extra ruler/header/margin steals that budget. Body fills remaining height with internal scrolling. Chrome targets 44px, radius 4px; context/title and track/pane tabs remain visible, with horizontally scrolling chips/tools and 44px overflow controls.
- **Landscape editor timeline:** key column 84px = rail 18px + keys 66px. Own horizontal body scroller; status16 bar.beat labels at `92 + stepX(s) - body.scrollLeft`, visible title updates on cursor movement and visually hidden live track/step/pitch context. The timeline has no body-height cost. Same stepX/page spacing as the 216px row timeline, different origin; no synchronized row/editor scroll. Native Pan (`touch-action: auto`) and explicit Draw are visible modes; 44px Step picker always available. Close restores invoking control and unchanged row horizontal/vertical scroll. Orientation exit cancels gestures and pending name openers; conditional portrait preview hides editing only when its full viewport conjunction applies.
- **Release gate and shared mode:** row/drawer/panel changes ship atomically with working replacements, resolving the pitch-editor gap in MOBILE-INTERFACE-SIMPLIFICATION.md. The single JS decision above governs all three modes and the root CSS attribute. Desktop takes priority at least 768px wide with at least 500px height; otherwise height below 500px OR width greater than height selects landscape. Preserve the portrait-preview conjunction and reuse the app's exact768px desktop boundary unchanged.

## Very Complex Pieces

- Sixteen tracks at 128 steps: the dock draws one track as bars, so it is cheaper than today's roll of up to 4,608 buttons. Tracks scroll under the pinned dock.
- Polymeter: the dock's grid is the docked track's length with the same page dividers; ghosts repeat modulo their own length and use destination column coordinates, including page gaps.
- Many melodic tracks: ghosts default on for the two nearest melodic tracks, off beyond that, each a toggle.
- Any track length (#119) changes only where page dividers fall.
- Patterns and song mode (#121): the dock edits the current pattern and re-renders at a queued switch; the dock title carries the pattern name from day one.

## Layout Principles

The sequencer remains a tessellation of aligned steps. These rules are checked against the numeric contract and working interactions.

**Contrast.** Desktop cells remain 36px squares; landscape cells are 36×44px. Both use the shared orange velocity formula without white overlays. Bar labels choose dark/white contrast foregrounds and remain at least 4.5:1; constant 3:1 presence outlines survive volume 0 and overview zoom. Informative muted text is at least 4.5:1; control boundaries/focus are at least 3:1. Docked edge and active Notes/chips are accent; solo state is yellow and focus/selection blue. Category colour belongs to ticks and ghost borders.

**Repetition.** Desktop repeats a 154px block, 24+2+24px stack, five 24×24px controls with 2/4/2/2px gaps, 58px row / 60px pitch. Landscape repeats name64/M44/S44/Edit44 plus 3×4px gaps and padding8 = 216px, 48px row / 50px pitch. Dock chrome is 32px desktop / 44px landscape, radius 4px; all toolbars are 48px. Desktop body detents are 252/432px; landscape uses the viewport-derived body. Keys/bars/ghosts/hit testing share H=2..36px, default18.

**Alignment.** Desktop control column, keyboard panel and ruler spacer share 154px, giving step origin162, and share horizontal scrolling. Landscape row origin224 and editor origin92 are intentionally separate, with row column216 and key column84. Shared stepX/page mapping preserves musical coordinates; visible bar.beat labels in the 16px status strip and cursor-updated title/live context make the landscape editor understandable. Row tops use 60px desktop / 50px landscape pitch; pitch-grid tops derive directly from H.

**Proximity.** Desktop identity and state/disclosure occupy its 154×58px left tile; landscape name/M/S/Edit occupy its 216×48px left tile. Copy/Paste, Clear and Delete belong to the target row outside either left tile, with 32px/44px targets and explicit source/destination indicators. They do not migrate to Track. Dock details remain linked to a track by left-edge state and visible track/pattern/step identity. Step selection is persistent across panes; cell, contour, bar and highlight share the same step.

| Today | Chosen contract |
|---|---|
| Desktop/landscape control templates with crowded small targets | Desktop 154px two-line block, landscape 216px one-line block; explicit sizes and placements |
| Landscape drawer, desktop expanders, mobile edit panel, p-lock strip | Desktop dock / landscape expanded editor; conditional portrait consumption preview |
| Name auditions and double-click renames | Name opens Track after200ms, double-click cancels opener/renames; direct audition badge, mobile Track audition |
| Transpose/step count/instrument controls in rows/drawers | Working Track controls; desktop transpose identity readout |
| Row actions potentially moved to an unrelated dock | Copy/Paste, Clear, Delete remain visibly on the actual row |
| Wide desktop keyboard / no usable landscape pitch editor | Desktop keyboard136px; mobile keys66px within editor column84px, shared H and Step picker 32px desktop / 44px mobile alternative |

## Implementation Phases

PR #127 completes the proposal alignment in phase1: this specification, local Markdown companions and all three referenced mocks use the chosen contract. Phases2–7 are future production implementation, each delivered as a shippable PR with relevant checks and reviewed baselines. Replacement availability is a release gate: no entry point is removed before its equivalent works. Proposal alignment does not complete production implementation or its acceptance checks.

1. **Proposal alignment (PR #127).** This document and all three referenced mocks are aligned on geometry, CSS tokens, orange formula, typography, contrast, selected context and honest affordances. Local Markdown companion amendments describe scoped proposal changes while preserving existing standards and examples. Companion C-1/C-4 roadmap files available only on the PR #61 branch still require reconciliation before production rollout. An unenacted scale selector/scale lock, grip reorder, FM or instrument-change control stays visibly disabled with a visible “Preview — not implemented” label and an accessible explanation; do not present a fake mutation, delete the UI to disguise a gap, or claim implementation acceptance from a mock screenshot.
2. **Desktop dock shell and access.** Deliver all-track tabs, capability-aware panes, visible 84px header (32px context + 32px chips with specified padding), 48px toolbar/32px chrome and meaningful constant-height bodies. Include status24/top border1 for total409/589, and a toolbar Step picker32 desktop/44 mobile. Notes contains the loop input/Clear alternatives at the same device-specific sizes. Reserve sticky-bottom dock space in the vertical scroller; retain one horizontal scroller. Ship name's delayed Track opener and double-click cancellation together with immediate all-track audition replacement, focus restoration and drag>copy>dock Escape arbitration. Retain old row/editor entry points until cutover. Absolute pitches and out-of-scale notes remain visible.
3. **Desktop Track and row diet together.** Deliver real transpose, step count, instrument, pattern/FM and lane controls, including drum-only sessions. Keep Copy/Paste, Clear, Delete on the row outside the left column with 32px targets and source/destination indicators. Adopt 154=12+4+130+8px, identity24+gap2+controls24=50px, five24×24px controls with2/4/2/2 gaps, row58/pitch60 in editable/published variants. Retain editable transpose until replacement works. Update spacers/step origins together; fix/revalidate reorder/auto-scroll against a real Worker. Landscape remains on old paths until phase7.
4. **Shared rendering, zoom and column geometry.** Deliver bars/ties, relative-H proportioned keyboard, ruler with keyboard endpoints, validated Draw/re-pitch/resize and collision rollback, page gaps and desktop body252/432. Keep all97 MIDI12..108 rows; shared H2..36/default18, Fit active+enabled ghosts with two-row padding, centre-preserving zoom and overview H<12. Deliver centred bar/ghost heights max(1px, 14/18 × H) / max(1px, 12/18 × H), radius at most half-height and 3px, constant presence outline, contrast foregrounds and planned CSS tokens with cell/bar fill equality, unlocked1.0, no white velocity overlays/badges. Vertical re-pitch only; no fake horizontal onset grip.
5. **Step cutover.** Complete supported locks/envelope editor for every track type; toolbar Step picker (32px desktop / 44px mobile) and equivalent edits, visible identity/selection even in Notes, effective/inherited values, preview and meaningful disabled content in the same body height. Parameter updates preserve unrelated locks; ordinary toggle preserves all locks; explicit Clear lock/Erase note use their distinct operations. Grid mount/scroll retained when hidden. Remove the desktop strip only with its usable replacement; landscape path retained until phase7.
6. **Ghosts and contour cutover.** Truthful absolute-pitch ghosts repeat modulo source length and participate in Fit; melodic contour uses fixed effective-lock -24..+24 mapping including tie inheritance, never pattern min/max. Remove old pitch/tie badges only when replacement works. Cell budget remains velocity colour, contour, purple has-lock border; selection/playback are transient.
7. **Atomic landscape cutover.** Deliver rowleft216=name64+3×44+3×4+8, row48/pitch50, cells36×44 and external row actions44. Deliver expanded fixed-inset8 editor: header88 (two44 rows/no gap/padding), toolbar48 (44+4), status16, borders2, keycolumn84=18+66, body `calc(100dvh - 170px)` ≥150 at568×320. Separate horizontal body scroller/timeline shares stepX/page mapping; row scroll remains unchanged. Working Track/drum Step/Notes, preview/lane access, Step44, Pan/Draw, focus restoration and full portrait-preview condition ship together. Replace TrackDrawer/dead hidden panels only alongside working equivalents; validate the shared JS/root-mode decision, orientation transitions and landscape reorder.

A real-app rollout must satisfy the acceptance below through existing mutations, keyboard/touch handlers, capability/read-only rules and real scheduler/Worker paths. Disabled mock placeholders are honest proposal evidence, not a substitute for working replacements.

## Test Plan

These are acceptance requirements for future production implementation. The aligned proposal mocks demonstrate the contract; their behavior does not establish real-app acceptance. Use seeded sessions and assert mutations, DOM rectangles, computed/composited styles, focus, scroll and reviewed screenshots in the real app.

- **Name/audition and replacement parity:** at199ms pointer click has not opened Track, at200ms it opens; double-click cancels the opener and renames inline without delayed opening/audition. Enter/Space opens Track immediately, cancels any pending pointer opener, and prevents Space scrolling or duplicate native activation. Badge directly previews melodic/drum tracks through the existing instrument/transpose/sustain path; mobile Track has44px audition. Test rename save/cancel/blur and timer cleanup. Drum-only Track/Step stays usable; Notes disabled through pointer/keyboard. Working instrument/transpose/step count/FM/pattern/lane replacements precede removals. Published allows navigation/audition but no rename or mutation.
- **Row copy/clear/delete:** measure external32px desktop/44px mobile targets, visible source and destination-row Paste indicators, row eligibility and source deletion cancellation. Paste performs existing sequence payload semantics without moving dock focus; source/target instrument/transpose identities remain correct. Preserve range clipboard, deliberate row replacement, clear/delete constraints and read-only rules. Exercise real mutations, not cosmetic buttons.
- **Escape/focus:** with active drag+copy+open dock, successive Escape cancels only drag, then only copy, then dock with dock focus. Menus/rename consume their own key first; one arbiter prevents global double handling. ×/active ♪ restores exact invoker and original row horizontal/vertical scroll; deterministic fallback after deletion. Closed dock is inert; no focus loss to BODY or automatic row scrolling on open/close.
- **Pitch coverage/bounds:** seed MIDI12/108 with transpose/lock pairs(-24,-24)/(+24,+24), notes below36/above84, out-of-scale notes and ties. All97 rows, bars/ghosts/keys remain reachable at every zoom; no range/scale filtering. At transpose -24/0/+24 test valid placement/paint/re-pitch/Step input and one semitone outside bounds. Invalid operations preserve activation/locks; preview matches valid snapped pitch, including lower-pitch tie-break and inherited tie values.
- **Mutation/collision/onset:** seed unrelated volume/tie/envelope locks on active and inactive steps. Ordinary click/Enter off/on preserves them; targeted edits merge, zero-pitch placement replaces stale pitch, Clear lock leaves activation, explicit Delete/Erase clears only addressed activation/locks through existing semantics. Paint/resize into occupied attacks/foreign tie chains never overwrites them. Invalid/cancelled previews restore snapshots; conflicting remote edit survives cancellation. Body drag is vertical only; a no-movement bar click including the right edge toggles off preserving locks, while engaged resize never falls through to click-off. Horizontal onset remains existing range operations with no fake grab affordance.
- **Zoom/Fit:** measure one H input for grid/keys/bars/ghosts/hit testing at2/11/12/18/36 and Fit-derived fractional H. Fit comparison includes active + enabled ghosts with two rows of padding, chooses largest fitting H bounded 2..36 for explicit Fit, and retains all 97 rows. Verify initial automatic Fit ceiling 18px, track/ghost-switch and manual Fit events, and empty fallback 18px/MIDI60, centre-preserving manual zoom and no ordinary pane/playback recenter. Initial Track/Step defers Fit until first Notes; initial Step reveals effective selected pitch without changing H. After resize/detent, assert fractional H uses the new measured B, not stale height. AtH<12 labels hide, constant outlines/accessibility remain, the 32px desktop / 44px mobile Step picker performs equivalent edits.
- **Velocity/contrast/contour:** seed unlocked and explicit0/0.3/0.5/0.8/1.0 volume. Computed cell/bar fills match; unlocked=explicit1.0; insertion default1.0 affects only new notes. No white encoding/badges or JS colour ramp. At every visible-label velocity measure4.5:1 foreground against actual fill (dark on bright, white on dark); presence/ghost/control/focus boundaries≥3:1 and informative muted/status/disabled text≥4.5:1. Range/scale decoration must not dim key labels or disable audition; white labels retain --piano-key-label and black labels remain readable. Muted row controls/names/values retain contrast without inherited opacity. Presence survivesvolume0/overview; focus blue, solo visiblyyellow with correct aria-pressed. Existing contour marks retain fixed effective-lock mapping when pattern extrema change; ties inherit.
- **Desktop geometry/panes:** measure column154=12+4+130+8, stack24+2+24=50, five24×24 controls with2/4/2/2 gaps, row58/pitch60, keypanel154=18+136 and step1x162. Header84 with visible32px context+32px chips, toolbar48/chrome32/radius4 and overflow32. Status24/top border1 yield total409/589; toolbar Step picker32 stays operable. Centred note/ghost heights and half-height radius clamps follow H. Body252/432 stays constant with real Track/drum Step details and long internally scrolling content. Notes grid remains mounted while hidden; H/scroll retained except defined initial Fit and minimal selected-pitch reveal. Assert desktop state buttons are exactly24×24px and their row parents never lower control/text opacity for mute. Step identity/selection persists in Notes, ♪ active onlyNotes and click from another pane switchesNotes. Values use mono and required typography.
- **Page/scroll mapping:** on32/64/128-step tracks measure11px page boundaries and shared stepX. Desktop physical row/ruler/dock/lane alignment persists while horizontally scrolling. Test page-crossing ties, hit coordinates, loop endpoints/playheads and repeated shorter ghosts. Landscape roworigin224/editororigin92 deliberately differ but share stepX/page mapping; bar.beat labels track `92 + stepX(s) - body.scrollLeft`; visually hidden live status and visible cursor-updated title announce the same step/pitch while row scroll remains unchanged. Labels consume only the status16 budget, not body height. At maximum scroll the final cells clear sticky-right actions and remain clickable/focusable, with reserved end-padding and a muted overlay boundary.
- **Landscape arithmetic/portrait:** at568×320 measure inset8/header88/toolbar48/status16/borders2/keycolumn84=18+66/body≥150 with `--dock-grid-h: calc(100dvh - 170px)`; no unbudgeted header/ruler/padding. Measure left216=name64+M44+S44+Edit44+3×4+8, row48/pitch50/cells36×44, chrome/overflow/Step picker44 across panes. Assert Pan touch-action:auto scrolls without editing; Draw edits valid targets, long-press discloses without subsequent deletion. Close restores row scroll/focus. Assert root data-display-mode, JS behavior and CSS agree for widths767/768/769 and heights499/500. Seed450×499→landscape,700×600→landscape,1024×500→desktop,767×800→portrait,768×800→desktop and769×800→desktop;768×499→landscape. Only derived width<768 AND portrait AND height≥500 hides the full sequencer for preview; independent orientation/max-height CSS queries cannot override the root mode.
- **Display-mode source and boundaries:** assert root `data-display-mode`, computed row/dock geometry, focus and inert state all follow the same JS decision, including after resize. Cover 390×499 and 700×600 as landscape, 1024×500 and 769×1024 as desktop, and 390×844 and 767×1024 as portrait;768×1024 and769×1024 as desktop. Short portrait must retain the editable sequencer. Desktop at height exactly500 must retain header84/chrome32; landscape at height600 must retain header88/chrome44. Do not use independent media queries to redefine these boundaries. Preserve the app's exact768px desktop boundary; no planned threshold exception. Mock behavior alone is not production validation.
- **Keyboard/ruler:** timeline is a focusable named group with one tab stop, a logical step/pitch cursor and associated announced status; arrows navigate, Enter toggles preserving locks, Shift+Enter opens Step, Delete explicitly erases the bar, Space auditions without toggling transport. Preserve Ctrl/Cmd selection and Shift extension when a range exists. Keys audition by keyboard; Step picker 32px desktop / 44px mobile remains an alternative at H=2. Loop is a focusable group announcing current endpoints/full pattern: arrows adjust start, Shift+arrows adjust end, Delete/Backspace clears only loop. No false slider semantics; retain pointer drag/Shift+click/double-click, bounds and minimum length. Notes toolbar Loop start/end native inputs and Clear loop are 32px desktop / 44px mobile, reflect the same loop state/bounds and remain reachable through toolbar overflow; no Track-details duplicate is required. Inputs/sliders retain keys; read-only cannot mutate.
- **Reorder/local state/real rollout:** real-Worker playback verifies drag drop/auto-scroll after width changes and sticky-right actions; deleting docked track closes safely, adding does not open. Remote attribution and queued-pattern/loop/playhead wrapping remain correct; local pane/ghost/detent/H/scroll state never syncs. Reduced motion cuts transitions. Mock placeholders remain visibly disabled/labeled; release acceptance uses working app and genuine mutations.

Future production coverage: extend/add `e2e/piano-roll-dock.spec.ts`, `scrollbar.spec.ts`, `pitch-contour-alignment.spec.ts`, `mobile-orientation.spec.ts` and `landscape-alignment.spec.ts`; move `plock-editor.spec.ts`/`chromatic-grid.spec.ts` coverage with replacements. Revalidate `track-reorder.spec.ts` and `state/grid.test.ts` “reorder during playback” after phase3 and landscape phase7. These checks remain production rollout gates.

**Interaction-review regression acceptance:** reject occupied-step pointer/Enter placement at a different pitch without erasing its attack or tie chain. Resolve Ctrl/Cmd and Shift selection before bar/continuation mutations. Consume no-op and read-only Delete locally. Seed dormant pitch/volume/envelope fields on inactive continuation steps: extending a tie preserves them, Tie off exposes them, and retraction restores prior activation/Tie without replacing unrelated fields. For paint, re-pitch and resize, cross valid→invalid/colliding→valid targets and assert the entire gesture rolls back; pane changes cancel it with no subsequent click-off. Home/End reveal first/final steps. Landscape initially opens in Pan. Empty-source Copy stays disabled. Step Activate/Deactivate preserves locks while Erase clears them. Inline rename retains the existing 32-character limit. Validate these in the real app before rollout; prototype implementation is supporting evidence only.

**Fit-boundary regression acceptance:** empty active/comparison content at transpose -24/0/+24 uses H18 and absolute MIDI60. With notes/ghosts at MIDI12/108, assert displayed two-row padding clips to the absolute bounds, the specified fractional zoom formula remains unchanged, all97 rows remain available and boundary notes are visible/reachable. No extra playable rows or synthetic gutters may extend the domain.

**Narrow-landscape and committed-tie regression acceptance:** at390×499 and439×499, verify landscape/root narrow flag, unobscured name/M/S/Edit hit targets, static44px row actions reachable at the end of horizontal row scroll, and unchanged left216/row48/pitch50 with no wrapping or additional height. At440×499 and450×499 assert the narrow flag is false, sticky-right actions remain and final steps scroll clear of the overlay. Resize across439/440 updates both root attributes consistently; portrait390×844 does not activate the narrow variant. Seed inactive continuation steps with absent, false and true Tie fields plus distinct dormant pitch/volume/envelope fields; commit extension, finish the gesture, then retract in a new gesture. Assert exact prior Tie/activation restoration with other fields unchanged, and safe rejection after a conflicting authoritative edit. Run production checks through mutation/history handling, not solely the prototype's local origins Map.

**Additional interaction regression acceptance:** explicitly place/paint on an inactive step with stored `tie: true`, pitch, volume and envelope fields: commit the requested pitch and `tie: false` while retaining volume/envelope. Ordinary activation and tie extension still preserve their stored fields. With a range and a different cursor/bar, dock Delete erases only the range's addressed steps/locks; without a range it erases only the addressed note. A second touch cannot move, commit or end the first pointer's gesture; accepted-pointer cancellation restores state, and Pan movement/mode change cancels pending hold disclosure. From horizontal scroll, Home reveals step1 beyond the landscape84px keyboard plus gap; End reveals the final step, without moving row scroll. Visible inactive-step context uses stored/default effective pitch and volume; live cursor announcements include effective volume and tie inheritance. With a range, active drag, copy and dock focus, successive Escape cancels drag, then copy, then closes the dock without clearing the range; outside-dock Escape retains existing range handling. Read-only and no-op Delete remain locally consumed.

## Visual Baseline Safety

`sequencer-grid`, `track-row-with-steps`, `desktop-wide` and the Holby populated set change with the shell, row diet, rendering and contour phases; landscape baselines change at phase 7. For each production implementation phase that changes visuals, run the manual `visual-baselines.yml` workflow and review the image diff by hand against the numeric acceptance targets. The macOS Holby baselines have no regeneration workflow and are updated locally. PR #127 aligns the specification and three proposal mocks; real-app baseline regeneration remains part of the future production phases.

## Alternatives Considered

Six arrangements for shrinking the keyboard and five answers to "two rolls at once" are ranked, with exploratory mocks, in [mocks/piano-roll-layout-options.html](./mocks/piano-roll-layout-options.html). Their adopted-option dimensions defer to this spec:

| Arrangement | Why not |
|---|---|
| Split controls left and right of the row | Keeps all ten controls visible with no width change, but the inline roll still splits rows while open. The fallback if the dock is rejected. |
| Responsive column that shrinks while a roll is open | Width changes on toggle, which is exactly lesson 62, and controls vanish while editing pitch. |
| Generic two-line header without a numeric control budget | The chosen desktop contract is specifically 24+2+24px inside 58px rows on 60px pitch. Similar row-pitch numbers alone do not establish replacement parity or measured geometry. |
| Compact row with a per-track drawer | A row without cells between rows with cells; breaks the vertical scan. |
| Keyboard view replacing the grid | Other tracks vanish while editing, against the one-screen principle. |
| Per-track rolls fitted to their notes | Affordable multi-open, but the grid is still split once per roll. |

### Decided against

- **Desktop modal or floating window.** Covers the grid or loses physical column alignment. Desktop retains its pinned dock. The deliberately expanded landscape focus editor is the viewport-specific exception within the existing sequencer, with explicit timeline/context and scroll restoration.
- **Full-width ivory keys as shipped.** What made them read badly was the gloss, the wood body and a label on every key, not the width; the dock makes the width moot.
- **Opening the dock when a melodic track is added.** Decided: only on request.
- **Persisting the docked track.** Decided: no.

## Non-goals

- Polyphonic tracks, chords, or an arpeggiator.
- Changing the data model. Steps, parameter locks and transpose are untouched.
- Auto-scroll during playback.
- A new global mobile bottom-sheet primitive (Phase 38 / C-7). The landscape expanded editor is specified here within the sequencer and does not require a new route or a general-purpose sheet system.

## Open Questions

- "Two nearest melodic tracks" is the agreed ghost default count; the ordering used to determine nearest (row distance or another rule) still needs to be specified. This does not affect all-track access, pitch visibility or the numeric acceptance targets.

## Interactions with Roadmap Features

- **PR #61 (AFFORDANCES, EVOLUTION-ROADMAP, PATTERN-MODE, mocks).** Amend C-1: cell lanes stay inline; editors dock, with landscape's expanded focus editor. C-4 becomes a 154px desktop two-line block and a 216px landscape one-line block, with row actions outside both. PR #127 aligns the local Markdown companions and all three proposal mocks. Companion roadmap files available only on the PR #61 branch remain to be reconciled with this source of truth before production rollout.
- **PR #87 (envelope v2 authoring).** Merge first. Phase 5 moves its editor into the Step pane wholesale, before removing the original strip on each device.
- **PRs #85 and #58 (grip and gear glyphs).** Compatible; the grip stays on the row, the gear moves to the Track pane.
- **Issue #92 (MCP pitched notes).** The dock is its UI counterpart; share the domain operation.
- **Issues #119 and #121.** Covered above; neither blocks the dock.
- **Issue #118 (step-count labels).** Settle the wording before the Track pane renders the control.
- **Branch `claude/keyboardia-take-five-8brx26`** (tracks run free): the dock's playhead wrap assumes it.

## Evidence and Source Changes

Audit findings and saved prototype observations describe earlier failures; the aligned interactive dock mock resolves specific prototype gaps, including fractional Fit. Current app source supplies compatibility constraints. Neither prototype behavior nor earlier audit measurements establishes completed production integration. PR #127 updates the specification, local companion amendments and three proposal mocks together; the shared orange formula and existing mutation/scheduler contracts remain intact.

| Evidence / current source | Specification change |
|---|---|
| Saved observations: hidden Step identity, unchanged visible solo state, low-contrast labels/volume-zero presence | Always-visible track/pattern/step context, persistent selection, yellow solo/ARIA, measured contrast foregrounds and constant presence outline |
| Saved observations: landscape Notes bodies 79px and 49px; ghosts present but none visible | Refined header88 / tools48 / status16 / borders2 / inset8 = body150 at568×320; keycolumn84; shared pitch zoom and active+enabled-ghost Fit comparison |
| Saved observations: portrait still showing rows/dock, long-press deleting, keyboard editor doing nothing, close focusing BODY | Conditional portrait consumption preview, consumed long-press, logical keyboard cursor/status, Escape arbitration and exact invoking-control/scroll restoration |
| `app/src/components/TrackNameEditor.tsx`, `TrackRow.tsx` | Preserve 200ms click/double-click arbitration and inline rename; delayed callback becomes Track opener; direct badge/mobile Track audition replaces name audition using existing preview semantics |
| `app/src/components/StepCell.tsx`, `StepSequencer.tsx` | Preserve Ctrl/Cmd selection, Shift range extension and source→destination row copy; Copy/Paste, Clear, Delete stay on row with real operations |
| `app/src/shared/state-mutations.ts` | Ordinary `toggle_step` changes only steps; callers merge lock fields before whole-object setter; explicit note/selection erasure clears addressed locks; existing sequence-copy payload semantics retained |
| `app/src/audio/scheduler.ts`, instrument/envelope capability sources, `index.css` and contour source | Scheduler/tie/polymeter/playhead and capability rules stay authoritative; fixed relative effective-lock contour and existing orange/category/mono tokens, with planned blue focus/contrast tokens |
| Aligned interactive dock mock | Functional row actions, name keyboard activation and Notes-toolbar loop inputs/Clear32 desktop/44 mobile; status16 bar.beat timeline plus hidden live context/cursor title; initial Fit deferred to first Notes, resize refit using new B, and Step pitch reveal retaining H. Fractional explicit/ghost Fit reaches36, automatic initial/switch Fit caps18. Key labels and muted controls retain contrast. Disabled Instrument/Steps/FM/envelope integration previews remain honest; Track Audition/Rename are working prototype actions. |

The interactive dock mock's small synth, drum audition and volume modeling remain deliberate previews; future production work retains existing audio/mutation semantics and validates real scheduler, capability and read-only integration. The prototype includes immediate name keyboard activation; mobile44 Loop start/end/Clear in the Notes toolbar; the status-strip timeline and hidden live context; deferred first-Notes Fit, resize refit and selected-pitch reveal; readable key labels and undimmed muted-row controls. Protected final-step access under sticky-right actions remains a production rollout acceptance target. Prototype CSS and interaction mode share the JS root data-display-mode and reused app thresholds recorded above. No additional loop surface, timeline body height or desktop Step body selector is required.

## References

- Ableton Live manual, Clip View and Editing MIDI notes
- Bitwig user guide, Arrange view and tracks; Inspector panel
- FL Studio manual, Channel Rack
- Reaper MIDI editor guide (inline and floating editor)
- Maschine software manual, basic concepts (Group view and Keyboard view)
- Hydrogen manual, Piano Roll Editor
- `docs/LESSONS-LEARNED.md` lessons 61 and 62
- `specs/LOOP-RULER-LESSONS.md` and `specs/AFFORDANCES.md` on the PR #61 branch
