# Tone Nets vs Keyboardia: Measured Sound Comparison

**Research Date**: 2026-08-19
**Subject**: `https://tone-nets.web.app/` (Tone Nets, a 3D MIDI visualiser by
Rowan M., source at `github.com/rowan-m/tone-nets`)
**Method**: Download and static analysis of the live production bundle and its
SoundFont; a from-scratch SF2 chunk parse for the sample/zone statistics;
Keyboardia facts verified by reading this repository at
`58264dd5ae274f63b1cd80b72aa823b76b21f28b`. Commands, URLs, and hashes are in
§7 so a later reader can tell whether the external assets have moved.
**Status**: Static comparison plus a frozen-build, same-machine first-contact
startup comparison are complete; see §8. **No listening test was made** — no
claim below asserts that one app is preferred by listeners. §5 separates what
is measured from what is inference.
**Follow-up**: `specs/PHASE-44-SOUND-CHANGES.md` turns §4 into a plan with
preregistered metrics, and withdraws §4.7 on measurement.

> Prior art: "tone-nets" appears nowhere else in this repo. It joins
> `SONG-MAKER-COMPARISON-2026-08.md` (Chrome Music Lab) and the two Ableton
> playground analyses as an external sound reference, and it is the first one
> that is *not* a music-creation toy — which is why it is worth reading.

---

## 1. The comparison is asymmetric, and that matters

Tone Nets and Keyboardia do not have the same job:

| | Tone Nets | Keyboardia |
|---|---|---|
| Input | A finished MIDI file (Moonlight Sonata, Funeral March, user upload) | A step grid the user builds live |
| Musical content | Composed by someone else, already arranged and voiced | Emergent, one loop at a time |
| Audio job | Render 16 GM channels from existing note events | Render arbitrary user-authored steps, in sync, for up to 10 players |
| Timing job | Replay fixed MIDI timestamps | Polyrhythm, swing, tempo changes, multiplayer sync |

So "sound quality" is not one number, and the objective result is a vector,
not a winner:

- **Source assets** — Keyboardia carries 582 files / 36 MB, with real velocity
  layers and 192 deterministic round-robin groups across the enriched
  libraries. Tone Nets carries 526 short sample headers / 83.3 seconds of PCM,
  no velocity layers, and 100% loop coverage.
- **Per-note sampled rendering** — Tone Nets applies a lowpass to 99% of zones,
  a filter envelope to 89%, and an LFO to 100%. The audited Keyboardia state
  applies a calibrated velocity lowpass to six tonal gain-only instruments on
  v<90 notes; sampled filter-envelope/LFO coverage remains zero. Keyboardia's
  native and advanced synth engines already implement both.
- **Space** — Tone Nets carries reverb send on 99% of zones. Keyboardia now
  defaults new sessions to a measured bass-protected 0.15 global room; it has
  no per-instrument send.
- **Mobile route** — both now have media-element output architectures.
  Keyboardia's physical ringer-off result and added device latency remain an
  open manual gate, so architecture is not reported as physical proof.
- **Startup** — §8 measures first master PCM rather than inferring speed from
  initialization code. The tested Keyboardia medians are 244.5–383.6 ms; the
  frozen Tone Nets first-MIDI median is 1,215.9 ms under its heavier required
  first-contact workload.
- **Timing responsibility** — Keyboardia has a worklet scheduler and live
  collaborative transport. Tone Nets replays fixed MIDI timestamps. These are
  product capabilities, not a sound-preference score.

Everything in §4 follows from gaps in that vector. None follows from the
author's or user's taste.

---

## 2. What Tone Nets actually is (measured, not assumed)

### 2.1 Engine

The chunk named `vendor-tone-*.js` (560,475 bytes) is not mainly Tone.js — it
contains **SpessaSynth**, a full SF2/DLS SoundFont synthesizer that runs
entirely inside an `AudioWorkletProcessor`. Tone.js is present only to own the
`AudioContext`; the app reaches straight through it
(`Tone.rawContext._nativeContext`) and hands the native context to SpessaSynth.

Runtime configuration read from the bundle:

```js
const isMobile = X.isMobile();
synth.setSystemParameter('voiceCap', isMobile ? 64 : 128);
synth.setSystemParameter('autoAllocateVoices', false);
if (isMobile) synth.setSystemParameter('interpolationType', 0);  // linear
```

