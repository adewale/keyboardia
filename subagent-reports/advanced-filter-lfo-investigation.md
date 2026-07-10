# Code Context
## Files Retrieved
1. `app/src/audio/advancedSynth.ts` (lines 35-65, 121-168, 253-338, 380-438) - filter/LFO config, target presets, routing nodes, and LFO connection logic.
2. `app/src/audio/advancedSynth.test.ts` (lines 116-137, 196-214, 446-498, 636-728) - Tone mock semantics and existing transition coverage.
3. `app/node_modules/tone/Tone/source/oscillator/LFO.ts` (lines 21-34, 287-301) - local Tone LFO docs/connect implementation.
4. `app/node_modules/tone/Tone/signal/Add.ts` (lines 7-18, 23-43) - local Tone Add summing semantics.
5. `app/package.json` (lines 5-15) - available test command.
## Key Code
- `AdvancedSynthPreset` includes both `filter` and `lfo` (`app/src/audio/advancedSynth.ts` lines 60-65). Filter config has base `frequency` and `envelopeAmount` (`lines 37-42`); LFO has `destination`/`amount` (`lines 47-52`).
- The three named presets all have `lfo.destination: 'filter'` and nonzero `amount`:
  - `supersaw`: filter base 4000, env amount 0.3, filter LFO amount 0.2 (`app/src/audio/advancedSynth.ts` lines 125-133).
  - `wobble-bass`: filter base 800, env amount 0.2, filter LFO amount 0.8 (`lines 149-157`).
  - `warm-pad`: filter base 1500, env amount 0.4, filter LFO amount 0.15 (`lines 161-169`).
- Filter envelope was fixed as additive: `filterEnvelope -> Multiply -> Add -> filter.frequency`; `Add.addend` is set to preset cutoff (`app/src/audio/advancedSynth.ts` lines 305-338, 380-385). `Multiply.value = envelopeAmount * 5000` (`lines 401-403`).
- LFO still connects directly to the same `filter.frequency` AudioParam/Signal when destination is filter (`app/src/audio/advancedSynth.ts` lines 410-438):
  ```ts
  this.lfo.disconnect();
  ... reset output.gain and oscillator detune ...
  case 'filter':
    this.lfo.min = -lfoAmount * 2000;
    this.lfo.max = lfoAmount * 2000;
    this.lfo.connect(this.filter.frequency);
  ```
  There is no analogous reset of `filter.frequency`/`filterEnvAdder.addend` after `disconnect()`, and no summing node for LFO + envelope/base.
- Local Tone evidence: `LFO` “produces an output signal which can be attached to an AudioParam or Tone.Signal in order to modulate that parameter” (`app/node_modules/tone/Tone/source/oscillator/LFO.ts` lines 21-34). `LFO.connect` special-cases `Param`/`Signal`, copies units, then calls `connectSignal(this, node, ...)` (`lines 287-301`). `Tone.Add` explicitly sums input and scalar/addend (`app/node_modules/tone/Tone/signal/Add.ts` lines 7-18, 23-43`).
- Existing tests simulate disconnect residue for LFO-connected params: `MockLFO.disconnect()` sets all previously connected param `.value = 0` (`app/src/audio/advancedSynth.test.ts` lines 116-137). Tests cover output gain and oscillator detune transitions, but not filter cutoff (`lines 684-728`).
## Architecture
- Voice signal flow: oscillators/noise -> filter -> amplitude envelope -> output (`app/src/audio/advancedSynth.ts` lines 323-333).
- Filter cutoff currently has two independent modulators targeting `filter.frequency`: additive filter envelope path (`Envelope -> Multiply -> Add -> frequency`) plus direct LFO path (`LFO -> frequency`) for filter-LFO presets. Because both feed the same param/signal, this is the likely replacement-vs-addition bug surface: the filter LFO can override or leave residue on the same destination that the base+envelope path is trying to own.
- `supersaw`, `wobble-bass`, and `warm-pad` are all exposed to the same risk because each uses `destination: 'filter'` with `amount > 0`; `wobble-bass` is highest audible risk due to low base cutoff (800 Hz) and large LFO range (±1600 Hz), which can drive effective cutoff to/through 0 if not summed/clamped as intended.
## Suggested tests/fixes
- Add an auto-expanding transition test parallel to existing gain/detune checks: for every `from -> to`, after `engine.setPreset(from); engine.playNoteFrequency(...); engine.setPreset(to);`, assert `voice['filter']!.frequency.value === ADVANCED_SYNTH_PRESETS[to].filter.frequency` and `voice['filterEnvAdder']!.addend.value === target.frequency`. This will catch filter-LFO disconnect residue using the current mock.
- Add a structural test for filter-LFO presets (`supersaw`, `wobble-bass`, `warm-pad`) that LFO does not connect directly to `filter.frequency`; instead it should connect into a summing stage. Current mock can expose `lfo.connect` calls if needed.
- Likely fix: introduce a `filterLfoScaler` + summing node, or make one shared cutoff-sum graph: `filterEnvelope*amount + lfo*amount + base -> filter.frequency`. Keep `filter.frequency.value`/`filterEnvAdder.addend` reset in `applyPreset` after LFO disconnect. Avoid direct LFO-to-`filter.frequency` when an additive base/envelope path is already connected.
- Consider clamping final cutoff to >=20 Hz if Tone graph supports it, especially for wobble-bass where base 800 + env + LFO min -1600 can go negative.
## Confidence
- High that the three named presets can suffer the same class of replacement/residue bug: all three connect LFO directly to the already envelope-driven `filter.frequency`.
- Medium on exact Tone runtime outcome without an offline audio assertion: local Tone code confirms Signal/Param modulation and Add summing semantics, but this read-only pass did not render audio or inspect `connectSignal` internals.
## Start Here
Open `app/src/audio/advancedSynth.ts` at lines 305-338 and 406-438. The envelope path is additive, while the filter LFO path bypasses that additive design and connects directly to `filter.frequency`.
## Supervisor coordination
Not used; investigation was not blocked.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Read-only investigation only; no source edits made. Findings are scoped to advancedSynth filter LFO risk, relevant tests, and local Tone semantics."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report cites app/src/audio/advancedSynth.ts, app/src/audio/advancedSynth.test.ts, and local Tone source with exact line ranges plus suggested tests/fixes and confidence."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "find/grep/read targeted inspection of advancedSynth.ts, advancedSynth.test.ts, local Tone LFO/Add sources, and package.json",
      "result": "passed",
      "summary": "Identified direct filter LFO connection to filter.frequency and existing transition tests that omit filter cutoff."
    },
    {
      "command": "git status --short",
      "result": "passed",
      "summary": "Working tree already had unrelated modified/untracked files, including advancedSynth files; this task made no source edits."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files."
    }
  ],
  "validationOutput": [
    "No tests run; task was read-only investigation."
  ],
  "residualRisks": [
    "Did not run Tone.Offline/audio rendering, so exact audible severity remains inferred from graph semantics and mocks.",
    "Working tree contains pre-existing modifications not created by this investigation."
  ],
  "noStagedFiles": true,
  "notes": "Report written to subagent-reports/advanced-filter-lfo-investigation.md."
}
```