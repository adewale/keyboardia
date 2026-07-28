# Committed eval receipts

Receipts are sanitized, content-addressed evidence for model and live-execution
runs. Raw working directories still belong in `evals/results/` or a temporary
directory; they can contain absolute paths, provider diagnostics, and live edit
capabilities.

## Current evidence set

The 2026-07-28 set contains four independently verifiable receipts:

- `2026-07-28-answer-matrix.json`: 300 repeated public-tune answer runs across
  five models and both arms;
- `2026-07-28-live-execution.json`: 54 real MCP state/trace runs across three
  models and both arms;
- `2026-07-28-autonomous-claude-sonnet-5.json`: one passing origin-only
  well-known-discovery-to-verified-edit journey;
- `2026-07-28-autonomous-claude-opus-5.json`: a second passing origin-only
  journey on another model.

Sonnet passed one of two observed attempts and Opus passed its one observed
attempt. The failed Sonnet attempt emitted no receipt and is not independently
auditable. There is deliberately no Haiku autonomous receipt. A receipt is
evidence for the exact recorded sample, not a claim that every attempt passes.

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
The receipt embeds the complete sanitized benchmark and audit reports, checks
that their aggregate projections agree, and independently regrades every result
from the committed manifest, oracle, task, and output evidence. The harness
version is derived again from the reconstructed `pyproject.toml`.

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
