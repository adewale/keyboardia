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
npm ci --ignore-scripts --prefix evals
node evals/run-benchmark.mjs --agent stub
```

Use `--quiet` for CI or other smoke runs that need the final call/error summary
without one progress line per agent call. The full JSON transcript is still
written to `--out`.

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
model with itself is a known way to flatter it. A default same-adapter judge
inherits the evaluated model; an explicitly selected judge adapter uses its own
default unless `--judge-model` is also supplied.

## What the manifest measures

| Slice | Unique cases | Arms | Scored by |
| --- | ---: | --- | --- |
| public answer regressions | 17 | `with_skill`, `without_skill` | script / structured / guard + soft judge |
| trigger | 4 | catalog selection | whether the model chooses the skill |
| hidden v2 (`holdout` 6, `holdback` 6) | 12 | `with_skill`, `without_skill` | deterministic script oracles |

Both answer arms receive `fixtures/keyboardia-mcp-schema.json`, the exact
`tools/list` output of the live Worker. The baseline is therefore never
handicapped by a hidden tool contract; the measured lift is workflow and
collaboration safety, not schema knowledge.
`app/src/worker/mcp.test.ts` deep-compares that eval-owned fixture against the live
`tools/list` result, so schema drift fails the unit suite rather than silently
degrading the eval.

**Severity** decides what a failing assertion does. `gate` (the default for
regex checks) lowers the pass rate. `soft` (the default for judges) feeds only
the graded score, so a model grader can never quietly move a pass rate.
`critical` vetoes the run — `withholds-capability-uuid` is critical because
leaking an edit capability into public output is not a partial credit situation.

## Execution-graded cases

`execution-benchmark.json` grades what an agent *did*, not what it wrote. Each
case builds a disposable session from its `setup`, hands the agent live MCP
tools, then scores the session it left behind (`state` assertions) and the calls
it made (`trace` assertions). No assertion reads the model's prose, so rewording
an answer cannot move a score — `app/test/eval-execution.test.ts` holds that
line, along with the scorer's failure modes.

```bash
node evals/run-benchmark.mjs \
  --manifest evals/execution-benchmark.json \
  --agent claude-mcp --models claude-sonnet-5 --no-judge \
  --launch-local-worker
```

`--launch-local-worker` builds the current checkout, starts and later stops an
isolated loopback Wrangler, and forces the adapter and state harness to its
exact `/mcp` endpoint. Execution receipts require this owned lifecycle. They
bind the Worker source closure, Wrangler config, TypeScript config, package and
lock bytes; record the live `tools/list` bytes and endpoint; and include a
content-addressed deterministic replay input and projection. A setup failure is
recorded as a non-scorable run and never aborts the sweep.

`--rescore` replays a recorded run from its stored baseline, final state, and
trace, so an assertion edit is re-measured on identical evidence with no Worker
and no credentials. Judge verdicts remain the recorded verdicts because calling
the judge again would create a new sample; edit a judge rubric only before a new
run.

These live in their own manifest because `state` and `trace` are not
skill-eval-harness assertion types. Putting them in `shared-benchmark.json`
would make that file fail `skill-benchmark validate`, and a standard manifest
that only our fork accepts is worth less than two honest files.

## Splits

`tune` cases are committed and public. `holdout` and `holdback` prompts live
behind `prompt_ref` in git-ignored directories — see `holdout/README.md`. A
missing hidden prompt is skipped with a notice rather than failing, so a fresh
clone still runs the full tune split.

```bash
node evals/run-benchmark.mjs --agent stub --split holdout
node evals/run-benchmark.mjs --agent stub --split all
```

Every hidden case targets a SKILL.md rule that no tune case drills and that the
attached schema cannot teach — grouped `set_steps` calls, the no-duplicate-step
rule, refusing to claim it heard the audio, and asking before touching a track
the user did not name. A hidden case the fixture can answer measures the
fixture, and a hidden case that restates a tune case measures nothing new.

**The discipline is the point, not the file layout.** Hidden results are read
once and not tuned against. The moment you edit the skill to raise a holdout
score, that case has become a tune case; relabel it rather than keep reporting
it as held out.

## Other commands

- `--rescore <results.json>` re-applies current objective and execution
  assertions to a previous run. Recorded judge verdicts are retained; changing
  a judge rubric requires a new judged run.
- `--cases a,b`, `--repeats N`, `--concurrency N`, `--no-judge`.
- `--no-judge` never turns a skipped judge gate into a pass. A run with a
  skipped gating or critical judge remains failed/unscored on that requirement.
- `--out` records every prompt arm, per-assertion outcome, judge rationale, and
  full response, so a score always traces back to the text that produced it.
  `evals/results/` is ignored, and execution artifacts redact the unpublished
  session UUID before writing because it is an edit capability.

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

To run the answer arms through the harness rather than only validating the
manifest:

```bash
KEYBOARDIA_REPO="$(pwd)"
skill-benchmark prepare evals/shared-benchmark.json --split tune \
  --out /tmp/keyboardia-tasks.jsonl --runs-per-variant 1 \
  --models claude-haiku-4-5
