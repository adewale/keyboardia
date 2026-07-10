## Review
- Correct: `plan.md` and `progress.md` were requested but are absent in the repo root; I proceeded from current code/tests only (`test -f plan.md`, `test -f progress.md` both reported missing).
- Correct: the production path is clearly layered: catalog `sampleId` parsing in `app/src/audio/instrument-types.ts:49-112`, scheduler step-to-dispatch in `app/src/audio/scheduler.ts:388-430` and `app/src/audio/scheduler.ts:482-547`, and engine-specific playback in `app/src/audio/engine.ts:730-850`, `app/src/audio/engine.ts:1143-1185`, `app/src/audio/engine.ts:1228-1279`, and `app/src/audio/engine.ts:1446-1472`.
- Correct: current fast tests already catch many registry/configuration failures: `app/src/audio/instrument-routing.test.ts:61-294` asserts catalog counts/routes for 22 procedural samples, 32 Web Audio synths, 11 Tone synths, 8 advanced synths, and 27 sampled instruments; `app/src/audio/instrument-configuration.test.ts:64-190` checks manifest/audio/UI/validation registry sync; `app/src/audio/instrument-configuration.test.ts:250-295` checks sampled manifest required fields, sample file presence, playable ranges, and credits.
- Correct: sampled-instrument behavior has focused unit coverage for real playback decisions: scheduling/declick/sprite offsets in `app/src/audio/sampled-instrument.playback.test.ts:74-152`, velocity layers in `app/src/audio/sampled-instrument.playback.test.ts:154-180`, tie-break pitch selection in `app/src/audio/sampled-instrument.playback.test.ts:182-201`, sustain loops in `app/src/audio/sampled-instrument.playback.test.ts:203-231`, gain trim in `app/src/audio/sampled-instrument.playback.test.ts:233-244`, and choke groups in `app/src/audio/sampled-instrument.playback.test.ts:246-278`.
- Correct: sampled range/live audits exist, but are not yet a complete all-instrument gate: `app/src/audio/instrument-range-render.test.ts:81-198` renders every sampled instrument headlessly but is `skipIf(!webAudio)` and only sanity-checks `summary.length`; `app/e2e/instrument-range-session.spec.ts:131-262` opens live sampled sessions and asserts no silent session, no page errors, and no `Sample not found` diagnostics.
- Note: there is no compact end-to-end matrix that proves every catalog entry can go `track.steps[] -> scheduler -> engine method -> nonzero audio`. The current coverage is split across static registry checks, mocked routing, sampled-only render audits, and sampled-only live app sessions.
- Note: `app/src/audio/instrument-routing.test.ts:36-41` has a local route helper that does not model production `sampled:` parsing; it only recognizes raw sampled IDs through `isSampledInstrument(sampleId)`. Production parsing handles `sampled:` in `app/src/audio/instrument-types.ts:72-80`, and `instrument-types.test.ts` covers that, but the “Comprehensive Instrument Routing” test should be converted to use `parseInstrumentId()` directly so the matrix cannot drift.
- Note: current live sampled audit can mask per-track silence: it batches sampled instruments and asserts only aggregate session output via `silentSessions` at `app/e2e/instrument-range-session.spec.ts:252-261`. One loud track can hide a silent track in the same batch.

