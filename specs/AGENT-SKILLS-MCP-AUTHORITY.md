# Agent Skills discovery and MCP authority map

**Status:** Normative-source map and Keyboardia conformance profile

**Profile date:** 30 July 2026

**Cloudflare discovery profile:** draft v0.2.0, pinned at
[`1bd1167983fa5ac9cd47987710c525308eda1a98`](https://github.com/cloudflare/agent-skills-discovery-rfc/tree/1bd1167983fa5ac9cd47987710c525308eda1a98)

**MCP protocol:** final `2026-07-28`

## Why this map exists

“The MCP documentation” is not one authority. Keyboardia crosses two protocols
and uses one SDK, then adds its own product-safety profile. A conformance claim
must name the layer whose requirement it is testing.

| Layer | Authority | What it controls |
| --- | --- | --- |
| Pre-MCP discovery | [Cloudflare Agent Skills Discovery RFC draft v0.2.0](https://github.com/cloudflare/agent-skills-discovery-rfc) | Well-known catalog, `$schema`, typed skill entries, artifact URL, redirects, MIME behavior, and raw-byte SHA-256 verification |
| MCP wire protocol | [Final MCP `2026-07-28` specification](https://modelcontextprotocol.io/specification/2026-07-28) | JSON-RPC messages, per-request metadata, `server/discover`, transports, errors, capabilities, and tool RPCs |
| SDK behavior | [Official TypeScript SDK protocol-version guide](https://ts.sdk.modelcontextprotocol.io/v2/protocol-versions) | How `Client.connect()` and the server handler implement and negotiate the wire protocol |
| Keyboardia profile | This document, the published skill, and executable validators | Same-origin redirect policy, exact seven-tool surface, capability protection, fresh track IDs, and read/edit/read verification |

The Cloudflare document is a draft. Its capitalized BCP 14 requirements are
normative for conformance to the pinned draft adopted here; they are not MCP
requirements and do not make the draft an IETF standard. The final, versioned
MCP specification controls the MCP layer. SDK documentation is implementation
guidance and cannot redefine either protocol.

## Deliberate Keyboardia profile decisions

These rules are stronger or narrower than their upstream base:

- Cloudflare says a missing `$schema` should be treated as v0.1.0. Keyboardia
  implements only v0.2.0, so it recognizes that fallback classification and
  stops because it has no v0.1.0 processor. It never parses an absent schema as
  v0.2.0.
- Cloudflare requires clients to handle redirects. Keyboardia handles at most
  five and accepts only same-origin hops because a verified skill is about to
  become agent instructions.
- MCP requires servers to implement `server/discover`, while clients may call
  it. Keyboardia's release verifier requires the call and pins `2026-07-28` so
  evidence cannot silently fall back to the legacy `initialize` lifecycle.
- MCP defines `tools/list`; it does not require Keyboardia's seven particular
  tools. Exact equality with the seven names is a Keyboardia release invariant.
- MCP does not require `get_session → edit_session → get_session`. That is
  Keyboardia's application-safety rule for authoritative verification under
  collaboration.

An SDK helper named `connect()` is not a wire message. A receipt may record the
helper as implementation context, but it proves modern negotiation only by
recording the correlated `server/discover` exchange and advertised
`2026-07-28` support. It must not label that phase `initialize`.

## Required continuous trace

Keyboardia release evidence must preserve one correlated chain:

```text
origin
→ /.well-known/agent-skills/index.json
→ exact opaque $schema identifier
→ unique collaborate-in-keyboardia / skill-md entry
→ exact SKILL.md response bytes
→ catalog SHA-256 match
→ same-origin /mcp
→ server/discover advertising 2026-07-28
→ tools/list with exactly seven Keyboardia tools
→ create or obtain a session capability
→ get_session
→ edit_session
→ get_session
```

Publisher validation, deterministic integration tests, a deployed discovery
smoke, an MCP smoke, and an autonomous-agent trace prove different things. None
may be described as a substitute for another.

## Executable conformance map

- Publisher shape and source bytes:
  `app/test/agent-skills-discovery.test.ts`
- Model-free discovery-to-MCP composition:
  `app/test/integration/agent-skills-journey.test.ts`
- Deployed Cloudflare discovery behavior:
  `app/scripts/agent-skills-smoke.ts`
- Deployed MCP protocol and tool surface:
  `app/scripts/mcp-smoke.ts`
- Autonomous model execution is evaluated separately from this runtime contract;
  it must not be substituted for, or represented as, deterministic protocol
  conformance.

The deploy path gates staging and production on both deployed smokes. A green
MCP smoke can no longer conceal a missing well-known catalog.
