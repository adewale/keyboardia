# Envelope Notation v2.4 — Executable Examples

**Status:** Executable v2.4 acceptance corpus. Parser/serializer, state,
capability, UI/MCP, scheduler, and audio vertical-slice contracts are shipped;
renderer promotion remains separately evidence-gated.

This corpus is deliberately broader than a demo song. It is executable input
for the parser, serializer, migration, and capability-warning oracles, and is
shared input for the envelope verification lanes.

The canonical session strings, tempos, capability declarations, and expected
warnings live in
[`app/src/shared/__fixtures__/envelope-notation-examples.ts`](../app/src/shared/__fixtures__/envelope-notation-examples.ts).
Do not copy them into another fixture: extend that typed corpus and its feature
checklist instead.

## Session set

| Session | Representative question | Important coverage |
|---|---|---|
| `synth-articulation-arc` | Can one synth family move from a clicky pluck to a long swell? | ADSR, `ms`/`s`, sustain and gate boundaries, zero attack |
| `sample-playback-truth` | Does the notation describe what each source can really do? | AD/AHD/AR/ADSR, Trigger/Gate/Loop, mixed units, ties, sparse locks, Hammond loop |
| `ties-locks-and-inactive-data` | Can the system preserve intent without silently applying it? | cyclic tie, lock on continuation, lock on silence, inactive stage, gate ignored by Trigger |
| `mixed-time-polyrhythm` | Do tempo-relative stages remain unambiguous on unusual loop lengths? | `ms`/`s`/`st`, 5/7/12/32 steps, tempo, swing, pitch, transpose, FM annotations |
| `legacy-v23-migration` | Can existing sessions import without positional guesses? | omitted/explicit legacy units, dense A/D/R vectors, canonical sparse output |
| `boundaries-and-capability-warnings` | Are inclusive ranges and unsupported combinations explicit? | all-zero and maximum durations, sustain/gate 0 and 1/100, unsupported model/play mode, unknown annotation |
| `complete-performance-showcase` | Does the notation still read as a musical session? | dynamics, pitch, FM, swing, every envelope/playback family, ties, locks |

## Required feature checklist

The typed `PLANNED_ENVELOPE_NOTATION_FEATURES` list is an executable coverage
claim. The test fails if any of these areas disappears from the session set:

- all four coarse models: AD, AHD, AR, and ADSR;
- Trigger, Gate, and validated Loop sample playback;
- typed milliseconds, seconds, sixteenth-step durations, and mixed units;
- track gate, inline/cyclic ties, sparse onset locks, and inactive authored data;
- accents, ghosts, polyrhythms, and existing annotations that must survive;
- v2.3 envelope/dense-lock import and canonical v2.4 output;
- preset behavior without an authored override, unknown-annotation round-trip,
  and capability warnings;
- zero and maximum boundary values.

## Verification contract

From `app/`, run:

```sh
npm run test:envelope:semantic
```

`npm run examples:envelope` is the tooling entry point for consumers that want
the canonicalized sessions, expected warnings, timing sanity check, and public
contract surface as JSON. It intentionally keeps build-time validation modules
reachable from a real tooling root without adding the corpus to the web bundle.

The fast gate currently proves:

- every example parses without syntax/range errors;
- serialize→parse preserves authored envelope semantics;
- legacy dense locks normalize into stable step/stage order;
- unknown annotations survive;
- cyclic ties are accepted only with an active predecessor;
- capability mismatches are warnings and do not erase authored values;
- all planned feature tags are represented.

The same command also runs the independent amplitude oracle in
[`app/src/shared/envelope-oracle-v2.ts`](../app/src/shared/envelope-oracle-v2.ts).
It pins AD/AHD/AR/ADSR landmarks, gate at the end of a tied run, early note-off
continuity, bounded release, zero-time stages, stop guard, and per-onset tempo
snapshots. Production schedulers intentionally do not call this oracle.
Main-thread and worklet parity tests compare their independently resolved
events with the same contract vectors, avoiding a tautological test.

The corpus is reused by state migration, capability, UI/MCP/notation, and
oracle verification. The focused audio matrix uses the same synth, finite
sample, and Hammond semantic trio; renderer PCM promotion is deliberately a
separate T2/T3 gate. Keeping the same musical inputs across layers detects
disagreements without pretending that a parser test proves audible behavior.
