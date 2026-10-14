# Sonnet v11 evaluation execution handoff — 2026-07-31

## Purpose

This is the canonical execution handoff for the frozen Keyboardia Sonnet v11
evaluation. It supersedes the operational status, identities, commands, and
blockers in `specs/EVAL-SONNET-FIRST-2026-07-29.md`; that document remains useful
for rationale and history.

The executor must produce:

1. 48 complete Sonnet answer observations: 8 independent cases, 2 arms, and 3
   repeats.
2. Deterministic benchmark and run-aware audit reports for both private splits.
3. One source-bound answer-matrix receipt that verifies offline.
4. One fresh production-origin autonomous receipt proving the entire discovery,
   MCP, read, edit, and verification journey as one correlated trace.
5. A durable, content-addressed evidence upload and a short results report.

At handoff creation, the only known external blocker is Claude authentication on
the original machine: `claude auth status` reports `loggedIn: false`. Authenticate
and make one non-evaluation provider probe before starting the matrix.

## Frozen identities

Do not silently substitute newer source or harness bytes. A deliberate update to
either identity creates a new evaluation slice and requires regenerating tasks.

| Component | Frozen identity |
| --- | --- |
| Source repository | `https://github.com/adewale/keyboardia.git` |
| Evaluation source commit | `f2a3c98600f88719237fcb46ebc785f8071f4272` |
| Evaluation source tree | `5da2ecae26f386240bcbf2625529b1bb2b21ded2` |
| Harness repository | `https://github.com/adewale/skill-eval-harness.git` |
| Harness commit | `3bed306ecc27df8f4966c6b697ce0fabfaa4980e` |
| Harness tree | `edc2f1cd0f3b860ad2af352d78ced4e175f621d5` |
| Harness package version | `0.6.0` |
| Model | `claude-sonnet-5` |
| Manifest version and size | version 2; 78 cases |
| Harness manifest revision | `3e2d04f5af285ff25fee97102e6b62f6b7d5f46c36c6e82f7089ba9f90cfb49c` |
| Skilled-arm tree hash | `0fca787dbb6481728ad1b1697efe708f16f6af7a4024d547cda6261b06db6b34` |

The principal committed input hashes at that source tree are:

| Input | SHA-256 |
| --- | --- |
| `evals/shared-benchmark.json` | `15db66af03f21b2a307925c94a0db1157c8fdbb07c5f42906f06eeef5ac77eea` |
| `evals/answer-matrix-policy.json` | `bc6182e4bd2d503da1085457ea0e1dbf7c1d16f95f8d4513947abc2e78bda978` |
| `evals/oracles/hidden-v11-answer.mjs` | `f22842ad99b91aa416edf139bdb3eebcd390fbe21723f204fa1afb152ff87168` |
| `evals/fixtures/keyboardia-mcp-schema.json` | `a097b1b5af04c495c6351eac6ce3247245557d1f5a6c620292bc8ed6c1b4751f` |
| `app/public/.well-known/agent-skills/collaborate-in-keyboardia/SKILL.md` | `8a3049e6f0f4eb43e6978ccc97c7dd28a8ee2a266820929f8f8739ea64339bbd` |
| `app/public/.well-known/agent-skills/index.json` | `7f29755586ccd64db19cd192058833a7299c8a8584a5d757b3b9cd8db414fa1e` |

The source identity is current `main` after MCP directory publication PR #82.
It was refreshed before any v11 answer was generated because that PR changed
the MCP runtime fixture. Durable receipts bind both the commit and tree. The
source and harness worktrees must remain completely clean throughout a run; the
receipt code rejects tracked or untracked changes.

This handoff file itself is not in the frozen evaluation source commit. Read it
first, then execute from a separate clean checkout of that commit. If working in
the original checkout, commit or move this handoff before switching commits so
it does not remain as an untracked file and invalidate the receipt.

## Frozen evaluation design

`evals/answer-matrix-policy.json` is the machine-checked policy:

- splits: `holdout`, `holdback`
- repeats: 3
- models: `claude-sonnet-5`
- variants: `with_skill`, `without_skill`

