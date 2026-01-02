#!/usr/bin/env npx tsx
/**
 * Session Diff Tool
 *
 * Downloads two sessions, normalizes them using Keyboardia's text notation,
 * and shows only the musical differences.
 *
 * Tracks are matched by CONTENT (sample + pattern + settings), not by ID.
 * Identical tracks are not shown.
 *
 * Output format follows specs/research/SESSION-NOTATION-RESEARCH.md:
 *   TrackName: x---x---x---x--- [sample:kick, transpose:0]
 *
 * Usage:
 *   npx tsx scripts/diff-sessions.ts <session1> <session2>
 */

import type { Session, SessionTrack } from '../src/shared/state';
import type { ParameterLock } from '../src/shared/sync-types';

// ============================================================================
// Environment Detection
// ============================================================================

type Environment = 'local' | 'staging' | 'production';

interface ParsedSession {
  id: string;
  environment: Environment;
  apiUrl: string;
}

const ENVIRONMENT_CONFIGS: Record<Environment, { baseUrl: string; displayName: string }> = {
  local: { baseUrl: 'http://localhost:5173/api/sessions', displayName: 'Local' },
  staging: { baseUrl: 'https://staging.keyboardia.dev/api/sessions', displayName: 'Staging' },
  production: { baseUrl: 'https://keyboardia.dev/api/sessions', displayName: 'Production' },
};

function parseSessionInput(input: string): ParsedSession {
  const urlPatterns = [
    { pattern: /^https?:\/\/localhost[:\d]*\/s\/([a-f0-9-]+)/i, env: 'local' as Environment },
    { pattern: /^https?:\/\/staging\.keyboardia\.dev\/s\/([a-f0-9-]+)/i, env: 'staging' as Environment },
    { pattern: /^https?:\/\/keyboardia\.dev\/s\/([a-f0-9-]+)/i, env: 'production' as Environment },
    { pattern: /^https?:\/\/localhost[:\d]*\/api\/sessions\/([a-f0-9-]+)/i, env: 'local' as Environment },
    { pattern: /^https?:\/\/staging\.keyboardia\.dev\/api\/sessions\/([a-f0-9-]+)/i, env: 'staging' as Environment },
    { pattern: /^https?:\/\/keyboardia\.dev\/api\/sessions\/([a-f0-9-]+)/i, env: 'production' as Environment },
  ];

  for (const { pattern, env } of urlPatterns) {
    const match = input.match(pattern);
    if (match) {
      return { id: match[1], environment: env, apiUrl: `${ENVIRONMENT_CONFIGS[env].baseUrl}/${match[1]}` };
    }
  }

  const id = input.trim();
  if (/^[a-f0-9-]+$/i.test(id)) {
    return { id, environment: 'production', apiUrl: `${ENVIRONMENT_CONFIGS.production.baseUrl}/${id}` };
  }

  throw new Error(`Invalid session input: ${input}`);
}

// ============================================================================
// Session Fetching
// ============================================================================

