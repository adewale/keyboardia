# Instrument quality branch scope — 2026-08-18

The audit inspected all 47 GitHub branch heads (46 non-main plus `main`) and
resolved open pull requests independently of branch naming. Exactly seven heads
are genuinely in flight:

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

One dormant, non-PR branch has unique production audio code:
`claude/fix-safari-audio-switching-Vq8zi`. It is 333 commits behind and adds
visibility/interruption context resume behavior. That can prevent silence after
Safari tab switching, but it does not change instrument timbre. Its tip still
contains the retired `rhodes-ep` catalogue and mock-only Safari tests, so it
should be rebased and verified in real WebKit rather than treated as a current
instrument branch or merged wholesale.

Old sample-lab work is patch-equivalent to `main` and its quality tooling has
already been superseded. Thirteen stale, non-open branch tips show old catalogue
snapshots (usually the retired `rhodes-ep` or missing later instruments); none
adds or replaces an audio sample as branch-contributed work.

## Open ADSR findings that still reproduce on main

PR 87 is spec-only, but its shared-engine quality findings remain relevant:

- `advancedSynth.ts` uses `release || 0.5`, so authored zero is lost;
- native and advanced engines use wall-clock timers for voice cleanup instead
  of keeping cleanup entirely on the audio clock;
- XY attack/release ranges disagree with the documented synth limits;
- advanced attack/release overrides are global and ephemeral rather than
  canonical per-track state;
- native, Tone, and sampled paths give different meanings to the same release
  value.

These are cross-instrument envelope-semantics debts. They are listed separately
instead of adding identical points to dozens of instruments without a rendered
per-preset release measurement.