## Proposed compact testing matrix
| Layer | Scope | Purpose | Suggested file/test | Gate |
|---|---|---|---|---|
| Catalog matrix | All entries from `INSTRUMENT_CATEGORIES`/`VALID_SAMPLE_IDS`, grouped by `type` | Single source list of instrument IDs; avoid brittle hard-coded totals | Add `app/src/audio/instrument-matrix.ts` test helper or local helper in tests: `buildInstrumentMatrix()` returns `{sampleId, category, engine, presetId}` via `parseInstrumentId()` | Fast CI |
| Static registry/config | Sampled manifests + all catalog IDs | Keep existing sync checks, but replace hard-coded counts with matrix-derived expected counts | Update later: `app/src/audio/instrument-routing.test.ts`, `app/src/audio/instrument-configuration.test.ts` | Fast CI |
| Scheduler dispatch matrix | Every catalog `sampleId` as a one-step track | Verify `steps -> parse -> play*` dispatch, including `presetId`, `trackId`, time, duration, volume, sampled MIDI note, sampled velocity | New `app/src/audio/scheduler-instrument-matrix.test.ts`: mock `audioEngine`, call private `scheduleStep` as existing scheduler tests do, iterate every matrix row | Fast CI |
| Worklet dispatch parity | Same matrix or representative per engine if full matrix is too slow | Main-thread scheduler and worklet host must agree on target engine/args | Extend/new `app/src/audio/scheduler-worklet-instrument-matrix.test.ts`; mirror `scheduler-velocity-routing.test.ts` style | Fast CI |
| Procedural legacy samples | 22 generated buffers from `createSynthesizedSamples()` | Ensure legacy sample IDs produce non-null buffers and nonzero peak/RMS; catch accidental silence in generated drums/bass/synth/fx | New `app/src/audio/procedural-samples.render.test.ts` using fake or node WebAudio; assert `buffer.length > 0`, finite samples, `peak > threshold` | Fast CI if fake; optional if native |
| Sampled instruments | 27 manifests and real mp3 bytes | Keep real decode/render, but make default-note audibility a gate and leave full ±24 sweep as audit | Split `instrument-range-render.test.ts` into `sampled-default-note.render.test.ts` (gated) and existing range report (audit) | Default-note fast/CI; range audit nightly/manual |
| Web Audio synth presets | 32 `synth:*` presets | Verify `SynthEngine.playNote()` creates/routs an audible envelope for every preset; no preset has silent oscillator/filter/envelope | New/extend `app/src/audio/synth-presets.playback.test.ts`; use fakes for node creation + optional offline peak smoke | Fast CI |
| Tone synth presets | 11 `tone:*` presets | Verify each preset initializes, schedules a note, and routes through per-track synth after prewarm | Extend `app/src/audio/toneSynths.test.ts` to `it.each(Object.keys(TONE_SYNTH_PRESETS))`; add engine-level prewarm test for every `tone:*` matrix row | Fast CI with Tone mocked; browser smoke optional |
| Advanced synth presets | 8 `advanced:*` presets | Verify each preset remains non-silent after filter/envelope/LFO application and routes through prewarmed per-track registry | Extend `app/src/audio/advancedSynth.test.ts` and `app/src/audio/per-track-synth-preload.test.ts`; iterate `ADVANCED_SYNTH_PRESETS` | Fast CI with Tone mocked; browser smoke optional |
| Live app sessions | All 100 catalog instruments chunked by `MAX_TRACKS` | Verify real UI/session/user gesture path, audio unlock, preload, scheduler, and engine route in Chromium | New `app/e2e/all-instrument-audio-smoke.spec.ts`: build sessions from matrix chunks, one active step per track, click Play, attach per-track or post-bus analysers/meters, assert each track/instrument observed output or expected range skip | Serial Chromium/nightly or pre-release |
| Offline/headless render report | All engines where native render is reliable | Generate artifact for trend/debug, not primary pass/fail | New `app/src/audio/all-instrument-offline-render.test.ts` or script `scripts/render-instrument-smoke.ts`; JSON under `test-results/audio-matrix/` | Manual/nightly |

## Concrete file/test suggestions
- Add a reusable matrix source for tests, not production: derive from `INSTRUMENT_CATEGORIES` and `parseInstrumentId()`; include `category`, `displayName`, `sampleId`, `engine`, `presetId`, and optional manifest path. This removes hard-coded counts like `app/src/audio/instrument-routing.test.ts:61`, `app/src/audio/instrument-routing.test.ts:92`, `app/src/audio/instrument-routing.test.ts:129`, `app/src/audio/instrument-routing.test.ts:158`, and `app/src/audio/instrument-routing.test.ts:285-294`.
- Add `app/src/audio/scheduler-instrument-matrix.test.ts`: for each matrix row, create one active-step track, inject `getState`, call `scheduleStep`, and assert exactly one expected engine method:
  - `sample` -> `audioEngine.playSample(sampleId, trackId, time, duration, pitch, volume)`.
  - `sampled` -> readiness checked, `playSampledInstrument(presetId, noteId, SCHEDULER_BASE_MIDI_NOTE + pitch, time, duration, volume, trackId, velocity)`.
  - `synth` -> `playSynthNote(noteId, presetId, pitch, time, duration, volume, trackId)`.
  - `tone` -> `playToneSynth(presetId, pitch, time, duration, volume, trackId)`.
  - `advanced` -> `playAdvancedSynth(presetId, pitch, time, duration, volume, trackId)`.
- Add `app/src/audio/procedural-samples.render.test.ts`: instantiate a minimal/fake context, run `createSynthesizedSamples()`, iterate `ALL_SAMPLES`, and assert buffer existence, finite data, `peak > 1e-4`, and category-appropriate duration bounds. Use thresholds only; procedural generators use randomness (`Math.random()` in `app/src/audio/samples.ts:202`), so avoid snapshots/exact RMS.
- Upgrade sampled render coverage:
  - Gated: default note only, every sampled manifest, real decode if native available; fail on `sourceCreated === false` or `peak < threshold` for default note.
  - Audit: keep ±24 matrix/report but do not block when expected range skips happen.