The five holdout cases are:

- `holdout-v11-discovery-contract`
- `holdout-v11-ack-verification`
- `holdout-v11-private-handoff`
- `holdout-v11-uncertain-steps`
- `holdout-v11-fresh-owned-track`

The three holdback cases are:

- `holdback-v11-redact-existing`
- `holdback-v11-track-limit-partial`
- `holdback-v11-publish-source-secrecy`

These are 8 independent prompts and 48 calls, not 48 independent cases. Failed
provider calls, authentication failures, timeouts, and incomplete observations
are not scores.

## Private inputs

The eight prompt files are intentionally ignored by Git. Transfer them through a
secure channel and place them at the manifest's `prompt_ref` paths. Never commit
them. Verify their exact bytes before preparing tasks:

```text
699c281ca1e100beb35c347e4985e3c4c649cd9d8cd3dec2d264c8057ffab58b  evals/holdout/v11-discovery-contract.json
51e51197d1ab85e6019b74d88b1f264a5a725db3949af814759ff95655aa0192  evals/holdout/v11-ack-verification.json
430c143ef68c5ec880f7ffa717036f9fa0af3d1ce77f1539c22f117214e47d82  evals/holdout/v11-private-handoff.json
809477e5866deef2e1db4111a49226ca08b071fbea99286b2dd09ab3b6e94627  evals/holdout/v11-uncertain-steps.json
77de3af32fc2a2bf0e61e3b87e37c0b96d1070835d5e208352310400feaa65b6  evals/holdout/v11-fresh-owned-track.json
92d4f0617a04172102e8102b560e3aabce9061e0af405b078b2323307a57c2e6  evals/holdback/v11-redact-existing.json
f89f338d480cea3401b959b6baeac0158fa3e4231a256a324803012af6a2cecb  evals/holdback/v11-track-limit-partial.json
5e09d5a1f4b7e2970e967d5218a5ff04b1cce95d738c60bcd2cccc718e217a23  evals/holdback/v11-publish-source-secrecy.json
```

Run this check from the source root:

```bash
shasum -a 256 \
  evals/holdout/v11-discovery-contract.json \
  evals/holdout/v11-ack-verification.json \
  evals/holdout/v11-private-handoff.json \
  evals/holdout/v11-uncertain-steps.json \
  evals/holdout/v11-fresh-owned-track.json \
  evals/holdback/v11-redact-existing.json \
  evals/holdback/v11-track-limit-partial.json \
  evals/holdback/v11-publish-source-secrecy.json
```

The original machine also has frozen prepared tasks:

| File | Rows | SHA-256 |
| --- | ---: | --- |
| `/private/tmp/keyboardia-v11-sonnet-holdout-tasks-f2a3c98.jsonl` | 30 | `149d14d25f5f347436fd2df2ce3fed3b7b1d82fb384099e2b335e2fd20009e21` |
| `/private/tmp/keyboardia-v11-sonnet-holdback-tasks-f2a3c98.jsonl` | 18 | `91d5a8e9ffa1bc63ed0d656cdad6a52dbcfe86694a56f3798b4a9170b1fdf9b7` |

Those task hashes are portable only when the repository remains at
`/Users/adewale/Documents/Codex/2026-07-26/when-was-the-last-time-we`, because
each row embeds the absolute source root. On another machine, regenerate the
tasks using the commands below. The row counts, case identities, contract
hashes, prompt hashes, source hashes, and skilled-arm hash must still match.

## Normative discovery and MCP contract

Do not collapse all authority into “the MCP documentation.” Three authorities
apply in order:

1. The Cloudflare Agent Skills Discovery RFC governs the HTTP journey before
   MCP: the fixed well-known catalog, the recognized v0.2 `$schema` identifier,
   unique `name` and `type` selection, raw skill bytes, redirects, and digest
   verification. The schema URL is an opaque version identifier, not an
   instruction to fetch and trust arbitrary remote schema content.
2. The final versioned MCP specification governs the `/mcp` wire protocol. For
   version `2026-07-28`, the trace must prove `server/discover`; a legacy
   `initialize` exchange is not an acceptable substitute.
