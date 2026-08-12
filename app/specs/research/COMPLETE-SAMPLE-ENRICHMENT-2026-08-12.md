# Complete sample enrichment impact — 2026-08-12

> **Final delivery update:** the 695-file enriched candidate remains preserved
> and hash-verifiable, but production now ships a technically curated 411-file
> subset for these eight libraries. All note and velocity zones remain covered;
> 284 redundant/riskier delivery files are stored under
> `sample-pipeline/enrichment/unshipped-delivery/`. The final built app is
> 36,905,206 bytes (35.20 MiB), down 13,135,793 bytes (12.53 MiB, 26.3%)
> from the 50,040,999-byte complete-enrichment build recorded below. The strict
> canonical audit has zero unwaived errors and zero unwaived review flags.

## Outcome

The automatically verifiable sample-enrichment scope is complete for eight existing instrument IDs. Production now contains every usable mapping from three pinned, license-compatible source tranches:

- Virtuosity Drums mid-mic kit: kick, snare, closed hat, open hat, ride, and crash (CC0)
- Meatbass basic pizzicato map: the source family already represented by `finger-bass` (CC0)
- jSteelDrum no-crossfade map (Unlicense)

This means 695 usable lossless masters and 729 explicit mappings are represented in production. One jSteelDrum master, `jsdb_061_Db4_1-1.flac`, is deliberately excluded because the source audit detected four flat-top clipping runs. Additional kit microphone mixes/articulations and Meatbass percussion, release, and legato maps would be different product scope, not unfinished work in this tranche.

The license profile is unchanged: the new material is CC0 or Unlicense, with pinned revisions and source/delivery hashes in `sample-pipeline/enrichment/lock.json` and per-instrument promotion receipts.

## Measured sound-quality impact

The evidence supports specific improvements, not a universal claim that every listener will prefer the timbre:

| Measure | Before | After | Audible implication |
| --- | ---: | ---: | --- |
| Delivery files in the eight libraries | 52 | 695 | Far more recorded variation |
| Explicit mappings | 52 | 729 | Finer velocity and note selection |
| Deterministic round-robin groups | 0 | 192 | Repeated hits are less machine-gun-like |
| Finger-bass roots | 6 | 14 | Less transposition coloration |
| Finger-bass mean pitch shift | 2.33 semitones | 1.08 semitones | More notes stay near a recorded root |
| Steel-drum roots | 8 | 24 | Chromatic root coverage across the core range |
| Steel-drum mean pitch shift | 1.65 semitones | 0.91 semitones | Less pitch-shifter character |
| Runtime events producing silence | 0 / 43,136 | 0 / 43,136 | Coverage did not regress |

The strongest expected differences are repeated acoustic-drum hits, bass lines spanning several notes, steel-drum melodies, and low-to-high velocity sweeps. The six acoustic components now come from one coherent mid-mic kit. Chromium decoded all 695 delivery files, WebKit decoded all 695, and the objective audit found zero hard errors.

What automation cannot establish is subjective timbral preference, mix suitability, or whether the additional natural variation is worth the download cost for every user. The promotion receipts therefore state `perceptualPreferenceClaimed: false`.

## Bundle impact

| Payload | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Built web app | 15,021,222 bytes (14.33 MiB) | 50,040,999 bytes (47.72 MiB) | +35,019,777 bytes (+33.40 MiB) |
| Audio in the built app | 13,769,061 bytes (13.13 MiB) | 48,618,347 bytes (46.37 MiB) | +34,849,286 bytes (+33.23 MiB) |
| The eight affected libraries alone | 1,805,760 bytes (1.72 MiB) | 36,662,990 bytes (34.96 MiB) | +34,857,230 bytes (+33.24 MiB) |

The deployable build is 3.331× its former size. Nearly all growth is audio. This is a large quality-for-bandwidth trade: the engine fixes are broadly audible at negligible bundle cost, while full sample enrichment targets realism and repetition at roughly 33 MiB of additional deployed assets. Samples are loaded by instrument, so this is not necessarily one initial-page transfer; a user's network cost depends on the instruments selected and browser caching. Already-compressed AAC will gain little from HTTP compression.

## Quality-audit interpretation

The canonical audit still has zero unwaived errors. It reports 727 unwaived review flags after enrichment versus 81 before. That increase is expected when 643 additional delivery files and 677 additional mappings become measurable; it is not a pass/fail regression.

The 646 flags contributed by the eight enriched libraries are:

- 373 `LEADING_SILENCE`: often AAC decoder priming or a real recorded attack; it may affect onset and requires listening, while runtime onset compensation mitigates codec priming.
- 220 `PITCH_DEVIATION`: a monophonic estimator's result; steel drums and other inharmonic/percussive spectra can fool it, though genuine tuning differences are also possible.
- 39 `VELOCITY_RMS_INVERSION`: an adjacent louder-velocity layer has lower aggregate active RMS. Real layers can become brighter or shorter instead of simply louder.
- 14 `NOTE_LEVEL_STEP`: adjacent recorded roots differ in active RMS enough to merit a consistency listen.

The unchanged 81 old flags remain on other instruments. “Unwaived” means a review-severity measurement has no matching entry in `scripts/sample-quality-baseline.json`; it does not mean CI failure or a proven audible defect. Waivers are explicit accepted exceptions. Hard errors fail the normal audit; review flags only fail with `--strict` and require a real disposition rather than automatic suppression.

## Reproduction

Run:

```sh
npm run samples:enrichment:verify
node --import tsx scripts/validate-manifests.ts
node --import tsx scripts/validate-playable-ranges.ts
node --import tsx scripts/validate-sample-quality.ts
node --import tsx scripts/validate-velocity-layers.ts
npm test
npm run build
```

`samples:enrichment:verify` enforces the pinned license profile, source revisions, production hashes, immutable before baselines, every usable selected master, and every locked mapping. The machine-readable comparison is in `sample-pipeline/enrichment/impact.json`.
