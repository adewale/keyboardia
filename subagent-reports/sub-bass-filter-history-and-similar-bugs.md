# History
- Introduced in `12abf1c` (`2025-12-15`, author `Claude`, subject `Phase 25: Complete synthesis engine implementation`). `git show --stat --oneline 12abf1c -- app/src/audio/advancedSynth.ts` shows `advancedSynth.ts` was added whole-file (+782 lines).
- Same commit introduced both halves of the failure condition:
  - Sub Bass preset: `app/src/audio/advancedSynth.ts` from `12abf1c` lines 142-150: `filter: { frequency: 300, ... envelopeAmount: 0 }` and `filterEnvelope.sustain: 1`.
  - Direct replacement routing: `app/src/audio/advancedSynth.ts` from `12abf1c` lines 316-317 creates only `Tone.Multiply`; lines 343-345 route `filterEnvelope -> filterEnvScaler -> filter.frequency`; lines 387-406 set base cutoff then set scaler to `preset.filter.envelopeAmount * 5000`.
- `git blame -L 136,145 app/src/audio/advancedSynth.ts` confirms current Sub Bass lines trace to `12abf1c1 (Claude 2025-12-15 09:29:08 +0000)`.
- `git blame -L 300,340 app/src/audio/advancedSynth.ts` shows the original scaler and envelope connect lines trace to `12abf1c1`; the currently uncommitted fix adds `Tone.Add` at lines 305-309 and routes through it at lines 335-338.
- Local uncommitted fix evidence (`git diff -- app/src/audio/advancedSynth.ts`): adds `private filterEnvAdder`, creates `new Tone.Add(2000)`, changes `filterEnvScaler.connect(this.filter.frequency)` to `filterEnvScaler.connect(filterEnvAdder); filterEnvAdder.connect(filter.frequency)`, syncs `filterEnvAdder.addend.value` in `applyPreset` and `setFilterFrequency`, and disposes/nulls it.

# Root Cause
- Confirmed cause: Tone/WebAudio `AudioParam` connection semantics are additive in native WebAudio but Tone `Signal`/`Param` wrappers can drive the target with connected signal values. The old route made the filter cutoff effectively the envelope contribution, not `base cutoff + envelope contribution`.
- For `advanced:sub-bass`, `envelopeAmount === 0`, so `filterEnvScaler.value === 0`; the connected envelope contribution was 0 Hz. The lowpass filter cutoff was therefore driven to/near 0 Hz even though `applyPreset` had set `filter.frequency.value = 300` first.
- Why diagnostics missed it: `AdvancedSynthEngine.playNoteFrequency` increments `playSuccesses` immediately after `voice.triggerAttackRelease(...)` returns (`app/src/audio/advancedSynth.ts` lines 1021-1080). That validates scheduling/node readiness, not audible output or downstream meter energy. A filter cutoff at 0 Hz is an audio-path state bug after scheduling succeeds, so `playSuccesses > 0` is expected.
- Tests missed it because pre-fix coverage mainly checked preset shape and method calls/mocks. The new local regression test (`app/src/audio/advancedSynth.test.ts` lines 195-214) is the first targeted assertion that zero-envelope presets preserve base cutoff and have an additive node. Several engine/UI tests use fake advanced synths with no-op setters (`preview-synth.test.ts`, `per-track-synth*.test.ts`, `xy-effects*.test.ts`), which can verify control routing but cannot reveal Tone signal/AudioParam behavior.

# Similar Patterns Found
## Confirmed issue: fixed advanced filter envelope replacement
- Evidence: old `12abf1c` `app/src/audio/advancedSynth.ts` lines 343-345: `this.filterEnvelope.connect(this.filterEnvScaler); this.filterEnvScaler.connect(this.filter.frequency);` with Sub Bass lines 142-150 (`envelopeAmount: 0`).
- Risk: total silence for zero envelope amount and lowpass filter presets; likely affected only zero-envelope advanced presets (currently Sub Bass per regression test).
- Suggested fix/test: current `Tone.Add` fix is appropriate; keep test asserting all `filter.envelopeAmount === 0` presets retain `filter.frequency` and `filterEnvAdder.addend`.

## Suspicious but not confirmed: AdvancedSynth LFO filter modulation connects directly to `filter.frequency`
- Evidence: `app/src/audio/advancedSynth.ts` lines 431-435: for `preset.lfo.destination === 'filter'`, sets `lfo.min = -amount*2000`, `lfo.max = amount*2000`, then `this.lfo.connect(this.filter.frequency)`.
- Risk: if Tone LFO connection replaces rather than sums, cutoff may oscillate around 0 instead of around preset base cutoff. Unlike the Sub Bass bug, it is gated by `preset.lfo.amount > 0`, so zero amount does not connect. Existing filter-LFO presets (`supersaw`, `wobble-bass`, `warm-pad`) could sound wrong/thin or clip negative/near-zero cutoff.
- Suggested test/fix: add a preset-level/unit test or browser audio render/meter assertion for a filter-LFO preset. If confirmed, route `base cutoff + filter envelope + LFO` through additive summing (`Tone.Add`/signal chain) rather than connecting LFO directly to `filter.frequency`.

## Suspicious but likely intentional: AdvancedSynth amplitude LFO connects directly to output gain
- Evidence: `app/src/audio/advancedSynth.ts` lines 444-449: `lfo.min = 1 - amount; lfo.max = 1; this.lfo.connect(this.output.gain)`.
- Risk: could replace output gain baseline `0.5` with an LFO range of `[1-amount,1]`, changing loudness; for `amount=1`, tremolo reaches 0 by design. Not the same zero-modulation overwrite because connection is skipped when amount is 0.
- Suggested test/fix: assert amplitude-LFO presets do not unintentionally double output or mute average level; if Tone replacement is undesirable, multiply/add around the base output gain.

