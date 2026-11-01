# Song Maker vs Keyboardia: Measured Sound Comparison

**Research Date**: 2026-08-04; live product revalidated 2026-08-11
**Method**: Direct inspection of Song Maker's production bundle plus
download and analysis of representative sample assets; Keyboardia facts
verified against the repository pinned in the accompanying
`SONG-MAKER-COMPARISON-2026-08-RECEIPT.md`. The receipt records URLs,
hashes, commands, tool versions, and limitations so later readers can tell
whether the live external assets have changed.
**Status**: Baseline and candidate re-analysis complete. Comparative listening
and first-contact studies remain open; action items live in
`specs/SOUND-QUALITY-PARITY-PLAN.md`.

On 2026-08-11 the live Song Maker settings were re-read in the browser:
4 bars, 4 beats/bar, split 2, Major, C, Middle register, 2 octaves, 120 BPM,
Marimba, and Electronic. It still opens directly on the playable Song Area—no
landing-page choice is required. The decoded live bundle remained 1,021,930
bytes with SHA-256
`d855d8e785f2e478fc3e4fb7956b4f6b716670dbdf3adc72a1a1bc5ad287ef1e`,
identical to the 2026-08-04 receipt. The source-inspection findings below
therefore remain applicable to that exact live build.

> Prior art gap: before this document, "Song Maker" appeared nowhere in this
> repo, and the two Chrome Music Lab mentions
> (`COMPOSITION-AFFORDANCES.md` §5, `MOBILE-UI-PATTERNS.md`) are UX-only.
> No doc had ever compared Keyboardia to any reference product on *sound*.

---

## 1. What Song Maker actually is (measured, not assumed)

### 1.1 Sample library

Reconstructed from the bundle's sample-map builder (`ke=["C","Ds","Fs","A"]`,
octaves 2–6):

