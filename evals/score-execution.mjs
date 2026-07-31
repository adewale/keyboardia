/**
 * Structural scoring for execution-graded cases.
 *
 * Everything here reads the final session state or the ordered tool calls.
 * Nothing reads the model's prose, which is the point: rewording an answer
 * cannot move any score computed by this module.
 *
 * Pure and dependency-free so it can be unit-tested and replayed against
 * recorded runs with no Worker and no credentials.
 */

/** Active steps of the one track with this id, or null when absent. */
function trackById(session, trackId) {
  return session?.tracks?.find((track) => track.track_id === trackId) ?? null;
}

function sameSteps(left, right) {
  return Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((step, index) => step === right[index]);
}

function readConfirmsEdit(editCall, session) {
  const edit = editCall.arguments?.edit;
  const tracks = session?.tracks ?? [];
  if (!edit || !Array.isArray(tracks)) return false;
  const track = tracks.find((candidate) => candidate.track_id === edit.track_id);
  switch (edit.operation) {
    case 'add_track':
      return track?.sample_id === edit.sample_id;
    case 'set_steps': {
      if (!track || !Array.isArray(track.active_steps)) return false;
      const active = new Set(track.active_steps);
      return (edit.changes ?? []).every((change) =>
        change.value === true ? active.has(change.step) : !active.has(change.step));
    }
    case 'set_track_instrument':
      return track?.sample_id === edit.sample_id;
    case 'set_tempo':
      return session.tempo === edit.tempo;
    default:
      return false;
  }
}

/**
 * `state` assertions compare the post-run session against the case's baseline.
 * Each returns a plain boolean; there is no partial credit, because "mostly
 * preserved the snare" is not a thing a collaborator would accept.
 */
export function scoreStateAssertion(assertion, { baseline, final }) {
  switch (assertion.check) {
    // The target track's active steps are exactly this set. Identify it by
    // `track_id`, or by `sample_id` when the agent chooses the id itself — in
    // which case exactly one track of that instrument must exist, so an agent
    // cannot pass by adding several and hoping one matches.
    case 'active_steps_equal': {
      if (assertion.track_id) {
        const track = trackById(final, assertion.track_id);
        return track !== null && sameSteps(track.active_steps, assertion.value);
      }
      const candidates = (final?.tracks ?? [])
        .filter((track) => track.sample_id === assertion.sample_id);
      return candidates.length === 1 && sameSteps(candidates[0].active_steps, assertion.value);
    }

    // The named tracks come back byte-for-byte identical to the baseline.
    // This is the collaboration invariant: whatever else happened, these were
    // not touched.
    case 'tracks_preserved': {
      return assertion.track_ids.every((trackId) => {
        const before = trackById(baseline, trackId);
        const after = trackById(final, trackId);
        return before !== null && after !== null &&
          JSON.stringify(before) === JSON.stringify(after);
      });
    }

    case 'tempo_equals':
      return final?.tempo === assertion.value;

    case 'tempo_unchanged':
      return final?.tempo === baseline?.tempo;

    // No track beyond the baseline's, except ones the case allows.
    case 'no_extra_tracks': {
      const baselineIds = new Set((baseline?.tracks ?? []).map((track) => track.track_id));
      const added = (final?.tracks ?? []).filter((track) => !baselineIds.has(track.track_id));
      return added.length <= (assertion.allow_added ?? 0);
    }

    case 'track_count_equals':
      return (final?.tracks ?? []).length === assertion.value;

    default:
      throw new Error(`Unknown state check: ${assertion.check}`);
  }
}

/**
 * `trace` assertions read the ordered list of tool calls the agent actually
 * made. This is where "read before writing" stops being a claim in prose and
 * becomes an observation.
 */
export function scoreTraceAssertion(assertion, trace) {
  // A tool attempt becomes evaluation evidence only after its correlated
  // result succeeds. Every trace assertion uses this same closed set.
  const calls = (trace ?? []).filter((call) => call.success === true);
  const names = calls.map((call) => call.name);

  switch (assertion.check) {
    // Every listed name appears, in this relative order, allowing other calls
    // in between. An attempted call is not evidence: every call in the chain
    // must have a correlated successful tool_result.
    case 'call_order': {
      const successfulNames = names;
      let cursor = 0;
      for (const expected of assertion.value) {
        const found = successfulNames.indexOf(expected, cursor);
        if (found === -1) {
          return false;
        }
        cursor = found + 1;
      }
      return true;
    }

    // Every successful or uncertain mutation is immediately closed by a
    // successful read of the same session. A correlated `success: false` is a
    // definite rejection and cannot have changed state, so it needs no read.
    // Successful edits must also be visible in the authoritative read.
    case 'edit_followed_by_read': {
      const allCalls = trace ?? [];
      const edits = allCalls
        .map((call, index) => [call, index])
        .filter(([call]) => call.name === 'edit_session' && call.success !== false);
      return edits.some(([edit]) => edit.success === true) && edits.every(([edit, index]) => {
        const read = allCalls[index + 1];
        return read?.name === 'get_session'
          && read.success === true
          && read.arguments?.session_id === edit.arguments?.session_id
          && read.result?.session_id === edit.arguments?.session_id
          && (edit.success !== true || readConfirmsEdit(edit, read.result));
      });
    }

    case 'call_count_le':
      return names.filter((name) => name === assertion.call).length <= assertion.value;

    case 'call_count_equals':
      return names.filter((name) => name === assertion.call).length === assertion.value;

    // No edit_session call carried this operation.
    case 'no_operation':
      return !calls.some((call) => call.arguments?.edit?.operation === assertion.value);

    // Every set_steps call stayed inside the track's loop.
    case 'steps_within': {
      return calls
        .filter((call) => call.arguments?.edit?.operation === 'set_steps')
        .every((call) => (call.arguments.edit.changes ?? []).every(
          (change) => Number.isInteger(change.step) &&
            change.step >= 0 && change.step < assertion.value
        ));
    }

    // No set_steps call repeats a step index within one changes array.
    case 'no_duplicate_steps': {
      return calls
        .filter((call) => call.arguments?.edit?.operation === 'set_steps')
        .every((call) => {
          const steps = (call.arguments.edit.changes ?? []).map((change) => change.step);
          return new Set(steps).size === steps.length;
        });
    }

    // No edit_session call targeted any of these track ids.
    case 'tracks_untouched': {
      const forbidden = new Set(assertion.track_ids);
      return !calls.some((call) =>
        call.name === 'edit_session' && forbidden.has(call.arguments?.edit?.track_id));
    }

    // Every add_track used a caller-chosen id matching this pattern. The skill
    // requires a collision-resistant suffix; a plain "user-kick" collides with
    // whatever a human names their own track.
    case 'added_track_id_matches': {
      const adds = calls.filter((call) => call.arguments?.edit?.operation === 'add_track');
      const pattern = new RegExp(assertion.value);
      return adds.length > 0 && adds.every((call) => pattern.test(call.arguments.edit.track_id ?? ''));
    }

    case 'made_no_edits':
      return !names.includes('edit_session');

    default:
      throw new Error(`Unknown trace check: ${assertion.check}`);
  }
}

export function scoreExecution(assertions, { baseline, final, trace }) {
  return assertions.map((assertion) => {
    const passed = assertion.type === 'state'
      ? scoreStateAssertion(assertion, { baseline, final })
      : scoreTraceAssertion(assertion, trace);
    return {
      name: assertion.name,
      type: assertion.type,
      severity: assertion.severity ?? 'gate',
      passed,
    };
  });
}
