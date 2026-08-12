# Automatically verifiable audio improvements — before/after receipt

Date: 2026-08-11
Scope: the automatically verifiable changes accepted after the Keyboardia/Song
Maker comparison. Guided first contact, a default shared delay, and changes to
the swing/default-velocity experience remain intentionally out of scope.

## Result

The changes made the engine measurably better. They substantially reduced
source-to-source level mismatch, added time-varying spectra to the core synths,
made the procedural hats occupy their intended supporting role, added bounded
deterministic percussion variation, removed the release hard-stop
discontinuity, and reduced the level presented to the compressor. The final
browser output remains below both sample-peak and true-peak full scale.

This receipt establishes technical and acoustic invariants. It does not claim
that an automated metric proves listener preference or complete perceptual
parity with Song Maker.

## Before and after

The immutable input receipts are
`automatic-improvements-before.json` and
`automatic-improvements-after.json`. Offline measurements use 44.1 kHz
rendered PCM. Master-path measurements use Chromium's real 48 kHz Web Audio
path and synchronized capture taps.

| Property | Before | After | Measured impact |
|---|---:|---:|---:|
| Procedural starter-source loudness spread (kick, bass, lead, pluck, pad) | 11.54 dB | 1.90 dB | 83.6% smaller |
| Core-preset loudness spread | 7.24 dB | 2.31 dB | 68.1% smaller |
| Open-hat loudness relative to kick | 1.28 dB louder | 7.78 dB quieter | 9.06 dB role correction |
| Core presets with a filter envelope | 0/4 | 4/4 | all core voices now move spectrally |
| Core presets exceeding digital full scale in isolated render | 2/4 | 0/4 | bass and lead overs removed |
| Snare/closed-hat/open-hat rendered alternates | 1/1/1 | 4/4/4 | deterministic timbral alternates added |
| Release gain immediately before stop | 0.001 | 0 | discontinuity removed |
| Real 16-track pre-compressor peak | +5.17 dBFS | +3.55 dBFS | 1.62 dB less pileup |
| Real 16-track post-makeup peak | +1.34 dBFS | +0.72 dBFS | 0.62 dB less pileup |
| Final output trim | −2 dB | −1 dB | 1 dB reclaimed |
| Real 16-track heard-output peak / true peak | −0.68 dBFS / not gated | −0.27 dBFS / −0.27 dBTP | louder, with both gates passing |

The core spectral-direction gates also pass: bass, lead, and pluck begin
brighter than they end (early/late centroid ratios 1.40, 1.25, and 1.40), while
the slow pad opens over time (0.72). The deterministic repeat capture nulls at
−264.37 dB, well below the −60 dB budget. Render-tap drift is 256 frames / 5.33 ms,
inside the 10 ms budget.

One characterization moved in the opposite numerical direction: the fixed-pan
procedural canary's mid/side ratio changed from its old −18…−15 dB band to
−20.17 dB. This follows directly from lowering the formerly dominant hats, not
from a broken panner: the spatial render is still wider than the centered
baseline, centered kick/bass remain channel-identical, and mono fold changes by
only +0.23 dB. The test now pins a tight −20.75…−19.5 dB post-calibration band.

## What changed

1. **Source calibration.** Procedural voices carry source-level gain metadata;
   sampled drums use an engine-owned calibration table so immutable content
   evidence keeps its exact hashes. The same calibration is applied during live
   playback, preview, and the required offline renderer.
2. **Core synth motion and balance.** Bass, lead, pad, and pluck have calibrated
   output levels and per-note filter envelopes. The established secondary
   oscillator path remains active.
3. **Procedural percussion.** Closed and open hats use metallic high-passed
   recipes with distinct decay lengths. Snare and hats have four seeded
   variants. Unlocked loops select variants deterministically; explicit
   parameter locks bypass selection so reproducible renders remain exact.
4. **Release continuity.** Sampled voices ramp from the release floor to exact
   zero during a 30 ms guard instead of jumping from −60 dB to silence.
5. **Output safety.** The calibrated source mix allowed the post-limiter trim to
   move from −2 to −1 dB. A 4× oversampled true-peak meter now guards the real
   16-track browser-capacity fixture.

## Automatic verification

The implementation is guarded at three levels:

- Render tests measure loudness spread, spectral-centroid direction, peak
  level, hat band energy/decay, variation count/correlation, and release shape.
- Scheduler tests require deterministic unlocked variation and exact
  parameter-locked repeat behavior in both main-thread and AudioWorklet paths.
- Chromium captures synchronized pre-compressor, post-makeup, and heard-output
  PCM. They enforce repeat null, compressor recovery, capture drift, sample
  peak, and true peak on a user-reachable 16-track mixed-engine session.

The sample-library technical status remains 26 instruments and 223 referenced
files, with 0 hard validation errors, 81 unwaived review flags, and 154 waived
baseline issues. The implementation does not promote or add third-party sample
content.

## Impact versus enriching the sample set

| Dimension | This implementation | More/richer samples |
|---|---|---|
| Coverage | Immediate across procedural drums, core synths, sampled drum balance, and the shared master | Only the instruments and articulations whose content and maps are expanded |
| Balance/headroom | High: directly measured 1.62 dB reduction before compression | Neutral or negative unless every new source is calibrated into the same gain contract |
| Synth liveliness | High: all four core presets now have measured spectral motion | None for synthesized voices |
| Repetition | Moderate: four deterministic procedural variants; snare correlation drops to 0.45, hats to about 0.975 | Potentially high where real round robins are recorded and mapped |
| Acoustic realism | Low to moderate | Potentially very high for the enriched instruments, especially sparse tonal maps and acoustic drums |
| Range/repitch artifacts | None | Potentially high improvement by adding roots and reducing pitch-shift distance |
| Release/tail realism | Fixes engine discontinuity, not recording character | Potentially high with naturally recorded decays and articulations |
| Automatically provable | High for the reported invariants and broad system coverage | High for decode, provenance, root distance, velocity/RR coverage, pitch, peak, and loudness; low for “sounds better” without listener evidence |
| Cost/risk | Code and fixtures; no payload or licensing increase | Payload, decode time, licensing/provenance, mapping, calibration, and review burden |

On automatically provable impact, these changes are the stronger first move:
they fix systemic problems that sample enrichment cannot fix and affect every
session using these sources. Sample enrichment has the higher remaining ceiling
for natural acoustic timbre, articulation, and sparse-map pitch quality, but it
cannot replace gain staging, moving synth presets, release continuity, or
true-peak safety.

If sample enrichment is pursued next, its honest automated claim should be
“better technical coverage” rather than “better sound”: fewer semitones to the
nearest root, more verified velocity layers and round robins, complete browser
decode, calibrated delivered loudness, clean tails, and unchanged capacity
headroom. A preference claim would require listening evidence, which is outside
the accepted scope.

## Reproduction

```sh
cd app
npx tsx scripts/measure-automatic-audio-improvements.ts
npx vitest run --silent --reporter=dot
npx playwright test e2e/capture-session.spec.ts --project=chromium
npm run validate:manifests
npm run validate:sample-quality
npm run build
```
