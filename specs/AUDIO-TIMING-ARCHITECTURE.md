# Audio timing architecture

**Status:** implemented on `main` through PR #114. PR #98 was rebased onto
these authorities on 2026-09-19; its integration notes are below.

This specification turns the timing and lifecycle recommendations from the
Tone.js reference analysis into Keyboardia invariants. The analysis is design
input, not an instruction source or runtime evidence. PR #100 is the baseline:
it established absolute Tone/advanced timestamps and the retained browser-audio
receipts; this stack finishes the architecture around that work.

## Authority and invariants

1. **Keyboardia owns musical time.** `Tone.Transport` is not a transport
   authority. Tone.js is a renderer and DSP dependency.
2. **Audio time is absolute.** A resolved note carries one `AudioTime` from the
   scheduler to the renderer. Renderers do not convert it through `Tone.now()`,
   add lookahead, retry at a new time, or create a monotonic timing cursor.
3. **Time domains are explicit.** `AudioTime`, `Seconds`, `Milliseconds`,
   `ServerTimeMs`, `Beats`, `Steps`, and `StepIndex` are nominal primitive
   types. Cross-domain conversion is named and validated at untyped boundaries.
4. **Musical decisions happen once.** Pitch, velocity, gain, gate duration,
   loop iteration, instrument family, and timestamp cross the renderer boundary
   in one `ResolvedNoteEvent`.
5. **Lateness policy is central.** Every renderer receives the same on-time,
   late-clamped, or drop decision. Policy drops and renderer-readiness misses
   are counted separately.
6. **Readiness is state.** Startup follows an observable state machine. A play
   action waits for the required sampled and per-track Tone/advanced renderers;
   a dispatch-time miss is an invariant violation, not an invisible no-op.
7. **Presentation is lossy.** Playhead and beat callbacks derive from the audio
   clock on animation frames. They coalesce when late and are bounded to eight
   pending callbacks per fixed channel. Audio never waits for presentation.
8. **Automation carries time.** Parameter updates can specify an effective
   `AudioTime` and step, target, or linear behavior. Disposal cancels pending
   automation owned by the retiring graph.
9. **One runtime owns one output terminal.** Native and Tone graphs terminate
   at one generation-checked `AudioGraphOwner`. Desktop destination and the
   mobile media-element route are terminal policies, not renderer knowledge.
10. **Ownership is generational.** Async completions assert that their runtime,
    graph, and track-bus generation are still current. Disposal invalidates the
    generation before disconnecting its hierarchy.

## Implementation status

