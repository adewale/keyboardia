# Keyboardia Evolution Roadmap

> **Status:** Proposal / Vision document
> **Created:** July 2026
> **Inputs:** Full audit of `specs/ROADMAP.md`, `specs/STATUS.md`, all research docs, GitHub issues, and the current codebase.
> **Companions:** [ROADMAP.md](./ROADMAP.md) (phase history), [UI-PHILOSOPHY.md](./UI-PHILOSOPHY.md) (design principles), [research/COMPOSITION-AFFORDANCES.md](./research/COMPOSITION-AFFORDANCES.md), [research/EMERGENCE.md](./research/EMERGENCE.md), [LOOP-RULER-LESSONS.md](./LOOP-RULER-LESSONS.md) (postmortem), [PATTERN-MODE.md](./PATTERN-MODE.md) (pattern-world design + UI mocks)

This document answers three questions:

1. **What is already planned but not implemented?** (§2)
2. **What is available in the space between step sequencers and DAWs** — with heavy Teenage Engineering influence, and more delight and creativity? (§3)
3. **What are the biggest user pain points, and how does the future solve them?** (§4, §5)

It ends with a sequenced evolution plan (§5) that ties all three together.

---

## 1. Where Keyboardia Stands (July 2026)

Keyboardia is a mature, well-tested multiplayer step sequencer: 16 tracks × 3–128 steps with true polyrhythms, parameter locks (pitch/volume/tie), an inline chromatic grid with scale lock, ~70 sound generators plus 27 sampled instruments (recently rebuilt with a rigorous QA pipeline), a synced effects chain, pattern tools (Euclidean, rotate, invert, reverse, mirror), per-track swing, velocity lanes, MIDI export, publishing/remixing with lineage, QR sharing, and real-time multiplayer with presence, cursors, and attribution — all on Cloudflare Workers/DO with 5,000+ tests.

**The strategic position:** in hardware, the space between step sequencers and DAWs was answered by the *groovebox* — Elektron Digitakt, Teenage Engineering OP-Z / EP-133 K.O. II, Novation Circuit Tracks, Polyend Play — and the groovebox's answer is **performance-first**: you arrange by playing the box live. Keyboardia occupies the same between-space with a deliberately different stance: **composition- and playback-first**. A session is not a performance rig; it is a *composed musical object that plays itself* — built (often together), shared as a URL, heard the same way by everyone who presses play. On the web, even that slot is essentially empty: web tools are toys (Chrome Music Lab), lessons (Ableton Learning Music), DAW-clones (Soundtrap, BandLab), or code (Strudel). Keyboardia stands in it with two properties nothing else has:

- **URL-native multiplayer composition** — "send a link, build it together in 10 seconds."
- **Remix lineage** — every session is forkable, with provenance.

Not "Google Docs for grooveboxes" but closer to **"multiplayer compositions that play themselves"** — the shareable music box, not the stage. The evolution plan below deepens that identity without drifting toward being a DAW — and without importing the groovebox's performance stance (see §3).

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

These have lived in the philosophy doc since early on and remain unbuilt: **step components** (probability/ratchet/nudge), **punch-in effects** (hold-to-apply momentary FX), **track mute groups**, **pattern chaining**, **motion recording** (record knob/XY moves as automation). §3 sorts these through the playback-first lens: step components, chaining, and automation are composition features and stay; punch-in effects and performance mute-groups are cut.

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

## 3. The Space Between: Compositions That Play Themselves

> **Direction (July 2026):** Keyboardia is about **playback, not performance**. Hardware answered this space with the groovebox, whose core stance — arrangement happens live, on stage, by a performer — is the one part Keyboardia deliberately does not adopt. Everything in this section is read through that lens; performance-first proposals from earlier drafts are cut or recast below.

### 3.1 What defines the space

A DAW is a *document editor* for music: timeline, clips, plugins, mixing. A step sequencer alone is a *pattern toy*. Keyboardia's answer to the space between is defined by four commitments:

