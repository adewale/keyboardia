# Instrument audio quality follow-up — 2026-09-15

This note records the post-rebase decisions that supersede the remaining-work
section of the 2026-08-22 audit. Historical receipts remain immutable and bound
to their recorded commits; new browser evidence must be bound to the final
audio implementation commit.

## Resolved in the pull request

| Area | Resolution | Why this is safe |
|---|---|---|
| Post-track headroom | Add a hard-knee, 20:1, -2 dBFS dynamics stage after each track's pan stage, followed by a -1.139863 dB trim that cancels Chromium's automatic compressor makeup. A final linear-below-threshold WaveShaper after `outputGain` enforces an exact -1 dBFS sample ceiling before the metering/master-sum output. | The rendered bypass comparison measures -0.000000052 dB quiet-signal gain, so ordinary tracks retain unity. Four 3x/10x one-sample probes at 44.1/48 kHz reach exactly -1 dBFS. Both 99-instrument runs contain zero post-track peaks above that ceiling. The verified tradeoff from the dynamics stage remains deliberate compression of the three formerly hot primary fixtures: finger bass -3.46 dB RMS, kalimba -1.78 dB, and slap bass -3.22 dB. Simple manifest trims were rejected because the strict audit showed they would create three hard tonal-loudness mismatches. |
| Final-output peak coverage | Keep the real `userOutput` tap and 4x windowed-sinc inter-sample true-peak gate. The 16-track capture now waits for observable completion of every sampled pack and covers 4.1 seconds (two complete transport cycles plus guard) rather than sleeping for five seconds and capturing 2.1 seconds. | It measures the heard-output topology, including both channels, and removes a timing assumption from the readiness gate. The final exact-head run is -0.424 dBTP even though its pre-compressor sum reaches +6.47 dBFS. |
| Tone/advanced timing | Pass one absolute AudioContext event timestamp end-to-end. Tone-backed renderers clamp late events against `Tone.immediate()` and never add `Tone.now()` lookahead to an already scheduled event. Advanced presets are selected during prewarm and are not redundantly rebuilt on every note dispatch. | Native, sampled, Tone, and advanced renderers use the same clock contract. Unit tests fail if engine-to-renderer pass-through, the raw-clock clamp, prewarmed preset selection, the no-rebuild hot path, or an on-time injected 100 ms renderer offset regresses. The schema-v12 browser receipt retains the main-thread AudioContext snapshot for diagnosis, enqueues an AudioParam marker immediately before production renderer invocation, and observes that marker and output onset on the audio-render clock. It preserves signed schedule-to-control-dispatch, schedule-to-marker, and raw schedule-to-output diagnostics, while applying the -10/+80 ms gate only to output onset minus the later of scheduled event and render-thread marker. That measures renderer latency after the audio thread observes dispatch and still rejects an early release tail. It does not claim to reject every schedule-relative 100 ms error if the marker itself reaches rendering late. Removing repeated graph mutation is an objective hot-path simplification, not a claim that it was the proven cause of the one intermittent tremolo-strings spike. |
| Progressive loading | Stop workers before advancing an obsolete mapping, recheck lifecycle generation after a queued global slot is granted, service foreground roots before queued background work, and reserve one of six aggregate slots for new manifests/priority roots. | Disposed instruments no longer keep fetching/decode-loading their remaining background queue, and one large pack can no longer starve a newly selected instrument. |
| Throttled-network readiness | Keep a cheap transfer-size gate for all 26 sampled packs and add a cold-cache Chromium run at 1.6 Mbps / 150 ms RTT, including browser fetch, decode, manifest latency, and contention. | The static worst cases are acoustic crash priority at 15.26 seconds and steel drums background at 46.79 seconds. In the real contention fixture, Hammond is priority-ready in 2.21 seconds and finishes background in 42.05 seconds; acoustic guitar becomes priority-ready in 8.22 seconds while Hammond is transferring and finishes background in 33.72 seconds. The whole scenario completes in 44.27 seconds. |

No source audio was transcoded for these changes.

## Evidence

The final measured implementation and evidence subject is
`fe7cdfab78766ab429e461ad08a35f22ec43ac69`. The timing producer was first
hardened at `462cb1e7351ff293b41c8e8b6c1527c8cf1b47a7` after a CI trace showed
that a single delayed audio-worklet arm acknowledgement could add 5,632
unrelated frames to the old measurement origin. An Astra audit then
demonstrated that a replacement relative start marker could hide a real late
onset if delivery of that marker were itself delayed, so the retained schema
never rebases or discards onset frames that precede its dispatch marker.