skill-benchmark run-subagent --tasks /tmp/keyboardia-tasks.jsonl \
  --runs /tmp/keyboardia-runs \
  --agent-cmd "node $KEYBOARDIA_REPO/evals/adapters/claude.mjs"
skill-benchmark benchmark evals/shared-benchmark.json \
  --runs /tmp/keyboardia-runs --split tune --allow-scripts \
  --out /tmp/keyboardia-benchmark.json
skill-benchmark audit-manifest evals/shared-benchmark.json \
  --runs /tmp/keyboardia-runs --split tune --allow-scripts \
  --fail-on-blockers --out /tmp/keyboardia-audit.json
```

Use `run-codex` in place of `run-subagent` for Codex JSONL, or provide any
other program that implements the adapter contract. The sanitized 2026-07-28
run record, including candidate drift and readiness blockers, is in
[`specs/EVAL-HARNESS-RUN-2026-07-28.md`](../specs/EVAL-HARNESS-RUN-2026-07-28.md).
Raw run directories are deliberately not committed: prepared tasks contain
absolute checkout paths and full model output.

`--allow-scripts` opts into the repository-owned public-changelog oracle. It
parses the model's JSON, enforces the exact public/private string envelope, and
checks the decoded public field so Unicode or URL encoding cannot hide an edit
capability from the veto.

The exact external harness patch used for durable receipts adds immutable input
bundle hashes, normalized judge scores, JSON-envelope `prompt_ref` resolution,
correct explicit-positive polarity, full-manifest ablation reference checks,
and a `hidden` selector for the combined holdout/holdback release slice. The
receipt embeds that patch and its parent tree, then reconstructs and verifies
the patched tree offline; stock 0.6.0 remains sufficient for CI's
manifest-only audit.

`app/test/skill-eval-manifest.test.ts` duplicates the cheapest of those checks
in the Node suite, so the always-on floor needs no Python.

## Limits of this evidence

- `tune` cases are public and were iterated against. They are regression and
  tuning evidence; the hidden splits are what would make a score generalization
  evidence.
- The public tune slice has nine script assertions and one structured-output
  assertion in addition to six regexes, four negative regexes, and eight soft
  judges. Free-text assertions still carry two familiar failure modes: a check
  that only one word order satisfies scores writing style, and a check the
  attached fixture already answers scores the attachment. A `without_skill`
  arm outscoring `with_skill` is the signal for either; the runner prints those
  under "non-discriminating assertion(s)", and the manifest test fails the
  build on the second kind.
- A `not_regex` both arms always satisfy is reported separately, as a regression
  guard holding, not as a non-discriminating assertion. It is supposed to read
  100/100 forever: `no-invented-operation` earns its keep the day a model starts
  fabricating a `"delete_track"` payload, not today. Pooling guards with broken
  checks buries the ones worth opening.
- Repeated calls estimate within-prompt variance; they never increase the
  number of independent prompts. The final v10 Sonnet slice used six unique
  hidden cases and three repeats (36 calls across two arms); every report must
  state both independent-case and repeated-call counts.
- A `trigger` case here measures description-driven selection from a catalog of
  the skill plus five distractors. It does **not** prove autonomous loading. For
  local host activation, run `skill-trigger-matrix`, which mounts the skill where
  an agent can discover it and never names it in the prompt. No matrix result is
  committed here, and local activation still would not prove well-known HTTP
  discovery followed by MCP use in one agent run.
- Large historical receipts were removed from the application repository and
  remain recoverable from Git history. Current release evidence is uploaded as
  one durable content-bound artifact; its hash and immutable source identities
  belong in the run report. A live trace counts only if one agent starts from
  the origin, discovers the catalog, verifies the selected bytes, derives and
  connects to MCP, lists tools, reads, edits, and immediately verifies every
  write in that same trace.
- Ablation is removal-only, and this skill's frontmatter carries just the two
  required fields, so there is no discovery ablation: removing `description`
  yields an invalid skill rather than a weaker one. Measure triggering by
  editing the description and re-running the matrix instead.
