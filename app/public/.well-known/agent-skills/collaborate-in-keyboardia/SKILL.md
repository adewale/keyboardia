---
name: collaborate-in-keyboardia
description: Collaborate in an existing Keyboardia music session through https://keyboardia.dev/mcp. Use when asked to inspect a Keyboardia session, explain its rhythm, add a track or instrument, assign or correct specific steps, set tempo, or join a live human-and-agent jam while preserving unrelated music.
---

# Collaborate in Keyboardia

Use Keyboardia's MCP server as a live collaborative instrument. Make small,
intentional rhythm edits while preserving work that the user, other people, or
other agents did not ask you to change.

## Connect

- Connect a standards-compliant MCP client to `https://keyboardia.dev/mcp`.
- If the server is unavailable in the current toolset, ask the user to configure
  it. Do not emulate MCP writes through Keyboardia's REST API.
- Require an existing session UUID from a Keyboardia `/s/{session_id}` URL.
  Extract the UUID when the user supplies the complete URL.
- Treat an unpublished session UUID as an edit capability. Do not reveal it,
  log it unnecessarily, or place it in public output.

The MCP server does not create sessions. Published sessions are readable and
immutable.

## Use the supported surface

- Use `get_session` to read `immutable`, `tempo`, and compact track patterns.
- Use `edit_session` for exactly one of:
  - `add_track`: add a catalog instrument with safe Keyboardia defaults.
  - `set_steps`: assign booleans to named steps without clearing other steps.
  - `set_tempo`: assign a tempo from 60 through 180 BPM.
- Select `sample_id` values from the live `tools/list` schema. Do not invent
  instrument identifiers.
- Do not claim support for session creation, full-pattern replacement, track
  deletion, renaming, reordering, instrument changes, pitch or note editing,
  volume, mute, solo, swing, effects, parameter locks, undo, or publishing.

## Follow the collaboration workflow

1. Call `get_session` before proposing or making an edit.
2. Identify the user's explicit request and the existing tracks or steps it
   affects.
3. Prefer adding an agent-owned track over changing a collaborator's track.
4. Ask before changing global tempo or an existing track unless the user
   explicitly requested that change.
5. Call `edit_session` with one narrow operation. Group related step
   assignments for one track into one `set_steps` operation.
6. Re-read with `get_session` after the requested edits.
7. Compare the final compact state with the initial read and report the exact
   delta.

If the task is read-only, stop after analysis and do not call `edit_session`.

## Edit safely

- Choose stable agent-owned track IDs such as `agent-house-kick-1`. Use only
  letters, numbers, `.`, `_`, and `-`; never use `:`. Reuse the exact ID when
  retrying the same addition.
- Never reuse a track ID for different content. On `TRACK_ID_CONFLICT`, inspect
  the session and choose a new ID only for a genuinely new track.
- Treat steps as zero-indexed. In a 16-step loop, four-on-the-floor positions
  are `0`, `4`, `8`, and `12`; the user's "step 1" is index `0`.
- Keep every step within the target track's reported `step_count`.
- Use `value: true` to activate and `value: false` to deactivate a named step.
  Do not send duplicate step numbers. Unnamed steps remain unchanged.
- Re-read immediately before editing a field that another collaborator may
  also be changing. Disjoint edits accumulate; the last serialized assignment
  wins when callers assign the same field.
- Retry only the same idempotent assignment after an uncertain response. Do not
  improvise a different edit during a retry.
- Avoid rapid speculative calls. Make only the reads and edits needed for the
  user's task.

There is no revision check, merge UI, operation history, or undo protocol. When
the user's intent is ambiguous, preserve the music and ask.

## Collaborate musically

- Explain rhythmic structure using the current tempo, loop lengths, instruments,
  and active steps.
- Add complementary parts instead of duplicating an existing role unless the
  user asks for layering.
- Keep multi-agent roles separate with stable IDs, for example
  `agent-drummer-kick-1` and `agent-arranger-shaker-1`.
- State structural reasoning rather than claiming to hear the result. Ask the
  user to audition subjective choices in Keyboardia.

For a request such as "add a restrained house groove without changing my
snare," preserve every existing track, add separate agent-owned kick and hi-hat
tracks, set only their requested positions, re-read, and report those additions.

## Handle expected errors

- On `SESSION_NOT_FOUND`, verify the UUID with the user.
- On `SESSION_PUBLISHED`, keep the task read-only and explain that this MCP
  version cannot create a remix.
- On `TRACK_NOT_FOUND`, re-read and ask which current track to edit.
- On `STEP_OUTSIDE_LOOP`, use the reported loop length; do not expand the loop.
- On invalid tempo, instrument, step, or track input, correct the request from
  the live schema or session state before retrying.
- On an unexpected or ambiguous failure, stop. Do not issue compensating edits
  because Keyboardia does not expose undo.
