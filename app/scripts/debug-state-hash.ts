#!/usr/bin/env npx tsx
/**
 * Debug State Hash Mismatch
 *
 * Fetches persisted session state, canonicalizes it with the same production
 * code used by the browser and Worker, and prints every negotiated hash shape.
 *
 * Usage:
 *   npx tsx scripts/debug-state-hash.ts <session-id>
 *   npx tsx scripts/debug-state-hash.ts <session-id> --local
 *   npx tsx scripts/debug-state-hash.ts <session-id> --reported-hash=<hash>
 */

import {
  canonicalizeForHash,
  hashState,
  projectCanonicalStateForClientHashCapability,
  projectCanonicalStateForServerHashCapability,
  type StateForHash,
} from '../src/shared/canonical-hash';
import { projectCanonicalStateForEnvelopeV2Capability } from '../src/shared/rolling-envelope-state-v2';
import type { Session, SessionTrack } from '../src/shared/state';
import * as path from 'path';
import { fileURLToPath } from 'url';

const PROD_SERVER = 'https://keyboardia.adewale-883.workers.dev';
const LOCAL_SERVER = 'http://localhost:8787';

async function getSession(baseUrl: string, sessionId: string): Promise<Session | null> {
  try {
    const response = await fetch(`${baseUrl}/api/sessions/${sessionId}`);
    if (!response.ok) return null;
    return await response.json() as Session;
  } catch {
    return null;
  }
}

function describeRawTrack(track: SessionTrack, index: number): void {
  console.log(`\n  Track ${index}: ${track.id} (${track.name})`);
  console.log(`    instrument: ${track.sampleId}`);
  console.log(`    raw stepCount: ${String(track.stepCount)}`);
  console.log(`    raw steps/locks: ${track.steps.length}/${track.parameterLocks.length}`);
  console.log(`    raw optional authored fields: ${[
    track.fmParams !== undefined && 'fmParams',
    track.envelope !== undefined && 'envelope',
    track.envelopeTimeUnit !== undefined && 'envelopeTimeUnit',
    track.envelopeV2 !== undefined && 'envelopeV2',
    track.samplePlaybackMode !== undefined && 'samplePlaybackMode',
    track.gate !== undefined && 'gate',
    track.swing !== undefined && 'swing',
    track.pan !== undefined && 'pan',
  ].filter(Boolean).join(', ') || 'none'}`);
  console.log(`    local-only fields: muted=${track.muted}, soloed=${String(track.soloed)}`);
}

export interface NegotiatedHashCandidate {
  label: string;
  hash: string;
  jsonLength: number;
}

/** Compute every capability combination accepted by the browser and Worker. */
export function computeNegotiatedHashCandidates(
  state: StateForHash,
): NegotiatedHashCandidate[] {
  const canonical = canonicalizeForHash(state);
  const candidates: Array<{ label: string; shape: object }> = [];

  for (const [stateLabel, supportsStateHashV2] of [
    ['state-hash-v2', true],
    ['legacy state hash', false],
  ] as const) {
    const hashVersionState = projectCanonicalStateForClientHashCapability(
      canonical,
      supportsStateHashV2,
    );
    for (const [envelopeLabel, supportsEnvelopeV2] of [
      ['track-envelope-v2', true],
      ['pre-envelope', false],
    ] as const) {
      candidates.push({
        label: `browser calculation: ${stateLabel}, ${envelopeLabel}`,
        shape: projectCanonicalStateForEnvelopeV2Capability(
          hashVersionState,
          supportsEnvelopeV2,
        ),
      });
    }
  }

  for (const [stateLabel, supportsStateHashV2] of [
    ['state-hash-v2', true],
    ['legacy state hash', false],
  ] as const) {
    const hashVersionState = projectCanonicalStateForServerHashCapability(
      canonical,
      supportsStateHashV2,
    );
    for (const envelopeTier of ['v2', 'v1', 'pre-envelope'] as const) {
      candidates.push({
        label: `Worker calculation: ${stateLabel}, envelope ${envelopeTier}`,
        shape: projectCanonicalStateForEnvelopeV2Capability(hashVersionState, envelopeTier),
      });
    }
  }

  return candidates.map(({ label, shape }) => ({
    label,
    hash: hashState(shape),
    jsonLength: JSON.stringify(shape).length,
  }));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sessionId = args.find((arg) => !arg.startsWith('--'));
  const useLocal = args.includes('--local');
  const reportedHash = args
    .find((arg) => arg.startsWith('--reported-hash='))
    ?.slice('--reported-hash='.length);

  if (!sessionId) {
    console.log(
      'Usage: npx tsx scripts/debug-state-hash.ts <session-id> [--local] [--reported-hash=<hash>]',
    );
    process.exit(1);
  }

  const baseUrl = useLocal ? LOCAL_SERVER : PROD_SERVER;
  console.log('\nState hash diagnosis');
  console.log(`  Server: ${baseUrl}`);
  console.log(`  Session: ${sessionId}`);

  const session = await getSession(baseUrl, sessionId);
  if (!session) {
    console.error('Session not found');
    process.exit(1);
  }

  console.log('\nPersisted state');
  console.log(`  tempo/swing: ${session.state.tempo}/${session.state.swing}`);
  console.log(`  tracks: ${session.state.tracks.length}`);
  console.log(`  version: ${session.state.version} (excluded from hash)`);
  console.log(`  effects: ${session.state.effects === undefined ? 'defaulted during canonicalization' : 'authored'}`);
  console.log(`  scale: ${session.state.scale === undefined ? 'defaulted during canonicalization' : 'authored'}`);
  console.log(`  loopRegion: ${session.state.loopRegion === undefined ? 'defaulted to null' : JSON.stringify(session.state.loopRegion)}`);
  session.state.tracks.forEach(describeRawTrack);

  const canonical = canonicalizeForHash(session.state);
  const hashes = computeNegotiatedHashCandidates(session.state);

  console.log('\nCanonical track shapes');
  canonical.tracks.forEach((track, index) => {
    console.log(`\n  Track ${index}: ${track.id}`);
    console.log(`    canonical stepCount: ${track.stepCount}`);
    console.log(`    canonical steps/locks: ${track.steps.length}/${track.parameterLocks.length}`);
    console.log(`    hashed fields: ${Object.keys(track).join(', ')}`);
  });

  console.log('\nNegotiated hashes');
  for (const result of hashes) {
    console.log(`  ${result.hash}  ${result.label} (${result.jsonLength} JSON chars)`);
  }

  if (reportedHash) {
    const matches = hashes.filter(({ hash }) => hash === reportedHash);
    console.log(`\nReported hash: ${reportedHash}`);
    if (matches.length === 0) {
      console.log('  No negotiated projection of the persisted state matches.');
      console.log('  Inspect live client state for an authored-state divergence.');
    } else {
      for (const match of matches) console.log(`  Matches: ${match.label}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
