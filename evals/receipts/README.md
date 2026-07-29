# Committed eval receipts

Receipts are sanitized, content-addressed evidence for model and live-execution
runs. Raw working directories still belong in `evals/results/` or a temporary
directory; they can contain absolute paths, provider diagnostics, and live edit
capabilities.

## Current evidence set

The current Haiku-only evidence set contains five independently verifiable
receipts from 2026-07-29:

- `2026-07-29-haiku-answer-matrix.json`: 60 repeated public-tune answer runs
  across ten cases, both arms, and three repeats;
- `2026-07-29-haiku-live-execution.json`: 18 real MCP state/trace runs across
  three cases, both arms, and three repeats;
- `2026-07-29-haiku-autonomous-1.json`,
  `2026-07-29-haiku-autonomous-2.json`, and
  `2026-07-29-haiku-autonomous-3.json`: three independent passing origin-only
  well-known-discovery-to-verified-edit journeys.

The three Haiku autonomous receipts contain 14, 18, and 13 events. Every run
began with the origin, fetched the standard well-known catalog before any other
network action, fetched and verified the indexed skill, initialized the
same-origin MCP, discovered its tools, and completed a state-changing call with
an immediate post-state read. Older Sonnet and Opus autonomous receipts were
removed because they predated and did not satisfy this corrected catalog-first
contract. A receipt is evidence for the exact recorded sample, not a claim that
every attempt passes.

The Haiku answer receipt binds 60 completed runs with zero missing outputs or
execution errors. Its case-weighted mean objective rate is 98.33% with the
skill and 27.22% without it, a 71.11 percentage-point lift. The raw
assertion-instance tally is 59/60 with the skill and 23/60 without it. One
skilled response kept `send_out_of_range_edit` false but returned the wrong
`valid_indices` shape. The public oracle also accepts fenced JSON where the
skill requires raw JSON, so these figures do not yet establish strict output
reliability.

The Haiku live receipt binds 18 completed MCP runs with zero errors. Whole-case
results were 9/9 with the skill and 6/9 without it; assertion-instance results
were 78/78 and 75/78 respectively. Most live assertions are therefore
non-discriminating and should be treated as protocol-regression coverage, not
strong causal evidence for the skill.

Two 2026-07-28 cross-model answer and live receipts remain as historical
evidence. They are not the release gate for this Haiku-only phase.

The 2026-07-29 Sonnet-first hidden matrix is recorded separately in
[`specs/EVAL-SONNET-FIRST-2026-07-29.md`](../../specs/EVAL-SONNET-FIRST-2026-07-29.md).
It is intentionally not listed as a receipt: the run-aware audit found blockers,
and the current importer rejects blocked evidence instead of preserving it.

Run `node evals/verify-receipts.mjs` to schema-check every receipt, reconstruct
its Git proofs, hash its bound inputs and artifact inventory, replay objective
grading, scan for host paths and live capabilities, and compare the stored
result projections.

Create the provenance implementation in one commit, run the eval from that
clean commit, then commit the generated receipt in a following commit:

```bash
node evals/run-benchmark.mjs --agent stub \
  --out /tmp/keyboardia-run.json \
  --receipt evals/receipts/2026-07-28-stub.json
node evals/verify-receipts.mjs evals/receipts/2026-07-28-stub.json
```

For an external `skill-eval-harness` answer matrix, prepare and execute the
tasks from a clean Keyboardia commit, produce one combined `benchmark.json`,
then import the committed artifact sets:

```bash
node evals/import-harness-receipt.mjs \
  --manifest evals/shared-benchmark.json \
  --tasks /tmp/tasks-claude.jsonl \
  --tasks /tmp/tasks-codex.jsonl \
  --runs /tmp/runs \
  --benchmark /tmp/benchmark.json \
  --audit /tmp/audit.json \
  --harness-repo /path/to/skill-eval-harness \
  --out evals/receipts/2026-07-28-answer-matrix.json
node evals/verify-receipts.mjs \
  evals/receipts/2026-07-28-answer-matrix.json
```

The importer rejects a missing or stale `artifact-commit.json`, any file that
does not match its artifact inventory, incomplete/unscorable benchmark rows,
and any disagreement among the manifest bytes, canonical skill-tree hash,
prepared row, run metadata, or benchmark result. For a locally patched harness,
the receipt embeds the public parent tree and commit bytes, the patched commit,
and the binary patch. Verification reconstructs both Git identities and applies
the patch offline, so a depth-1 or squash checkout does not need old objects.
The receipt embeds the complete sanitized benchmark and audit reports,
independently reconstructs audit counts, findings, and saturation lists, checks
that their aggregate projections agree, and independently regrades every
result from the committed manifest, oracle, task, and output evidence. The
harness version is derived again from the reconstructed `pyproject.toml`.

These hashes provide offline tamper evidence and source closure, not provider
signatures, runtime attestation, or a transparency log.

The origin-only autonomous discovery receipt uses a stricter journey-specific
JSON Schema. The same verifier dispatches it through the discovery oracle and
checks the exact prompt and trace hashes, target-MCP non-preconfiguration,
served catalog and skill bytes, successful correlated protocol chain, immediate
post-state verification after every edit, model/argv correlation, structural
capability redaction including base64 encodings, and self-contained Git source
binding. Receipt creation also checks the bound worktree again immediately
before writing.

`--receipt` fails before making agent calls when the skill, manifest, fixture,
runner, receipt runtime, oracle, or bundled adapter bytes differ from `HEAD`.
The receipt records that commit and tree, SHA-256 and Git blob identity for each
bound input, exact sanitized prompts and outputs, available traces, models,
adapters, and judge transcripts.

Live editable Keyboardia session UUIDs are registered in memory, replaced with
`<redacted-session-id>` in standard receipts or numbered `<redacted-uuid-N>`
tokens in autonomous receipts, and checked again immediately before the receipt
is written. The bounded scanner recursively normalizes percent, Unicode,
base64, and base64url encodings. The UUIDs and hashes of the UUIDs are never
serialized.

Do not commit receipts for private holdout or holdback prompts: exact prompts
are intentionally part of the receipt. A receipt proves what was evaluated; it
is not a safe container for a secret test set.