- Add `app/e2e/all-instrument-audio-smoke.spec.ts` rather than expanding sampled-only `instrument-range-session.spec.ts`: use mock API, chunk by `MAX_TRACKS`, call `audioEngine.preloadInstrumentsForTracks()`/wait for readiness before Play, then assert per-track meter/analyser output. Per-track assertion is important because aggregate `masterPeak` at `app/e2e/instrument-range-session.spec.ts:252-261` can hide one silent instrument.
- Add a small negative test: an invalid `sampleId` should be rejected at validation/catalog boundaries and should not silently route to `playSample` as an unknown plain sample.

## Risks / flakes to control
- Tone/advanced first-note skip: `playToneSynth()` skips if the per-track synth was not prewarmed (`app/src/audio/engine.ts:1169-1178`); `playAdvancedSynth()` has the same pattern (`app/src/audio/engine.ts:1252-1258`). Any live/offline matrix must preload/wait before measuring audio.
- Native offline rendering availability: current sampled render skips when `node-web-audio-api` cannot import (`app/src/audio/instrument-range-render.test.ts:31-32`, `app/src/audio/instrument-range-render.test.ts:81`). Treat native render as optional/nightly unless CI image is pinned.
- Aggregate analyser false positives: session-level `masterPeak` proves “some audio”, not “every instrument”. Prefer per-track bus/meter probes.
- Random procedural noise: snare/hat/noise-like buffers use randomness; use broad peak/RMS lower bounds and finite-data checks only.
- Browser autoplay/unlock: live tests need a real click before measurement; the current live audit does this at `app/e2e/instrument-range-session.spec.ts:185-193` and should keep that pattern.
- Runtime budget: full 100-instrument live smoke should be serial Chromium and likely nightly/pre-release; fast CI should rely on static + scheduler-dispatch + fake playback matrix.

## Commands run
- `test -f plan.md && echo plan-present || echo plan-missing; test -f progress.md && echo progress-present || echo progress-missing` -> `plan-missing`, `progress-missing`.
- `npm test -- --run src/audio/instrument-routing.test.ts src/audio/instrument-configuration.test.ts src/audio/sample-selection.test.ts` from `app/` -> passed: 3 files, 224 tests.
- `npx vitest run src/audio/instrument-types.test.ts src/audio/scheduler-velocity-routing.test.ts src/audio/engine-legacy-paths.characterization.test.ts` from `app/` -> passed: 3 files, 46 tests.
- `git status --short` -> existing unstaged/untracked repo changes were present before this report.
- `git diff --cached --quiet; echo no-staged=$?` -> `no-staged=0`.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Reviewed current tests and proposed a compact testing matrix only; no production/test code changes were made. The only file written is the requested report."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report cites concrete files/lines for production paths, existing tests, gaps, proposed files, commands run, validation results, and residual risks."
    }
  ],
  "changedFiles": [
    "subagent-reports/all-instrument-audio-test-design.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "test -f plan.md && echo plan-present || echo plan-missing; test -f progress.md && echo progress-present || echo progress-missing",
      "result": "passed",
      "summary": "Both requested context files are missing in the repo root."
    },
    {
      "command": "cd app && npm test -- --run src/audio/instrument-routing.test.ts src/audio/instrument-configuration.test.ts src/audio/sample-selection.test.ts",
      "result": "passed",
      "summary": "Vitest passed 3 files / 224 tests."
    },
    {
      "command": "cd app && npx vitest run src/audio/instrument-types.test.ts src/audio/scheduler-velocity-routing.test.ts src/audio/engine-legacy-paths.characterization.test.ts",
      "result": "passed",
      "summary": "Vitest passed 3 files / 46 tests."
    },
    {
      "command": "git status --short",
      "result": "passed",
      "summary": "Showed pre-existing unstaged modifications/untracked paths before this report was written."
    },
    {
      "command": "git diff --cached --quiet; echo no-staged=$?",
      "result": "passed",
      "summary": "Printed no-staged=0, confirming no staged files."
    }
  ],
  "validationOutput": [
    "instrument-routing.test.ts + instrument-configuration.test.ts + sample-selection.test.ts: 224 tests passed",
    "instrument-types.test.ts + scheduler-velocity-routing.test.ts + engine-legacy-paths.characterization.test.ts: 46 tests passed",
    "Requested plan.md/progress.md were not present",
    "git diff --cached --quiet returned 0 (no staged files)"
  ],
  "residualRisks": [
    "No code/tests were changed because this was a read-only design review; recommendations still need implementation.",
    "Repo had pre-existing unstaged/untracked changes before report creation, so this review cannot attribute or validate those changes.",
    "Current live/offline audio audits are sampled-focused and aggregate/session-level; per-instrument all-engine audio proof remains a proposed follow-up."
  ],
  "noStagedFiles": true,
  "notes": "The requested report file is intentionally written under subagent-reports/."
}
```