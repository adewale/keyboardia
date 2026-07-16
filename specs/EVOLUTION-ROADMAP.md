# Keyboardia Evolution Roadmap

> **Status:** Proposal / Vision document
> **Created:** July 2026
> **Inputs:** Full audit of `specs/ROADMAP.md`, `specs/STATUS.md`, all research docs, GitHub issues, and the current codebase.
> **Companions:** [ROADMAP.md](./ROADMAP.md) (phase history), [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md) (design principles), [research/COMPOSITION-AFFORDANCES.md](./research/COMPOSITION-AFFORDANCES.md), [research/EMERGENCE.md](./research/EMERGENCE.md), [LOOP-RULER-LESSONS.md](./LOOP-RULER-LESSONS.md) (postmortem + Loop Pages/Capture design, with UI mocks)

This document answers three questions:

1. **What is already planned but not implemented?** (§2)
2. **What is available in the space between step sequencers and DAWs** — with heavy Teenage Engineering influence, and more delight and creativity? (§3)
3. **What are the biggest user pain points, and how does the future solve them?** (§4, §5)

It ends with a sequenced evolution plan (§5) that ties all three together.

---

## 1. Where Keyboardia Stands (July 2026)

Keyboardia is a mature, well-tested multiplayer step sequencer: 16 tracks × 3–128 steps with true polyrhythms, parameter locks (pitch/volume/tie), an inline chromatic grid with scale lock, ~70 sound generators plus 27 sampled instruments (recently rebuilt with a rigorous QA pipeline), a synced effects chain, pattern tools (Euclidean, rotate, invert, reverse, mirror), per-track swing, velocity lanes, MIDI export, publishing/remixing with lineage, QR sharing, and real-time multiplayer with presence, cursors, and attribution — all on Cloudflare Workers/DO with 5,000+ tests.

**The strategic position:** in hardware, the space between step sequencers and DAWs is the *groovebox* — Elektron Digitakt, Teenage Engineering OP-Z / EP-133 K.O. II, Novation Circuit Tracks, Polyend Play. On the web, that slot is essentially empty: web tools are either toys (Chrome Music Lab), lessons (Ableton Learning Music), DAW-clones (Soundtrap, BandLab), or code (Strudel). Keyboardia already stands in the groovebox slot with two properties no hardware box can ever have:

- **URL-native multiplayer** — "send a link, jam together in 10 seconds."
- **Remix lineage** — every session is forkable, with provenance.

Nobody else has "Google Docs for grooveboxes." The evolution plan below is about *deepening that identity*, not drifting toward being a DAW.

---

## 2. Planned But Not Implemented

A full inventory, verified against the current code (several specs are stale in both directions — see §2.6).

### 2.1 The six unstarted roadmap phases

| Phase | Name | What it is | Gated on |
|-------|------|------------|----------|
| 37 | **Rich Clipboard** | Dual-format clipboard (`keyboardia/track/v1` JSON + text pattern fallback). The text notation is fully specified in [SESSION-NOTATION.md](./SESSION-NOTATION.md) v2.0.0 but has **no parser/serializer in code** — `utils/clipboard.ts` is only an iOS text-copy helper. Rated ⭐ HIGH IMPACT in [EMERGENCE.md](./research/EMERGENCE.md) for community + AI collaboration. | — |
| 38 | **Mobile UI Polish** | Action sheets (Invite, QR, track options), swipe-to-delete, haptics. `useLongPress` exists; **`BottomSheet.tsx` is claimed ✅ in ROADMAP.md:3260 but does not exist** — the foundation still needs building. | — |
| 39 | **Auth & Ownership** | BetterAuth + D1: accounts, `ownerId`, claim-anonymous-session flow, collaborative vs read-only modes. | — (gates most of C/E below) |
| 40 | **Session Provenance** | Family-tree visualization of remix ancestry/descendants. Data (`remixedFrom`, `remixCount`) already exists. | Partially on 39 |
| 41 | **Public API** | Versioned `/api/v1`, API keys, scopes, rate tiers, OpenAPI docs. Enables Discord bots, CLI, LLM integrations. | Phase 39 |
| 42 | **Admin & Operations** | Admin dashboard, orphan-session cleanup cron (currently banner-only), quota alerts, error-tracker integration (`ErrorBoundary.tsx:44` TODO). | Phase 39 |

