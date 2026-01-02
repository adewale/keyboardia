#!/usr/bin/env npx tsx
/**
 * Family Tree Tool
 * Prints the family tree (ancestry and metadata) of a given session
 *
 * Usage:
 *   npx tsx scripts/family-tree.ts <session-id>
 *   npx tsx scripts/family-tree.ts <session-id> --env=staging
 *   npx tsx scripts/family-tree.ts <session-id> --env=production
 *   npx tsx scripts/family-tree.ts <session-id> --env=local
 *   npx tsx scripts/family-tree.ts <session-id> --json
 *
 * Examples:
 *   npx tsx scripts/family-tree.ts abc123                    # Production (default)
 *   npx tsx scripts/family-tree.ts abc123 --env=staging      # Staging environment
 *   npx tsx scripts/family-tree.ts abc123 --env=local        # Local dev server
 *   npx tsx scripts/family-tree.ts abc123 --json             # Output as JSON
 */

// =============================================================================
// Configuration
// =============================================================================

const args = process.argv.slice(2);
const envArg = args.find(a => a.startsWith('--env='))?.split('=')[1] ||
               (args.includes('--env') ? args[args.indexOf('--env') + 1] : 'production');
const jsonOutput = args.includes('--json');

const ENVIRONMENTS: Record<string, string> = {
  production: 'https://keyboardia.adewale-883.workers.dev',
  staging: 'https://keyboardia-staging.adewale-883.workers.dev',
  local: 'http://localhost:8788',
};

const BASE_URL = ENVIRONMENTS[envArg] || ENVIRONMENTS.production;
const API_BASE = `${BASE_URL}/api/sessions`;

// =============================================================================
// Types
// =============================================================================

interface SessionState {
  tracks: Array<{
    id: string;
    name: string;
    sampleId: string;
    steps: boolean[];
    stepCount?: number;
  }>;
  tempo: number;
  swing: number;
  version: number;
}

interface Session {
  id: string;
  name: string | null;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
  remixedFrom: string | null;
  remixedFromName: string | null;
  remixCount: number;
  immutable: boolean;
  state: SessionState;
}

interface FamilyNode {
  session: Session;
  depth: number;
  isTarget: boolean;
}

// =============================================================================
// API Functions
// =============================================================================

async function fetchSession(sessionId: string): Promise<Session | null> {
  try {
    const response = await fetch(`${API_BASE}/${sessionId}`);
    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      console.error(`HTTP ${response.status}: ${response.statusText}`);
      return null;
    }
    return await response.json() as Session;
  } catch (error) {
    console.error(`Fetch error for ${sessionId}: ${error}`);
    return null;
  }
}

// =============================================================================
// Tree Building
// =============================================================================

async function buildAncestryChain(sessionId: string): Promise<FamilyNode[]> {
  const chain: FamilyNode[] = [];
  let currentId: string | null = sessionId;
  let depth = 0;
  const visited = new Set<string>();

  while (currentId) {
    // Prevent infinite loops
    if (visited.has(currentId)) {
      console.warn(`Circular reference detected at session: ${currentId}`);
      break;
    }
    visited.add(currentId);

    const session = await fetchSession(currentId);
    if (!session) {
      if (depth === 0) {
        // Target session not found
        return [];
      }
      // Ancestor not found - add placeholder
      console.warn(`Ancestor session not found: ${currentId}`);
      break;
    }

    chain.push({
      session,
      depth,
      isTarget: currentId === sessionId,
    });

    currentId = session.remixedFrom;
    depth++;
  }

  // Reverse to show oldest ancestor first
  return chain.reverse();
}

// =============================================================================
// Formatting Helpers
// =============================================================================

function formatTimestamp(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ago`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s ago`;
  return `${seconds}s ago`;
}

