# Sound Quality Parity Implementation Receipt

> **Date:** 2026-08-10
> **Plan:** `specs/SOUND-QUALITY-PARITY-PLAN.md`
> **Baseline commit:** `4b7ffc266c1351bddd26ec8a1ebda027491fde2b`
> **Reassessed:** 2026-08-11
> **Result:** Internal hardening is partially implemented and tested. Human
> cross-app preference and first-contact parity are not established.

## Verdict

The implementation made Keyboardia measurably better on the attributes the
plan can test without a listener: master-bus stability, repeated-hit variation,
velocity-layer continuity, cross-instrument loudness, intentional stereo
placement control, mono compatibility, default note-entry guardrails, velocity-sensitive
timbre, and procedural drum spectra. It also removed two real risks found only
by the new rig: an incorrect compressor tap and a browser-decoder-specific onset
trim that would have cut into AAC attacks.

The 2026-08-11 audit narrowed the claim further. The original procedural S5
fixture proved panner behavior, not the effect on shipped stereo samples; a new
real-asset fixture showed that the proposed sampled-track preset narrowed its
S/M result. Automatic placement is now limited to known mono sources. The audit
also added explicit dry migration for legacy sessions, all-file browser onset
coverage for sampled percussion, and a real 16-track browser fixture alongside
the synthetic capacity canary.

This receipt does **not** claim that Keyboardia now wins a preference test
against Song Maker. That conclusion requires randomized, level-matched human
listening and a system-loopback Song Maker capture. The A/B page and protocol
exist, but no listener results or confidence interval have been fabricated.

## Objective before/after evidence

| Attribute | Before | After | Gate / interpretation |
|---|---:|---:|---|
| Master topology | Tone path bypassed the tuned compressor | Compressor is in the measured active path before time effects | Shipping bug fixed |
| Browser through gain | Unmeasured | +0.00000046 dB | Unity ±0.1 dB |
| Browser compressor latency | Unmeasured | 288 frames / 6.000 ms | Measured and compensated |
| 150 ms post-pileup attenuation | Unmeasured | 0.2101 dB, monotonic recovery | ≤4 dB, monotonic |
| Controlled 8 kHz canary under 16-source pileup | Unmeasured | −0.3125 dB | absolute delta <2 dB |
| Same-build repeat null | No guard | −264.49 dB after alignment | ≤−60 dB |
| Real 16-track heard-output peak | Not tested (synthetic canary only) | −0.6806 dBFS after final safety trim | ≤0 dBFS |
| S3 unlocked hit-level spread | 0 dB | 2.2837 dB | non-zero; within 2.5 dB percussion budget |
| S3 explicit p-lock replay | fixed | 0 dB delta; byte-identical PCM | must remain exact |
| Piano layer-boundary LSD | 22.3655 hard switch | 9.3718 crossfaded | ratio 0.4190 ≤0.75; 58.1% lower |
| Piano / steel drums / finger bass delivered C4-mf spread | 4.79 dB | 0.10 dB | every tonal instrument within ±2.5 dB of piano |
| S5 procedural panner canary S/M | −∞ dB (centered mono fixture) | −16.3969 dB | DSP canary only; not shipped-sample evidence |
| S5 shipped-sample automatic policy | −0.5259 dB S/M | −0.5259 dB S/M | sampled/user audio remains centered; intrinsic stereo preserved |
| S5 shipped-sample manual placement | −0.5259 dB S/M | −1.5391 dB S/M | measurable placement change; no universal "wider is better" direction claimed |
| S5 shipped-sample mono fold-down | baseline | +0.4795 dB | absolute delta ≤1 dB |
| Centered shipped kick/bass S/M delta | baseline | 0 dB | center pan preserves intrinsic stereo |
| Missing legacy effects | could inherit fresh-session 15% room | explicit dry migration | existing music is not reinterpreted on load |
| Fresh-session note entry | chromatic | 100% of tested clicks in C minor pentatonic | locked guardrail; explicit unlock syncs/persists |
| Advanced-synth default velocity cutoff | no velocity mapping | 88.9% of preset cutoff at MIDI 90 | calibrated 0.85–0.90 target |
| Procedural hi-hat energy above 5 kHz | white-noise baseline | 99.0%; centroid 12.16 kHz | ≥80% |
| Procedural kick sweep | incorrect `f(t)·t` phase and 190 Hz start | measured ~120 Hz early to ~46 Hz late; production law is 150→40 Hz | downward track and phase integration fixed |
| Sample audit | 0 errors, 81 unwaived review flags, 155 waived | 0 errors, 81 unwaived review flags, 154 waived | hard errors remain zero; one stale waiver removed |