### 2.2 The composition backlog (from COMPOSITION-AFFORDANCES.md, still valid)

Ranked there by impact; all verified absent from code:

| # | Feature | Impact | Effort | Notes |
|---|---------|--------|--------|-------|
| 1 | **Undo/Redo** | Very High | Med-High | Zero history code exists. Multiplayer-aware (per-user stack). The single highest-rated missing feature in the repo's own research. |
| 2 | **Pattern chaining / song mode** | Very High | High | One pattern per session today; no arrangement of any kind. |
| 3 | **Step probability / conditional trigs** | High | Low | `ParameterLock.probability` + one scheduler branch. |
| 4 | **Quick fill / mutate / variation** | Med-High | Low-Med | sparse/dense/shift/reverse/humanize/mutate. |
| 5 | **Pattern overview / mini-map** | Medium | Low | 64–128-step patterns have no overview (PitchOverview is pitch contour, a different thing). |
| 6 | **Ratcheting / retrigger** | Medium | Medium | Sub-step repeats for rolls and fills. |
| 7 | **Arpeggiator** | Medium | Medium | |
| 8 | **Track groups / folders** | Low-Med | Medium | |

Already shipped from that doc's list (don't re-plan): Euclidean generator, step rotation, per-track swing, scale lock/Key Assistant.

### 2.3 The ecosystem backlog (from EMERGENCE.md research phases)

| Feature | Emergence type served | Status |
|---------|----------------------|--------|
| **Audio export (WAV/MP3/stems)** | Community, archival | Absent — no `OfflineAudioContext` render path outside tests. Also flagged in MIDI-EXPORT.md "Future". |
| **Text pattern language** | Community, AI, accessibility | Spec complete (SESSION-NOTATION.md), implementation absent (= Phase 37). |
| **MIDI import** | Learning, round-trip | Absent (`parseMidi` exists only in export-fidelity tests). |
| **JSON import/export (user-facing)** | Community, tooling | Absent. |
| **Embeddable `<iframe>` player** | Community | Absent. |
| **Visual grid export (PNG/SVG)** | Notation, social | Absent. |
| **Pattern library (curated/community)** | Community, learning | Absent. |
| **Session metadata (tags, description, detected key)** | Discovery | Name only; rest absent. |
| **Pattern analysis ("what key is this?", suggestions)** | Learning | Absent (some utilities exist in `music-theory.ts`). |

Also unimplemented and *unspecced*: **MIDI input** (Web MIDI hardware control — `docs/MIDI-MAPPINGS.md` is about DAW import of exports, not controllers).

### 2.4 OP-Z-inspired ideas already named in UI-PHILOSOPHY.md

These have lived in the philosophy doc since early on and remain unbuilt: **step components** (probability/ratchet/nudge), **punch-in effects** (hold-to-apply momentary FX), **track mute groups**, **pattern chaining**, **motion recording** (record knob/XY moves as automation). §3 argues these are the heart of the evolution.

### 2.5 Smaller planned items

