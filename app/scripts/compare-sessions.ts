#!/usr/bin/env npx tsx
/**
 * Compare multiple sessions to identify data loss patterns
 *
 * Usage:
 *   npx tsx scripts/compare-sessions.ts <session-id-1> <session-id-2> ...
 *   npx tsx scripts/compare-sessions.ts --broken   # Check known broken sessions
 *   npx tsx scripts/compare-sessions.ts --demos    # Check demo sessions
 */

const API_BASE = process.env.API_BASE || 'https://keyboardia.adewale-883.workers.dev';

// Known sessions for testing
const BROKEN_SESSIONS = [
  'dcfdfc35-f356-4d2b-85c1-513f79f7deb8',
  'a16f92a8-8484-4661-aad3-714931409d72',
];

const DEMO_SESSIONS = [
  'polyrhythmic-evolution',
  'extended-afrobeat',
  'ambient-soundscape',
  'electronic-leads',
  'synth-bass-showcase',
];

const KNOWN_WORKING_SESSIONS = [
  '3bfc6de1-b2c1-4f18-a34f-6f0abb92c53f',
  '4c889c91-1c43-4c4a-ab8a-4a2bff3f50fd',
];

interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  state: {
    tracks: unknown[];
    tempo: number;
    swing: number;
  };
}

async function fetchSession(sessionId: string): Promise<Session | null> {
  try {
    const response = await fetch(`${API_BASE}/api/sessions/${sessionId}`);
    if (!response.ok) return null;
    return await response.json() as Session;
  } catch {
    return null;
  }
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
}

async function analyzeSession(sessionId: string): Promise<{
  id: string;
  exists: boolean;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
  createdRecently: boolean;
  updatedRecently: boolean;
  possibleDataLoss: boolean;
}> {
  const session = await fetchSession(sessionId);
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  if (!session) {
    return {
      id: sessionId,
      exists: false,
      trackCount: 0,
      createdAt: 'N/A',
      updatedAt: 'N/A',
      createdRecently: false,
      updatedRecently: false,
      possibleDataLoss: false,
    };
  }

  const createdRecently = session.createdAt > oneDayAgo;
  const updatedRecently = session.updatedAt > oneHourAgo;
  const trackCount = session.state.tracks.length;

  // Possible data loss: session exists, was updated recently, but has no tracks
  const possibleDataLoss = trackCount === 0 && updatedRecently && session.createdAt < session.updatedAt;

  return {
    id: sessionId,
    exists: true,
    trackCount,
    createdAt: formatTimestamp(session.createdAt),
    updatedAt: formatTimestamp(session.updatedAt),
    createdRecently,
    updatedRecently,
    possibleDataLoss,
  };
}

async function main() {
  const args = process.argv.slice(2);

  let sessionIds: string[] = [];

  if (args.includes('--broken')) {
    sessionIds = BROKEN_SESSIONS;
    console.log('\n📋 Checking known broken sessions...');
  } else if (args.includes('--demos')) {
    sessionIds = DEMO_SESSIONS;
    console.log('\n📋 Checking demo sessions...');
  } else if (args.includes('--working')) {
    sessionIds = KNOWN_WORKING_SESSIONS;
    console.log('\n📋 Checking known working sessions...');
  } else if (args.includes('--all')) {
    sessionIds = [...BROKEN_SESSIONS, ...KNOWN_WORKING_SESSIONS];
    console.log('\n📋 Checking all known sessions...');
  } else if (args.length > 0 && !args[0].startsWith('--')) {
    sessionIds = args.filter(a => !a.startsWith('--'));
    console.log(`\n📋 Checking ${sessionIds.length} sessions...`);
  } else {
    console.log('Usage: npx tsx scripts/compare-sessions.ts <session-id> [...]');
    console.log('       npx tsx scripts/compare-sessions.ts --broken');
    console.log('       npx tsx scripts/compare-sessions.ts --demos');
    console.log('       npx tsx scripts/compare-sessions.ts --working');
    console.log('       npx tsx scripts/compare-sessions.ts --all');
    process.exit(1);
  }

  console.log('\n' + '='.repeat(90));
  console.log('SESSION COMPARISON');
  console.log('='.repeat(90));

  const results = await Promise.all(sessionIds.map(analyzeSession));

  // Print table header
  console.log('\n' +
    'Session ID'.padEnd(38) +
    'Tracks'.padStart(8) +
    'Created'.padStart(22) +
    'Updated'.padStart(22) +
    'Status'.padStart(15)
  );
  console.log('-'.repeat(105));

  let dataLossCount = 0;
  let notFoundCount = 0;
  let healthyCount = 0;

  for (const result of results) {
    const idShort = result.id.length > 36 ? result.id : result.id.slice(0, 36);

    let status: string;
    if (!result.exists) {
      status = '❌ NOT FOUND';
      notFoundCount++;
    } else if (result.possibleDataLoss) {
      status = '⚠️  DATA LOSS?';
      dataLossCount++;
    } else if (result.trackCount === 0) {
      status = '⚪ EMPTY';
    } else {
      status = '✅ OK';
      healthyCount++;
    }

    console.log(
      idShort.padEnd(38) +
      result.trackCount.toString().padStart(8) +
      result.createdAt.padStart(22) +
      result.updatedAt.padStart(22) +
      status.padStart(15)
    );
  }

  console.log('-'.repeat(105));

  // Summary
  console.log('\n📊 Summary:');
  console.log(`  Total checked:    ${results.length}`);
  console.log(`  Healthy:          ${healthyCount}`);
  console.log(`  Empty (new?):     ${results.filter(r => r.exists && r.trackCount === 0 && !r.possibleDataLoss).length}`);
  console.log(`  Possible loss:    ${dataLossCount}`);
  console.log(`  Not found:        ${notFoundCount}`);

  if (dataLossCount > 0) {
    console.log('\n⚠️  Sessions with possible data loss:');
    for (const result of results.filter(r => r.possibleDataLoss)) {
      console.log(`    - ${result.id}`);
      console.log(`      Created: ${result.createdAt}, Updated: ${result.updatedAt}`);
    }
  }

  console.log('\n' + '='.repeat(90) + '\n');
}

main().catch(console.error);
