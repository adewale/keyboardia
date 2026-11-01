# Code Context

## Files Retrieved
1. `app/src/audio/sampled-instrument.ts` (lines 1-143, 368-597) - sampled manifest schema, `playNote()` range/translation/silence behavior, helper accessors.
2. `app/src/audio/instrument-ranges.ts` (lines 1-220) - UI/static sampled ranges and `isInRange()` helpers; comment says keep in sync with manifest `playableRange`.
3. `app/public/instruments/*/manifest.json` (summary via script) - all sampled manifests, playable ranges, playbackNote, sample notes.
4. `app/src/audio/instrument-range-simulation.test.ts` (lines 1-240) - layer (a) fake-audio audit sweeping every sampled instrument and writing static matrix artifacts.
5. `app/src/audio/instrument-range-render.test.ts` (lines 1-210) - layer (b) offline real-sample render audit measuring peak/RMS.
6. `app/e2e/instrument-range-session.spec.ts` (lines 1-263) - layer (c) live-session Playwright audit with master analyser and `[RANGE]` log capture.
7. `app/src/audio/scheduler.ts` (lines 464-548, 379-407) - active step → pitchSemitones → sampled MIDI note → audio engine dispatch.
8. `app/src/audio/engine.ts` (lines 1380-1475) - sampled instrument preload and `playSampledInstrument()` routing to track bus.
9. `app/src/audio/audioTriggers.ts` (lines 333-379) - preview path for sampled instruments.
10. `app/src/audio/instrument-ranges.test.ts` (lines 1-222) - range helper tests and sampled manifest/UI range sync test.

## Key Code
- `InstrumentManifest.playableRange` is intentional silence contract: notes outside are skipped to avoid extreme pitch-shift artifacts (`app/src/audio/sampled-instrument.ts:53-62`). `playbackNote` translates scheduler C4-relative pitch offsets for drum/percussion natural pitches (`lines 64-77`).
- Production sampled silence point:
```ts
// app/src/audio/sampled-instrument.ts:382-402
let adjustedMidiNote = midiNote;
if (this.manifest.playbackNote !== undefined) {
  const pitchOffset = midiNote - SCHEDULER_BASE_MIDI_NOTE;
  adjustedMidiNote = this.manifest.playbackNote + pitchOffset;
}
if (this.manifest.playableRange) {
  const { min, max } = this.manifest.playableRange;
  if (adjustedMidiNote < min || adjustedMidiNote > max) {
    logger.audio.log(`[RANGE] Skipping note ${adjustedMidiNote} for ${this.instrumentId} ...`);
    return null;
  }
}
```
- Bugs vs intentional silence:
  - Intentional: `playNote()` returns `null` only when not initialized/not loaded/no dest/no manifest, no usable sample, or outside manifest `playableRange`; for a loaded registered instrument the expected range skip is `adjustedMidiNote < min || > max`.
  - Bug candidates: in-range `playNote()` returns `null`; source created but rendered peak/RMS is silent; sampled track routes as plain sample (`Sample not found`); instrument not preloaded/ready when playback starts; UI `INSTRUMENT_RANGES` diverges from manifest; e2e only proves session-level output, not per-instrument output.
- Step-to-sound data flow:
```ts
// app/src/audio/scheduler.ts:505-507, 394-406
const pLock = track.parameterLocks[trackStep];
const pitchSemitones = (track.transpose ?? 0) + (pLock?.pitch ?? 0);
const midiNote = SCHEDULER_BASE_MIDI_NOTE + pitchSemitones;
audioEngine.playSampledInstrument(presetId, noteId, midiNote, time, duration, volumeMultiplier, trackId, velocity);
```
Then `AudioEngine.playSampledInstrument()` fetches registry instrument, routes to track bus, and calls `instrument.playNote(...)` (`app/src/audio/engine.ts:1446-1475`).
- Existing coverage:
  - `instrument-ranges.test.ts` verifies `INSTRUMENT_RANGES['sampled:*']` exactly matches manifest `playableRange` (`lines 184-221`).
  - `instrument-range-simulation.test.ts` sweeps offsets `-24..+24` with real `playNote()` on fakes, but is report-only: final assertion only `results.length === manifests.length` (`lines 216-239`).
  - `instrument-range-render.test.ts` renders real decoded samples and records `sourceCreated`, `peak`, `rms`, but is also report-only/sanity (`lines 82-208`).
  - `instrument-range-session.spec.ts` currently checks no page errors, no `Sample not found`, and each session chunk has master output (`lines 244-263`); it records range skips but does not assert skip classification against expected ranges.

