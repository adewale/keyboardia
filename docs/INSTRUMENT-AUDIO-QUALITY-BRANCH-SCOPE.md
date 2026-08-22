# Instrument quality branch scope — 2026-08-22

The audit inspected all 48 GitHub branch heads (47 non-main plus `main`) and
resolved open pull requests independently of branch naming. Exactly seven heads
are genuinely in flight:

The final remote-state check used `main` at `58264dd5`, PR 87 at `b58db2e`,
and the unsubmitted Tone Nets head at `9c61012` on 2026-08-22. GitHub still
reported seven open pull requests and four open issues.
At those exact tips, PR 87 differs from `main` only by two specification files;
the Tone Nets head changes scripts, tests, test budgets, and specifications but
no file under the production audio implementation or shipped instrument assets.

| PR | Head | Audio impact |
|---:|---|---|
| 96 | `claude/wal-reset-bug-learnings-ojery3` | Adds correctness/onset-related tests and research; no production DSP, manifest, sample, calibration, or catalogue change |
| 95 | `codex/stack-b-dropdown-visual-pilot` | CSS and visual evidence only |
| 87 | `claude/adsr-handling-1fbpmm` | Envelope overhaul specification only; no implementation |
| 85 | `claude/icon-grip-gear` | Icon/UI only |
| 84 | `agent/sonnet-v11-handoff` | Evaluation documentation only |
| 61 | `claude/keyboardia-evolution-roadmap-oap6n8` | Product/UI specifications and mockups only |
| 58 | `claude/keyboardia-icon-replacement-4pdqvo` | Icon research/documentation only |

No open branch changes production audio code, sample bytes, manifests, source
gain, filters, effects, tuning, the sampled registry, or the 99-ID selectable
catalogue. All seven open heads have the same 26 sampled-instrument set as
`main`. Therefore the stack ranking is evaluated once against current `main`;
there is no honest branch-specific alternate ranking to report.

The additional post-audit head
`claude/tone-nets-keyboardia-comparison-vwa218` has no pull request. Its latest
tip adds two read-only sample-analysis/simulation scripts, a proposed Phase 44
sound-change plan, comparison research, and test-runner budget changes. It
measures the amplitude-only velocity limitation and simulates a possible
velocity filter, while explicitly labelling the proposed sound changes as not
achieved. It contains no production DSP change, audio byte, manifest change,
or completed capture/listening evidence. It is useful diagnosis and proposed
work, not an in-progress repair of the shipped instruments.

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
stereo/mono, map-coverage, or full-PCM evidence deficits. Issues 92, 75, and 97
and PR 96 are adjacent scheduler/mix/MCP work, not instrument-quality
remediation.
