# Keyboardia Stateless MCP: Rhythm Slice

**Status:** Implemented in this pull request
**Date:** 24 July 2026
**Endpoint:** `https://keyboardia.dev/mcp`
**Protocol target:** MCP `2026-07-28`

## 1. Decision

The first Keyboardia MCP server is the smallest useful collaborative music surface:

- one stateless HTTP endpoint, `/mcp`;
- two tools, `get_session` and `edit_session`;
- three edits, `add_track`, `set_steps`, and `set_tempo`;
- no resources, prompts, authentication, MCP sessions, presence, journal, revisions, undo, or full-state replacement.

It works only with an existing Keyboardia session. The session UUID in a normal
`/s/{session_id}` URL is the explicit application-state handle.

The central safety rule is:

> An agent may assign a few named musical values. It may not replace a session
> or track.

This makes the endpoint useful for rhythm tasks and prevents a caller with a
stale read from erasing another person's unrelated work.

## 2. Stateless protocol contract

Keyboardia uses the official TypeScript SDK v2 per-request handler:

```text
MCP request containing session_id
        |
        v
fresh MCP server for this request
        |
        v
existing LiveSession Durable Object for session_id
        |
        +-- current music state
        +-- serialized edits
        +-- persistence
        +-- existing browser broadcasts
```

The MCP layer holds no music state. It creates a fresh handler and MCP server
for every Worker request. The existing Durable Object remains the source of
truth.

The endpoint:

- negotiates and serves MCP `2026-07-28`;
- implements `server/discover` through the official SDK;
- does not issue or require `Mcp-Session-Id`;
- includes the SDK-required list cache metadata;
- also accepts the SDK's stateless 2025-era fallback for current clients; and
- returns JSON for ordinary request/response exchanges.

The SDK, rather than Keyboardia code, implements protocol envelopes, discovery,
header validation, JSON-RPC routing, and compatibility behavior.

### Authoritative documentation

