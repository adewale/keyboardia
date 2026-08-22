# Instrument quality branch scope — 2026-08-22

The audit inspected all available GitHub branch heads and resolved open pull
requests independently of branch naming. The final remote check on 2026-08-22
found nine open pull requests and three open issues.

That check used `main` at `58264dd5`, PR 87 at `8f995a7`, PR 98 at `5d02fe1`,
and the then-remote remediation PR 100 at `ed8ad28` (the final local evaluated
subject is `553398b`). Both audio-adjacent branches advanced
materially while this audit was running: PR 87 is now a 210-file production
envelope implementation, while PR 98 has repaired its previously stale bound
sample disposition and Stack A contract. Their current overlap and sequencing
requirements are detailed below.

At that snapshot PR 87 was `CLEAN` with 13/13 checks passing. PR 98 was
`UNSTABLE` with only visual regression failing. PR 100's remote head was ten
local commits behind and its only failing check was the stale Linux sample
disposition audit; the local fix canonicalizes only disposition identity to six
decimal places, keeps raw metrics/thresholds unchanged, and passed the same
strict audit under Linux Node 24. The pushed-head status must be checked again
before merge.

| PR | Head | Audio impact |
|---:|---|---|
| 100 | `codex/audio-quality-remediation` | This objective-audio remediation and evaluator PR; audit findings and remaining work are reported in its description |
| 99 | `codex/sitewide-text-colour-safety` | Sample-picker CSS/text-colour safety; explicitly no musical/audio behavior change |
| 98 | `claude/tone-nets-keyboardia-comparison-vwa218` | Velocity-dependent sampled filtering, new-session reverb, incomplete mobile output/clock wiring, and MediaSession work; validation caveats below |
| 96 | `claude/wal-reset-bug-learnings-ojery3` | Adds correctness/onset-related tests and research; no production DSP, manifest, sample, calibration, or catalogue change |
| 87 | `claude/adsr-handling-1fbpmm` | Production envelope-v2 runtime, persistence, UI, MCP, MIDI/notation, migration, and tests; conflicts and evidence caveats below |
| 85 | `claude/icon-grip-gear` | Icon/UI only |
| 84 | `agent/sonnet-v11-handoff` | Evaluation documentation only |
| 61 | `claude/keyboardia-evolution-roadmap-oap6n8` | Product/UI specifications and mockups only |
| 58 | `claude/keyboardia-icon-replacement-4pdqvo` | Icon research/documentation only |

Apart from PRs 87, 98, and 100, no open-PR branch changes production audio code,
sample bytes, manifests, source gain, filters, effects, tuning, the sampled
registry, or the 99-ID selectable catalogue. PR 87 changes envelope behavior;
PR 98 changes velocity-dependent sound and new-session effects. Neither has yet
been rebased onto PR 100's authoritative sample replacements and hardened
evidence contracts, so neither carries evidence sufficient for an honest
alternate 99-instrument ranking on the combined tree.

PR 98, `claude/tone-nets-keyboardia-comparison-vwa218` at `5d02fe1`, is genuine
in-progress sound and mobile-runtime work:

- `sampled-instrument.ts` creates a per-voice low-pass for notes below MIDI 90;
  nine manifests carry solver-derived cutoff anchors targeting roughly 30%
  soft-note centroid reduction; the only shipped-sample render covers slap bass
  and accepts a broader 15–50% reduction;
- new sessions default to 15% reverb wet while legacy sessions remain dry;
- scheduler paths update `navigator.mediaSession.playbackState`;
- an aggregate median raw-file-duration sustain guard supplies regression
  telemetry, but does not prove every mapped note sustains past two seconds
  because it ignores playback-rate shortening and manifest offsets (reported
  minima include 0.80 s for vibraphone and 1.96 s for finger bass);
- mobile media-output and clock-liveness modules are now referenced by the
  native engine path, but production graph and readiness behavior remain
  incomplete.

The mobile route does not yet establish its claimed end-to-end behavior. Tone
effects initialization disconnects `masterGain` from the newly routed native
chain and sends its own output directly to the AudioContext destination, so the
normal initialized graph bypasses the hidden media element. The gesture handler
can also return for an already-running context before unlocking that element.
The clock helper reports success immediately whenever the starting clock is
nonzero, and a detected failure is logged without blocking playback. Physical
iPhone ringer-switch and latency tests are still absent.

