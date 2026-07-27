# Change Instrument

Status: implemented.
Issue: [#63](https://github.com/adewale/keyboardia/issues/63).

Changing a track's instrument is one product operation with three callers: the
browser, the live collaboration protocol, and the stateless MCP endpoint. This
document records the shared operation, what it deliberately reuses, the bugs the
design exists to prevent, and how each layer is tested.

## 1. What the operation is

Replace a track's **sound source** and nothing else.

```ts
type SetTrackInstrument = {
  type: 'set_track_instrument';
  trackId: string;
  sampleId: string;
};
```

Preserved: track ID, position in the track list, `name`, `steps`,
`parameterLocks`, `volume`, `muted`, `soloed`, `transpose`, `stepCount`,
`swing`.

Replaced: `sampleId`.

Dropped: `fmParams` — see the compatibility policy in section 4.

Renaming stays a separate `set_track_name` operation. An instrument change never
touches a collaborator's custom label, which is the specific behavior the old
latent `set_track_sample` message got wrong: it required a caller-supplied
`name` and overwrote whatever the collaborator had typed.

## 2. Single implementation

`app/src/shared/track-instrument.ts` holds the whole operation:

```ts
setTrackInstrument(state, { trackId, sampleId }): SetTrackInstrumentResult
```

It is pure, transport-neutral, and returns a discriminated result rather than
throwing:

- `{ ok: false, error: { code: 'INVALID_SAMPLE_ID' | 'TRACK_NOT_FOUND' } }` —
  the input state object is returned untouched, so no caller can half-apply a
  rejected edit.
- `{ ok: true, changed: false, state }` — the track already plays that
  instrument. Returns the **same state reference**, which is what makes the
  operation retry-safe for MCP and no-op-quiet for the broadcast path.
- `{ ok: true, changed: true, state, track }` — a new state with one new track
  object.

Every caller funnels through it:

| Caller | Path |
|---|---|
| Browser reducer | `gridReducer` → `applyMutation('set_track_instrument')` → `setTrackInstrument` |
| Durable Object WebSocket | `handleSetTrackInstrument` → `setTrackInstrument` |
| Durable Object MCP edit | `applyMcpSessionEdit('set_track_instrument')` → `setTrackInstrument` |

Because the browser reducer and the Durable Object run the same function, the
granular broadcast only has to carry `{ trackId, sampleId }`. Both sides derive
the same resulting track, including the engine-state decision.

## 3. Reuse inventory

Everything in the left column already existed. The feature adds only the right
column.

| Need | Already in Keyboardia | Decision |
|---|---|---|
| Instrument catalog | `INSTRUMENT_CATEGORIES`, `VALID_SAMPLE_IDS` | Reuse; no second catalog |
| Categorized picker UI | `SamplePicker` | Reuse via a `variant` prop |
| Hover/tap preview | `SamplePicker` + `previewInstrument` | Reuse unchanged |
| Instrument display name | `getInstrumentName` | Reuse |
| Sample/synth preloading | `audioEngine.preloadInstrumentsForTracks` | Reuse |
| Disposing stale per-track synths | `audioEngine.clearTrackSynths` | Reuse — it existed and documented this exact use, with **no caller** |
| Mid-playback synth warming | `useTrackPrewarm` | Reuse; its signature already keys on `${id}:${sampleId}` |
| Published-session rejection | `MUTATING_MESSAGE_TYPES` + `immutable` checks | Reuse; the new type joins the set and is blocked automatically |
| Granular broadcast plumbing | `createTrackMutationHandler`, `createRemoteHandler` | Reuse `createRemoteHandler`; the DO handler needs the pure op, so it follows `handleMcpEdit`'s shape instead |
| MCP transport, error shaping | `mcp.ts` `toolError`, `McpSessionEditError` | Reuse |
| MCP durable write + broadcast | `handleMcpEdit` | Reuse; one new event variant |
| Sync completeness enforcement | `sync-classification.ts` exhaustiveness check, `validate:sync` | Reuse; the compiler names every site that still needs wiring |

New code: the shared operation, an audio reconciler hook, a picker variant, one
UI panel, and the wire/MCP type entries.

## 4. Engine-state compatibility policy

`fmParams` (`harmonicity`, `modulationIndex`) is the only engine-specific field
on `SessionTrack`. It is meaningful only for `tone:fm-*` presets, and its useful
range differs per preset — `tone:fm-bass` defaults to `{2, 8}` while
`tone:fm-bell` defaults to `{5.01, 14}`.

**Policy: changing `sampleId` clears `fmParams`.**

The new instrument then falls back to its own preset defaults
(`FM_PRESET_DEFAULTS` in `TrackRow`), which is what a fresh track of that
instrument would sound like.

Rationale:

- Carrying values over would apply bass modulation depth to a bell, which is
  audible and wrong, and is exactly the "stale incompatible parameters" failure
  the issue names.
- Keeping them dormant while a non-FM instrument is selected means a later
  change back to an FM preset silently resurrects settings the user has not
  seen in the UI for the whole intervening period.
- Clearing is the only option that makes the result a function of
  `(track, sampleId)` alone, which is what lets the client and server converge
  from a `{ trackId, sampleId }` broadcast. `fmParams` is **excluded from the
  state hash** (`canonicalizeTrack` in `worker/logging.ts`), so a divergence here
  would never be caught by the periodic hash check. One shared implementation is
  the only defense.

The policy lives in one exported function, `carryOverEngineState`, so it has a
single test target and a single place to change if a future preset family gains
compatible parameters.

Changing the instrument to the value it already has is a no-op and therefore
preserves `fmParams` — a user tweaking FM knobs and re-picking the same preset
does not lose their edits.

## 5. Wire protocol

Added:

- client → server `{ type: 'set_track_instrument', trackId, sampleId }`
- server → client `{ type: 'track_instrument_set', trackId, sampleId, playerId }`

`set_track_sample` / `track_sample_set` are **retained as a compatibility
alias**. They keep their `name` field and their existing behavior, are still
accepted by the Durable Object, and are still applied by the browser. Nothing in
the product emits them any more:

- no UI ever dispatched `SET_TRACK_SAMPLE`, so no deployed client sends the old
  message;
- `getInstrumentName` derivation moved to the UI layer, where the picker already
  has the catalog entry.

They stay because removing a message type from `MUTATING_MESSAGE_TYPES` would
silently start *accepting* it on published sessions, and because a persisted
session never stores messages, so there is nothing to migrate.

The DO rejects an invalid `sampleId` or an unknown `trackId` by ignoring the
message: no mutation, no broadcast, no `error` frame. That matches every other
track mutation handler (`if (!track) return`), and keeps a hostile client from
raising an error banner in every collaborator's browser. The MCP path returns a
described `McpSessionEditError` instead, because an agent needs to know why.

## 6. MCP exposure

`edit_session` gains a third operation. The envelope keeps the shape the endpoint
already ships — `edit` / `operation`, not `mutation` / `type` as sketched in the
issue — because that envelope is the deployed contract, is asserted by
`mcp.test.ts` and `mcp-smoke.ts`, and renaming it would break `add_track` and
`set_steps` for no product gain.

```json
{
  "session_id": "00000000-0000-4000-8000-000000000001",
  "edit": {
    "operation": "set_track_instrument",
    "track_id": "kick-agent-1",
    "sample_id": "sampled:808-kick"
  }
}
```

There is still **no instrument resource**. The issue suggests
`keyboardia://instruments`; `specs/STATELESS-MCP.md` §4 already decided against
it, `tools/list` already embeds the catalog enum, and both `mcp.test.ts` and
`mcp-smoke.ts` assert that the server advertises no resources. An agent gets
valid IDs for `set_track_instrument` from the same enum that serves `add_track`.

`set_track_instrument` does not accept a name. Renaming stays `set_track_name`,
which the MCP surface does not expose at all, so an agent cannot erase a
collaborator's label.

## 7. Browser UX

The picker is the same component in both roles. `SamplePicker` takes
`variant: 'add' | 'change'`; the `add` variant renders byte-identically to
before so the existing `sample-picker.png` baseline still matches.

All three surfaces open the **same** panel, which `TrackRow` renders once below
the row using the existing `panel-animation-container` mechanics that pattern
tools already use. There is no second picker built for a narrow viewport.

| Surface | Entry point |
|---|---|
| Desktop | `♪` toggle in `track-left`, beside the pattern-tools toggle, in its own `[instrument]` grid column, paid for from the name column so the row's total width is unchanged |
| Mobile portrait width | "Instrument" row in the existing `InlineDrawer`, labelled with the current instrument |
| Landscape mobile | "Sound" button in `TrackDrawer` |

Preview before committing is inherited: `SamplePicker` previews on hover and on
keyboard focus-then-Enter without committing, and only `onClick` commits.

Published sessions: `StepSequencer` passes `onSetInstrument` only when the
session is editable, and the toggle is not rendered without it — the same
mechanism that already hides `Delete` and the add-track picker.

## 8. Audio reconciliation

An instrument change has an audio side effect that must happen for **every**
origin, not just a local click: a per-track `tone:`/`advanced:` synth instance is
cached by `trackId` and would keep playing the old sound.

`useTrackInstrumentReconcile(state)` watches `trackId → sampleId` in the reducer
state and, when an existing track's `sampleId` changes, calls
`clearTrackSynths(trackId)` then `preloadInstrumentsForTracks([{ id, sampleId }])`.

Reconciling from state rather than from an event covers all five origins with one
mechanism: local dispatch, a collaborator's broadcast, an MCP edit, a snapshot
after reconnect, and `LOAD_STATE`. An event-based hook would have covered only
the first.

First observation of a track records without acting, so mounting an existing
session does not dispose synths that were just built for it.

## 9. Bugs this design prevents

Each of these was identified in the existing code before implementation.

1. **No instrument validation on the WebSocket path.** `handleSetTrackSample`
   assigned `msg.sampleId` with no catalog check, so any string could be
   persisted. A later whole-state `PUT`/`PATCH` would then fail
   `validateTrack`'s `VALID_SAMPLE_IDS` check, and the browser would try to load
   an instrument that does not exist. The shared operation validates at the
   message boundary for every transport.
2. **Instrument change silently renamed the track.** `set_track_sample` carried
   a required `name` and `applyMutation` assigned it, so replacing a sound
   destroyed a collaborator's custom label. The new operation has no name field.
3. **Stale per-track synth after an instrument change.** `clearTrackSynths`
   existed for exactly this and had no caller, so a `tone:`/`advanced:` track
   would keep its old synth instance until deleted.
4. **Remote and agent changes had no audio path at all.** Even a correct local
   click handler would have left collaborators hearing the old instrument. The
   reconciler is state-driven for this reason.
5. **Stale FM parameters bleeding into a new preset**, and re-appearing after a
   round trip through a non-FM instrument. See section 4.
6. **`fmParams` is invisible to the state-hash check**, so any client/server
   divergence in the engine-state policy would be undetectable. Solved by one
   implementation, plus a test that asserts the DO result equals the pure result.
7. **Track-list reordering by accident.** Replacing a track object in place is
   required; delete-and-recreate would move the track to the end and lose its ID.
   The operation maps over `tracks` and never appends.
8. **Published sessions.** A new mutating message type that was not added to
   `MUTATING_MESSAGE_TYPES` would be treated as read-only and allowed through on
   an immutable session. The type is in the set, and `types.test.ts` enforces
   that every entry is blocked.
9. **Losing a rejected edit's state.** Returning a fresh object on the error
   path would let a caller assign it and drop concurrent edits. `setTrackInstrument`
   returns the original reference on rejection.

10. **A collapsed panel poisoning accessible-name queries.** This one was not
    predicted; it was caught by the real-Worker E2E lane and is recorded here
    because the fix is part of the design. Rendering the picker while the panel
    was closed left ~100 buttons per track in the document whose accessible
    names ("808 Hat", "Kick", …) are identical to the Add Track picker's. Track
    rows precede the Add Track picker in the DOM, so
    `getByRole('button', { name: /808 Hat/ }).first()` resolved into a
    zero-height panel — clicks timed out, and unqualified queries hit Playwright
    strict-mode violations. Twelve drag-reorder and multiplayer tests failed
    without touching any of their code. `aria-hidden` and `inert` did not
    prevent it. The picker is now mounted only while the panel is open, which
    also stops a ten-track session from rendering the catalog ten times.

11. **An unplaced child of a full grid silently adding a row.** Also not
    predicted, and also caught only by the real-Worker lane. `.track-left` is a
    grid whose explicit template was fully allocated and whose every child is
    placed with `grid-column`. The new toggle had no column, so it was
    auto-placed into an implicit second row and every track row grew from 48px
    to 84px. That moved the vertical centres the drag-reorder helper drops on,
    failing eleven tests with assertions that read like a reordering logic bug.
    jsdom computes no layout, so no component test could see it, and the
    screenshot baselines load a session with zero tracks. Fixed by adding an
    `[instrument]` column; the stylesheet now states the invariant where the
    assignments live. See docs/LESSONS-LEARNED.md lesson 45.

12. **Widening the track row breaking drag during playback.** The third
    unpredicted one. With the row height restored, one test still failed:
    "reorder during playback", 5 passes in 18 runs against 13/13 on
    `origin/main`. Bisecting showed it was not the button but the 40px the new
    column added to `.track-left`: collapsing the column to 0 restored 6/6.
    The drag drops on the row wrapper's horizontal centre, and moving that
    centre interacts badly with the step area's playback auto-scroll. The
    toggle is therefore funded out of measured slack rather than added to the
    row: `[name]` budgeted 100px for an element with a fixed `width: 80px`, and
    `[badge]` budgeted 36px for a badge that renders at 28px. Those 28px pay for
    a 24px toggle and its gap, so `.track-left` stays 508px, the row stays
    1354px, and no existing control changes its rendered size. (Taking the full
    40px from the name column instead kept the geometry right but made names
    overflow into the mute button — caught by a screenshot, not by a number.) Full reorder suite: 75/75, matching baseline. The underlying
    drag/auto-scroll fragility is untouched and remains a real issue; see
    docs/LESSONS-LEARNED.md lesson 46.

## 10. Test plan

Layered so that each check runs at the narrowest seam that still executes
production code, per `specs/TESTING.md`.

**Domain operation** — `app/src/shared/track-instrument.test.ts`
- preserves every unrelated field, per field, explicitly
- rejects unknown `sampleId` and unknown `trackId` with no mutation and the same
  state reference
- no-op when the instrument is unchanged, and that no-op preserves `fmParams`
- clears `fmParams` on a real change, both FM→FM and FM→non-FM
- property: for any catalog instrument and any track, everything except
  `sampleId` and `fmParams` is byte-identical, and track order is unchanged
- property: applying the operation twice equals applying it once (idempotence)

**Reducer / manifest** — existing suites, extended
- `sync-classification.test.ts`, `sync-layer-coverage.test.ts`,
  `mutation-types.test.ts`, `message-types.test.ts`, `worker/types.test.ts`:
  the new action, message, and broadcast are classified, mapped, handled, and
  blocked on published sessions
- `npm run validate:sync` covers the new type's seven-point checklist
- `sync-convergence.property.test.ts` picks the mutation up through
  `arbitraries.ts`, so commutativity and convergence are exercised

**Durable Object + WebSocket** — `app/test/integration/collaboration-contract.test.ts`
- a second connected browser receives `track_instrument_set` and the persisted
  state changed
- steps, p-locks, volume, transpose, stepCount, swing, and a custom name all
  survive
- an invalid `sampleId` and an unknown `trackId` produce no broadcast and no
  state change
- a published session rejects the message
- the DO's result is identical to the pure operation's result (policy parity)

**MCP** — `mcp-edits.test.ts`, `mcp.test.ts`, `app/test/integration/mcp-journeys.test.ts`
- schema rejects an unknown enum member before the adapter is reached
- retry-safe: repeating the edit is a no-op
- a real DO-backed edit broadcasts `track_instrument_set` to a connected browser
- published sessions reject; published sessions stay readable
- documented `#### \`set_track_instrument\`` heading matches `tools/list`
  (enforced by the existing spec-sync test)

**Component** — `SamplePicker.variant.test.tsx`, `TrackRow` / `TrackDrawer` tests
- the `add` variant's markup is unchanged (guards the visual baseline)
- the `change` variant marks the current instrument and commits the catalog ID
- the toggle is absent when the session is published

**Audio** — `useTrackInstrumentReconcile.test.ts`
- a changed `sampleId` clears and re-preloads, for local *and* remote origin
- first render and newly added tracks do not clear
- deleting a track does not leave a stale entry that fires later

**End to end** — `app/e2e/change-instrument.spec.ts` (mock-compatible)
- change a track's instrument in a real browser, assert the pattern and the
  custom name survive and the track keeps its position

## 11. Visual baseline safety

The CI-gated screenshots are the two Holby shots in
`e2e/populated-visual.spec.ts` (macOS job): portrait at 375×812 and landscape at
844×390.

- Portrait renders `PortraitGrid`, which this change does not touch.
- Landscape renders `.track-row` with all drawers closed. The new desktop toggle
  is added to the existing landscape hide list
  (`.step-sequencer[data-orientation="landscape"] .track-left …`), and the new
  panel is hidden in landscape alongside `.fm-controls-panel`. `TrackDrawer`
  returns `null` while closed.

`visual.spec.ts` is `test.skip(isCI)` and its baselines are documented as
local, per-platform artifacts. Its desktop, tablet, and mobile shots load `/`,
which is a session with **zero tracks**, so a new track-row control does not
appear in them. `sample-picker.png` is preserved by keeping the `add` variant's
rendered output unchanged.

## 12. Non-goals

Unchanged from the issue: recorded/custom browser samples, track deletion and
recreation, auth or ownership, undo/redo or an operation journal, and
browser-local preview playback driven through MCP. Portrait mode gains no
instrument control, consistent with it having no add-track picker either.