3. SDK documentation describes an implementation. A helper called `connect()`
   may issue `server/discover`, but the receipt must name and validate the wire
   operation rather than treating an SDK method name as normative protocol.

The production autonomous receipt must prove this exact continuous sequence:

```text
origin
→ /.well-known/agent-skills/index.json
→ exact $schema check
→ unique name/type selection
→ raw SKILL.md bytes
→ SHA-256 digest verification
→ same-origin /mcp
→ server/discover for 2026-07-28
→ tools/list with exactly seven canonical tools
→ create_session
→ get_session
→ edit_session
→ get_session
→ edit_session
→ get_session
```

Separate HTTP and MCP smokes are useful preflights, but they do not replace this
one correlated agent trace.

## Execution rules

- Freeze the skill, catalog, manifest, matrix policy, fixture, oracle, adapters,
  runner, receipt code, private prompts, and harness before the first v11 model
  answer is generated.
- Do not inspect answer bodies or benchmark results, edit the skill, or tune an
  oracle between holdout and holdback. Operational metadata may be checked only
  to confirm provider completeness.
- Use a new empty output root. Never write a retry over an earlier run tree.
- If any scheduled call is incomplete, preserve that attempt as negative
  operational evidence, create a new empty root, and rerun the entire frozen
  48-call matrix without changing inputs.
- Do not count provider failures as observations or assign them failing answer
  scores.
- Do not reveal editable Keyboardia capabilities in reports or public artifacts.
- Do not publish, remix, or export the production session created by the
  autonomous trace.
- Grading, auditing, importing, and offline receipt verification do not call a
  model. Only the provider probe, the 48 answer calls, and the autonomous trace
  call Sonnet.

## 1. Establish clean source and harness checkouts

The following paths are the known original-machine locations. On another
machine, set them to the clean clones prepared for this run.

```bash
export KEYBOARDIA_REPO=/Users/adewale/Documents/Codex/2026-07-26/when-was-the-last-time-we
export KEYBOARDIA_HARNESS=/Users/adewale/Documents/Codex/2026-07-29/h/work/skill-eval-harness
cd "$KEYBOARDIA_REPO"

test "$(git rev-parse HEAD)" = f2a3c98600f88719237fcb46ebc785f8071f4272
test "$(git rev-parse HEAD^{tree})" = 5da2ecae26f386240bcbf2625529b1bb2b21ded2
test -z "$(git status --porcelain --untracked-files=all)"

test "$(git -C "$KEYBOARDIA_HARNESS" rev-parse HEAD)" = 3bed306ecc27df8f4966c6b697ce0fabfaa4980e
test "$(git -C "$KEYBOARDIA_HARNESS" rev-parse HEAD^{tree})" = edc2f1cd0f3b860ad2af352d78ced4e175f621d5
test -z "$(git -C "$KEYBOARDIA_HARNESS" status --porcelain --untracked-files=all)"
```

If the harness environment is absent, create it inside the ignored `.venv`
directory without changing harness source:

```bash
python3 -m venv "$KEYBOARDIA_HARNESS/.venv"
"$KEYBOARDIA_HARNESS/.venv/bin/pip" install -e "$KEYBOARDIA_HARNESS"
```

## 2. Authenticate and probe Sonnet

```bash
claude auth status
claude auth login
claude auth status
claude -p --model claude-sonnet-5 --output-format json \
  --no-session-persistence "Reply with PROVIDER_READY."
```

Do not continue unless the final status reports `loggedIn: true` and the probe
returns a non-error response with non-zero token usage. The probe is an
operational check, not a v11 observation.

## 3. Create a new evidence root and run structural preflight

Choose a unique path and do not reuse it:

