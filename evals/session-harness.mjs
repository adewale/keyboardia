/**
 * Creates and reads back disposable Keyboardia sessions for execution cases.
 *
 * Each run gets its own session built from the case's declared `setup`, so runs
 * cannot contaminate each other and the scoring baseline is exactly known
 * rather than inferred.
 *
 * Talks to the ordinary REST API, so it works against `wrangler dev`, a staging
 * deployment, or anything else that serves Keyboardia.
 */
import { MAX_STEPS, DEFAULT_STEP_COUNT } from './constants.mjs';

/**
 * The persisted track shape is wider than the compact MCP view: a full
 * 128-slot steps array with `stepCount` selecting the live window, and a
 * parameterLocks array of the same length. Session invariants reject anything
 * else, so build it here rather than in every case.
 */
function buildTrack({ id, name, sample_id, active_steps = [], step_count = DEFAULT_STEP_COUNT }) {
  const steps = Array(MAX_STEPS).fill(false);
  for (const step of active_steps) {
    steps[step] = true;
  }
  return {
    id,
    name,
    sampleId: sample_id,
    steps,
    parameterLocks: Array(MAX_STEPS).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: step_count,
  };
}

export async function createSession(baseUrl, setup) {
  const response = await fetch(new URL('/api/sessions', baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: setup.name ?? 'eval session',
      state: {
        tracks: (setup.tracks ?? []).map(buildTrack),
        tempo: setup.tempo ?? 120,
        swing: 0,
        version: 1,
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`create session failed: ${response.status} ${await response.text()}`);
  }
  return (await response.json()).id;
}

/**
 * Reads the session back through the MCP surface itself, so the scored view is
 * the same compact shape the agent saw rather than a parallel REST projection
 * that could drift from it.
 */
export async function readCompactSession(baseUrl, sessionId) {
  const response = await fetch(new URL('/mcp', baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_session', arguments: { session_id: sessionId } },
    }),
  });
  const text = await response.text();
  // The endpoint answers as SSE; the payload is the last `data:` line.
  const payloads = text.split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim());
  if (payloads.length === 0) {
    throw new Error(`no MCP payload in response: ${text.slice(0, 200)}`);
  }
  const message = JSON.parse(payloads[payloads.length - 1]);
  const structured = message.result?.structuredContent;
  if (!structured) {
    throw new Error(`get_session returned no session: ${JSON.stringify(message).slice(0, 300)}`);
  }
  return structured;
}

export async function isReachable(baseUrl) {
  try {
    const response = await fetch(new URL('/api/health', baseUrl));
    return response.ok;
  } catch {
    return false;
  }
}
