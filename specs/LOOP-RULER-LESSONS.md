# LoopRuler Postmortem & the Loop Pages Redesign

> **Status:** Postmortem + design proposal
> **Created:** July 2026
> **Subject:** Phase 31G loop selection (`LoopRuler.tsx`) — a good idea (loop a chunk of steps, synced for everyone) delivered through the wrong control surface.
> **Mocks:** [mocks/loop-pages-capture.html](./mocks/loop-pages-capture.html) — desktop, mobile portrait, mobile landscape.
> **Companions:** [EVOLUTION-ROADMAP.md](./EVOLUTION-ROADMAP.md), [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md)

The engine half of 31G is genuinely good: `loopRegion {start, end}` lives in `SessionState`, syncs through the Durable Object, and both schedulers honor it (`advanceStep()` wraps the global counter). The UI half failed. This document is the evidence, the root cause, the transferable lessons, and the replacement design.

---

## 1. What failed, with evidence

### 1.1 The geometry is dishonest (root failure)

The ruler is a **full-width strip above the grid, mapping steps proportionally** (`left: (step / totalSteps) * 100%`). The grid below it is **per-track horizontally scrollable** (`.steps { overflow-x: auto }` in `TrackRow.css`) with **fixed-width cells** and a fixed-width control column. Consequences:

- The ruler's position for step N never aligns with step N's cell in *any* track — and with per-track scrolling there is no single scroll offset it *could* align with.
- It is positioned like a column header (implying 1:1 alignment) but scaled like an overview (proportional). It is neither. Users read it as a header and find it "misaligned"; read as an overview it shows no content — just tick marks over an empty strip.
- Its scale is `longestTrackStepCount`, so **adding or deleting a track rescales the ruler**: the same pixel now means a different step, while the stored region stays put.

**Lesson:** there are exactly two honest surfaces for range controls — (a) *in-grid* elements that share the grid's scroll context and cell geometry, or (b) *content-bearing overviews* (a mini-map showing actual pattern data) where proportional mapping is legible because you can see what you're selecting. A content-free proportional strip positioned as a header is a proxy pretending to be the thing — the exact anti-pattern UI-PHILOSOPHY's "controls live where they act" exists to prevent.

### 1.2 It's authored in the app's only invisible coordinate space

The region is stored in **global step space** (0–127) — the one abstraction users never directly see. Every visible surface is per-track (`trackStep = globalStep % stepCount`). So for any polyrhythmic session — the product's headline strength — "loop steps 16–47" means something different for every track: a 16-step kick cycles twice, a 12-step triplet track gets phase-truncated with a jump at the wrap. None of this is communicated; the ruler implies you're looping "these steps" when you're actually looping *a window of global time*.

**Lesson:** controls must be authored in units users can see. Keyboardia already has one: the **page** (16 steps — the grid draws separators every 16, and the ruler itself labeled pages). Loop in pages, and the polyrhythm story becomes tellable: "loop pages 2–3" + a per-track cycle count.

### 1.3 The semantics were never pinned down — and tests enshrined the dead variant

Three definitions of "inside the loop" coexist:

| Site | Semantics | Status |
|------|-----------|--------|
| `timing-calculations.ts` `advanceStep()` | end-**inclusive** (plays `end`, then wraps) | live — drives playback |
| `TrackRow.tsx:678` dimming | end-**inclusive** (`index > loopRegion.end` = out) | live — but see 1.4 |
| `timing-calculations.ts` `isStepInLoop()` | end-**exclusive** (`step < end`) | **dead code — zero callers** |

`isStepInLoop` is exercised only by its own property tests (`timing-calculations.property.test.ts:293`), which faithfully verify the exclusive bound — i.e., the suite **proves the internal consistency of a function nobody calls, whose semantics contradict the functions everybody calls.** Property testing gave false confidence: coverage of the spec, not of the product.