`{linear: 0, nearestNeighbor: 1, hermite: 2}` is SpessaSynth's own enum, and
its default is `hermite`. So Tone Nets ships **two explicit quality tiers**:
128 voices with 4th-order Hermite interpolation on desktop, 64 voices with
linear interpolation on mobile. The synth's built-in reverb and chorus are left
enabled (`effectsEnabled: true` in the shipped defaults object).

### 2.2 The SoundFont, parsed

`/creative-emu10k1-8mbgmsfx.sf2`, 7,557,598 bytes. INFO chunk says
`8MBGSFX E-mu Rev B`, target engine `EMU8000`, `E-mu Systems, Inc. 1997`,
SF2 version 2.0 — the SoundBlaster-era 8 MB General MIDI bank.

| Measured | Value |
|---|---|
| Sample headers | 526 |
| Sample rates | 44,100 Hz — **all 526** |
| Bit depth | 16-bit PCM (`smpl` chunk, 3,689,196 frames) |
| **Looped samples** | **526 / 526 (100%)** |
| Total audio in the bank | **83.3 seconds** |
| Mean sample length | **0.158 s** |
| Presets / instruments | 137 / 136 |
| Sample zones | 1,787 (mean 13.1 per instrument, median 8) |
| Melodic zones | 1,366, **median key span 8 semitones** |
| Drum zones | 421, median key span 1 (one sample per key) |
| **Instruments with >1 velocity zone** | **0 / 136** |

Two numbers deserve emphasis.

**83 seconds of audio for a complete 136-instrument General MIDI bank.** That
is possible only because every sample loops. A 158 ms fragment of a string
section sustains for as long as the key is held. The bank is not big; it is
*structured*.

**Zero velocity layers, anywhere.** The EMU bank does not multi-sample
dynamics. Velocity still changes timbre, because the SF2 spec's *default
modulators* route velocity to both output attenuation and filter cutoff — and
the `imod` chunk is empty (0 records), confirming the bank relies on exactly
those spec defaults. Soft notes get quieter *and darker* from one sample.

### 2.3 What every voice gets

Generator usage across the 1,787 zones — this is per-voice DSP the synth
applies on top of the sample:

| Generator | Zones | Share |
|---|---|---|
| `initialFilterFc` (per-voice lowpass) | 1,773 | **99%** |
| `reverbEffectsSend` | 1,774 | **99%** |
| `freqVibLFO` / `freqModLFO` | 1,787 | 100% |
| `releaseVolEnv` | 1,749 | 98% |
| `modEnvToFilterFc` (filter envelope) | 1,596 | **89%** |
| `initialAttenuation` | 1,584 | 89% |
| `decayVolEnv` / `sustainVolEnv` | 1,563 / 1,517 | 87% / 85% |
| `pan` | 917 | 51% |
| `attackVolEnv` | 990 | 55% |
| `initialFilterQ` | 272 | 15% |
| `chorusEffectsSend` | 81 | 5% |

The filter is not a formality. Excluding zones left at the SF2 default of
13,500 cents, the shipped cutoffs are **median 1,267 Hz** (p10 411 Hz,
p90 3,075 Hz) — most zones sit substantially closed at rest, and 89% have a
mod envelope that opens them on attack. That makes filter cutoff time-varying
on each note; its listener impact was not measured here.

### 2.4 Platform handling — the part Keyboardia is missing

```js
_setupBackgroundAudio(ctx, isMobile) {
  if (isMobile && ctx.createMediaStreamDestination) {
    const dest = ctx.createMediaStreamDestination();
    this.masterGain.connect(dest);
    const el = new Audio();
    el.srcObject = dest.stream;
    el.muted = false;
    el.setAttribute('playsinline', '');
    el.style.display = 'none';
    document.body.appendChild(el);
    el.play().catch(...);
    this.streamAudio = el;
  } else {
    this.masterGain.connect(ctx.destination);   // desktop only
  }
}
```

On mobile the Web Audio graph never reaches `ctx.destination`. It goes into a
`MediaStreamAudioDestinationNode`, out through a hidden `<audio playsinline>`
element, and therefore through the **media** pipeline rather than the
ambient/Web-Audio one — which is what makes it audible on an iPhone with the
physical ringer switch set to silent.

