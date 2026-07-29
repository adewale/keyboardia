# Sonnet-first Keyboardia skill evaluation — 2026-07-29

## Decision

Do not merge PR #69 yet.

The engineering, discovery, protocol-documentation, live-execution, and
receipt-provenance defects raised in review are fixed. The final frozen Sonnet
answer matrix also has no run-audit readiness blockers and shows a large
positive effect: 13/18 skilled runs passed versus 4/18 baseline runs, an
absolute lift of 50 percentage points.

That is not yet reliable enough to ship. One core ownership/retry case passed
only 1/3 skilled repeats, the exact paired sign-flip result is `p=0.0625`, and
the redaction case exposed another overly literal oracle after the matrix was
frozen. The oracle was not rewritten post hoc. Haiku has not been run against
this corrected contract; under the Sonnet-first strategy, it should not be run
until the remaining Sonnet failure is understood.

## What is fixed

- The skill now requires one continuous origin-only trace:
  origin → `/.well-known/agent-skills/index.json` → selected raw `SKILL.md`
  bytes → SHA-256 verification → same-origin `/mcp` initialization →
  `tools/list` → `get_session` → `edit_session` → `get_session`.
- A fresh autonomous Sonnet trace starts with only `https://keyboardia.dev`,
  has no preconfigured target MCP server, and completes all of those steps.
- A fresh live MCP sweep exercises 18 calls against the corrected contract.
- The acceptance contract names all seven canonical tools rather than
  contradicting the prose with a two-tool requirement.
- Acknowledgement/compatibility snapshots are explicitly non-authoritative;
  every write requires a following `get_session` verification.
- Capability redaction, new-private-handoff, publication, returned-data
  injection, ownership, uncertain-response, and partial-failure rules are
  explicit and objectively scored.
- The full Sonnet comparison has been repeated several times. Failed or flawed
  v6–v9 matrices are retained as negative evidence rather than overwritten.
- Receipts bind exact prompts, task bundles, source Git objects, skill,
  manifest, answer-matrix policy, oracles, harness patch, and committed run
  artifacts. They self-verify without trusting the current checkout.

## Normative MCP documentation boundary

Three different concerns had been collapsed into “the MCP documentation”:

1. The final, versioned MCP specification is the sole normative authority for
   MCP transport, initialization, capability negotiation, and protocol
   messages. Release-candidate blog posts, SEPs, and SDK guides are useful
   context or implementation advice, but they do not override the final spec.
2. The Cloudflare Agent Skills Discovery RFC governs the step before MCP:
   discovering `/.well-known/agent-skills/index.json`, selecting a `skill-md`
   entry, fetching its bytes, and checking its digest. The MCP specification
   begins to govern once the agent reaches and initializes `/mcp`.
3. A JSON document's `$schema` value is an identifier. It is not an instruction
   that every agent must fetch that URL at runtime. Keyboardia therefore pins
   and vendors the Cloudflare schema used for validation while retaining the
   specified schema identifier.

Before this correction, the prose listed seven tools while the normative
acceptance check required exactly `get_session` and `edit_session`; one server
could therefore be both conforming and non-conforming. The acceptance contract
now requires exactly:

`get_session`, `edit_session`, `create_session`, `remix_session`,
`publish_session`, `analyze_session`, and `export_midi`.

## Frozen final Sonnet matrix (v10)

The final release matrix was frozen before generation at source commit
`0107ea15dab85499ab9ab4283d68991bad2e6a04` and tree
`6b3d82c8b78f16e72580d2527ae3df39a42686c3`.

- model: `claude-sonnet-5`
- cases: 6 hidden cases (4 holdout, 2 holdback)
- arms: `with_skill` and `without_skill`
- repeats: 3 per case/arm
- calls: 36/36 complete; 0 missing; 0 execution errors; 0 timeouts
- skill: 13/18, 72.2%
- baseline: 4/18, 22.2%
- absolute lift: +50.0 percentage points
- normalized gain: 64.3%
- exact paired sign-flip: `n=6`, `p=0.0625`
- provider-reported tokens: 96,187
- provider-reported cost: $7.0310621
- summed provider elapsed time: 1,837,677 ms

| Hidden case | With skill | Baseline | Interpretation |
| --- | ---: | ---: | --- |
| acknowledgement verification | 3/3 | 2/3 | skilled arm reliable; baseline variable |
| private capability handoff | 3/3 | 2/3 | skilled arm reliable; baseline variable |
| uncertain instrument recovery | 3/3 | 0/3 | strong skill-specific lift |
| fresh track ownership/retry | 1/3 | 0/3 | positive lift, but skilled behavior is unreliable |
| redact existing capability | 0/3 | 0/3 | safe skilled answers rejected by a literal `"none"` oracle |
| track-limit partial failure | 3/3 | 0/3 | strong skill-specific lift |

The run-aware audit reports no readiness blockers and no base-saturated
capability cases. It still reports required findings for repeated-run variance,
the hidden subset's intentionally absent trigger cases, and only two
positive-kind cases. Trigger/no-trigger coverage exists in the full 69-case
manifest and the pre-run full-manifest audit is clean; it is not part of this
answer-only hidden slice.

### v10 commitments

