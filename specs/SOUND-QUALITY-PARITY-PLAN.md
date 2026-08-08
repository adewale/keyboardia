# Sound Quality Parity Plan

> **Status:** Proposed (v3 — revised after follow-up multi-agent audit)
> **Phase:** 43
> **Date:** 2026-08-04
> **Prerequisite reading:** `specs/research/SONG-MAKER-COMPARISON-2026-08.md`
> **Related:** `specs/research/ABLETON-LEARNING-SYNTHS-ENVELOPES-ANALYSIS.md`
> (sibling analysis, merged separately — its ranked recommendations are
> Phase 45 candidates; this plan pulls in only its parameter-slew
> convention (43.5), preset-hygiene lens (43.6), and the
> ADSR-reachability payoff of the advancedSynth migration (43.6)) and
> `specs/research/ABLETON-PLAYGROUND-LESSONS.md` (UX lessons from the
> Learning Music playground; independently converges on 43.2's
> scale-lock flip. Its seeded-start disposition was evaluated and
> **rejected 2026-08-04** — Keyboardia's home page example picker
> already serves it; see 43.2 item 3)

**v3 revision note.** The follow-up audit corrected the engine capacity
model, removed predetermined mix and stereo targets, split gain variation
from timbral-correlation metrics, made browser dynamics captures
synchronized/deterministic, moved the scale default into canonical session
creation and migration, unified live/MIDI velocity defaults, added the
lazy-pan cache requirement, separated observed sample metadata from
provenance hypotheses, and added a reproducibility receipt.

**v2 revision note.** v1 of this plan was audited by four independent
reviews (claim fact-check, implementation feasibility with the pinned
`node-web-audio-api`/`tone` versions actually executed, audio-engineering
domain review, and repo-convention/blast-radius analysis). v2 folds in
every confirmed finding. The material changes: the offline test rig cannot
assert dynamics (the Node compressor is ~17 dB off spec — all dynamics
proof moves to the browser lane); reconnecting the compressor alone does
NOT prove that pileup pumping is fixed (gain staging must be chosen from a
measured capacity render, not pre-selected);
the compressor goes **before** the time-based effects, not after; the
velocity-jitter hook point moved from `velocityFromMultiplier` (where it
would have been inaudible and missed 2/3 of instruments) up to the
schedulers; and Phase 4's premise was wrong — **the staged v2 sample packs
were already blind-reviewed on 2026-07-10 and rejected**
(`app/sample-pipeline/instrument-upgrades.json`: *"I kept preferring the
current samples in all the blind tests"*, `candidatePromotions: 0`,
enforced by `test/sample-pipeline-upgrade-ledger.test.ts:54-62`), so
sample-content work is a re-diagnosis and re-review, not a promotion.

---

## Goal

Close the audible gap between Keyboardia and Chrome Music Lab's Song Maker.
Repository and bundle inspection identified five working hypotheses to
measure: mix-bus dynamics, first-contact constraints, per-note variation,
sample content/calibration, and stereo placement. They are not comparative
measurements yet; Phase 43.0 decides which gaps are audible and how large
they are. Each implementation phase ships independently, and each carries
three kinds of proof:

1. **Automated verification** — rendered/captured-PCM assertions (config
   assertions only as secondary guards; see "Why config tests failed us").
2. **A demo session** — a small, exactly-specified session that maximally
   exposes one difference, playable before and after the change.
3. **A listening protocol** — what to play, on what hardware, and precisely
   what to listen for, written for ears that don't do this every day.

## Non-goals

- Matching Song Maker's 5-instrument curation. The defaults get good;
  the palette stays broad.
- New composition features (pattern chaining, automation curves) —
  `specs/research/MUSICAL-COVERAGE-ANALYSIS.md` priorities 7–8.
- Changing scheduling/timing (both products use lookahead scheduling, but
  comparative timing has not been measured), and
  **no timing micro-jitter** — deliberately rejected: grid tightness is
  the genre idiom (Song Maker adds none), swing already exists, and
  ±ms jitter creates flam risk on coincident kick+hat. The reason is
  musical, not technical — audio is client-local, so a seeded timing
  jitter *would* sync fine; we still don't want it.

## Why config tests failed us

`specs/research/VOLUME-VERIFICATION-ANALYSIS.md` concluded *"No volume
issues were found."* from 449 tests that assert constants sit in
self-declared ranges — while the shipping graph had the master compressor
disconnected. Two standing repairs land with Phase 1: the engine constants
move to an importable module so `audio-engineering.test.ts:19-32` stops
re-declaring copies instead of importing the engine value. The real basic
synth cap is `SYNTH_CONSTANTS.MAX_VOICES = 16`
(`synth-types.ts:74-77`, enforced by `synth.ts:664-670`); AdvancedSynth has
its own 8-voice cap, sampled instruments do not share that cap, and sessions
currently allow up to 16 tracks. Capacity tests therefore need an explicit
fixture rather than treating one per-engine cap as a whole-mix limit. Every
render lane also gets a can't-silently-skip guard (§0.5).

---

## Phase 43.0 — Measurement rig and baselines (build first)

No user-facing change. Everything later is provable only if we can render
or capture the same session twice and compare numbers.

**Two lanes, deliberately split — do not collapse them:**

- **Offline lane** (`node-web-audio-api`, vitest): content and voicing
  metrics only. Two hard reasons it cannot assert dynamics or effects:
  (1) Tone.js cannot construct any node against the Node context —
  `new Tone.Gain()` throws `param must be an AudioParam`
  (tone@15.1.22 + node-web-audio-api@2.0.0, measured), so nothing in this
  lane may import Tone even transitively (not `engine.ts`, not
  `toneEffects.ts`); (2) the Node `DynamicsCompressorNode` is **not
  spec-faithful** — measured up to ~17 dB from Chrome's curve, with
  `ratio` barely acting. No dynamics claim may be asserted offline.
- **Browser lane** (Playwright + Chromium capture): the only ground truth
  for the master chain, compressor, limiter, and effects.

### 0.1 Offline component renderer

Extract and reuse the harness that already exists in
`src/audio/instrument-range-render.test.ts` — it renders a real
`SampledInstrument` with real decoded MP3 bytes through
`OfflineAudioContext`, using a disk-backed `fetch` stub
(`installDiskFetch`, `:47-62`) and progressive-load waits (`:108-114`).
That, not `synth-envelope.render.test.ts`, is the precedent.

- **Scope: components, not `AudioEngine`.** `engine.ts:37` resolves
  `window.AudioContext` at module scope and self-creates its context
  (`:238`) — it cannot run offline without a refactor this plan does not
  require. The rig drives `SynthEngine` (`synth.ts:619` initialize),
  `SampledInstrument` (constructor `sampled-instrument.ts:204-212`,
  no window deps), and `createSynthesizedSamples(ctx)` (`samples.ts:15`,
  pure) into a hand-built native replica of the master topology. It
  *replicates* routing; it does not run the engine.
- Step times come from the real `timing-calculations.ts`.
- **Placement (per `specs/TESTING.md` §5):** render tests are co-located
  as `src/audio/<subject>.render.test.ts`; shared helpers
  (`session-render.ts`, `audio-measures.ts`) live in `src/test/`, which
  the test-linkage checker excludes and the dead-export checker tolerates.
  `audio-measures.ts` gets a same-named `audio-measures.test.ts`.
  Render tests declare **local** vitest timeouts (TESTING.md §6).
- **Small engine fix required:** `sampled-instrument.ts:574-576` fires an
  un-awaited `audioContext.resume()` when state ≠ `'running'` — an
  `OfflineAudioContext` is never `'running'` pre-render, so this fires per
  note. Guard it (skip for offline contexts) or `.catch(() => {})`.
- **Determinism:** the only audio-affecting `Math.random()` in the tree is
  `samples.ts` (10 sites: `:211,:229,:256,:330,:351,:354,:378,:403,:445,
  :650`). Add an optional `rng: () => number = Math.random` parameter to
  `createSynthesizedSamples()` and thread it to those sites. `mulberry32`
  already exists at `src/test/seeded-random.ts` — the rig supplies it;
  production keeps `Math.random`. Round-robin needs no seeding
  (`selectRoundRobinVariant` is a deterministic cursor,
  `sample-selection.ts:109-117`) but the rig must **reset
  `roundRobinCursors` between renders** or back-to-back renders diverge
  once RR content lands. Test: two renders, same seed → byte-identical
  (use `copyFromChannel`, not `getChannelData` — the latter is documented
  unreliable in node-web-audio-api). Node ≥ 22 required (CI is on 24).

### 0.2 Metrics module (`src/test/audio-measures.ts`)

Pure functions with unit tests against synthetic signals:

| Metric | Definition | Proves |
|---|---|---|
| `peakDbfs` / `rmsDb(window)` | standard | headroom, levels |
| `pumpingProfile` | 5 ms-window envelope ratio g(t) = env(delay-aligned post-makeup)/env(pre-compressor tap); measure and remove processor latency first | compressor gain movement, directly (Phase 1) |
| `hitLevelVariationDb` | per-hit peak and short-window RMS in dB; report spread/variance | gain-only humanization (Phase 3) |
| `hitCorrelation` | normalized cross-correlation of level-matched hit windows | round-robin/timbral variation (1.0 = same waveform shape) |
| `midSideRatioDb` | S-channel RMS − M-channel RMS | width (replaces naive L/R correlation, which level-panned mono sources barely move) |
| `loudnessKMax` | BS.1770 K-weighting pre-filter (two published biquads) + 400 ms sliding window, max over a 1 s note | cross-instrument loudness — fair to percussive *and* sustained sources, unlike first-300 ms RMS which reads string-section (97 ms leading silence, slow bow) falsely low |
| `spectralCentroidHz` | FFT-weighted mean of a hit window | velocity→filter, layer selection |
| `logSpectralDistance` | level-matched RMS distance between log-magnitude spectra over a named window | adjacent-layer discontinuity without assuming centroid monotonicity |
| `bandRmsDb(lo, hi)` | band-limited RMS | the hat-canary metric (Phase 1) |
| `leadingSilenceMs`, `dcOffset` | time to −40 dBFS; mean sample | sample trimming; DC (assert \|mean\| < 1e-3) |

