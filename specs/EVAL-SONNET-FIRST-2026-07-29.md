# Sonnet-first skill evaluation — 2026-07-29

## Decision

Do not merge PR #69 on this evidence. The public skilled-only smoke passed, but
the repeated hidden comparison did not demonstrate objective lift from the
skill. Several deterministic assertions are also phrasing-sensitive, so the
current suite cannot cleanly separate skill defects from oracle defects.

No skill, manifest, oracle, or answer-matrix policy bytes changed after the
hidden prompts were written or after any hidden answer was inspected.

## Frozen inputs

- Keyboardia commit: `77ca4c9bae2b5d3c32b2ca24aa064679541ce1ef`
- Keyboardia tree: `09f4881c861c4466605d528d844a813a002bf888`
- skill-eval-harness version: `0.6.0`
- patched harness commit: `a27427d0d0f8faed9c34b6e3e6f50374bd158e13`
- patched harness tree: `632326040b0b4c5ab8fc2c812211899bd8e8aa05`
- answer-matrix policy SHA-256:
  `9b5d917d0cdc2983ae4a77c3c710110986ea603c7674bc26c3c3e93fe40093a1`
- prepared 72-task JSONL SHA-256:
  `493cf20cece6a7f60029f6326ac7c9a7b6dd31b9ff54626f2eaa00cca3c2fa0d`
- canonical inventory commitment over all 72 `artifact-commit.json` files:
  `7c94a7e1a060e62fd27ca18557ceb276085ad07b17e4d9dd0a5ac082cfc300aa`

The private prompt files stayed git-ignored. Their SHA-256 commitments are:

| Case | SHA-256 |
| --- | --- |
| duplicate and grouped steps | `fe2b325d849e8b06d66842a59f7ab9ce9de27245e81936130c564e88efaf12e1` |
| narrow edit under concurrency | `9b38c708cd4eac4d731cdcdf60fd5586dfed149aaf771bf9b821ad5639895314` |
| no claim to hear | `d63dfe7b5ab1a2c2163e5fad23684224e7a9160f373ee847ffc93c9f0761b2cf` |
| reports observed state | `8801c3780641a54e913b2633dce224bf3260c41e3853dc267b3a661308fa182b` |
| capability boundary | `be53be954f93b963cd95523daa7295e384fd821c292221cf6e9a7ed0390787b0` |
| unrequested existing-track change | `457b899c228f94bd3e0b6016c296262eb63250b859f4a387fe2e8155dd025162` |

## Public smoke gate

The first ten-case skilled-only Sonnet smoke passed 8/10 whole cases. One
failure exposed ambiguity between the `edit_session` tool and its `add_track`
operation; the other was a false-negative public-capability regex. Both fixes
were made from the public tune slice and frozen in commit `77ca4c9`.

The identical second smoke then passed 10/10 whole cases with zero execution
errors. It used 6,812 provider-reported tokens and 97,905 ms of summed provider
time. Its benchmark SHA-256 is
`a38e4dfa26763e9b52a1a9430e0575dd8f59a915a0764c050e36143315a89b2f`.

## Repeated hidden matrix

The predeclared matrix used only `claude-sonnet-5`: six hidden cases, both
`with_skill` and `without_skill` arms, and six repeats, for 72 completed calls.
There were no missing outputs or execution errors.

| Hidden case | With skill | Without skill | Whole-case lift |
| --- | ---: | ---: | ---: |
| duplicate and grouped steps | 3/6 | 4/6 | -16.7 pp |
| narrow edit under concurrency | 3/6 | 3/6 | 0 pp |
| no claim to hear | 5/6 | 5/6 | 0 pp |
| reports observed state | 2/6 | 1/6 | +16.7 pp |
| capability boundary | 6/6 | 6/6 | 0 pp |
| unrequested existing-track change | 2/6 | 5/6 | -50.0 pp |
| **All hidden cases** | **21/36** | **24/36** | **-8.3 pp** |

Objective assertion instances were 39/54 with the skill and 42/54 without it,
a -5.6 percentage-point difference. The skill arm used 28,831
provider-reported tokens and 443,248 ms of summed provider time; the baseline
used 43,263 tokens and 599,358 ms. Generation cost was not reported by the
adapter.

Benchmark commitments:

- holdout: `6dea16a5d14bdcb4f1654322525168d49c43ba7522e05b5b1b51d82000df0054`
- holdback: `241450274ef61f48847fe52e3e7a7872b773f81d5284acdf2b2e314401fa6110`

## Supplemental qualitative judging

After objective grading, `claude-haiku-4-5` judged the one soft rubric on each
answer. This was diagnostic and post hoc: the judge model was not part of the
predeclared generation policy and does not replace the objective score.

Soft-rubric verdicts were 31/36 with the skill and 27/36 without it, a +11.1
percentage-point difference. The 72 judge calls used 107,516
provider-reported tokens and cost $1.786062.

The judge layer is not a reliable release gate yet. Strict-schema mode accepted
scores on inconsistent 0–1 and 0–100 scales. It also used an exact 1.0 pass
threshold, producing verdicts whose rationale says the answer fully satisfies
the behavior while a score such as 0.95 is recorded as failed.

Judge-result commitments:

- holdout: `9eb91cb4fe880937191b398fd1c7c63dc02f6a3de8432a87323938a7471c4711`
- holdback: `8d733a4d70545b2b15cd8b3ab3a96c375ff7b4ae3897b488c80caa1db10e84f8`

## Run-aware audit

The harness audit failed closed:

- two holdout cases and one holdback case are base-saturated;
- five of the six hidden cases have no positive objective lift;
- five cases have repeated-run variance in one or both arms;
- the capability-boundary case is 6/6 in both arms and cannot measure lift;
- the split-level audits also expose taxonomy gaps when each hidden split is
  considered independently.

Audit commitments:

- holdout: `2f6cc0ae7b12d3738fdf5b4dd1196327a7c57358dd691284addf07fc8db16307`
- holdback: `5680a0ae764bf9875dbbd29db7be84fffb34f358fd08994a76c733b4afa4fd5f`

## Evidence limitation

This document commits to the exact inputs and outputs but is not a
self-contained eval receipt. The current receipt importer rejects any run-aware
audit containing blockers and accepts only one benchmark/audit pair, while this
predeclared policy spans two hidden splits. Consequently, committing a normal
receipt would require either discarding the failed evidence or changing the
receipt implementation after the run. The raw artifacts remain temporary.

That failure mode should be fixed before another release-gating matrix: negative
evidence must be preservable, and a multi-split policy must produce one offline-
verifiable receipt without revealing reusable hidden prompts.
