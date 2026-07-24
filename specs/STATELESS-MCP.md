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

- `track_id` is chosen by the caller and is stable across retries.
- `sample_id` is an enum generated from Keyboardia's canonical instrument
  catalog and embedded in the tool schema.
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

## 6. Errors and unsupported work

Application errors such as `SESSION_NOT_FOUND`, `SESSION_PUBLISHED`,
`TRACK_NOT_FOUND`, `TRACK_ID_CONFLICT`, `STEP_OUTSIDE_LOOP`, and invalid
current-state constraints return MCP tool errors without mutation.

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
| Compact representation and three pure edits | `app/src/worker/mcp-domain.ts` |
| Endpoint routing | `app/src/worker/index.ts` |
| Serialization, persistence, immutable check, browser broadcast | `app/src/worker/live-session.ts` |
| Instrument enum | Existing `VALID_SAMPLE_IDS` |
| Track construction | Existing `createDefaultTrack()` |
| Initial user setup documentation | `README.md` |
| Agent-facing protocol tests | `app/src/worker/mcp.test.ts` |
| Mutation tests | `app/src/worker/mcp-domain.test.ts` |
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

This PR supplies the task fixtures and deterministic scorer. Connecting that
contract to a particular model-running eval harness is separate infrastructure,
not part of the MCP server.

## 9. User journeys enabled

Version 1 allows a user to:

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

## 10. Explicitly out of scope

These are not partly implemented MCP features:

- full session or full track replacement;
- delete, clear, rename, reorder, mute, solo, volume, transpose, swing, scale,
  effects, loop-region, parameter-lock, pattern-transform, or instrument-change
  edits;
- activity history, operation journal, revisions, undo, redo, locks, merge UI,
  auth, accounts, or permissions;
- resources, prompts, subscriptions, or agent presence.

### Version 2.0 candidates — only if users ask

Promote an item only after user requests or observed workflows demonstrate
demand:

- [ ] Create session
- [ ] Remix session
- [ ] Publish session
- [ ] Example discovery
- [ ] Musical and pitch analysis
- [ ] MIDI or other exports
- [ ] Live agent presence

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
- Two independent clients can mutate and read the same session.
- An edit cannot replace a complete track or session.
- Unnamed steps and unrelated tracks survive `set_steps`.
- Identical retries are no-ops.
- State is persisted before connected browsers receive existing granular
  broadcasts.
- Published sessions reject edits.
- The instrument enum comes from Keyboardia's canonical catalog.
- The eval scorer penalizes loss of a preserved collaborator track.

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
