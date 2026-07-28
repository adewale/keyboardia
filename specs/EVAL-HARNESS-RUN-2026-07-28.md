# Skill evaluation evidence — 2026-07-28

## Verdict

The five evidence gaps that previously blocked review are closed:

1. A model completed an origin-only discovery-to-edit journey.
2. A fresh live MCP matrix ran under the successful-result trace contract.
3. The current skill received a repeated five-model answer matrix.
4. The run-aware audit has no base-saturated capability case or readiness
   blocker.
5. All three evidence sets are committed, content-addressed, capability
   sanitized, and bound to immutable Git inputs.

That is not an all-clear to merge. The broad run still contains one with-skill
critical capability leak, a negative read-only-session slice, substantial
repeated-run variance, and weak lift on Sonnet. These are behavioural findings,
not missing-evidence caveats.

## Immutable provenance

- Delivered skill SHA-256:
  `4d70889f4744a9d6320f00845b4e2a20fdf5ab79bb89f2ecb53d52051c791db7`.
- Answer manifest SHA-256:
  `2a20459482875e82b2ae62abd678290308f27d172031d504c05aaa785708819c`.
- Canonical skill-tree SHA-256:
  `eec6c9acf70248f1e6b06fef75fdb817baf8814198b1f5c4d690b888b7d25507`.
- External harness: `adewale/skill-eval-harness` 0.6.0, public parent
  `9c1365a`, locally patched commit `01b4e84`, tree `4c35aae`.
- The answer receipt embeds the exact binary patch from the public parent and
  content-addresses both prepared task files and the final benchmark.

The committed receipts are:

- `evals/receipts/2026-07-28-autonomous-claude-sonnet-5.json`
- `evals/receipts/2026-07-28-live-execution.json`
- `evals/receipts/2026-07-28-answer-matrix.json`

`node evals/verify-receipts.mjs` verifies all three offline.

## Origin-only autonomous discovery

Claude Sonnet 5 received only a random local origin and the name of the Agent
Skills discovery standard. The target MCP URL, well-known path, tool names,
session UUID, and tool schemas were not preconfigured.

The successful receipt contains 33 correlated transport events:

- 23 same-origin discovery fetches, including harmless failed probes;
- the well-known catalog and indexed skill fetch;
- exact-byte SHA-256 verification against the catalog digest;
- MCP initialization derived from the verified skill bytes;
- live `tools/list`;
- exactly one disposable session creation;
- initial `get_session`;
- `add_track` and `set_steps`;
- final `get_session` proving one kick on steps 0, 4, 8, and 12 with tempo
  unchanged.

All five target MCP calls succeeded. Three UUIDs were redacted, and the
journey-specific verifier rechecks the prompt hash, trace hash, call order,
correlation, final state, non-preconfiguration, redaction, source commit/tree,
and bound Git blobs.

## Fresh live MCP matrix

The repository runner executed three state/trace cases, both arms, three
repeats, and three Claude models: 54/54 runs, zero execution errors.

| Model | with-skill whole-case | baseline whole-case | assertion lift |
| --- | ---: | ---: | ---: |
| Claude Haiku 4.5 | 0.0% | 0.0% | +8.4 pp |
| Claude Sonnet 5 | 22.2% | 0.0% | +5.6 pp |
| Claude Opus 5 | 100.0% | 0.0% | +17.0 pp |

The Worker was stopped before replay. Live and offline-rescored run state,
traces, and assertions produced the same SHA-256:
`b343389de3e27d270c5bad407aabc533eccacf641c9dec1ca04e16e7f22a8355`.

Seventeen execution assertions were 100% in both arms. They are state-preserving
safety guards the baseline already performs, not evidence of lift. The observed
lift is concentrated in collision-resistant IDs, read-before-write ordering,
and a small number of requested edits.

## Repeated five-model answer matrix

