# Sonnet-first Keyboardia skill evaluation — 2026-07-29

> Historical rationale and status. For the current frozen identities, exact
> commands, stop rules, and completion contract, use
> `specs/EVAL-SONNET-V11-HANDOFF.md`.

## Decision

Keep the evaluation follow-up in draft until it contains valid model evidence.

The discovery, protocol, validator, redirect, capability-echo, track-ID, and
readiness-gate defects found in the multi-agent audit are fixed in source commit
`8b33b5cadadb851c7d7120ab62ab267612d0da0d`. The final skill and catalog bytes
are unchanged in the smaller runtime PR, which now carries the deployed
implementation independently of this evaluation framework.

Production and staging were deployed on 30 July 2026 and now pass the complete
well-known discovery and MCP smokes. The remaining external blocker is that the
newly frozen Sonnet v11 matrix cannot run because the signed-in Claude
account has reached its weekly limit, which resets 2026-07-31 at 05:00
Europe/London.

No failed provider call is counted as a model score.

## What the audit changed

- The client-side discovery contract now requires the exact Cloudflare v0.2
  `$schema` identifier before processing `skills`.
- The catalog validator requires exactly one entry with
  `name=collaborate-in-keyboardia` and `type=skill-md`; it no longer selects
  `skills[0]`.
- Discovery follows at most five same-origin redirects and rejects a
  cross-origin hop, loop, or excess redirect.
- The trace records MCP 2026 connection/version negotiation through
  `server/discover`. It no longer calls that phase “initialization” or accepts a
  legacy `initialize` exchange.
- `tools/list` must expose exactly the seven canonical Keyboardia tools; missing,
  extra, or duplicate names fail the trace.
- `add_track` now rejects IDs that do not end in a hyphen plus at least eight
  hexadecimal characters. This makes the advertised schema and runtime agree.
- `remix_session` and `publish_session` no longer echo the caller-supplied source
  UUID or editable URL in their result.
- Public trigger fixtures use capability placeholders rather than
  production-shaped bearer UUIDs.
- The answer-audit gate now marks a regression guard as holding only when the
  skilled arm is green. An equal 0/0 case is a blocker, not success. The matching
  harness fix is frozen at `200bfdd`.

## Normative documentation boundary

The earlier work collapsed three different authorities into “the MCP docs.”
They must be applied in order:

1. The Cloudflare Agent Skills Discovery RFC governs the pre-MCP HTTP journey:
   fixed well-known catalog, recognized catalog version, unique typed skill
   selection, redirects, raw skill bytes, and digest verification.
2. The final versioned MCP specification governs the `/mcp` protocol. For
   protocol version `2026-07-28`, the modern probe is `server/discover`; the
   legacy `initialize` lifecycle is not the operation being performed.
3. SDK documentation explains how one implementation realizes the final spec.
   An SDK `connect()` helper may issue `server/discover`, but a receipt must name
   and verify the wire operation rather than treating the helper name as a
   normative protocol message.

The `$schema` detail is subtle: in the Cloudflare RFC it is an opaque version
identifier. A client compares it with the version it understands; it is not a
runtime instruction to fetch or trust whatever document happens to live at
that URL. Vendoring the schema is useful for publisher CI, but it does not
replace the client-side exact-identifier check.

## Corrected continuous trace contract

The release trace must prove one correlated sequence:

```text
origin
→ /.well-known/agent-skills/index.json
→ exact $schema check
→ unique name/type selection
→ raw SKILL.md bytes
→ SHA-256 digest verification
→ same-origin /mcp
→ server/discover for 2026-07-28
→ tools/list with exactly seven tools
→ create_session
→ get_session
→ edit_session
→ get_session
→ edit_session
→ get_session
```

Unit tests now reject every weaker form of that chain. The previous autonomous
receipt remains useful historical local evidence, but its origin is
`http://127.0.0.1:53948`, not `https://keyboardia.dev`, and its old
`mcp_initialize` label and weaker oracle are not release evidence for the
corrected contract.

## Sonnet v11 confirmation slice

The v10 population is retained as historical negative evidence, not promoted as
confirmation. It was selected adaptively after v6–v9, its fresh-track prompt had
an ambiguous object envelope, its redaction oracle rejected safe no-action text,
and the old readiness code mislabeled the resulting 0/3 regression as holding.
Its nominal `p=0.0625` is descriptive, not confirmatory.

The replacement v11 population was frozen before generation:

- source commit: `8b33b5cadadb851c7d7120ab62ab267612d0da0d`
- harness commit: `200bfdd4aa9c50dd842f648dfc615fc65db0c4da`
- prepared-task SHA-256:
  `e1aa527a2b10420c6f03b5791862b9c7af11461233081b979de3a11654fe2f7f`
- 8 independent hidden cases: 5 holdout and 3 holdback
- 2 arms: with skill and without skill
- 3 repeats per case/arm
- 48 planned calls
- 5 positive and 3 adversarial cases
- full 77-case pre-run manifest audit: no findings and no blockers

The cases cover normative discovery, acknowledgement verification, private
handoff, uncertain step recovery, fresh-track ownership, existing-capability
redaction, track-limit partial failure, and publication source secrecy. The two
previously defective prompts/oracles were clarified before any v11 answer was
generated.

An attempt from the preceding source commit exposed an adapter telemetry bug
(`usage.source` entered a numeric-only contract). The native `run-claude` retry
then produced provider execution failures with zero tokens and zero cost:
Claude reported that the weekly account limit had been reached. These are
operational failures, not answer observations. The final task bundle above was
refreshed after inlining retired v10 prompts for strict CI and has not produced
model answers, so there is no v11 benchmark or release receipt yet.

## Evidence corrections

- The old autonomous and live receipts are loopback Worker evidence. Earlier
  claims that they began at production were incorrect.
- v6–v9 files on the evidence branch are immutable aggregate history, not
  independently regradable prompt/output populations.
- Receipt verification does not rely on the current checkout's evaluated source
  bytes or local Git history, given a trusted verifier and installed
  dependencies. It does still execute verifier code supplied by the checkout.
- Provider model identity, token counts, and billing remain provider/harness
  metadata, not signed attestations.

## Verification completed on the corrected source

- focused split eval suite: 79/79 passed
- TypeScript typecheck: passed
- build: passed
- lint: passed
- built integration suite: 133/133 passed
- full application unit suite: 4,481 passed, 1 skipped
- the exact PyPI 0.6.0 strict manifest validation and audit used by CI: passed
  locally; the audit is ready with no blockers and retains one required
  missing-positive-evals finding
- CI for the split evaluation head: pending

## Remaining merge blockers

1. Run the frozen 48-call Sonnet v11 matrix after provider capacity resets;
   grade, audit, and produce a content-bound receipt without changing prompts or
   oracles.
2. Produce a fresh autonomous trace under the corrected
   `$schema`/`server-discover`/exact-seven validator.
3. Require green CI for the final split evaluation head.
4. Publish new durable evidence and update the PR only after those artifacts
   verify offline.