Alongside it: a looping `background.mp3` (46,080 bytes) played for the duration
of playback, and `navigator.mediaSession` with `playbackState` and position
updates — lock-screen transport, and a signal to iOS that this is a media app.

### 2.5 Startup discipline

```js
// don't trust state === 'running'; wait for the clock to actually move
const t0 = ctx.currentTime, w0 = performance.now();
while (ctx.currentTime === t0 && performance.now() - w0 < 2000) await delay(50);
await delay(500);
synth = new WorkletSynthesizer(ctx);
...
masterGain.gain.setValueAtTime(0, ctx.currentTime);
for (const ch of [0, 1, 2, 9]) { synth.noteOn(ch, 60, 1); synth.noteOff(ch, 60); }
await delay(100);
```

Three separate defences before the first audible note: gate on a *live* clock
rather than on `state === 'running'`; allocate the worklet only once the clock
moves; then fire silent warm-up notes on three melodic channels and the drum
channel with the master at zero, so voice allocation and JIT happen before
anything is heard. Master gain moves with `setTargetAtTime(v, t, 0.01)`
throughout, so transport changes never click.

---

## 3. Keyboardia baseline (verified file:line)

### 3.1 Source-library structure

27 sampled instruments, 582 sample files, 36 MB encoded (mp3/m4a). Measured root-note
coverage for the melodic instruments:

| Instrument | Sampled roots | Widest gap (semitones) |
|---|---|---|
| `acoustic-guitar` | 15 (E2–B5) | 4 |
| `string-section` | 15 (C2–D6) | 5 |
| `vibraphone` | 11 (F3–E6) | 4 |
| `marimba` | 10 (F2–C7) | 7 |
| `hammond-organ` | 9 (C2–C6) | 8 |
| `french-horn` | 9 | 14 (F3→D5) |
| `piano` | 7 (C2/F2…C5) | 7 |
| `alto-sax` | 6 (D3–Ab5) | 8 |
| `clean-guitar` | 4 (E2–E5) | 12 |
| `kalimba` | 3 (B3, B4, A5) | 12 |

The pipeline's own receipt records the post-enrichment figures for the two
enriched libraries: `finger-bass` 14 roots / mean shift 1.08 semitones,
`steel-drums` 24 roots / mean shift 0.91
(`app/sample-pipeline/enrichment/impact.json`).

On keymap density, the top half of that table has a maximum gap no larger than
the SF2's median 8-semitone melodic span. `french-horn` has a 14-semitone gap;
`clean-guitar` and `kalimba` use octave spacing. These are coverage facts, not
an acoustic ranking.

Beyond density, Keyboardia has structure the SF2 does not: real velocity
layers (`piano` pp/mf/ff, `alto-sax` soft/loud), deterministic round robins
(192 groups across the eight enriched libraries), articulations, and
optional sustain loops
(`sampled-instrument.ts:164-165, 638-642, 715-750`).

### 3.2 Signal chain

```
source → track gain → master gain
  → DynamicsCompressor(-1 dB, 8:1, 3 ms / 80 ms)   engine.ts:289-306
  → makeup (-0.52 dB)  → outputTrim (-2.25 dB)     constants.ts
  → destination
```
with the Tone effects chain, when enabled, inserted before the trim:
```
dry ─┬──────────────────────────────────────────────┬→ Limiter(-2 dB) → out
     ├→ delay ─────────────────────────────────────→┤     toneEffects.ts:172-195
     └→ HPF 275 Hz → predelay 15 ms → Reverb → wet →┘
```

This is a careful chain. The reverb send is high-passed at 275 Hz so kicks and
808s don't muddy the tail, there is a 15 ms predelay so the dry transient stays
distinct, and the master dynamics are explicitly documented as a safety net
rather than a mixer (`constants.ts`, "Master bus — Phase 43.1").

**And it ships with `reverb.wet: 0`** (`app/src/shared/effects-defaults.ts:9`).
Both the new-session and legacy-session policies resolve to the same value.
Every Keyboardia note reaches the speaker with no space around it.

### 3.3 Where the rendering stops

`grep -c createBiquadFilter app/src/audio/sampled-instrument.ts` → **0**.