The pre-change S1 procedural proxy peak was +8.1294 dBFS. The controlled
post-change browser capacity probe measured −3.9195 dBFS before compression and
−4.3615 dBFS after makeup. These are intentionally **not** presented as a direct
before/after delta because they are different fixtures; the browser receipt is
the comparable dynamics gate going forward.

## What shipped by phase

### 43.0 — Measurement and audition infrastructure

- Pure peak/RMS, pumping, correlation, mid/side, K-weighted loudness, spectral,
  band-energy, onset, and DC metrics with mutation coverage.
- Required Tone-free offline renderer with seeded procedural PCM and
  byte-identical repeat checks.
- One synchronized AudioWorklet recorder for pre-compressor, post-makeup, and
  heard-output taps; frame coverage and drift are checked.
- Dev A/B page with onset alignment, level-matched A/B, blind switching, and a
  raw-unity null path.
- Exact S1–S6 JSON fixtures plus committed offline and Chromium metrics receipts.

### 43.1 — Master bus

- Shared −3 dB input trim; compressor at −10 dBFS, 3:1, knee 12, 15 ms attack,
  200 ms release; measured 1.67027698 dB auto-makeup null; −1 dB
  compressor-style limiter plus a −1 dB post-limiter safety trim. Calibrated
  source trims reduced the real 16-track pre-compressor peak from +5.17 to
  +3.55 dBFS; the heard output remains true-peak safe at −0.27 dBTP while
  reclaiming 1 dB of output level.
- Active order is compressor/makeup before distortion, chorus, delay, and the
  parallel room, ending at `Tone.Destination (Volume → Gain)`.
- Native no-Tone fallback uses the same dynamics, makeup, and output trim.

### 43.2–43.3 — Defaults, dynamics, and humanization

- Canonical new sessions persist locked C minor pentatonic; old missing-scale
  sessions normalize to explicit unlocked state at every client/server boundary.
- Canonical new sessions persist the new effects default; old sessions with no
  effects field normalize to an explicit dry state rather than inheriting it.
- Unlocked notes use MIDI velocity 90 for timbre at unity note gain. Explicit
  locks use the shared 40 dB perceptual curve and retain historical MIDI export.
- Bounded deterministic gain humanization is keyed by track, step, and loop;
  explicit locks are exempt. Main-thread and worklet contracts carry the same
  velocity, gain, explicit-lock, and iteration fields.
- Landing examples use the sampled 808 kit; the intentionally blank-session
  experience remains blank.

### 43.4 — Samples and calibration

- Gating `loudnessKMax` compares the delivered MIDI-90 note nearest C4 to piano
  C4-mf and rejects a mismatch outside ±2.5 dB. Manifest gains were calibrated
  without rewriting source evidence.
- Six tonal multi-layer instruments use an eight-velocity crossfade; drums do
  not crossfade. Real piano renders prove the transition is smoother.
- Node/browser cross-decoder receipts cover representative 808 and acoustic
  kick/snare files. The browser lane additionally enforces the ≤5 ms effective
  onset for every sampled percussion file affected by adaptive playback.
  String G5 has a 19.8 ms manifest trim.
- WebKit retained 13.08 ms of MP3 priming on the 808 kick that Chromium and
  Node stripped. Playback now measures decoded onset and applies a bounded
  percussion-only residual trim (maximum 30 ms, retaining 5 ms before the
  detected transient); the same effective-onset contract passes both browsers.
- AAC priming is stripped by Chromium but retained by the Node decoder. A first
  attempted 48 ms AAC trim was therefore removed after the browser gate showed
  it would cut the real attack—exactly the class of error the two-lane plan was
  designed to catch.
- The July 2026 blind-review decisions remain authoritative: zero rejected
  candidate packs were promoted. No provenance or licensing bar was weakened.

### 43.5 — Space and continuous controls

- Canonical per-track pan is normalized `[-1,1]`, percent-converted only in UI
  and notation, and wired through REST, WebSocket, MCP, hashes, persistence,
  lazy bus caches, remote reconciliation, and the desktop mixer.
