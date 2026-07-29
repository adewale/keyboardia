# Evaluation receipt policy

Do not commit large model transcripts to the application repository. Historical
receipts removed in July 2026 remain recoverable from Git history; keeping 39 MiB
of generated evidence in every clone obscured the product change under review.

For a release-gating run, upload one receipt as a durable CI or pull-request
artifact and record its SHA-256, source commit, source tree, skill digest,
manifest digest, harness commit, models, case counts, and artifact URL in the
run report. Retain the artifact for at least as long as the release it gates.
The receipt is immutable evidence for those exact bytes, not for later edits.

`node evals/verify-receipts.mjs PATH...` verifies downloaded receipts offline.
With no paths it verifies any explicitly committed `*.json` receipts, if
present. A blocked audit is valid negative evidence: verification reconstructs
its counts, findings, and readiness instead of rejecting the blocker merely for
existing.

The answer-matrix importer accepts repeated report pairs, so a policy spanning
holdout and holdback is preserved in one receipt:

```bash
node evals/import-harness-receipt.mjs \
  --manifest evals/shared-benchmark.json \
  --tasks /tmp/tasks.jsonl \
  --runs /tmp/runs \
  --benchmark /tmp/holdout-benchmark.json \
  --audit /tmp/holdout-audit.json \
  --benchmark /tmp/holdback-benchmark.json \
  --audit /tmp/holdback-audit.json \
  --harness-repo /path/to/skill-eval-harness \
  --out /tmp/keyboardia-sonnet-receipt.json
```

Never claim that repeated runs increase the number of independent prompts.
Report both unique-case count and calls. Once hidden outputs are inspected or a
self-contained receipt exposes their prompts, retire those cases to `tune` and
author a fresh hidden slice before the next release gate.

Hashes provide offline tamper evidence and source closure. They are not provider
signatures, runtime attestation, or a transparency log.