Add `audio-measures.ts` to the Stryker `mutate` list (pure,
invariant-rich — exactly what that list is for). Note Stryker is
informational (`stryker.config.mjs` `break: null`), not a gate.

### 0.3 Browser capture (hard prerequisite for Phase 1, not a peer)

- New capture worklet beside `metering.worklet.ts`, loaded via the
  existing `worklet-support.ts` `?worker&url` pattern. Protocol:
  transferable 128-frame chunks over `port.postMessage` with a
  single `arm({ startFrame, frameCount })/stop()` control path — no
  ring-wraparound logic needed for bounded captures. (Rejected
  alternatives, for the record:
  `MediaRecorder` re-encodes to lossy Opus, which destroys null tests by
  construction; re-rendering the live graph in an in-page
  `OfflineAudioContext` would mean duplicating the engine.)
- **Capture two clock-synchronized taps in one run, then compensate node
  latency.** A pre-compressor tap and a post-makeup tap are required for
  `pumpingProfile`. Route them as separate inputs into one multi-input
  recorder worklet, arm them with one absolute `startFrame`, stamp each
  render quantum, and assert equal frame counts; independent MessagePort
  `start()` calls are not a synchronization contract. One recorder removes
  run-start skew, but the compressor's lookahead still delays the post tap.
  Measure that delay with a calibration impulse or below-threshold probe,
  shift the post signal before taking the envelope ratio, and assert the
  residual alignment error. A third
  user-output tap at `Tone.getDestination()` captures what is actually heard.
  `toDestination()` routes `limiter → Tone.Destination (Volume → Gain) →
  rawContext.destination`, so a limiter-only capture misses master
  volume/mute. Effects must be bypassed or pinned for the dynamics probe so
  delay/reverb energy is not misread as gain recovery.
- Dev-only hook `window.__captureMaster__(seconds)` beside the existing
  `__audioEngine__` globals (`debug-audio-tools.ts`).