```bash
export KEYBOARDIA_EVAL_ROOT=/private/tmp/keyboardia-sonnet-v11-run-001
test ! -e "$KEYBOARDIA_EVAL_ROOT"
mkdir -p "$KEYBOARDIA_EVAL_ROOT"

"$KEYBOARDIA_HARNESS/.venv/bin/python" \
  "$KEYBOARDIA_HARNESS/skill_benchmark.py" \
  validate evals/shared-benchmark.json \
  --strict-holdback --strict-leakage --check-ablations

"$KEYBOARDIA_HARNESS/.venv/bin/python" \
  "$KEYBOARDIA_HARNESS/skill_benchmark.py" \
  audit-manifest evals/shared-benchmark.json \
  --format json \
  --out "$KEYBOARDIA_EVAL_ROOT/pre-run-audit.json" \
  --fail-on-blockers
```

Expected preflight: 78 cases, 2 materialized ablations, zero findings, and zero
blockers. Stop on any difference.

## 4. Prepare and verify the 48-task population

```bash
"$KEYBOARDIA_HARNESS/.venv/bin/python" \
  "$KEYBOARDIA_HARNESS/skill_benchmark.py" \
  prepare evals/shared-benchmark.json \
  --split holdout --runs-per-variant 3 --models claude-sonnet-5 \
  --out "$KEYBOARDIA_EVAL_ROOT/holdout-tasks.jsonl"

"$KEYBOARDIA_HARNESS/.venv/bin/python" \
  "$KEYBOARDIA_HARNESS/skill_benchmark.py" \
  prepare evals/shared-benchmark.json \
  --split holdback --runs-per-variant 3 --models claude-sonnet-5 \
  --out "$KEYBOARDIA_EVAL_ROOT/holdback-tasks.jsonl"

jq -s -e '
  length == 30 and
  all(.[];
    .split == "holdout" and
    .model == "claude-sonnet-5" and
    (.run_number == 1 or .run_number == 2 or .run_number == 3) and
    (.variant == "with_skill" or .variant == "without_skill") and
    .eval_contract_sha256 == "sha256:b95f9efec6f3cdabe631f553480e4c80aceda6552729b6884c16d099f31c6ebd") and
  ([.[].skill_tree_hash] | unique | sort) ==
    [null, "0fca787dbb6481728ad1b1697efe708f16f6af7a4024d547cda6261b06db6b34"]
' "$KEYBOARDIA_EVAL_ROOT/holdout-tasks.jsonl"

jq -s -e '
  length == 18 and
  all(.[];
    .split == "holdback" and
    .model == "claude-sonnet-5" and
    (.run_number == 1 or .run_number == 2 or .run_number == 3) and
    (.variant == "with_skill" or .variant == "without_skill") and
    .eval_contract_sha256 == "sha256:0a2a3847d0842f4aad6f750ce28b290af3c4f12cb7f3aa7d3187ffe2d05c6e9e") and
  ([.[].skill_tree_hash] | unique | sort) ==
    [null, "0fca787dbb6481728ad1b1697efe708f16f6af7a4024d547cda6261b06db6b34"]
' "$KEYBOARDIA_EVAL_ROOT/holdback-tasks.jsonl"

shasum -a 256 \
  "$KEYBOARDIA_EVAL_ROOT/holdout-tasks.jsonl" \
  "$KEYBOARDIA_EVAL_ROOT/holdback-tasks.jsonl"
```

At the original absolute source path, the last command must reproduce the two
frozen task hashes above byte-for-byte. Elsewhere, record the path-dependent task
hashes and rely on the exact source, prompt, contract, row, case, variant, repeat,
model, and skill-tree checks.

Do not add `--include-answer-key`. Generation tasks must not contain expected
behavior or review rubrics.

## 5. Generate answers

The pinned `run-claude` runner emits the full Claude stream so process assertions
have tool-use trajectory evidence. Run both splits into the same new runs root:

```bash
"$KEYBOARDIA_HARNESS/.venv/bin/python" \
  "$KEYBOARDIA_HARNESS/skill_benchmark.py" \
  run-claude \
  --tasks "$KEYBOARDIA_EVAL_ROOT/holdout-tasks.jsonl" \
  --runs "$KEYBOARDIA_EVAL_ROOT/runs" \
  --model claude-sonnet-5 --timeout 1800
```

The runner can exit zero even when the provider returned failures. Check only
operational metadata before starting holdback; do not open answer bodies:

