# Affordance Vocabulary: Inventory, Gaps, and Consolidation

> **Status:** Audit + proposal
> **Created:** July 2026
> **Method:** full component survey of `app/src/components/` (evidence cited as file:line in the inventory notes), plus KEYBOARD-SHORTCUTS.md and HIDDEN-UI-FEATURES.md
> **Companions:** [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md), [PATTERN-MODE.md](./PATTERN-MODE.md), [EVOLUTION-ROADMAP.md](./EVOLUTION-ROADMAP.md)

**The problem:** UI complexity grows when each feature invents its own control. Today the app has ~43 distinct interaction affordances, including **9 different mechanisms for "reveal more controls," 3 dropdown implementations, 6 slider paradigms, and 10–13 controls on a single desktop track row** — plus two transport UIs and two effects UIs mounted simultaneously (desktop `Transport` + mobile `TransportBar`; `Transport`'s FX panel + mobile-only `EffectsPanel`). Every arc of the roadmap will make this worse unless the vocabulary is fixed.

**The principle:** complexity is constrained by a small, closed set of affordances that *absorb* new features. The OP-Z (UI-PHILOSOPHY's model) runs its entire depth on essentially two gestures: press = act, hold/SHIFT = disclose. New features must land on existing affordances; an affordance joins the vocabulary only if ≥3 features will use it.

**The layout law:** the project follows Robin Williams' **CRAP** principles — Contrast, Repetition, Alignment, Proximity. For the sequencer grid, Alignment carries semantics, not just tidiness:

- **Column integrity.** A step *column* is the complete description of one sound event — its trigger, pitch, volume, tie, and any lane value beneath it. A *row* is one instrument's timeline. Every per-step surface — cells, badges, playhead, property lanes — therefore shares **one column grid**: identical cell widths, gaps, left offset, and page separators. A lane whose bars drift from the cells above is not a styling bug; it severs the column relationship and misstates the data model. Implementation rule: lanes render as additional rows *inside* the same grid template as the cells — never as free-floating siblings with their own margins.
- **Control-column integrity.** Track-control areas use a rigid column template (grip · name · M · S · lane · key · …) so every control aligns vertically with its counterpart on every other row (Repetition). Variable-width controls and optional badges get fixed slots, present or empty — content may vary; geometry may not.

---

## 1. Current inventory (what we use today)

### 1.1 Pointer gestures (11)

| # | Gesture | Where | Problem |
|---|---------|-------|---------|
| 1 | Tap/click = act | steps (on *pointerdown*), chromatic/piano cells (on *click*), all buttons, portrait tap-anywhere-plays | Two different trigger timings for "toggle a cell" |
| 2 | Shift+click | StepCell: extend selection *or* open p-lock editor (context-dependent); LoopRuler: set loop endpoints | **Three meanings.** KEYBOARD-SHORTCUTS.md claims it universally means "open detail editor" — violated |
| 3 | Ctrl/Cmd+click | StepCell multi-select toggle | Desktop-only; no touch equivalent |
| 4 | Double-click | TrackNameEditor rename; LoopRuler clear | Two unrelated meanings; touch-hostile |
| 5 | Long-press (400ms) | StepCell → p-lock editor | The only touch disclose; not applied to any other noun |
| 6 | Drag-to-paint | step grid (flag-gated) | Deliberately avoids pointer capture (bug-pattern lesson) |
| 7 | Drag-to-adjust | VelocityLane bars (vertical draw), TransportBar tempo/swing ("TE knob" number drag), XYPad (2D), Waveform slice markers, LoopRuler range | Five separate drag dialects, four using pointer capture |
| 8 | HTML5 drag-reorder | track grip `⠿` | Only native-DnD use |
| 9 | Hover | SamplePicker sound preview; Waveform marker highlight; `title` tooltips everywhere | Preview has **no touch path at all** |
| 10 | Scroll / scroll-snap | step grids (x, snap), PianoRoll (y, auto-center) | Fine |
| 11 | Copy "mode" | CPY → sources/targets, Escape cancels | The app's one modal mode; visible + escapable (acceptable) |

### 1.2 Control types (~17)

Momentary button · toggle button (M/S/FX/lock/tie/bypass/expanders) · stepper (−/+) · segmented tabs (Events/All, Grid/PianoRoll) · **portal dropdown** (StepCount, Transpose via `useDropdownMenu`) · **native `<select>`** (scale ×2, delay-time ×2, XY preset, mobile step-count) · **ad-hoc div dropdown** (App "Invite ▾") · horizontal range slider (≈8 panels) · vertical fader + fill overlay (Mixer) · drag-number `role=slider` div (TransportBar) · velocity draw-lane · XY pad · loop ruler · inline-editable text (SessionName, track name) · hold-to-record button · carousel/page-dots · chip/badge (counts, statuses).

Notable duplicates: **transpose** is a dropdown on desktop and a stepper in mobile/landscape drawers; **step count** is a portal dropdown on desktop and a native `<select>` in drawers — same values, two implementations each.

### 1.3 "Reveal more controls" mechanisms (9)

1. Inline expand-panels pushing content (Transport FX/Mixer/Pitch; per-track ⚙ pattern-tools, ▎ velocity, ♪ pitch-view — six independent expanders)
2. Mobile "▼ tap to edit" → InlineDrawer
3. Landscape tap-name → TrackDrawer accordion (one-at-a-time)
4. Selection → floating ParameterLockEditor (click-outside dismiss)
5. SamplePicker category accordion (mobile only)
6. Portal dropdown menus
7. Native `<select>` popups
8. Ad-hoc Invite dropdown
9. Overlays (QR 3-layout responsive; Shortcuts modal w/ focus trap)

Four different mental models exist for "more track controls" alone (desktop expanders, mobile drawer, landscape accordion, floating editor).

### 1.4 Feedback affordances (~10)

Cell badges (tie ⌒ / pitch ↑↓ / volume ± / velocity fill) · playing indicator + playhead outline · remote-change color flash (`--flash-color`) · beat-pulse on play · status badges/pills (FX ●/⊗, +N, counts, out-of-scale) · toasts (join/leave/error/URL-copy) · native `title` tooltips (no custom tooltip component exists) · transient text states ("...", "Copied!", "✓") · VU meters / connection dot / remote cursors · dimmed-disabled states.

### 1.5 Keyboard (5 wired, 4 dead)

Wired: Space (play), Escape (cascading dismiss — the one *excellent* consolidation already in place), Delete (clear selection), `?` (shortcuts panel, desktop), Cmd/Ctrl+Shift+M (unmute all). Defined in `useKeyboard` but **unwired**: arrows, Enter, M, S. No grid focus-navigation.

### 1.6 Platform asymmetries

Desktop-only with no touch equivalent: hover-preview, Ctrl+click select, extend-selection, all shortcuts, remote-cursor broadcast. Touch-only: long-press p-lock, drag-knob transport, tap-anywhere-play, Web Share. **No haptics anywhere.** Pointer capture used by 5 controls; banned (correctly) in the step grid.

---

## 2. New affordances that constrain complexity

Six "absorbers." Each earns its place by carrying multiple current *and* roadmap features, so future arcs add **nouns, not controls**.

### N1. Chip row — "one of N; tap to make current; current glows; tapped-while-playing cues"
One component for every mutually-exclusive set: **pattern slots** (PATTERN-MODE v4), the **PATTERN|SONG scope**, sample-picker categories, ChromaticGrid's Events/All, Grid/PianoRoll tabs (absorbs "segmented control" entirely). States: current (orange), cued (blue blink + NEXT), ghost (+), locked (published).

### N2. Order list — rows with grip, thumbnail, per-row stepper
The song editor (v4), and the single standard for any future ordered list. Standard mechanics: drag-grip reorder, tap-stepper, swipe/Delete to remove.

### N3. Property lane — one lane per track, rendered in the step column grid
Generalize VelocityLane: a per-track lane that edits a selected per-step property — **velocity today**; if any future per-step property is ever proposed (through the gate), this lane is its mandated home, so no per-property expander can multiply. **Column integrity is constitutive:** the lane's bars render inside the same column grid as the step cells — identical widths, gaps, offset, and page separators — because each bar is part of its column, i.e. one more property of that one sound event. A lane that doesn't align with the cells above it misstates the model (the layout law, above).

### N4. Universal disclose — Shift+click ≡ long-press, on any noun
One rule, restoring what KEYBOARD-SHORTCUTS.md already claims: *disclose the editor for the thing you pressed*. Step → p-lock editor (exists); track (name/row) → track inspector (replaces InlineDrawer, TrackDrawer, and the CLR/CPY/DEL/transpose/step-count sprawl); pattern slot → pattern ops (name/duplicate/delete); session name → rename. Renders as the floating inline editor on desktop (ParameterLockEditor pattern), bottom sheet on mobile (the BottomSheet Phase 38 owes us anyway). Selection-extend moves off Shift+click (see C-9) so the gesture has exactly one meaning.

### N5. Pending countdown — the quantized-change affordance
Blink + "…in N steps" pill for *anything* that lands on a boundary: pattern cue (v4), song-row edits while playing, future seeded-probability reseeds. One visual grammar for "this will happen at the loop edge," already designed in the v4 mocks — promote it from pattern-specific to universal.

### N6. Haptic tick + audio tick
One rule on touch: every state-changing tap gives a 10ms `navigator.vibrate` (currently zero haptics); optional engine-rendered click for chip taps. Not a complexity absorber per se, but a single feel-rule that replaces per-feature feedback decisions (and it's the TE tactility principle from the roadmap, made cheap).

Also promote to standard (already exists, apply everywhere): **attribution flash** — any new synced verb (slot switch, song edit, scale change) flashes the actor's color on the control it changed; never invent new presence UI per feature.

---

## 3. Consolidation opportunities

Ordered by leverage. Target: master list from ~43 → **~28**; disclosure 9 → **3**; dropdowns 3 → **1**; sliders 6 → **4**; TrackRow visible controls 13 → **6**.

| # | Consolidation | What merges | Net effect |
|---|---------------|-------------|-----------|
| C-1 | **One disclose system** (N4) | InlineDrawer + TrackDrawer + "tap to edit" + ParameterLockEditor + future pattern ops → one inspector (floating on desktop, sheet on mobile) | 4 mechanisms → 1; kills the four mental models for "more track controls" |
| C-2 | **One dropdown** | Portal `useDropdownMenu` component absorbs native `<select>`s (scale, delay-time, XY preset, drawer step-count) and the ad-hoc Invite div | 3 implementations → 1; step-count no longer has two codepaths |
| C-3 | **One transport, one FX panel** | `Transport` + `TransportBar` → one responsive transport; mobile `EffectsPanel` + Transport FX panel → one responsive FX panel | Two duplicate UIs deleted; every future transport feature lands once, not twice |
| C-4 | **TrackRow diet** | Keep: grip, name, M, S, lane toggle (N3), key badge. Move to disclose (N4): transpose, step count, copy/clear/delete, pattern tools ⚙; ♪/▎ expanders become the lane property chip-row | 13 controls → 6 visible; per-track expanders 3 → 1 |
| C-5 | **Slider paradigms 6 → 4** | Standard: (a) RangeSlider (h/v orientations — Mixer fader becomes vertical variant), (b) **DragLCD** (TransportBar's drag-number becomes *the* numeric control: drag to adjust, tap to type — BPM, swing, transpose stepper merges here), (c) PropertyLane (N3), (d) XYPad. LoopRuler's ruler-drag dies with v4 | Every continuous value uses one of four; transpose dropdown-vs-stepper duplication resolved into DragLCD |
| C-6 | **Segmented controls → chip row (N1)** | Events/All, Grid/PianoRoll, PATTERN\|SONG, sample categories | One component, one look, one keyboard model |
| C-7 | **One overlay system** | QROverlay + KeyboardShortcutsPanel share one modal/sheet primitive (focus trap, Escape, backdrop, restore) — build the Phase 38 BottomSheet as its mobile mode | 2 bespoke overlays → 1 primitive that Phase 38's action sheets also reuse |
| C-8 | **Gesture meanings, one each** | Shift+click = disclose only (N4). Double-click = rename only (LoopRuler's clear dies with v4). Ctrl/Cmd+click = select toggle; **Ctrl/Cmd+drag = rubber-band extend** (replaces Shift+click extend, freeing the gesture and finally matching the documented spec) | Every modifier has exactly one meaning; the spec becomes true |
| C-9 | **Pending states unified** (N5) | "..." saving, "Copied!", record countdown, cue blink → one pending-pill grammar (icon + short label + optional countdown) | One way to say "in progress / landing soon" |
| C-10 | **Keyboard mirrors affordances** | Wire the dead arrows/Enter/M/S per KEYBOARD-SHORTCUTS Phase 3; add `1–8` = slots, `P` = scope — rule: every chip row gets number keys, every toggle gets its letter | Keyboard stops being a separate design space |
| C-11 | **Pointer-capture rule** | Capture allowed only inside self-contained controls (XYPad, lanes, DragLCD, Waveform); never on grid cells or multi-element surfaces | Codifies the drag-to-paint bug-pattern lesson as a vocabulary rule |

### The resulting grammar (what a user has to learn)

| Gesture | Meaning — everywhere |
|---|---|
| Tap | Act: toggle, choose, make current (cue if playing) |
| Drag | Adjust the thing under your finger (paint in grid, draw in lane, turn in LCD, move in pad) |
| Shift+click / long-press | Disclose the editor for this thing |
| Ctrl/Cmd+click (+drag) | Select (extend) |
| Escape / tap-outside | Dismiss, cancel, step out (already cascading — keep) |
| Number keys / letters | Mirror the chips and toggles on screen |

Plus four universal feedback rules: current = orange glow · pending = blue blink + countdown pill · remote = actor-color flash · disabled = dimmed, never hidden.

### The gate for future features

Before any new control ships, it must answer: **which existing affordance carries this?** If none does, it must justify joining the vocabulary (≥3 planned uses) or be redesigned. The LoopRuler is the standing example of what skipping this gate costs.