A later schema-v10 CI run reported a 4,711-frame raw scheduled-event-to-output
interval for `rim`. That receipt could not distinguish shared scheduler
lateness from renderer-added latency, so increasing the ceiling would have
weakened the historical 100 ms regression gate. Schema v11 instead binds the
scheduled event, actual production-dispatch frame, output-onset frame, and all
three derived intervals. The failed schema-v10 observation is evidence of the
old measurement ambiguity; by itself it does not prove where the delay arose.

The first schema-v11 CI run then reported 5,654 frames from the main-thread
dispatch snapshot to `tone:metal-cymbal` output onset. That result exceeded the
3,528-frame ceiling, but it could not distinguish main-thread preemption,
control-message delivery, or renderer work. Schema v12 retains that snapshot
and independently binds it, but enforcement uses the pre-renderer AudioParam
marker and output onset observed by the same worklet clock. Astra found no
simpler ordering mechanism with the same property. The accepted claim is
deliberately narrower: the gate constrains latency after the later of the
scheduled event and audio-thread-observed dispatch. An explicit on-time 100 ms
regression test continues to cover the historical Tone offset.

The first CI run of that timing-evidence head also exposed one intermittent
`advanced:tremolo-strings` post-track sample at 1.30525 despite stable isolated
reruns near 0.277. Trace inspection proved that the production dispatch and
capture isolation were correct, but did not prove the transient's exact source.
The final subject therefore retains the compressor for transparent programme
control, removes redundant per-note preset graph mutation, and adds an explicit
last-node sample ceiling instead of treating `DynamicsCompressorNode` as a hard
limiter. Astra independently checked the placement and found no simpler equally
robust containment.

- Chromium and WebKit each decode all 605 mappings across 582 delivery files:
  [Chromium](evidence/browser-decode-chromium-fe7cdfa.json) and
  [WebKit](evidence/browser-decode-webkit-fe7cdfa.json).
- Independent [primary](evidence/candidate-live-primary-fe7cdfa.json) and
  [confirmation](evidence/candidate-live-confirmation-fe7cdfa.json) runs each
  contain 99 audible isolated instruments, no post-track peak above -1 dBFS,
  and a renderer-reference-to-output-onset span of 288–472 frames at 48 kHz
  (6.0–9.83 ms). The main-thread-snapshot-to-render-marker diagnostic spans
  0–128 frames. The signed schedule-to-marker diagnostic spans -7,104 to
  -3,008 frames across both runs, recording the intentional 62.7–148 ms
  scheduler lookahead rather than treating it as renderer latency. The
  renderer interval leaves more than 70 ms before the pinned upper bound and
  more than 90 ms before the historical extra lookahead.
- The [TrackBus dynamics render](evidence/track-bus-dynamics-fe7cdfa.json)
  measures -0.000000052 dB below-threshold gain, -1.77 dBFS for its continuous
  overload probe, and exactly -1 dBFS for 3x/10x sample impulses at both 44.1
  and 48 kHz.
- The [16-track capacity capture](evidence/browser-capacity-capture-fe7cdfa.json)
  measures -0.424 dBTP at the heard output. The
  [master-chain canary](evidence/browser-master-capture-fe7cdfa.json) retains
  synchronized pre-compressor, post-makeup, and user-output taps.
- The [throttled readiness receipt](evidence/sample-load-network-readiness-fe7cdfa.json)
  records all 30 cold-cache lossless-file/manifest requests: Hammond reaches
  priority in 2.21 seconds and finishes in 42.05 seconds; contending acoustic
  guitar reaches priority in 8.22 seconds and finishes in 33.72 seconds; the
  complete scenario takes 44.27 seconds.
- The [strict decoded receipt](evidence/candidate-sample-quality-fe7cdfa.json)
  covers 26 instruments, 605 mappings, and 582 files, with 203
  disposition-accepted findings and zero unwaived errors or review flags.
- The regenerated [primary ranking](evidence/candidate-instrument-quality-primary-fe7cdfa.json)
  and [confirmation ranking](evidence/candidate-instrument-quality-confirmation-fe7cdfa.json)
  retain identical priority bands and remediation decisions.

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