The external harness ran all 11 public tune answer cases, both arms, three
repeats, and five models: 330/330 scorable runs, zero missing outputs, zero
execution errors.

| Model | with skill | without skill | lift | paired p |
| --- | ---: | ---: | ---: | ---: |
| Claude Haiku 4.5 | 47.73% | 28.79% | +18.94 pp | 0.125000 |
| Claude Sonnet 5 | 59.09% | 57.58% | +1.52 pp | 1.000000 |
| Claude Opus 5 | 86.36% | 51.52% | +34.85 pp | 0.035156 |
| GPT-5.4 Mini | 50.76% | 30.30% | +20.45 pp | 0.250000 |
| GPT-5.4 | 65.91% | 34.85% | +31.06 pp | 0.093750 |
| **Pooled** | **61.97%** | **40.61%** | **+21.36 pp** | **0.000244** |

The run-aware audit was repeated with script oracles enabled. It exits zero:

- readiness blockers: 0;
- base-saturated capability cases: 0;
- explicitly classified regression guards holding: 1;
- identical arm-rate assertions: 5, down from the earlier dozens.

Four of the five identical assertions belong to regression-intent safety cases.
The fifth is a redundant public-copy separation check; the critical capability
withholding assertion on that same case remains discriminating.

The attribution case initially scored 0/15 in both arms because its oracle
required an undocumented `change` wrapper although the prompt requested
`{step, value}`. The corrected structural oracle accepts the prompt-compliant
encodings but still rejects tempo or snare as agent-observed work. Regrading the
same immutable outputs changed that case to 2/15 versus 0/15 and removed the
last saturation blocker without another model call.

## Findings that still argue against merge

- One Haiku with-skill run failed the critical
  `withholds-capability-uuid` assertion. The other four models had no
  with-skill critical leak in three repeats.
- `pos-published-session-read-only` regressed overall: 50% with the skill
  versus 80% without it, with negative deltas on Haiku, Opus, GPT-5.4, and
  GPT-5.4 Mini.
- Many cases have repeated-run variance; the skill improves the mean but does
  not make behaviour dependable.
- Sonnet's pooled lift is only +1.52 points with p=1.0.
- Only Opus is individually significant at the five-percent level.

## Reproduction

```bash
node app/scripts/run-autonomous-discovery.mjs \
  --model claude-sonnet-5 --out evals/receipts/autonomous.json

KEYBOARDIA_MCP_URL=http://localhost:8787/mcp \
node evals/run-benchmark.mjs \
  --manifest evals/execution-benchmark.json --agent claude-mcp \
  --models claude-haiku-4-5,claude-sonnet-5,claude-opus-5 \
  --repeats 3 --concurrency 1 --no-judge \
  --receipt evals/receipts/live-execution.json

skill-benchmark prepare evals/shared-benchmark.json --split tune \
  --runs-per-variant 3 \
  --models claude-haiku-4-5,claude-sonnet-5,claude-opus-5 \
  --out /tmp/tasks-claude.jsonl
skill-benchmark prepare evals/shared-benchmark.json --split tune \
  --runs-per-variant 3 --models gpt-5.4-mini,gpt-5.4 \
  --out /tmp/tasks-codex.jsonl
# Execute with run-subagent and run-codex, then:
skill-benchmark benchmark evals/shared-benchmark.json \
  --runs /tmp/runs --split tune --allow-scripts --out /tmp/benchmark.json
skill-benchmark audit-manifest evals/shared-benchmark.json \
  --runs /tmp/runs --split tune --allow-scripts --fail-on-blockers
node evals/import-harness-receipt.mjs \
  --manifest evals/shared-benchmark.json \
  --tasks /tmp/tasks-claude.jsonl --tasks /tmp/tasks-codex.jsonl \
  --runs /tmp/runs --benchmark /tmp/benchmark.json \
  --harness-repo /path/to/skill-eval-harness \
  --out evals/receipts/answer-matrix.json
node evals/verify-receipts.mjs
```
