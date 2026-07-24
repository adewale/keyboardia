# Keyboardia Stateless MCP: Minimum Viable Specification

**Status:** Strict MVP draft
**Date:** 24 July 2026
**Repository location:** `specs/STATELESS-MCP.md`
**Repository reviewed:** `adewale/keyboardia`, `main` at `96894ec41107d0a319f39238d7480f0cd73f6bb2`
**Protocol target:** MCP `2026-07-28`; verify against the final specification before production rollout

## 1. Decision

Add a stateless MCP endpoint at:

```text
https://keyboardia.dev/mcp
```

The MVP has exactly:

- two tools: `get_session` and `edit_session`;
- one resource: `keyboardia://instruments`;
- one new shared Keyboardia mutation: `set_steps`; and
- one transport-neutral entry point into the existing `LiveSession` Durable Object.

The endpoint operates on sessions people already created in Keyboardia. Session creation, remixing, publishing, analysis, export, and live agent presence are not part of this release.

The safety rule is:

> An MCP caller may submit only an allowlisted targeted mutation. It may never replace a complete session or track document.

This is enough for several people and agents to edit the same session without a stale agent snapshot erasing unrelated work.

## 2. What stateless means

Every MCP request is independent. A composition request carries Keyboardia's existing session UUID as `session_id`. The Worker creates a fresh MCP server and transport for the request and routes the operation to the existing Durable Object for that UUID.

```text
MCP request: session_id + targeted mutation
        |
        v
Stateless Worker /mcp adapter
        |
        v
Existing LiveSession Durable Object
        |
        +-- current state
        +-- validation
        +-- persistence
        +-- granular WebSocket broadcast
```

The MCP adapter stores no state. Keyboardia's musical state remains in the same Durable Object used by browsers.

### Protocol requirements

- Support MCP `2026-07-28` at `/mcp`.
- Implement `server/discover`.
- Create a fresh server and transport for every request.
- Do not issue or require `Mcp-Session-Id`.
- Validate the protocol version and required request headers.
- Keep `tools/list` and `resources/list` session-independent.
- Pin an SDK version that passes final `2026-07-28` conformance tests.

At the date of this draft, the protocol is a locked release candidate. Verify the final SDK and transport API before implementation.

### Authoritative stateless MCP documentation

Use the MCP project's own specifications and SDK documentation as implementation authorities:

