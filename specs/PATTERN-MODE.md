# Pattern Mode: How Patterns and Chaining Change the Rules

> **Status:** Design proposal (v2 — supersedes the "Loop Pages & Capture" redesign in [LOOP-RULER-LESSONS.md](./LOOP-RULER-LESSONS.md) §3)
> **Created:** July 2026
> **Mocks:** [mocks/loop-pages-capture.html](./mocks/loop-pages-capture.html) (v2 — desktop, mobile portrait, mobile landscape)
> **Companions:** [EVOLUTION-ROADMAP.md](./EVOLUTION-ROADMAP.md) (Arc 5), [LOOP-RULER-LESSONS.md](./LOOP-RULER-LESSONS.md) (§1–2 lessons remain binding), [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md)

The first redesign after the LoopRuler postmortem ("Loop Pages & Capture") fixed the ruler *within the single-grid world* and treated patterns as a destination to bridge toward. That was backwards. **Adopting patterns and pattern chaining is not an additive feature — it changes the axioms.** Structure tools designed for one long grid (loop regions, page chips, mini-maps, capture bridges) don't need porting into the pattern world; most of them dissolve. This document states the new rules, the design that follows from them, and what happens to every artifact of the old world.

The postmortem's *lessons* (honest geometry, one membership truth, tap-first grammar, visuals never contradict audio, ship with adoption) all survive. The *surfaces* they produce under the new axioms are different.

---

## 1. The rule changes

### Rule 1 — Loop is a mode, not a region

In the single-grid world, "looping a chunk" required a stored `loopRegion {start, end}` bracketing steps of a mega-grid. In the pattern world, a groovebox is *always looping something*; the only question is **what is cycling right now**:

| Loop granularity | Pattern-world form | Lifetime |
|---|---|---|
| "Loop this groove" | **⟳ Pattern mode** — the playing pattern cycles (the default state; looping without a loop feature) | mode |
| "Loop this section while I arrange" | **Chain brace** — a range of chain entries cycles | stored, synced |
| "Stutter, live" | **Momentary bar-loop** — held gesture, releases on key-up | ephemeral |

The stored step-range loop — the thing the LoopRuler tried to author — has no place in this table. `loopRegion` is retired from authoring (see §5 for legacy handling).

### Rule 2 — Patterns replace pages

Pages (16-step segments of a long grid) were a *coping mechanism*: the only way to express song structure inside one grid was to make the grid long and navigate it. With patterns, structure lives in **short patterns seen whole** (default 16–32 steps, `length ≤ 128`), and the v1 design's page chips become a second, competing segmentation system. They are deleted. Consequences:

- The long-pattern navigation pains (mini-map, page scrolling, "pain #14") mostly **dissolve rather than get solved** — a pattern that fits on screen needs no overview.
- Long patterns remain *possible* (a 128-step evolving pad is legitimate) but stop being the idiom for songs.

### Rule 3 — View ≠ playback

With one grid, what you saw was what played. With patterns, the grid shows the **viewed** pattern; sound follows the **playing** one. This is the single biggest UX rule change, and it's a feature — editing B silently while everyone hears A is the pattern-world superpower. Rules that follow:

- **Playheads render only where sound is.** A playhead sweeping a non-sounding grid is exactly the "visuals contradict audio" lie from the postmortem (§1.4). When view ≠ play, live progress renders on the *playing pattern chip* (progress bar) and a status pill ("Hearing **A** · rep 2/2 → next: **B**"), never as a ghost playhead.
- **Presence gains a pattern dimension.** Each player's avatar dot attaches to the chip of the pattern they're viewing; cursors render only for players viewing *your* pattern; step-edit attribution flashes stay within a pattern. Pattern-level events (someone queues C) flash the chip in the actor's color.
- **Mobile portrait opts out:** view follows sound (the grid always shows the playing pattern), so the split never demands a second surface on a phone. Landscape and desktop default view = play until you deliberately view elsewhere.

