# Committed eval receipts

Receipts are sanitized, content-addressed evidence for model and live-execution
runs. Raw working directories still belong in `evals/results/` or a temporary
directory; they can contain absolute paths, provider diagnostics, and live edit
capabilities.

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

The origin-only autonomous discovery receipt uses a stricter journey-specific
format. The same verifier dispatches it through the discovery oracle and checks
the exact prompt and trace hashes, target-MCP non-preconfiguration, successful
correlated protocol chain, capability redaction, and immutable Git source
binding.

`--receipt` fails before making agent calls when the skill, manifest, fixture,
runner, receipt runtime, oracle, or bundled adapter bytes differ from `HEAD`.
The receipt records that commit and tree, SHA-256 and Git blob identity for each
bound input, exact sanitized prompts and outputs, available traces, models,
adapters, and judge transcripts.

Live editable Keyboardia session UUIDs are registered in memory, replaced with
`<redacted-session-id>` in prompts, responses, traces, errors, and state, and
checked again immediately before the receipt is written. The UUIDs and hashes
of the UUIDs are never serialized.

Do not commit receipts for private holdout or holdback prompts: exact prompts
are intentionally part of the receipt. A receipt proves what was evaluated; it
is not a safe container for a secret test set.