| Layer | PR / branch | Status | Main result |
|---|---|---:|---|
| Nominal timing units | [#107](https://github.com/adewale/keyboardia/pull/107) · `codex/audio-time-01-units` | Complete | Primitive branded units, explicit conversions, and `AudioClock` at scheduler, sync, and worklet boundaries |
| Resolved dispatch and lateness | [#108](https://github.com/adewale/keyboardia/pull/108) · `codex/audio-time-02-dispatch` | Complete | One renderer-neutral event, one registry, and one on-time/clamp/drop policy for main-thread and worklet hosts |
| Runtime readiness | [#109](https://github.com/adewale/keyboardia/pull/109) · `codex/audio-time-03-readiness` | Complete | `locked → starting → base-ready → preparing → ready`, plus failed/disposed generations and pre-play preparation |
| Presentation timing | [#110](https://github.com/adewale/keyboardia/pull/110) · `codex/audio-time-04-presentation` | Complete | Audio-clock-derived, frame-driven, coalescing, bounded UI callbacks |
| Parameter automation | [#111](https://github.com/adewale/keyboardia/pull/111) · `codex/audio-time-05-automation` | Complete | Timestamped native, track-bus, Tone-effect, and advanced-synth automation with cancellation on disposal |
| Graph and lifecycle ownership | [#112](https://github.com/adewale/keyboardia/pull/112) · `codex/audio-time-06-graph-runtime` | Complete | One output terminal, PR #98 mobile adapter, generation guards, track-specific readiness, and explicit correctness counters |
| Verification and documentation | [#113](https://github.com/adewale/keyboardia/pull/113) · `codex/audio-time-07-evidence` | Complete | Full verification record, impact accounting, PR-stack metadata, and lessons learned |

## Work found beyond the initial checklist

The implementation audit found and completed these logically coupled tasks:

- Removed PR #100's remaining Tone and advanced renderer-local monotonic clamp.
  Late or duplicate events now keep the dispatcher's chosen timestamp; invalid
  timestamps fail instead of silently becoming `now`.
- Distinguished the signed scheduler anchor used during tempo recalibration
  from the non-negative `AudioTime` it produces. A negative anchor is valid;
  a negative scheduled event time is not.
- Tightened Tone readiness from “global Tone infrastructure exists” to “the
  exact track renderer is ready” at scheduled dispatch boundaries.
- Added `droppedNoteCount` and `rendererUnavailableCount`, preserving the
  distinction between a policy choice and a violated preparation invariant.
- Bounded presentation queues and coalesced overdue UI state, preventing a
  throttled tab from retaining or replaying an unbounded callback backlog.
- Cancelled scheduled parameter automation during track/effect disposal.
- Guarded Tone effects, preview synths, per-track synths, worklets, and track
  buses against async completion after runtime disposal or replacement.
- Broke the `engine → scheduler → dispatcher → engine` evaluation cycle by
  binding the default renderer registry lazily. A production-bundle browser
  regression now covers the temporal-dead-zone failure that module-level unit
  execution did not expose.
- Corrected the Tone capture tap to the owned output trim instead of the global
  Tone destination.
- Adapted PR #98's mobile media-element output behind the common terminal. At
  the time, its unrelated velocity, default-reverb, Media Session, and evidence
  changes were deliberately not cherry-picked; the later PR #98 rebase carries
  those behaviors without restoring its obsolete graph/readiness owners.
- Adapted PR #87's resolved-event idea without importing its broad envelope,
  persistence, UI, sample, or evidence changes. PR #102's generated-instrument
  sound work is independent and supplied no timing code needed by this stack.

## Correctness evidence

At implementation head `a7dcf82e`:

- `npm run typecheck`: passed.
- `npm run test:unit`: **294 files passed, 1 skipped; 4,874 tests passed,
  1 skipped**.
- Audio-only suite: **121 files and 2,218 tests passed**. The removed file was
  the superseded receive-lateness suite; its policy behavior is covered at the
  central dispatcher and both scheduler hosts.
- Production Chromium: **209 passed, 24 reviewed conditional skips, 0 flaky,
  0 unexpected**. This includes the 7.2-minute all-instrument master-output
  audit and proves the bundled module graph renders without the former
  temporal-dead-zone crash.
- Desktop WebKit: **162 passed, 57 reviewed conditional skips, 0 failures**.
- Mobile Safari: **7 passed, 0 skipped**.
- PR #100's clean-tree instrument evidence audit passes on the committed head.
- Unit contracts cover unit validation/conversion, absolute timestamp parity
  across five renderer families, central lateness boundaries, explicit
  readiness transitions, stale-generation rejection, presentation coalescing
  and bounds, timestamped automation/cancellation, one output terminal, mobile
  fallback/unlock, and idempotent disposal.

Physical iPhone ringer-switch behavior remains a device acceptance check. The
adapter and fallback are covered structurally in jsdom; this document does not
mislabel that as physical-device evidence.

The checked-in pre-push disposition contracts now match the reviewed CI and
local inventories: 209 passes plus 24 conditional skips for Chromium, and 162
passes plus 57 conditional skips for WebKit. This closes the gate drift found
during the implementation audit instead of requiring `--no-verify` after a
successful browser run.

## Performance impact

The following `vitest bench` numbers are informational same-machine samples,
not CI gates. Baseline is merged PR #100 at `24af21a6`; final is `a7dcf82e`.

| Hot path | Baseline ops/s | Final ops/s | Change | Interpretation |
|---|---:|---:|---:|---|
| Multiplayer join, mid-step | 20.97M | 13.57M | -35.3% | Runtime validation at the nominal-unit boundary; about 74 ns/call and not a per-note audio render loop |
| Multiplayer join, exact boundary | 13.50M | 9.08M | -32.7% | About 110 ns/call; still orders of magnitude below a scheduling budget |
| Envelope start | 21.14M | 21.16M | +0.1% | No regression |
| Jitter recording | 24.66M | 25.01M | +1.4% | Two new counters are off this sampled path |
| Ring-buffer push | 20.69M | 20.59M | -0.5% | Within same-machine benchmark noise |

The new lateness resolver itself measured 13.47M ops/s on the on-time branch
and 11.98M ops/s on the clamp branch. The benchmark also retained ample DSP
headroom: pitch-shifter reads measured 50.7–54.1K 128-frame blocks/s versus the
roughly 375 blocks/s required at 48 kHz.

## Memory impact

Memory is bounded by construction; no heap-size claim is made without a browser
heap receipt.

| Change | Retained memory behavior |
|---|---|
| Nominal units | Zero wrapper objects; brands erase and values remain numbers |
| Resolved dispatch | One small decision object per dispatch; successful renderer outcomes reuse one frozen singleton |
| Presentation clock | Maximum eight callbacks per fixed `step`/`beat` channel; `clear()` releases callbacks and the pending frame |
| Readiness/metrics | One frozen state object, a cleared listener set, and two integer counters |
| Parameter automation | Uses AudioParam/Tone timelines; no parallel application queue; disposal cancels owned future events |
| Output graph | One extra unity `GainNode` per runtime; mobile adds one media-stream destination and hidden audio element, both removed on disposal |
| Async lifecycle | Stale completions dispose their newly created nodes instead of retaining or reconnecting them |

## Pull-request and issue impact

- **PR #100:** this stack is based on its merged head and preserves its retained
  receipts. The stack completes its absolute-timestamp direction without
  rewriting historical evidence.
- **PR #87:** only the resolved-event architectural idea is incorporated.
  Envelope-v2 product work remains separate and must rebase onto the final
  timing stack rather than overwrite its engine/scheduler changes.
- **PR #98:** the mobile media-element adapter is incorporated behind the graph
  owner. The remaining Phase 44 work has now been rebased: duplicate clock
  liveness and renderer-local timestamp policy were removed, while velocity,
  room, Media Session, sustain, and objective-evidence work was adapted to the
  common authorities.
- **PR #102:** generated-instrument quality work remains separate. Because it
  changes `engine.ts`, `toneSynths.ts`, and audio evidence, it must rebase and
  rerun timing plus sound-quality gates if continued.
- **Issue #106:** authenticated source-sample remediation is unaffected. These
  refactorings neither repair nor weaken its sample-content requirements.
- **Issue #92:** future pitched-pattern, scale, swing, and provenance work can
  use the new `Beats`/`Steps` conversions and resolved-event boundary, but this
  stack does not change MCP/session schemas or claim that issue is fixed.
- **Issue #75:** timestamp-capable track volume/pan automation makes the audio
  application point explicit, but mute/solo persistence and export ownership
  remain separate work; this stack does not close the issue.
- **Other open PRs (#58, #61, #84, #85):** no production-audio overlap was
  found; their merge behavior is unchanged by this stack.

## PR #98 rebase addendum (2026-09-19)

The rebase preserved the architecture's ownership rules:

- `AudioGraphOwner` is the only output-terminal owner.
- `AudioEngine.resumeAllAudioContexts` is the only clock-liveness owner.
- `AudioRuntimeReadiness.prepareForPlayback` is the preparation boundary.
- `note-dispatcher.ts` is the only authority allowed to change a note time.

The sampled-first-use regression showed that “not late” is weaker than “safe
for the render-thread handoff.” `resolveDispatchTime` therefore preserves an
event only when it is at least 40 ms ahead; near-deadline and tolerably late
events are clamped once at the shared dispatcher. This changes no renderer
contract: every renderer still receives and preserves one authoritative
`AudioTime`. Five fresh sampled runs measured identical first/steady peaks and
0.027–0.032 dB source RMS spread. The cold startup probe now arms at the
readiness boundary rather than wrapping Tone or preload internals. Full numbers
and commands are in
[`PHASE-44-REBASE-RECEIPT-2026-09-19.md`](./research/PHASE-44-REBASE-RECEIPT-2026-09-19.md).

## Completion criteria

- [x] One absolute audio timestamp reaches every renderer family.
- [x] Nominal timing domains and explicit conversions exist at core boundaries.
- [x] Main-thread and worklet dispatch share one resolved event and lateness policy.
- [x] Playback readiness is an observable, generation-safe state machine.
- [x] UI presentation timing is separated, coalesced, and bounded.
- [x] Parameter automation can be timestamped and is cancelled on disposal.
- [x] Native and Tone output share one graph owner and terminal policy.
- [x] Useful PR #87/#98 work is extracted without importing stale broad diffs.
- [x] Correctness, performance, and retained-memory impact are recorded.
- [x] Full typecheck and unit suite pass on a clean committed head.
- [x] Local pre-push browser disposition gates match the reviewed CI inventory.