- skill tree: `65bbe421e9f8721d950ad3eda03d9c25c60e006799f79b7d6b835e5d23a58c09`
- source bundle: `cd70c4b058c1c0fb057d340e5272debddf46d5d5d520014fe603cdb3ae04641a`
- manifest: `6b4bae24e332eed76a31027a8c70e14b79490d48a48cb02537af690ae908e42b`
- answer-matrix policy: `bc6182e4bd2d503da1085457ea0e1dbf7c1d16f95f8d4513947abc2e78bda978`
- prepared tasks: `3f7348225a8f1994aa8e5160b62a9be2dd6ab33bf0bffb98d2bdce341863270a`
- benchmark: `e19f7b9c912a85564da9ab2ee14375efd99ca9acfae726e4af7d781e46f51403`
- audit: `0545b2e79684cb4e947cc373671a86a8234dc68401c6460899d3718f6ae099f1`
- receipt: `963e1007d93ab0db6f6860fc42e36800d472fdf0220c2eba4e6348bb0376cd38`
- receipt result projection:
  `be38ef6578320a4cbc3bf4e0d0fd55d2c386d0976bfad427a9b4a9c77b2d5d58`
- patched harness commit: `9261721f7682f756009a06c36405e99d10e86582`
- patched harness tree: `d3666fcc2766e8f259fc0325135ecd9a6955f614`

The receipt validates against the committed receipt schema and independently
reconstructs all 36 results.

## Continuous autonomous trace

The origin-only autonomous receipt is a separate execution population. Sonnet
received the Keyboardia origin, not a configured Keyboardia MCP connection.
Its 13-event trace performed catalog fetch, raw skill fetch, exact digest
verification, MCP initialization, `tools/list`, and six live target calls ending
in authoritative verification. No target call occurred before discovery.

- receipt SHA-256:
  `8d59e11fcf660e19b23b3f70911a3156e0cd103d0e43482450f003c463e45469`
- trace SHA-256:
  `ae8161f40760c22480ad022c8c3823c5e8be94df9e90d08e427662e9774d44bd`
- answer SHA-256:
  `370838f7d950eaaf4cf0b04f454df92140a1d5aa3740e123d42cdf0b89bf32cc`
- prompt SHA-256:
  `c18939c9933b87a63729fe11fcb3438a5bc386680435304aa79a0072ad6d8b56`
- invocation SHA-256:
  `644b98a61b0b673fe3b41da811d9c2ccf7a3fd09e3f730cf68a709e6f9239b67`

## Fresh live MCP execution sweep

The live receipt contains 18 execution-graded calls. The skill arm passed 100%
of cases and assertions; the baseline passed 77.8% of cases and 98% of
assertions. Twenty-five assertions were saturated, so this receipt demonstrates
live tool reliability and safety regression behavior, not a clean estimate of
skill lift.

- receipt SHA-256:
  `6972e8b27e30a5f46918639f4b604276c5f504d046e23285e835b499a03f2568`
- raw run SHA-256:
  `0205b114aa801bdd993556bf3735ff622b9b49d7518432eaf88a3bba11f9e61b`

## Preserved negative eval history

| Matrix | Skill | Baseline | Result |
| --- | ---: | ---: | --- |
| v6, 72 calls | 52.8% | 8.3% | four 0/0 cases exposed JSON-envelope/type oracle defects |
| v7, 72 calls | 80.6% | 55.6% | discovery and remix remained non-discriminating |
| v8, 72 calls | 83.3% | 41.7% | origin-discovery and public-freeze prompts disclosed their desired answers |
| v9, 60 calls | 86.7% | 40.0% | audit blocked on one 1/1 capability case and one false 0/0 literal oracle |
| v10, 36 calls | 72.2% | 22.2% | no readiness blockers; remaining reliability and scoring defects are explicit |

The lower v10 skilled score is not evidence that the skill regressed. The v10
slice deliberately removed easy, saturated regression cases from the lift
denominator and introduced a new partial-failure capability case. It is the
more honest release estimate.

## Verification performed

- focused final Vitest suite: 38/38 passed
- earlier full application unit suite: 4,465 passed, 1 skipped
- earlier build/lint/typecheck/integration total: 133 passed
- skill-eval-harness suite: 830 passed, 5 skipped
- Cloudflare skill validation: passed
- strict manifest leakage and ablation validation: passed
- full 69-case pre-run manifest audit: no blockers or findings
- final 36-run answer audit: no readiness blockers
- final answer receipt self-verification: passed
- autonomous receipt self-verification: passed
- live execution receipt self-verification: passed

## Why this still should not merge

1. Sonnet followed the fresh-track ownership/retry contract only once in three
   skilled repeats. That is a core collaboration-safety behavior.
2. The final six-case paired result is large but misses the predeclared 0.05
   significance threshold (`p=0.0625`).
3. The redaction oracle is still too literal: all three skilled outputs were
   safe, but two used explanatory no-action text rather than the exact string
   `"none"`. Changing the frozen oracle after inspecting answers would be
   post-hoc scoring, so the defect remains visible.
4. Haiku has not been evaluated on the corrected final contract.
5. The autonomous discovery-to-edit trace is one successful sample, not a
   repeated reliability distribution.
6. The live execution sweep has many saturated assertions and therefore proves
   the MCP surface works more strongly than it proves the skill adds value.
7. Receipts are content-addressed and self-verifying, but they are not
   provider-signed attestations of model identity or billing telemetry.

The correct next slice is to repair or simplify fresh-track response shaping,
freeze a semantically tolerant redaction oracle before generation, then repeat
the focused Sonnet matrix. Haiku should follow only if that Sonnet gate is
stable.
