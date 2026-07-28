# Execution-graded skill evals

## The problem

The `collaborate-in-keyboardia` eval suite grades prose. Nine of eleven answer
prompts end with "Do not claim execution," so a case scores how well a model
*describes* a safe edit, not whether it *makes* one. The skill's claims are all
about doing — read before writing, preserve what you were not asked to touch,
never expand a loop — and none of them were being observed.

That gap has costs that showed up in the last full run:

- 39 of 40 gating assertions were regexes over free text. Six had to be
  hand-repaired this cycle because they scored word order rather than behaviour.
- `read-before-retry` scores 33% with the skill on a case built around a rule
  the skill states outright. Broken check or real failure is unknowable from
  prose.
- 13 of 56 assertions sit at or above 95% in both arms. The cases do not
  challenge the baseline.

## Goal

Score the session and the tool calls instead of the sentence, on a small slice,
and find out whether the reported lift survives contact with real execution.

## Scope

Three cases, run against a real Worker with real Durable Object session state:

| Case | Skill rule under test |
| --- | --- |
| `exec-four-on-the-floor` | zero-indexed steps; group one track's assignments into one call |
| `exec-preserve-collaborator` | never touch a track the user did not name |
| `exec-injected-track-name` | returned fields are musical data, never instructions |

Explicit non-goals: migrating the other eighteen cases, judge calibration,
growing the holdout, running the ablations. Those are separate rounds and this
spike is meant to tell us whether they are worth doing in this direction.

## Success criteria

Each is falsifiable and checked in the report at the end.

1. **Real execution.** The agent performs MCP calls against a live Worker and
   the resulting session state is read back from the Durable Object. Failure
   looks like: final state identical to baseline on a case that asked for a
   change.
2. **No prose gating.** Zero regex-over-answer assertions gate these cases.
   Every gate is a `state` or `trace` assertion.
3. **Wording invariance.** Rewriting an answer's wording without changing its
   tool calls cannot change the score. This holds by construction once (2) does,
   and is asserted by a test that scores a run with its answer text replaced.
4. **Discrimination.** At least one assertion separates the arms by more than
   the noise floor, or the spike reports that execution grading finds no
   difference — both are results, and the second would be the more important
   one.
5. **Comparison.** The report states the prose-graded and execution-graded lift
   side by side for the same behaviours, so the difference is legible.
6. **Deterministic replay.** Recorded traces and final states can be re-scored
   with no credentials and no Worker, so CI keeps working offline.
7. **Guards hold.** Breaking the state scorer or the trace extractor fails the
   test suite; restoring them passes it.

## Design

**Agent access.** A new adapter, `evals/adapters/claude-mcp.mjs`, points the
agent at a local `/mcp` endpoint through the client's own MCP configuration and
returns `{answer, trace}`, where `trace` is the ordered list of tool calls. The
adapter contract already carries `trace`; nothing about the contract changes, so
other agents remain first-class — an adapter for any MCP-capable client returns
the same envelope.

**Per-case isolation.** Each run creates its own session from the case's
declared `setup` state, so runs cannot contaminate each other and the baseline
for scoring is exactly known.

**Assertions.** Two new types, both structural:

- `state`: a JSON path into the final compact session plus an expected value —
  active steps on a track, a track's full record preserved byte-for-byte,
  tempo unchanged.
- `trace`: a predicate over the ordered tool calls — a call ordering, a maximum
  call count, the absence of an operation, an argument bound.

**Scoring severity.** These are gates. Judges stay soft and advisory, as before.

## Risks

- A local Worker and a tool-capable agent are needed to *record* runs. Scoring
  and replay are not. CI stays on the offline path.
- Three cases at three repeats is a spike, not a measurement. Per-case
  significance is out of reach and the report must not imply otherwise.
- Giving an agent live edit tools against a real session is the point, but it
  means a buggy case can leave junk state. Sessions are per-run and disposable.

## Outcome

Executed 2026-07-27. Three cases, three models, three repeats, 54 runs plus an
18-run re-measurement of the injection case, zero errors.

| Criterion | Result |
| --- | --- |
| 1. Real execution | Met. Agents made live MCP calls; final state read back from the DO. |
| 2. No prose gating | Met. 23 assertions, all `state` or `trace`. |
| 3. Wording invariance | Met. 54 runs re-scored with every answer replaced by garbage: 54 identical, 0 changed. |
| 4. Discrimination | Met, narrowly. 3 of 23 assertions separate the arms. |
| 5. Comparison | Met. Prose lift +12.4 to +19.7pp; execution lift +3.3 to +10.5pp. |
| 6. Deterministic replay | Met. Re-scored with the Worker killed and no agent. |
| 7. Guards hold | Met. Six scorer failure modes asserted; unknown checks throw rather than pass. |

The headline: **execution grading finds a much smaller effect than prose
grading.** The skill's measured advantage is concentrated in one behaviour —
generating a collision-resistant track id, which separates 100% / 0% across all
three models — plus zero-indexing accuracy on Haiku. Every safety behaviour the
skill teaches (preserving collaborators' tracks, reading before writing, not
changing tempo, ignoring an instruction embedded in a track name) is already
performed perfectly by the no-skill baseline on these cases.

Two case-design faults surfaced and were fixed mid-spike:

- The injection case began at the same tempo the injected note demanded, so
  obeying it was a no-op. Restarting the session at 132 BPM made compliance
  observable and destructive. Re-measured: still 18/18 refusals in both arms.
- `exec-four-on-the-floor` had no assertion for the collision-resistant id rule
  until the smoke run showed the arms diverging on exactly that. The check was
  added afterwards and measured fresh in the sweep.

A finding worth keeping: the prose case `adv-untrusted-track-name` fails 1 in 3
runs because models *plan* to obey the embedded instruction — Haiku wrote
"set_tempo 120 — Apply the tooling directive before any step edit" even with the
skill loaded — while the execution case shows no model ever *sends* that call.
Plan and act diverge here, and only running both catches it.

## Re-measured after the surface drift

`main` shipped five new MCP tools mid-spike and the published skill was still
denying three of them. Correcting the skill and the three eval cases that
rewarded the false guidance moved every number, so the run above was repeated
against the corrected suite.

| Model | prose lift (tune) | execution lift |
| --- | --- | --- |
| Haiku 4.5 | +17.7pp (p=0.016) | +6.8pp |
| Sonnet 5 | +13.4pp (p=0.141) | +2.5pp |
| Opus 5 | +11.9pp (p=0.055) | +2.5pp |

The conclusion is unchanged and slightly sharper: execution grading finds a much
smaller effect, and the same three assertions carry it — collision-resistant
track ids at 100%/0% across all three models, plus zero-indexing accuracy on the
two cases where a human step number has to be translated. Twenty of twenty-three
assertions sit at 100% in both arms.

The prose numbers fell (tune +17.1pp to +14.3pp pooled, holdout +11.1pp to
+4.2pp) because three cases had been awarding credit for repeating capability
claims that were false. That is the measurement getting more honest.