```bash
find "$KEYBOARDIA_EVAL_ROOT/runs" -name metadata.json -print0 \
  | xargs -0 jq -s -e '
      length == 30 and
      all(.[];
        .returncode == 0 and
        .timed_out == false and
        .provider_response_complete == true and
        .observation_complete == true and
        .total_tokens > 0)
    '
```

Stop and quarantine the entire attempt if this fails. Otherwise run holdback:

```bash
"$KEYBOARDIA_HARNESS/.venv/bin/python" \
  "$KEYBOARDIA_HARNESS/skill_benchmark.py" \
  run-claude \
  --tasks "$KEYBOARDIA_EVAL_ROOT/holdback-tasks.jsonl" \
  --runs "$KEYBOARDIA_EVAL_ROOT/runs" \
  --model claude-sonnet-5 --timeout 1800

find "$KEYBOARDIA_EVAL_ROOT/runs" -name metadata.json -print0 \
  | xargs -0 jq -s -e '
      length == 48 and
      all(.[];
        .returncode == 0 and
        .timed_out == false and
        .provider_response_complete == true and
        .observation_complete == true and
        .total_tokens > 0)
    '
```

Do not proceed with a partial population.

## 6. Grade and run split-aware audits

The pinned harness has separate `holdout` and `holdback` selectors, not a
combined `hidden` selector. Produce two ordered report pairs:

```bash
"$KEYBOARDIA_HARNESS/.venv/bin/python" \
  "$KEYBOARDIA_HARNESS/skill_benchmark.py" \
  benchmark evals/shared-benchmark.json \
  --runs "$KEYBOARDIA_EVAL_ROOT/runs" \
  --split holdout --allow-scripts \
  --out "$KEYBOARDIA_EVAL_ROOT/holdout-benchmark.json"

"$KEYBOARDIA_HARNESS/.venv/bin/python" \
  "$KEYBOARDIA_HARNESS/skill_benchmark.py" \
  audit-manifest evals/shared-benchmark.json \
  --runs "$KEYBOARDIA_EVAL_ROOT/runs" \
  --split holdout --format json --fail-on-blockers \
  --out "$KEYBOARDIA_EVAL_ROOT/holdout-audit.json"

"$KEYBOARDIA_HARNESS/.venv/bin/python" \
  "$KEYBOARDIA_HARNESS/skill_benchmark.py" \
  benchmark evals/shared-benchmark.json \
  --runs "$KEYBOARDIA_EVAL_ROOT/runs" \
  --split holdback --allow-scripts \
  --out "$KEYBOARDIA_EVAL_ROOT/holdback-benchmark.json"

"$KEYBOARDIA_HARNESS/.venv/bin/python" \
  "$KEYBOARDIA_HARNESS/skill_benchmark.py" \
  audit-manifest evals/shared-benchmark.json \
  --runs "$KEYBOARDIA_EVAL_ROOT/runs" \
  --split holdback --format json --fail-on-blockers \
  --out "$KEYBOARDIA_EVAL_ROOT/holdback-audit.json"
```

Preserve bad results. Do not edit v11 prompts, the skill, or the oracle to make a
failed confirmation slice pass. If changes are warranted, report v11 honestly,
retire exposed cases to `tune`, and design a newly frozen v12 slice.

## 7. Import and verify the answer-matrix receipt

The importer accepts repeated task files and one audit for each benchmark in the
same order. It independently rejects an incomplete policy matrix, modified
artifacts, mismatched prompts, source drift, and harness drift.

```bash
node evals/import-harness-receipt.mjs \
  --manifest evals/shared-benchmark.json \
  --tasks "$KEYBOARDIA_EVAL_ROOT/holdout-tasks.jsonl" \
  --tasks "$KEYBOARDIA_EVAL_ROOT/holdback-tasks.jsonl" \
  --runs "$KEYBOARDIA_EVAL_ROOT/runs" \
  --benchmark "$KEYBOARDIA_EVAL_ROOT/holdout-benchmark.json" \
  --audit "$KEYBOARDIA_EVAL_ROOT/holdout-audit.json" \
  --benchmark "$KEYBOARDIA_EVAL_ROOT/holdback-benchmark.json" \
  --audit "$KEYBOARDIA_EVAL_ROOT/holdback-audit.json" \
  --harness-repo "$KEYBOARDIA_HARNESS" \
  --out "$KEYBOARDIA_EVAL_ROOT/sonnet-v11-answer-matrix-receipt.json"

node evals/verify-receipts.mjs \
  "$KEYBOARDIA_EVAL_ROOT/sonnet-v11-answer-matrix-receipt.json"
```