That branch now tackles the independently observed amplitude-only velocity
limitation, but its pack classification is not yet reliable: the analysis
infers layers from filename suffixes rather than manifest velocity ranges, so
finger bass (four mapped layers), steel pan (five zones), and French horn (two
layers) receive anchors despite the implementation comment saying layered
instruments are untouched. The render regression exercises only slap bass, and
the solver samples the first six alphabetically sorted files per pack rather
than the complete map. The branch does **not** add genuine velocity layers, new
roots, or sample bytes; it bypasses the filter at the canonical MIDI-90 lane
used by the v1 ranking, and it does not repair any of the 203 decoded findings,
the three post-track headroom priorities, or the complete-matrix evidence gap.

The tip's focused/unit/type/manifests tests and aggregate sustain telemetry pass.
Its latest commits rebind the slap-bass disposition and restore the Stack A
new-session contract, so `Instrument Validation` and `Stack A Identity` now
pass. `E2E Visual Regression` remains red, and GitHub still reports the PR as
`UNSTABLE`. The dead-export check also passes, but those corrections do not
complete the mobile route. Its own changelog/spec still overclaims ringer-switch success,
per-note sustain, and untouched layered instruments. The filter and
default-reverb changes alter sound and therefore still need corrected all-map
measurement, rebound dispositions, the pinned velocity/full-matrix capture,
and level-matched listening before integration. It is correctly classified as
an in-progress adjacent repair, not a completed quality fix.

One other dormant, non-PR branch has unique production audio code:
`claude/fix-safari-audio-switching-Vq8zi`. It is 333 commits behind and adds
visibility/interruption context resume behavior. That can prevent silence after
Safari tab switching, but it does not change instrument timbre. Its tip still
contains the retired `rhodes-ep` catalogue and mock-only Safari tests, so it
was not merged wholesale. The current remediation branch reimplements the
relevant recovery behavior on current `main`, adds parked-clock and stale Tone
context gates, and fails closed when existing Tone nodes cannot be migrated.

Old sample-lab work is patch-equivalent to `main` and its quality tooling has
already been superseded. Thirteen stale, non-open branch tips show old catalogue
snapshots (usually the retired `rhodes-ep` or missing later instruments); none
adds or replaces an audio sample as branch-contributed work.

## PR 87 envelope implementation and overlap

PR 87 is no longer specification-only. At `8f995a7` it implements envelope-v2
semantics, canonical state and migration, runtime/UI/MCP/MIDI/notation support,
and a large regression suite. It directly tackles several shared-engine
findings originally reproduced on `origin/main`:

- `advancedSynth.ts` uses `release || 0.5`, so authored zero is lost;
- native and advanced engines use wall-clock timers for voice cleanup instead
  of keeping cleanup entirely on the audio clock;
- XY attack/release ranges disagree with the documented synth limits;
- advanced attack/release overrides are global and ephemeral rather than
  canonical per-track state;
- native, Tone, and sampled paths give different meanings to the same release
  value.

PR 87 and PR 100 now overlap in eleven files. A current three-way simulation
has no textual conflict markers, but the Hammond manifest and shared
engine/control paths require semantic reconciliation. PR 87 was built on the
old Hammond MP3 catalogue and old loop coordinates; it also lacks PR 100's
stale-Tone-context fail-closed recovery, bounded growl modulation, and intrinsic
zero procedural-envelope gain that removes the measured one-frame boundary
leak. Its resource evidence pins the old 582-file byte total. Taking either
side wholesale would therefore regress the other.

The safe sequence is: merge PR 100 first, then rebase PR 87 and retain both
sets of focused regressions, translate sustained-Hammond loop state to the new
WAV coordinates, and regenerate all resource and evaluator evidence. PR 98
should follow the same ordering: re-solve its acoustic filter anchor against
the replacement asset, rebind manifests under the current baseline schema, and
resolve its concrete French-horn-manifest, sample-baseline, and engine conflicts
semantically. Differences between
engine envelope curves remain measurable matrix/listening concerns rather than
something to erase with one shared formula.

No open issue tracks any of the concrete decoded-sample, headroom,
stereo/mono, map-coverage, scheduling-offset, listening, or full-PCM evidence
deficits. Issues 92, 75, and 97 and PR 96 cover adjacent MCP,
mix-ownership, and property-test work. None is instrument-quality remediation.
A detailed umbrella issue is therefore warranted after PR 100 is stable.