### Rule 4 — The chain is the timeline

Arrangement is an ordered list of `{patternId, repeats}` chips — never a horizontal clip timeline (the DAW fence from EVOLUTION-ROADMAP §3.1 holds). The chain strip **replaces the mini-map** as the structure surface, and it inherits the postmortem's honest-overview requirement: entries are content-bearing thumbnails (the grid-thumbnail language from DESIGN-LANGUAGE.md), not abstract blocks. The loop brace lives here — wrapping chain *entries*, which is what "loop pages 2–3" was always trying to say.

### Rule 5 — One boundary object rules them all

The single-grid world's boundary was the global 0–127 counter. The pattern world's boundary is **`pattern.length`**: queues land on it, the chain advances on it, braces wrap on it, momentary loops release into it, and per-track polyrhythms cycle within it (`stepCount` against `pattern.length`, surfaced as ↻n cycle badges — unchanged from v1). Per the postmortem's single-source-of-truth lesson: one shared `patternBoundary()` helper in `shared/`, consumed by scheduler, UI, and worker, property-tested on the used path.

---

## 2. Data model

```ts
interface SessionState {
  tracks: TrackVoice[];        // the KIT: instrument, volume, transpose, fmParams, swing — shared across patterns
  patterns: Pattern[];         // ≤ 8 (A–H). Constraint as luxury.
  chain: ChainEntry[];         // the arrangement
  playMode: 'pattern' | 'chain';
  chainLoop: { from: number; to: number } | null;  // the brace, in chain-entry indices
  tempo; swing; effects?; scale?; version;
  loopRegion?: ... // DEPRECATED: honored read-only for legacy sessions (§5)
}

interface Pattern {
  id: string;                  // display letter derived from position
  name?: string;
  length: number;              // steps; default 16; the boundary object (Rule 5)
  trackData: TrackPattern[];   // parallel to tracks[]
}

interface TrackPattern {
  steps: boolean[];
  parameterLocks: (ParameterLock | null)[];
  stepCount: number;           // per-track polyrhythm, cycles within pattern.length
}

interface ChainEntry { patternId: string; repeats: number; }
```

**The kit is shared** (Elektron/Circuit model): instruments, levels, and transpose stay stable across patterns, so the mixer never jumps under a collaborator at a pattern switch, memory stays small, and `TrackVoice` edits remain ordinary session-level mutations. Changing instruments per-pattern is explicitly out of scope for v1.

**Playback position** becomes `(chainIndex, repeat, step)` — in ⟳ pattern mode, `chainIndex` is pinned. All existing per-step scheduling (swing, p-locks, ties, polyrhythm mod) is untouched *within* a pattern.

---

## 3. Surfaces and grammar

Full visuals in [mocks/loop-pages-capture.html](./mocks/loop-pages-capture.html).

### 3.1 Pattern strip (desktop / landscape)

Chips `A B C … +`, one per pattern, following the split-zone precedent of the FX button (Phase 23):

- **Label zone = view** (grid switches to it for editing; sound unaffected).
- **▸ zone = queue** (plays at the next pattern boundary).
- States, all simultaneously visible: **playing** = orange dot + progress bar under the chip; **viewed** = white ring; **queued** = blue pulse (reduced-motion: static glow). Avatar dots ride the chips of patterns other players are viewing.
- Keyboard: `1–8` view, `Shift+1–8` queue, `P` toggles ⟳/⛓, `D` duplicate.

### 3.2 Play-mode toggle

An explicit two-state control, `⟳ PATTERN | ⛓ CHAIN` — mode is visible, never inferred (postmortem §1.5). ⟳ is the default for new sessions and for landscape.

### 3.3 Chain strip (desktop; display-only on touch)

Content-bearing entry thumbnails with `×N` repeat badges, drag-grips for reorder, `+` to append, playing entry highlighted with live rep count. The **brace** (blue, with ⟨ ⟩ handles, pointer-only) selects the looping range in ⛓ mode. Portrait replaces the strip with a countdown pill ("C next · in 6 steps") — quantization made legible.