The sampled path applies a playback rate and a gain. There is no per-voice
filter, no filter envelope, and no LFO. Velocity selects a layer where layers
exist and otherwise only scales amplitude. The native `SynthEngine` *does* have
a per-voice filter with velocity-scaled cutoff (`synth.ts:116, 870, 892`) — the
capability exists in the codebase, it just isn't on the 27 sampled instruments,
which are what most sessions actually use.

### 3.4 Other Keyboardia capabilities

- **The clock is in a worklet.** `worklets/scheduler.worklet.ts` owns the timing
  loop and posts note events to the main thread — `process()` every ~2.67 ms at
  48 kHz, not `setTimeout`. Tone Nets has no equivalent problem to solve.
- **A real grain pitch shifter** (`worklets/pitch-shift-engine.ts`, PSOLA-style
  overlap-add) for duration-preserving shift, rather than resampling only.
- **Multiplayer-synchronised transport**, swing, polyrhythm, parameter locks.
- **Provenance discipline** on sample content: hash-pinned dispositions,
  blind-review ledger, licence tracking. Nothing in Tone Nets compares.
- **iOS `interrupted` state is handled** (`engine.ts:270, 676`) and
  `webkitAudioContext` is used (`engine.ts:50-51`).

---

## 4. Historical baseline proposals, ranked by testable impact

This section records the 2026-08-19 proposals before Phase 44 implementation.
It is not current status: §8.2 records what shipped and §8.4 records the
remaining dispositions. The original ranking is retained so later readers can
compare the proposal with the measured result. Each item names its evidence.

### 4.1 Route mobile output through a media element — highest functional impact

`grep -rn "createMediaStreamDestination\|mediaSession" app/src` → **no matches**.

`specs/research/MOBILE-LESSONS.md:96-100` names the iOS ringer switch as the
**most common** cause of "no sound on mobile", and its remedy is *"Check that
the mute switch doesn't show orange."* That is a user instruction, not an
engineering fix. Tone Nets engineers around it in about fifteen lines (§2.4).

This is the difference between sound and silence, so it outranks everything
else in this document. Ship the desktop path unchanged; on mobile, connect
`outputTrim` to a `MediaStreamAudioDestinationNode` and play its stream through
a hidden `<audio playsinline>`. Risks worth measuring before committing:
added output latency through the media element, and whether the metering taps
(`metering-host.ts`) still see the signal.

### 4.2 Ship a default room

`DEFAULT_EFFECTS_STATE.reverb.wet = 0`. Meanwhile 99% of the EMU bank's zones
carry a reverb send, and SpessaSynth's own effects default to enabled.

This is not a new idea here — `specs/SOUND-QUALITY-PARITY-PLAN.md:508-523`
already specifies *"Reverb wet 0 → 0.15, with bass protection"*, already
diagnosed dry playback as *"phone speaker in a closet"* (line 662), and the
plumbing to do it safely (HPF 275 Hz, 15 ms predelay, parallel wet gain) was
built and shipped. Only the default was never flipped. Tone Nets is independent
evidence that a product can ship non-zero room depth across almost its entire
bank, which justified testing a non-zero Keyboardia value. The Phase 44
production-browser tail/body/peak/LU measurements prove that 0.15 complies with
the preregistered internal acoustic and safety contract; they do not establish
listener preference.

### 4.3 Velocity → brightness on the sampled path

One `BiquadFilterNode` per sampled voice, cutoff scaled by MIDI velocity, is
what the SF2 default modulator does — and it is why a bank with *zero* velocity
layers still responds to dynamics. Keyboardia has velocity layers on 4–5
instruments; the other 22 get amplitude only.

The engine already knows how: `synth.ts:116` documents the native synth's
velocity→cutoff curve (88.9% of nominal at the canonical velocity 90). Reusing
that curve in `sampled-instrument.ts` extends dynamic timbre to every sampled
instrument for the cost of one node per voice, and composes with the existing
layers rather than replacing them.

### 4.4 Warm the audio path, not just the sample cache

`useTrackPrewarm.ts` prewarms *sample loading*. Tone Nets additionally fires
silent notes at master gain 0 across melodic and drum channels so voice
allocation and JIT are done before anything is audible. Keyboardia's equivalent
would be a silent note through the real instrument path at play-arm time — the
first hit after adding a track is exactly where an unwarmed graph shows.

