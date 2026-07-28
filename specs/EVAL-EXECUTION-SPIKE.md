# Execution-graded skill evaluation

## Current result

On 2026-07-28 the three-case execution suite ran fresh under the corrected
trace contract. A call counts only after the runner correlates it with a
successful MCP result. The matrix covered both arms, Claude Haiku 4.5, Sonnet
5, and Opus 5, and three repeats per arm: 54 completed runs, zero errors, and
zero unscorable pairs.

| Model | with-skill whole-case | baseline whole-case | with assertions | baseline assertions |
| --- | ---: | ---: | ---: | ---: |
| Claude Haiku 4.5 | 66.7% | 0.0% | 95.2% | 78.3% |
| Claude Sonnet 5 | 100.0% | 0.0% | 100.0% | 83.0% |
| Claude Opus 5 | 100.0% | 0.0% | 100.0% | 83.0% |

The receipt is `evals/receipts/2026-07-28-live-execution.json`. It binds the
skill, manifest, runner, scorer, session harness, receipt schema/runtime, MCP
adapter, Worker source closure, package and lock bytes to Keyboardia commit
`5291c90`, tree `db70579d2d013616f534ffeb3a298980b551dc87`.

## What the suite proves

Each run created a fresh editable session, applied its setup, exposed only the
allowed Keyboardia tools, and read final Durable Object state for scoring. The
trace scorer uses correlated successful calls; attempted, failed, unmatched,
or prose-only calls cannot pass. State and trace gates cover requested edits,
collaborator preservation, exact track counts, read-before-write, forbidden
operations, step bounds, duplicate assignments, and collision-resistant IDs.

After the live matrix, the owned Worker stopped and all runs were rescored from
saved evidence. Live and offline projections matched at SHA-256
`41cc449141f438130d82c68f3ae1bdc58c5fdc205db2b2ad6a9aa01e76ff67b4`.
`node evals/verify-receipts.mjs` independently repeats the deterministic replay.

## Interpretation and limits

The skill materially improves the harsh whole-case score in this small live
slice. The main discrimination is read-before-write and collision-resistant
IDs. Eighteen assertions are 100% in both arms. Those state-preservation and
injection-resistance checks remain useful regression guards, but they must not
be cited as lift.

This is fresh execution evidence, not broad reliability evidence: there are
only three public cases, three repeats, and three related model families. It
complements the origin-only discovery traces and 300-run answer matrix; none
substitutes for the others.

## Reproduction

```bash
node evals/run-benchmark.mjs \
  --manifest evals/execution-benchmark.json \
  --agent claude-mcp \
  --models claude-haiku-4-5,claude-sonnet-5,claude-opus-5 \
  --repeats 3 --concurrency 1 --no-judge \
  --launch-local-worker \
  --out /tmp/keyboardia-live.json \
  --receipt /tmp/keyboardia-live-receipt.json

# The owned Worker has stopped before replay starts.
node evals/run-benchmark.mjs \
  --manifest evals/execution-benchmark.json \
  --rescore /tmp/keyboardia-live.json \
  --out /tmp/keyboardia-replayed.json
node evals/verify-receipts.mjs /tmp/keyboardia-live-receipt.json
```
