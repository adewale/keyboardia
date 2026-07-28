# Skill evaluation evidence — 2026-07-28

## Verdict

The four missing-evidence objections are fixed:

1. The autonomous trace validator requires one continuous journey from an
   origin-only prompt through well-known discovery, exact-byte digest
   verification, MCP initialization, `tools/list`, read, edit, and verification.
   Claude Sonnet 5 and Opus 5 each completed that journey against a disposable
   live Worker.
2. A fresh 54-run live MCP execution sweep ran under the corrected
   successful-result trace contract.
3. The final skill received a fresh 330-run, five-model, repeated answer matrix;
   this is not the earlier narrow safety rerun.
4. All promoted receipts are schema-validated, content-addressed, capability
   sanitized, and bound to immutable skill, manifest, runner, oracle, adapter,
   source-commit, and source-tree bytes.

This closes provenance and coverage gaps. It does not make the behavioral
results merge-ready: Haiku still failed origin discovery, the public answer
matrix has no hidden split, repeated runs remain noisy, and several assertions
are saturated in both arms.

## Immutable provenance

- Delivered skill SHA-256:
  `1431f92b0284f46aae3255d7249d8afbaeed02df7787ee924fb70abd92589dbe`.
- Canonical skill-tree SHA-256 used to prepare the answer matrix:
  `25f360d0715de6bbdb1b810aca406cba90db15ebe3f5a4b07cde1893fdde9be2`.
- Answer-manifest revision:
  `4ac9b0043b9bd2398c028d8391cfa376ede7ae2577e50717a82f8bf24d5ef555`.
- Answer and live receipts bind Keyboardia commit `5291c90`, tree
  `db70579d2d013616f534ffeb3a298980b551dc87`.
- Autonomous receipts bind Keyboardia commit `1672265`, tree
  `451ebdac70d69d0fd480660dd50158a380dff79b`.
- External harness: `skill-eval-harness` 0.6.0, public parent `9c1365a`,
  evaluated commit `a27427d`, tree
  `632326040b0b4c5ab8fc2c812211899bd8e8aa05`.
- The answer receipt embeds the harness parent and patched commit/tree proof,
  binary patch, exact source blobs, prepared-task inventories, outputs,
  metrics, benchmark, and audit. Verification reconstructs those identities
  without trusting the local checkout.

Committed receipts:

- `evals/receipts/2026-07-28-autonomous-claude-sonnet-5.json`
- `evals/receipts/2026-07-28-autonomous-claude-opus-5.json`
- `evals/receipts/2026-07-28-live-execution.json`
- `evals/receipts/2026-07-28-answer-matrix.json`

`node evals/verify-receipts.mjs` verifies all four offline. The receipts contain
no host-specific checkout path or live edit capability.

## Origin-only autonomous discovery

Sonnet and Opus received only a random local origin plus a reference to the
Agent Skills discovery standard. The target MCP URL, well-known path, skill
URL, tool names, session UUID, and tool schemas were not preconfigured.

Each successful receipt proves the same continuous chain:

1. fetch the same-origin well-known catalog;
2. fetch the indexed skill;
3. verify its exact bytes against the catalog SHA-256 digest;
4. derive and initialize the same-origin MCP endpoint from verified bytes;
5. call `tools/list`;
6. create one disposable session;
7. call `get_session`;
8. call `add_track`, then immediately `get_session`;
9. call `set_steps`, then immediately `get_session`;
10. verify kick steps `[0, 4, 8, 12]` and unchanged tempo.

Sonnet recorded 15 correlated transport events and Opus 22. Both made exactly
six target calls. Three live capability UUIDs were found before sanitization,
redacted structurally, and rechecked after sanitization. The journey verifier
also rejects a preconfigured target, a failed or unmatched MCP result, a second
edit before verification, digest mismatch, endpoint not derived from verified
skill bytes, or a final-state mismatch.

Haiku did not fetch the well-known catalog in its fresh origin-only attempt.
The runner correctly emitted no passing receipt. Therefore these results prove
the path is usable, not that every supported agent discovers it reliably.

## Fresh live MCP matrix

The repository runner executed three state/trace cases, both arms, three
repeats, and three Claude models: 54/54 completed runs, zero execution errors,
and zero unscorable pairs.

| Model | with-skill whole-case | baseline whole-case | with assertions | baseline assertions | assertion lift |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claude Haiku 4.5 | 66.7% | 0.0% | 95.2% | 78.3% | +17.0 pp |
| Claude Sonnet 5 | 100.0% | 0.0% | 100.0% | 83.0% | +17.0 pp |
| Claude Opus 5 | 100.0% | 0.0% | 100.0% | 83.0% | +17.0 pp |

