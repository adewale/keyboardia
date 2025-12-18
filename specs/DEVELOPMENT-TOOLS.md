# Development & Debugging Tools

This document catalogs all debugging and development tools available in Keyboardia.

## Quick Reference

| Tool | Purpose | Command |
|------|---------|---------|
| `session` | Session CRUD operations | `npm run session` |
| `dev:multiplayer` | Local multiplayer testing | `npm run dev:multiplayer` |
| `analyze:bugs` | Scan for known bug patterns | `npm run analyze:bugs` |
| `analyze:logs` | Analyze application logs | `npm run analyze:logs` |
| `post-fix` | Post-fix verification | `npm run post-fix` |
| `bug:capture` | Interactive bug capture | `npm run bug:capture` |

---

## Connection & WebSocket Debugging

These tools were created during Phase 12 to diagnose the WebSocket connection storm bug.

### monitor-connections.ts

**Purpose:** Long-running connection health monitor that detects connection storms.

```bash
npx tsx scripts/monitor-connections.ts <session-id> [duration-minutes] [base-url]

# Examples:
npx tsx scripts/monitor-connections.ts test-session 15 http://localhost:8787
npx tsx scripts/monitor-connections.ts prod-session 30 https://keyboardia.adewale-883.workers.dev
```

**Features:**
- Tracks connection count stability over time
- Detects connection storms (>5 reconnects in 10 seconds)
- Records connect/disconnect events with timestamps
- Reports peak/min connection counts
- Generates summary statistics

**When to use:** Investigating multiplayer connection issues, validating connection storm fixes.

---

### analyze-ws-storm.ts

**Purpose:** Analyzes wrangler tail logs to detect reconnection storm patterns.

```bash
# Live analysis (pipe wrangler tail)
npx wrangler tail keyboardia --format json | npx tsx scripts/analyze-ws-storm.ts

# Analyze from saved logs
npx tsx scripts/analyze-ws-storm.ts --file /path/to/logs.json
```

**Features:**
- Parses wrangler JSON log format
- Groups events by session and player
- Identifies rapid reconnection patterns
- Reports storm severity and timing

**When to use:** Post-incident analysis of connection issues using production logs.

---

### debug-ws-storm-local.ts

**Purpose:** Reproduces WebSocket storms locally for debugging.

```bash
npx tsx scripts/debug-ws-storm-local.ts
```

**Features:**
- Creates simulated clients that trigger state changes
- Monitors for reconnection behavior
- Helps verify connection storm fixes locally

**When to use:** Developing fixes for connection stability issues.

---

## State & Hash Debugging

Created during Phase 12 to diagnose state hash mismatch issues.

### debug-state-hash.ts

**Purpose:** Diagnoses client/server state hash mismatches.

```bash
npx tsx scripts/debug-state-hash.ts <session-id>
npx tsx scripts/debug-state-hash.ts <session-id> --local
```

