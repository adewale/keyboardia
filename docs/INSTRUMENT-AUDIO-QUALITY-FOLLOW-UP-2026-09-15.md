# Instrument audio quality follow-up — 2026-09-15

This note records the post-rebase decisions that supersede the remaining-work
section of the 2026-08-22 audit. Historical receipts remain immutable and bound
to their recorded commits; new browser evidence must be bound to the final
audio implementation commit.

## Resolved in the pull request

| Area | Resolution | Why this is safe |
|---|---|---|
| Post-track headroom | Add a hard-knee, 20:1, -2 dBFS transient ceiling after each track's pan stage and before its metering/master-sum output, followed by a -1.139863 dB trim that cancels Chromium's automatic compressor makeup. | The rendered bypass comparison measures +0.000002 dB quiet-signal gain, so ordinary tracks retain unity. The verified tradeoff is deliberate compression of the three formerly hot primary fixtures: finger bass -3.46 dB RMS, kalimba -1.78 dB, and slap bass -3.22 dB. Simple manifest trims were rejected because the strict audit showed they would create three hard tonal-loudness mismatches. |
| Final-output peak coverage | Keep the real `userOutput` tap and 4x windowed-sinc inter-sample true-peak gate. The 16-track capture now waits for observable completion of every sampled pack and covers 4.1 seconds (two complete transport cycles plus guard) rather than sleeping for five seconds and capturing 2.1 seconds. | It measures the heard-output topology, including both channels, and removes a timing assumption from the readiness gate. |
| Tone/advanced timing | Pass one absolute AudioContext event timestamp end-to-end. Tone-backed renderers clamp late events against `Tone.immediate()` and never add `Tone.now()` lookahead to an already scheduled event. | Native, sampled, Tone, and advanced renderers now use the same clock contract. Unit tests fail if either engine-to-renderer pass-through or the raw-clock clamp regresses; the schema-v8 browser receipt allows at most 80 ms beyond its scheduled 0.5-second onset, excluding the historical extra 100 ms. |
| Progressive loading | Stop workers before advancing an obsolete mapping, recheck lifecycle generation after a queued global slot is granted, service foreground roots before queued background work, and reserve one of six aggregate slots for new manifests/priority roots. | Disposed instruments no longer keep fetching/decode-loading their remaining background queue, and one large pack can no longer starve a newly selected instrument. |
| Throttled-network readiness | Keep a cheap transfer-size gate for all 26 sampled packs and add a cold-cache Chromium run at 1.6 Mbps / 150 ms RTT, including browser fetch, decode, manifest latency, and contention. | The static worst cases are acoustic crash priority at 15.26 seconds and steel drums background at 46.79 seconds. In the real contention fixture, Hammond is priority-ready in 2.20 seconds and finishes background in 42.04 seconds; acoustic guitar becomes priority-ready in 8.23 seconds while Hammond is transferring and finishes background in 33.72 seconds. The whole scenario completes in 44.25 seconds. |

No source audio was transcoded for these changes.

## Evidence for implementation commit `d8f6e39753b8daa2b1d0ff5e15a9920c4d2f2b78`

- Chromium and WebKit each decode all 605 mappings across 582 delivery files:
  [Chromium](evidence/browser-decode-chromium-d8f6e39.json) and
  [WebKit](evidence/browser-decode-webkit-d8f6e39.json).
- Independent [primary](evidence/candidate-live-primary-d8f6e39.json) and
  [confirmation](evidence/candidate-live-confirmation-d8f6e39.json) runs each
  contain 99 audible isolated instruments, no post-track peak above full scale,
  and a worst arm-to-onset value of 25,569 frames at 48 kHz (532.69 ms).
- The [TrackBus dynamics render](evidence/track-bus-dynamics-d8f6e39.json)
  measures +0.000002 dB below-threshold gain and -1.77 dBFS for its overload
  probe.
- The [16-track capacity capture](evidence/browser-capacity-capture-d8f6e39.json)
  measures -0.419 dBTP at the heard output. The
  [master-chain canary](evidence/browser-master-capture-d8f6e39.json) retains
  synchronized pre-compressor, post-makeup, and user-output taps.
- The [throttled readiness receipt](evidence/sample-load-network-readiness-d8f6e39.json)
  records all 30 cold-cache lossless-file/manifest requests and the foreground
  contention timings above.
- The [strict decoded receipt](evidence/candidate-sample-quality-d8f6e39.json)
  covers 26 instruments, 605 mappings, and 582 files, with 203
  disposition-accepted findings and zero unwaived errors or review flags.

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

## Tracked remaining work

The remaining work is tracked in
[#106](https://github.com/adewale/keyboardia/issues/106), rather than claimed as
fixed by this pull request. Suggested acceptance order:

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

The pull request references that issue with `Tracks`, not `Fixes`.