- [2026-07-28 release-candidate overview](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) — official explanation of the stateless protocol core and release status.
- [SEP-2575: Make MCP Stateless](https://modelcontextprotocol.io/seps/2575-stateless-mcp) — removes the initialization handshake and defines per-request discovery, version, capability, and client metadata.
- [SEP-2567: Sessionless MCP via Explicit State Handles](https://modelcontextprotocol.io/seps/2567-sessionless-mcp) — removes `Mcp-Session-Id` and specifies explicit application-state handles.
- [Draft specification changelog](https://modelcontextprotocol.io/specification/draft/changelog) — authoritative change list from `2025-11-25`.
- [Official TypeScript SDK migration guide for `2026-07-28`](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28) — current server implementation guidance while the revision remains a release candidate.

The Microsoft article that motivated this proposal is useful deployment commentary, but it is not the protocol authority.

## 3. Access model

MCP uses Keyboardia's existing link-sharing model.

- The existing session UUID is the collaboration handle.
- Anyone with that handle has the same edit capability Keyboardia currently provides through its shared session UI.
- Published sessions are readable and immutable.
- There is no MCP-specific authentication, OAuth, account, role, edit token, or permission system.

Reuse existing UUID validation, rate limits, state-size limits, instrument validation, immutable-session checks, and error behavior. Do not expose debug or storage operations.

## 4. User exposure

Add **Use with an agent** to the existing Share interface. It shows and copies:

```text
MCP server: https://keyboardia.dev/mcp
Session: <current session UUID>
Session URL: https://keyboardia.dev/s/<current session UUID>
```

The person creates or opens a session in Keyboardia, shares these values with one or more agents, and keeps the browser open if they want to see edits arrive live.

There is no login flow, permission chooser, agent roster, proposal queue, or agent-specific connection setup.

## 5. MCP surface

### 5.1 `get_session`

Returns the latest session state from the existing Durable Object-backed read path.

```typescript
interface GetSessionInput {
  session_id: string;
}
```

The result contains the existing `Session` representation, its browser URL, and whether it is immutable. It does not contain a revision, journal, activity history, presence roster, or MCP metadata.

Implementation reuse:

- `LIVE_SESSIONS.idFromName(session_id)`;
- the `LiveSession.handleStateRead()` path;
- existing UUID and state validation; and
- existing metadata merging.

The tool must not read KV directly.

### 5.2 `edit_session`

Applies one allowlisted mutation to the current live session.

```typescript
interface EditSessionInput {
  session_id: string;
  mutation: McpMutation;
}
```

The result returns the applied mutation and either the affected state or the latest session. It does not create an activity record.

Allowed mutations:

```text
set_steps
set_parameter_lock
batch_set_parameter_locks
batch_clear_steps
add_track
delete_track
clear_track
set_track_volume
set_track_transpose
set_track_step_count
set_track_swing
set_track_name
set_tempo
set_swing
set_scale
set_loop_region
set_session_name
```

These operations are explicit assignments or targeted, retry-safe clears. If two callers assign the same field, the mutation processed last wins. Mutations to unrelated fields accumulate.

#### `set_steps`

Do not expose `toggle_step`. A retry could toggle a step twice and reverse the requested result.

Add one shared mutation:

```typescript
type SetStepsMutation = {
  type: 'set_steps';
  trackId: string;
  values: Array<{
    step: number;
    value: boolean;
  }>;
};
```

`set_steps` assigns only the named step values. Repeating it produces the same state. Parameter locks are unchanged; callers use `set_parameter_lock`, `batch_set_parameter_locks`, or `batch_clear_steps` when locks must also change.

This must be a normal Keyboardia mutation, not MCP-only code:

- add it to the shared message types and mutation classification;
- implement it in `state-mutations.ts`;
- validate every step and track ID;
- persist before broadcasting;
- broadcast `steps_set`; and
- apply `steps_set` in `multiplayer.ts`.

The browser may continue presenting toggle gestures even if its network representation is migrated later.

#### `add_track`

The MCP input is smaller than the existing wire document:

```typescript
interface AddTrackMutation {
  type: 'add_track';
  track_id: string;
  sample_id: string;
  name: string;
}
```

The server validates `sample_id` against the canonical instrument catalog and calls `createDefaultTrack()`. Agents do not construct 128 steps, 128 parameter locks, or internal defaults.

### 5.3 `keyboardia://instruments`

Expose the canonical instrument catalog with:

- stable sample ID;
- display name;
- category; and
- engine type where useful.

Generate the resource from `INSTRUMENT_CATEGORIES` and `VALID_SAMPLE_IDS`. Do not copy the catalog into an MCP-specific file.

## 6. Collaboration behavior

Keyboardia's existing `LiveSession` Durable Object remains the sole coordinator.

For every MCP mutation:

1. load the current live state;
2. validate the mutation and immutable-session rule;
3. mutate only the named fields or track;
4. persist to Durable Object storage;
5. send the existing granular broadcast, or the new `steps_set` broadcast; and
6. retain the existing KV checkpoint policy.

Never write MCP changes directly to KV. Never broadcast a replacement session for an ordinary edit.

Example:

1. A person enables snare step 4.
2. An agent changes tempo to 118.
3. The Durable Object processes both messages.
4. Both changes survive because neither caller supplied a replacement session.

If two callers assign different values to the same step, tempo, or other field, the last processed assignment wins. That is a real conflict, not something this MVP attempts to merge.

## 7. Presence and attribution

MCP adds no presence system.

- Existing browser WebSockets continue to drive Keyboardia's human presence UI.
- A stateless MCP request does not add an agent to the player roster.
- `get_session` does not return presence.
- MCP changes use the generic mutation source `mcp` where the existing broadcast requires a source.
- There are no agent names, avatars, heartbeats, leases, timeouts, subscriptions, join/leave events, or durable actor records.

People still experience collaboration because the existing browser receives MCP mutations in real time. Agent presence is not required for shared editing.

## 8. Unsupported operations

The server must not invite agents to reproduce omitted Keyboardia behavior with primitive writes.

When `edit_session` receives a known Keyboardia operation that is intentionally outside the allowlist, return a structured tool error:

```json
{
  "code": "unsupported_for_now",
  "feature": "pattern_transform",
  "message": "Keyboardia does not expose pattern transforms through MCP yet.",
  "retryable": false
}
```

Do not partially apply the request. Do not return a replacement algorithm in the error message.

### Known operations returning `unsupported_for_now`

| Feature | Existing operation or concept | Reason for exclusion |
|---|---|---|
| Change a track's instrument | `set_track_sample` | Current operation overwrites the name and lacks the desired shared product contract; tracked in [#63](https://github.com/adewale/keyboardia/issues/63). |
| Effects editing | `set_effects` | Replaces the complete effects object and can overwrite unrelated concurrent changes. |
| FM editing | `set_fm_params` | Replaces both FM parameters and can overwrite an unrelated concurrent change. |
| Pattern copy | `copy_sequence` | The result depends on mutable source state. |
| Pattern move | `move_sequence` | Source-dependent and destructive. |
| Track reorder | `reorder_tracks` | Numeric positions are sensitive to concurrent inserts and moves. |
| Rotate, invert, reverse, mirror | Pattern transform messages | Their command forms are unsafe to repeat after an ambiguous retry. |
| Euclidean fill | `euclidean_fill` | Depends on current pattern state and lock-clearing behavior. |
| Mute and solo | `mute_track`, `solo_track` | Keyboardia treats these as local “My Ears” state. |
| Playback | `play`, `stop` | Browser-local audio transport, not shared composition state. |
| Cursor and presence | `cursor_move`, join/leave concepts | Ephemeral connection state outside the MCP MVP. |

`toggle_step` is rejected with an error directing the caller to `set_steps`; the step-editing feature itself is supported.

Transport internals such as `state_hash`, `request_snapshot`, and `clock_sync_request` return `invalid_mutation`, not `unsupported_for_now`, because they are not product capabilities.

### Capabilities absent from the MCP tool list

The following do not have tools or resources in this MVP:

- create session;
- remix session;
- publish session;
- example discovery;
- session or pitch analysis;
- MIDI, audio, stem, notation, or image export;
- instrument or track-name preview;
- microphone recording, waveform editing, autoslicing, or custom samples;
- live agent presence; and
- share/QR rendering.

Conforming MCP hosts discover that these tools do not exist. A direct call to a nonexistent tool receives the standard MCP unknown-tool error. Product-facing clients may present that as “unsupported for now,” but the server must not register placeholder tools solely to emit that message.

## 9. Error behavior

Use a small stable error vocabulary:

| Code | Meaning |
|---|---|
| `session_not_found` | The UUID does not identify a session. |
| `session_immutable` | The session is published and cannot be edited. |
| `invalid_argument` | A supplied value or ID is invalid. |
| `invalid_mutation` | The message is not an agent-facing composition operation. |
| `unsupported_for_now` | Keyboardia recognizes the feature but has intentionally not exposed it through MCP. |
| `rate_limited` | Existing request limits were exceeded. |

Errors must not mutate or partially persist state.

## 10. Internal implementation

### MCP route

Add `/mcp` before general `/api/` handling in `app/src/worker/index.ts`. Create a fresh server and transport per request.

Suggested files:

```text
app/src/worker/mcp.ts
app/src/worker/mcp.test.ts
```

Do not create an MCP Durable Object, MCP session store, operation table, actor table, or presence table.

### Transport-neutral mutation entry point

Extract one internal entry point from the current WebSocket-oriented handlers:

```typescript
applySharedMutation(
  message: AllowedSharedMutation,
  source: 'browser' | 'mcp'
): Promise<MutationResult>
```

Both transports must use the same validation, state mutation, persistence, immutable-session enforcement, and granular broadcast behavior.

Reuse:

- `ClientMessageBase` and mutation classification;
- `applyMutation()` and `createDefaultTrack()`;
- invariant and validation helpers;
- `persistToDoStorage()`;
- current server broadcasts and browser handlers; and
- existing KV checkpoint behavior.

Do not implement an MCP mutation engine alongside `state-mutations.ts`, `handler-factory.ts`, and `live-session.ts`.

## 11. User journeys enabled by the MVP

The MVP supports these end-to-end journeys:

1. **Bring an agent into an existing composition.** A person copies the MCP endpoint and session ID from Share; the agent reads the current composition.
2. **Ask questions about the raw session.** The agent can inspect tracks, steps, locks, tempo, scale, loop, and mix values. It does not receive Keyboardia-generated musical analysis.
3. **Co-edit a rhythm.** A person and one or more agents set different steps; unrelated edits accumulate and open browsers update live.
4. **Edit notes and dynamics.** Agents set or clear per-step parameter locks, including pitch and volume values represented by Keyboardia's existing lock schema.
5. **Manage tracks.** Agents add catalog instruments as new default tracks, delete tracks, clear a whole track, rename tracks, and adjust volume, transpose, step count, or per-track swing.
6. **Change session-wide composition settings.** Agents update tempo, global swing, scale, loop region, and session name.
7. **Continue human editing during and after agent work.** MCP edits use the same Durable Object and granular broadcasts as browser edits; no import or state replacement is required.
8. **Share one session with several agents.** Each agent rereads current state and submits targeted assignments to the same Durable Object.
9. **Inspect a published session safely.** Agents can read it; edit attempts return `session_immutable`.

The MVP does not claim that agents can operate every Keyboardia control.

## 12. Explicit TODOs

- [ ] Implement `set_steps` as a shared browser/MCP mutation.
- [ ] Extract the transport-neutral mutation entry point.
- [ ] Add `/mcp`, the two tools, and the instrument resource.
- [ ] Add **Use with an agent** to Share.
- [ ] Implement the shared browser and MCP **Change instrument** feature in [#63](https://github.com/adewale/keyboardia/issues/63), then consider adding `set_track_instrument` to the allowlist.

All other omitted capabilities require a separate product decision or issue. They are not hidden requirements for this MVP.

### Version 2.0 candidates — only if users ask

Do not treat these as committed scope. Promote an item into a version 2.0 plan only after user requests or observed workflows demonstrate demand:

- [ ] Create session
- [ ] Remix session
- [ ] Publish session
- [ ] Example discovery
- [ ] Musical and pitch analysis
- [ ] MIDI or other exports
- [ ] Live agent presence

Each promoted item should wrap an authoritative Keyboardia implementation rather than introduce MCP-specific domain logic.

## 13. Reinvention audit

| Concern | Keyboardia already has it? | MVP decision |
|---|---|---|
| Session handle | Yes: UUID | Reuse. |
| Shared state coordinator | Yes: one `LiveSession` Durable Object per session | Reuse. |
| Latest-state read | Yes: DO-backed GET | Wrap. |
| Mutation types and pure mutation helpers | Largely | Reuse an allowlist. |
| Validation and state repair | Yes | Reuse. |
| Immediate DO persistence and KV checkpointing | Yes | Reuse unchanged. |
| Browser collaboration broadcasts | Yes | Reuse; add only `steps_set`. |
| Instrument catalog | Yes | Generate one resource from it. |
| Explicit multi-step assignment | No | Add `set_steps`. |
| Transport-neutral mutation dispatch | Not cleanly | Extract one shared entry point. |
| Stateless MCP adapter | No | Add the thin Worker adapter. |

The MVP does not add authentication, revisions, pattern hashes, deduplication storage, an operation journal, undo/redo, attribution history, presence infrastructure, copied catalogs, or copied music algorithms.

If implementation starts adding any of those, stop and move that work to a follow-up proposal.

## 14. Acceptance tests

### Protocol

- Calls work when successive requests land on different Worker instances.
- No call requires initialization state or `Mcp-Session-Id`.
- A fresh server and transport are created per request.
- Only two tools and one resource are advertised.

### Reuse

- `get_session` returns the same current state as the existing DO-backed API read.
- Instrument IDs exactly match Keyboardia's existing catalog.
- MCP code does not write directly to KV.
- Browser and MCP mutation paths use the same shared dispatcher.

### Collaboration

- A browser changes a step while MCP changes tempo; both changes remain.
- `set_steps` changes only named steps and is safe to repeat.
- A connected browser applies an MCP edit without reloading or replacing its session.
- Every mutation is persisted before its broadcast.
- Published sessions reject edits.
- A full session or full track replacement is rejected.

### Boundaries

- Every known excluded edit in §8 returns `unsupported_for_now` without mutation.
- `toggle_step` directs the caller to `set_steps`.
- Transport internals return `invalid_mutation`.
- A stateless MCP request does not create a presence entry.
- No unsupported tool is advertised as a placeholder.

## 15. Sources

- [Microsoft: MCP Just Went Stateless—What the 2026 Spec Changes About Scaling on App Service](https://techcommunity.microsoft.com/blog/appsonazureblog/mcp-just-went-stateless-%E2%80%94-what-the-2026-spec-changes-about-scaling-on-app-servic/4530222)
- [MCP project: The 2026-07-28 MCP Specification Release Candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [SEP-2575: Make MCP Stateless](https://modelcontextprotocol.io/seps/2575-stateless-mcp)
- [SEP-2567: Sessionless MCP via Explicit State Handles](https://modelcontextprotocol.io/seps/2567-sessionless-mcp)
- [MCP draft specification changelog](https://modelcontextprotocol.io/specification/draft/changelog)
- [MCP TypeScript SDK: Supporting protocol revision 2026-07-28](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28)
- [Cloudflare Agents: `createMcpHandler`](https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/)

Repository sources audited:

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
