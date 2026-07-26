# Skill evals

`shared-benchmark.json` is the committed eval manifest for the published
`collaborate-in-keyboardia` skill. `run-benchmark.mjs` executes it.

## What the manifest measures

| Case kind | Count | Arms | Scored by |
| --- | --- | --- | --- |
| `positive` / `adversarial` | 6 | `with_skill`, `without_skill` | `regex` / `not_regex` assertions on the model's answer |
| `trigger` | 4 | catalog selection | whether the model chooses to load the skill |

Both answer arms receive `fixtures/keyboardia-mcp-schema.json`, the exact
`tools/list` output of the live Worker. The baseline is therefore never
handicapped by a hidden tool contract; the measured lift is workflow and
collaboration safety, not schema knowledge.

`app/src/worker/mcp.test.ts` deep-compares that fixture against the live
`tools/list` result, so schema drift fails the unit suite rather than silently
degrading the eval.

## Running

Requires the `claude` CLI on `PATH` and a working Claude login.

```bash
node evals/run-benchmark.mjs \
  --models claude-haiku-4-5-20251001,claude-sonnet-5,claude-opus-5 \
  --repeats 3 \
  --concurrency 6 \
  --out evals/results/run.json
```

From `app/`, `npm run evals:skill` runs the same defaults.

Options:

- `--models` comma-separated model IDs (default: Haiku 4.5, Sonnet 5, Opus 5)
- `--repeats` samples per case per arm; these are small case counts, so a single
  repeat is noisy. Use at least 3 before comparing models.
- `--concurrency` parallel model calls
- `--cases` comma-separated case IDs to run a subset
- `--out` results path. The file records every prompt arm, per-assertion
  outcome, and the full model response, so a score can always be traced back to
  the text that produced it.

Each call runs in an empty temporary directory with tools, MCP servers, settings
sources, and slash commands disabled, so the only difference between the two
answer arms is the presence of the skill.

## Limits of this evidence

- These are public tune cases. There is no hidden holdout, so the numbers are
  regression and tuning evidence, not generalization proof.
- Assertions are regexes over free text. A semantically correct answer phrased
  differently can fail one, and the per-assertion breakdown in the results file
  is the place to check that before trusting a delta.
- A `trigger` case measures description-driven selection from a catalog that
  contains the skill plus five distractors. It does not prove autonomous loading
  inside any particular agent product.
- The runner drives the `claude` CLI, so results reflect that harness's system
  prompt and decoding settings, not a raw API call.
