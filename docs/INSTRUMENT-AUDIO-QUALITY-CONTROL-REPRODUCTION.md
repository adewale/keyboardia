# Reconstructing the instrument-quality control

The controlled before/after claim is reproducible without either historical
synthetic commit named by the 2026-08-22 snapshot. The reconstruction tool
creates fresh compatibility commits from Git objects that must exist locally,
captures both sides under one committed evaluator lane, and retains every raw
receipt used to calculate the difference.

## Claim boundary

This is a same-evaluator technical comparison. It measures the decoded sample
findings, deterministic priority score, and one continuous post-track Chromium
capture for every catalogue instrument. It is not listening evidence and does
not fill the 1,683-case dry-PCM matrix gap.

The control keeps the selected base revision's production assets, manifests,
runtime DSP, source calibration, catalogue, dependency lock, and build
configuration. It overlays only the declared audit/scoring/receipt producers,
with two visible exceptions:

- `src/audio/sample-onset.ts` supplies the hardened evaluator API. Base
  manifests and base runtime call sites keep their original default 30 ms
  behavior; the resulting compatibility commit is never labelled as the
  literal base commit.
- `src/test/audio-measures.ts` is evaluator-only measurement code.

The tool rejects any future overlay entry under a preserved subject path unless
it is one of those exact exceptions. The guard has unit coverage.

## Reproduce

Prerequisites are a clean candidate/evaluator commit, installed `app/node_modules`,
and Playwright's bundled Chromium. The command uses only local Git objects; it
does not fetch or install dependencies. Inspect the exact plan first:

```sh
cd app
npm run audit:instrument-quality:control -- --plan \
  --base-ref 58264dd5ae274f63b1cd80b72aa823b76b21f28b \
  --evaluator-ref HEAD
```

Then choose a new or empty durable output directory:

```sh
npm run audit:instrument-quality:control -- \
  --base-ref 58264dd5ae274f63b1cd80b72aa823b76b21f28b \
  --evaluator-ref HEAD \
  --output-dir ../instrument-quality-controlled-rebuild
```

For both `control/` and `candidate/`, the output retains:

- the strict decoded-sample JSON and Markdown receipt;
- the 99-instrument continuous Chromium live receipt and Playwright diagnostics;
- the machine-readable and Markdown stack-ranked audit;
- the exact sample-quality baseline used by the decoded receipt.

`controlled-comparison.json` is derived from those files. It records the
resolved base, candidate/evaluator, and newly created compatibility commits,
the overlay plan hash, every raw artifact path and SHA-256, aggregate values,
issue-code totals, nonzero instrument scores, and candidate-minus-control
deltas. The script verifies that each ranking binds its raw sample/live hashes
and that each decoded receipt binds the retained baseline before emitting the
summary.

The temporary clones are created with `mkdtemp` and removed only after an exact
path/prefix safety check. Use `--keep-temp` only for diagnosis. Output
directories are never cleared or overwritten: a non-empty directory fails
closed.

## Historical snapshot

[`instrument-audio-quality-controlled-comparison-2026-08-22.json`](./evidence/instrument-audio-quality-controlled-comparison-2026-08-22.json)
is the retained summary of the original run. Its vanished compatibility commit
IDs and summary-only hashes are historical metadata, not prerequisites and not
the strongest reproducibility evidence. After the evaluator is frozen, publish
the newly reconstructed directory or its CI artifact and use its hash-bound raw
receipts for the final numerical claim.