1. **Loop-first, not timeline-first.** Music is made by layering and mutating loops; songs are chains of patterns, not clip timelines.
2. **Constraint as a feature.** Fewer, opinionated choices; faster groove. (The OP-1's fixed tape length is why people love it.)
3. **Playback is the artifact.** The arrangement is *composed* in the editor and plays back faithfully and deterministically — the song, not a performance of it, is what gets shared, published, and remixed. Every listener at every hour hears the same music (the invariant the sync layer already enforces).
4. **One screen.** No routing pages. Keyboardia's UI-PHILOSOPHY already demands this.

Keyboardia's anti-goals should be explicit, so DAW-creep has a fence: **no linear timeline editing, no plugin hosting, no mixing console beyond levels + sends, no destructive waveform editing.** MIDI/stems/audio export is the pressure valve — when someone outgrows the groovebox, Keyboardia *hands off gracefully* instead of becoming Ableton.

### 3.2 What Teenage Engineering actually teaches

Six principles, each with a concrete Keyboardia translation:

| TE principle | Evidence | Keyboardia move |
|--------------|----------|-----------------|
| **Constraint is luxury** | OP-1: 4 tracks, fixed tape | Patterns A–H per session, not ∞. Macro knobs, not 40 parameters. Keep the 26-value step-count list. |
| **Groove in 30 seconds** | EP-133 K.O. II: sample→beat in under a minute | Treat *time-to-first-groove* as the north-star metric. Sound on the very first tap. Starter kits on the empty grid. |
| **Immediacy is the product** | K.O. II: nothing between you and hearing it | Zero-friction *hearing*: sound on the first tap, shared sessions that greet you playing, a player worthy of the music. (TE's performance layer — punch-in FX, live stagecraft — is the one thing we deliberately don't import.) |
| **Toy-grade delight, instrument-grade depth** | Pocket Operators | Every advanced feature must also be fun to poke at. Dual-layer disclosure is already the house style (Shift+click). |
| **Tactility** | Clicky keys, LED matrices | Audio-reactive UI (steps glow with velocity), haptics on mobile, UI micro-sounds rendered by the engine itself, chunky controls. |
| **Wit and character** | OB-4 "magic radio", K.O. II marketing | Lean into animal identities (avatars bounce when their player edits), whimsical generated session names, publish celebration, easter eggs. |

The existing design language (dark surfaces, orange glow, monospace numerals, "would this work on a device with no screen?") is already TE-compatible. The gap isn't visual — it's that **Keyboardia has a good editor and barely a player.** The composing side is deep; the *hearing* side — the experience of everyone who opens a shared link to listen — is an afterthought.

### 3.3 The opportunity map

Five territories in the between-space, ordered by how uniquely Keyboardia can win them:

**① The player** *(biggest gap — the listener is half the product and has no surface)*
Every shared or published link produces a *listener*, and today they get the full editing chrome with a Play button hidden in it. Give playback a first-class surface: published sessions open into a player (artwork-grade grid visualization, one tap to sound, title/lineage/remix CTA), repeat modes borrowed from music players (⟳ repeat-pattern / ⛓ play-song), audio-reactive visuals as the default "album art in motion," embeds later. The composition is the artifact; the player is how the world meets it.

*(Cut from earlier drafts: punch-in FX, mute groups, fill buttons, live stagecraft — performance features for an audience watching a performer, which Keyboardia doesn't have. Mute groups may return someday as an arrangement tool, not a performance one.)*

**② Step components** *(OP-Z's signature, unbuilt anywhere on the web)*
Per-step probability, ratchet, nudge (micro-timing), jump/direction, parameter ramps — layered on the existing p-lock system and editor. Combined with polyrhythms (already best-in-class), this makes Keyboardia the deepest step sequencer in a browser while staying inline and discoverable.

**③ Song structure, the classic way** *(the DAW-side pull, answered with 45 years of precedent)*
The two-concept model every drum machine and tracker converged on: **patterns** (slots 1–8, whole-grid loops; exactly one is current — synced, shown, heard) and a **song** that is an ordered list of patterns with repeats — the tracker order list `1 2 1 3×4`, the LinnDrum/MPC Song, the 808's Compose mode. One question: does Play play the pattern or the song? One transient: tap a slot while playing and it cues to the loop boundary (the 1980 pattern-button behavior). The grid always shows what's sounding. Full design + sourced history (including why chains, braces, scenes, and view/play splits were cut): [PATTERN-MODE.md](./PATTERN-MODE.md). This resolves the #1 compositional ceiling (loops-only) without importing timeline complexity.

**④ Faster ways to put notes in** *(input methods, not performance)*
Tapping a rhythm is often faster than clicking cells: a pad/key input mode (touch pads, QWERTY mapping, later Web MIDI) whose *product* is always grid data — record-quantize-into-steps, then edit as usual. Same for resurrecting the hidden mic recorder as "sample anything" with auto-chop. These are entry methods for composition; nothing about them is live-show machinery.

**⑤ Generative emergence** *(the EMERGENCE.md thesis — reconciled with faithful playback)*
A mutate dice (constraint-aware: stays in scale, preserves density) and humanize are *edit-time* tools — they change the composition, deterministically, undo-ably. Playback-time randomness (step probability, drift) needs a decision: **seeded** (the session carries the seed; every listener hears the same "random" performance — determinism preserved) or cut. Recommendation: seeded, synced like everything else. Longer horizon: the Phase 37 text notation is explicitly LLM-friendly — an AI collaborator can trade patterns through the same clipboard format humans use.

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

Eight arcs. **Arc 1 is a consolidation, not a feature set** — it exists so Arcs 2–8 add *nouns* instead of *controls*. Each arc names its pains (§4), its planned-but-unbuilt items (§2), and its lens (§3). **Visual evidence:** [mocks/arc-storyboard.html](./mocks/arc-storyboard.html) renders the resulting UI after every arc, cumulative, with each arc's additions highlighted. Suggested phase numbers continue the existing ROADMAP.md sequence; order within an arc is flexible, order *between* Arcs 1–3 and the rest is not — vocabulary, trust, and the first minute gate everything else.

**A three-lens test for every new feature** (extends The Test in UI-PHILOSOPHY.md): does it *heal a top pain*, does it *serve composition or playback* (not performance, not the DAW), does it *add TE-grade delight*? Ship only what clears two of three. Plus the **vocabulary gate** from [AFFORDANCES.md](./AFFORDANCES.md): every feature names the existing affordance that carries it, or earns a new one with three planned uses.

### Arc 1 — One Vocabulary *(candidate Phase 43)*

Consolidate affordances before adding any. Full audit and targets in [AFFORDANCES.md](./AFFORDANCES.md); rendered specimens in [mocks/affordance-contact-sheet.html](./mocks/affordance-contact-sheet.html). This is a pure win for the app as it exists today — especially on mobile — and it is what lets every later arc land on shared primitives instead of inventing bespoke controls (the LoopRuler being the standing cost of skipping it).

| Item | Source | Notes |
|------|--------|-------|
| **Build the absorbers with existing consumers**: chip row, DragLCD, property lane (velocity as its first property), inspector (floating desktop / sheet mobile), pending pill | AFFORDANCES §2 (N1–N4, N6–N7) | Primitives only — no new musical features. The order list (N5) waits for Arc 5, its first consumer. |
| **Collapse the duplicates**: one dropdown, one transport, one FX panel; TrackRow 13 → 6 visible controls | C-1–C-5 | Relieves mobile overload (pain #5) without a redesign; deletes the parallel TransportBar + mobile EffectsPanel. |
| **One meaning per gesture**: Shift/long-press = disclose, double-click = rename, Ctrl+drag = extend selection | C-8 | Makes KEYBOARD-SHORTCUTS.md's documented claims true at last (pain #11). |
| **One overlay/sheet primitive** (= Phase 38's missing BottomSheet, built once) | C-7 | QR + shortcuts migrate onto it; Phase 38's action sheets inherit it. |
| **Wire the dead keyboard shortcuts; haptic tick; pointer-capture rule** | C-10, C-11, N8 | Keys mirror chips from day one; zero haptics exist today. |

**Exit criterion:** the contact sheet's sections 1–2 *are* the entire UI — nothing from its consolidation-candidates section remains — and the vocabulary gate is enforced on every arc below.

### Arc 2 — Trust the Canvas *(candidate Phases 44–45)*

The prerequisite for everything: people must be able to experiment fearlessly and keep what they make.

| Item | Pains | Notes |
|------|-------|-------|
| **Undo/redo** (per-user command stack, multiplayer-aware) | #1 | COMPOSITION-AFFORDANCES has the design + references. Also *enables* bolder features later (mutate dice is safe when undo exists). |
| **Session shelf** ("My sessions" from localStorage now; merges into accounts later) | #2 | Cheap, no auth needed, kills the lost-URL disaster today. |
| **Finish mutation-tracking wiring** (RELIABILITY-SPEC P0/P1: silent loss, snapshot-overwrites-pending) | #7 | Reliability of the flagship feature. |
| **View-only live links** (invite grants edit *or* watch) | #13 | Small model change; pairs with publishing. |
| Save-on-`beforeunload`/`visibilitychange` flush | #2 | Closes the 2s-debounce loss window. |

### Arc 3 — The First Sixty Seconds *(candidate Phase 46)*

The K.O. II test: a stranger should have a groove — and hear it — inside a minute.

| Item | Pains | Notes |
|------|-------|-------|
| **Instant sound**: attach unlock listeners before load completes; pre-decode a tiny kit so first tap always sounds | #3 | Fix analyzed in LESSONS-LEARNED. |
| **Starter kits on the empty grid**: 3–4 one-tap kits (Drums / Boom-bap / Techno / Afrobeat) that drop 4 tracks with a playing pattern; "start empty" stays one tap away | #4, #10 | Replaces `tracks: []` blankness. Kits are curated bundles — very TE. |
| **Demo-to-remix funnel**: landing examples open in a play-first state with a big Remix | #4 | Landing spec already wants this. |
| **iOS share + recording codec hardening** | #12 | MIME detection; protect the viral loop. |
| Empty-state Add-Track CTA (unbury from picker) | #4 | MOBILE-LESSONS recommendation. |

### Arc 4 — Deeper Steps *(candidate Phase 47)*

OP-Z-style step components on the existing p-lock chassis — every one of them lands in Arc 1's property lane and inspector, adding zero new control types.

| Item | Pains | Notes |
|------|-------|-------|
| **Step probability** | #10 | Days of work per the research; huge musical payoff. **Seeded** (seed stored in the session) so every playback is identical for every listener — determinism is part of the playback identity (§3.1). |
| **Ratchet/retrigger** (1–8 sub-hits) | #10 | Rolls, trap hats. Deterministic. |
| **Nudge** (per-step micro-timing) | — | Finer than swing. |
| **Mutate dice + humanize** (constraint-aware, undo-safe) | #10 | Edit-time tools: they change the composition, deterministically. The delight version of variation. |
| **Pad/key note entry** (touch pads / QWERTY, record-quantize into grid; later Web MIDI) | #9, #5 | An input method whose product is always grid data (§3.3④) — moved here from the cut performance arc. |
| **Automation lanes** (record XY/knob gestures as pattern-synced data) | — | Composition data that plays back; was "motion recording" in the performance framing. XYPad exists. |
| **Arpeggiator + chord steps** (n-note steps or one-tap chord tool) | #9 | Attacks monophony where it hurts most. |
| **Pattern mini-map** | #14 | Low effort; unlocks the long patterns that already exist. Design constraints in [LOOP-RULER-LESSONS.md](./LOOP-RULER-LESSONS.md) §4 — content-bearing from v1; it is the "honest overview" the Loop Pages redesign leans on. |

### Arc 5 — From Loop to Song *(candidate Phase 48)*

The compositional ceiling, answered with a score, not a timeline.

| Item | Pains | Notes |
|------|-------|-------|
| **Pattern slots 1–8** (whole-grid loops; one current, synced; tap to cue at the loop boundary) | #6 | Data model change; the big lift. Slots ride Arc 1's chip row + pending pill; a one-slot session is exactly today's app. |
| **Song = order list** (rows of pattern × repeats, tracker-style; PATTERN \| SONG play scope) | #6 | Playback follows the list deterministically, end to end. The list is absorber N5, built here — to the Arc 1 vocabulary — for its first consumer. Published sessions with a song open in SONG scope. |
| **⧉ Duplicate + ✂ Split** | #6 | Pattern copy (universal since the LinnDrum) and the lossless legacy-session migration. |

> **Design note:** patterns change the rules for everything in this arc and several items above — loop regions, page navigation, the mini-map, and capture all transform or dissolve. Full analysis, data model, and UI mocks in [PATTERN-MODE.md](./PATTERN-MODE.md).

### Arc 6 — The Player *(candidate Phase 49)*

The listener's half of the product. Every shared link produces more listeners than editors; today they get an editor with a Play button hidden in it. Numbered after Song (Arc 5) because a player is most valuable once there are songs to play — its instant-sound pieces ship earlier, with Arc 3.

> **Direction note (July 2026):** this arc was previously "Play It Live" — punch-in FX, mute groups, fill buttons, pad performance. Cut: Keyboardia is about **playback, not performance**. What survives from that draft is re-homed: the quantized "up next" queue (an audition/editing affordance) lives with patterns in Arc 5; pad/key input (a way to *enter notes*, not perform them) lives in Arc 4; automation recording moves to Arc 4 as composition data.

| Item | Pains | Notes |
|------|-------|-------|
| **Player view for published sessions**: artwork-grade grid visualization, one-tap sound, title/lineage, prominent Remix | #3, #5 | The immutable-session page becomes a *player*, not a locked editor — also the honest fix for portrait's "consumption-only" thesis. |
| **Play scope**: PATTERN \| SONG (repeat the loop / play the piece) | #6 | Ships with Arc 5's song list; surfaced here as listener chrome. |
| **Audio-reactive visuals as default player art** | — | Graduates from the delight ledger: the AudioWorklet metering drives grid-glow "album art in motion." |
| **Listen-through polish**: session begins visually "playing" on arrival, sound on first gesture, no dead time | #3 | Extends Arc 3's instant-sound work to the shared-link path. |
| **Big-screen mode** (`?visualizer=1`) | — | Projection-friendly playback for classrooms/meetups; companion to `?qr=1`. |

### Arc 7 — Leave the Building *(candidate Phase 50)*

Music that can't leave dies inside. Every export is also marketing.

| Item | Pains | Notes |
|------|-------|-------|
| **Audio export**: WAV/MP3 via `OfflineAudioContext` (loop ×N or full chain), then stems | #8 | The single biggest sharing unlock. |
| **Rich clipboard / text notation** (= Phase 37; spec done) | #11, ecosystem | Patterns travel through Discord/SMS/LLMs; the AI-jam door. |
| **Shareable poster/video loop** (grid-art + audio for socials) | #8 | Pairs with the publish celebration. |
| **Embeddable player**, **MIDI import**, **PNG/JSON export** | ecosystem | EMERGENCE research phases, in that order. |

### Arc 8 — Find Each Other *(candidate Phases 51+, mostly = existing Phases 39–42)*

The social layer, in dependency order: **Auth & ownership (39)** → claim sessions, then **family tree (40)**, **explore/discovery page** (the "Share" promise in the tagline currently has no surface), **pattern library**, **remix notifications & credits**, **public API (41)**, **admin/ops (42)**. Auth is deliberately *after* Arcs 1–3: an account is only worth creating once the thing it protects is trustworthy and delightful.

### Sequencing rationale

```
Arc 1 Vocabulary ──► Arc 2 Trust ──► Arc 3 First minute ──► Arc 4 Steps ──► Arc 5 Song ──► Arc 6 Player
                                          │                     │               │
                                          └───────► Arc 7 Export ◄─────────────┘
                                                          │
                                                Arc 8 Social (Auth 39 → 40/41/42)
```

- **Arc 1 first because retrofit multiplies.** Consolidating after Arcs 4–6 ship means migrating pattern chips, song lists, and player chrome onto new primitives instead of building them right once — and it pays down today's mobile overload (#5) and hidden-power (#11) pains immediately, with zero data-model risk.
- Arcs 2–3 next because every later feature compounds on trust + activation (and undo makes destructive-feeling features shippable).
- Arc 4 before 5: step components are individually shippable composition wins on Arc 1's property lane. Arc 6 (the player) lands best once songs (Arc 5) exist, though its instant-sound pieces ship with Arc 3.
- Arc 7 threads through: audio export can ship any time after Arc 3 and should (pain #8 is standalone).
- The delight ledger (§3.4) and spec-hygiene fixes (§2.6) are continuous, not phased.

### Metrics

| North star | **Time-to-first-groove** (arrival → 4+ steps placed and heard) |
|---|---|
| Vocabulary | Affordance count ≤ 30 (contact-sheet frames); one-off controls shipped per arc = 0 |
| Trust | Undo usage/session; sessions reopened from shelf; mutation-loss invariant violations → 0 |
| Ceiling | % sessions using >1 pattern; audio exports/week |
| Playback | Published-session plays; listen-through rate; ⟳ vs ⛓ usage |
| Social | Remix depth; remixes per published session |

---

## 6. Summary

- **Planned-but-unbuilt** work already covers most of what the future needs: Phases 37–42, the composition top-10 (undo, song mode, probability…), and the EMERGENCE export ladder (§2). The specs are ahead of the code — this is a sequencing problem, not an ideation problem.
- **The space between step sequencers and DAWs** was answered in hardware by the groovebox — performance-first. Keyboardia answers it playback-first: *multiplayer compositions that play themselves*. The move is from editor to **medium** — step components and song structure for composing, a first-class player for hearing, deterministic playback throughout, and relentless small delights (§3).
- **The pains** cluster into trust, the first minute, the ceiling, and mobile (§4). The plan (§5) begins by shrinking the interaction vocabulary itself (Arc 1 — [AFFORDANCES.md](./AFFORDANCES.md)), then heals the clusters in order — because features built on a sprawling vocabulary compound the sprawl, and a delightful instrument nobody trusts, or one that eats your first beat, never gets a second session.