**Lesson:** one membership function in `shared/`, consumed by scheduler, UI, and worker alike; property-test *the used path*; delete dead helpers on sight. (Preferably store `{startPage, lengthPages}` so exclusive/inclusive can't even be asked.)

### 1.4 The visualization lies about the audio

`TrackRow.tsx:678` dims steps via `index < loopRegion.start || index > loopRegion.end` — comparing a **track-local** index against the **global** region. For a 16-step kick under a loop at global 16–47, every kick step satisfies `index < 16`, so the whole track renders dimmed ("not playing") while it audibly plays throughout the loop. The busier your polyrhythms, the more the UI gaslights you.

**Lesson:** *never let visuals contradict audio.* Correct rule: a track step is out-of-loop **iff none of its global occurrences fall inside the region** (`∄ k: step + k·stepCount ∈ [start, end]`). For short tracks that's usually "nothing dims" — so say something true instead: a **cycle badge** (↻2 = "plays twice per loop").

### 1.5 The interaction grammar violates the house rules

Scored against UI-PHILOSOPHY's own test:

| Behavior | Violation |
|----------|-----------|
| Create = drag only; a click (< `MIN_LOOP_LENGTH`) is **silently discarded** | "Visual feedback is immediate" — an action with zero response |
| Adjust = impossible; brackets are `pointer-events: none` — re-drag from scratch | Direct manipulation — the region *looks* like an object but isn't grabbable |
| Clear = **double-click** | No touch analog; undiscoverable; nothing hints it |
| Shift+click two-point mode with a 2px pulsing pending marker, Escape to cancel | "Modes are visible, not hidden" — an invisible mode; and Shift already means p-lock/extend-selection one row below |
| Published sessions: `onSetLoopRegion={isPublished ? () => {} : …}` (`StepSequencer.tsx:637`) | A live-looking control wired to a no-op — silent failure |
| `role="slider"` + aria values, **no keyboard handling** | Fake affordance for assistive tech |
| No `touch-action` in `LoopRuler.css` | On touch, the drag fights page scroll — the primary mobile gesture is broken |

### 1.6 It shipped without an adoption story

Landed dark behind `features.loopRuler`, enabled later by a one-line commit (`b7da04d`). The only E2E coverage asserts the *flag shows/hides the component* (`e2e/feature-flags.spec.ts`) — nothing exercises looping itself. No usage instrumentation, no discoverability affordance (a bare 24px strip with a `crosshair` cursor). A feature can be "done" by flag and still have never once succeeded in a user's hands.

**Lesson:** a feature ships when it has a *first-touch path* (visible affordance, self-labeling states), *telemetry* (the wide-event system exists — use it), and *tests of the behavior*, not of the flag.

---

## 2. Root cause, in one paragraph

The LoopRuler failed because it was built as a **proxy control in a hidden coordinate space**: a content-free strip that pretends to be a grid header but can't align with a per-track-scrolling grid, authoring a region in global step space whose musical meaning varies per track, with membership semantics defined three ways (one of them dead but property-tested), rendered through a visualization that contradicts the audio, operated by a desktop-pointer-only grammar that violates the project's own interaction principles, and shipped behind a flag with no adoption path. Every individual bug traces back to the first sentence of UI-PHILOSOPHY: *controls live where they act* — the loop control lived nowhere.

---

## 3. The redesign: Loop Pages & Capture

Keep the engine; replace the surface. Full visuals in [mocks/loop-pages-capture.html](./mocks/loop-pages-capture.html).

### 3.1 Page chips — the semantic control (all viewports)

A row of chips, one per 16-step page of the longest track: `[1][2][3][4]`.

- **Tap a chip** → loop that page. **Tap another** → extend the range. **Tap the last active chip** → clear. Every state is visible as pressed chips; there are no pending modes, no drag requirement, no double-click, no Shift grammar.
- Chips are **buttons**: 44–48px targets, keyboard (`1`–`8` loop a page, `Shift+←/→` grow/shrink, `0` clear), correct ARIA for free.
- Because chips are *semantic* (labeled units) rather than *geometric* (positions), the alignment problem from §1.1 ceases to exist — nothing needs to line up with cells.
- **Portrait bonus:** tapping a chip also scrolls all tracks to that page — the loop control doubles as page navigation, earning its space in the consumption-first layout.
- **Published sessions:** chips render with a lock glyph; tapping toasts "Published — Remix to edit." Never a dead handler.

### 3.2 Mini-map handles — the fine-grained control (pointer only)

The mini-map (already planned in EVOLUTION-ROADMAP Arc 4) is the honest proportional surface: its rows show real track content, so a highlighted span is legible. The loop region renders there with **actual drag handles** (`⟨ ⟩`, snapping to beats) for sub-page trims. Handles appear only for pointer input; touch keeps chip granularity — no targets touch can't hit. In landscape the mini-map is display-only (span + playhead).

### 3.3 Truthful per-track rendering

- Tracks whose cycle repeats inside the loop get a **cycle badge** (↻2), never dimming (§1.4 rule).
- Only tracks long enough for page geometry to be real (stepCount > loop span) dim their out-of-loop pages.
- All rendering derives from one shared `loopMembership()` helper that replaces `isStepInLoop()`; the scheduler's wrap and the UI's dimming are property-tested **against each other** (same function, one truth).

### 3.4 Capture — the payoff

While a loop is active, a **Capture → Pattern B** button appears (structure strip on desktop, bottom bar in portrait, `⧉ B` chip in landscape). One tap prints *what you're hearing* — each track's audible sequence across the loop window, polyrhythm interference flattened into editable steps — as a new pattern. This is the bridge from today's loop region to the pattern/song-mode arc, and it turns polyrhythm printing into a creative tool no groovebox offers.

### 3.5 Performance loop (Arc 3 tie-in)

Hold `L` (desktop) or long-press a chip (landscape) for a **momentary loop** that releases on key-up — the pattern-level stutter, quantized like every performance action.

### 3.6 Sync & migration

- Same `loopRegion` state and messages; authoring is constrained to page/beat boundaries, but the engine keeps honoring arbitrary legacy regions (chips show nearest-page state; handles show exact bounds).
- `capture_loop` becomes a standard synced mutation through the handler factory; chip changes flash the acting player's color like every other attributed edit.
- Instrumented from day one: `loop_set`, `loop_clear`, `loop_capture` wide events.

---

## 4. How these lessons constrain the wider evolution plan

| Planned feature (EVOLUTION-ROADMAP) | Constraint inherited from this postmortem |
|--------------------------------------|--------------------------------------------|
| **Pattern mini-map** (Arc 4) | Must be content-bearing from v1 (it's the "honest overview" this design leans on); never interactive at sizes touch can't hit. |
| **Pattern chips / song chain** (Arc 5) | Same semantic-chip grammar as loop pages — tap to queue, pressed = state, labels not positions. One switching-boundary definition in `shared/`, property-tested where used. |
| **Audio-reactive glow** | Governed by §1.4: visuals may only *amplify* what plays, never contradict it. |
| **Step components / probability** | Per-step badges must render in track-local space; any "will it play?" indicator derives from the scheduler's own functions, not a parallel implementation. |
| **All new features** | Ship = affordance + telemetry + behavior tests. A feature flag is a rollout tool, not a definition of done. |