**Features:**
- Fetches session state from API
- Computes hash using same algorithm as client/server
- Compares field-by-field for differences
- Identifies serialization boundary mismatches (see BUG-PATTERNS.md #1)

**When to use:** When clients show "state out of sync" warnings or hash mismatches.

---

### compare-sessions.ts

**Purpose:** Compares state between two sessions.

```bash
npx tsx scripts/compare-sessions.ts <session-id-1> <session-id-2>
```

**Features:**
- Fetches both sessions from API
- Deep comparison of state objects
- Highlights differences in tracks, tempo, effects, etc.

**When to use:** Comparing forked sessions, debugging remix issues.

---

## Session Management

### session-api.ts (npm run session)

**Purpose:** Full-featured session CRUD tool.

```bash
npm run session -- list
npm run session -- get <session-id>
npm run session -- create --name "My Session"
npm run session -- delete <session-id>
npm run session -- update <session-id> --name "New Name"
```

**Features:**
- List, create, read, update, delete sessions
- Works with both local and production APIs
- JSON output for scripting

**When to use:** Managing sessions programmatically, debugging session state.

---

### debug-session.ts

**Purpose:** Deep inspection of session state and connections.

```bash
npx tsx scripts/debug-session.ts <session-id>
npx tsx scripts/debug-session.ts <session-id> --full
npx tsx scripts/debug-session.ts <session-id> --ws-logs
npx tsx scripts/debug-session.ts <session-id> --connections
```

**Flags:**
- `--full`: Complete session dump including all track data
- `--ws-logs`: WebSocket connection logs from Durable Object
- `--connections`: Current active connections

**When to use:** Investigating session-specific issues, debugging multiplayer state.

---

### debug-metrics.ts

**Purpose:** View WebSocket metrics from Durable Object.

```bash
npx tsx scripts/debug-metrics.ts <session-id>
```

**Features:**
- Connection counts
- Message throughput
- Error rates
- Latency percentiles

**When to use:** Performance analysis, capacity planning.

---

## Testing & Development

### dev-multiplayer.ts (npm run dev:multiplayer)

**Purpose:** Sets up local multiplayer testing environment.

```bash
npm run dev:multiplayer
```

**Features:**
- Starts local wrangler dev server
- Creates test session with sample data
- Opens multiple browser windows for testing
- Monitors connection health

**When to use:** Local development of multiplayer features.

---

### create-test-sessions.ts

**Purpose:** Creates test sessions with various configurations.

```bash
npx tsx scripts/create-test-sessions.ts
```

**Features:**
- Creates sessions with different track counts
- Populates with sample patterns
- Creates sessions for specific test scenarios

**When to use:** Setting up test data for manual or automated testing.

---

### trigger-state-changes.ts

**Purpose:** Triggers state changes for testing sync behavior.

```bash
npx tsx scripts/trigger-state-changes.ts <session-id>
```

**Features:**
- Sends step toggle, tempo change, and other actions
- Useful for testing state propagation
- Can simulate rapid changes to stress-test sync

**When to use:** Testing multiplayer sync, validating conflict resolution.

---

### ci-connection-stability.ts

**Purpose:** CI-friendly connection stability test.

```bash
npx tsx scripts/ci-connection-stability.ts
```

**Features:**
- Runs automated connection stability checks
- Reports pass/fail for CI integration
- Detects regressions in connection handling

**When to use:** CI pipelines, regression testing.

---

## Bug Analysis

### analyze-bug-patterns.ts (npm run analyze:bugs)

**Purpose:** Scans codebase for known bug patterns.

```bash
npm run analyze:bugs
npm run analyze:bugs -- --pattern unstable-callback-in-effect
npm run analyze:bugs -- --category singleton
```

**Detected patterns:**
- Unstable callbacks in useEffect dependencies (connection storm cause)
- Serialization boundary mismatches
- Singleton initialization issues
- Audio context mismatches

**When to use:** After fixing a bug, to find similar issues. Runs automatically on pre-commit.

**Reference:** See [BUG-PATTERNS.md](../docs/BUG-PATTERNS.md) for documented patterns.

---

### analyze-logs.ts (npm run analyze:logs)

**Purpose:** Analyzes application logs for patterns and issues.

```bash
npm run analyze:logs
npm run analyze:logs -- --level error
npm run analyze:logs -- --since "2024-01-01"
```

**Features:**
- Filters by log level, timestamp, component
- Aggregates error frequencies
- Identifies recurring issues

**When to use:** Investigating production issues, analyzing error trends.

---

### bug-capture.ts (npm run bug:capture)

**Purpose:** Interactive bug capture tool.

```bash
npm run bug:capture
```

**Features:**
- Guided bug report creation
- Captures system state, session data, logs
- Generates markdown bug report
- Can attach to existing GitHub issues

**When to use:** Reporting bugs with full context.

---

### post-fix-analysis.ts (npm run post-fix)

**Purpose:** Verifies bug fixes and documents changes.

```bash
npm run post-fix
```

**Features:**
- Re-runs bug pattern analysis
- Compares before/after state
- Generates fix verification report
- Updates bug documentation

**When to use:** After implementing a bug fix, before merging.

---

## Environment Variables

Most tools respect these environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `API_BASE` | `https://keyboardia.adewale-883.workers.dev` | API endpoint |
| `LOCAL_API` | `http://localhost:8787` | Local dev API |
| `DEBUG` | - | Enable verbose logging |

---

## Adding New Tools

When adding a new debugging tool:

1. Create script in `app/scripts/` with `.ts` extension
2. Add shebang: `#!/usr/bin/env npx tsx`
3. Include JSDoc header with usage examples
4. Add npm script alias in `package.json` if frequently used
5. Document in this file

**Template:**

```typescript
#!/usr/bin/env npx tsx
/**
 * Tool Name
 *
 * Brief description of what this tool does.
 *
 * Usage:
 *   npx tsx scripts/tool-name.ts [args]
 *
 * Examples:
 *   npx tsx scripts/tool-name.ts --flag value
 */

// Implementation
```

---

## Related Documentation

- [BUG-PATTERNS.md](../docs/BUG-PATTERNS.md) - Known bug patterns and prevention
- [TESTING.md](./TESTING.md) - Testing strategy and tools
- [DEBUGGING-LESSONS-LEARNED.md](./research/PHASE-13B-LESSONS.md) - Lessons from debugging sessions
