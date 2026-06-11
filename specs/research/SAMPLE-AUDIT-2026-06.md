# Sample & Audio Pipeline Audit — June 2026

> Full audit of all 27 sampled instruments, their licensing, better available sources
> within the same licensing constraints (CC0 / public domain / explicitly unrestricted),
> and improvements to the pipeline that turns samples into sound.
>
> **Date:** 2026-06-09
> **Scope:** `app/public/instruments/*`, `app/src/audio/*`, all remote branches
> **Method:** manifest + code inspection on `main`, branch archaeology, and license-verified
> web research (every recommended source's license page was fetched and quoted, not assumed).

---

## Executive summary

| Area | Verdict |
|---|---|
| Sample inventory | 27 instruments, ~16MB. The January 2026 quality work (velocity layers, playable ranges, validators) **did land on main**, but README/LICENSE.md are stale. |
| Licensing | **One real problem**: the 808 kit comes from `tidalcycles/Dirt-Samples`, which has **no license at all**. A CC0 repackage of the *identical* files exists. One wrong attribution URL (acoustic guitar). |
| Better samples online | Yes — most upgrades come from sources we have *already cleared* (VSCO-2-CE, Virtuosity, Weresax, jRhodes3d, VCSL) and are just unused depth in those repos. |
| Pipeline | **Two high-severity bugs**: (1) sampled instruments ignore the scheduled start time — they play early with jitter and swing does nothing; (2) velocity is never passed to playback, so every velocity layer shipped in January is unreachable dead weight (~3MB). |

---

## Part 1 — Pipeline findings (how samples become sound)

The playback chain is:

```
scheduler.ts:playInstrumentNote()            (lookahead loop, 25ms tick, 100ms ahead)
  └→ engine.ts:playSampledInstrument()       (engine.ts:1045)
       └→ SampledInstrument.playNote()       (sampled-instrument.ts:326)
            source → per-note GainNode → masterGain → compressor → destination
```

### P1 (HIGH): Sampled instruments ignore the scheduled `time` — they play early, with jitter, and swing is broken

`SampledInstrument.playNote()` declares `_time: number // Currently unused - we play
immediately` and calls `source.start()` with no argument
(`sampled-instrument.ts:329,389`). Synth notes (`synth.ts` via `playSynthNote`) and
built-in one-shots (`engine.ts:566-573`, `source.start(Math.max(time, currentTime))`)
are started at the scheduled AudioContext time. Sampled instruments are the only path
that does not.

Consequences:

- The scheduler dispatches notes up to `SCHEDULE_AHEAD_SEC = 100ms` before they are due,
  quantized by the 25ms lookahead tick. Sampled notes therefore play **0–100ms early
  with ~25ms jitter**. At 120 BPM a 16th note is 125ms — sampled drums can land almost a
  full step off-grid and audibly flam against synth tracks.
- `calculateSwingTime()` (scheduler.ts:333) implements swing by *offsetting `time`*.
  Since `time` is discarded, **per-track and global swing have zero effect on all 27
  sampled instruments** — the most timing-critical instruments (drums) are exactly the
  sampled ones.
- Multiplayer clock sync is similarly defeated for sampled tracks.

This is a regression: commit `e20efcb` ("Phase 21A: Optimize piano samples…") replaced
the original, correct `source.start(time, sampleInfo.offset, sampleInfo.sampleDuration)`
with `source.start()`. The release-envelope code below it was also rebased onto
`currentTime` instead of `time`.

**Fix** (small, contained to `playNote`):

```ts
const startTime = Math.max(time, this.audioContext.currentTime);
if (sampleInfo.offset !== undefined && sampleInfo.sampleDuration !== undefined) {
  source.start(startTime, sampleInfo.offset, sampleInfo.sampleDuration); // restores sprite mode too
} else {
  source.start(startTime);
}
// release envelope relative to startTime, not currentTime:
const stopTime = startTime + Math.max(duration, 0.1);
```

Pass `time` through `engine.ts:1064` (currently hardcodes `0`). The `Math.max` clamp
preserves the immediate-play behaviour for previews (which pass `currentTime`).

### P2 (HIGH): Velocity never reaches velocity-layer selection — January's velocity layers are dead code

`playNote(noteId, midiNote, time, duration, volume, velocity = 100)` selects velocity
layers in `findNearestSample()` — but the one production call site,
`engine.ts:1064`, is `instrument.playNote(noteId, midiNote, 0, duration, volume)`.
Velocity is **never passed**, always defaults to 100, and only the `velocityMin 51–100`
layer can ever play.

- The pp/ff layers for piano, rhodes-ep, steel-drums, acoustic-crash and brushes-snare
  (added in PR #40-era work, ~3MB of payload) are **unreachable** — they are fetched,
  decoded, cached, and never played.
- The "Velocity Lane" UI (`VelocityLane.tsx`) edits the **volume p-lock** (a 0–1 gain),
  which the scheduler passes as `volume`. So users' "velocity" edits change loudness but
  never timbre.

**Fix:** derive MIDI velocity in the scheduler (e.g.
`Math.round((pLock?.volume ?? 1) * 127)`), thread it through
`playSampledInstrument → playNote`, and additionally apply a perceptual velocity→gain
curve inside `playNote` (e.g. `gain = volume * (velocity/127)^1.7`) so single-layer
instruments still respond dynamically. Add a regression test asserting that velocity 30
selects a `pp` file — the existing tests exercise `playNote` directly and so never caught
the missing plumbing.

### P3 (MEDIUM): Sampled instruments bypass the per-track bus

`sampledInstrumentRegistry.initialize(this.audioContext, this.masterGain)`
(engine.ts:100) wires every sampled instrument straight to `masterGain`, while synths and
one-shots route through `TrackBusManager` (engine.ts:421-425). Per-track volume happens
to work because the scheduler bakes `track.volume` into the per-note gain, but any
per-track feature added to the bus (pan, per-track effects sends, per-track metering as
proposed in the AudioWorklet spec) will silently not apply to sampled tracks. Route
`playNote` to `trackBusManager.getBusInput(trackId)` like the other paths.

### P4 (MEDIUM): No sustain looping — organ/strings/horn notes die when the file ends

`AudioBufferSourceNode.loop` is never used. The Hammond samples are ~3–4s; a held organ
chord goes silent mid-note. Strings/horn/sax have the same ceiling. The manifest schema
already anticipated this (`VALUABLE-SAMPLES-SPEC.md` shows `"loop": true` for
hammond-organ) but it was never implemented. Add optional `loop`, `loopStart`, `loopEnd`
per sample (or per manifest) and set `source.loop = true` for sustained categories. Loop
points need to be chosen per sample (zero-crossings in the steady-state region) — a
one-time scripting task with the existing `scripts/` tooling pattern.

### P5 (MEDIUM): No hi-hat choke groups

Open and closed hats are independent instruments; a closed hit never chokes a ringing
open hat, which is physically wrong and audibly mushy in fast patterns. `noteId` is
already threaded through (`_noteId — reserved for future stop functionality`). Add an
optional `chokeGroup: string` to the manifest; when a note in a group starts, ramp the
group's previous sources to 0 over ~30ms and stop them. (808 *and* acoustic hats both
benefit.)

### P6 (LOW): Remaining playback-quality details

- **Attack declick**: `gainNode.gain.value = volume` with no micro-ramp. The engine
  defines `FADE_TIME = 0.003` (engine.ts:29) but the sampled path doesn't use it. A 1–3ms
  linear ramp at start removes occasional clicks on samples that don't begin at a
  zero-crossing (esp. when pitch-shifted).
- **Sprite mode is half-removed**: `findNearestSample` still returns `offset`/`sampleDuration`,
  `loadSprite()` still exists, but `playNote` ignores both — any future manifest with
  `sprite` would play the whole sprite file from 0 on every note. Restore (one line, see
  P1) or delete the mode; don't keep it broken.
- **Equidistant sample tie-break**: nearest-note search breaks ties by Map insertion
  order (= load order, C4-first). Prefer shifting *down* from the higher sample
  (downshifts sound better than upshifts for most instruments) — one-line comparator fix.
- **MP3 as delivery format**: CBR 128kbps MP3 adds encoder delay (~25–50ms of priming
  samples) at the start of every file, which both delays transients and varies by
  encoder. For drums this matters. Options, in increasing effort: (a) trim leading
  silence aggressively during conversion (scriptable check with the existing validators);
  (b) move to AAC/M4A (universal `decodeAudioData` support, better quality/byte, no
  fixed priming convention but typically trimmed by the decoder via metadata);
  (c) WebM/Opus with an M4A fallback for Safari. Combined with P1 this determines
  whether drums actually sit on the grid.
- **Loudness normalization policy**: the January incident (peak-normalizing velocity
  layers inverted their dynamics, fixed in `747c90f`) shows per-file normalization is the
  wrong layer. Better: keep files untouched and add an optional per-manifest `gainDb`
  (and per-sample `gainDb` if needed), set once using a LUFS measurement script. This
  also addresses the steel-drums situation where layer *names* don't match loudness —
  currently "fixed" by scrambling the name→velocity mapping, which preserves loudness
  ordering but means timbre no longer tracks velocity (a soft-mallet timbre plays on hard
  hits at MIDI 101–127 on C4/C5). jSteelDrum2 (below) fixes this at the source.
- **Velocity-layer crossfading** was specced (`SAMPLE-QUALITY-IMPROVEMENTS.md`) and not
  implemented; hard layer switching is audible on crescendi. Lower priority than P1/P2 —
  do it only after velocity actually flows.

### Scheduling architecture (context from other branches)

`origin/claude/audio-engine-review-SWQNd` (unmerged) contains
`specs/AUDIOWORKLET-ENGINE.md` — a reviewed, "architecture-honest" proposal to move the
lookahead clock into an AudioWorklet, with the correct observation that the meaningful
metric is *main-thread receive lateness*, plus an `audioMetrics` design. It does not fix
P1 — even a perfect worklet clock is useless while `playNote` ignores `time` — but P1's
fix is a prerequisite that makes that spec's latency goals achievable. The same branch
has ~1,000 lines of audio-relevant lessons (`docs/LESSONS-LEARNED.md`) worth salvaging
even if the worklet work isn't pursued.

`origin/claude/fix-safari-audio-switching-Vq8zi` (unmerged) hardens AudioContext
resume on Safari tab switches (`engine.ts` statechange listener + direct context resume,
plus tests). The `audioContext.resume()` call inside `playNote`
(sampled-instrument.ts:362) is a fire-and-forget band-aid for the same problem; merging
or rebasing that branch would address it properly.

---

## Part 2 — Licensing audit

Constraint: CC0 / public domain / explicitly "free for any use without restriction". No
attribution-required (CC-BY), no share-alike, no redistribution limits.

| Instrument(s) | Current source | License status |
|---|---|---|
| 808 kit (5) | tidalcycles/Dirt-Samples | ❌ **Repo has NO license file at all** (open issue #19 since 2020). The 808 folder is Michael Fischer's 1994 set with only "ABSOLUTELY FREE" in a readme. Fails our bar. |
| acoustic-guitar | credited as `github.com/jmsmrtn/discord-sfz-gm-bank` | ⚠️ **URL is a 404.** Real source: `github.com/sfzinstruments/Discord-SFZ-GM-Bank`; the Martin HD28 .sfz itself declares CC0 (verified). Fix the manifest credit. |
| piano, vibraphone, marimba, acoustic hats/ride | University of Iowa MIS | ✅ "may be downloaded and used for any projects, without restrictions" (verified). |
| string-section, french-horn | VSCO-2-CE | ✅ CC0-1.0 (repo LICENSE). |
| finger-bass, slap-bass, alto-sax, clean-guitar, brushes-snare | Karoryfer (Meatbass/Growlybass/Weresax/B&G/Swirly) | ✅ CC0 (blanket statement + repo licenses). |
| acoustic kick/snare/crash, hats, ride | Virtuosity Drums | ✅ CC0-1.0 (repo LICENSE verified). |
| rhodes-ep | jRhodes3d | ❌ **Corrected 2026-06-10: NOT CC0.** The LICENSE grants CC0 only "for musicians using this to make music"; redistributing the samples (serving MP3s to browsers) is CC BY-NC. The original audit misread this. A FreePats FM Piano 1 (CC0) replacement was built, then reverted pending the owner's decision — see the Tier-4 status table. |
| steel-drums | jlearman.SteelDrum → jSteelDrum2 | ✅ Unlicense (repo-wide, re-verified including the v2 repo). |
| kalimba | VCSL | ✅ CC0-1.0. |
| hammond-organ | FreePats setBfree emulation | ✅ CC0. |
| vinyl-crackle | procedural | ✅ n/a. |

**Fix for the 808s:** `github.com/tidalcycles/sounds-tr808-fischer` is the *same Fischer
recordings* (BD5050.WAV, SD5050, CH, OH50, CP all verified present) repackaged by the
TidalCycles maintainers **with an actual CC0-1.0 LICENSE file**. Drop-in replacement,
zero audible change, plus ~100 extra knob-position variations and additional 808 voices
(toms, congas, rimshot, cowbell, claves, maracas, cymbal). Residual caveat: the CC0 grant
was applied by the maintainers rather than provably by Fischer — but it is the strongest
license claim available for any real-808 recording, and strictly better than what we ship
today.

**Doc rot:** `app/public/instruments/LICENSE.md` predates the January additions — it
omits acoustic-guitar, hammond-organ, kalimba, slap-bass, steel-drums, acoustic-crash and
brushes-snare (their credits live only in manifests). README still says "21 sampled
instruments" (there are 27).

**Confirmed NOT usable** (so nobody re-litigates these): Salamander piano & drumkit
(CC-BY / CC-BY-SA), Pianobook (EULA forbids redistributing samples), Philharmonia
(samples "must not be … made available 'as is'" — serving MP3s to browsers is exactly
that), DrumGizmo kits (CC-BY), AVL Drumkits (CC-BY-SA), MusicRadar (no redistribution),
Ivy Audio Piano in 162 (no license text at all).

---

## Part 3 — Better samples, instrument by instrument

Everything below was license-verified by fetching the source's license page/file.
"Same source" means no new licensing work at all.

### Fixes from sources we already use (highest confidence, do these first)

| Instrument | Problem today | Upgrade | Source |
|---|---|---|---|
| **french-horn** | 17-semitone gap C1→F2 | VSCO-2-CE `Brass/F Horn/sus` also has **D#1, G1, A#1, D2** (each with 3 dynamic layers) — gap becomes 3-4-3-4-3. C3→D4 stays 14st (only A2 exists between); fill that region from Iowa MIS horn (chromatic Bb1–F5, pp/mf/ff, but multi-note AIFFs that need slicing) or restrict range. F4 exists to extend the top. | same source |
| **alto-sax** | 12-semitone gap C3→C4 | Weresax is **fully chromatic db2→ab4** (32 notes × 2 dynamics × 2 round-robins × 2 mics; 256 files). `gb3` is exactly the F#3 we wanted; could even go chromatic. Note: Karoryfer's filenames are one octave below MIDI convention — our existing files already follow this, stay consistent. | same source |
| **string-section** | cello (C2,C3) spliced to viola (C4,C5): timbre jumps mid-range; cello "C2" mapping is suspect (repo has no cello C2 susvib file) | Replace splice with **VSCO-2-CE Viola Section susvib alone: 13 pitches C2–D5, max gap 4 semitones, 2 dynamics**. (Violin Section G2–D5 and Cello Section C1–F4 also fully listed and available for separate bright/dark sections later.) | same source |
| **acoustic kick/snare/hats/ride/crash** | single velocity; hi-hats are Iowa *foot* articulations (weak), not stick hits | **Virtuosity Drums has 4 velocity layers × 4 round-robins** for kick/snare/hats (verified in its SFZ mappings), ride bow+bell at 3vl×4rr, crash + sizzle, snare rimshot/cross-stick/flam, hats closed/half/open/pedal/splash, six mic positions. We use ~1% of it. Rebuild the whole acoustic kit from this one CC0 source. | same source |
| **rhodes-ep** | 7 notes, 3 velocity layers on 3 of them | jRhodes3d has **15 notes F1–C7 at ≤5-semitone spacing × 5 velocity layers**. Uniform coverage from the source we already credit. | same source |
| **finger-bass** | 6 samples, no layers | Meatbass `Samples/pizz/` = 7 notes (A0–A3) × **4 velocity layers** × 4 RRs. Note its pizz tops out at A3 — our current C4 mapping deserves a pitch re-check. | same source |
| **acoustic-guitar** | 16-semitone gap E4→Ab5; wrong credit URL | Same Martin HD28 instrument in `sfzinstruments/Discord-SFZ-GM-Bank` has **16 samples E2→B5 at ~3-semitone steps** (CC0 stated in the .sfz). Re-import more notes + fix credit. | same source (correct URL) |
| **piano** | C notes single-layer, F notes 3-layer → inconsistent timbre under dynamics | Iowa MIS piano has **pp/mf/ff for essentially every chromatic note Bb0–C8** — re-export C2/C3/C4/C5 with all three layers (same instrument, same timbre). CC0 alternative if preferred: VCSL "Grand Piano, Steinway B" (uniform 3 layers, ~whole-tone spacing). | same source |

### Replacements from new (verified) sources

| Instrument | Upgrade | Source & license |
|---|---|---|
| **808 kit** | Same files, real license, +100 variations | `tidalcycles/sounds-tr808-fischer`, CC0-1.0 (see Part 2) |
| **steel-drums** | **jSteelDrum2**: 24 chromatic notes C4–B5 × 5 velocity layers, author *re-fixed the dynamic-consistency problem* we measured in v1 (our scrambled soft/medium/hard mapping becomes unnecessary). Same author → timbre continuity. | `github.com/jlearman/jSteelDrum2`, Unlicense |
| **vibraphone** | VCSL Vibraphone: 11 notes F2–E5 × 2 velocity layers, hard+soft mallet and bowed articulations (vs our 4 single-layer ff notes, 12st gaps) | `github.com/sgossner/VCSL`, CC0-1.0 |
| **marimba** | VCSL Marimba: 10 notes F1–C6 × 3 dynamics, max gap ~7st (vs 17st single-layer today) | VCSL, CC0-1.0 |
| **kalimba** | VCSL "Kalimba, Kenya": 16 samples across ~2 octaves (vs 4); FreePats Kalimba (CC0, round-robins) as a second option. Also fixes the oddity that our files are named `c3..c6` but mapped to C#. | VCSL CC0 / FreePats CC0 |
| **brushes-snare** | Ben Burnes' 150-sample Brushed Drum pack is *probably* CC0 (his Abstraction project is explicitly public domain) but the license text couldn't be verified online — check the pack's readme before shipping. Otherwise keep Swirly Drums. | unverified — gate on readme |
| **hammond-organ** | **No verified CC0 real-Hammond multisample exists** (VCSL has none; Pianobook excluded; freesound candidates have unverifiable licenses). Keep the FreePats setBfree set; the bigger win for organ realism is sustain looping (P4) + the existing chorus effect as a Leslie stand-in. | keep current |
| **electric finger bass (new)** | If a bass-guitar (vs upright) finger tone is wanted: FreePats "Bass Guitar YR" — chromatic, CC0, ~3MB FLAC. | `github.com/freepats/electric-bass-YR`, CC0-1.0 |

### Size discipline

Several upgrades multiply sample counts (velocity layers × more notes). Budget guidance:
keep per-instrument payloads ≤1MB where possible (current outliers: piano 5.7MB,
rhodes 3.7MB — the piano F-layer files are 0.5–0.8MB *each* because the Iowa decays run
30s; trim to ~6–8s with a fade and they shrink ~4×). The LRU cache (64MB desktop / 32MB
iOS) and progressive loader already handle the runtime side; the validators in
`app/scripts/` should gain a payload-size check.

---

## Part 4 — What's on the other branches (audit trail)

| Branch | State | Relevance |
|---|---|---|
| `claude/identify-valuable-samples-EPzrI` | **content landed on main** (via PR #40-era merges; branch itself shows unmerged SHAs) | Source of the 27-instrument state, velocity layers, playable ranges, `scripts/validate-*`. Its specs (`SAMPLE-QUALITY-*`, `VALUABLE-SAMPLES-SPEC`) are on main. |
| `claude/audio-engine-review-SWQNd` | unmerged | `specs/AUDIOWORKLET-ENGINE.md` (reviewed scheduling redesign + metrics), big LESSONS-LEARNED additions, test-suite improvements. Complements (does not replace) fixes P1/P2. |
| `claude/fix-safari-audio-switching-Vq8zi` | unmerged | Safari AudioContext resume hardening in `engine.ts` + tests. Overlaps the band-aid at sampled-instrument.ts:362. |
| `claude/instrument-sampling-synthesis-research-qdhJR` | unmerged, Dec 2025, no merge base | Early sampling-vs-synthesis research; superseded by the January specs. Archive. |
| `claude/advanced-synthesis-phase-KzPK3`, `claude/build-advanced-synthesis-gMvXp` | unmerged, no merge base (pre-history) | Advanced synth work that already exists on main in newer form. Archive. |
| `claude/audioworklets-explanation-X8P3h` | unmerged | Tooling/skill install only; nothing audio-pipeline-specific to salvage. |

---

## Status update (2026-06-10)

Implemented on this branch, on top of the merged AudioWorklet engine:

| Item | Status |
|---|---|
| P1 scheduled start time (+ sprite offsets, anchored release) | ✅ fixed (`note-schedule.ts`, `sampled-instrument.ts`) |
| P2 velocity threading (both schedulers, parity-tested) | ✅ fixed (`velocity.ts`) |
| P3 per-track bus routing | ✅ landed with the worklet branch |
| P4 sustain loops | ✅ engine support + hammond manifest (estimated loop points; refine with offline analysis in the sample-rebuild pass) |
| P5 choke groups | ✅ fixed (`choke-groups.ts`, hi-hat manifests) |
| P6 declick attack, downshift tie-break, `gainDb` | ✅ fixed |
| LICENSE.md drift, guitar credit URL, README counts | ✅ fixed (LICENSE.md now generated + doc-sync test) |
| 808 source swap | ✅ swapped to `sounds-tr808-fischer` (CC0); waveforms cross-correlate 0.95–1.00 with the old files — same recordings, real license |
| Horn/sax gap fills | ✅ VSCO D#1/G1/A#1/D2/F4 + Weresax Gb3/Gb4 added (max gap: horn 14→7 below C4, sax 12→6) |
| String section rebuild | ✅ 15 samples (cello low + viola mid/high), max gap 5, all leveled to −20dB RMS (was −13…−40dB between adjacent samples!) |
| Format/trim work (MP3 encoder delay) | ✅ done — leading dead time trimmed across the library (rebuilt instruments at conversion from lossless; string-section trimmed in place; worst offender was 922ms on piano F3-ff). Residual sub-−45dB lead on strings is real bow noise, kept deliberately. |

### Tier 4 rebuilds (2026-06-10) — all complete

| Instrument | Result |
|---|---|
| marimba | VCSL Outrigger: 10 notes F2–C7 × 3 layers (was 5 single-layer, 17st gap). VCSL names are octave-below-sounding; mapped to verified sounding pitch. |
| vibraphone | VCSL hard mallets: 11 notes F3–E6 × 2 layers, max gap 4 (was 4 × ff-only at 12st). |
| kalimba | VCSL Kalimba-Kenya: 10 unique keys B3–A5, max gap 3. Source mbira is non-ET (up to 45¢ off) with doubled unison courses (the "B4" file actually sounds the G#4 course); every key f0-measured and retuned to ET by resampling — delivered tuning within ±0.6¢. |
| steel-drums | jSteelDrum2: 8 notes C4–A5 at uniform 3st gaps × 3 layers (SFZ groups 2/4/5). The v2 sampling fixed the dynamic-consistency problem at the source; the scrambled name→velocity mapping is gone. |
| piano | Iowa MIS pp/mf/ff on all 7 notes (C notes were single-layer); 30s decays capped at 7s; 5.6MB → 2.3MB. |
| rhodes-ep | **License correction stands** (see Part 2): jRhodes3d is BY-NC for redistribution. A FreePats FM Piano 1 (CC0) replacement was built and then **reverted at the owner's request pending their licensing/quality investigation** — it lives in branch history (commit bee4809) if wanted. The shipped set remains the octave-corrected jRhodes samples. Options: contact Jeff Learman for a redistribution grant (he invites this), accept BY-NC, or adopt the FM set. |
| acoustic kit | Virtuosity mid mic: kick/snare/hats ×4 velocity layers, ride/crash ×3 (snare picked from 36 sampled strengths at vl9/18/27/36). Replaces single-layer kit that used Iowa *foot-pedal* hats. |
| hammond loops | setBfree samples carry chorus modulation — no splice point loops cleanly (best wrap discontinuity ~60% RMS). Baked 200ms equal-power crossfades into the loop regions instead: wrap residual 0.6–3.1%; loop lengths are exact pitch-period multiples. |

Leveling policy for all rebuilds (final form, after the clipping incidents): per note, the loudest layer is anchored by **mean dB** (smoothed across notes for evenness) under a pre-encode **peak ceiling of −2.5dBFS** (−4.4 for codec-overshoot-prone content — 128k MP3 was measured overshooting bright material by up to +2.6dB); lower tiers sit on a fixed mean-dB staircase below the anchor (3-tier: −4/−8; 4-tier: −3/−6/−9). Rationale: `validate-velocity-layers.ts` orders layers by mean volume, and the engine derives both loudness (volume) and layer choice (velocity) from the same p-lock — raw source dynamics (up to 48dB spread in VCSL) would double-apply. `validate-acoustic-pitch.py` covers all 132 pitched samples at 0 mismatches and `validate-audio-defects.py` passes all 27 instruments; detector exceptions are documented inline with their spectral evidence. |

### Acoustic pitch audit (2026-06-10) — octave bugs found and fixed

Decoding every sample and measuring its actual sounding pitch
(`scripts/validate-acoustic-pitch.py`, new) revealed that several
instruments were mapped to the wrong octave because sample-library file
names follow per-library conventions that were taken at face value:

| Instrument | Was | Fixed |
|---|---|---|
| french-horn | all samples sounded **+12** above mapping (VSCO names are octave-below-sounding) | remapped to sounding pitch, files renamed to true notes |
| alto-sax | **+12** (Karoryfer's own SFZ confirms `db2`→MIDI 49) | remapped + renamed |
| marimba | **+12** (Iowa names) | remapped + renamed |
| kalimba | **+12** (c3/c4 spectrally confirmed; c5/c6 follow) | remapped + renamed |
| clean-guitar | **−12** (named in guitar *written* pitch, an octave above sounding) | remapped + renamed |
| rhodes-ep | "C2/C3/C4/C5" files actually contain **E2/D3/D4/F4** — the January "Fix 1" remap assumed names were true and detuned the instrument; the pre-fix mapping had been acoustically right | duplicates of E2/F4 deleted, D3/D4 remapped, A2/B3/B4/E5 added from jRhodes3d (max gap 5) |
| string-section | mixed: cello C2 correct, viola renames +12, "C5" actually contained **D6** | rebuilt to sounding pitch |
| steel-drums, finger-bass, piano, vibraphone, acoustic-guitar, hammond | verified correct (hammond's −12 reading is the 16′ drawbar sub-octave, by design) | no change |

Every remapped instrument's `playableRange` and the auto-generated
`SAMPLED_INSTRUMENT_NOTES` table were updated to match; the new
validator pins all 81 pitched samples at 0 mismatches.

## Part 4.5 — Audio quality tooling (added 2026-06-10)

### What exists now

| Tool | Catches | CI? |
|---|---|---|
| `validate-manifests` / `playable-ranges` / `release-times` | schema, range, envelope drift | yes |
| `validate-velocity-layers.ts` | layer loudness ordering (mean dB) | yes |
| `validate-acoustic-pitch.py` | octave/mapping errors vs sounding pitch (autocorr + documented exceptions) | dev (needs ffmpeg) |
| `validate-audio-defects.py` (new) | decoded clipping, flat-tops, DC offset, leading silence, loop-seam clicks (band-limited), range overextension | dev |
| `compare-sample-quality.py` (new) | A/B of any two git trees: shift distance, onset, evenness, velocity→timbre, tuning, truncation | dev |

The new defect validator found real shipped bugs on its first runs: finger-bass
files decoding at +3.8dB over full scale, the whole acoustic-guitar set +1.2dB
over, DC offset on Iowa piano pp and Weresax files, and MP3-encoder-delay-shifted
loop points on the hammond top-octave additions.

### Measured-but-easy upgrades (recommended next)

1. **EBU R128 / ITU-R BS.1770 loudness** (`ffmpeg -af ebur128`): replace the
   ad-hoc mean-dB leveling targets with integrated-LUFS targets per instrument
   and true-peak (4× oversampled) ceilings. Standardized, one flag away.
2. **pYIN f0 tracking** (librosa; Mauch & Dixon 2014): far more robust than the
   current autocorrelation — would eliminate most KNOWN_EXCEPTIONS entries and
   the lag-quantization false alarms above ~C5.
3. **Source-mapping regression**: parse the upstream SFZ (`pitch_keycenter`)
   for every imported sample and assert manifest agreement. Would have caught
   every octave bug in this audit at import time, mechanically.
4. **Payload budget check**: per-instrument size ceiling in `validate-all`
   (the Jan size-discipline guidance is still unenforced).

### Heavier candidates (when warranted)

- **ViSQOL** (Google) or **PEAQ** (ITU-R BS.1387) perceptual codec QA: scores
  encode quality per file — would quantify the 128k MP3 cost and flag
  accidental double-encode generations (we created several this audit before
  switching to re-rendering from lossless).
- **webMUSHRA** (ITU-R BS.1534 listening tests) for genuinely contested
  choices (e.g. FM EP vs jRhodes timbre) — human ears, not metrics.
- **Opus/AAC delivery experiment** from the P6 list: would obsolete the MP3
  encoder-delay and overshoot-headroom workarounds wholesale.

### Lessons encoded in the tools

- Spectral centroid direction across velocity layers is **instrument-dependent**
  (jRhodes hard hits are darker — verified against source FLACs); tools must
  report it, not judge its sign.
- Quiet files need a noise gate before centroid measurement.
- Tuning above ~C5 needs interpolated-FFT, not autocorrelation.
- Loop-point sample positions must be derived from the **decoded delivery
  file**, not the pre-encode audio (MP3 encoder delay shifts them).
- Pre-encode peak ceilings must include codec overshoot headroom (measured up
  to +2.6dB on bright FM content at 128k).

## Part 5 — Prioritized plan

**Tier 1 — bugs (small diffs, big audible wins, no new assets):**
1. P1: honor scheduled `time` in `SampledInstrument.playNote` (+ restore sprite offsets); pass `time` through `engine.ts:1064`. Fixes early/jittery samples **and** swing on sampled tracks.
2. P2: thread velocity from p-lock volume through to `playNote`; add velocity→gain curve; regression test that pp/ff layers are reachable.
3. Fix acoustic-guitar credit URL; regenerate `LICENSE.md` from manifest `credits` (scriptable — manifests are the source of truth); update README count.

**Tier 2 — licensing & cheap sample fixes:**
4. Swap 808 source to `sounds-tr808-fischer` (byte-identical sounds, real CC0).
5. French horn: add VSCO D#1/G1/A#1/D2; alto sax: add Weresax gb3; strings: rebuild as VSCO Viola Section. All same-source, all close documented gaps from `SAMPLE-QUALITY-IMPROVEMENTS.md`.

**Tier 3 — engine features:**
6. P4 sustain loops (organ first), P5 hi-hat choke groups, P3 route samples through TrackBusManager, attack declick, manifest `gainDb`.

**Tier 4 — bigger sample rebuilds (each independent):** ✅ all done 2026-06-10 (see status above; the rhodes FM-replacement was subsequently reverted pending the owner's licensing decision — shipped set is the octave-corrected jRhodes samples).
7. ~~Acoustic kit from Virtuosity velocity layers; piano uniform 3-layer from Iowa (+ trim decays); rhodes from full jRhodes3d; steel drums → jSteelDrum2; vibraphone/marimba/kalimba → VCSL.~~

**Tier 5 — architecture:** revisit `AUDIOWORKLET-ENGINE.md` (after Tier 1, which it presupposes) and the Safari branch.

---

## Appendix A — manifest state at audit time (measured 2026-06-09, pre-fix baseline)

| Instrument | Notes (MIDI) | Max gap | Vel. layers | Release | Range |
|---|---|---|---|---|---|
| piano | 36,41,48,53,60,65,72 | 7 | 3 (F notes only) | 0.5 | 30–78 |
| rhodes-ep | 36,40,48,55,60,65,72 | 8 | 3 (E2/G3/F4 only) | 0.8 | 30–78 |
| hammond-organ | 36–72 (maj 3rds) | 4 | 1 | 0.3 | 36–84 |
| string-section | 36,43,48,53,60,67,72 | 7 | 1 | 0.8 | 30–78 |
| french-horn | 24,41,48,62 | **17** | 1 | 0.6 | 35–68 |
| alto-sax | 38,48,60,68 | **12** | 1 | 0.4 | 32–74 |
| marimba | 36,53,60,77,84 | **17** | 1 | 0.8 | 47–90 |
| vibraphone | 48,60,72,84 | **12** | 1 | 1.0 | 42–90 |
| kalimba | 49,61,73,85 (C#!) | 12 | 1 | 1.0 | 43–91 |
| clean-guitar | 52,64,76,88 | 12 | 1 | 0.3 | 46–94 |
| acoustic-guitar | 40,52,64,80 | **16** | 1 | 0.4 | 34–70 |
| finger-bass | 24,36,42,48,54,60 | 12 | 1 | 0.3 | 18–66 |
| slap-bass | 40,48,57,60 | 9 | 1 | 0.15 | 28–72 |
| steel-drums | 60,67,72,79 | 7 | 3 (names scrambled to match RMS) | 0.8 | 54–89 |
| drums (11) + vinyl | single sample each | n/a | crash/brush 3 | 0.05–2.0 | clamped |

Total payload ≈ 16MB; largest: piano 5.7MB, rhodes 3.7MB, strings 1.1MB.
All files CBR 128kbps MP3 (stereo except hammond mono).

## Appendix B — manifest state after this branch (measured 2026-06-10)

| Instrument | Files | Notes | Max gap | Layers | Size | Range |
|---|---|---|---|---|---|---|
| acoustic-guitar | 4 | 4 | 16 | 1 | 185K | 34–70 |
| alto-sax | 6 | 6 | 8 | 1 | 542K | 47–83 |
| clean-guitar | 4 | 4 | 12 | 1 | 314K | 37–82 |
| finger-bass | 6 | 6 | 12 | 1 | 260K | 18–66 |
| french-horn | 9 | 9 | 14 | 1 | 1438K | 33–79 |
| hammond-organ | 13 | 13 | 4 | 1 (looped) | 941K | 36–84 |
| kalimba | 10 | 10 | 3 | 1 | 291K | 53–87 |
| marimba | 30 | 10 | 7 | 3 | 829K | 35–102 |
| piano | 21 | 7 | 7 | 3 | 2282K | 30–78 |
| rhodes-ep | 15 | 9 | 6 | 3 (on 3 notes) | 4980K | 36–80 |
| slap-bass | 4 | 4 | 9 | 1 | 32K | 28–72 |
| steel-drums | 24 | 8 | 3 | 3 | 654K | 54–87 |
| string-section | 15 | 15 | 5 | 1 | 2244K | 33–88 |
| vibraphone | 22 | 11 | 4 | 2 | 1547K | 47–94 |
| drums (13 one-shots) | 31 | 1 each | – | 1–4 | 1027K | clamped |

Total payload 17.2MB. All files CBR 128kbps stereo MP3, decoded true peak
≤ 0dBFS library-wide (`validate-audio-defects.py`). Remaining known gaps:
acoustic-guitar 16-st gap, french-horn 14-st mid gap, single-layer basses,
rhodes-ep license pending the owner's decision (Part 2).
