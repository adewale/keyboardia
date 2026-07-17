# Pattern & Song: The Classic Two-Concept Model

> **Status:** Design proposal **v4** — simplifies v3 after a history review of patterns, pattern chaining, and song mode (1980→today). Playback-first.
> **Created:** July 2026
> **Mocks:** [mocks/pattern-song.html](./mocks/pattern-song.html) (v4 — desktop, mobile portrait, mobile landscape)
> **Companions:** [EVOLUTION-ROADMAP.md](./EVOLUTION-ROADMAP.md) (Arc 5), [LOOP-RULER-LESSONS.md](./LOOP-RULER-LESSONS.md) (§1–2 lessons remain binding)

v3 of this spec was conceptually overloaded: split-zone chips (view vs queue), a view≠playback split with per-player pattern views, a "chain" strip with loop braces, three simultaneous chip states, and a mode toggle — five new concepts at once. A review of how hardware actually solved this for 45 years shows the industry converged on **two concepts and one question**, and that every famously confusing device is one that departed from them. v4 adopts the classic model.

---

## 1. The history

### 1.1 What everything converged on

| Device (year) | The loop concept | The arrangement concept | How you arrange |
|---|---|---|---|
| Roland TR-808 (1980) | Pattern (16 steps, written in Pattern Write) | **Rhythm Track** (12 memories × 64 measures) | In Compose mode, press pattern buttons in order while it runs — the order is memorized ([manual](https://cdn.roland.com/assets/media/pdf/TR-808_OM.pdf), [SOS](https://www.soundonsound.com/reviews/roland-tr808)) |
| LinnDrum (1982) | Pattern | **Song** = list of patterns | Roger Linn's pattern→song paradigm, copied by essentially everyone after ([Roger Linn](https://en.wikipedia.org/wiki/Roger_Linn)) |
| Akai MPC60 (1988) | Sequence | **Song** = ordered list of sequences with repeats | List editing in SONG mode; also real-time sequence switching ([SOS](https://www.soundonsound.com/music-business/akai-mpc60-revisited)) |
| Trackers: ProTracker/FastTracker/Renoise (1987→) | Pattern | **Order list**: `00, 01, 00, 02` — a list of pattern numbers | The song *is* the list; patterns repeat freely ([Music tracker](https://en.wikipedia.org/wiki/Music_tracker), [OpenMPT handbook](https://resources.openmpt.org/tracker_handbook/page/Beginners.htm)) |
| Korg Electribe / Roland MC (1996→) | Pattern | Song | Pattern mode / Song mode switch |
| Elektron Digitakt+ (2022, OS 1.30) | Pattern | **Song** = stored rows of pattern × repeats | Added after years of demand ([Perfect Circuit](https://www.perfectcircuit.com/signal/elektron-song-mode-update)) |

Two concepts, everywhere, for 45 years:

1. **Pattern** — a short loop you compose. Global: the whole kit's bar, not per-track slices.
2. **Song** — an ordered list of patterns with repeats. A *list*, edited like a list.

And **one question**: *what does Play play — the pattern or the song?* (The 808's mode dial, the MPC's MAIN vs SONG screens, a tracker's pattern-loop toggle.)

One transient state is also universal: tap a different pattern while playing and it takes over **at the end of the current loop** — the pending pattern blinks. The 808's Manual Play worked this way; the MPC's "real-time pattern switching" was a headline feature. That's cueing, and it's the *only* extra state the classic model ever needed.

### 1.2 The three documented confusion traps

Each famous usability failure in this territory is a departure from the two-concept model — and v3 of this spec managed to commit all three:

**Trap 1 — hidden modes and invisible state (the TB-303, 1981).** The 303 is [notoriously awkward](https://www.musicradar.com/news/producers-guide-to-the-roland-tb-303-and-clones) to program: separate Pitch/Time write modes entered blind, state readable only from LEDs, and a Pattern/Track dual system — [long-winded and very much not intuitive](https://tinyloops.com/tb303/index_sequencer.html). It sold so badly it was discontinued within a few years. *v3's version:* split-zone chips where the left half views and the right half queues, chips carrying three simultaneous states (playing / viewed / queued), and a view-vs-play split that puts two invisible cursors in one UI.

**Trap 2 — a third concept between pattern and song (Elektron chains, 2017–2022).** Digitakt shipped with *chains* — ephemeral pattern sequences that [couldn't be saved and vanished on power-off](https://www.elektronauts.com/t/digitakt-pattern-chain-mode/47331) — instead of song mode. Five years of community frustration later, [OS 1.30 added true Song Mode](https://www.perfectcircuit.com/signal/elektron-song-mode-update): stored rows of pattern × repeats. The lesson: "chain" as a concept distinct from "song" exists to serve *live performance*; for anyone who just wants to structure music, it's a confusing intermediate that eventually has to be replaced by the real thing. *v3's version:* the arrangement was literally called "the chain," edited on a strip with loop braces — a third concept wedged between pattern and song.

**Trap 3 — per-track patterns need yet another concept to manage (Novation Circuit).** Circuit's patterns are *per track* (drums can play pattern 3 while bass plays pattern 5), which is powerful — and immediately requires [Scenes](https://www.soundonsound.com/reviews/novation-circuit-tracks): snapshots of which pattern each track is playing, plus scene chaining, just to recall combinations. Ableton's Session view has the same shape (clips → scenes → arrangement). It's a performance architecture; the price is a concept ladder. *v3's version:* avoided per-track patterns (good — keep global) but added scenes anyway as "pattern + mute state." Cut.

### 1.3 Which lineage is Keyboardia's

The performance lineage (Elektron chains, Circuit scenes, Ableton Session) exists so a human can improvise structure live. Keyboardia is **playback-first** — sessions are compositions that play themselves — so its lineage is the other one: the 808's Compose mode, the LinnDrum song, the MPC song, and above all the **tracker order list**, which is the purest playback-first arrangement model ever shipped: patterns + a list, deterministic playback, built for composers rather than performers.

---

## 2. The v4 model: two concepts, one question

### 2.1 Pattern

- A session has **pattern slots 1–8** (global whole-grid snapshots: every track's steps, p-locks, and per-track step counts; the kit — instruments, volumes, transpose — stays session-level as before).
- **Exactly one pattern is current, and it is shared state, synced for everyone** — like tempo. The grid shows it; the speakers play it; edits land on it. This preserves the app's existing invariant verbatim: *everyone sees and hears the same thing.* There is no view/play split and no per-player pattern view.
- **Switching:** tap a slot. Stopped → switches immediately. Playing → the tapped slot **blinks as cued** and takes over at the end of the current loop (the 808/MPC behavior). Tap the cued slot again to cancel. One transient state, 45 years old.
- **Duplicate** copies the current pattern to the next empty slot (every drum machine's Copy). **✂ Split** explodes a long legacy pattern into slots + a song (migration; lossless).

### 2.2 Song

- The song is an **order list**, exactly a tracker's: numbered rows of `pattern × repeats`, e.g. `1: P1×2 · 2: P2×2 · 3: P1×2 · 4: P3×4`.
- Edited as a **vertical list** — add row, tap repeats to change, drag to reorder, delete. Not a strip, not chips-with-braces, not a timeline.
- Playback in Song scope follows the list top to bottom, deterministically — the same music for author, collaborators, and every listener. The playing row is highlighted; the grid follows the sounding pattern (see 2.3).

### 2.3 The one question: what does Play play?

A two-position control next to Play — **PATTERN | SONG** (the 808 mode dial, reborn):

- **PATTERN**: the current pattern loops. Repeat-one. This is exactly today's Keyboardia behavior, now per-slot.
- **SONG**: the order list plays through. The grid always shows the pattern that is *sounding* (tracker "follow" behavior) — what you see is what you hear, always. Editing during song playback edits the sounding pattern, live, like today.
- A published session with a song opens in SONG scope: listeners get the piece. `?` loop-at-end vs stop-at-end is a row on the list ("end: stop / loop"), not a mode.

**Not in the model:** chains as a separate concept, braces, scenes, split-zone chips, view≠play, queue zones, per-player pattern views. Want to work on one section? Switch to PATTERN scope on that slot — that *is* "looping a section while composing." Want a stutter? Compose it (ratchets or a dedicated pattern). Determinism rule unchanged: any future playback-time randomness ships seeded and synced, or not at all.

---

## 3. Data model

```ts
interface SessionState {
  tracks: TrackVoice[];          // the kit, session-level (unchanged from v3)
  patterns: Pattern[];           // slots 1–8
  currentPatternId: string;      // SHARED, synced — the one grid everyone sees & hears
  song: SongRow[];               // the order list (may be empty)
  playScope: 'pattern' | 'song';
  tempo; swing; effects?; scale?; version;
  loopRegion?: ...               // DEPRECATED, read-only legacy (see §5)
}

interface Pattern { id: string; name?: string; length: number; trackData: TrackPattern[]; }
interface TrackPattern { steps: boolean[]; parameterLocks: (ParameterLock | null)[]; stepCount: number; }
interface SongRow { patternId: string; repeats: number; }
// cuedPatternId is transient DO state, not persisted; cue landings computed
// server-side against one shared patternBoundary() helper (postmortem rule).
```

Playback position: `(songRow, repeat, step)` in Song scope; `(–, –, step)` in Pattern scope. Per-track polyrhythms cycle within `pattern.length` (↻n badges, unchanged).

## 4. Surfaces

Full visuals: [mocks/pattern-song.html](./mocks/pattern-song.html).

- **Pattern slots row** (all viewports): numbered chips; current = filled orange; cued = blinking blue with "next"; empty = ghost `+`. Whole chip is one action: switch/cue. 44px+ targets, `1–8` keys, ARIA buttons.
- **Song panel** (desktop + landscape; read-only pill on portrait): the vertical order list with per-row thumbnails, `×N` repeat steppers, drag grips, add/delete. Collapsible; hidden until a second pattern exists (progressive disclosure — a one-pattern session looks exactly like today's Keyboardia).
- **Scope toggle** PATTERN | SONG beside Play; countdown pill while a cue or row change is pending ("P3 in 6 steps").
- **Status verbs**: ⧉ Duplicate, ✂ Split (legacy patterns only).
- **Published**: play, scope, and cueing stay live (listening); structure edits toast "Published — Remix to edit."

## 5. Multiplayer & migration

- `currentPatternId`, `song`, `playScope`, and cues are ordinary synced mutations through the handler factory, attributed and color-flashed like every edit. Cue landings are server-computed so all clients switch on the same step. No presence changes needed — everyone is already looking at the same pattern, as today.
- Existing sessions migrate as `patterns:[P1]`, `currentPatternId:P1`, `song:[]`, `playScope:'pattern'` — indistinguishable from today until a second slot is used. Legacy `loopRegion` keeps playing read-only; ✂ Split converts and retires it. Text notation (Phase 37) gains a pattern block header and a one-line order list — trivially, since the order list is already text-shaped (`1 2 1 3×4`).

## 6. What v4 removes from v3

| v3 concept | v4 fate | Historical verdict |
|---|---|---|
| View ≠ playback (per-player viewed pattern) | **Cut** — grid always shows the sounding/current pattern | Two cursors in one UI = Trap 1; also broke the app's own "everyone sees what they hear" invariant |
| Split-zone chips (view / queue halves) | **Cut** — one chip, one action: cue | Trap 1 (invisible click targets) |
| "Chain" strip + loop braces | **Replaced** by the song order list | Trap 2 — Elektron's five-year lesson; "chain" is performance vocabulary |
| Scenes (pattern + mute snapshot) | **Cut** | Trap 3 — the concept ladder; global patterns don't need scenes |
| Queued/viewed/playing triple chip state | **Reduced** to current + cued | Cueing is the one historical transient |
| Momentary/stutter gestures | Already cut in v3.1 | Performance stagecraft |
| Pattern.length boundary, ↻n badges, Duplicate/Split, determinism, published-lock, one shared boundary helper | **Kept** | These are the classic model + postmortem lessons |

## 7. Build order

1. Pattern slots + cue + Duplicate (Pattern scope only — no song UI yet). A one-slot session is byte-for-byte today's app.
2. Song order list + scope toggle + published-opens-in-SONG.
3. ✂ Split for legacy long patterns; retire `loopRegion` authoring.
