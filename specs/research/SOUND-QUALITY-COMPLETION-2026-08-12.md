# Sound-quality completion receipt — 2026-08-12

## Outcome

The complete automatically verifiable plan is implemented, except for the
explicitly excluded user-visible “offer analysis rather than automatic
correction” feature. The empty-session defaults remain 120 BPM, zero swing,
and dry effects. No metric-aware or collision-aware note gain was added, and no
“hero voice” is selected behind the user's back.

This work establishes internal improvement and regression safety. It does not
claim that an automated metric proves listener preference over Song Maker or
the supplied artefact.

## Before and after

| Measure | Before this completion pass | After | Change |
|---|---:|---:|---:|
| Enriched delivery files (eight upgraded libraries) | 695 | 411 shipped | −284 (−40.9%) |
| Enriched explicit mappings | 729 | 434 shipped | −295 (−40.5%) |
| Enriched sample payload | 36,662,990 B | 23,582,458 B | −13,080,532 B (−35.7%) |
| Whole built web app | 50,040,999 B / 47.72 MiB | 36,905,206 B / 35.20 MiB | −12.53 MiB (−26.3%) |
| Canonical sample-audit mappings, all 26 instruments | 900 | 605 | −295 |
| Canonical sample-audit files, all 26 instruments | 866 | 582 | −284 |
| Raw review findings | 727 | 307 | −420 (−57.8%) |
| Unwaived errors | 0 | 0 | unchanged |
| Unwaived review flags | 727 | 0 | −727 |
| Velocity inversions | 39 before curation/calibration | 0 retained | removed |
| Note-level steps | 25 before curation/calibration | 3 hash-bound | −22 |

The 307 retained review findings are not blanket suppressions. They are 298
deduplicated dispositions bound to the exact SHA-256 of the reviewed source or
manifest. A changed file fails before its disposition can apply. Current
finding counts are: pitch 144, residual onset 71, hot peak 21, loop seam 26,
stereo/mono 21, tail 12, DC 8, note step 3, and range 1. These are source or
estimator judgments for which destructive automatic processing would not be
perceptually safe.

## Implementation

### Catalogue source calibration

All 99 selectable catalogue IDs now resolve to an explicit source-calibration
contract. The 26 sampled instruments use measured manifest/sample trims; 22
procedural sources, 32 native synths, 11 Tone synths, and 8 advanced synths use
fixed per-source trims. A coverage test fails if any catalogue or preset ID is
added without a calibration. The trims have no bar-position, metric,
collision, or random input.

### Safety-only master

The master compressor is now a hard-knee safety stage at −1 dBFS, 8:1, 3 ms
attack, and 80 ms release. Chromium's measured +0.524865 dB below-threshold
makeup is exactly nulled. The limiter threshold is −2 dB with a final −1.75 dB
linear margin.

The real browser capture measured:

- below-threshold through gain: −0.000000039 dB;
- controlled hat change during the modest canary: −0.059 dB;
- 16-track capacity input: +7.020 dBFS;
- 16-track post-makeup peak: +1.432 dBFS;
- heard sample peak: −0.354 dBFS;
- heard 4×-oversampled true peak: −0.289 dBTP.

This is transparent for ordinary programme and active only for a genuine
capacity violation.

### Sample curation and review dispositions

The six acoustic kit components retain their coherent mid-mic libraries. Kick,
hats, ride, and crash retain all enriched variations. Snare is reduced from 36
micro-layers to four broad velocity zones with four variants each. Finger bass
retains every root and four velocity zones with two variants per zone. Steel
drums retain every root and five velocity zones with at most two variants.

Ranking is deterministic: hard/review defects, within-layer RMS consistency,
effective onset after production codec compensation, decoded headroom, DC, and
stable filename. The policy does not claim perceptual preference. Excluded
deliveries remain recoverable and hash-verifiable outside `public/`.

Static manifest/sample trims then apply a minimal isotonic correction to
velocity layers and limit adjacent-note source-level steps. This is catalogue
calibration, not note-time humanisation: the result is fixed in the manifest
and does not inspect the arrangement.

### Explicit first contact

The landing page keeps “Start Session” as the unchanged empty path and adds a
separate “Start with Groove” action. Its five-track 96 BPM, 16%-swing,
A-minor-pentatonic arrangement stores every step, pitch, accent, track level,
and scale decision in session state. Effects remain dry. The fixture is cloned
per invocation and uses only catalogue-valid IDs.

### Neutral synth structure

Synth oscillator layers now use a peak-safe equal-power-shaped crossfade whose
correlated sum cannot exceed unity. Each previously inferred layer is an
explicit waveform/detune/octave/mix/routing definition. The engine supports
shared-filter or filter-bypass routing and an optional layer-level envelope,
and complete parameter payloads round-trip through a versioned JSON boundary.
No preferred “hero” preset is selected.

## Sample enrichment versus the rest of the work

| Change | Strongest expected audible effect | Automatic evidence | Cost |
|---|---|---|---|
| Enriched/curated samples | Real repeated-hit variation, closer roots, real velocity performances, coherent acoustic kit | note/velocity/RR coverage, decode, onset, defect and payload receipts | +20.87 MiB over the original 14.33 MiB app; 35.20 MiB total |
| Source calibration | Less arbitrary balance between catalogue voices; fewer layer/note jumps | all 99 IDs covered; 39→0 inversions; 25→3 note steps | negligible code/manifest bytes |
| Safety-only master | Preserved normal transients; overload protection without pumping ordinary beats | browser through/canary/capacity PCM | negligible |
| Explicit starter | A coherent first loop without changing blank-grid behavior | exact serialized state and catalogue tests | negligible |
| Neutral synth structure | Stable layer level and reusable spectral topology | unit/render assertions and JSON round trip | negligible |

Sample enrichment remains the largest timbral improvement and the dominant
bundle cost. Calibration/master/starter work makes that content easier to hear
fairly and consistently; it cannot substitute for source recordings. The
curated result removes 12.53 MiB from the all-enriched build while preserving
the coverage responsible for most of the enrichment benefit.

Song Maker's pinned decoded JavaScript bundle is 1,021,930 bytes, and its
architecture uses roughly 100 tonal roots plus a very small percussion set.
That is not a like-for-like whole-site payload measurement, but it explains the
order-of-magnitude difference: Keyboardia still ships a broad 26-instrument,
582-audio-file catalogue. Closing the size gap further would require lazy
network delivery or a substantially smaller product catalogue, not another
round of codec tuning.

## Verification commands

```text
npm run build
npm run typecheck
node --import tsx scripts/validate-sample-quality.ts --strict
node --import tsx scripts/promote-complete-sample-enrichment.ts --verify-only
node --import tsx scripts/validate-manifests.ts
node --import tsx scripts/validate-release-times.ts
node --import tsx scripts/validate-playable-ranges.ts
USE_MOCK_API=1 E2E_SERIAL=1 npx playwright test e2e/capture-session.spec.ts --project=chromium
```

At receipt time: production build passed; 4,641 unit/render tests passed with
one intentional skip; all four test-quality gates passed with zero dead runtime
exports; all six unified validators passed; all 26 manifests passed; release
and playable-range validators passed; eight enrichment/curation receipts
passed; strict sample quality reported zero unwaived issues; both Chromium
real-audio capture tests passed.