- [MCP project's 2026-07-28 release-candidate overview](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [SEP-2575: Make MCP Stateless](https://modelcontextprotocol.io/seps/2575-stateless-mcp)
- [SEP-2567: Sessionless MCP via Explicit State Handles](https://modelcontextprotocol.io/seps/2567-sessionless-mcp)
- [Official TypeScript SDK guide for supporting 2026-07-28](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)
- [Official TypeScript SDK HTTP serving guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/http)

The [Microsoft App Service article](https://techcommunity.microsoft.com/blog/appsonazureblog/mcp-just-went-stateless-%E2%80%94-what-the-2026-spec-changes-about-scaling-on-app-servic/4530222)
is useful deployment commentary, but the MCP project documents above are the
protocol authorities.

The v2 SDK is still a beta dependency. Before production deployment, update to
the final compatible release and rerun the protocol tests.

## 3. Access and user exposure

Version 1 follows Keyboardia's existing link-sharing model:

- the MCP server URL is `https://keyboardia.dev/mcp`;
- the user takes `session_id` from
  `https://keyboardia.dev/s/{session_id}`;
- anyone with that unlisted session UUID has the same editing ability the
  shared Keyboardia UI already grants;
- published sessions are readable and immutable.

There is no MCP-specific login, OAuth flow, account, role, edit token, or
permission system.

No new Share UI is required for version 1. Documentation and agent setup
examples should tell users to configure the server URL and provide the session
UUID in their request. A discoverable **Use with an agent** affordance can be
added later if setup friction justifies it.

## 4. Tool surface

There are exactly two advertised tools and no MCP resources or prompts.

### `get_session`

Input:

```json
{
  "session_id": "00000000-0000-4000-8000-000000000001"
}
```

Output:

```json
{
  "session_id": "00000000-0000-4000-8000-000000000001",
  "immutable": false,
  "tempo": 120,
  "tracks": [
    {
      "track_id": "kick-agent-1",
      "name": "Kick",
      "sample_id": "kick",
      "step_count": 16,
      "active_steps": [0, 4, 8, 12]
    }
  ]
}
```

The compact result deliberately omits internal arrays, parameter locks, mix
state, effects, scale, metadata, players, revisions, and storage details.
`active_steps` contains only active steps inside the track's current loop.

### `edit_session`

Input wraps exactly one edit:

```typescript
interface EditSessionInput {
  session_id: string;
  edit: AddTrack | SetSteps | SetTempo;
}
```

Every successful call returns the same compact current-session shape as
`get_session`.

#### `add_track`

```json
{
  "session_id": "00000000-0000-4000-8000-000000000001",
  "edit": {
    "operation": "add_track",
    "track_id": "kick-agent-1",
    "sample_id": "kick"
  }
}
```

- `track_id` is chosen by the caller and is stable across retries. It is 1-64
  characters of letters, numbers, `.`, `_`, or `-`. `:` is deliberately
  excluded: the browser client builds supersession keys as `${trackId}:${step}`
  for step events and as the bare `trackId` for track events, so a track called
  `kick-1:3` would share a key with step 3 of track `kick-1` and could make a
  browser discard a collaborator's pending edit.
- `sample_id` is an enum generated from Keyboardia's canonical instrument
  catalog and embedded in the tool schema. That embeds 99 instrument IDs in
  every `tools/list` response, which is the accepted cost of not shipping a
  separate instrument resource.
- `name` is optional. Keyboardia derives the catalog display name when it is
  absent.
- Keyboardia constructs all internal defaults with `createDefaultTrack()`.
- Retrying the same ID, sample, and name is a no-op.
- Reusing the ID for different track content is a conflict.

There is no instrument resource: an agent gets valid IDs directly from
`tools/list`.

#### `set_steps`

```json
{
  "session_id": "00000000-0000-4000-8000-000000000001",
  "edit": {
    "operation": "set_steps",
    "track_id": "kick-agent-1",
    "changes": [
      { "step": 0, "value": true },
      { "step": 4, "value": true },
      { "step": 8, "value": true },
      { "step": 12, "value": true }
    ]
  }
}
```

`set_steps` assigns only the named steps. It does not clear unspecified steps,
replace the track, or change parameter locks. Duplicate step numbers are
invalid. Each step must be inside the track's current `step_count`; version 1
cannot expand a track loop. Repeating the same assignments is a no-op.

This is an MCP operation, not a new browser wire message. After one durable
write, Keyboardia broadcasts a normal existing `step_toggled` event for each
value that actually changed.

#### `set_tempo`

```json
{
  "session_id": "00000000-0000-4000-8000-000000000001",
  "edit": {
    "operation": "set_tempo",
    "tempo": 124
  }
}
```

Tempo must be within Keyboardia's existing 60–180 BPM range. Repeating the
current value is a no-op.

## 5. Collaboration semantics

All browser and MCP traffic for a session reaches the same Durable Object.
Durable Object request serialization is the concurrency boundary.

For an MCP edit:

1. Read the current Durable Object state.
2. Validate one narrow operation against current state.
3. Change only the named fields.
4. Persist the complete resulting state once.
5. Broadcast existing granular collaboration events.
6. Return a new compact read.

The operations are intentionally retry-safe:

- `add_track` uses a caller-provided stable ID;
- `set_steps` assigns booleans rather than toggling;
- `set_tempo` assigns a number.

Disjoint edits accumulate. If two callers assign the same field, the edit
serialized last by the Durable Object wins. There is no merge UI, journal,
revision check, or undo protocol.

An MCP caller is not added to live presence. Connected browsers see its
musical edits immediately, attributed to the reserved transport actor `mcp`,
but no pretend player avatar is created.

### Persistence when only an agent is present

Keyboardia's hybrid persistence writes Durable Object storage on every mutation
and flushes KV when the last WebSocket disconnects. A session that only an agent
ever touches has no WebSocket to disconnect, so an MCP edit additionally flushes
KV when no browser is connected. Without that flush KV would sit behind DO
storage indefinitely, and `updatedAt` would never move for agent work.

Sessions with connected browsers keep the existing per-disconnect behavior, so
live collaboration still does not pay a KV write per mutation.

### Browser MCP clients

`/mcp` returns CORS headers, including `Access-Control-Expose-Headers` for
`MCP-Protocol-Version`, so an MCP client running inside a web page can use the
endpoint. The route is matched before Keyboardia's `/api/` response decoration
and the SDK emits bare protocol responses, so these headers are applied at the
route itself.

## 6. Errors and unsupported work

Application errors return MCP tool errors without mutation. The full set is
`SESSION_NOT_FOUND`, `SESSION_PUBLISHED`, `SESSION_ID_REQUIRED`,
`SESSION_REQUEST_FAILED`, `INVALID_REQUEST`, `INVALID_TRACK_ID`,
`INVALID_TRACK_NAME`, `INVALID_SAMPLE_ID`, `INVALID_TEMPO`, `INVALID_STEPS`,
`INVALID_STEP`, `DUPLICATE_STEP`, `TRACK_NOT_FOUND`, `TRACK_ID_CONFLICT`,
`TRACK_LIMIT_REACHED`, and `STEP_OUTSIDE_LOOP`.

Anything else is an `INTERNAL_ERROR` carrying a fixed message. The underlying
error is logged for operators but never returned, because its text can carry
runtime, storage, or parser internals that an agent must not receive.

Unsupported operations are not advertised and do not have placeholder
handlers:

- calling an unknown tool receives the standard MCP unknown-tool error;
- supplying an edit other than the three schema variants receives the
  standard invalid-parameters error;
- there is no custom `unsupported_for_now` response matrix.

This is smaller and gives agents an exact capability description through
`tools/list`.

## 7. Implementation map

| Responsibility | Implementation |
|---|---|
| HTTP MCP protocol | Official `@modelcontextprotocol/server` v2 handler |
| Tool definitions and DO adapter | `app/src/worker/mcp.ts` |
| Compact representation and three pure edits | `app/src/worker/mcp-edits.ts` |
| Endpoint routing | `app/src/worker/index.ts` |
| Serialization, persistence, immutable check, browser broadcast | `app/src/worker/live-session.ts` |
| Instrument enum | Existing `VALID_SAMPLE_IDS` |
| Track construction | Existing `createDefaultTrack()` |
| Initial user setup documentation | `README.md` |
| Agent-facing protocol tests | `app/src/worker/mcp.test.ts` |
| Mutation tests | `app/src/worker/mcp-edits.test.ts` |
| Real Worker, Durable Object, and browser-protocol journey tests | `app/test/integration/mcp-journeys.test.ts` |
| Eval cases and scorer | `app/src/worker/mcp-evals.ts` |

MCP never writes directly to KV and does not implement a parallel session
store.

## 8. Eval contract

The first slice supports deterministic agent evals without requiring the eval
harness to understand Keyboardia's internal 128-element arrays.

An eval runner:

1. creates or selects the starting Keyboardia session outside this MCP
   surface;
2. records a baseline with `get_session`;
3. gives the task prompt and MCP endpoint to an agent;
4. records the final `get_session` result;
5. passes baseline, result, and expectation to
   `scoreMcpRhythmResult()`.

The initial cases cover:

- adding a four-on-the-floor kick and setting tempo;
- adding a rhythm while preserving an existing collaborator's track.

The scorer measures tempo, required instrument presence, active-step F1, and
explicit preservation. An agent cannot get a perfect score by creating the
requested part while deleting somebody else's work.

Run the protocol, collaboration, and scorer checks with:

```bash
cd app
npm run test:mcp
```

Run the real Worker and Durable Object onboarding journeys with:

```bash
cd app/test/integration
npm test -- mcp-journeys.test.ts
```

This PR supplies the task fixtures and deterministic scorer. Connecting that
contract to a particular model-running eval harness is separate infrastructure,
not part of the MCP server.

### Testing strategy

The test design applies the public-contract, real-objects, walking-skeleton,
property-testing, sad-path, and documentation-sync techniques collected in
[testing-best-practices](https://github.com/adewale/testing-best-practices):

- [test type selection](https://github.com/adewale/testing-best-practices/blob/main/testing-best-practices/references/test-types.md)
  keeps musical rules in fast domain tests and uses one cross-component
  onboarding skeleton to prove the wiring;
- [TypeScript guidance](https://github.com/adewale/testing-best-practices/blob/main/testing-best-practices/references/typescript.md)
  supplies Vitest, `fast-check`, and real HTTP/WebSocket patterns;
- [documentation-code sync](https://github.com/adewale/testing-best-practices/blob/main/testing-best-practices/references/doc-sync-testing.md)
  checks that the tools and edit operations documented here match
  `tools/list`; and
- [anti-pattern guidance](https://github.com/adewale/testing-best-practices/blob/main/testing-best-practices/references/antipatterns.md)
  prevents the in-memory handler test from being presented as proof of the
  real Durable Object integration.

The tiers are:

| Tier | Evidence |
|---|---|
| Domain | Example and property tests prove that named assignments preserve unnamed steps, parameter locks, other tracks, and retry idempotency |
| MCP contract | The official client proves protocol negotiation, tool discovery, schema rejection, and stateless headers |
| Worker integration | The official client crosses the real Worker router, session API, Durable Object, durable storage, and WebSocket broadcast path |
| Eval contract | Deterministic fixtures and a scorer reward the requested rhythm while penalizing damage to collaborators |
| Deployment smoke | `npm run smoke:mcp -- <base-url>` drives the golden journey over real HTTP against a deployed endpoint (see below) |

The Worker integration test creates a real session, connects two agents and a
browser-protocol WebSocket, observes live agent broadcasts, disconnects the
agents, reconnects a fresh client, and verifies the persisted combined state.
It also proves that published sessions are readable but immutable and that a
missing session returns `SESSION_NOT_FOUND`.

The suite deliberately does not drive every musical rule through Playwright.
The rendered UI already has separate session-creation and multiplayer tests;
one future rendered **Use with an agent** test should be added if that
affordance is implemented.

### The golden journey (deployment smoke)

The tiers above all run against a local or simulated Worker. `SELF` under
`vitest-pool-workers` cannot be pointed at a deployed URL, so nothing in them
can tell you whether `/mcp` is actually serving on staging or production. That
is what `app/scripts/mcp-smoke.ts` is for:

```bash
cd app
npm run smoke:mcp -- https://staging.keyboardia.dev
npm run smoke:mcp -- https://keyboardia.dev --session <uuid>
npm run smoke:mcp -- http://localhost:8787          # against wrangler dev
```

It exits non-zero on any failure, so it can gate a deploy. Run it against
staging, then production, after every deployment that touches the MCP surface.

The journey is section 9's onboarding path with the acceptance criteria that
can only be checked against real infrastructure:

1. the target answers `/api/health`, and `POST /mcp` is not a 404 — that
   specific failure is reported as "merged but not deployed" rather than
   surfacing later as a protocol error;
2. CORS headers are present on a **successful exchange**, and
   `MCP-Protocol-Version` is in the expose list;
3. the official client negotiates `2026-07-28` with an explicit pin, and no
   response carries `Mcp-Session-Id`;
4. `tools/list` advertises exactly the v1 surface, with the instrument enum in
   the `edit_session` schema and no resources or prompts;
5. `add_track`, `set_steps` (set, clear, and restore), and `set_tempo` each
   change what they name, and identical retries are no-ops;
6. a bystander track added first is byte-identical afterwards — the safety rule
   the whole design exists to enforce;
7. a fresh client, and the session API a returning browser reads, both see the
   persisted combined state; and
8. missing sessions, malformed handles, and unsupported operations are rejected
   without mutating.

Two operational notes. There is no session `DELETE` in the API, so a run with no
`--session` leaves a session behind; for production, keep one dedicated smoke
session and pass its UUID. Track IDs are stable and each edit is written to be a
real state change on a session a previous run already touched, so a reused
session neither accumulates tracks toward `MAX_TRACKS` nor decays into asserting
what the last run left behind.

The smoke deliberately does not publish, so it cannot create immutable litter.
Published-session immutability stays covered by the Worker integration tier.

### Testing `/mcp` from a real browser origin

The Worker integration suite asserts the CORS headers on real `/mcp`
exchanges, which covers the regression risk. Confirming that an MCP client
running inside a page can actually reach the endpoint needs a browser, and the
options differ more than they appear:

- The **official MCP Inspector proxies through a local Node process by
  default**, so its normal mode exercises none of these headers. Its *Direct*
  mode does connect cross-origin, but as of v0.20.0 it also sends an internal
  `x-custom-auth-headers` request header
  ([inspector#1100](https://github.com/modelcontextprotocol/inspector/issues/1100)),
  which fails preflight against any server that does not allow it. Keyboardia
  deliberately does not, since it ignores the header; adding it to
  `Access-Control-Allow-Headers` would be a pure convenience for that tool.
- **Hosted third-party inspectors** may or may not connect browser-direct.
  Treat any of them as an unverified CORS test unless proven otherwise.
- The official **`@modelcontextprotocol/client` bundles and runs in a browser**.
  Its `browser` export condition selects a `new Function`-free schema validator
  in place of ajv, which also keeps it inside Keyboardia's CSP. A Playwright
  test that loads a page importing the client and points it at `wrangler dev`
  is therefore the one option that genuinely exercises this path end to end,
  and Playwright's dev server already runs on a different port from
  `wrangler dev`, so it is cross-origin without extra infrastructure.

Two traps are worth writing down. `versionNegotiation.mode` defaults to
`legacy`, so a client constructed without the `pin` this repo's tests use
negotiates a 2025 revision and never touches the `2026-07-28` path. And the SDK
cannot distinguish a CORS failure from a network failure in a browser, so it
reports a blocked request as a protocol-negotiation failure — diagnose from the
network log, never from the thrown error.

## 9. User journeys enabled

The version 1 onboarding path is:

1. A user opens or creates a session in Keyboardia.
2. The user configures `https://keyboardia.dev/mcp` once in their agent client.
3. The user gives the agent the session UUID from the `/s/{session_id}` URL.
4. The agent calls `get_session` before making a narrow contribution.
5. The user, other people, and other agents keep working in the same session.
6. A fresh agent process can resume later by reading the same UUID again.

Version 1 then allows a user to:

1. Open an existing Keyboardia session and give its UUID to an agent.
2. Ask the agent to inspect the current tempo and rhythms.
3. Ask an agent to add a catalog instrument with safe Keyboardia defaults.
4. Ask an agent to add, remove, or correct specific beats without clearing
   unspecified beats.
5. Ask an agent to change tempo.
6. Keep editing in a browser while one or more agents edit the same session.
7. See agent edits arrive live without refreshing.
8. Retry an agent task without duplicate tracks or toggled-back steps.
9. Read a published session while edit attempts remain blocked.
10. Run repeatable rhythm-task evals that penalize damage to existing work.

Malformed UUIDs are rejected at the MCP schema boundary. Missing sessions and
published-session edits return structured tool errors without mutation.

Accepting a complete Keyboardia URL instead of a UUID and adding a rendered
**Use with an agent** affordance are useful onboarding improvements, but they
are not part of the implemented version 1 contract.

## 10. Explicitly out of scope

These are not partly implemented MCP features:

- full session or full track replacement;
- delete, clear, rename, reorder, mute, solo, volume, transpose, swing, scale,
  effects, loop-region, parameter-lock, pattern-transform, or instrument-change
  edits;
- activity history, operation journal, revisions, undo, redo, locks, merge UI,
  auth, accounts, or permissions;
- resources, prompts, subscriptions, or agent presence.

### Deferred hardening — required before this is load-bearing

Unlike the version 2 journeys below, these are not demand-gated. They are known
gaps in the shipped surface.

- [ ] **Rate limit `/mcp`.** The endpoint is unauthenticated and currently
  unlimited, while `/og/*` and session creation both go through the in-memory
  `checkRateLimit()` in `app/src/worker/index.ts`. `initialize` and `tools/list`
  need no session ID at all, and every call constructs an MCP server, a Durable
  Object fetch, and a KV read.

  Recommended shape, in order of value:

  1. **Per-session token bucket inside `LiveSessionDurableObject`.** This is the
     control that protects the resource. It is free — it runs inside the
     `mcp-edit` invocation Keyboardia already makes — strongly consistent
     because the Durable Object is single-threaded per session, and keyed on the
     session rather than on an IP. A capacity-60 bucket refilling at 1/second
     absorbs an agent's natural burst of small edits and then settles.
  2. **Workers Rate Limiting binding on `/mcp`** (GA since September 2025;
     top-level `ratelimits` in `wrangler.jsonc`, requires wrangler ≥ 4.36.0).
     Use two windows — roughly 30 per 10s and 120 per 60s — because a single
     window cannot both absorb bursts and cap sustained abuse. Counters are
     per-Cloudflare-location and eventually consistent, so the configured number
     is a per-colo budget rather than a global guarantee, and `limit()` returns
     only `{ success }` — `Retry-After` must be synthesized from the period.
     Production and staging need different `namespace_id` values or staging load
     tests will consume production budget.
  3. **One WAF rate limiting rule on the `/mcp` path**, set loosely, as an outer
     shield that sheds load before the Worker runs. Plan-dependent: Free allows
     one rule per zone with a 10s maximum window, Pro allows 60s, and method
     matching needs Business. The action must be `block`, never a challenge —
     MCP clients cannot solve challenges.

  Failure modes to design against: hosted agent runtimes egress from shared NAT
  pools, so an IP-keyed limit collapses independent agents into one bucket and
  should stay deliberately loose; MCP clients retry, so a 429 without
  `Retry-After` invites a storm; and rejections are invisible in the dashboard,
  so each one should emit a wide event through the existing observability path.

  Authentication is the real long-term fix, because it makes the rate limit key
  meaningful rather than a proxy. That stays out of scope for version 1.

- [ ] **Resolve the stale limit in `app/src/worker/index.ts`.** The comment
  above `RATE_LIMIT_MAX_REQUESTS` says the value was raised from 10 to 100 for
  integration testing and should be reverted; it never was. This predates the
  MCP work but shares the mechanism any `/mcp` limiting would replace.

- [ ] **Guard `/mcp` before parsing.** Reject non-POST requests, oversized
  bodies, and wrong content types up front, reusing the existing
  `isBodySizeValid()` in `app/src/worker/validation.ts`.

- [ ] **Check that zone-level bot protection excludes `/mcp`.** Super Bot Fight
  Mode and "Block AI bots" operate on the zone and would plausibly classify
  Keyboardia's own MCP clients as bots. Anything enabled there needs a skip for
  the `/mcp` path.

### Version 2.0 candidate journeys — only if users ask

Promote a journey only after user requests or observed workflows demonstrate
demand. These describe outcomes, not committed tool names or schemas. Every
session-lifecycle tool must wrap Keyboardia's existing authoritative operation
and return the canonical `/s/{session_id}` URL.

#### 1. Agent starts something new

- [ ] **Create session**
- User says, for example, “Make me a 124 BPM house beat.”
- The agent creates an editable Keyboardia session using Keyboardia's normal
  defaults, makes the requested narrow musical edits, and returns a clickable
  session URL.
- Repeating an uncertain creation request must not silently create a pile of
  duplicate sessions.
- Acceptance: the returned URL opens the created editable session, another
  person or agent can join it, and the eval harness can provision its starting
  session through the same public contract.

#### 2. Agent continues from published work

- [ ] **Remix session**
- User gives the agent a published Keyboardia URL and asks it to continue or
  vary the music.
- The agent reads the immutable source, creates an editable remix through
  Keyboardia's existing remix operation, preserves remix lineage, edits only
  the new session, and returns its URL.
- Acceptance: the published source's musical state and immutability are
  unchanged, the remix is editable, its lineage points to the source, and
  collaborators can join it.

#### 3. Agent freezes a shareable result

- [ ] **Publish session**
- User explicitly asks the agent to publish the current result.
- The agent publishes through Keyboardia's existing snapshot operation and
  returns the new immutable URL while retaining the editable source URL.
- Publishing is never an implicit side effect of editing or exporting.
- Acceptance: the published snapshot is readable and immutable, the source
  remains editable, and a repeated explicit publish follows Keyboardia's
  existing snapshot semantics.

#### 4. Agent finds a starting point

- [ ] **Example discovery**
- User asks for a style, instrument, or musical starting point without already
  having a session.
- The agent discovers Keyboardia examples through an authoritative catalog,
  explains its choice briefly, and returns the example URL.
- If the user asks to change it, the agent remixes first; it never mutates the
  example or a published source.
- Acceptance: discovery results are valid current examples, selection is
  deterministic enough to evaluate, and editing always happens in a new
  editable remix.

#### 5. Agent explains the music

- [ ] **Musical and pitch analysis**
- User asks what is happening rhythmically, harmonically, melodically, or in
  pitch without asking for a mutation.
- The agent uses a shared Keyboardia analysis operation rather than
  reimplementing musical inference from raw state.
- Acceptance: analysis is read-only, grounded in the current session, returns
  structured facts suitable for evals, and stays consistent with the browser's
  musical model.

#### 6. Agent takes the result elsewhere

- [ ] **MIDI or other exports**
- User asks for MIDI or another supported export of the current session.
- The agent invokes Keyboardia's authoritative exporter and returns the
  artifact or a time-limited download link without changing the music.
- Acceptance: the export matches Keyboardia's browser export for the same
  state, preserves supported timing and pitch information, and reports
  unsupported features rather than approximating them silently.

#### 7. People can see when an agent is actively participating

- [ ] **Live agent presence**
- While an agent is actively working, browser collaborators can distinguish it
  from people and from other agents; after it stops, its presence disappears.
- Presence is ephemeral coordination information, not an MCP session, lock,
  permission, or durable operation journal. Music edits remain authoritative
  even if presence delivery fails.
- Acceptance: presence never creates a ghost avatar, times out after an
  interrupted agent, distinguishes simultaneous agents, and is not required
  for stateless reads or edits.

Also:

- [ ] Implement the richer shared browser and MCP **Change instrument**
  product described in [#63](https://github.com/adewale/keyboardia/issues/63)
  before exposing anything based on today's lower-level `set_track_sample`.

Every promoted feature should wrap an authoritative Keyboardia implementation,
not copy music or session logic into the MCP adapter.

## 11. Reinvention audit

| Need | Keyboardia already has it? | Decision |
|---|---|---|
| Collaboration handle | Yes: session UUID | Reuse it as explicit state |
| Shared state coordinator | Yes: `LiveSession` Durable Object | Reuse |
| Current-state read | Yes: DO-backed GET | Compact it |
| Track defaults | Yes: `createDefaultTrack()` | Reuse |
| Instrument validation | Yes: `VALID_SAMPLE_IDS` | Generate schema enum |
| Tempo and state constraints | Yes | Reuse |
| Persistence before broadcast | Yes | Reuse |
| Browser convergence messages | Yes | Reuse existing events |
| Explicit multi-step assignment | No public operation | Add one pure MCP edit |
| MCP transport | No | Add the official SDK adapter |
| Eval-safe compact result and scorer | No | Add the minimum contract |

The implementation does not add auth, presence, a journal, revisions,
deduplication storage, undo/redo, a copied instrument catalog, a second browser
protocol, or a general mutation framework.

If a future change starts adding one of those to make this rhythm slice work,
stop and reconsider whether Keyboardia already has the required primitive.

## 12. Acceptance criteria

- A pinned official client negotiates MCP `2026-07-28`.
- No response requires or emits `Mcp-Session-Id`.
- `tools/list` advertises exactly `get_session` and `edit_session`.
- No resources or prompts are advertised.
- `edit_session` accepts exactly `add_track`, `set_steps`, and `set_tempo`.
- Two independent clients can mutate and read the same real Durable
  Object-backed session.
- A connected browser-protocol client receives existing granular broadcasts
  for MCP edits attributed to `mcp`.
- A fresh MCP client can reconnect and read the persisted combined state.
- An edit cannot replace a complete track or session.
- Unnamed steps and unrelated tracks survive `set_steps`.
- Identical retries are no-ops.
- State is persisted before connected browsers receive existing granular
  broadcasts.
- Published sessions reject edits.
- Published sessions remain readable through MCP.
- Malformed UUIDs are rejected before reaching the session adapter.
- Missing sessions return `SESSION_NOT_FOUND`.
- The instrument enum comes from Keyboardia's canonical catalog.
- A track ID that would collide with a browser supersession key is rejected.
- An unexpected failure returns a fixed `INTERNAL_ERROR` message and never the
  underlying error text.
- An agent-only edit leaves KV consistent with Durable Object storage.
- `/mcp` responses carry CORS headers and expose `MCP-Protocol-Version`.
- The MCP SDK is not evaluated on cold starts that never serve `/mcp`.
- The eval scorer penalizes loss of a preserved collaborator track, and cannot
  be gamed by scattering duplicate near-miss tracks.
- Every shipped eval case is exercised against the scorer and the real
  instrument catalog, tempo range, and default loop length.
- The documented version 1 tools and edit operations match `tools/list`.

## 13. Repository sources audited

- `app/src/worker/index.ts`
- `app/src/worker/live-session.ts`
- `app/src/worker/handler-factory.ts`
- `app/src/worker/validation.ts`
- `app/src/worker/invariants.ts`
- `app/src/shared/message-types.ts`
- `app/src/shared/messages.ts`
- `app/src/shared/state-mutations.ts`
- `app/src/shared/state-adapters.ts`
- `app/src/shared/sync-classification.ts`
- `app/src/sync/multiplayer.ts`
- `app/src/components/sample-constants.ts`
- `specs/ROADMAP.md`
- `specs/SHARED-MUTATION-REFACTORING-PLAN.md`