### 4.5 Gate on a live clock, not on `state === 'running'`

`engine.ts:268-270` resumes on `suspended`/`interrupted` and proceeds. Tone Nets
polls `currentTime` for up to 2 s and only builds the synth once the clock has
actually advanced. On iOS a context can report `running` while its clock is
still parked; the poll costs nothing when the clock is healthy.

### 4.6 Add `navigator.mediaSession`

Lock-screen transport for a session someone is jamming to, plus the signal to
iOS that this is media. Cheap, and it pairs naturally with 4.1.

### 4.7 Loop points — **measured and withdrawn (2026-08-19)**

The original form of this item reasoned from the EMU bank's 100% loop rate:
Keyboardia's `LoopSpec` exists (`sampled-instrument.ts:164-165, 638-642`) but
only `hammond-organ` declares one, so sustaining instruments looked
length-limited on tied notes.

Measurement does not support it. `npm run measure:velocity-timbre` reports
usable sample length per instrument, and every sustaining instrument holds far
past a realistic tied note: `string-section` 9.34 s, `french-horn` 9.70 s,
`piano` 6.98 s, `alto-sax` 5.86 s, `clean-guitar` 5.10 s. The two short ones,
`acoustic-guitar` (2.06 s) and `slap-bass` (0.42 s), are plucked instruments
where decaying to silence is correct.

`specs/PHASE-44-SOUND-CHANGES.md` §4 replaces this recommendation with a
regression guard, so the ceiling is watched rather than widened.

### 4.8 Two explicit quality tiers

Tone Nets ships 128 voices + Hermite on desktop, 64 + linear on mobile — one
`isMobile()` branch, decided once. Keyboardia's per-track engine caps
(`synth-types.ts:77` MAX_VOICES 16, `advancedSynth.ts:735` MAX_VOICES 8,
Tone `maxPolyphony` 8) are fixed regardless of device, and the pitch-shift
worklet runs at one grain size everywhere. A single documented tier switch
would give the mobile path headroom without capping desktop.

### 4.9 Per-instrument space, not one global wet

The SF2 carries `reverbEffectsSend` **per zone** — the bank arrives
pre-balanced in depth, with a marimba drier than a string section. If 4.2
lands, an architecturally related follow-on is a per-instrument send scalar in the manifest
so one global wet does not put the 808 kick in the same hall as the strings.

---

## 5. What this does and does not establish

Per this repo's standing convention on claim levels:

- **Measured**: everything in §2 (bundle and SF2 parse), §3 (repository and
  asset reads), and §8 (repeated first-master-PCM startup trials).
- **Inference, not measurement**: that the per-voice filter and always-on
  reverb are *why* Tone Nets sounds cohesive. That is a reading of the DSP, not
  a listening result.
- **Deliberately not scored**: cross-app spectral distance or loudness as
  “quality”. Different source samples and instrument renderers make those
  objective measurements of difference, not objective measurements of merit.
- **Not attempted**: any listener-preference test. That remains necessary if a
  future claim says users prefer one product's sound.
- **Not comparable by construction**: Tone Nets plays professionally composed
  MIDI. Some of its perceived quality is the Moonlight Sonata, not the synth.

## 6. What not to copy

- **Not the SoundFont.** Keyboardia's source library has real velocity layers,
  round robins, and much longer recordings; the EMU bank has GM breadth, compact
  looping, and richer per-zone DSP. Replacing one with the other would exchange
  measured dimensions, not produce an evidence-backed global improvement.
- **Not the fixed global voice cap.** Keyboardia allocates per track by design;
  a single 128-voice pool is the wrong shape for it.
- **Not `background.mp3` on its own.** The looping media element is a
  background-playback trick with a standing decode cost. For the silent-switch
  problem specifically, the `MediaStreamDestination` route in 4.1 is the part
  that matters; adopt the dummy loop only if background playback is a goal.
- **Not `interpolationType: 0` without measurement.** Keyboardia uses a
  different grain pitch-shifter over user-selected transpositions. Copying an
  SF2 interpolation switch would change a different algorithm and has no
  demonstrated capacity or spectral benefit here.

---