| Asset set | Contents | Format / evidence |
|---|---|---|
| 5 tonal instruments: marimba, piano, strings, woodwind, synth | **20 samples each** — one per minor third (C, D#, F#, A) × octaves 2–6, i.e. C2–A6 | MP3, 44.1 kHz, **stereo** in the checked C4 files; marimba C4 2.066938 s, strings C4 3.057313 s |
| 4 percussion kits: electronic, kit (drum machine), woodblock, bongo | **2 sample URLs each** (`low.mp3`, `high.mp3`) | Asset-map structure verified; percussion encoding was not retained in the representative receipt |

Consequences:

- Worst-case nearest-root distance is **±1.5 semitones** with roots every
  3 semitones. This limits playback-rate timbre/decay shift; audibility was
  not established by this source inspection.
- The files themselves contain the recorded tone and tail. Whether they
  share a room, mastering pass, or recording session is a plausible
  consistency hypothesis to test by measurement/listening, not provenance
  established by metadata.
- Total tonal palette: 5 instruments. Curation over breadth.

### 1.2 Inspected live signal chain

```
Tone.Sampler (20 multisamples)
  → sampler.volume = −6 dB   (live tonal and percussion samplers;
                              "soften" preview −24 dB)
  → toDestination()
```

That is the inspected live chain. **No reverb, EQ, compressor, limiter, or
other master effect was found in that path.** The only DynamicsCompressor
references found are standardized-audio-context shims. Any polish heard
cannot be attributed to master processing in this path; the −6 dB sampler
default provides source headroom, but clipping margin was not measured.

The sampler constructor also contains a −11 dB branch when its fourth
boolean argument is true; inspection found that branch on an export/offline
path, not the default live percussion path. It must not be reported as the
live percussion level without a call-site trace.

### 1.3 Note handling

- Tonal: `sampler.release = 0.4` — every note rings **400 ms past its gate**
  before the release ramp ends, so adjacent grid notes overlap the way a real
  instrument in a room does.
- Percussion: `fadeOut = 0.015` (15 ms declick), one-shots play out.
- **Velocity humanization, hardcoded**: every tonal trigger runs
  `velocity = 0.8·v + 0.2·Math.random()` before `triggerAttack`, so repeated
  triggers normally receive different gains.
- Scheduling: Tone.Transport. Keyboardia also has lookahead/worklet
  scheduling infrastructure, but this inspection did not run a comparative
  timing measurement.

### 1.4 Sample provenance (measured 2026-08-04)

The checked MP3 carries Broadcast-Wave/XMP metadata from its master:
`bext:originator="Pro Tools"`, creation/origination dates of
**2018-02-26**. The public credits checked name the product builders; no
sample-source attribution was found in the inspected bundle, assets, or
page. Those are observations only. They do **not** prove that Google
commissioned the recordings, that they were made specifically for Song
Maker, that every instrument came from one batch, or that absence of a
credit grants reuse rights. Treat “one coherent batch” as a hypothesis for
why the palette sounds consistent. Any implementation must use Keyboardia's
own licensed/commissioned content and retain its normal provenance ledger;
do not copy the reference audio.

### 1.5 Musical defaults (from the bundle's song model)

```js
bars=4 (1 on mobile), beats=4, subdivision=2, tempo=120,
octaves=2 (1 on mobile), scale="major", rootNote=48 (C3),
instrument="marimba", percussion="electronic", percussionNotes=2
```

- **Major-scale lock is the default**; chromatic is in settings. This
  removes out-of-scale choices, but C major still contains semitone pairs
  (E–F, B–C), the F–B tritone, and multiple simultaneously active cells.
  It reduces accidental dissonance; it does not make bad combinations
  impossible.
- Default voice is **marimba**. Its fast natural decay is a plausible reason
  dense beginner patterns remain clearer; that is a listening hypothesis,
  not a bundle fact.
- 2 percussion lanes → beats stay simple and readable.

---

## 2. Keyboardia baseline before Phase 43 (verified file:line)

This section is the historical baseline, not "Keyboardia today." The current
candidate is compared in §3. It is an uncommitted local worktree based on
`4b7ffc266c1351bddd26ec8a1ebda027491fde2b`; it is not evidence about the
deployed product or the docs-only state of PR 88.

### 2.1 Sound sources

- Landing/demo path plays the **procedural** drums
  (`App.tsx:663` `LANDING_SAMPLES = ['kick','snare','hihat','clap']`):
  mono, synthesized in `samples.ts` — kick = pure sine sweep with no
  transient layer (`samples.ts:182`), snare = white noise + one 180 Hz sine
  (`:201`), hi-hat = **unfiltered** white noise (`:219`). Every hit
  bit-identical (buffers rendered once at init).
- 23 of the 32 Web Audio presets lack a second oscillator, and 19 have
  neither `osc2`, LFO, nor filter envelope — a single oscillator → one
  lowpass → ADSR (`synth.ts:85-607`; 9 have `osc2`, 7 an LFO, 7 a filter
  envelope). **No velocity→filter modulation anywhere** (`synth.ts:870`
  scales the amp envelope only). Every preset ships attack ≤ 50 ms —
  `synth.ts:232` documents the constraint ("attack must be < 0.1 s to be
  audible at 120 BPM"), so pads never swell.
- 26 sampled instruments are real multisamples but thinner and less even
  than Song Maker's: piano 7 roots over 3 octaves (up to ±3½ st repitch),
  french-horn 14 st gap, clean-guitar/finger-bass 12 st
  (`instrument-ranges.ts:291-318`). Repitch is `playbackRate`
  (`sampled-instrument.ts:595,704`) — formant/decay-time shift grows with
  distance. Sources span 8+ free libraries; there is no documented
  automated cross-instrument loudness calibration, and only one of 26
  manifests uses `gainDb`.
- All 180 checked assets are 128 kbps MP3; 176 are 44.1 kHz and four
  slap-bass assets are 48 kHz. Song Maker's checked files are also MP3 at
  44.1 kHz, so codec family alone is unlikely to explain the difference;
  content consistency and mapping are hypotheses for Phase 43.0 to measure.

### 2.2 Signal chain

Intended (per `SYNTHESIS-ENGINE-ARCHITECTURE.md`): master → compressor →
effects. Actual, after `initializeTone()` (`engine.ts:415-437`):

```
TrackBus (all unity) → masterGain (1.0, fixed)
  → Tone: distortion → chorus → delay → Freeverb   (ALL wet: 0)
  → Tone.Limiter(−1 dB) → Tone.Destination (Volume → Gain) → destination
```

The tuned −6 dB / 4:1 / knee 12 DynamicsCompressor (`engine.ts:47-53`) is
**disconnected** at `engine.ts:426` and left orphaned. The real basic-synth
cap is `SYNTH_CONSTANTS.MAX_VOICES = 16` (`synth-types.ts:74-77`, enforced
at `synth.ts:664-670`); AdvancedSynth separately caps itself at 8, sampled
instruments do not share that global cap, and a session can contain 16
tracks. Therefore neither “8 × 0.85 = +16.6 dB” nor a hypothetical
16-voice full-scale sum is a measured whole-mix peak. The disconnected
compressor and unity master gain make limiter stress a credible defect, but
the amount of pumping/transient loss must be captured in Chromium with a
defined fixture before setting trim or reduction targets. Note
`Tone.Limiter` is itself a wrapped DynamicsCompressor at 20:1 — not a true
brick wall. Four spec
locations show three different chain orderings (`SYNTHESIS-ENGINE-
ARCHITECTURE.md:46`, `UNIFIED-AUDIO-BUS.md:29` and `:620-622`,
`MIDI-EXPORT.md:790-791`); the code matches none.

### 2.3 Note handling

- Sampled notes are gated: gate + exponential release then **hard
  `source.stop()`** (`note-schedule.ts`, `sampled-instrument.ts:621-624`).
  A 16th note on piano plays ≈ 635 ms of the recording's much longer
  decay. (Manifest `releaseTime` values of 0.5–0.8 s do give Song-Maker-
  class tails on short notes; the gap is the hard stop on *held* notes
  and the truncation of long natural decays, not the release itself.)
- Unlocked steps always play at velocity **127**: the schedulers resolve
  `pLock?.volume ?? 1` (`scheduler.ts:484`, `scheduler.worklet.ts:240`)
  and `velocityFromMultiplier(1)` = 127 (`velocity.ts:16,28`) → the ff
  layer always plays unless the user opens the Velocity Lane.
  (`DEFAULT_MIDI_VELOCITY` at `velocity.ts:19` is only a non-finite-input
  sentinel — changing it would not change this behavior.)
- Velocity coupling: the volume p-lock both selects the layer *and* scales
  gain linearly (`scheduler.ts:381-385`,
  `sampled-instrument.ts:603-606`). Recorded layer-level differences can
  therefore compound the gain change, and timbre cannot be controlled or
  tested independently from level.
- **No humanization**: no velocity jitter, `roundRobinGroup` supported by
  the engine (`sample-selection.ts:109-117`) but used by **zero** manifests;
  `velocityCrossfade` likewise shipped-but-unset (`sampled-instrument.ts:691`).

### 2.4 Musical defaults

- New session: **empty grid**, 120 BPM, swing 0, all effect wets 0
  (`effects-defaults.ts:7-13`). The UI fallback is C minor pentatonic with
  **`locked: false`** (`grid.tsx:15-19`) → fully chromatic entry on first
  click, but server-created state can omit `scale` entirely because
  `createInitialSessionState` supplies no default. Panning is plumbed but
  unreachable: `TrackBusManager.setTrackPan`
  (`track-bus-manager.ts:120`) has zero production call sites — no state
  field and no UI, so users have no per-track placement control. This does
  **not** make every source mono: 154 of 180 checked sampled assets are
  stereo, and a centered StereoPanner preserves their intrinsic side
  content.

---

## 3. Re-analysis against the Phase 43 candidate (2026-08-11)

### 3.1 What genuinely improved

- The disconnected Keyboardia compressor is now in the measured path with
  conservative input trim, makeup, and a limiter. Browser capture shows stable
  through-gain and recovery. This is a real correctness improvement, not proof
  that mastering beats Song Maker's much simpler −6 dB sampler path.
- New Keyboardia sessions persist a locked pitch set and MIDI-90 default
  timbre; explicit velocity locks remain exact. Deterministic gain variation
  removes bit-identical repeated levels.
- Sample loudness and piano layer transitions have executable gates. Decoder
  onset compensation is bounded and the browser test now covers every sampled
  percussion file affected by the runtime policy.
- Per-track pan is end-to-end controllable. Re-testing shipped stereo assets
  disproved the blanket auto-spread premise: the real acoustic fixture already
  measured −0.526 dB S/M, and the earlier pan preset narrowed it to −2.951 dB
  with a +1.055 dB mono-fold change. The corrected policy centers sampled and
  user audio, auto-spreads only known mono sources, and keeps manual placement.
- A real 16-track, mixed-engine browser session now complements the synthetic
  16-source compressor canary. The latter is retained as a controlled DSP test,
  not mislabeled as product-capacity evidence.
- Legacy sessions with no effects field now migrate to explicit dry effects;
  they no longer inherit the new-session 15% room.

### 3.2 What did not close

- Keyboardia still has the same heterogeneous source-content problem: broad
  library, sparse maps on several instruments, no shipped round-robin content,
  and 81 unwaived sample-review flags. Gain variation is not timbral variation.
- Song Maker's 20-root tonal maps retain the ≤1.5-semitone repitch advantage;
  Keyboardia's candidate did not replace the mappings rejected in July's blind
  review. That restraint was correct, but the audible content question remains.
- Long natural tails/held-note behavior remains different. Keyboardia's
  release values can be comparable, but hard source stops can still truncate
  recordings.
- Song Maker presents one coherent instrument, two percussion lanes, a major
  scale, and a playable canvas immediately. Keyboardia still presents a
  landing page, a very broad palette, then an intentionally blank session.
  The earlier claim that examples solve this was an assumption, not a measured
  novice outcome.
- No matched Song Maker loopback capture, randomized preference result,
  novice-task result, listener-level estimate, or confidence interval exists.
  Consequently "parity" and "preferred" remain unsupported.
- The convolution room, compressor, humanization, and panning are Keyboardia
  production choices. Song Maker's inspected live chain does not contain
  matching processors, so their existence cannot be counted as reference
  parity.

### 3.3 Current scorecard

| Attribute | Song Maker live | Keyboardia Phase 43 candidate | Current verdict |
|---|---|---|---|
| First contact | Direct constrained canvas | Landing page → blank/broad studio | **Song Maker advantage; unmeasured magnitude** |
| Starter curation | 5 tonal voices, 4 two-sound kits; marimba/electronic default | 99 instruments; sampled 808 landing examples, no curated in-session starter mode | **Song Maker advantage for coherence; Keyboardia breadth is a Pro-mode advantage** |
| Tonal root density | 20 roots, ≤1.5 st nearest-root distance | Several sparser maps, up to 7 st in audited range data | **Gap remains** |
| Repeated-note behavior | Randomized tonal trigger gain | Bounded deterministic gain variation; zero shipped RR maps | **Level repetition narrowed; timbral gap remains** |
| Note tails | 0.4 s sampler release plus recorded tails | Comparable manifest releases on some instruments; hard stops remain | **Narrow but unresolved gap** |
| Pitch guardrail | C major locked by default | C minor pentatonic locked for new sessions; legacy stays unlocked | **Capability close; beginner outcome not compared** |
| Headroom/mix safety | −6 dB sampler, no inspected master dynamics | Measured trim/compressor/makeup/limiter | **Keyboardia bug fixed; no comparative preference inference** |
| Stereo/placement | Intrinsic stereo in checked tonal assets, no track-pan UI found | Intrinsic stereo plus manual pan; safe default centers unanalysed stereo | **Keyboardia control advantage; no sound-preference result** |
| Engine capability | Tone.Sampler-centered | Velocity layers, crossfade, RR engine, choke, loops, LRU, multiple synth engines | **Keyboardia ahead technically** |
| Evidence of preference | None supplied by bundle inspection | Internal gates only | **No winner established** |

### 3.4 How to close the gap rather than add more machinery

1. Build a flagged **Guided** entry path: direct canvas; one blind-reviewed
   pitched voice; two percussion lanes; C major; 120 BPM; small range; advanced
   controls collapsed. Preserve **Studio** mode with the full Keyboardia
   palette and collaboration features.
2. Treat the starter set as a product: commission, calibrate, or select a small
   coherent group by hash-bound blind review. Prioritize attack character,
   natural tail, cross-note consistency, and low repitch distance. Promote only
   what listeners prefer; do not equate more roots with better sound.
3. Measure first contact with novices and no coaching: time to first sound,
   time to a replayable coherent loop, completion, restarts, and desire to
   continue. Compare current Keyboardia, Guided Keyboardia, and Song Maker.
4. Capture the same musical cells from both products, level-match them, and run
   randomized preference trials by attribute. Report listener-level rates and
   confidence intervals. This tells the team whether the next dollar belongs
   in content, tails, mix defaults, or interaction.
5. Keep Phase 43's audio work as regression infrastructure. Graduate the 15%
   room, humanization amount, and any automatic placement only when each wins
   its isolated trial; otherwise keep it optional or roll it back.

**Bottom line:** the candidate is safer, more expressive, and better measured.
It is not yet demonstrated to be closer to Song Maker in the two outcomes that
matter most: what a novice produces quickly and which matched result listeners
prefer. The shortest path to closing the gap is curation plus comparative
evidence, not another synthesis engine or a more elaborate master chain.

---

## 4. The Ableton playgrounds, measured (2026-08-04)

Same bundle-inspection method, applied to the two Ableton references the
project's own docs cite (until now, UX-only).

### 4.1 Learning Synths playground (`learningsynths.ableton.com/en/playground`)

> Deeper companion analysis:
> `ABLETON-LEARNING-SYNTHS-ENVELOPES-ANALYSIS.md` (same date, sibling
> session) covers the envelopes chapter, the 38-preset catalog with
> per-parameter scaling/unit descriptors, the XY macro sub-range
> mappings, `global_slew_time`, and code-verified Keyboardia
> recommendations. This section keeps only the signal-chain facts;
> details there are not repeated here.

- **No samples at all.** The synth is an **RNBO export of "Poli"** — a
  Max for Live subtractive synth by Christian Kleine — compiled to
  **WebAssembly running in an AudioWorklet** (`rnbo/patches/
  learning-synth.json` + `patch.wasm`). Max/MSP-grade DSP, not a Web
  Audio node graph.
- The voice (32 parameters): **pulse + saw + noise** oscillator mix,
  pulse-width + PWM LFO/envelope amounts, saw detune coarse/fine, glide,
  one filter with dedicated **filter-envelope and filter-LFO amounts**, a
  **modulation ADSR separate from the amplitude ADSR**, and an LFO with
  shape, rate, and its own rate-envelope. 38 named presets
  (`wow-bass`, `west-coast-lead`, `theremin`, `two-sounds-in-one`, …).
- **Master polish:** at the "high" audio-quality setting the synth runs
  through a parallel `ConvolverNode` (normalize off) at **wet 0.05 / dry
  0.95** — a barely-there convolution room glued onto everything. A
  quality-tier switch degrades gracefully on weak devices. No compressor,
  no limiter, no EQ.

### 4.2 Learning Music playground (`learningmusic.ableton.com/the-playground.html`)

> UX companion: `ABLETON-PLAYGROUND-LESSONS.md` (sibling session) covers
> the playground as a *designed experience* — pedagogy, constraints,
> track roles, and complexity-budgeted recommendations. This section
> keeps the signal-chain and content facts.

- **Tone.js** (`Tone.Players` for drums, `Tone.Sampler` for melodic),
  each instrument `.toDestination()`; one widget path inserts a plain
  gain **0.5 (−6 dB)** before destination. **No compressor, limiter, or
  EQ anywhere.** Tab-hidden mutes via `Destination.volume.rampTo`.
- **Samples are exported Ableton Live library presets**: drums =
  **Kit-Core 909** (8 one-shots, MIDI 36–51); bass = "Boffner Bass"
  (2 roots, 0.1 s fadeout); **Grand Piano = 15 roots C1–C8 at ONE
  velocity layer** (`C4v10` — the top layer of Live's multisampled
  grand; 0.4 s fadeout); "Chiffy Sinusoid Lead" (4 roots, 60 ms fadeout).
  Format: **Ogg Vorbis ~112 kbps stereo 44.1 kHz** (no MP3 fallback
  served today; Vorbis has no MP3-style encoder priming delay).
- Playground defaults: **85 BPM**, diatonic widgets, per-instrument
  fadeout tuning (their analog of Keyboardia's manifest `releaseTime`).

### 4.3 What the three references agree on

| Recipe element | Song Maker | Learning Music | Learning Synths |
|---|---|---|---|
| Source content | 20-root sample sets; checked metadata names Pro Tools, exact provenance unconfirmed | Ableton Live library exports | WASM synthesis |
| Master dynamics/EQ | none | none | none |
| Level discipline | live sampler default −6 dB | one inspected widget path uses gain 0.5; other instruments connect directly | conservative patch gains |
| Space | baked into recordings | baked into Live presets | 5 % convolution wet |
| Wrong-note protection | major-scale lock | diatonic widgets | (n/a — one voice) |
| Velocity layers | one per note | **one** (piano ships only v10) | (n/a) |

The shared principle is narrower than “all three use the same −6 dB
headroom”: each reference controls level at the source/patch and none adds
master dynamics/EQ in the inspected path. The exact gain structures differ,
and only Song Maker's live sampler default and one Learning Music widget
path were observed at −6 dB. Nobody here demonstrates that compression is
the source of polish. Two datapoints bear directly on Keyboardia's Phase
43.4 diagnosis: Learning Music's piano uses roughly six-semitone root
spacing and a single velocity layer, so root density and layer count are not
by themselves sufficient explanations. Source consistency and level
discipline remain hypotheses to validate with Phase 43.0 measurements and
the existing blind-review process.