The owned Worker stopped before replay. Live and offline-rescored state, traces,
and assertions produced the same projection SHA-256:
`41cc449141f438130d82c68f3ae1bdc58c5fdc205db2b2ad6a9aa01e76ff67b4`.

Eighteen live assertions were 100% in both arms. They remain useful regression
guards for state preservation and injection resistance, but they are not
evidence of skill lift. The strongest observed discrimination is
read-before-write ordering and collision-resistant track IDs.

## Repeated five-model answer matrix

The external harness ran all 11 public tune cases, both arms, three repeats,
and five models: 330/330 complete runs with no missing output, metadata
mismatch, duplicate tuple, extra tuple, or non-zero agent exit.

| Model | with skill | without skill | lift |
| --- | ---: | ---: | ---: |
| Claude Haiku 4.5 | 18.18% | 18.18% | 0.00 pp |
| Claude Opus 5 | 86.36% | 58.33% | +28.03 pp |
| Claude Sonnet 5 | 78.79% | 54.55% | +24.24 pp |
| GPT-5.4 | 64.39% | 31.82% | +32.58 pp |
| GPT-5.4 Mini | 58.84% | 21.21% | +37.63 pp |
| **Pooled mean** | **61.31%** | **36.82%** | **+24.49 pp** |

The result projection SHA-256 is
`1e0bcedeb4fad6a68f57ba5bfc656ef1581e38b8a916c968dc3a85c0eea8f672`.

The run-aware harness audit has no readiness blocker, base-saturated case, or
leak-saturated case. It does report 21 findings: 19 required repeated-run
variance findings, one required missing-hidden-splits finding, and one
recommended finding covering six assertions with identical arm rates. Both
declared ablations are materialized, but this run did not execute an ablation
matrix, so it is not empirical section-attribution evidence.

## Why this still should not merge

- Haiku has zero answer-matrix lift and failed the fresh autonomous well-known
  discovery attempt.
- There is no private holdout or holdback result. Public tune prompts and
  public oracles can co-adapt with the skill and cannot establish
  generalization.
- Nineteen required audit findings record repeated-run variance across affected
  answer cases and arms; one successful sample per autonomous model is too
  little to claim reliable activation.
- Six answer assertions and eighteen live assertions have identical arm rates.
  Some are intentional safety guards, but they contribute no causal evidence.
- Materialized ablations were audited structurally but not run across models,
  so the source of the observed lift is still unmeasured.

These are evaluation-quality and behavior risks. The earlier objections about
missing trace continuity, stale live execution, narrow reruns, and unbound
temporary evidence no longer apply.

## Reproduction

```bash
node app/scripts/run-autonomous-discovery.mjs \
  --model claude-sonnet-5 --out /tmp/autonomous-sonnet.json
node app/scripts/run-autonomous-discovery.mjs \
  --model claude-opus-5 --out /tmp/autonomous-opus.json

node evals/run-benchmark.mjs \
  --manifest evals/execution-benchmark.json --agent claude-mcp \
  --models claude-haiku-4-5,claude-sonnet-5,claude-opus-5 \
  --repeats 3 --concurrency 1 --no-judge \
  --launch-local-worker --receipt /tmp/live-execution.json

skill-benchmark prepare evals/shared-benchmark.json --split tune \
  --runs-per-variant 3 \
  --models claude-haiku-4-5,claude-sonnet-5,claude-opus-5,gpt-5.4-mini,gpt-5.4 \
  --out /tmp/tasks.jsonl
# Execute the Claude tasks with run-subagent and Codex tasks with run-codex.
skill-benchmark benchmark evals/shared-benchmark.json \
  --runs /tmp/runs --split tune --allow-scripts --out /tmp/benchmark.json
skill-benchmark audit-manifest evals/shared-benchmark.json \
  --runs /tmp/runs --split tune --allow-scripts --fail-on-blockers \
  --out /tmp/audit.json
node evals/import-harness-receipt.mjs \
  --manifest evals/shared-benchmark.json --tasks /tmp/tasks.jsonl \
  --runs /tmp/runs --benchmark /tmp/benchmark.json --audit /tmp/audit.json \
  --harness-repo /path/to/skill-eval-harness --out /tmp/answer-matrix.json
node evals/verify-receipts.mjs
```
