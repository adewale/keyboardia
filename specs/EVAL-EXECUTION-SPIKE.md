# Execution-graded skill evaluation

## Current result

The historical attempted-call runs have been replaced. On 2026-07-28, the
three-case execution suite ran fresh under the corrected trace contract, where
a tool call counts only when its correlated MCP result succeeded.

The matrix covered:

- `exec-four-on-the-floor`;
- `exec-preserve-collaborator`;
- `exec-injected-track-name`;
- with-skill and without-skill arms;
- Claude Haiku 4.5, Sonnet 5, and Opus 5;
- three repeats per arm.

All 54 runs completed against a disposable local Worker. There were zero
runner errors and zero unscorable pairs.

| Model | with-skill whole-case | baseline whole-case | with-skill assertions | baseline assertions |
| --- | ---: | ---: | ---: | ---: |
| Claude Haiku 4.5 | 0.0% | 0.0% | 86.3% | 78.0% |
| Claude Sonnet 5 | 22.2% | 0.0% | 88.6% | 83.0% |
| Claude Opus 5 | 100.0% | 0.0% | 100.0% | 83.0% |

The receipt is
`evals/receipts/2026-07-28-live-execution.json`. It binds the skill,
execution manifest, runner, scorer, session harness, receipt runtime/schema,
and MCP adapter to Git commit `9c492c0`, then content-addresses the exact
prompts, model outputs, successful-result traces, and pre/post session states.

## What the suite proves

### Real execution

Each run created a fresh editable session, applied the case setup, allowed only
Keyboardia `get_session` and `edit_session`, and read the final Durable
Object state back for scoring. No prose assertion can make a failed tool call
pass.

### Correlated successful results

The adapter records an ordered call only after matching the MCP tool-use ID to
its tool result. A trace assertion rejects `success: false` and
`success: null`; every trace assertion uses that same successful-call set. The
contract is guarded by focused tests.

### State and trace grading

All gates are structural:

- final active steps and tempo;
- byte-for-byte preservation of collaborator tracks;
- exact track-count changes;
- read-before-write order;
- forbidden operation absence;
- step bounds and duplicate assignments;
- collision-resistant new track IDs.

Replacing answer prose cannot change an execution score.

### Deterministic offline replay

After the live matrix completed, the Worker was stopped and all 54 runs were
rescored from the saved transcript. The live and offline projections of model,
case, arm, repeat, result, assertions, trace, and execution state produced the
same SHA-256:

`b343389de3e27d270c5bad407aabc533eccacf641c9dec1ca04e16e7f22a8355`.

The committed receipt independently verifies offline with
`node evals/verify-receipts.mjs`.

## Interpretation

The skill changes execution, but not uniformly.

- Collision-resistant IDs discriminate strongly.
- Read-before-write improves in the with-skill arm but remains inconsistent on
  Haiku and Sonnet.
- Opus follows the complete process reliably in this small slice.
- Seventeen assertions are 100% in both arms. Those safety/state-preservation
  checks show that the baseline already behaves well; they must not be cited as
  skill lift.

Whole-case scoring is deliberately harsh: one missed ordering gate fails the
case. That explains why Haiku can improve assertion-level behaviour while
remaining at 0% whole-case success.

This is fresh execution evidence, not proof that every model will apply the
skill reliably. It complements the origin-only autonomous trace and the
330-run answer matrix; neither can substitute for the others.

## Reproduction

```bash
node evals/run-benchmark.mjs \
  --manifest evals/execution-benchmark.json \
  --agent claude-mcp \
  --models claude-haiku-4-5,claude-sonnet-5,claude-opus-5 \
  --repeats 3 --concurrency 1 --no-judge \
  --launch-local-worker \
  --out /tmp/keyboardia-live.json \
  --receipt evals/receipts/live-execution.json

# The owned Worker has stopped before replay starts.
node evals/run-benchmark.mjs \
  --manifest evals/execution-benchmark.json \
  --rescore /tmp/keyboardia-live.json \
  --out /tmp/keyboardia-replayed.json
node evals/verify-receipts.mjs evals/receipts/live-execution.json
```
