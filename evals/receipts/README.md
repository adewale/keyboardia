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