function getSessionDisplayName(session: Session): string {
  if (session.name) return session.name;
  if (session.state.tracks.length > 0) {
    return session.state.tracks[0].name;
  }
  return 'Untitled Session';
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

// =============================================================================
// Output Rendering
// =============================================================================

function renderTree(chain: FamilyNode[], targetId: string): void {
  const now = Date.now();

  console.log('\n' + '='.repeat(70));
  console.log('SESSION FAMILY TREE');
  console.log('='.repeat(70));
  console.log(`Environment: ${envArg.toUpperCase()} (${BASE_URL})`);
  console.log(`Target:      ${targetId}`);
  console.log('='.repeat(70) + '\n');

  if (chain.length === 0) {
    console.log('Session not found.\n');
    return;
  }

  // Print ancestry info
  const targetNode = chain.find(n => n.isTarget);
  const ancestorCount = chain.length - 1;

  if (ancestorCount > 0) {
    console.log(`Lineage: ${ancestorCount} ancestor${ancestorCount > 1 ? 's' : ''}`);
  } else {
    console.log('Lineage: This is an original session (no ancestors)');
  }

  if (targetNode && targetNode.session.remixCount > 0) {
    console.log(`Children: ${targetNode.session.remixCount} direct remix${targetNode.session.remixCount > 1 ? 'es' : ''}`);
  }
  console.log('');

  // Print tree visualization
  console.log('ANCESTRY TREE:');
  console.log('');

  for (let i = 0; i < chain.length; i++) {
    const node = chain[i];
    const isLast = i === chain.length - 1;
    const indent = '  '.repeat(i);
    const connector = i === 0 ? '' : '  ';
    const branch = i === 0 ? '' : (isLast ? '`-- ' : '|-- ');

    // Session name with marker for target
    const marker = node.isTarget ? ' <-- TARGET' : '';
    const status = node.session.immutable ? ' [PUBLISHED]' : '';
    const displayName = truncate(getSessionDisplayName(node.session), 30);

    console.log(`${indent}${connector}${branch}${displayName}${status}${marker}`);

    // Session details
    const detailIndent = '  '.repeat(i + 1);
    console.log(`${detailIndent}ID: ${node.session.id}`);
    console.log(`${detailIndent}Created: ${formatTimestamp(node.session.createdAt)} (${formatDuration(now - node.session.createdAt)})`);
    console.log(`${detailIndent}Tracks: ${node.session.state.tracks.length} | Tempo: ${node.session.state.tempo} BPM | Swing: ${node.session.state.swing}%`);

    if (node.session.remixCount > 0) {
      console.log(`${detailIndent}Remixed: ${node.session.remixCount} time${node.session.remixCount > 1 ? 's' : ''}`);
    }

    console.log('');
  }

  // Summary
  console.log('-'.repeat(70));
  console.log('SUMMARY:');

  const root = chain[0];
  const target = chain.find(n => n.isTarget)!;

  console.log(`  Root session:    ${root.session.id}`);
  console.log(`  Root created:    ${formatTimestamp(root.session.createdAt)}`);
  console.log(`  Target session:  ${target.session.id}`);
  console.log(`  Target created:  ${formatTimestamp(target.session.createdAt)}`);
  console.log(`  Generation:      ${ancestorCount + 1} (${ancestorCount === 0 ? 'root' : `child of ${ancestorCount} ancestor${ancestorCount > 1 ? 's' : ''}`})`);

  if (target.session.immutable) {
    console.log(`  Status:          PUBLISHED (immutable)`);
  } else {
    console.log(`  Status:          Draft (editable)`);
  }

  console.log('\n' + '='.repeat(70) + '\n');
}

function renderJson(chain: FamilyNode[], targetId: string): void {
  const output = {
    environment: envArg,
    baseUrl: BASE_URL,
    targetId,
    found: chain.length > 0,
    ancestorCount: Math.max(0, chain.length - 1),
    chain: chain.map(node => ({
      id: node.session.id,
      name: getSessionDisplayName(node.session),
      isTarget: node.isTarget,
      depth: node.depth,
      createdAt: node.session.createdAt,
      updatedAt: node.session.updatedAt,
      immutable: node.session.immutable,
      remixedFrom: node.session.remixedFrom,
      remixCount: node.session.remixCount,
      trackCount: node.session.state.tracks.length,
      tempo: node.session.state.tempo,
      swing: node.session.state.swing,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

// =============================================================================
// CLI
// =============================================================================

function printUsage(): void {
  console.log(`
Family Tree Tool - Print the ancestry of a session

Usage:
  npx tsx scripts/family-tree.ts <session-id> [options]

Options:
  --env=<env>     Environment to query (local, staging, production)
                  Default: production
  --json          Output as JSON instead of visual tree

Environments:
  local           http://localhost:8788
  staging         https://keyboardia-staging.adewale-883.workers.dev
  production      https://keyboardia.adewale-883.workers.dev

Examples:
  npx tsx scripts/family-tree.ts abc-123
  npx tsx scripts/family-tree.ts abc-123 --env=staging
  npx tsx scripts/family-tree.ts abc-123 --json
`);
}

async function main(): Promise<void> {
  // Filter out option args to get session ID
  const sessionId = args.find(a => !a.startsWith('--'));

  if (!sessionId) {
    printUsage();
    process.exit(1);
  }

  // Validate environment
  if (!ENVIRONMENTS[envArg]) {
    console.error(`Unknown environment: ${envArg}`);
    console.error(`Valid environments: ${Object.keys(ENVIRONMENTS).join(', ')}`);
    process.exit(1);
  }

  // Build ancestry chain
  const chain = await buildAncestryChain(sessionId);

  // Render output
  if (jsonOutput) {
    renderJson(chain, sessionId);
  } else {
    renderTree(chain, sessionId);
  }

  // Exit with error if session not found
  if (chain.length === 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Error: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