## Suspicious but not confirmed: legacy/native SynthEngine LFO-to-param routing
- Evidence: `app/src/audio/synth.ts` lines 829-858: LFO oscillator -> gain connects to `filter.frequency`, oscillator `detune`, and `gainNode.gain`.
- Risk: native WebAudio AudioParam inputs are summed with intrinsic value, so filter/pitch LFO are probably correct. Amplitude LFO into `gainNode.gain` may add a bipolar oscillator to an ADSR-driven gain and can produce cancellation/clamping/distortion, but not the same Tone zero-amount replacement; zero depth sets gain node scale to 0.
- Suggested test/fix: audio-render smoke tests for synth presets with amplitude LFO; verify nonzero RMS and no prolonged zero gain. Consider a tremolo multiplier design if artifacts are audible.

## Similar symptom, different class: sampled/instrument range silence
- Evidence: `app/src/audio/instrument-ranges.ts` lines 85-87 define `advanced:sub-bass` range C1-G3; lines 259-299 warn sub-bass may be inaudible on laptop speakers. `app/src/shared/copy-paste-range.test.ts` documents steps that appear active but are silent when copied out of playable range (e.g. lines 278-295).
- Risk: user-visible silence with active steps, but caused by pitch/range/laptop speaker limits, not AudioParam modulation. Could confuse diagnosis of Sub Bass if notes are out of range or <100 Hz.
- Suggested test/fix: keep UI warnings and range tests; for Sub Bass regression use in-range notes and master output meter/RMS to distinguish audio-path mute from intentionally inaudible ranges.

# Non-Issues/Disconfirming Evidence
- `app/src/audio/advancedSynth.ts` lines 416-427 reset `output.gain` and oscillator detunes after LFO disconnect, explicitly addressing stale Tone LFO values on preset switch; this reduces—but does not eliminate—risk around direct LFO connections.
- `app/src/audio/synth.ts` filter envelope is scheduled directly onto `filter.frequency` using explicit absolute values (`setValueAtTime(baseCutoff)`, ramps to clamped targets) at lines 910-936, so zero amount keeps base cutoff rather than replacing it with 0.
- `app/src/audio/sampled-instrument.ts` lines 436-439 are normal audio-node routing (`source -> gain -> destination`), not control-signal-to-param replacement.
- `git diff --cached --name-only` returned no staged files during this read-only investigation.

# Recommended Follow-up
1. Commit/keep the current `Tone.Add` fix and the zero-envelope regression test.
2. Add an audio-level E2E/regression check for `advanced:sub-bass` (the uncommitted `app/e2e/advanced-sub-bass-session.spec.ts` appears intended for this) that asserts master output/RMS, not just `playSuccesses`.
3. Investigate AdvancedSynth filter LFO direct connection next; it is the closest analogous pattern.
4. Improve diagnostics: include effective/base filter cutoff (`filterEnvAdder.addend`), modulation amount, and optionally output meter/RMS in advanced synth diagnostics so successful scheduling is not mistaken for audible output.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Read-only investigation only; no files modified except writing the requested report path. Scope limited to history/root cause/similar-pattern search."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report includes commit hash/date/author, git blame/show evidence, file/line references, confirmed vs suspicious findings, and follow-up recommendations."
    }
  ],
  "changedFiles": [
    "subagent-reports/sub-bass-filter-history-and-similar-bugs.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git status --short && git log --oneline --decorate -- app/src/audio/advancedSynth.ts | head -50",
      "result": "passed",
      "summary": "Confirmed dirty worktree and relevant advancedSynth history."
    },
    {
      "command": "git log --follow --format='%h %ad %an %s' --date=short -- app/src/audio/advancedSynth.ts && git blame -L 130,145 app/src/audio/advancedSynth.ts && git blame -L 300,340 app/src/audio/advancedSynth.ts",
      "result": "passed",
      "summary": "Identified 12abf1c as introducer of Sub Bass preset and direct envelope routing."
    },
    {
      "command": "git show 12abf1c:app/src/audio/advancedSynth.ts | nl -ba | sed -n '142,151p;338,348p;404,420p;720,780p'",
      "result": "passed",
      "summary": "Retrieved historical line evidence for preset and routing."
    },
    {
      "command": "grep/search/read inspections across app/src/audio and app/e2e",
      "result": "passed",
      "summary": "Located analogous control-signal connections, mocks, diagnostics, and range-silence evidence."
    },
    {
      "command": "git diff --cached --name-only && grep -R \"connect(.*\\.frequency\\|connect(.*\\.detune\\|connect(.*\\.gain\" -n app/src/audio --include='*.ts' | head -80",
      "result": "passed",
      "summary": "Confirmed no staged files and gathered control-param connection candidates."
    }
  ],
  "validationOutput": [
    "No tests run; read-only investigation requested.",
    "git diff --cached --name-only produced no output."
  ],
  "residualRisks": [
    "AdvancedSynth filter LFO direct-to-frequency routing remains suspicious but unconfirmed without audio render/RMS validation.",
    "Tone.js Signal/Param behavior should be verified in the exact runtime version for all direct modulation routes."
  ],
  "noStagedFiles": true,
  "notes": "Repo had pre-existing unstaged/untracked local fix/test files before this investigation; only the requested report was written."
}
```