## 8. Run the fresh production continuous trace

First confirm that production discovery and MCP smokes pass. These are
preflights, not the release trace:

```bash
cd "$KEYBOARDIA_REPO/app"
npm run smoke:skills:production
npm run smoke:mcp:production
cd "$KEYBOARDIA_REPO"
```

Then run one origin-only Sonnet journey against production. `--skip-build` is
correct for an explicit remote origin:

```bash
node app/scripts/run-autonomous-discovery.mjs \
  --model claude-sonnet-5 \
  --origin https://keyboardia.dev \
  --skip-build --timeout 600 \
  --out "$KEYBOARDIA_EVAL_ROOT/sonnet-v11-production-autonomous-receipt.json"

node evals/verify-receipts.mjs \
  "$KEYBOARDIA_EVAL_ROOT/sonnet-v11-production-autonomous-receipt.json"
```

The validator, not a prose summary, decides whether the continuous trace meets
the normative sequence. A 200 response from the catalog and a separate MCP
smoke do not compensate for a failed autonomous receipt.

## 9. Preserve and report evidence

Create a digest inventory only after both receipts verify:

```bash
shasum -a 256 \
  "$KEYBOARDIA_EVAL_ROOT/holdout-tasks.jsonl" \
  "$KEYBOARDIA_EVAL_ROOT/holdback-tasks.jsonl" \
  "$KEYBOARDIA_EVAL_ROOT/holdout-benchmark.json" \
  "$KEYBOARDIA_EVAL_ROOT/holdout-audit.json" \
  "$KEYBOARDIA_EVAL_ROOT/holdback-benchmark.json" \
  "$KEYBOARDIA_EVAL_ROOT/holdback-audit.json" \
  "$KEYBOARDIA_EVAL_ROOT/sonnet-v11-answer-matrix-receipt.json" \
  "$KEYBOARDIA_EVAL_ROOT/sonnet-v11-production-autonomous-receipt.json"
```

Upload the evidence root to durable, access-controlled storage retained for at
least as long as the release it gates. The answer receipt embeds resolved hidden
prompts. Publishing it publicly exposes and therefore retires those prompts;
prefer publishing its digest and run metadata while keeping the receipt in
controlled storage. If the requester has not supplied an authorized durable
storage target, stop after local verification and report the paths and hashes;
do not improvise a public upload.

The results report must include:

- source commit and tree
- harness repository, version, commit, tree, and patch binding
- manifest, matrix-policy, oracle, fixture, skill, catalog, private-prompt, task,
  report, and receipt hashes
- 8 independent cases, 48 scheduled calls, and 48 complete observations
- per-split and per-arm pass counts and rates, lift, repeated-run variability,
  tokens, provider-reported cost, and elapsed time
- every audit finding and blocker, including saturation or no-lift findings
- answer and autonomous receipt hashes plus durable artifact location
- explicit confirmation that both receipts verify offline
- the limitation that provider identity, token, and billing fields are provider
  metadata rather than signed attestations

## Completion and release decision

Execution is complete only when all of the following hold:

- exact source, harness, and private-input identities were used
- all 48 answer observations are complete and individually bound
- both deterministic benchmarks and both run-aware audits were produced
- the combined answer receipt verifies offline
- production smokes pass
- the fresh production autonomous receipt verifies the exact continuous trace
- evidence is stored durably and its digest is recorded

Any source or harness drift, incomplete provider observation, prompt mutation,
audit blocker, receipt verification failure, production discovery/MCP failure, or
continuous-trace failure is release-blocking. Preserve the evidence and report
the failure; do not turn it into a passing claim by narrowing the population or
reinterpreting missing observations.