async function fetchSession(parsed: ParsedSession): Promise<Session> {
  const response = await fetch(parsed.apiUrl);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch ${parsed.id}: ${response.status} ${text}`);
  }
  return response.json() as Promise<Session>;
}

// ============================================================================
// Text Notation Format (per SESSION-NOTATION-RESEARCH.md)
// ============================================================================

/**
 * Convert steps to notation: x = on, - = off, o = ghost, X = accent
 */
function stepsToNotation(steps: boolean[], plocks: (ParameterLock | null)[], stepCount: number): string {
  const chars: string[] = [];
  for (let i = 0; i < stepCount; i++) {
    const step = steps[i] ?? false;
    const plock = plocks[i];

    if (!step) {
      chars.push('-');
    } else if (plock?.volume !== undefined && plock.volume < 0.5) {
      chars.push('o'); // ghost note
    } else if (plock?.volume !== undefined && plock.volume > 1.2) {
      chars.push('X'); // accent
    } else {
      chars.push('x');
    }
  }
  return chars.join('');
}

/**
 * Format pitch plocks as a sequence: [pitches:0,7,5,3]
 */
function formatPitchSequence(plocks: (ParameterLock | null)[], stepCount: number): string | null {
  const pitches: (number | null)[] = [];
  let hasPitch = false;

  for (let i = 0; i < stepCount; i++) {
    const p = plocks[i]?.pitch;
    if (p !== undefined) {
      pitches.push(p);
      hasPitch = true;
    } else {
      pitches.push(null);
    }
  }

  if (!hasPitch) return null;

  // Compact format: only show non-null pitches with their indices
  const parts: string[] = [];
  pitches.forEach((p, i) => {
    if (p !== null) {
      parts.push(`${i}:${p >= 0 ? '+' : ''}${p}`);
    }
  });
  return parts.join(',');
}

/**
 * Format ties as indices: [ties:1,3,7]
 */
function formatTies(plocks: (ParameterLock | null)[], stepCount: number): string | null {
  const tieIndices: number[] = [];
  for (let i = 0; i < stepCount; i++) {
    if (plocks[i]?.tie) {
      tieIndices.push(i);
    }
  }
  return tieIndices.length > 0 ? tieIndices.join(',') : null;
}

/**
 * Convert track to text notation format:
 * TrackName: x---x---x---x--- [sample:kick, transpose:0]
 */
function trackToNotation(track: SessionTrack): string {
  const stepCount = track.stepCount ?? 16;
  const pattern = stepsToNotation(track.steps, track.parameterLocks, stepCount);

  // Build metadata annotations
  const meta: string[] = [];
  meta.push(`sample:${track.sampleId}`);

  if (track.transpose !== 0) meta.push(`transpose:${track.transpose}`);
  if (track.volume !== 1) meta.push(`vol:${track.volume}`);
  if (track.muted) meta.push('muted');
  if (track.soloed) meta.push('soloed');
  if (stepCount !== 16) meta.push(`steps:${stepCount}`);

  const pitches = formatPitchSequence(track.parameterLocks, stepCount);
  if (pitches) meta.push(`pitches:${pitches}`);

  const ties = formatTies(track.parameterLocks, stepCount);
  if (ties) meta.push(`ties:${ties}`);

  return `${track.name}: ${pattern} [${meta.join(', ')}]`;
}

/**
 * Create a content hash for matching tracks by musical content (ignoring ID and name)
 */
function trackContentHash(track: SessionTrack): string {
  const stepCount = track.stepCount ?? 16;
  return JSON.stringify({
    sampleId: track.sampleId,
    steps: track.steps.slice(0, stepCount),
    parameterLocks: track.parameterLocks.slice(0, stepCount),
    transpose: track.transpose,
    volume: track.volume,
    muted: track.muted,
    soloed: track.soloed ?? false,
    stepCount,
  });
}

// ============================================================================
// Session Comparison
// ============================================================================

interface TrackMatch {
  track1: SessionTrack;
  track2: SessionTrack;
  identical: boolean;
  nameDiffers: boolean;
}

function matchTracksByContent(
  tracks1: SessionTrack[],
  tracks2: SessionTrack[]
): {
  matched: TrackMatch[];
  onlyIn1: SessionTrack[];
  onlyIn2: SessionTrack[];
} {
  const hash1 = new Map<string, SessionTrack>();
  const hash2 = new Map<string, SessionTrack>();

  // Build content hash maps
  for (const t of tracks1) {
    hash1.set(trackContentHash(t), t);
  }
  for (const t of tracks2) {
    hash2.set(trackContentHash(t), t);
  }

  const matched: TrackMatch[] = [];
  const onlyIn1: SessionTrack[] = [];
  const onlyIn2: SessionTrack[] = [];
  const matchedHashes2 = new Set<string>();

  // Find matches
  for (const [hash, track1] of hash1) {
    if (hash2.has(hash)) {
      const track2 = hash2.get(hash)!;
      matched.push({
        track1,
        track2,
        identical: true,
        nameDiffers: track1.name !== track2.name,
      });
      matchedHashes2.add(hash);
    } else {
      onlyIn1.push(track1);
    }
  }

  // Find unmatched in session 2
  for (const [hash, track2] of hash2) {
    if (!matchedHashes2.has(hash)) {
      onlyIn2.push(track2);
    }
  }

  return { matched, onlyIn1, onlyIn2 };
}

function printSessionDiff(
  session1: Session,
  session2: Session,
  parsed1: ParsedSession,
  parsed2: ParsedSession
): void {
  console.log(`--- ${parsed1.environment}/${parsed1.id}`);
  console.log(`+++ ${parsed2.environment}/${parsed2.id}`);
  console.log('');

  // Session-level differences
  const stateDiffs: string[] = [];

  if (session1.name !== session2.name) {
    stateDiffs.push(`name: "${session1.name}" → "${session2.name}"`);
  }
  if (session1.state.tempo !== session2.state.tempo) {
    stateDiffs.push(`tempo: ${session1.state.tempo} → ${session2.state.tempo}`);
  }
  if (session1.state.swing !== session2.state.swing) {
    stateDiffs.push(`swing: ${session1.state.swing} → ${session2.state.swing}`);
  }
  if (session1.immutable !== session2.immutable) {
    stateDiffs.push(`immutable: ${session1.immutable} → ${session2.immutable}`);
  }

  // Scale
  const s1 = session1.state.scale;
  const s2 = session2.state.scale;
  const scaleStr1 = s1 ? `${s1.root} ${s1.scaleId}${s1.locked ? ' locked' : ''}` : 'none';
  const scaleStr2 = s2 ? `${s2.root} ${s2.scaleId}${s2.locked ? ' locked' : ''}` : 'none';
  if (scaleStr1 !== scaleStr2) {
    stateDiffs.push(`scale: ${scaleStr1} → ${scaleStr2}`);
  }

  // Loop region
  const l1 = session1.state.loopRegion;
  const l2 = session2.state.loopRegion;
  const loopStr1 = l1 ? `${l1.start}-${l1.end}` : 'none';
  const loopStr2 = l2 ? `${l2.start}-${l2.end}` : 'none';
  if (loopStr1 !== loopStr2) {
    stateDiffs.push(`loopRegion: ${loopStr1} → ${loopStr2}`);
  }

  // Match tracks by content
  const { matched, onlyIn1, onlyIn2 } = matchTracksByContent(
    session1.state.tracks,
    session2.state.tracks
  );

  // Count actual differences
  const renamedTracks = matched.filter(m => m.nameDiffers);
  const hasDifferences = stateDiffs.length > 0 || onlyIn1.length > 0 || onlyIn2.length > 0 || renamedTracks.length > 0;

  if (!hasDifferences) {
    console.log('Sessions are musically identical.');
    console.log(`(${matched.length} tracks match by content)`);
    return;
  }

  // Print session-level diffs
  if (stateDiffs.length > 0) {
    console.log('Session:');
    for (const diff of stateDiffs) {
      console.log(`  ${diff}`);
    }
    console.log('');
  }

  // Print removed tracks
  if (onlyIn1.length > 0) {
    console.log('Removed:');
    for (const track of onlyIn1) {
      console.log(`- ${trackToNotation(track)}`);
    }
    console.log('');
  }

  // Print added tracks
  if (onlyIn2.length > 0) {
    console.log('Added:');
    for (const track of onlyIn2) {
      console.log(`+ ${trackToNotation(track)}`);
    }
    console.log('');
  }

  // Print renamed tracks (same content, different name)
  if (renamedTracks.length > 0) {
    console.log('Renamed:');
    for (const { track1, track2 } of renamedTracks) {
      console.log(`~ "${track1.name}" → "${track2.name}"`);
    }
    console.log('');
  }

  // Summary
  console.log('Summary:');
  if (stateDiffs.length > 0) console.log(`  ${stateDiffs.length} session setting(s) changed`);
  if (onlyIn1.length > 0) console.log(`  ${onlyIn1.length} track(s) removed`);
  if (onlyIn2.length > 0) console.log(`  ${onlyIn2.length} track(s) added`);
  if (renamedTracks.length > 0) console.log(`  ${renamedTracks.length} track(s) renamed`);
  const identicalCount = matched.length - renamedTracks.length;
  if (identicalCount > 0) console.log(`  ${identicalCount} track(s) identical`);
}

// ============================================================================
// CLI
// ============================================================================

function printUsage(): void {
  console.log(`
Session Diff Tool - Compare two Keyboardia sessions

Shows only MUSICAL differences. Tracks matched by content, not ID.

Usage:
  npx tsx scripts/diff-sessions.ts <session1> <session2>

Output format (per SESSION-NOTATION-RESEARCH.md):
  TrackName: x---x---x---x--- [sample:kick, transpose:0]

  x = note on, - = rest, o = ghost, X = accent

Examples:
  npx tsx scripts/diff-sessions.ts abc-123 def-456
  npx tsx scripts/diff-sessions.ts https://staging.keyboardia.dev/s/abc https://keyboardia.dev/s/def
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printUsage();
    process.exit(0);
  }

  if (args.length !== 2) {
    console.error('Error: Expected exactly 2 session arguments');
    printUsage();
    process.exit(1);
  }

  try {
    const parsed1 = parseSessionInput(args[0]);
    const parsed2 = parseSessionInput(args[1]);

    console.error(`Fetching from ${ENVIRONMENT_CONFIGS[parsed1.environment].displayName}...`);
    const session1 = await fetchSession(parsed1);

    console.error(`Fetching from ${ENVIRONMENT_CONFIGS[parsed2.environment].displayName}...`);
    const session2 = await fetchSession(parsed2);

    printSessionDiff(session1, session2, parsed1, parsed2);

  } catch (error) {
    console.error(`\n❌ Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
