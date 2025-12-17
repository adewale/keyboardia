#!/usr/bin/env npx tsx
/**
 * Debug State Hash Mismatch
 *
 * This script helps diagnose why client and server state hashes don't match.
 * It fetches a session from the API and compares the hash computation.
 *
 * Usage:
 *   npx tsx scripts/debug-state-hash.ts <session-id>
 *   npx tsx scripts/debug-state-hash.ts <session-id> --local
 */

const PROD_SERVER = 'https://keyboardia.adewale-883.workers.dev';
const LOCAL_SERVER = 'http://localhost:8787';

/**
 * Hash function - identical to both client and server implementations
 * (from src/sync/multiplayer.ts and src/worker/logging.ts)
 */
function hashState(state: unknown): string {
  const str = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

interface Track {
  id: string;
  name: string;
  sampleId: string;
  steps: boolean[];
  parameterLocks: (unknown | null)[];
  volume: number;
  muted: boolean;
  soloed?: boolean;
  playbackMode: string;
  transpose: number;
  stepCount?: number;
}

interface SessionState {
  tracks: Track[];
  tempo: number;
  swing: number;
  effects?: unknown;
  version?: number;
}

interface Session {
  id: string;
  state: SessionState;
}

async function getSession(baseUrl: string, sessionId: string): Promise<Session | null> {
  try {
    const response = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
    if (!response.ok) return null;
    return await response.json() as Session;
  } catch {
    return null;
  }
}

function analyzeTrackStructure(track: Track, index: number): void {
  console.log(`\n  Track ${index}: ${track.id} (${track.name})`);
  console.log(`    steps.length: ${track.steps.length}`);
  console.log(`    parameterLocks.length: ${track.parameterLocks.length}`);
  console.log(`    soloed: ${track.soloed} (type: ${typeof track.soloed})`);
  console.log(`    stepCount: ${track.stepCount} (type: ${typeof track.stepCount})`);
  console.log(`    muted: ${track.muted}`);
  console.log(`    volume: ${track.volume}`);
  console.log(`    transpose: ${track.transpose}`);
  console.log(`    playbackMode: ${track.playbackMode}`);

  // Check for undefined fields that might cause JSON differences
  const trackKeys = Object.keys(track);
  const expectedKeys = ['id', 'name', 'sampleId', 'steps', 'parameterLocks', 'volume', 'muted', 'soloed', 'playbackMode', 'transpose', 'stepCount'];
  const missingKeys = expectedKeys.filter(k => !trackKeys.includes(k));
  const extraKeys = trackKeys.filter(k => !expectedKeys.includes(k));

  if (missingKeys.length > 0) {
    console.log(`    ⚠️  Missing keys: ${missingKeys.join(', ')}`);
  }
  if (extraKeys.length > 0) {
    console.log(`    ⚠️  Extra keys: ${extraKeys.join(', ')}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sessionId = args.find(a => !a.startsWith('--'));
  const useLocal = args.includes('--local');

  if (!sessionId) {
    console.log('Usage: npx tsx scripts/debug-state-hash.ts <session-id> [--local]');
    process.exit(1);
  }

  const baseUrl = useLocal ? LOCAL_SERVER : PROD_SERVER;
  console.log(`\n🔍 Debugging State Hash Mismatch`);
  console.log(`   Server: ${baseUrl}`);
  console.log(`   Session: ${sessionId}`);

  const session = await getSession(baseUrl, sessionId);
  if (!session) {
    console.log('❌ Session not found');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(70));
  console.log('SESSION STATE ANALYSIS');
  console.log('='.repeat(70));

  console.log(`\nTop-level fields:`);
  console.log(`  tempo: ${session.state.tempo}`);
  console.log(`  swing: ${session.state.swing}`);
  console.log(`  tracks: ${session.state.tracks.length} track(s)`);
  console.log(`  version: ${session.state.version} (excluded from hash)`);
  console.log(`  effects: ${session.state.effects ? 'present' : 'undefined'}`);

  console.log('\n' + '-'.repeat(70));
  console.log('TRACK STRUCTURE ANALYSIS');
  console.log('-'.repeat(70));

  session.state.tracks.forEach((track, i) => {
    analyzeTrackStructure(track, i);
  });

  console.log('\n' + '-'.repeat(70));
  console.log('HASH COMPUTATION COMPARISON');
  console.log('-'.repeat(70));

  // Server hashes this (from live-session.ts handleStateHash):
  const serverHashInput = {
    tracks: session.state.tracks,
    tempo: session.state.tempo,
    swing: session.state.swing,
  };

  // Client hashes this (from App.tsx getStateForHash):
  // Same structure, but client state may have different field presence
  const _clientHashInput = {
    tracks: session.state.tracks,
    tempo: session.state.tempo,
    swing: session.state.swing,
  };

  console.log(`\nServer hash input (JSON):`);
  const serverJson = JSON.stringify(serverHashInput);
  console.log(`  Length: ${serverJson.length} chars`);
  console.log(`  Hash: ${hashState(serverHashInput)}`);

  // Simulate what client would have if fields are normalized
  const normalizedTracks = session.state.tracks.map(track => ({
    ...track,
    // Ensure all optional fields have explicit values
    soloed: track.soloed ?? false,
    stepCount: track.stepCount ?? 16,
  }));

  const normalizedClientInput = {
    tracks: normalizedTracks,
    tempo: session.state.tempo,
    swing: session.state.swing,
  };

  console.log(`\nNormalized client hash input (with defaults):`);
  const normalizedJson = JSON.stringify(normalizedClientInput);
  console.log(`  Length: ${normalizedJson.length} chars`);
  console.log(`  Hash: ${hashState(normalizedClientInput)}`);

  // Check if JSON differs
  if (serverJson !== normalizedJson) {
    console.log(`\n⚠️  JSON DIFFERS!`);

    // Find the difference
    const serverParsed = JSON.parse(serverJson);
    const clientParsed = JSON.parse(normalizedJson);

    // Compare track by track
    for (let i = 0; i < Math.max(serverParsed.tracks.length, clientParsed.tracks.length); i++) {
      const serverTrack = JSON.stringify(serverParsed.tracks[i] || {});
      const clientTrack = JSON.stringify(clientParsed.tracks[i] || {});

      if (serverTrack !== clientTrack) {
        console.log(`\n  Track ${i} differs:`);
        console.log(`    Server: ${serverTrack.substring(0, 200)}...`);
        console.log(`    Client: ${clientTrack.substring(0, 200)}...`);

        // Find specific field differences
        const sTrack = serverParsed.tracks[i] || {};
        const cTrack = clientParsed.tracks[i] || {};
        const allKeys = new Set([...Object.keys(sTrack), ...Object.keys(cTrack)]);

        for (const key of allKeys) {
          const sVal = JSON.stringify(sTrack[key]);
          const cVal = JSON.stringify(cTrack[key]);
          if (sVal !== cVal) {
            console.log(`      Field '${key}': server=${sVal}, client=${cVal}`);
          }
        }
      }
    }
  } else {
    console.log(`\n✅ JSON matches after normalization`);
  }

  // Check for array length mismatches (likely cause)
  console.log('\n' + '-'.repeat(70));
  console.log('ARRAY LENGTH ANALYSIS');
  console.log('-'.repeat(70));

  for (const track of session.state.tracks) {
    const stepsLen = track.steps.length;
    const locksLen = track.parameterLocks.length;

    if (stepsLen !== 128 || locksLen !== 128) {
      console.log(`\n  ⚠️  Track ${track.id}: steps=${stepsLen}, parameterLocks=${locksLen}`);
      console.log(`      Expected: 128 for both arrays`);
      console.log(`      This could cause hash mismatch if client has 128 but server has ${stepsLen}`);
    }
  }

  // Simulate client with 128-element arrays
  console.log('\n' + '-'.repeat(70));
  console.log('SIMULATED CLIENT STATE (128-element arrays)');
  console.log('-'.repeat(70));

  const clientSimulatedTracks = session.state.tracks.map(track => {
    // Client reducer initializes tracks with 128 steps
    const steps = [...track.steps];
    const parameterLocks = [...track.parameterLocks];

    while (steps.length < 128) steps.push(false);
    while (parameterLocks.length < 128) parameterLocks.push(null);

    return {
      ...track,
      steps,
      parameterLocks,
      soloed: track.soloed ?? false,
      stepCount: track.stepCount ?? 16,
    };
  });

  const clientSimulatedInput = {
    tracks: clientSimulatedTracks,
    tempo: session.state.tempo,
    swing: session.state.swing,
  };

  const clientSimulatedJson = JSON.stringify(clientSimulatedInput);
  console.log(`\n  Simulated client JSON length: ${clientSimulatedJson.length} chars`);
  console.log(`  Simulated client hash: ${hashState(clientSimulatedInput)}`);

  console.log(`\n  Server hash: ${hashState(serverHashInput)}`);

  if (hashState(clientSimulatedInput) === hashState(serverHashInput)) {
    console.log(`\n  ✅ Hashes match after client simulation!`);
  } else {
    console.log(`\n  ❌ Hashes still differ - there's another cause`);

    // Detailed byte-by-byte comparison
    console.log('\n' + '-'.repeat(70));
    console.log('DETAILED JSON COMPARISON');
    console.log('-'.repeat(70));

    // Find first difference
    for (let i = 0; i < Math.max(serverJson.length, clientSimulatedJson.length); i++) {
      if (serverJson[i] !== clientSimulatedJson[i]) {
        const start = Math.max(0, i - 50);
        const end = Math.min(Math.max(serverJson.length, clientSimulatedJson.length), i + 50);
        console.log(`\n  First difference at position ${i}:`);
        console.log(`  Server context: ...${serverJson.substring(start, end)}...`);
        console.log(`  Client context: ...${clientSimulatedJson.substring(start, end)}...`);
        console.log(`  Server char: '${serverJson[i]}' (${serverJson.charCodeAt(i)})`);
        console.log(`  Client char: '${clientSimulatedJson[i]}' (${clientSimulatedJson.charCodeAt(i)})`);
        break;
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const issues: string[] = [];

  // Check for optional field issues
  for (const track of session.state.tracks) {
    if (track.soloed === undefined) {
      issues.push(`Track ${track.id}: 'soloed' is undefined (server) but boolean (client)`);
    }
    if (track.stepCount === undefined) {
      issues.push(`Track ${track.id}: 'stepCount' is undefined (server) but number (client)`);
    }
    if (track.steps.length !== 128) {
      issues.push(`Track ${track.id}: steps.length is ${track.steps.length} (server) but 128 (client)`);
    }
    if (track.parameterLocks.length !== 128) {
      issues.push(`Track ${track.id}: parameterLocks.length is ${track.parameterLocks.length} (server) but 128 (client)`);
    }
  }

  if (issues.length > 0) {
    console.log('\n❌ POTENTIAL CAUSES OF HASH MISMATCH:');
    issues.forEach((issue, i) => {
      console.log(`   ${i + 1}. ${issue}`);
    });
    console.log('\n💡 RECOMMENDATION:');
    console.log('   The server and client track structures need normalization before hashing.');
    console.log('   Options:');
    console.log('   1. Server: Ensure all optional fields have explicit values before hashing');
    console.log('   2. Client: Hash only the fields that server sends (exclude undefined fields)');
    console.log('   3. Both: Use a canonical JSON serialization that handles undefined consistently');
  } else {
    console.log('\n✅ No obvious structural issues found');
    console.log('   The mismatch may be due to runtime state differences, not structural issues.');
  }

  console.log('\n');
}

main().catch(console.error);