## 7. Receipt

Retrieved 2026-08-19. Keyboardia read at
`58264dd5ae274f63b1cd80b72aa823b76b21f28b`. Re-checked 2026-08-22: the live
index page hashes identically to the row below, the bundle fingerprints
are unchanged, the SoundFont still reports 7,557,598 bytes, and `origin/main`
is still the pinned commit. On 2026-09-13 the production build from source
commit `d6e9ba837f2e408971458c5ca6f6b63d0c909d76` reproduced every filename and
hash below. The static baseline and runtime subject are therefore frozen.

| Asset | Bytes | SHA-256 |
|---|---|---|
| `https://tone-nets.web.app/` | 20,769 | `b6d5081148baa2c693caab8d392c14ce1d1d11a3b64f1c79b7aa23a65a4100ac` |
| `/assets/index-D6Mm5cJ7.js` | 119,027 | `196c447bc8fc6d0e1b7816edf2dd163941d1c15110f2ea15e71d8861d6ba1a3b` |
| `/assets/index-CAIWfFlo.css` | 9,479 | `065a073175e5ad1bdb2561e9e654f05d06c5f42e546ca1187d055bae400734fd` |
| `/assets/vendor-tone-CEpHDcb7.js` | 560,475 | `153e720f4b45f878d6feeacfbc215cab0493ee88c50eb153b9e772be00b9beab` |
| `/assets/vendor-three-DPBQW5Ox.js` | 616,486 | `a10572eb76aaf31c2865edb41c737b9765225b70abf042a3e929ac753e929d61` |
| `/assets/rolldown-runtime-B0Z9INg1.js` | 901 | `5e9b0d884d2ebb14e241ab38b43e41efb61bce2e74d71507b0b95b264fba4047` |
| `/assets/parser.worker-BGliF577.js` | 44,123 | `e37866ef524e1a6ad8847d670434c01e6e223afc7ad94cf25ccaa1ab26cc7f11` |
| `/assets/spessasynth_processor.min-B_uip0PK.js` | 407,436 | `72a9b2cd8f9589bcd80b2663d6d8be69386cf2aa887619d827a32de2e99e4439` |
| `/creative-emu10k1-8mbgmsfx.sf2` | 7,557,598 | `6c2ff6e9219989e0a2d39e633cbdc7d8f8a575903985160495aeab5d01cc48e6` |
| `/background.mp3` | 46,080 | `830b89effd32a7a893486801808792cc1bde8abd076193aaee0c48b3c6f4bb46` |

SF2 statistics come from a purpose-written RIFF/`pdta` parse (`phdr`, `inst`,
`ibag`, `igen`, `imod`, `shdr`) using only the Python standard library —
no SoundFont library was trusted for the numbers. Generator semantics follow
the SF2.04 generator enumeration; zone counts include only bags carrying
generator 53 (`sampleID`), which excludes global zones.

Keyboardia sample counts come from `app/public/instruments` at the pinned
commit; pitch-shift figures for `finger-bass` and `steel-drums` are the
project's own recorded measurements in
`app/sample-pipeline/enrichment/impact.json` (measured 2026-08-12), not
re-derived here.

**Limitations.** Tone Nets is a live deploy and may change; the hashes above
are the only guarantee of what was analysed. The SF2 statistics describe the
bank as shipped, not what SpessaSynth ultimately renders — runtime MIDI CC,
the synth's own reverb/chorus, and the SF2 default modulators all act on top.
§8 measures first PCM only, not those acoustic transformations. Nothing here
was listened to.

---

## 8. Runtime follow-up: objective first-contact comparison (2026-09-13)

### 8.1 Method

The live asset hashes in §7 were reproduced from Tone Nets source commit
`d6e9ba837f2e408971458c5ca6f6b63d0c909d76`; its local production build emitted
the same index and bundle filenames byte for byte. Five fresh Chromium contexts
per path ran on macOS 26.5.1 arm64, Chromium 143, Node 26, at 48 kHz. Servers
and the browser process were warm; contexts and audio engines were cold.

