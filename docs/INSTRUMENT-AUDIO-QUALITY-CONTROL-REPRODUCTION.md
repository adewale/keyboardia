# Reconstructing the instrument-quality control

The controlled before/after method is reproducible without relying on a
historical synthetic commit. The reconstruction tool
creates fresh compatibility commits from Git objects that must exist locally,
captures both sides under one committed evaluator lane, and retains every raw
receipt used to calculate the difference. Each side's live lane is captured
twice in separate Playwright processes. Both captures are audited, retained,
and hash-bound; a structural, classification, or derived-decision mismatch
fails the comparison rather than averaging the captures or selecting the more
favorable one. A completed capture is not automatically a valid comparison:
if either side is unstable, the command exits without publishing a delta.

## Claim boundary

This is a same-evaluator technical comparison. It measures the decoded sample
findings, deterministic priority score, and two-run decision-stable continuous
post-track Chromium captures for every catalogue instrument. It is not
listening evidence and does not fill the 1,683-case dry-PCM matrix gap. Two
successful runs show observed decision stability in one environment; they do
not establish PCM identity or a statistical confidence interval.

Both receipts in a lane must independently pass the committed live-receipt
validator. They must then match exactly on schema, claim, subject provenance,
browser identity/version/user agent, sample rates, capture/schedule/random
contracts, diagnostics, session execution and membership, capture geometry,
RNG traces, observed engine dispatches, and UI/track-bus isolation evidence.
Raw session and track IDs are normalized to catalogue IDs for that comparison.

Track and master peak/RMS values may differ by at most **0.5 dB per
instrument and metric**. This prospective bound is a conservative evaluator-
stability alarm, not a PCM-determinism tolerance or statistical validation.
Silence and above-zero-dBFS classifications must still match exactly. Each raw
receipt is then audited separately, and the two derived decision projections
must match exactly on rank, ID, score, band, evidence grade, score components,
improvements, silence, and above-zero classification. Display-only raw dB and
category-delta values are deliberately excluded only after those decisions
have been recomputed. The emitted summary reports the observed maximum spread
for peak, RMS, master peak, and master RMS in each lane.

The only permitted volatile differences are fresh timestamps and raw
session/track IDs plus arm-to-onset timing that remains inside the validator's
pinned bounds. Arm timing is not averaged and does not enter the score. No raw
energy value or ranking from either run is averaged, discarded, or selected as
more favorable.

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
- both independently captured 99-instrument Chromium live receipts and their
  separate Playwright diagnostics (`live-master-output.json` and
  `live-confirmation/live-master-output.json`);
- both machine-readable and Markdown stack-ranked audits
  (`instrument-quality.json` / `INSTRUMENT-QUALITY.md` at the lane root and in
  `live-confirmation/`);
- the exact sample-quality baseline used by the decoded receipt.

`controlled-comparison.json` is derived from those files. It records the
resolved base, candidate/evaluator, and newly created compatibility commits,
the overlay plan hash, both raw live-receipt paths and SHA-256 values, both
ranking paths and SHA-256 values, every other raw artifact path and hash,
observed per-lane energy spreads, aggregate values, issue-code totals, nonzero
instrument scores, and candidate-minus-control deltas. The schema-v4 claim is
emitted only after both control captures and both candidate captures satisfy
the two-run decision-stability gate. The script also verifies that each ranking
binds its corresponding raw sample/live hashes and that each decoded receipt
binds the retained baseline before emitting the summary.

The temporary clones are created with `mkdtemp` and removed only after an exact
path/prefix safety check. Use `--keep-temp` only for diagnosis. Output
directories are never cleared or overwritten: a non-empty directory fails
closed.

## Retained 2026-08-22 result

[`instrument-audio-quality-controlled-comparison-2026-08-22.json`](./evidence/instrument-audio-quality-controlled-comparison-2026-08-22.json)
binds the raw receipts from the frozen candidate and the reconstructed
original-main control. The candidate passes the two-run decision-stability
gate: its largest per-instrument energy spread is 0.338 dB, and all 99 derived
decisions are identical.

The control does not pass. Its two otherwise valid 99-instrument captures
measure `noise` peaks of 0.344035 and 0.217525, a 3.982 dB difference against
the prospective 0.5 dB alarm. Identical RNG call counts and one-frame onset
movement do not justify discarding either result. The command therefore stopped
before producing an aggregate control-to-candidate score delta.

The decoded lane is independent of that live instability and remains directly
comparable under the same evaluator: 256 findings on original-main scored paths
and 203 on the candidate, a reduction of 53 (20.7%). The two control live
receipts, two candidate live receipts, both candidate rankings, both decoded
receipts, and reconstruction plan are retained under `docs/evidence/` with
SHA-256 bindings. An overall repair-priority percentage is deliberately not
claimed.