- Playwright spec `e2e/capture-session.spec.ts`: **Chromium-only** (the
  config documents headless WebKit wedging on `AudioContext.resume()`;
  seven real-audio specs are already WebKit-excluded), runs in the
  serialized offline lane (`--workers=1`), declares its own
  `test.setTimeout(...)`, unlocks audio via a real click like
  `all-instruments-master-output.spec.ts:229-234`. WAVs go to
  `app/test-results/audio-capture/` (git-ignored, ephemeral — the
  repo's existing convention for audio artifacts).

### 0.4 A/B audition page (how you will *hear* every phase)

`app/src/debug/ab-audition.html` (dev-only): loads two WAVs, loops a
selectable region, keys `A`/`B` instant switch, `X` blind mode, `N` null
test (A + phase-inverted B; silence = identical).

Two corrections from the audit, both load-bearing:

- **Comparison mode loudness-matches (scale to equal RMS); null mode must
  NOT** — an RMS-scaled B can never null against A. `N` uses a raw
  unity-gain path.
- **Auto-align before either mode**: cross-correlate first onsets and trim
  — captures from separate runs are not sample-aligned, and misaligned
  null tests sound like garbage and discredit the method. (Two loop passes
  within one capture align by construction: one bar at 120 BPM is
  `2 * context.sampleRate` frames, not a hard-coded 88,200.)

### 0.5 Baselines + the can't-silently-skip guard

- Capture/render the demo sessions at current `main`; commit **metrics
  JSON** (not audio) beside the render tests.
- Browser null tests need a reproducibility guard too. Procedural buffers
  use `Math.random()` at construction, so either inject the same seeded RNG
  in browser test builds or create the buffers once and toggle topology in
  the same `AudioContext`. Before trusting any effect null, assert two
  same-build captures null within the chosen tolerance.
- The existing `describe.skipIf(!webAudio)` pattern means a failed native
  import turns every render assertion vacuously green — the exact failure
  mode this plan exists to kill, and `validate:test-antipatterns` only
  catches literal `skipIf(true)`. Mirror the repo's own explicit-lane
  precedent (`RUN_REAL_SAMPLE_PIPELINE=1`, `ci.yml:236-238`): a CI step
  runs the render lane with the capability **required** (fail, don't
  skip, when `node-web-audio-api` is absent), plus one non-skippable test
  asserting the module loaded.

### 0.6 CI inventory updates (every phase that adds a Playwright spec)

CI and the pre-push hook assert **exact** spec counts and titles:
`ci.yml:294-296` (71 discovered), `:298`, `:325` (83/69 offline lane),
`:373`, `:420`, `:484` (206/17), `:496` (160/52), `:549`, and
`.husky/pre-push` repeats three of them; titles live in
`e2e/test-title-inventory.txt` (compared by
`scripts/check-e2e-inventories.mjs`), and mock/worker classification in
`e2e/mock-compatible-files.txt` / `e2e/worker-required-files.txt`.
**Each new spec updates all of these in the same commit.** Budget it;
forgetting any one red-lights CI or blocks the push.

---

## Phase 43.1 — Master bus repair

### The bug, and what the audit changed

The tuned compressor (`engine.ts:47-53`) is disconnected at `engine.ts:426`
when Tone initializes, leaving unity gains into `Tone.Limiter(-1)`. v1
proposed reconnecting it after the effects. The audit's spec-curve math
killed that as a sufficient fix: with knee 12 at threshold −6, the
soft-knee region spans −6 to **+6 dBFS**, so a sufficiently dense linear
sum can still drive the limiter hard. But neither the 8-voice AdvancedSynth
cap nor a hypothetical 16-way full-scale sum describes S1: S1 has six
simultaneous sources at step 0 and three at step 8, with different peak
times and spectra. Establish two browser baselines before choosing a trim:
(a) S1 as the musical regression fixture; and (b) an explicit maximum-
capacity fixture covering the allowed 16 tracks and each engine's own
polyphony. The fix is **measured headroom**, not a predetermined constant.

### Change

1. **Gain staging (the load-bearing decision):** measure S1 and the
   maximum-capacity fixture at `masterGain = 1`, then choose the least trim
   that meets the limiter and pumping budgets (evaluate 0.71/−3 dB,
   0.5/−6 dB, and any measured intermediate). Document the selected value,
   input peaks, compressor gain reduction, limiter reduction, and sparse-
   solo level cost in the committed baseline JSON. Phase 43.4 may add
   source-class trims during calibration. Changelog entry required.
   *Reference context (research doc §4.3): the references share
   conservative source/patch gain, but not one universal −6 dB global
   trim. Keyboardia's compressor is capacity insurance, not the mechanism
   of polish.*
2. **Compressor into the chain, BEFORE the time-based effects:**

   ```
   masterGain(measured trim) → compressor → makeupTrim → distortion → chorus
                            → delay → reverb → limiter(−1) → Tone.Destination
   ```

   Post-reverb glue at these settings would re-compress every delay repeat
   and reverb tail (each S4 piano hit ducking its own tail 1–4 dB —
   directly against Phase 43.2's goal). Pre-effects placement stabilizes
   distortion drive and leaves tails untouched; the −1 dB limiter still
   catches the bounded wet sum.
3. **Implement as `Tone.Compressor`** inside `ToneEffectsChain`, not by
   splicing the native node: `Tone.Limiter` *is* a wrapped
   `DynamicsCompressorNode` (ratio 20, threshold −1 — note for the docs:
   20:1 is not a true brick wall), Tone↔native connects are symmetric and
   already used both directions (`engine.ts:431`, `engine.ts:130`), but a
   raw native node has no `Tone.Param`, is invisible to Tone's dispose
   graph, and won't survive `Tone.setContext()`. The native
   `this.compressor` stays as the no-Tone **fallback** path
   (`engine.ts:435-443`), which keeps working unchanged.
4. **Settings** (revised by the domain review): threshold **−10 dBFS**,
   ratio **3:1**, knee 12, attack **15 ms** (the
   `AUDIO_ENGINEERING_101.md` §10 experiment, safe only *after* the trim),
   release **200 ms** — not 250 ms, which equals the 8th-note period at
   120 BPM and phase-locks the gain modulation to the grid (the most
   audible possible breathing).
5. **Null the auto-makeup:** the native compressor applies non-defeatable
   makeup gain (~+1.7 dB at these settings) — without compensation,
   every uncontrolled A/B reads "after is louder = better" for the wrong
   reason. `makeupTrim` is calibrated by rendering a −20 dBFS sine
   (below knee) through the chain and asserting through-gain unity
   ±0.1 dB (browser-lane test). The comp also adds ~6 ms lookahead latency;
   measure the actual browser value and compensate it in every pre/post
   dynamics comparison.
6. **Constants move to `src/audio/constants.ts`** (window-free, already
   node-safe) so `audio-engineering.test.ts` imports real values — it
   cannot import from `engine.ts` (module-scope `window`, node-env test),
   and a test-only export would trip the gating `validate:dead-exports`.
7. **Docs made truthful:** fix the signal-flow diagrams in
   `specs/SYNTHESIS-ENGINE-ARCHITECTURE.md` (add a Status header while
   there), `specs/UNIFIED-AUDIO-BUS.md` (two diagrams, `:29` and
   `:620-622`; also flip its stale `Status: Proposed` — STATUS.md marks
   it complete), **and `specs/MIDI-EXPORT.md:790-791`** (a fourth
   contradictory location the audit found). All diagrams must include
   `Tone.Destination (Volume → Gain)` — omitting it is how the last
   diagram drift started. Update `mock-fidelity.test.ts` and the
   `toneEffects.test.ts` Tone mock (add `Compressor`).

### Automated verification

- **Offline lane (topology only):** extract chain construction into a pure
  `buildMasterChain()` returning the ordered node list; assert order. Render
  and record the actual pre-compressor peaks of S1 and the separate
  capacity fixture. No dynamics assertions here (§43.0 lane rules).
- **Browser lane (the real proof):** in one Chromium run, capture the
  clock-synchronized pre-compressor and post-makeup taps with effects
  bypassed; measure the processing delay with the calibration probe, align
  the taps, then compute `pumpingProfile` and assert max attenuation in the
  150 ms after the downbeat ≤ 4 dB with monotonic recovery. Do not
  compare S1's downbeat hat with its offbeat hat: the downbeat also contains
  kick, sub, stab, chord, and open hat, so the 6–12 kHz windows are
  confounded. Instead use a calibrated repeated-hat probe rendered once
  solo and once with a controlled broadband pileup, or solo/pair stems in
  the same graph; target < 2 dB change after alignment. Include the
  same-build repeat-null guard and the unity through-gain check from item 5.

### Demo session S1 — "Downbeat Pileup"

Respecified after the audit: v1 stacked three kicks + sub, which
phase-cancels and beats at 4–10 Hz — it sounds bad through a *perfect*
bus, confounding the demo. v2 slams the bus with spectrally separated
sources; the hats are the canary. 120 BPM; instrument ids are catalog ids
(`hihat` etc. are the procedural one-shots — deliberately, so Phase 43.3's
jitter reaches them too):

```
Hats:   x-x-x-x-x-x-x-x-    hihat
Kick:   x---------------    sampled:808-kick
Sub:    x---------------    synth:sub
Stab:   x---------------    synth:stab
Chord:  x---------------    chord
OpenHat:x---------------    openhat
Snare:  --------x-------    sampled:acoustic-snare
Clap:   --------x-------    sampled:808-clap
```

### How to hear it

Headphones, fixed volume, loop 4 bars, listen **only to the hi-hats**.

- **Before:** on beat 1 the mix "flinches" — the hats duck for a
  syllable's length after each pileup, then swell back. Phase 43.0 records
  how much work the −1 dB limiter is actually doing.
- **After (measured gain staging + compressor):** hats keep ticking evenly through
  the downbeat; loud moments read dense, not wounded. Honest expectation:
  the pileup itself still sounds like one thick hit — dynamics repair
  doesn't un-stack an arrangement; it stops the *rest* of the mix paying
  for it.
- **Warning:** any live in-app before/after toggle is loudness-biased
  (makeup gain, trim changes). Only the audition page's level-matched
  comparison is valid. A raw null is expected to contain the global trim
  throughout every non-silent passage, so it cannot localize the dynamics
  change; use the delay- and gain-compensated residual plus
  `pumpingProfile` to inspect the downbeats.

---

## Phase 43.2 — First contact is consonant (defaults)

### Change

1. **Scale lock ON in canonical new-session state, not only UI state.** A
   `grid.tsx:15-19` flip alone is insufficient: `useSession.ts:210-219`
   creates a server session without `scale`, `createInitialSessionState`
   (`shared/session-defaults.ts`) currently adds no scale, and
   `session-analysis.ts:322-344` reports no scale when the stored field is
   absent. Move the scale constants to a window-free shared module and define
   separate `DEFAULT_NEW_SESSION_SCALE_STATE` (locked) and
   `LEGACY_MISSING_SCALE_STATE` (unlocked) values. Have every production
   new-session creator (browser, REST/mock, MCP allocation) persist
   `{ root: 'C', scaleId: 'minor-pentatonic', locked: true }` through
   `createInitialSessionState`; remix preserves the source scale after legacy
   normalization. A shared `normalizeSessionScale` must run at every load
   boundary—not just metadata normalization—including KV reads in
   `worker/sessions.ts`, Durable Object KV/storage reads in
   `worker/live-session.ts`, mock/REST hydration, and the client's
   `LOAD_STATE` path in `state/grid.tsx`. It maps an absent legacy field to an
   explicit unlocked value before the new locked default can be consulted,
   and is covered by versioned legacy fixtures at each boundary.
   `scale.locked` remains canonical,
   session-scoped synced state — **not localStorage** — so an explicit
   unlock survives reload and propagates to other clients. Preserve old
   behavior for legacy records that lack `scale`: normalize those to an
   explicit unlocked C-minor-pentatonic state on read/migration rather than
   silently re-locking an existing composition. The lock constrains note
   entry, reducing out-of-scale accidents; it does not guarantee that every
   simultaneous in-scale interval is consonant.
2. **Reverb wet 0 → 0.15, with bass protection:** a master *insert* at
   wet 0.15 also wets the kick/808 into low-mid mud. Restructure inside
   `ToneEffectsChain` as a parallel branch —
   `input → HPF 250–300 Hz → Freeverb(wet=1) → wetGain(0.15)` summed with
   dry; optional 10–20 ms pre-delay for transient separation.
   **Truth-pin first (bug found in audit):** the plan said "keep
   roomSize 0.7", but `setReverbDecay` maps `roomSize = decay/10`
   (`toneEffects.ts:193`) and the synced default `decay: 2.0` therefore
   applies **roomSize 0.2** the moment state syncs — the shipped room is
   initialization-order-dependent. Fix the mapping, ship roomSize ≈ 0.6 /
   dampening 3000. (Consider pulling Phase 43.5's convolution swap
   forward here — Freeverb's metallic combs on exposed piano are the
   weakest link of "sounds expensive". Reference point, research doc
   §4.1: Learning Synths' only master polish is a parallel ConvolverNode
   at **5 % wet on everything**, behind a high/low quality switch — low
   wet + convolution quality, degradable on weak devices, is a reference
   pattern worth testing here.)
3. **No in-session seeding — DECIDED 2026-08-04, resolved by pointing at
   the home page.** Both variants of the "nobody faces silence" item —
   auto-seeding new sessions (v1/v2 of this plan) and the empty-state
   "start from a groove" offer panel (`ABLETON-PLAYGROUND-LESSONS.md`
   disposition 1) — were rejected: **the landing page's example-session
   picker already is that surface.** A user who reaches an empty session
   passed a screen offering playing grooves and chose blank; a second
   in-session copy of that offer duplicates the home page. The empty
   grid is a chosen canvas, not a cold start. Consequences kept from
   this decision: the landing page is confirmed as the first-contact
   surface (which raises the stakes on item 6 below), and the
   cold-start work in this phase is scale lock + reverb, not content
   seeding. (The audited auto-seed blast-radius checklist — three
   creation call sites, MCP contract, four e2e emptiness assertions,
   autosave race guard — lives in this file's v2 git history should the
   decision ever be revisited.)
4. **Default step velocity → MIDI 90 (not 100, shared with export):**
   - v1's edit (`velocity.ts:19`) is a **no-op** — the live path is
     `pLock?.volume ?? 1` (`scheduler.ts:484`, `scheduler.worklet.ts:240`)
     → `velocityFromMultiplier(1)` = 127 via `MIDI_VELOCITY_MAX`;
     `DEFAULT_MIDI_VELOCITY` is a non-finite-input sentinel and default
     parameter (`velocity.ts:26`, `sampled-instrument.ts:542,671`,
     `engine.ts:1562`). Leave that sentinel alone; move/re-export
     `MIDI_VELOCITY_MAX` from a window-free shared module and add
     `DEFAULT_STEP_MIDI_VELOCITY = 90` beside it.
   - Do **not** replace the scheduler's single `volumeMultiplier` with
     `90/127`; that scalar currently also drives synth/tone/advanced gain and
     would lower every engine while leaving layer choice and gain coupled.
     Introduce a shared pure resolver returning
     `{ midiVelocity, noteGain, hasExplicitLock }`. Pin the unlocked tuple to
     `{ midiVelocity: 90, noteGain: 1, hasExplicitLock: false }`: the new
     default chooses an mf layer/timbre without silently lowering every
     engine's established output level. For an explicit p-lock `v`, clamp
     `v` to 0…1, set `midiVelocity = round(127 * v)`, and define the level
     curve exactly as `noteGain = 0` when `v = 0`, otherwise
     `10 ** ((-40 * (1 - v)) / 20)`. This maps positive locks over roughly
     40 dB while retaining a real mute at zero.
   - Carry both fields through the main-thread and worklet `NoteEvent`
     contracts. Sampled playback uses `midiVelocity` for layer/timbre and
     `noteGain` for amplitude. Basic and advanced synth paths also retain
     `midiVelocity` as the timbre-control input used by Phase 43.6's filter
     mapping while applying `noteGain` to amplitude; tone and procedural
     paths may ignore timbre velocity until they define a mapping, but must
     preserve the contract and use `noteGain` exactly once.
   - MIDI export must consume the same constant. `shared/midi-core.ts`
     currently defines `DEFAULT_VELOCITY = 100` percent and returns it for
     unlocked notes, which midi-writer-js maps to MIDI 127. Derive its
     percentage
     (`round(DEFAULT_STEP_MIDI_VELOCITY / MIDI_VELOCITY_MAX * 100)`) from
     the shared MIDI-domain constant rather than maintaining a second
     default. Add a parsed-MIDI
     regression assertion that an unlocked exported note is velocity 90
     (allowing the library's documented integer rounding), while explicit
     velocity locks retain their existing mapping.
   - **90, not 100**, because the shipped piano/marimba layer boundary
     centers at 100.5 — with Phase 43.3's crossfade, velocity 100 would put
     every unaccented note inside the blend zone (two recordings summed =
     comb-filtered attack, 2× voices). 90 stays cleanly inside mf; Phase
     43.3 humanizes `noteGain` without moving `midiVelocity` across layers.
5. **Decouple velocity-layer choice from gain** as part of that resolver:
   the current
   volume p-lock both selects the layer and scales gain linearly
   (`scheduler.ts:381-385`, `sampled-instrument.ts:603-606`). Recorded layer
   level differences can therefore compound the gain change, and timbre and
   level cannot be tested independently. Make `midiVelocity` select/blend
   layers and `noteGain` apply the perceptual (~40 dB) curve exactly once.
   Add main/worklet contract-parity tests so neither path silently collapses
   the fields back into one multiplier.
6. **Landing demo plays the sampled kit:** `App.tsx:663`
   `LANDING_SAMPLES = ['kick','snare','hihat','clap']` routes first
   contact through the weakest procedural drums. Point it at the 808
   sampled kit. (Procedural DSP itself is Phase 43.6.)

### Automated verification

- Property: with lock on, arbitrary ChromaticGrid clicks yield only
  in-scale pitches (fast-check, seeded via the repo's setup).
- Lifecycle: browser create → reload and MCP `create_session` →
  `analyze_session` both report the persisted locked default; unlock in one
  of two clients converges to the other and remains unlocked after reload;
  a legacy state with no `scale` migrates to the documented unlocked value.
  Client/server canonical hashes change with root, scale, and lock and remain
  equal for the same normalized state.
- Render the two domains separately. First force a single sample/layer and
  assert that p-lock 0.5 vs 1.0 follows the new perceptual gain transfer;
  verify this regression fails on the current linear-gain path. Then use a
  multi-layer piano fixture to assert that velocity still selects the
  expected softer/darker layer independently of the gain-law assertion.
- **Corrected from v1:** `golden-mutations.test.ts:28,71,108` imports
  `DEFAULT_SCALE_STATE` directly — the flip changes its golden base
  states; update or pin them in the same change. `canonicalHash` currently
  excludes `scale` (`canonicalHash.ts:43,121`), as does the server twin in
  `worker/logging.ts`; that is a sync-detection gap, not evidence that hash
  parity is unaffected. Add normalized scale state to both canonical forms
  and extend the completeness/parity tests so clients that diverge only in
  root, scale, or lock cannot report the same state hash. The remaining
  `locked:false` test inventory is:
  `StepSequencer.playback-lifecycle.test.tsx:26`,
  `useSession.transitions.test.tsx:67`,
  `App.session-transitions.test.tsx:28`,
  `session-analysis.test.ts:211,336,345`,
  `invariants.property.test.ts:723`, `validation.test.ts:266-272`,
  `reducer-mutation-equivalence.test.ts:87`,
  `sync-layer-coverage.test.ts:61`, `mcp-journeys.test.ts:780`,
  `e2e/session-api-contract.spec.ts:285-287`,
  `e2e/mock-publish-contract.spec.ts:30,64`. Scale-locked ChromaticGrid
  is also a **visual-regression change**: the gated screenshot lanes
  (`e2e/visual.spec.ts`, `e2e/populated-visual.spec.ts`) need re-baselining
  via `visual-baselines.yml`.
- Playwright: 5 random melodic-cell clicks in a fresh session never
  out-of-scale; unaccented capture matches the mf layer by centroid;
  landing demo (item 6) plays the sampled kit, verified by capture
  centroid vs the procedural baseline.

### Demo session S2 — "Sour vs Sweet"

Corrected from v1: monophonic marimba can't produce the promised beating —
dissonance needs simultaneity. Both variants gain a sustained drone
(`synth:pad`, root C, tied full bar) under the melody. Same rhythm,
120 BPM, marimba melody:

```
A (chromatic accidents):  x-x-x-x-x-x-x-x-   melody offsets 0,1,6,3,8,1,11,6
B (C minor pentatonic):   x-x-x-x-x-x-x-x-   melody offsets 0,3,5,7,10,12,10,7
Drone (both):             xxxxxxxxxxxxxxxx   synth:pad, pitch 0; tie=true on steps 1–15
```

(Melody offsets are semitones from C4, applied to the eight active steps
in order — see Appendix A note on notation limits. Runtime ties extend only
through active continuation steps whose p-lock has `tie: true`; the drone
fixture deliberately materializes all 15 continuations.)

Plus the live protocol: fresh session, marimba track, click 8 chromatic
cells without looking; once on each build.

### How to hear it

- **A / before:** against the drone, offset 1 *grinds* (minor 2nd —
  slow throb/wobble, "sour"), 6 is the tritone ("villain music"),
  11 beats hard. Random clicks land on these constantly.
- **B / after:** the chosen pentatonic example avoids those specific
  semitone/tritone collisions against the C drone; random entry has fewer
  out-of-key options. Scale lock is a guardrail, not a proof that arbitrary
  chords cannot clash.
- Reverb: play S4 dry vs wet 0.15 — dry stops dead ("phone speaker in a
  closet"); with the room, notes hand off. Toggle mid-tail if unsure.
  Then confirm the kick did NOT get roomier (that's the HPF branch
  working).

---

## Phase 43.3 — Humanization

### Change (hook point corrected by two audits independently)

1. **Gain humanization at the schedulers, not `velocityFromMultiplier`.**
   v1's seam fails three ways: both call sites (`scheduler.ts:383`,
   `scheduler-worklet-host.ts:272`) sit in the *sampled-only* branch —
   synth/tone/advanced/procedural paths (2/3 of the catalog, including
   S1's hat canary) would stay photocopies; at that seam velocity only
   selects the layer, so jitter would produce **zero level change** (the
   plan's original normalized-correlation test would fail because gain
   scaling alone leaves normalized correlation at 1.0); and the
   p-locked-vs-unlocked distinction is already erased upstream
   (`pLock?.volume ?? 1`). Also `velocity.ts` is pinned pure by
   `velocity.property.test.ts` (monotonicity, idempotence) and
   `scheduler-velocity-routing.test.ts:79` — don't make it stateful.
   **Design:** after Phase 43.2 resolves
   `{ midiVelocity, noteGain, hasExplicitLock }`, apply a shared pure
   `humanizeNoteGainDb(noteGain, hasExplicitLock, instrumentClass, rng)`.
   It changes `noteGain` only; `midiVelocity` remains stable so an
   unaccented note cannot randomly cross a sample-layer boundary. Carry the
   explicit-lock bit and the two resolved fields through both scheduler/
   `NoteEvent` contracts (`scheduler.ts:461-497`; worklet path in
   `scheduler-worklet-host.handleNoteEvent`). P-locked steps stay exact, and
   parity tests feed identical events/seeds through main and worklet paths.
2. **Depth in dB, not Song Maker's raw formula.** SM's `0.8v + 0.2·rand`
   yields only 0–1.9 dB because Tone maps velocity→gain linearly;
   transplanted as a perturbation to the authored scalar before Phase 43.2's
   ~40 dB perceptual curve it becomes ~8 dB of jitter — a drunk drummer.
   Apply the offset after the gain curve instead. Targets: **±2–3 dB tonal,
   ±1–1.5 dB percussion, kick/808/sub exempt or clamped ±1 dB**
   (four-on-floor steadiness is genre-correct); derive the multiplier
   band from those. Uniform distribution is fine (shape is inaudible at
   this depth); loudness calibration measures at the humanized mean.
3. **Seed and iteration:** keyed `(trackId, step, loopIteration)` —
   deterministic renders, varies loop-to-loop. **`loopIteration` does not
   exist yet**: add a counter where `advanceStep` wraps, in *both*
   schedulers (`scheduler.ts:299`, `scheduler.worklet.ts:186`), carried on
   `NoteEvent`. Budget it as a real sub-task. Multiplayer is unaffected
   (audio is client-local).
4. **Round robin — premise corrected:** the MuldjordKit snare/kick RR
   recipes are among the **rejected** 2026-07-10 candidates (see
   Phase 43.4); they cannot be "promoted" as v1 claimed. Engine-side RR
   is verified ready (`sample-selection.ts:109-117`); content arrives via
   Phase 43.4's re-review. One open verification item before relying on
   it: confirm the pipeline maps recipe `roundRobin:{group,index,count}`
   onto the runtime manifest fields `roundRobinGroup`/`roundRobinIndex`
   that `sampled-instrument.ts:693-702` reads — the shapes differ and the
   renderer wasn't traced.
5. **Velocity crossfade:** enable via manifests for *tonal* multi-layer
   instruments (recipes already carry values 6–8; v1's 10–15 was
   over-wide). **Skip crossfade on drums** — blending two snare takes
   smears the transient; RR is the right mechanism there.

### Automated verification

- Property: over 256 unlocked triggers, jittered multipliers within the
  dB band for the track's class, variance > 0, fixed seed reproduces
  exactly; p-locked steps bit-exact. `velocity.ts` untouched (its
  property tests keep passing unmodified — that's the point).
- Render: unlocked repeated hits have non-zero per-hit RMS/peak dB
  variance inside the class budget; locked hits have zero variation.
  Normalized `hitCorrelation < 0.99` is required only once an RR manifest
  selects different recordings, because normalized correlation deliberately
  ignores a pure gain change. Extend `sample-selection.test.ts` to assert
  consecutive same-velocity RR hits select different files.
- Crossfade render: around each manifest-declared layer boundary, render the
  same velocity sweep with crossfade disabled (hard-switch baseline) and
  enabled. Level-match hit windows and compute adjacent
  `logSpectralDistance` only across the defined blend window; require the
  enabled maximum to be ≤ 75 % of the hard-switch maximum. Do not require
  monotone centroids—recorded layers need not be spectrally ordered, and
  within-layer deltas can make a median-step denominator zero. Outside the
  blend window, assert exactly one layer/voice is selected.

### Demo session S3 — "Machine Gun"

```
Roll (bars 1–2):  xxxxxxxxxxxxxxxx   sampled:acoustic-snare
Groove (bars 3–4): o-o-x-o-o-x-o-X-  sampled:brushes-snare
Hat:              x-x-x-x-x-x-x-x-   sampled:acoustic-hihat-closed
```

Run the roll with **no velocity lane edits** — the unlocked path is the
one that receives jitter.

### How to hear it

- **Before:** the 16th-note roll is a stuck sample/typewriter — within a
  few repeats you can predict the next hit exactly.
- **After:** each hit lands slightly different (level; with RR, a
  different recording). Subtle per hit, enormous over four bars — the
  difference between a loop you mute and one you leave running.
- Proof: capture two consecutive loop passes, null them (`N`). Before:
  silence. After: audible residue on every hit.

---

## Phase 43.4 — Sample content and loudness calibration

### Premise corrected (the audit's most important finding)

v1 said the v2 packs were "blocked solely on listening approval." Wrong:
**the blinded listening review ran on 2026-07-10 and rejected all ten
decision-ready candidates** — `app/sample-pipeline/instrument-upgrades.json`
records `programStatus: "evaluation-complete-current-retained"`,
`humanReview.result: "current-preferred-for-all-decision-ready-candidates"`,
`"I kept preferring the current samples in all the blind tests"`,
`candidatePromotions: 0`; per-candidate rejections sit in
`sample-pipeline/decisions/<id>.json`; and
`test/sample-pipeline-upgrade-ledger.test.ts:54-62` asserts exactly this
state in the ordinary CI lane. (The
`"mapping-reviewed-candidate-not-listening-approved"` string v1 quoted is
the *pre-review* stage marker in `recipes/*.dispositions.json`, and
steel-drums doesn't even carry it — its `promotion.status` is
`"blocked-pending-human-review"` with `candidateAssetsCommitted: false`.
Also: "143 RR files" was over-sold — 46 of steel-drums' 143 files sit in
multi-variant RR groups; the rest are singletons.)

### Change

1. **Diagnose before re-building.** The candidates lost blind tests
   despite better mapping depth — find out why before spending again
   (candidate levels? attack trims? the AAC encodes? the blend zones?).
   The Phase 43.0 metrics run over current-vs-candidate renders is the
   diagnostic: per-note `loudnessKMax`, `leadingSilenceMs`, centroid-by-
   velocity, and null-test listening in the audition page.
   Two reference datapoints to steer the diagnosis (research doc §4):
   **Learning Music's piano uses the same ~6-semitone root spacing as ours
   and a SINGLE velocity layer** (Live's grand, top layer only), while
   checked Song Maker metadata identifies Pro Tools
   but does not establish the library's exact provenance or batch structure.
   Therefore test **source consistency and level discipline alongside root
   density and layer count** instead of declaring a winner in advance. That
   reframes the options: (a) re-level and re-trim the *current* sets as one
   batch (the lowest-scope candidate); (b) re-cut candidates for consistency
   rather than depth;
   (c) if evidence supports it, commission or license **one coherent
   recording batch** for the default-visible instruments rather than
   assembling more free libraries. Reference audio is evidence, never a
   reusable asset; provenance and license receipts remain mandatory.
2. **Re-review under the existing process, not a lighter one.** v1's
   "5 ABX trials, promote on ≥4, or on payload if indistinguishable"
   under-cuts `specs/SAMPLE-PIPELINE-V2-PLAN.md`, which requires
   hash-bound build reports, **three-anchor minimum plus full-set review
   of all changed files**, a committed `decisions/<id>.json`, and an
   atomic, separately-authorized promotion (`:23,:200,:214,:266,:268`).
   The audition page is the *rig* for that protocol, not a replacement
   bar. A promotion also updates the upgrade ledger and the four
   hard-coded expectations in
   `test/sample-pipeline-upgrade-ledger.test.ts:54-62`.
3. **Cross-instrument loudness window, wired where it actually gates:**
   `loudnessKMax` of each instrument's mf note near C4 within ±2.5 dB of
   the piano reference. Put it in `scripts/validate-sample-quality.ts` —
   which `validate:all` runs under the gating `instrument-validation` CI
   job — because **`validate:samples` is wired into no CI job, no hook,
   and not `validate:all`** (`validate-all.ts:45-65`); extending it alone
   reproduces the plan's own opening critique. Fix the stale "gate" claims
   in `ROADMAP.md:2366-2372` and `VOLUME-VERIFICATION-ANALYSIS.md:124,310`
   while there. Out-of-window instruments get manifest `gainDb` trims
   (the field ships unused — 1 of 26 manifests), including the
   percussion-class −3…−5 dB trims from Phase 43.1's headroom budget
   (prerequisite: extend `instrument-classification.ts`, which today has
   only `DRUM_INSTRUMENT_IDS` — no bass/sub class, and no kick-vs-hat
   distinction; Phase 43.5 needs the same extension).
4. **Content defect fixes** (open audit items): string-section leading
   silence retrimmed (`G2` 96.8 ms, `A4` 29.1 ms —
   `SAMPLE-AUDIT-2026-06-29.md:154-155`); loop-point investigation for
   string-section/french-horn/alto-sax (`:236`); **percussion onset gate
   < 5 ms** — MP3 encoder priming (~13–26 ms) survives some decoders as
   a late kick, an audible groove smear; compensate via the per-sample
   manifest `offset` field (already honored,
   `sampled-instrument.ts:612-618`) rather than re-encoding, and add one
   browser-lane assertion comparing browser-decoded onset vs the Node
   baseline for the 808/acoustic kits; DC check `|mean| < 1e-3`.

### Demo session S4 — "Piano Ballad"

72 BPM, sparse on purpose — silence is where sample quality lives.
Melody `sampled:piano`, offsets from C4 on the active steps in order;
crescendo bar is the same note (offset 0) with the velocity lane stepped
0.3 / 0.45 / 0.6 / 0.75 / 0.9 / 1.0 on six consecutive 8th steps.

```
Piano:   X-----x---o-----   offsets 0,3,7 · standard gate/release, no ties
Piano 2: ------------x--X   offsets 10,12
Crescendo:x-x-x-x-x-x-----  offset 0 on all six hits; velocities
                             0.3 / 0.45 / 0.6 / 0.75 / 0.9 / 1.0
```

### How to hear it

- **Repitch artifacts (diagnostic):** run a chromatic scale C3→C5 — between
  roots the tone may subtly speed up and shift "throat", snapping natural
  at each root. If the re-review proves root spacing is the winning cause
  and promotes a denser map, the after should be more even. If re-leveling
  or re-trimming the current set wins, mapping density intentionally stays
  unchanged; report that outcome instead of promising improvement here.
- **Layer cliff (before):** on the crescendo, timbre is constant then
  *jumps* bright at the boundary. Crossfade should smooth the existing
  boundary. More velocity zones are conditional on a candidate surviving
  the existing blind-review process; do not describe them as shipped until
  that happens.
- **Loudness matching:** piano + steel-drums + finger-bass at equal track
  volumes — before, one dominates; after, they sit without touching
  faders.

---

## Phase 43.5 — Space: panning and reverb quality

### Change

1. **Per-track pan** (state default 0, `MixerPanel` knob, auto-spread
   ±8–20 % alternating by add-order; kick/bass/sub-class centered —
   requires the `instrument-classification.ts` extension from 43.4).
   Define units once: canonical state, WebSocket/REST/MCP payloads, and the
   engine use a normalized float in `[-1, 1]`; the UI displays percent and
   converts at its boundary. Thus auto-spread is canonical ±0.08…0.20.
   Session notation uses signed integer percent for readability, so
   `[pan:-20]` parses to `-0.20` and serializes back to `-20`; it never sends
   `-20` to `TrackBus.setPan`. Schemas reject non-finite/out-of-range
   canonical values rather than relying on engine clamping, with round-trip
   fixtures covering UI, notation, MCP, state, and engine boundaries.
   Correction from v1: `TrackBus.setPan` *is* called — by
   `TrackBusManager.setTrackPan` (`track-bus-manager.ts:120-123`); it's
   that manager method that has zero production call sites. **Name the
   reconciliation site:** something must apply `track.pan` on session
   load *and* on every remote mutation (the `useTrackInstrumentReconcile`
   pattern); a knob that only works for the local clicker is the bug
   `state-adapters` history warns about. The reconciliation site is
   `AudioEngine.syncGridAudioState`, which must apply `track.pan` on initial
   load and every remote state update. Also fix both initialization races:
   state can arrive before `TrackBusManager` exists, so mirror
   `AudioEngine.pendingTrackVolumes` with `pendingTrackPans`, replay it when
   the manager initializes, and clear it on track removal/dispose. Once the
   manager exists, `setTrackPan` can still arrive before its lazy bus:
   `setTrackPan` currently drops a value when the bus does not exist,
   whereas volume is retained in `desiredVolumes`. Add an equivalent
   `desiredPans` cache, clamp/store before bus creation, apply it in
   `getOrCreateBus`, return it from `getTrackPan`, and clear it in
   `removeBus`/dispose.
2. **Reverb quality:** if not already pulled into 43.2 — generate a
   `Tone.Reverb` convolution IR async at init, hot-swap when ready,
   Freeverb as fallback (`toneEffects.ts:8` documents the trade).
3. **Parameter-slew convention (ships with the first new draggable
   param):** Learning Synths smooths *every* parameter change in the DSP
   (`global_slew_time` = 50 ms — see
   `specs/research/ABLETON-LEARNING-SYNTHS-ENVELOPES-ANALYSIS.md`), so
   dragging never zippers. Keyboardia declicks note starts (3 ms) but
   has no uniform rule for parameter changes. Adopt one at the engine
   boundary — 30–50 ms `setTargetAtTime` for any continuous control —
   applied to the new pan knob here, retrofitted to the XY pad, and
   inherited by any future ADSR editing. One rule, all engines; kills a
   bug class the AUDIO-ENGINEERING docs currently chase case-by-case.

### The real blast radius (replaces v1's six-item list)

**Wire path:** `messages.ts:38` (`set_track_pan: 'track_pan_set'` — also
feeds `MUTATING_MESSAGE_TYPES`), `message-types.ts:69,127`,
`live-session.ts:1000,2050-2066` (handler validates finiteness and the
normalized `[-1, 1]` range), `worker/invariants.ts:289-296,505-516`
(validate + repair), `worker/validation.ts:189-190` (the REST/
publish boundary — separate from the WS one), `state-adapters.ts:63-69,
97-105` (**both** conversion directions — where `focus` silently vanished
for months), `grid.tsx` + `types.ts` (`SET_TRACK_PAN`),
`sync-classification.ts`, `multiplayer.ts` (both directions). Make the
boundary policy uniform: UI and notation convert to normalized units first;
REST, WebSocket, and MCP reject non-finite or out-of-range values with no
mutation; invariant repair may use generic `clamp` only for corrupted stored
state; the engine's clamp remains defense-in-depth, not public semantics.
Use one shared range predicate and table-driven cross-transport tests rather
than adding another transport-specific validator.

**Gates that block the commit/build:**
`scripts/validate-sync-checklist.ts:41-57,62-78` — a **hand-maintained**
list run by pre-commit and `validate:all`; it has already drifted
(`set_track_swing`, `set_track_name`, `euclidean_fill` are missing from
it), so the validator remains green when an entry is absent — add pan
explicitly.
`boundary-contracts.test.ts` (eight hardcoded lists),
`canonical-hash-completeness.test.ts` (exists to fail on unhashed synced
props — both pan and Phase 43.2's normalized scale must change
`canonicalHash`),
`state-hash-parity.test.ts`, `sync-layer-coverage.test.ts:38-61`,
`reducer-mutation-equivalence.test.ts`, `mutation-tracking.test.ts`,
`arbitraries.ts:157-160,196-204,438-445` (without `arbTrack` + action
arbitraries generating pan, `sync-convergence.property.test.ts` proves
nothing about it), `check:worker` (tsc + dry-run deploy).

**Surfaces:** `mcp-edits.ts:27-43` executor — pan is a **separate
`set_track_pan` operation**, not an `add_track` field (add_track carries
neither volume nor transpose today); `mcp.ts` Zod schema;
`mcp-evals.ts` + `evals/execution-benchmark.json` (track-shape payloads
feed gating eval oracles); **MIDI: decide and write down "pan is not
exported"** (midiExport emits no CC today; add the row to
`specs/MIDI-EXPORT.md`'s fidelity table); `MixerPanel.tsx` +
`MixerPanel.test.tsx` + `e2e/mixer-layout.spec.ts`; **mobile: explicitly
desktop-only v1** (MixerPanel renders only from `StepSequencer.tsx:635`;
the portrait UI has no mixer surface); `example-sessions.ts` (+ its
schema test) gets the default; `SESSION-NOTATION.md` gains `[pan:-20]`
with the explicit percent-to-normalized conversion plus a Version History
row and Source-of-Truth header update.

### Automated verification

- Sync: pan mutations converge (property), hash completeness/parity
  updated, golden mutations extended.
- Render (offline lane, native pan nodes): measure S5's unpanned baseline,
  then set a target band from that capture; do not predeclare a master
  `midSideRatioDb` range. Centered kick/bass stems must have balanced L/R
  output and **no increase** in S/M ratio relative to their own pre-pan
  source baselines—`StereoPannerNode` at center preserves intrinsic stereo,
  so an absolute stem target such as ≤ −40 dB is impossible for the current
  stereo kick. Mono fold-down RMS stays within 1 dB of the pre-pan render (keeps
  `AUDIO_ENGINEERING_101.md` §13's legitimate concern as a guard, not a
  veto). Pin effects wets in the render — Freeverb/chorus decorrelate on
  their own.
- Unit: pan state received before audio/manager initialization survives in
  `pendingTrackPans` and replays on init; `setTrackPan` before lazy bus
  creation is observable through `getTrackPan`, applies when the bus is
  created, and both caches are cleared on removal/dispose. Boundary tests
  prove `-20% ↔ -0.20` without clamping to hard left.
- Playwright: knob drives `__inspectTrackBuses__()` pan values after local
  edits, reload, and a remote mutation.

### Demo session S5 — "Wide Kit"

Pan values below use the UI/notation percentage form; divide by 100 for the
canonical and engine value.

```
Kick:   x---x---x---x---   sampled:acoustic-kick        pan 0
Snare:  ----x-------x---   sampled:acoustic-snare       pan −10
Hat:    x-x-x-x-x-x-x-x-   sampled:acoustic-hihat-closed pan +20
Ride:   --x---x---x---x-   sampled:acoustic-ride        pan +35
Conga:  --x--x----x--x--   conga                        pan −30
Shaker: -x-x-x-x-x-x-x-x   shaker                       pan +12
Bass:   x-----x-x-----x-   sampled:finger-bass          pan 0
```

### How to hear it

Headphones required. **Before:** eyes closed, there is no controllable
per-track placement; intrinsic stereo samples retain their width, but their
centers overlap and the mix can feel congested. **After:** the kit occupies
intentional *places*; instruments fight less because their apparent centers
are separated. Then the phone-speaker check: the same session folded
to mono should sound essentially unchanged — if it got quieter or hollow,
the spread is too wide.

---

## Phase 43.6 — Synthesis depth (presets + procedural drums)

### Change

1. **Second oscillator for the bare presets** (23 of 32 lack `osc2`; 19
   have neither osc2, LFO, nor filter envelope): detuned pairs, mix ~0.4,
   via the built-and-tested machinery (`synth.ts:778-798`). **Detune by
   register** (domain-review correction): 7–12 cents for leads/pads/keys;
   ≤ 5 cents for bass presets; **exclude `sub`** — dual detuned
   oscillators below ~80 Hz read as pitch instability, not warmth.
2. **Velocity → filter cutoff** in `SynthVoice`:
   `effectiveCutoff = cutoff · curve(velocity)`, **calibrated so the new
   default velocity (90) lands ≈ 0.85–0.9 of preset cutoff** — otherwise
   every synth ships darker than today as a side effect. Soft notes
   darker, not just quieter — the single biggest "sounds synthetic" fix,
   all 32 presets.
3. **Filter envelope for `acid`** (has none today;
   `AUDIO_ENGINEERING_101.md` §11's 600 Hz → 4.6 kHz sweep).
   *Strategic alternative worth costing first:* Keyboardia's
   `advancedSynth` engine already has the architecture the references
   point at — dual osc + noise layer + filter envelope + LFO
   (`advancedSynth.ts:195-291`), i.e. most of Learning Synths' 32-param
   voice (research doc §4.1) minus PWM and the separate mod-envelope
   routing. Migrating the flagship basic presets (`bass`, `lead`, `pad`,
   `strings`, `acid`) onto the advanced engine may beat enriching
   `SynthVoice` preset-by-preset — one decision, then data. The
   migration has a second payoff documented in
   `ABLETON-LEARNING-SYNTHS-ENVELOPES-ANALYSIS.md`: runtime ADSR control
   (`setAttack`/`setRelease`, XY `envelope-shape`) reaches **only**
   advanced-synth tracks today, so every flagship preset migrated is one
   that a future envelope editor controls for free. (Long-term note,
   explicitly out of scope: Learning Synths runs a WASM/RNBO patch in an
   AudioWorklet — browser synthesis's real ceiling. Keyboardia already
   ships worklet infrastructure (`pitch-shift.worklet.ts`), so a
   worklet-DSP voice is feasible someday; nothing in this plan depends
   on it. Trigger criteria and a decision-sized prototype spec live in
   **Appendix C**.)
4. **Procedural drum DSP pass** (the audit's biggest scope gap — the
   research doc diagnoses these as worst-in-app and v1 fixed none):
   - **Sweep-phase bug (real DSP bug, found in review):** every swept
   generator computes `sin(2π·f(t)·t)` (`samples.ts:192` kick, `:274`
   tom, `:372` conga, `:631` zap). With time-varying f, instantaneous
   frequency is f(t) + t·f′(t) — the kick's sweep is far steeper than
   designed (the "boingy" kick is a math error). The current kick law
   `150·exp(−10t) + 40` also starts at 190 Hz, not the 150 Hz target used
   elsewhere in this plan. Make both changes explicitly: use
   `f(t) = 40 + 110·exp(−10t)` for a 150→40 Hz sweep and accumulate phase
   with `phase += 2π·f(t)/sampleRate`. Apply the phase-integral correction
   to each swept generator, with each one's documented frequency law.
   - Hi-hat: 6 detuned square partials → ~7 kHz highpass (the 606/909
     recipe) instead of raw white noise; snare: add ~330 Hz body mode +
     bandpass the noise; kick: add a 2–4 kHz click layer.

5. **Preset hygiene pass** (lens from the envelopes analysis, its
   "decay has no effect when sustain is up" walk-through): audit the 51
   presets for do-nothing parameters — several native presets with
   sustain ≥ 0.9 carry decay values that never sound. Also note: tied
   notes (shipped) make slow attacks musically reachable for the first
   time — the "attack < 0.1 s" rule (`synth.ts:232`) was validated when
   every note gate was ≤ 90 % of one step. Keep fast *defaults* (grid
   audibility), but pad/string presets may deserve a tie-aware second
   look once an envelope editor exists. The editor itself, parameter
   descriptors, and XY macro sub-ranges are feature-track work — the
   envelopes analysis's ranked recommendations are the natural
   **Phase 45 candidates**, not part of this phase.

### Automated verification

- Render per upgraded preset: osc2 sustain shows the detune beat period
  via autocorrelation (baseline: none); velocity→filter — centroid at
  v=0.3 ≥ 25 % below v=1.0 (baseline: equal); default-velocity render
  within 1 dB and 10 % centroid of today's (the calibration guard).
- Procedural: kick render's instantaneous-frequency track matches
  `40 + 110·exp(−10t)` (150 Hz at t=0, asymptotic 40 Hz), proving both the
  frequency-law and phase-integral fixes; hat spectrum
  ≥ 80 % energy above 5 kHz (baseline: white).
- Preset schema test: every intended preset defines `osc2` (data
  regression guard).

### Demo session S6 — "Acid Line"

```
Acid: x-o-x-x-o-x-o-X-   synth:acid, offsets 0,0,12,3,3,15,10,12
Pad:  xxxxxxxxxxxxxxxx   synth:strings, one pitch; tie=true on steps 1–15
```

### How to hear it

- **Acid before:** every note identical brightness; dynamics are a
  doorbell played louder/softer. **After:** ghost notes dark and rubbery,
  accents *squelch* open (TB-303 "wow") — dynamics carry tone.
- **Pad before:** the held chord is a static buzz — nothing moves.
  **After:** the sustain slowly shimmers as the pair drifts in and out of
  phase — why a real string patch never sounds still.
- **Kick before/after:** before, "boingy" (the sweep bug) with no attack;
  after, a defined thump with a click you can feel on a laptop speaker.

---

## Cross-app protocol — the Song Maker parity test

Run after 43.1–43.3 land, again after 43.4–43.6.

### Build the same music in both apps

Both apps have a **marimba** and default to **120 BPM**. (Fairness
footnote: Keyboardia's marimba has no sample root at C4 — the default
note repitches +1 st from the 59 root; its piano has a true 60 root. Song
Maker's nearest root is ≤ 1.5 st everywhere. That asymmetry is part of
what's being measured.)

**Melody** ("parity riff", two bars of 8th notes, C major, repeat):

```
Bar 1:  C4 E4 G4 E4 | A4 G4 E4 C4
Bar 2:  D4 F4 A4 F4 | G4 E4 D4 C4
Beat:   low on every beat, high on every offbeat
```

- **Song Maker**: defaults are already marimba / C major / 120 /
  electronic. Click the melody (note names show on hover), low row on
  beats, high row on offbeats. Save → keep the share link. **Also add an
  SM-side stress bar** — stack 4–5 simultaneous notes on beat 1 — so
  pass 5 tests both apps' summing, not just Keyboardia's.
- **Keyboardia**: `sampled:marimba` track, 16 steps, notes on even steps,
  offsets from C4: `0,4,7,4,9,7,4,0` then `2,5,9,5,7,4,2,0`; session
  scale C major. Percussion: `sampled:808-kick` on 0,4,8,12;
  `sampled:808-hihat-closed` on 2,6,10,14. (Appendix A has creation
  methods.)

### Listening method

1. **Compare captures, not live tabs.** Record Song Maker via system
   loopback; capture Keyboardia via §43.0.3; A/B both files in the
   audition page. Live tab-switching defeats level matching (SM's −6 dB
   sampler vs a limiter-pinned bus) and outlives echoic memory (~4 s).
2. **Level-match** (the page does it), **headphones**, then repeat
   highlights on a laptop speaker and phone — polish gaps often *grow*
   on bad speakers. Disable OS loudness normalization / enhancements;
   note the output device on the scorecard.
3. Short listens, instant switches, one attribute per pass, break every
   10–15 minutes.
4. Passes, in order:

| Pass | Listen only to… | Song Maker signature | Keyboardia before → after |
|---|---|---|---|
| 1 | First 50 ms of each marimba note | woody mallet "knock" | generic attack → real attack (43.4 content — score on re-reviewed instruments only) |
| 2 | Space *between* notes | note hands off to a short room | dead stop → ring + room (43.1–43.2) |
| 3 | Repeated notes (bar 1 has E4-E4) | normally varies in trigger gain while reusing the same recording | fixed-gain repeats → controlled level variation; timbral variation only after approved RR content (43.3–43.4) |
| 4 | The image, eyes closed | intrinsic stereo gives sources width | uncontrolled overlap → intentional placement (43.5 — score on promoted content only) |
| 5 | Beat 1 of each bar, both apps' stress bars | dense but composed | flinch/duck → glued (43.1) |
| 6 | Click 5 random extra cells in each app | out-of-scale notes are unavailable by default; in-scale seconds/tritones and simultaneous cells can still clash | chromatic options → the same kind of scale guardrail (43.2) |

5. Score SM / tie / K per pass. Exit bar: after 43.6, passes 2, 3, 5, 6
   tie-or-K; passes 1 and 4 tie on re-reviewed instruments. A pass-1 loss
   on a specific instrument is a content finding for 43.4's process — the
   2026-07 review proved "deeper mapping" alone doesn't win blind tests.
6. Secondary references (optional passes): the Learning Music playground
   (`learningmusic.ableton.com/the-playground.html`, 85 BPM, Kit-Core 909)
   is the best drums-focused A/B — recreate its 909 pattern with
   Keyboardia's 808/acoustic kits for a percussion-only pass. The
   Learning Synths playground is the synth-tone bar for Phase 43.6's
   before/after (its presets are designed patches on a richer voice —
   expect to close the *static vs moving* gap, not match it outright).

---

## Success criteria

Measured by the §43.0 rig against committed baselines. Dynamics metrics
are **browser-lane only** (§43.0 lane rules).

| Metric | Baseline (measure at HEAD) | Target | Lane |
|---|---|---|---|
| S1 pumping: max envelope attenuation, 150 ms post-downbeat | (capture) | ≤ 4 dB, monotonic recovery | browser |
| Controlled hat probe: solo vs synchronized pileup, 6–12 kHz RMS | (capture) | Δ < 2 dB after alignment | browser |
| Chain through-gain at −20 dBFS (makeup nulled) | n/a | unity ± 0.1 dB | browser |
| S3 gain humanization | 0 dB hit-level variance | non-zero RMS/peak dB variance inside class budget; p-locked = 0 | offline |
| S3 RR timbral variation (only after RR content lands) | 1.000 normalized correlation | < 0.99 | offline |
| Cross-instrument `loudnessKMax` spread (mf, ~C4) | (measure) | ±2.5 dB window | offline |
| S5 spatial change | measure master and centered-stem S/M baselines | master improves by a measured post-baseline target; centered stems add no S/M; mono fold-down Δ ≤ 1 dB | offline |
| Fresh-session scale guardrail | chromatic | 100 % entered pitches in-scale; explicit unlock persists/syncs | e2e |
| Piano layer-boundary adjacent `logSpectralDistance` | hard-switch capture | crossfade maximum ≤ 75 % of hard-switch maximum; one layer outside blend window | offline |
| Kick sweep: rendered instantaneous-frequency vs designed curve | (fails today — sweep bug) | matches 150→40 Hz | offline |

Blind listening: use randomized, level-matched A/B preference trials on the
six demo sessions, not ABX (which tests discrimination rather than
preference). Phase 43.0 preregisters listener count, trials per session,
order randomization, aggregation at the listener level, and the acceptance
threshold; report the preference rate and binomial confidence interval
rather than treating 4/5 trials as conclusive. Sample *content* promotion
additionally follows the SAMPLE-PIPELINE-V2 process (three-anchor + full-set,
hash-bound, committed decisions).

Regression: full suite green (unit, property, golden mutations, hash
parity, Playwright with updated inventories); `npm run test:mutation` run
manually on touched pure modules, score recorded (informational — the
config sets `break: null`).

---

## Risks and sequencing

- **Existing sessions sound different after 43.1** — dynamics and
  ceiling-referenced level change by the measured trim selected in that
  phase. Bug fix; sessions store notes, not audio.
  CHANGELOG: one `#### <phase name> (Month Year)` heading under
  `### Recently Added` per shipped phase, with **Changed** entries for
  43.1 and 43.2 (the repo logs shipped behavior, not specs — this spec
  itself is correctly unlogged).
- **43.5 has the largest new-field multiplayer surface**, and its gate list
  above is the checklist — `validate:sync` is hand-maintained and fails
  *silently* when an entry is missing. It is not the only persistence risk.
- **43.2 deliberately touches canonical session creation and migration**
  so browser and MCP-created sessions agree. Its risk surface includes
  create/load/remix semantics, legacy absent-scale migration, two-client
  synchronization, the scale-flip test inventory, MIDI-export default
  parity, and visual-regression re-baselining. In-session content seeding
  remains rejected.
- **Lane discipline:** no Tone import in the offline lane, no dynamics
  assertions offline, capture spec Chromium-only serialized. §43.0.6
  inventory updates accompany every new Playwright spec.
- **Registration:** add Phase 43 rows to `specs/ROADMAP.md` (summary
  table + `### Phase 43` section referencing this doc) and
  `specs/STATUS.md` when execution starts.
- Order: **43.0 → 43.1 → 43.2 → 43.3** (43.0.3 is a hard prerequisite of
  43.1's proof); then 43.4 (diagnosis + process-bound re-review), 43.5
  (sync surface), 43.6 (preset data + DSP pass). 43.0–43.3 are each
  roughly a day; 43.4 is open-ended (human listening gates); 43.5–43.6
  are days.

---

## Appendix A — Demo session build sheet

Ways to create each session:

1. **UI**: add tracks in listed order, set instruments via the picker
   (ids above are catalog ids from `instrument-catalog.ts` — bare ids
   like `hihat`/`conga` are the procedural one-shots), paint the 16-char
   patterns (`x` on, `-` off, `o` = volume lock 0.3, `X` = volume lock
   1.0), enter pitch offsets in the chromatic grid and velocity-lane
   values as annotated.
2. **MCP agent**: paste a session block to an agent connected to
   `https://keyboardia.dev/mcp`: *"Create a new session and build exactly
   these tracks/steps/p-locks, then hand back the link."*
   (`create_session` / `add_track` / `set_steps`; effects/scale set in
   the UI.)
3. **Seed fixtures** (once 43.0 lands): committed JSON under the render
   tests, usable by the rig and a dev seeding endpoint.

**Notation caveat (from the audit):** the specs/SESSION-NOTATION.md
bracket grammar cannot express everything above — its `[pitches:...]`
maps per **step index** (not per active note), `[tie]` cannot name steps,
values may not contain colons (so `[synth:sampled:marimba]` is
ill-formed), and `pan` doesn't exist yet. The sessions above therefore
state pitches/pan/ties as prose annotations beside the rhythm strings;
the normative form is the p-lock JSON. If these sessions are added to the
notation corpus, propose a notation vNext (per-active-note pitch lists,
colon-safe instrument ids, `[pan:±N]`, step-addressed ties) in
`SESSION-NOTATION.md`'s Version History first.

| ID | Name | Exposes | Phase |
|---|---|---|---|
| S1 | Downbeat Pileup | bus dynamics / pumping | 43.1 |
| S2 | Sour vs Sweet (+ drone; S2b groove) | consonance defaults | 43.2 |
| S3 | Machine Gun | humanization / RR | 43.3 |
| S4 | Piano Ballad | content, layers, tails, reverb | 43.2, 43.4 |
| S5 | Wide Kit | stereo image | 43.5 |
| S6 | Acid Line | synth + drum voicing | 43.6 |

**S2b groove** (a candidate for the home page's example-session list —
in-session seeding was rejected, see 43.2 item 3; 5 active melody steps,
5 offsets):

```
Marimba: x--x--x---x--x--   sampled:marimba, offsets 0,3,7,10,7
Kick:    x---x---x---x---   sampled:808-kick
Hat:     --x---x---x---x-   sampled:808-hihat-closed
Clap:    ----x-------x---   sampled:808-clap
```

## Appendix B — Plain-language artifact glossary

- **Pumping / ducking**: the mix "breathes" — after a loud hit everything
  briefly gets quieter, then swells back (limiter/compressor clamping).
- **Machine-gun effect**: repeated hits exactly identical — a stuck
  sample, not a performance.
- **Chipmunk / formant shift**: a repitched sample that sounds sped-up
  (squeaky, fast decay) or slowed-down (underwater). Grows with repitch
  distance.
- **Layer cliff**: soft-to-loud sweep where tone *jumps* at a threshold
  instead of blending.
- **Beating**: two near-identical pitches produce a slow throb; between
  adjacent semitones it reads "sour." (Needs simultaneity — hence S2's
  drone.)
- **Tritone**: the 6-semitone interval — tense, unresolved,
  "horror-movie."
- **Glue**: busy moments sounding dense and composed rather than
  splattering or flinching.
- **Gated tail**: a note ending with a soft "shut door" instead of
  ringing away.
- **Mono clump**: every instrument at the same point in space, masking
  each other — the opposite of instruments having *places*.
- **Static sustain**: a held synth note with zero internal movement — the
  tell of a single bare oscillator.
- **Comb-filtered attack**: two near-copies of one sound summed — hollow,
  phasey transient (why crossfading two drum takes is wrong).

## Appendix C — Phase 44 candidate: worklet-DSP synth voice (deferred)

**Not part of Phase 43.** This appendix exists so the decision framework
is in the repo, not in a chat log. Context: Learning Synths' playground
voice is an RNBO (Max/MSP) patch compiled to WebAssembly running in an
AudioWorklet (research doc §4.1) — per-sample DSP, not a Web Audio node
graph. The capabilities stock nodes cannot reach, in order of audible
impact: nonlinear filter models (ladder / zero-delay-feedback SVF with
saturation and self-oscillation — `BiquadFilterNode` is clinical exactly
where acid/squelch material is judged), a true pulse oscillator with
continuous PWM (none exists in Web Audio), free audio-rate modulation
routing (env→LFO rate, LFO→PWM, key tracking, per-voice drift), and
bit-identical output across runtimes.

### Why Keyboardia is unusually well positioned

The pitch shifter already establishes the exact architecture: a pure-TS
DSP engine (`src/audio/worklets/pitch-shift-engine.ts` — unit-tested in
Node, including spectral assertions) wrapped by a thin worklet shell
(`pitch-shift.worklet.ts`) loaded via `worklet-support.ts`. A synth voice
built the same way is **renderable at full fidelity in the offline test
lane** — the engine class is plain TypeScript — which collapses, for the
synth path, the two-lane split §43.0 was forced into by non-portable
native nodes.

### Trigger criteria (all three, in order)

1. Phase 43.6 has shipped and its results are recorded — the cheap moves
   (velocity→filter, advancedSynth migration) must be spent first.
2. The Learning Synths secondary A/B (cross-app protocol §6) still loses
   on *filter character* — resonant sweeps clinical, sustains static
   despite detune — i.e. preset data on stock nodes has measurably
   plateaued. **Or** filter automation (`MUSICAL-COVERAGE-ANALYSIS.md`
   priority 7, "TB-303 squelch") is promoted to active roadmap, which
   puts sustained resonance — stock nodes' weakest register — at the
   center of the product.
3. Someone is prepared to own a DSP surface (tests, CPU budgets, mobile
   tiers), not just land it.

### The prototype (one voice, decision-sized)

Port `synth:acid` only:

- **Voice:** PolyBLEP band-limited saw + pulse (with PWM), zero-delay-
  feedback SVF with tanh drive (self-oscillation capable), two ADSRs
  (amp + mod), one LFO, key tracking, glide.
- **Architecture:** pure-TS engine class + thin worklet shell, exactly
  the pitch-shift pattern. No WASM in the prototype — V8 handles a
  handful of voices at 128-frame quanta, and TS-first means zero new
  toolchain.
- **Verification:** golden renders in the offline lane (alias floor on a
  C7 saw; filter-sweep centroid curve; self-oscillation pitch accuracy);
  CPU measurement at 16 tracks on a mid-tier phone with a budget set
  before judging; A/B in the audition page vs the current `acid` and vs
  the Learning Synths playground.
- **Decision gate, three outcomes:** (a) ship the TS voice as-is;
  (b) quality/CPU demands more → compile the same algorithms to WASM —
  **Faust preferred** (text DSP source in-repo, `faust2wasm` emits
  worklet-ready modules, stdlib includes the filter models; fits this
  repo's diffable-and-tested culture), RNBO only if a dedicated
  sound-designer workflow materializes (Max license, binary patch as
  source of truth, verify current export terms — precedent: Ableton
  didn't write a web synth, they compiled an *existing* Max for Live
  instrument, "Poli" by Christian Kleine, so the RNBO route is strongest
  when a finished Max patch already exists); (c) shelve, with the
  measured results recorded here.
- **Scope guard:** no preset-migration work until the gate passes.
  Migrating the 32 presets is its own phase with per-preset golden
  renders; a quality-tier switch (Learning Synths' high/low precedent)
  is part of that phase, not the prototype.
