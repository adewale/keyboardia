# Instrument audio quality follow-up — 2026-09-15

This note records the post-rebase decisions that supersede the remaining-work
section of the 2026-08-22 audit. Historical receipts remain immutable and bound
to their recorded commits; new browser evidence must be bound to the final
follow-up commit.

## Resolved in the pull request

| Area | Resolution | Why this is safe |
|---|---|---|
| Post-track headroom | Add a hard-knee, 20:1, -1 dBFS transient ceiling after each track's pan stage and before its metering/master-sum output. | This contains the three hot tracks without lowering their calibrated K-weighted loudness. Simple manifest trims were rejected because the strict audit showed they would create three hard tonal-loudness mismatches. Browser evidence is rerun against the final commit. |
| Final-output peak coverage | Keep the real `userOutput` tap and 4x windowed-sinc inter-sample true-peak gate. The 16-track capture now waits for observable completion of every sampled pack and covers 4.1 seconds (two complete transport cycles plus guard) rather than sleeping for five seconds and capturing 2.1 seconds. | It measures the heard-output topology, including both channels, and removes a timing assumption from the readiness gate. |
| Tone/advanced timing | Pass one absolute AudioContext event timestamp end-to-end. Tone-backed renderers clamp late events against `Tone.immediate()` and never add `Tone.now()` lookahead to an already scheduled event. | Native, sampled, Tone, and advanced renderers now use the same clock contract. Unit tests fail if either engine-to-renderer pass-through or the raw-clock clamp regresses. |
| Progressive loading | Stop workers before advancing an obsolete mapping and recheck lifecycle generation after a queued global slot is granted. | Disposed instruments no longer keep fetching/decode-loading their remaining background queue. |
| Throttled-network budget | Validate all 26 sampled packs against a transfer-only 1.6 Mbps / 150 ms RTT profile, six aggregate requests, <=20 seconds to priority readiness, and <=60 seconds for background transfer. | The slowest current priority set is acoustic crash at 15.26 seconds; the slowest background is steel drums at 45.89 seconds. Decode and scheduler behavior remain covered separately by runtime tests. |

No source audio was transcoded for these changes.

## Deliberately not changed

### Root and velocity coverage

Ten packs still exceed the four-semitone nearest-root target: slap bass (12),
French horn (7), and acoustic guitar, clean guitar, kalimba, piano, marimba,
finger bass, steel pan, and vibraphone (6). Five packs still have one median
velocity layer where their role profile targets two: slap bass, acoustic
guitar, clean guitar, kalimba, and strings.

Those deficits cannot be truthfully cleared by duplicating files, rendering
pitch-shifted copies, or relabelling the same take as multiple dynamics. Such a
change would improve a count while leaving timbre, transitions, and expression
unchanged. The authenticated clean-guitar enrichment candidate did add roots
and layers, but the recorded blinded review rejected it because the reviewer
preferred the current samples. That decision remains authoritative.

Slap bass keeps its declared MIDI 28–72 range. Narrowing the range enough to
clear the root-distance metric would make currently supported edge notes
silent. The preferred remedy is new, listening-approved outer roots and genuine
velocity layers; range reduction remains a product capability decision rather
than an automatic quality repair.

### Source-domain remediation

The retained audit still contains 203 disposition-accepted review findings:
144 pitch, 19 hot lossy peaks, 12 mono-loss, 10 tails, 9 negative phase, 8 DC,
and 1 range finding. They are review debt, not approved edit instructions.

Existing hydrated source audits provide useful provenance and diagnostics, but
the replacement candidates for alto sax, clean guitar, piano, and steel drums
were rejected at the blinded-anchor gate. Other affected packs do not yet have
an authenticated, listening-approved lossless remediation candidate. Therefore
this follow-up does not apply pitch, DC, polarity/phase, tail, or source-peak
processing and does not perform lossy-to-lossy transcoding.

## Candidate issue scope

The remaining work should be one detailed tracking issue, not a claim that this
pull request fixes the source library. Suggested acceptance order:

1. Pin the exact source revision, license, master hash, intended root,
   articulation, channel layout, and tail intent for every affected take.
2. Record a decision for each current decoded finding: repair, replace, or
   retain with listening rationale.
3. Produce pitch/DC/phase/tail/peak repairs only from authenticated lossless
   masters; encode delivery assets once.
4. Add genuine outer roots and velocity layers, then revisit slap bass's range.
5. Rerun strict Node analysis, Chromium and WebKit decode, the complete 1,683
   case range/velocity/articulation matrix, final-output true peak, and
   level-matched blind comparisons.
6. Promote only candidates that pass both objective gates and the recorded
   listening decision; preserve prior rejections unless a new candidate is
   reviewed.

The pull request should reference that issue with `Tracks`, not `Fixes`.