### 3.4 Refactor verbs (Capture, inverted)

v1's "Capture" treated the long grid as primary and patterns as output. Inverted:

- **⧉ Duplicate** — copy the viewed pattern to the next slot: the variation workflow (dup → tweak → queue).
- **✂ Split** — explode a long pattern into page-length patterns plus a chain that preserves the original playback (`A(64) → A B C D, chain A B C D`). Lossless and invertible: **flatten(chain) ⇄ split(pattern)** are two views of the same music. This is also the migration path for every existing long-grid session — your 128-step epic *is already a song*; Split shows it as one.

### 3.5 Momentary loop (performance)

Hold `L` (desktop) or long-press the playing chip (landscape) to cycle the current bar; release resumes. Step-level looping survives *only* as this ephemeral gesture.

### 3.6 Published sessions

Queueing and mode-switching remain available (listening choices, not edits — consistent with local-only mute/solo precedent to be decided; if treated as edits, they lock too). Structure edits (new pattern, chain edits, split/duplicate) are locked with the "Published — Remix to edit" toast. Never a dead handler.

---

## 4. Multiplayer semantics

- Pattern/chain/brace/queue/mode changes are standard synced mutations through the handler factory, attributed and flashed like every other edit. Queue landings are computed server-side against `patternBoundary()` so all clients switch on the same step.
- **Viewed pattern is per-player local state** (like step selection), broadcast as presence (`viewing: patternId`) — it must never gate what others hear.
- Concurrent edits to different patterns don't conflict by construction (disjoint state). Two players editing the same pattern behave exactly like today's single grid.
- Snapshot/state-hash formats gain patterns + chain; the Phase 26 mutation-tracking machinery applies unchanged.

## 5. Migration

- Existing sessions load as `patterns: [A]` where A wraps the current tracks' note data (`length` = longest `stepCount`), `chain: [A×1]`, `playMode: 'pattern'`. UI is indistinguishable from today until the user adds a pattern — progressive disclosure holds.
- A stored legacy `loopRegion` keeps playing exactly as before (engine honors it in pattern A) but has no authoring UI; the status row offers **✂ Split** which converts region + pages into patterns and retires the field. Telemetry (`legacy_loop_played`, `legacy_loop_split`) tells us when the deprecation is safe to complete.
- Text notation (SESSION-NOTATION / Phase 37) gains pattern blocks and a chain line — one more reason clipboard serializers should be pattern-shaped from day one.

## 6. What this supersedes

| v1 artifact (Loop Pages & Capture) | Fate under pattern rules |
|---|---|
| Page chips as loop control | **Deleted** — patterns are the pages; two segmentation systems can't share a strip |
| Stored step-range `loopRegion` | **Retired from authoring** — replaced by ⟳ mode, chain brace, momentary hold (Rule 1) |
| Mini-map with loop handles | **Becomes the chain strip** — proportional overview of *time* (entries), not *space* (steps); within-pattern minimaps unnecessary for patterns seen whole |
| Capture → Pattern B | **Inverted** into ⧉ Duplicate (variation) + ✂ Split (migration); composing starts in patterns |
| Cycle badges (↻n) | **Kept** — now relative to `pattern.length` |
| Truthful-rendering, single-truth, tap-first, published-lock, telemetry rules | **Kept** — they are postmortem lessons, not surfaces |

## 7. Build order note

Rule 3 (view/playback split) is the riskiest piece — it touches presence, playhead rendering, and edit targeting. Mobile portrait's "view follows sound" and landscape's default view = play mean the split only ever *appears* on desktop when a user deliberately views elsewhere, which keeps the first release honest: ship patterns + ⟳/queue + duplicate first (no split visible anywhere), then chain + brace, then split-view affordances, then ✂ Split for legacy sessions.