- **Accessibility/UI:** focus-management system + keyboard grid navigation (the Phase 36 remainder), tooltips, inaudible-instrument warning (spec'd in STATUS.md with the sub-bass thresholds), dim unused beat markers, `prefers-reduced-motion`, global `:focus-visible`.
- **Mixer:** MixerPanel completion (multi-track faders); per-track metering UI (the AudioWorklet RMS/peak infra already exists off-thread).
- **Engine:** scheduler AudioWorklet rollout (implemented but behind `VITE_FEATURE_WORKLET_SCHEDULER`, default off); shared-LFO worklet was dropped pending real voice-modulation wiring.
- **Polyrhythm extras (deferred ideas):** swing-curve presets (MPC/SP-1200), polyrhythm preset library, snap-to-polyrhythm, loop-count displays, arbitrary step counts, per-track time signatures, irrational rhythms.
- **Deferred sample features:** per-track effects, round-robin samples.
- **Ops:** KV write batching, CSRF tokens.

### 2.6 Spec corrections (stale claims found during this audit)

Claimed *future* but actually **implemented**: Euclidean generator, step rotation, per-track swing (ROADMAP.md:326-327, POLYRHYTHM-SUPPORT.md), pattern-op server sync (SHARED-MUTATION-REFACTORING-PLAN.md:65), effects sync/persistence (MUSICAL-FOUNDATIONS-SUMMARY.md), EffectsPanel + synths-in-picker (SYNTHESIS-ENGINE.md:1444-1460), procedural percussion set (INSTRUMENT-EXPANSION.md), `clientSeq` delivery confirmation (MUTATION-TRACKING.md:38), rate limiting, WebSocket collaboration (SESSION-LIFECYCLE.md:117).

Claimed *done* but actually **missing**: `BottomSheet.tsx` (ROADMAP.md:3260).

---

## 3. The Space Between: A Groovebox With Friends

### 3.1 What defines the space

A DAW is a *document editor* for music: timeline, clips, plugins, mixing. A step sequencer alone is a *pattern toy*. The space between — the groovebox — is defined by four commitments:

1. **Loop-first, not timeline-first.** Music is made by layering and mutating loops. Arrangement emerges from performing patterns, not dragging clips.
2. **Constraint as a feature.** Fewer, opinionated choices; faster groove. (The OP-1's fixed tape length is why people love it.)
3. **Performance is composition.** Mutes, fills, punch-ins, and scene switches *are* the arrangement.
4. **One screen.** No routing pages. Keyboardia's UI-PHILOSOPHY already demands this.

Keyboardia's anti-goals should be explicit, so DAW-creep has a fence: **no linear timeline editing, no plugin hosting, no mixing console beyond levels + sends, no destructive waveform editing.** MIDI/stems/audio export is the pressure valve — when someone outgrows the groovebox, Keyboardia *hands off gracefully* instead of becoming Ableton.

### 3.2 What Teenage Engineering actually teaches

Six principles, each with a concrete Keyboardia translation:

| TE principle | Evidence | Keyboardia move |
|--------------|----------|-----------------|
| **Constraint is luxury** | OP-1: 4 tracks, fixed tape | Patterns A–H per session, not ∞. Macro knobs, not 40 parameters. Keep the 26-value step-count list. |
| **Groove in 30 seconds** | EP-133 K.O. II: sample→beat in under a minute | Treat *time-to-first-groove* as the north-star metric. Sound on the very first tap. Starter kits on the empty grid. |
| **Performance is the product** | OP-Z/K.O. II punch-in FX | A performance layer: punch-in FX, mute groups, fill button, quantized pattern switching — all multiplayer-synced. |
| **Toy-grade delight, instrument-grade depth** | Pocket Operators | Every advanced feature must also be fun to poke at. Dual-layer disclosure is already the house style (Shift+click). |
| **Tactility** | Clicky keys, LED matrices | Audio-reactive UI (steps glow with velocity), haptics on mobile, UI micro-sounds rendered by the engine itself, chunky controls. |
| **Wit and character** | OB-4 "magic radio", K.O. II marketing | Lean into animal identities (avatars bounce when their player edits), whimsical generated session names, publish celebration, easter eggs. |

The existing design language (dark surfaces, orange glow, monospace numerals, "would this work on a device with no screen?") is already TE-compatible. The gap isn't visual — it's that **Keyboardia currently plays like an editor, not an instrument.**

### 3.3 The opportunity map

Five territories in the between-space, ordered by how uniquely Keyboardia can win them:

**① The performance layer** *(biggest gap, most TE, multiplayer-amplified)*
Punch-in FX (hold a key: stutter, tape-stop, filter sweep, reverse, bit-crush — release to snap back), track mute groups (mute Kick A auto-unmutes Kick B), a fill button (momentary variation), and quantized pattern switching. In multiplayer these become *jam moves everyone hears* — a groovebox jam session no hardware can host. The pattern stops being a document and becomes an instrument.

**② Step components** *(OP-Z's signature, unbuilt anywhere on the web)*
Per-step probability, ratchet, nudge (micro-timing), jump/direction, parameter ramps — layered on the existing p-lock system and editor. Combined with polyrhythms (already best-in-class), this makes Keyboardia the deepest step sequencer in a browser while staying inline and discoverable.

**③ Song mode, groovebox-style** *(the DAW-side pull, answered without a timeline)*
Patterns A–H per session; chain them with repeat counts ("A×4 B×4 A×2 C×8"); switching is quantized to the bar. Crucially, the *same* mechanism is live performance (queue the next pattern while playing) and arrangement (save the chain). Scenes = pattern + mute state. This resolves the #1 compositional ceiling (loops-only) without importing timeline complexity.

**④ Play-surface input** *(mobile becomes an instrument, not a worse editor)*
Pad mode: a 4×4 performance surface (touch) / QWERTY mapping (desktop) to finger-drum and play melodies live, with optional record-quantize-into-grid. Resurrect the hidden mic recorder as "sample anything" with auto-chop to pads (K.O. II / Koala energy). Later: Web MIDI input. Mobile's job flips from "cramped editing" to "expressive playing" — which is also the honest answer to the mobile pain cluster.

**⑤ Generative emergence** *(the EMERGENCE.md thesis, made playable)*
A mutate dice (constraint-aware: stays in scale, preserves density), humanize, and a "drift" toggle — a pattern that slowly evolves within musical bounds (Eno-style generative mode) which in a shared session gives everyone a living thing to react to. Longer horizon: the Phase 37 text notation is explicitly LLM-friendly — an AI jam partner can trade patterns through the same clipboard format humans use.

### 3.4 Delight ledger (small joys, shipped continuously)

Not a phase — a standing budget. Each is small; together they are the personality:

- Steps pulse with actual audio level (the AudioWorklet metering already computes it).
- Haptic tick on step-place (mobile), matched to the existing 600ms attribution flash.
- Play button already pulses at tempo — extend the heartbeat to the session favicon.
- Publish moment: one-shot celebratory animation + auto-generated poster (grid-thumbnail art) ready to share.
- Whimsical default session names ("Velvet Walrus Groove") from the existing color×animal identity system; avatars do a tiny bounce when their player edits.
- Tape-stop sound/animation on Stop (skippable via reduced-motion).
- Big-screen party mode: `?visualizer=1` companion to `?qr=1` — projection-friendly audio-reactive visuals for classrooms, meetups, booths.
- A Konami-code instrument.

---

## 4. What Hurts: Pain Points That Gate the Future

There is no user-issue backlog (the repo has exactly one GitHub issue, about repo metadata) — pain is documented in specs and structural in code. Ranked by severity × frequency:

| # | Pain | Who bleeds | Evidence |
|---|------|-----------|----------|
| 1 | **No undo/redo anywhere.** One misclick is permanent; can't recover from a collaborator's mistake. Fear kills experimentation. | Everyone, every session | COMPOSITION-AFFORDANCES Pain 2; zero history code |
| 2 | **Losing your work is easy.** Anonymous URL-only sessions: lose the tab, lose the music. No "my sessions", no recovery, 2s-debounce save can drop last edits. | Casual creators, multi-device users | SESSION-LIFECYCLE (`ownerId: null`), MULTIPLAYER-PRESENCE-RESEARCH ("browser history is chaotic" = HIGH) |
| 3 | **First sound can be silence.** Cold load + early Play tap = expired AudioContext gesture = nothing heard, at the worst possible moment. Plus iOS mute-switch/autoplay traps. | First-time visitors, mobile | LESSONS-LEARNED ~1855; MOBILE-LESSONS |
| 4 | **Blank-canvas cold start.** New session = `tracks: []`, literally an empty screen; Add-track is buried in a picker. Landing page promises "instant creation". | First-timers, non-musicians | `grid.tsx createInitialState()`, MOBILE-LESSONS #7 |
| 5 | **Mobile is overloaded.** Dozens of controls crammed into portrait; 36px cells vs 44px targets; Phase 38 not started. | Every link-recipient on a phone | MOBILE-INTERFACE-SIMPLIFICATION (whole premise) |
| 6 | **Loops only — no songs.** One pattern per session; no chain, no scenes, no arrangement. | Anyone who gets serious | COMPOSITION-AFFORDANCES Pain 1 ("Critical") |
| 7 | **Multiplayer can silently lose edits.** Documented P0/P1: mutations that never reach the server, snapshots overwriting unconfirmed local edits, undetected divergence. | Collaborators (the headline feature) | MULTIPLAYER-RELIABILITY-SPEC BUG-01/-04 |
| 8 | **No audio export.** Can't post your beat to socials or send an MP3; MIDI-only export. The growth loop leaks here. | Every proud creator | Gap table in COMPOSITION-AFFORDANCES; no render path |
| 9 | **Melody/harmony is tedious.** Monophonic tracks; chords need multiple tracks; no arp, no chord tool. | Melodic creators, beginners | COMPOSITION-AFFORDANCES Pains 3, 7 |
| 10 | **Patterns go stale.** No probability, mutate, humanize, or fills — everything is manual. | Beginners (inspiration) + power users (speed) | COMPOSITION-AFFORDANCES Pains 4, 6 |
| 11 | **Power is hidden.** P-locks behind Shift+click, features with no UI history (XY pad et al.), partial shortcuts, tooltips rejected on principle. | Casual→power transition | HIDDEN-UI-FEATURES; Phase 36 partial |
| 12 | **iOS fragility on the viral loop.** Clipboard share broke on iOS once already; mic recording codec still wrong for iOS. | iOS users = most mobile | IOS-CHROME-COMPATIBILITY |
| 13 | **Invite = anyone can edit.** No read-only live share, no roles; combined with #1 and #2, a stranger can wipe a session irrecoverably. | Anyone sharing publicly | SESSION-LIFECYCLE invite toast |
| 14 | **Long patterns lack an overview.** 128 steps of horizontal scroll with no mini-map. | Power users of the headline polyrhythm feature | COMPOSITION-AFFORDANCES Pain 5 |

**Four clusters:**

- **Trust** (#1, #2, #7, #13) — the product invites experimentation and collaboration but can't protect work. Biggest cluster, undermines the core promise.
- **First sixty seconds** (#3, #4, #12) — the funnel's top: silent Play, blank grid, fragile share.
- **The ceiling** (#6, #8, #9, #10) — easy to start, impossible to finish or take with you.
- **Mobile** (#5, #12) — where shared links are actually opened.

---

## 5. The Evolution Plan

Seven arcs. Each names its pains (§4), its planned-but-unbuilt items (§2), and its TE lens (§3). Suggested phase numbers continue the existing ROADMAP.md sequence; order within an arc is flexible, order *between* Arcs 1–2 and the rest is not — trust and the first minute gate everything else.

**A three-lens test for every new feature** (extends The Test in UI-PHILOSOPHY.md): does it *heal a top pain*, does it *deepen the groovebox* (not the DAW), does it *add TE-grade delight*? Ship only what clears two of three.

### Arc 1 — Trust the Canvas *(candidate Phases 43–44)*

The prerequisite for everything: people must be able to experiment fearlessly and keep what they make.

| Item | Pains | Notes |
|------|-------|-------|
| **Undo/redo** (per-user command stack, multiplayer-aware) | #1 | COMPOSITION-AFFORDANCES has the design + references. Also *enables* bolder features later (mutate dice is safe when undo exists). |
| **Session shelf** ("My sessions" from localStorage now; merges into accounts later) | #2 | Cheap, no auth needed, kills the lost-URL disaster today. |
| **Finish mutation-tracking wiring** (RELIABILITY-SPEC P0/P1: silent loss, snapshot-overwrites-pending) | #7 | Reliability of the flagship feature. |
| **View-only live links** (invite grants edit *or* watch) | #13 | Small model change; pairs with publishing. |
| Save-on-`beforeunload`/`visibilitychange` flush | #2 | Closes the 2s-debounce loss window. |

### Arc 2 — The First Sixty Seconds *(candidate Phase 45)*

The K.O. II test: a stranger should have a groove — and hear it — inside a minute.

| Item | Pains | Notes |
|------|-------|-------|
| **Instant sound**: attach unlock listeners before load completes; pre-decode a tiny kit so first tap always sounds | #3 | Fix analyzed in LESSONS-LEARNED. |
| **Starter kits on the empty grid**: 3–4 one-tap kits (Drums / Boom-bap / Techno / Afrobeat) that drop 4 tracks with a playing pattern; "start empty" stays one tap away | #4, #10 | Replaces `tracks: []` blankness. Kits are curated bundles — very TE. |
| **Demo-to-remix funnel**: landing examples open in a play-first state with a big Remix | #4 | Landing spec already wants this. |
| **iOS share + recording codec hardening** | #12 | MIME detection; protect the viral loop. |
| Empty-state Add-Track CTA (unbury from picker) | #4 | MOBILE-LESSONS recommendation. |

### Arc 3 — Play It Live *(candidate Phases 46–47 — the TE heart)*

The performance layer that turns the document into an instrument, amplified by multiplayer.

| Item | Space | Notes |
|------|-------|-------|
| **Punch-in FX**: hold = momentary stutter/tape-stop/filter/reverse/crush; release = snap back; heard by all players | §3.3① | Named in UI-PHILOSOPHY since day one. Effects infra exists; needs momentary routing + sync messages. |
| **Mute groups + fill button** | §3.3① | Mute groups per UI-PHILOSOPHY; fill = momentary variation borrowed from Arc 4's mutate. |
| **Pad mode** (4×4 touch pads / QWERTY mapping, optional record-quantize into grid) | §3.3④ | Mobile becomes an instrument (also relieves pain #5 by giving portrait a *playing* job, per MOBILE-INTERFACE-SIMPLIFICATION's consumption-first thesis). |
| **Quantized action queue** (perform changes land on the next bar) | §3.3③ | The mechanism pattern-switching (Arc 5) reuses. Revives the deferred "beat-quantized changes" idea in its useful form. |
| **Motion recording** (record XY-pad/knob gestures, loop with pattern) | §3.3① | XYPad exists; add capture + playback lane. |

### Arc 4 — Deeper Steps *(candidate Phase 48)*

OP-Z-style step components on the existing p-lock chassis.

| Item | Pains | Notes |
|------|-------|-------|
| **Step probability** | #10 | Days of work per the research; huge musical payoff. |
| **Ratchet/retrigger** (1–8 sub-hits) | #10 | Rolls, trap hats. |
| **Nudge** (per-step micro-timing) | — | Finer than swing. |
| **Mutate dice + humanize** (constraint-aware, undo-safe) | #10 | The delight version of variation. |
| **Arpeggiator + chord steps** (n-note steps or one-tap chord tool) | #9 | Attacks monophony where it hurts most. |
| **Pattern mini-map** | #14 | Low effort; unlocks the long patterns that already exist. Design constraints in [LOOP-RULER-LESSONS.md](./LOOP-RULER-LESSONS.md) §4 — content-bearing from v1; it is the "honest overview" the Loop Pages redesign leans on. |

### Arc 5 — From Loop to Song *(candidate Phase 49)*

The compositional ceiling, answered groovebox-style (no timeline).

| Item | Pains | Notes |
|------|-------|-------|
| **Patterns A–H per session** (copy-to-create, per-pattern name) | #6 | Data model change; the big lift. Multiplayer: pattern switch is a synced, quantized event (Arc 3's queue). |
| **Chains** ("A×4 B×4 C×8") with loop/perform toggle | #6 | The same UI performs live and saves an arrangement. |
| **Scenes** (pattern + mute state) | #6 | Cheap once patterns exist. |

### Arc 6 — Leave the Building *(candidate Phase 50)*

Music that can't leave dies inside. Every export is also marketing.

| Item | Pains | Notes |
|------|-------|-------|
| **Audio export**: WAV/MP3 via `OfflineAudioContext` (loop ×N or full chain), then stems | #8 | The single biggest sharing unlock. |
| **Rich clipboard / text notation** (= Phase 37; spec done) | #11, ecosystem | Patterns travel through Discord/SMS/LLMs; the AI-jam door. |
| **Shareable poster/video loop** (grid-art + audio for socials) | #8 | Pairs with the publish celebration. |
| **Embeddable player**, **MIDI import**, **PNG/JSON export** | ecosystem | EMERGENCE research phases, in that order. |

### Arc 7 — Find Each Other *(candidate Phases 51+, mostly = existing Phases 39–42)*

The social layer, in dependency order: **Auth & ownership (39)** → claim sessions, then **family tree (40)**, **explore/discovery page** (the "Share" promise in the tagline currently has no surface), **pattern library**, **remix notifications & credits**, **public API (41)**, **admin/ops (42)**. Auth is deliberately *after* Arcs 1–2: an account is only worth creating once the thing it protects is trustworthy and delightful.

### Sequencing rationale

```
Arc 1 Trust ──► Arc 2 First minute ──► Arc 3 Live ──► Arc 4 Steps ──► Arc 5 Song
                                          │                              │
                                          └────────► Arc 6 Export ◄─────┘
                                                          │
                                                Arc 7 Social (Auth 39 → 40/41/42)
```

- Arcs 1–2 first because every later feature compounds on trust + activation (and undo makes destructive-feeling features shippable).
- Arcs 3–4 before 5 because performance features are *individually* shippable, deepen the daily loop, and pattern-switching reuses Arc 3's quantized queue.
- Arc 6 threads through: audio export can ship any time after Arc 2 and should (pain #8 is standalone).
- The delight ledger (§3.4) and spec-hygiene fixes (§2.6) are continuous, not phased.

### Metrics

| North star | **Time-to-first-groove** (arrival → 4+ steps placed and heard) |
|---|---|
| Trust | Undo usage/session; sessions reopened from shelf; mutation-loss invariant violations → 0 |
| Ceiling | % sessions using >1 pattern; audio exports/week |
| Live | Punch-in/pad events per multiplayer session |
| Social | Remix depth; published-session plays |

---

## 6. Summary

- **Planned-but-unbuilt** work already covers most of what the future needs: Phases 37–42, the composition top-10 (undo, song mode, probability…), and the EMERGENCE export ladder (§2). The specs are ahead of the code — this is a sequencing problem, not an ideation problem.
- **The space between step sequencers and DAWs** is the groovebox, and on the web it is Keyboardia's to lose. The TE-inspired move is not more features but a *change of stance*: from editor to instrument — performance layer, step components, groovebox song mode, play surfaces, and relentless small delights (§3).
- **The pains** cluster into trust, the first minute, the ceiling, and mobile (§4). The plan (§5) heals them in that order, because a delightful instrument nobody trusts — or one that eats your first beat — never gets a second session.