## Architecture
- Catalog: UI/sample validation lists use `sampled:<id>`; manifests live under `app/public/instruments/<id>/manifest.json`; engine registers all `SAMPLED_INSTRUMENTS` on initialization.
- Preload: `AudioEngine.preloadInstrumentsForTracks()` calls `collectSampledInstruments()` and `sampledInstrumentRegistry.load(id)` before playback.
- Scheduling: grid state tracks have `steps[]` and `parameterLocks[]`. When a step is active, scheduler combines track transpose + p-lock pitch, parses `sampled:<id>`, converts to scheduler MIDI `60 + pitchSemitones`, and calls sampled playback.
- Sampled playback: `SampledInstrument.playNote()` optionally translates scheduler MIDI using `playbackNote` for drums, then applies manifest `playableRange`; out-of-range skips return `null` and log `[RANGE]`. In-range uses nearest loaded sample + velocity layer, creates `AudioBufferSourceNode`, gain, optional loop/choke, and connects to track bus/master.
- Audit layers map to risks:
  - Layer A: exact skip/null semantics over full UI pitch grid; fast and deterministic, but no real audio amplitude.
  - Layer B: real sample decode/render catches source-created-but-silent bugs, but depends on `node-web-audio-api` availability and currently skipped if native binary missing.
  - Layer C: real app/session routing catches preload/routing/master-output regressions, but current analyser is session-level and can mask a silent instrument in a batch.

## Manifest/range findings
Command summary of all 27 manifests:
- All sampled manifests declare `playableRange` and are mirrored in `INSTRUMENT_RANGES` by existing test.
- Drum/percussion natural-pitch instruments use `playbackNote`: 808/acoustic kicks/snares/hats/clap/crash/ride/brushes; expected skips must compare `playbackNote + pitchOffset`, not raw `60 + offset`.
- Example intentional skips on UI offset grid `-24..+24`:
  - `sampled:808-kick` range `[24,73]`, playbackNote `36`: offsets below `-12` skip; high offsets through `+24` in range.
  - `sampled:acoustic-crash` range `[37,73]`, playbackNote `49`: offsets below `-12` skip.
  - `sampled:finger-bass` range `[18,66]`, no playbackNote: offsets above `+6` skip (`60+offset > 66`).
  - `sampled:kalimba` range `[53,87]`: offsets below `-7` skip.
  - `sampled:vinyl-crackle` range `[48,72]`: offsets below `-12` and above `+12` skip.
- In-range notes are expected to sound even if sparse sample coverage requires pitch shifting; nearest-sample selection means not having an exact sample note is not intentional silence.

## Recommended tests
1. Promote a layer-A gate in `app/src/audio/instrument-range-simulation.test.ts` or new focused test:
   - For every manifest and every offset `-24..+24`, compute `expectedAdjustedMidi = (playbackNote ?? 60) + offset` and `expectedInRange = min <= expectedAdjustedMidi <= max`.
   - Assert `instrument.playNote(...) !== null` iff `expectedInRange`.
   - This proves all in-range sampled instruments produce a source and all out-of-range steps are classified as range skips at the exact production seam.
