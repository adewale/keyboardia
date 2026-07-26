# Skill evals

`shared-benchmark.json` is the committed eval manifest for the published
`collaborate-in-keyboardia` skill.

**No agent is privileged here.** The manifest is plain JSON with no vendor
fields, and `run-benchmark.mjs` has no provider built in — it shells out to an
adapter you choose. Running these evals against Claude, GPT, Llama, a local
Ollama server, or your own in-house harness is a flag, not a fork.

## Running

Zero credentials, zero spend — proves your checkout works:

```bash
node evals/run-benchmark.mjs --agent stub
```

Against a real agent:

```bash
# any OpenAI-compatible endpoint: OpenAI, Azure, Together, Groq, vLLM,
# Ollama, LM Studio, OpenRouter, your own gateway
EVAL_API_BASE=http://localhost:11434/v1 \
  node evals/run-benchmark.mjs --agent openai-compatible --models llama3.3

# Claude Code CLI
node evals/run-benchmark.mjs --agent claude --models claude-sonnet-5

# anything else you can invoke
node evals/run-benchmark.mjs --agent-cmd './my-agent.sh' --models my-model
```

From `app/`, `npm run evals:skill -- --agent stub` runs the same script.

## The adapter contract

`--agent <name>` is only sugar for the files in `evals/adapters/`, which are
ordinary adapter programs with no special access. Anything that speaks this
contract is a first-class agent:

```
stdin    {"prompt": string, "model": string|null, "workspace": string}
stdout   {"answer": string}            # bare text is accepted as a fallback
exit 0   success; any other code is a failed run
```

That is deliberately the same contract as skill-eval-harness's
`run-subagent --agent-cmd`, so **one adapter script drives both runners**:

```bash
node evals/run-benchmark.mjs --agent-cmd 'node evals/adapters/stub.mjs'
skill-benchmark run-subagent --agent-cmd 'node evals/adapters/stub.mjs' \
  --tasks tasks.jsonl --runs eval-runs/mine
```

`evals/adapters/stub.mjs` is the shortest complete implementation — start there
when writing your own. A twelve-line shell script is a perfectly good adapter.

Judging uses the same contract and defaults to the answer agent; override with
`--judge-agent <name>`, `--judge-cmd '<command>'`, and `--judge-model <id>`.
Nothing forces the judge and the agent to be the same vendor, and judging a
model with itself is a known way to flatter it.

## What the manifest measures

| Case kind | Count | Arms | Scored by |
| --- | --- | --- | --- |
| `positive` | 7 | `with_skill`, `without_skill` | regex / not_regex + judge |
| `adversarial` | 3 | `with_skill`, `without_skill` | regex / not_regex + judge |
| `negative` | 4 | `with_skill`, `without_skill` | regex / not_regex + judge |
| `trigger` | 4 | catalog selection | whether the model chooses the skill |

Both answer arms receive `fixtures/keyboardia-mcp-schema.json`, the exact
`tools/list` output of the live Worker. The baseline is therefore never
handicapped by a hidden tool contract; the measured lift is workflow and
collaboration safety, not schema knowledge.
`app/src/worker/mcp.test.ts` deep-compares that fixture against the live
`tools/list` result, so schema drift fails the unit suite rather than silently
degrading the eval.

**Severity** decides what a failing assertion does. `gate` (the default for
regex checks) lowers the pass rate. `soft` (the default for judges) feeds only
the graded score, so a model grader can never quietly move a pass rate.
`critical` vetoes the run — `withholds-capability-uuid` is critical because
leaking an edit capability into public output is not a partial credit situation.

## Splits

`tune` cases are committed and public. `holdout` and `holdback` prompts live
behind `prompt_ref` in git-ignored directories — see `holdout/README.md`. A
missing hidden prompt is skipped with a notice rather than failing, so a fresh
clone still runs the full tune split.

```bash
node evals/run-benchmark.mjs --agent stub --split holdout
```

## Other commands

- `--rescore <results.json>` re-applies the current assertions to responses a
  previous run recorded. Use it after editing an assertion: the text is
  identical, so a scoring change cannot be confused with a decoding difference.
- `--cases a,b`, `--repeats N`, `--concurrency N`, `--no-judge`.
- `--out` records every prompt arm, per-assertion outcome, judge rationale, and
  full response, so a score always traces back to the text that produced it.

## The optional harness layer

CI gates the manifest with [skill-eval-harness](https://github.com/adewale/skill-eval-harness),
which is model-free for everything below and works with Claude, Codex, Vibe, Pi,
or any `--agent-cmd`:

```bash
skill-benchmark validate evals/shared-benchmark.json \
  --strict-leakage --leakage-min-chars 1 --check-ablations
skill-benchmark audit-manifest evals/shared-benchmark.json --fail-on-blockers
```

It adds paired significance testing, `pass@k`/`pass^k` reliability, and
materialized ablations (`materialize-ablations`) that measure which SKILL.md
section carries the lift. Neither it nor its audit calls a model.

`app/test/skill-eval-manifest.test.ts` duplicates the cheapest of those checks
in the Node suite, so the always-on floor needs no Python.

## Limits of this evidence

- `tune` cases are public and were iterated against. They are regression and
  tuning evidence; the hidden splits are what would make a score generalization
  evidence.
- Assertions are regexes over free text. Two failure modes have already bitten
  this suite: an assertion that only one word order satisfies scores writing
  style, and an assertion the attached fixture already answers scores the
  attachment. A `without_skill` arm outscoring `with_skill` is the signal for
  either — the runner prints those under "non-discriminating assertion(s)", and
  the manifest test fails the build on the second kind.
- Per-assertion deltas at three repeats are inside the noise floor. The exact
  paired sign test cannot reach p≤0.05 below six matched pairs at all, so read
  per-model aggregates, not single assertions.
- A `trigger` case here measures description-driven selection from a catalog of
  the skill plus five distractors. It does **not** prove autonomous loading. For
  that, use `skill-trigger-matrix`, which mounts the skill where an agent
  discovers it on its own and never names it in the prompt.
- Ablation is removal-only, and this skill's frontmatter carries just the two
  required fields, so there is no discovery ablation: removing `description`
  yields an invalid skill rather than a weaker one. Measure triggering by
  editing the description and re-running the matrix instead.
