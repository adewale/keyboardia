# Envelope v2 Final Multi-Agent Audit

**Date:** 2026-08-03  
**Scope:** all six implementation slices at the 2026-08-03 audit revision;
the 2026-08-22 release-profile follow-up is recorded below  
**Disposition:** 19 P1/P2 findings reproduced and fixed; no unresolved P0-P2 finding

Three independent reviewers audited the integrated implementation from their
own domain. Their conclusions were reconciled only after each review completed.
The rows below are the durable finding ledger; a finding is closed only by code
and an executable regression, not by reviewer agreement.

| Reviewer | Finding | Resolution and evidence |
|---|---|---|
| State/protocol | A v2 edit made during reconnect could stop at local dispatch before the transport queued it. | Capability negotiation now fails closed and preserves known-v2 reconnect behavior; pre-negotiation edits cannot be optimistically applied or lost. Focused hook/transport tests cover the boundary. |
| State/protocol | MCP legacy/reset operations emitted only the legacy event, so a v2 browser could diverge. | MCP emits the compatible legacy and canonical v2 events together; conversion uses the same clamped reporting path as browser edits. |
| State/protocol | Envelope XY remained available against a Worker without `track-envelope-v2`. | The preset and all XY envelope mutations are capability-gated and downgrade safely when capability disappears. |
| State/protocol | Rejected operation IDs were not remembered, so retries could be evaluated differently. | Rejections are durably cached and replayed idempotently by the live session. |
| State/protocol | Automatic state repairs were warnings without structured counts. | Repair telemetry includes counts and explicit `auto_repaired` warnings. |
| Product/test | Model/unit conversion could clamp without reporting the changed stage. | Reducer, Worker, and MCP conversions share the reporting converter; authoritative responses include `clampedStages`. |
| Product/test | Display units could remain stale after an envelope conversion. | Editor display state synchronizes to the converted model while preserving the user's milliseconds/seconds preference. |
| Product/test | The old-Worker UI gate did not cover every XY entry point. | All envelope XY selection, display, and mutation paths are disabled or downgraded together. |
| Product/test | “Selected track” XY behavior did not actually follow keyboard/pointer track focus. | Track pointer and keyboard interactions dispatch `FOCUS_TRACK`; XY targets that canonical selection. |
| Product/test | The transactional editor had cancel but no user undo. | A bounded envelope history supports Ctrl/Cmd+Z across slider, XY, and conversion commits, with rejection cleanup and remote-conflict protection. |
| Product/test | Drag previews updated geometry but not sound. | Editor and XY drafts audition through the local audio reconciler without broadcast; the final value is still one network transaction per drag. |
| Product/test | Server rejections were not announced accessibly. | Warning/error toasts use the existing accessible announcement surface. |
| Audio/timing | Native authored ADSR still used the legacy response curve and imprecise zero/release handling. | Canonical authored envelopes use linear attack/decay, exact zero, analytic early release, and the shared release epsilon/guard. |
| Audio/timing | Tone finite AD/AHD voices lost the hold phase and incorrectly reacted to note-off. | Finite lifecycle scheduling owns the entire attack/hold/decay shape and ignores note-off as required by trigger semantics. |
| Audio/timing | Sample envelope model and playback mode were validated independently, permitting impossible pairs or silent rewrites. | Capability validation now accepts/rejects model-mode pairs atomically. |
| Audio/timing | An unsupported retained playback override could become active behavior. | Unsupported authored state remains round-trippable but inactive; playback uses the truthful preset fallback. |
| Audio/timing | Envelope epsilon differed across implementations and treated zero inconsistently. | The shared convention is `0.0001`, including explicit zero handling. |
| Audio/timing | A zero-frame loop could be approved without matching evidence. | Zero-frame loop use requires an explicit, matching approval record. |
| Audio/timing | The PCM gate asserted configuration without rendering representative audio. | Fixed pad and acid canaries render deterministic native/candidate PCM and compare peak, RMS, tail, centroid, and clipping metrics. |

## Integrated verification

- Full unit: 252 files passed, one intentionally skipped; 4,687 tests passed.
- Envelope semantic/PCM/rolling: 72 / 11 / 229 tests passed.
- Built Worker integration: 10 files, 135 tests passed.
- Focused envelope browser: 3 Chromium tests passed.
- Full-stack desktop smoke: 15 Chromium tests passed.
- Full-stack mobile: 7 mobile-Safari-profile tests passed.
- TypeScript app and Worker builds, ESLint, test-quality, sync, docs,
  inventories, resource policy, production build, and Worker bundle ratchet pass.
- Worker upload is 3,488,558 bytes under the unchanged 3.5 MB ratchet; the
  checker now clears only its disposable output so stale hashed assets cannot
  create a false failure.
- Production assets remain 223 audio files / 13,761,117 bytes. Gzipped
  JavaScript is 306,804 bytes, +24,604 bytes (+8.72%) from the recorded base.

## Evidence that cannot be manufactured locally

This audit closes implementation findings. It does not pretend to supply the
external T3 facts required to promote renderer or asset cohorts: the complete
32-preset release matrix, two independent listening approvals, deployed canary
telemetry, a rollback drill, and one retained production release cycle. Those
gates remain fail-closed in the migration manifest.

## 2026-08-22 release-profile follow-up

The follow-up closed the audit's remaining distinction between structurally
correct adapters and direct release-profile evidence. It added editor-disabled
runtime/notation coverage, exact publish/remix state-and-hash comparison,
authored `release: 0.3` and zero-release tests for native, real Tone Web Audio,
advanced adapters, and managed samples, plus named correctness lanes in CI.

The broad real-Worker collaboration run then found a cross-feature UI collision:
the envelope launcher reused the Pattern Tools class and occupied the same fixed
grid cell. The implementation now exposes one Track Tools launcher and places
the envelope entry inside its panel. The 19-test pattern/multiplayer spec and the
complete 73-test collaboration inventory pass after the repair.

Updated executable evidence is 253 full-unit files / 4,694 passing tests, 263
focused correctness tests, two editor-disabled/real-Tone browser contracts,
three focused editor contracts, 135 built integrations, 15 desktop smoke tests,
seven mobile Safari tests, and 73 serial collaboration tests. The current
resource measurement is 223 audio files / 13,761,117 bytes and 306,851 gzipped
JavaScript bytes (+8.74% from baseline). No audio asset was added. The external
T3 boundaries above remain unchanged.