An `AudioWorkletProcessor` scans each render quantum and retains the absolute
audio frame of the first master-bus sample at or above `1e-4`. After the worklet
message arrives, `AudioContext.getOutputTimestamp()` maps that retained frame
to the page clock. This matters under load: the calibration source was scheduled
at context time 0.1 s, the main thread was blocked for more than 700 ms, and
both product harnesses still recovered the exact 0.1 s audio frame (0 ms error).
Connect-overload controls also cover explicit `undefined` and `AudioParam`
destinations so instrumentation cannot alter legal production graph calls.
Observer readiness is bound to an application event that precedes emission:
Keyboardia's awaited preload hook holds the scheduler-release boundary until
the worklet is ready, and Tone Nets' worklet is ready before the first upstream
source connects to its master gain. The Keyboardia wait is included in the
reported latency, making that result conservative by the observer setup wait.
A 250 ms-late pulsed control retained thousands of silent frames yet observed
the second pulse 400 ms after the true first pulse. The old silent-prefix rule
would have accepted it; the application-boundary rule rejected it. The
zero-gain branch does not replace the audible route. Keyboardia times the first
transport click on a loaded one-track session. Tone Nets times the DOM `change`
event for selection of a deterministic 120 BPM MIDI fixture
(GM String Ensemble 1, repeated C4 at velocities 40/90/127) on its loaded
landing page.

| Product/path | Min | Median | p95 (= max at n=5) |
|---|---:|---:|---:|
| Keyboardia whole engine + native `synth:lead` | 243.0 ms | **244.5 ms** | 270.1 ms |
| Keyboardia cold Tone `tone:fm-epiano` | 345.9 ms | **354.5 ms** | 375.3 ms |
| Keyboardia cold advanced `advanced:supersaw` | 370.0 ms | **383.6 ms** | 398.5 ms |
| Tone Nets first MIDI/SF2 sound | 1,195.2 ms | **1,215.9 ms** | 1,243.8 ms |

The Keyboardia medians are respectively 79.9%, 70.8%, and 68.4% lower than
the Tone Nets median on this machine. This is a product-boundary first-contact
measurement, not an equal-work engine microbenchmark: Tone Nets' action includes
MIDI ingest, a 7.56 MB SoundFont fetch/parse, fixed stabilization waits, worklet
creation, and silent warm-up notes. Keyboardia's action includes engine/Tone
construction and instrument preload from an already-loaded session page.
An immediately preceding valid Keyboardia batch recorded one 755.9 ms advanced
trial while its engine-exposed and Tone-ready milestones were also delayed; the
final retained batch's advanced maximum is 398.5 ms. At n=5, p95 equals the
observed maximum and neither batch is a population tail estimate.

The persistent guards are:

```bash
cd app
# Keyboardia: produces browser-cold-startup-matrix.json
USE_MOCK_API=1 npx playwright test e2e/capture-session.spec.ts \
  --project=chromium --workers=1 --retries=0 -g "measures cold Tone"

# Tone Nets: run its frozen production preview first; all ten hashes are gated
npm run measure:tone-nets-startup -- --url http://127.0.0.1:4175/ --trials 5
```

Both reports retain all trials. The E2E fails if any Keyboardia path emits no
master PCM, exceeds five seconds, or does not create a real audio context. The
Tone Nets tool fails before launching Chromium if any frozen asset differs.
The final paired raw values and oracle controls are preserved in
[`TONE-NETS-STARTUP-RECEIPT-2026-09-13.md`](./TONE-NETS-STARTUP-RECEIPT-2026-09-13.md).

### 8.2 What objectively improved in Phase 44

| Contract | Before | Audited Phase 44 state | Residual gap |
|---|---|---|---|
| Sampled velocity timbre | 12/26 instruments gain-only | six tonal gain-only instruments now show 29.7–30.3% v40-v127 centroid reduction over all 281 audited requested notes at 44.1/48 kHz | unlocked/v≥90 notes bypass; no sampled per-note motion |
| New-session space | global reverb 0 | 0.15 room; tail +19.7–24.8 dB, bass body within ±0.109 dB, peak/LU bounded, and 0.000 dB compressor delta when the exact captured 16-track input is replayed dry/wet | one global depth |
| Cold startup evidence | sampled first-use fixture only | retained native/Tone/advanced medians 244.5/354.5/383.6 ms; a preceding valid batch exposed one 755.9 ms advanced contention outlier | physical-device matrix/generalization |
| First sampled onset consistency | first note could schedule its de-click ramp at `currentTime`, allowing the render thread to enter mid-ramp | real-time sampled lead `max(3 ms, 513 / sampleRate)`; a zero-lead mutation failed source RMS in 2/12 contexts, while 13/13 guarded contexts measured 38.7–54.7 ms click-to-audible and a 0/≤0.000002 dB source peak/RMS repeat null | the floor costs 10.6875 ms at 48 kHz for an event with insufficient lead; other sampled instruments and physical devices remain unmeasured |
| Mobile output | direct Web Audio destination | both final graphs terminate through the mobile media-element route | physical ringer-off and latency pass still open |
| Sustain safety | loop metadata existed but was mostly absent | eight sustaining manifests have a ≥2 s median native-root regression guard | intentionally no every-note/extreme-tie guarantee |