2. Add/strengthen layer-B assertion in `app/src/audio/instrument-range-render.test.ts`:
   - For every note where `sourceCreated === true`, assert `peak >= SILENCE_PEAK` (or collect failures and fail with instrument/offset/midi/peak).
   - Keep `describe.skipIf(!webAudio)` risk noted; CI may not execute if native module unavailable.
3. Strengthen layer-C `app/e2e/instrument-range-session.spec.ts`:
   - Build expected skip notes from manifests for `PROBE_OFFSETS` using `playbackNote ?? 60`.
   - Assert captured `[RANGE]` skips per instrument exactly equal expected out-of-range adjusted MIDI notes.
   - To prove per-instrument master output, avoid batching ambiguity: either play one instrument/session at a time for in-range offset `0` (or another guaranteed in-range offset) and assert `masterPeak > threshold`, or in batched sessions solo/mute one instrument at a time and sample master. Current “each chunk has output” can pass if only one track in the chunk sounds.
4. Add scheduler path unit coverage if not already present in scheduler tests:
   - A sampled track with `steps[0]=true`, `parameterLocks[0]={ pitch: X, volume: V }`, `transpose=T` calls `playSampledInstrument(presetId, noteId, 60+T+X, ..., volumeMultiplier=V, trackId, velocityFromMultiplier(V))`.
   - This guards “steps become sounds” before the engine seam.
5. Optional preview coverage: `audioTriggers.previewInstrument('sampled:<id>', pitch)` computes `midiNote=60+pitch`; for playbackNote instruments, range classification still happens inside `SampledInstrument.playNote()`.

## Start Here
Open `app/src/audio/sampled-instrument.ts` first, specifically `playNote()` lines 368-475. It is the authoritative boundary between intentional range skips (`null` + `[RANGE]`) and bugs (in-range null/silent render). Then open `app/src/audio/instrument-range-simulation.test.ts` to convert the existing report-only matrix into a behavioral gate.

## Supervisor coordination
No supervisor decision needed; investigation was read-only. Existing working tree had unrelated unstaged changes before report write.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Read-only investigation only; no product/test files edited. Findings limited to sampled instrument ranges, manifests, range audits, scheduler/e2e path coverage."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report cites exact files/line ranges, key snippets, data flow, current coverage gaps, and concrete recommended tests for in-range output and out-of-range range-skip classification."
    }
  ],
  "changedFiles": [
    "/Users/adewale/Documents/projects/code/keyboardia/subagent-reports/sampled-range-and-path-coverage.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "ls .; find/grep/read targeted app sampled/range/e2e files",
      "result": "passed",
      "summary": "Mapped sampled instruments, range tests, e2e range session spec, scheduler and engine entry points."
    },
    {
      "command": "cd app && node -e \"...summarize public/instruments manifests...\"",
      "result": "passed",
      "summary": "Listed all 27 manifest playable ranges, playbackNote values, sample counts/notes, and gainDb."
    },
    {
      "command": "cd app && git status --short",
      "result": "passed",
      "summary": "Observed pre-existing unstaged modifications plus untracked subagent-reports directory; this task only wrote the requested report."
    }
  ],
  "validationOutput": [
    "No tests run; investigation only.",
    "git status showed existing unstaged files: e2e/instrument-range-session.spec.ts, package.json, playwright.config.ts, scripts/instrument-range-report.ts, src/audio/advancedSynth.test.ts, src/audio/advancedSynth.ts, src/audio/audio-context-safety.test.ts, src/audio/instrument-ranges.test.ts, src/audio/instrument-ranges.ts, vite.config.ts; untracked e2e/advanced-sub-bass-session.spec.ts and ../subagent-reports/."
  ],
  "residualRisks": [
    "Layer-B offline render is skipped when node-web-audio-api native binary is unavailable.",
    "Current live e2e master analyser proves session chunks produce output, not each instrument individually.",
    "Existing unstaged changes are outside this scout task and were not reviewed for correctness."
  ],
  "noStagedFiles": true,
  "notes": "Read-only scout completed; report file created as requested."
}
```