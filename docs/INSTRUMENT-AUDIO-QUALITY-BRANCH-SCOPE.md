# Instrument quality branch scope — 2026-08-22

The audit inspected all 48 GitHub branch heads (47 non-main plus `main`) and
resolved open pull requests independently of branch naming. Eight heads now
have open pull requests.

The final remote-state check used `main` at `58264dd5`, PR 87 at `b58db2e`,
and the Tone Nets PR 98 head at `5b4d82c` on 2026-08-22. GitHub reported eight
open pull requests and four open issues.
At those exact tips, PR 87 differs from `main` only by two specification files.
The Tone Nets head advanced by 14 commits during final verification, opened as
PR 98, and now contains production audio work, detailed below.

| PR | Head | Audio impact |
|---:|---|---|
| 98 | `claude/tone-nets-keyboardia-comparison-vwa218` | Velocity-dependent sampled filtering, new-session reverb, incomplete mobile output/clock wiring, and MediaSession work; validation caveats below |
| 96 | `claude/wal-reset-bug-learnings-ojery3` | Adds correctness/onset-related tests and research; no production DSP, manifest, sample, calibration, or catalogue change |
| 95 | `codex/stack-b-dropdown-visual-pilot` | CSS and visual evidence only |
| 87 | `claude/adsr-handling-1fbpmm` | Envelope overhaul specification only; no implementation |
| 85 | `claude/icon-grip-gear` | Icon/UI only |
| 84 | `agent/sonnet-v11-handoff` | Evaluation documentation only |
| 61 | `claude/keyboardia-evolution-roadmap-oap6n8` | Product/UI specifications and mockups only |
| 58 | `claude/keyboardia-icon-replacement-4pdqvo` | Icon research/documentation only |

Except for PR 98, no open-PR branch changes production audio code, sample bytes,
manifests, source gain, filters, effects, tuning, the sampled registry, or the
99-ID selectable catalogue. All eight open-PR heads retain the same 26 sampled
instruments as `main`. PR 98 changes velocity-dependent sound and new-session
effects, but does not yet carry evidence sufficient for an honest alternate
99-instrument ranking.

PR 98, `claude/tone-nets-keyboardia-comparison-vwa218` at `5b4d82c`, is genuine
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
the two bass headroom failures, or the complete-matrix evidence gap.

The tip's focused/unit/type/manifests tests and aggregate sustain telemetry pass,
but its strict sample audit fails first because the changed slap-bass manifest
no longer matches its bound quality disposition; eight changed anchored
manifests have bound dispositions requiring rebinding. The two newest commits
reference previously dead mobile/clock code and remove the unused sustain
helper, so the dead-export check now passes, but they do not cure the
sample-evidence failure or complete the mobile route. PR 98's CI `Instrument
Validation`, `Stack A Identity`, and `E2E Visual Regression` checks are failing
at this frozen tip; two E2E jobs were still pending, and GitHub reported the PR
as `UNSTABLE`. Its own changelog/spec also overclaims ringer-switch success,
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

## Open ADSR findings on `origin/main`

PR 87 is spec-only, but its shared-engine quality findings remain relevant:

- `advancedSynth.ts` uses `release || 0.5`, so authored zero is lost;
- native and advanced engines use wall-clock timers for voice cleanup instead
  of keeping cleanup entirely on the audio clock;
- XY attack/release ranges disagree with the documented synth limits;
- advanced attack/release overrides are global and ephemeral rather than
  canonical per-track state;
- native, Tone, and sampled paths give different meanings to the same release
  value.

These are cross-instrument envelope-semantics debts on the audited base commit.
The remediation branch now preserves zero release, bounds the documented
controls, moves native and advanced voice retirement to their audio clocks, and
persists the global envelope overrides into engines created later. The control
surface remains deliberately global because the current UI exposes no selected
track identity. Differences between engine envelope curves remain measurable
matrix/listening concerns rather than something to erase with one shared
formula.

No open issue tracks any of the concrete decoded-sample, loop, headroom,
stereo/mono, map-coverage, or full-PCM evidence deficits. Issue 93 and PR 95
cover the Stack B dropdown visual pilot; issues 92, 75, and 97 and PR 96 cover
adjacent MCP, mix-ownership, and property-test work. None is instrument-quality
remediation.