- Known mono synth/procedural tracks receive conservative alternating spread;
  sampled and user-recorded audio plus kick/bass/sub remain centered. Manual pan
  remains available. MIDI deliberately omits CC10.
- Pan and XY continuous controls use a shared 40 ms `setTargetAtTime` policy.
- The high-passed 15% parallel room starts on Freeverb and asynchronously
  hot-swaps to a fully-wet `Tone.Reverb` convolution IR with 15 ms pre-delay.

### 43.6 — Synthesis and procedural DSP

- Intended tonal native presets gained register-aware detuned second
  oscillators; sub remains stable and single-oscillator.
- Basic and advanced synth filters respond to MIDI velocity; acid has a fast,
  positive filter envelope. The existing native engine remains in place.
- Swept procedural sources now integrate phase correctly. Kick uses the intended
  150→40 Hz law plus a 3 kHz click; snare has a 330 Hz body and band-passed
  noise; hi-hat uses six detuned square partials into a 7 kHz high-pass.
- All native, Tone, and advanced preset schemas were audited; ineffective long
  decay values on high-sustain patches were shortened.

## Reproducibility artifacts

- `app/src/audio/__fixtures__/sound-quality-baseline.json`
- `app/src/audio/__fixtures__/sound-quality-browser-receipt.json`
- `app/src/audio/__fixtures__/sound-quality-demo-sessions.json`
- `app/scripts/sample-onset-calibration.json`
- `app/e2e/capture-session.spec.ts`
- `app/e2e/sample-browser-decode.spec.ts`
- `app/src/audio/session-render.render.test.ts`

Audio captures remain ephemeral under `app/test-results/`; only metrics and
fixture definitions are committed.

## Validation receipt

The important rule is that a human-only gate is never relabeled as an
automated pass.

- TypeScript, production build, and ESLint: pass. The Worker type-check and
  dry-run bundle gate also pass: 1,949,789 JavaScript bytes, 3,423,797 upload
  bytes, and no browser-audio runtime in the Worker bundle.
- Unit/property/render: 253 passed and 1 skipped test files; 4,612 passed and 1
  skipped tests. The untouched baseline was 237/1 files and 4,488/1 tests.
  The dedicated offline audio lane now includes the real shipped-sample spatial
  acceptance fixture in addition to the procedural canary.
- Integration: 10 files and 135 tests pass against the built application.
- Integrity: all 5 unified validators pass. Test-quality checks cover 302 test
  files with no always-green patterns, missing subject links, dead runtime
  exports, or unassigned tests. The E2E inventory is exact at 38 specs and 239
  tests (6 mock-required, 12 Worker-required).
- Samples: 26 instruments, 223 referenced/unique files, 0 unwaived errors, 81
  unwaived review flags, and 154 waived baseline issues.
- Mock/browser: the prior complete Chromium dependency lane plus the WebKit decoder
  receipt finished with 170 passed and 69 intentional skips. The formerly
  failing WebKit 808-kick onset passed the ≤5 ms effective-onset budget. The
  2026-08-11 correction reran Chromium's complete 223-file decoder lane and
  both development PCM capture tests successfully; it did not relabel those
  targeted reruns as a new full cross-browser result.
- Development PCM capture: Chromium passes the synchronized three-tap capture,
  null, latency, through-gain, recovery, and controlled master-chain canary.
  The corrected lane also builds a user-reachable 16-track mixed-engine session
  so the canary cannot stand in for the product-capacity path. The production
  Worker build intentionally omits that development-only global and the E2E
  lane now records an explicit skip instead of waiting for a nonexistent hook.
- Production Worker collaboration inventory: all 76 tests across the 12
  Worker-required specs pass serially, including scale-lock and pan sync,
  persistence, REST/WebSocket contracts, and live sampled-instrument creation.
- Mutation testing (informational, no configured break threshold): 1,810
  mutants; 73.72% overall score and 89.93% in the audio scope.

## Remaining human decision

Run the plan's randomized, level-matched six-session preference protocol with a
real Song Maker loopback capture, preregistered listener/trial counts, and a
listener-level binomial confidence interval. Sample content promotion must also
repeat the hash-bound three-anchor plus full-set review. Until those happen, the
defensible conclusion is **objectively better and safer, subjectively promising,
not yet proven preferred over Song Maker**.