### 8.3 Why sustain loops were demoted

Tone Nets must loop all 526 sample fragments because the bank's mean fragment
is only 158 ms. Keyboardia's sustaining recordings are a different dataset:
the eight classified sustaining instruments have native-root medians from
3.90 to 9.70 seconds, all above the 2.0-second duration of a fully tied 16-step
bar at 120 BPM. The genuinely short `slap-bass` and `acoustic-guitar` are
plucked instruments for which decay is part of the source behavior.

Adding loops anyway would not be a monotonic improvement. It can introduce
boundary clicks, phase discontinuities, frozen ensemble motion, and audible
periodicity, while creating loop-point data and review obligations for hundreds
of mappings. The implemented `validate:sustain-ceiling` guard checks the actual
manifest mappings/segments and fails `validate:all` if a sustaining library's
median native-root usable duration falls below 2 seconds. In other words,
we guarded the user-facing capacity the loops were meant to protect instead of
copying the other product's implementation. Instrument-specific loops remain
appropriate if a requested-note render or real session later demonstrates a
shortfall; 32-second extreme ties and every transposed note are not claimed.

### 8.4 Remaining feature decisions

The sampled first-use investigation also separated warm-up from late
scheduling. A silent priming note cannot repair automation placed partly in the
past. Keyboardia now reserves `max(3 ms, 513 / sampleRate seconds)`—four
128-frame render quanta plus one frame—for a real-time sampled note requested
with insufficient lead. That floor is 10.6875 ms at 48 kHz and 11.6327 ms at
44.1 kHz. Sufficiently future-scheduled sampled notes keep their requested
time, offline sampled renders pass a zero floor, and the native, Tone, and
advanced paths are untouched. This is a bounded scheduling correction with a
disclosed latency cost, not evidence for pre-playing voices. The 12-context
negative control, 13-context guarded control, and exact source-prefix frames
are retained in
[`SAMPLED-FIRST-USE-RECEIPT-2026-09-13.md`](./SAMPLED-FIRST-USE-RECEIPT-2026-09-13.md).

- **Per-note sampled filter envelopes:** viable as opt-in manifest metadata and
  automation of the existing lowpass. Global use would break the deliberate
  v≥90 legacy bypass, so first prototype it on 2–3 sustaining tonal instruments
  and gate attack/hold/release centroid trajectories plus the legacy null.
- **Per-note sampled LFOs:** viable but more expensive. A Web Audio oscillator
  plus gain per voice has clear node/CPU cost; a shared/worklet LFO is cheaper
  but changes phase/retrigger semantics. Choose only after a 16-track capacity
  ablation. Native and advanced synths already have this capability.
- **Per-instrument reverb-send depth:** the strongest next candidate. It needs
  a post-fader/post-pan send from every `TrackBus` into the shared room because
  the existing global send happens after tracks mix. Derived instrument defaults
  avoid a session migration; user overrides would require synced schema/UI.
- **Device-specific quality tiers:** not safe to automate yet. Keyboardia has
  an iOS sample-cache tier, but no output-underrun/dropout or voice-steal metric;
  UA, `hardwareConcurrency`, and `deviceMemory` cannot authoritatively classify
  Safari hardware. Add observability and an Auto/Eco/High local override, then
  calibrate on physical low/mid/high devices before selecting thresholds.

The detailed feasibility/impact/proof matrix is in
`specs/PHASE-44-SOUND-CHANGES.md` §12.
