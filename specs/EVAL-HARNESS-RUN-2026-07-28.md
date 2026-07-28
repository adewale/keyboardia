# Skill evaluation evidence — 2026-07-28

## Verdict

The four missing-evidence objections are fixed:

1. The autonomous trace validator requires one continuous journey from an
   origin-only prompt through well-known discovery, exact-byte digest
   verification, MCP initialization, `tools/list`, read, edit, and verification.
   Claude Sonnet 5 and Opus 5 each completed that journey against a disposable
   live Worker. Sonnet passed one of two observed attempts; Opus passed its one
   observed attempt.
2. A fresh 54-run live MCP execution sweep ran under the corrected
   successful-result trace contract.
3. The final skill received a fresh 300-run, five-model, repeated answer matrix;
   this is not the earlier narrow safety rerun.
4. All promoted receipts are schema-validated, content-addressed, capability
   sanitized, and bound to immutable skill, manifest, runner, oracle, adapter,
   source-commit, and source-tree bytes.

This closes the four provenance and coverage gaps. It does not make the
behavioral results merge-ready: Haiku has negative answer-matrix lift, the
public answer matrix has no hidden split, repeated runs remain noisy, and
several assertions have identical arm rates.

## Immutable provenance

- Delivered skill SHA-256:
  `1431f92b0284f46aae3255d7249d8afbaeed02df7787ee924fb70abd92589dbe`.
- Canonical skill-tree SHA-256 used to prepare the answer matrix:
  `25f360d0715de6bbdb1b810aca406cba90db15ebe3f5a4b07cde1893fdde9be2`.
- Answer-manifest revision:
  `6951891e166ebf07cbd39dd578c87fe33b518c287409592389ad8dfc1c1d7d10`.
- The answer receipt binds Keyboardia commit `66a2b8b`, tree
  `3b6ebed729a8c124b832b707e7a02e876a6e122a`.
- The live and autonomous receipts bind Keyboardia commit `8c51c87`, tree
  `3031f35d3b07524da215c0cc62e6c8e094a1e09f`.
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

Sonnet recorded 39 correlated transport events and Opus 26. Both made exactly
six target calls. Three live capability UUIDs were found before sanitization,
redacted structurally, and rechecked after sanitization. The journey verifier
also rejects a preconfigured target, a failed or unmatched MCP result, a second
edit before verification, digest mismatch, endpoint not derived from verified
skill bytes, or a final-state mismatch.

Opus passed its one observed run. Sonnet's first observed run failed and emitted
no receipt; its retry passed. The failed attempt is therefore an operational
observation, not cryptographically auditable evidence. These samples prove the
path is usable, not that agents activate it reliably.

## Fresh live MCP matrix

The repository runner executed three state/trace cases, both arms, three
repeats, and three Claude models: 54/54 completed runs, zero execution errors,
and zero unscorable pairs.

| Model | with-skill whole-case | baseline whole-case | with assertions | baseline assertions | assertion lift |
| --- | ---: | ---: | ---: | ---: | ---: |
| Claude Haiku 4.5 | 0.0% | 0.0% | 82.86% | 70.27% | +12.59 pp |
| Claude Sonnet 5 | 55.56% | 0.0% | 94.23% | 73.05% | +21.18 pp |
| Claude Opus 5 | 100.0% | 0.0% | 100.0% | 73.05% | +26.95 pp |

The owned Worker stopped before replay. Live and offline-rescored state, traces,
and assertions produced the same projection SHA-256:
`2f23940937bf803363ba3179a6f7ef49c16ac264d7c1eab4ab7bd3d918085a26`.

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
| Claude Haiku 4.5 | 20.00% | 25.00% | -5.00 pp |
| Claude Opus 5 | 91.67% | 58.06% | +33.61 pp |
| Claude Sonnet 5 | 81.67% | 55.00% | +26.67 pp |
| GPT-5.4 | 68.33% | 23.33% | +45.00 pp |
| GPT-5.4 Mini | 38.33% | 23.33% | +15.00 pp |
| **Pooled mean** | **60.00%** | **36.94%** | **+23.06 pp** |

The result projection SHA-256 is
`17e9b36fcb56866f77e93fff8878ff0337051d80ca5f0a625936a0625e9accc7`.

The run-aware harness audit exited zero with no readiness blocker,
base-saturated case, or leak-saturated case. It reports 20 findings: 17
required repeated-run variance findings, one required missing-positive-evals
finding, one required missing-hidden-splits finding, and one recommended
finding covering six assertions with identical arm rates. Both declared
ablations are materialized, but this run did not execute an ablation matrix, so
it is not empirical section-attribution evidence.

## Why this still should not merge

- Only Sonnet and Opus have auditable passing autonomous receipts. Sonnet was
  operationally one-for-two; its failed attempt emitted no auditable receipt.
- Haiku's answer score fell from 25.00% without the skill to 20.00% with it.
  It also failed all three with-skill capability-withholding samples.
- There is no private holdout or holdback result. Public tune prompts and
  public oracles can co-adapt with the skill and cannot establish
  generalization.
- Seventeen required audit findings record repeated-run variance across affected
  answer cases and arms; one successful sample per autonomous model is too
  little to claim reliable activation.
- Six answer assertions and eighteen live assertions have identical arm rates.
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
