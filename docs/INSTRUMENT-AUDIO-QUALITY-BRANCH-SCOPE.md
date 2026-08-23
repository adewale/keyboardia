# Instrument quality branch scope — 2026-08-22

The audit inspected all available GitHub branch heads and resolved open pull
requests independently of branch naming. The remote refresh on 2026-08-23
found eight open pull requests and three open issues.

That check used `main` at `702ad0c`, PR 87 at `8f995a7`, PR 98 at `6028265f`,
and the then-remote remediation PR 100 at the stale `a1355fb6`; the final clean
measured PR 100 subject is `fb6c341`. Both audio-adjacent PRs are production
implementations, not research-only branches, and their current overlap and
sequencing requirements are detailed below.

At the snapshot PR 87 was `CLEAN` with 13/13 checks passing. PR 98 had just
advanced again and was `UNSTABLE`: ten checks were green, E2E Visual Regression
was red, and two E2E jobs were still running. PR 100's remote checks were for
an obsolete head and
do not validate this report; the final pushed-head Actions run is the merge
gate. Locally, only decoder-derived measurements receive an absolute
`0.000001` comparison tolerance against the stored value. Thresholds, metadata,
counts, mappings, and hashes remain exact. A Noble arm64 container running the
official linux-x64 Node 24.19 binary under emulation passed the formerly fragile
piano/alto subset; this is x64 Node/V8 arithmetic evidence, not a full native
amd64 Ubuntu result.

| PR | Head | Audio impact |
|---:|---|---|
| 100 | `codex/audio-quality-remediation` | This objective-audio remediation and evaluator PR; audit findings and remaining work are reported in its description |
| 98 | `claude/tone-nets-keyboardia-comparison-vwa218` | Velocity-dependent sampled filtering, new-session reverb, mobile output/clock and MediaSession work; newly advanced tip and validation caveats below |
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

PR 98, `claude/tone-nets-keyboardia-comparison-vwa218` at `6028265f`, is a
54-file production sound/mobile branch that advanced repeatedly during this audit.
Its latest scope says it now:

- routes native and Tone master chains through one mobile media-element
  terminal and retries media unlock independently of `AudioContext.state`;
- derives velocity structure from manifest mappings rather than filename
  suffixes, excludes recorded-layer instruments, and calibrates six gain-only
  tonal instruments per playable note at 44.1/48 kHz;
- applies velocity-dependent filtering below velocity 90, while keeping the
  high-velocity path transparent;
- gives new sessions 15% reverb while preserving legacy-session behavior; and
- adds MediaSession, sustain, mapping-receipt, demo-route, and visual contracts.

Those changes supersede defects reported against its earlier `5d02fe1` tip;
this report does not repeat those stale findings as if they still applied. Its
mobile terminal routing and running-context unlock now have production wiring,
but clock-liveness failure still warns and continues in initialization and
`ensureAudioReady`, while another unlock path does not check it. Calling that a
readiness gate remains stronger than the implementation. Its own remaining gate
also explicitly includes physical iPhone ringer-switch and latency testing. It
still does not add new sample roots, genuine velocity layers, or replacement
sample bytes, and its velocity/reverb/mobile changes alter sound or output
topology. The candidate live ranking here uses one
velocity-127 event, where PR 98 deliberately bypasses its velocity filter; it
therefore cannot validate the lower-velocity behavior.

Against current `main`, PR 98 overlaps PR 100 in six paths:
`e2e/test-title-inventory.txt`, `package.json`, `validate-all.ts`, `engine.ts`,
`sampled-instrument.ts`, and `sample-pipeline-decisions.test.ts`. A current
three-way simulation produces textual conflicts in `engine.ts`; the other
shared paths still require semantic review. Its new per-note velocity tables
and receipt pins were also solved against pre-PR-100 acoustic/Hammond delivery
bytes, creating a semantic dependency even where Git reports no textual
overlap; those anchors and hashes must be regenerated. At the snapshot, GitHub reported
PR 98 as mergeable but `UNSTABLE`: ten checks were green, E2E Visual Regression
was red, and two E2E jobs were still running. Unit, Stack A, and Instrument
Validation were green, so the new velocity/calibration gates pass that branch's
CI. Its prior mock job had failed before executing tests because the checked-in
inventory count was stale; `9c7614d` updated that contract and triggered the
replacement run. It must be rebased after PR 100 and PR 87, then rerun decoded, visual,
mobile, velocity, complete-matrix, and level-matched listening gates on the
combined graph. It is correctly classified as active adjacent remediation, not
evidence that the combined sound is already certified.

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

PR 87 and PR 100 overlap in twelve files. A current three-way simulation now
produces textual conflicts across the Hammond manifest and shared advanced,
engine, synth, synth-type, test, and XY-control paths; auto-merged files still
require semantic review. PR 87 was built on the old Hammond MP3 catalogue and
old loop coordinates; it also lacks PR 100's stale-Tone-context fail-closed
recovery, bounded growl modulation, and intrinsic zero procedural-envelope gain
that removes the measured one-frame boundary leak. Its resource evidence pins
the old 582-file byte total. Taking either side wholesale would therefore
regress the other.

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
