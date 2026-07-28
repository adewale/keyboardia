# Skill evaluation evidence — 2026-07-28

## Verdict

The four missing-evidence objections are fixed:

1. The autonomous trace validator requires one continuous journey from an
   origin-only prompt through well-known discovery, exact-byte digest
   verification, MCP initialization, `tools/list`, read, edit, and verification.
   Claude Sonnet 5 and Opus 5 each completed that journey against a disposable
   live Worker. Each passed its one observed attempt.
2. A fresh 54-run live MCP execution sweep ran under the corrected
   successful-result trace contract.
3. The final skill received a fresh 300-run, five-model, repeated answer matrix;
   this is not the earlier narrow safety rerun.
4. All promoted receipts are schema-validated, content-addressed, capability
   sanitized, and bound to immutable skill, manifest, runner, oracle, adapter,
   source-commit, and source-tree bytes.

This closes the four provenance and coverage gaps. It does not make the
behavioral results merge-ready: Haiku has no answer-matrix lift and weak live
reliability, the public answer matrix has no hidden split, repeated runs remain
noisy, and several assertions have identical arm rates.

## Immutable provenance

- Delivered skill SHA-256:
  `1431f92b0284f46aae3255d7249d8afbaeed02df7787ee924fb70abd92589dbe`.
- Canonical skill-tree SHA-256 used to prepare the answer matrix:
  `25f360d0715de6bbdb1b810aca406cba90db15ebe3f5a4b07cde1893fdde9be2`.
- Answer-manifest revision:
  `3eb95d408fede38c9cdf826fff0c7ffe0d4b1847503ee5bfc532509a594efe28`.
- The answer receipt binds Keyboardia commit `c897d8e`, tree
  `a4d5b48d836d1166a1d9b2c5cd946da251e9106c`.
- The live and autonomous receipts bind Keyboardia commit `ae4d618`, tree
  `22d2df21dc2b70293114fb936c0887af02b542fa`.
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
no host-specific checkout path or live edit capability. These are
content-addressed self-consistency proofs, not signed provider attestations or
transparency-log entries.

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

Sonnet recorded 18 correlated transport events and Opus 16. Both made exactly
six target calls. Three live capability UUIDs were found before sanitization,
redacted structurally, and rechecked after sanitization. The journey verifier
also rejects a preconfigured target, a failed or unmatched MCP result, a second
edit before verification, digest mismatch, endpoint not derived from verified
skill bytes, or a final-state mismatch.

Each model passed its one observed run. These samples prove the path is usable,
not that agents activate it reliably.

## Fresh live MCP matrix

The repository runner executed three state/trace cases, both arms, three
repeats, and three Claude models: 54/54 completed runs, zero execution errors,
and zero unscorable pairs.

| Model | with-skill whole-case | baseline whole-case | with assertions | baseline assertions | assertion lift |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claude Haiku 4.5 | 11.11% | 0.0% | 85.06% | 71.66% | +13.40 pp |
| Claude Sonnet 5 | 33.33% | 0.0% | 92.21% | 73.05% | +19.16 pp |
| Claude Opus 5 | 100.0% | 0.0% | 100.0% | 73.05% | +26.95 pp |

The owned Worker stopped before replay. Live and offline-rescored state, traces,
and assertions produced the same projection SHA-256:
`a5e83a9a3413d17610be774f794f56f9e3493ebb0c4c234cea52301e2589a1d4`.

Eighteen live assertions were 100% in both arms. They remain useful regression
guards for state preservation and injection resistance, but they are not
evidence of skill lift. The strongest observed discrimination is
read-before-write ordering and collision-resistant track IDs.

## Repeated five-model answer matrix

The external harness ran all 10 public tune answer cases, both arms, three
repeats, and five models: 300/300 complete runs with no missing output, metadata
mismatch, duplicate tuple, extra tuple, or non-zero agent exit.

| Model | with skill | without skill | lift |
| --- | ---: | ---: | ---: |
| Claude Haiku 4.5 | 20.00% | 20.00% | 0.00 pp |
| Claude Opus 5 | 85.83% | 64.17% | +21.67 pp |
| Claude Sonnet 5 | 80.00% | 66.39% | +13.61 pp |
| GPT-5.4 | 66.67% | 33.33% | +33.33 pp |
| GPT-5.4 Mini | 59.17% | 30.00% | +29.17 pp |
| **Pooled mean** | **62.33%** | **42.78%** | **+19.56 pp** |

The result projection SHA-256 is
`15ce1e7b06b18cf1478da974ab6757ed4e3bed2e70f098a8558571300a23b948`.

The run-aware harness audit exited zero with no readiness blocker,
base-saturated case, or leak-saturated case. It reports 22 findings: 18
required repeated-run variance findings, one required missing-positive-evals
finding, one required missing-hidden-splits finding, one recommended negative-
lift finding for the collision-resistant-ID case, and one recommended finding
covering five assertions with identical arm rates. Both declared ablations are
materialized, but this run did not execute an ablation matrix, so it is not
empirical section-attribution evidence.

## Why this still should not merge

- Only Sonnet and Opus have auditable autonomous receipts, with one observed
  sample each. Haiku and GPT-family activation are untested.
- Haiku's answer score is unchanged at 20.00%, and it passes only one of nine
  with-skill live cases. Sonnet passes only three of nine live cases.
- The collision-resistant-ID answer case regresses from 73.33% without the
  skill to 60.00% with it.
- There is no private holdout or holdback result. Public tune prompts and
  public oracles can co-adapt with the skill and cannot establish
  generalization.
- Eighteen required audit findings record repeated-run variance across affected
  answer cases and arms; one successful sample per autonomous model is too
  little to claim reliable activation.
- Five answer assertions and eighteen live assertions have identical arm rates.
  Some are intentional safety guards, but they contribute no causal evidence.
- Materialized ablations were audited structurally but not run across models,
  so the source of the observed lift is still unmeasured.
- Receipts are unsigned self-consistency proofs. They do not attest provider or
  model identity, wall-clock execution, runtime binaries, or repository origin.

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
