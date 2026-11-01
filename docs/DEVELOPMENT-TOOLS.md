# Development Tools & Utilities

This document provides a comprehensive reference for all development tools, scripts, and debugging infrastructure in the Keyboardia project.

## Quick Start

```bash
# Enable full debugging in browser
# Add ?debug=1 to URL: http://localhost:5173/?debug=1

# Run bug pattern analysis
npm run analyze:bugs

# Test multiplayer locally
npm run dev:multiplayer

# After fixing a bug, find similar issues
npm run post-fix -- --interactive
```

---

## Table of Contents

1. [NPM Scripts](#npm-scripts)
2. [CLI Tools](#cli-tools)
3. [Debugging Infrastructure](#debugging-infrastructure)
4. [Browser Console Commands](#browser-console-commands)
5. [Claude Code Integration](#claude-code-integration)
6. [Quick Reference](#quick-reference)

---

## NPM Scripts

### Development & Build

| Script | Command | Description |
|--------|---------|-------------|
| Dev Server | `npm run dev` | Vite dev server with hot reload |
| Build | `npm run build` | TypeScript + Vite production build |
| Lint | `npm run lint` | ESLint code quality checks |
| Preview | `npm run preview` | Preview production build locally |

### Testing

| Script | Command | Description |
|--------|---------|-------------|
| Test | `npm run test` | Run unit tests (vitest) |
| Test Unit | `npm run test:unit` | Single run unit tests |
| Test Watch | `npm run test:unit:watch` | Unit tests in watch mode |
| Test Integration | `npm run test:integration` | Integration tests |
| Test All | `npm run test:all` | All tests (unit + integration) |

### Custom Tools

| Script | Command | Description |
|--------|---------|-------------|
| Session CLI | `npm run session` | Session API management tool |
| Multiplayer Dev | `npm run dev:multiplayer` | Multi-client testing tool |
| Analyze Bugs | `npm run analyze:bugs` | Static bug pattern scanner |
| Analyze Logs | `npm run analyze:logs` | Log file analysis |
| Post-Fix | `npm run post-fix` | Similar bug finder |
| Bug Capture | `npm run bug:capture` | Interactive bug documentation |

---

## CLI Tools

### Session API Tool

**Location**: `scripts/session-api.ts`

Validates and manages session JSON data through the API.

```bash
# Validate session JSON
npx tsx scripts/session-api.ts validate <json-file>

# Create new session
npx tsx scripts/session-api.ts create <json-file>

# Update existing session
npx tsx scripts/session-api.ts update <session-id> <json-file>

# Get session data
npx tsx scripts/session-api.ts get <session-id>

# Pipe JSON from stdin
echo '{"tracks":[...]}' | npx tsx scripts/session-api.ts create -
```

**Key Features**:
- Schema validation with detailed error messages
- Catches common mistakes (e.g., parameterLocks must be array, not object)
- Supports stdin input with `-`

---

### Multiplayer Development Tool

**Location**: `scripts/dev-multiplayer.ts`

Opens two browser windows connected to the same session for multiplayer testing.

```bash
# Auto-create test session
npm run dev:multiplayer

# Use specific session
npm run dev:multiplayer <session-id>
```

**Key Features**:
- Creates test session with kick + hi-hat tracks
- Auto-detects if dev server is running
- Opens two browser windows with `?debug=1`
- 1-second delay between windows to see connection events

---

### Bug Pattern Analyzer

**Location**: `scripts/analyze-bug-patterns.ts`

Scans source code for known bug patterns using regex matching.

```bash
# Scan entire codebase
npm run analyze:bugs

# Filter by pattern
npm run analyze:bugs -- --pattern audio-context-mismatch

# Filter by category
npm run analyze:bugs -- --category singleton

# Scan specific directory
npm run analyze:bugs -- --dir ./src/audio
```

**Key Features**:
- Matches patterns from `bug-patterns.ts` registry
- Color-coded severity (red=high, yellow=medium, green=low)
- Shows context lines around matches
- Exits with error code if high-severity issues found

---

### Log Analyzer

**Location**: `scripts/analyze-logs.ts`

Analyzes exported log files from IndexedDB for debugging.

```bash
# Basic summary
npx tsx scripts/analyze-logs.ts logs.json

# Show errors grouped by message
npx tsx scripts/analyze-logs.ts logs.json --errors

# Filter by category
npx tsx scripts/analyze-logs.ts logs.json --category audio

# Search for text
npx tsx scripts/analyze-logs.ts logs.json --search "AudioContext"

# Show activity timeline
npx tsx scripts/analyze-logs.ts logs.json --timeline

# Session breakdown
npx tsx scripts/analyze-logs.ts logs.json --sessions
```

**Key Features**:
- Parses exported log JSON
- Summary statistics (counts, time span, error rates)
- Error grouping and deduplication
- Timeline view by minute
- Per-session breakdown

---

### Post-Fix Analysis Tool

**Location**: `scripts/post-fix-analysis.ts`

After fixing a bug, finds similar patterns elsewhere in the codebase.

```bash
# Interactive mode (recommended)
npm run post-fix -- --interactive

# Direct pattern search
npm run post-fix -- --pattern "getInstance\(\)" --risky-context "Tone\."

# With exclusions
npm run post-fix -- --code-pattern "setTimeout" --exclude "pendingTimers"

# Search from symptom
npm run post-fix -- --symptom "no sound after HMR"
```

**Key Features**:
- Regex pattern matching across `src/`
- Risk level detection (high/medium/low)
- Risky context identification
- Saves JSON reports to `debug-reports/`
- Generates suggested bug pattern entries

---

### Bug Capture Tool

**Location**: `scripts/bug-capture.ts`

Interactive wizard for documenting bugs after they're fixed.

```bash
# Interactive mode
npm run bug:capture

# From existing analysis
npm run bug:capture -- --from-file debug-reports/analysis.json

# Skip analysis step
npm run bug:capture -- --no-analyze
```

**Key Features**:
- Interactive prompts for bug details
- Generates TypeScript code for `bug-patterns.ts`
- Generates markdown for `DEBUGGING-LESSONS-LEARNED.md`
- Auto-increments bug ID numbers
- Optionally runs post-fix analysis

---

### Create Test Sessions Tool

**Location**: `scripts/create-test-sessions.ts`

Creates test sessions for each synth preset to verify sounds work correctly.

```bash
# Create test sessions for all synth presets
npx tsx scripts/create-test-sessions.ts
```

**Key Features**:
- Creates one session per synth preset category (core, keys, genre, ambient)
- Each session has a simple 4-on-the-floor pattern
- Sessions created at deployed URL for manual testing
- Outputs URLs for each created session

**Use Cases**:
- Verify all synth presets produce sound after code changes
- Quick manual testing of audio output
- Generate demo sessions for documentation

---

### Production WebSocket Test

**Location**: `scripts/test-ws-production.ts`

Simple WebSocket connection test for production verification.

```bash
# Test with default session
npx tsx scripts/test-ws-production.ts

# Test specific session
npx tsx scripts/test-ws-production.ts <session-id>
```

**Key Features**:
- Connects to production WebSocket endpoint
- Sends join message and receives snapshot
- Verifies connection handshake works
- Auto-closes after 5 seconds

**Use Cases**:
- Verify production WebSocket endpoint is healthy
- Quick smoke test after deployment
- Debug connection issues

---

### Multiplayer Sync Test

**Location**: `scripts/test-multiplayer-sync.ts`

Comprehensive multiplayer sync verification with two simulated clients.

```bash
# Test with auto-created session
npx tsx scripts/test-multiplayer-sync.ts

# Test specific session
npx tsx scripts/test-multiplayer-sync.ts <session-id>
```

**Test Sequence**:
1. Client A connects, receives snapshot
2. Client A adds a track (kick, volume 0.8)
3. Client B connects, verifies track is in snapshot
4. Client B changes tempo (120 → 140)
5. Client A receives tempo change in real-time

**Key Features**:
- 8-point validation checklist
- Tests both state sync (snapshot) and real-time broadcast
- Uses handler factories (createRemoteHandler, createGlobalMutationHandler)
- Exit code 0 on pass, 1 on fail (CI-compatible)

**Use Cases**:
- Verify multiplayer sync after code changes
- CI/CD pipeline integration
- Regression testing after sync abstraction changes

---

### Mock API Plugin (Local Development)

**Location**: `vite.config.ts`

A Vite development server plugin that provides mock backend endpoints, enabling frontend development without running a real backend server.

**Endpoints**:

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/sessions` | Create a new session |
| `GET` | `/api/sessions/:id` | Retrieve session by ID |
| `PUT` | `/api/sessions/:id` | Update session (full replace) |
| `PATCH` | `/api/sessions/:id` | Update session (partial) |

**How It Works**:
- Storage: In-memory `Map<string, Session>` (resets on server restart)
- ID Generation: Uses `crypto.randomUUID()`
- Automatically enabled when running `npm run dev`

**Limitations**:
- Data not persisted across server restarts
- No authentication or authorization
- Single-user only (no concurrency handling)

---

## Debugging Infrastructure

### Debug Coordinator

**Location**: `src/utils/debug-coordinator.ts`

Central hub that coordinates all debug subsystems based on URL flags.

**URL Flags**:

| Flag | Effect |
|------|--------|
| `?debug=1` | Enable ALL debug features |
| `?trace=1` | Event tracing only |
| `?audio-debug=1` | Audio state debugging only |
| `?log=1` | Log persistence only |
| `?bug-detect=1` | Periodic bug detection (30s interval) |

**Example**:
```
http://localhost:5173/?debug=1
http://localhost:5173/?trace=1&audio-debug=1
```

---

### Log Store (IndexedDB)

**Location**: `src/utils/log-store.ts`

Persistent log storage that survives page refreshes.

**Configuration**:
- Max logs: 10,000
- Cleanup threshold: 12,000
- TTL by level:
  - `debug`/`log`: 24 hours
  - `warn`: 3 days
  - `error`: 7 days

**Features**:
- Auto-cleanup using `requestIdleCallback`
- Efficient querying with compound indexes
- Session-based log grouping
- Export to JSON file

---

### Debug Tracer

**Location**: `src/utils/debug-tracer.ts`

Structured observability with spans and correlation IDs.

**Usage in Code**:
```typescript
import { tracer } from './utils/debug-tracer';

// Start a span for measuring duration
const span = tracer.startSpan('scheduler.scheduleStep', { step: 5 });
// ... do work ...
span.end({ notesScheduled: 3 });

// Log simple events
tracer.event('audio', 'note-played', { freq: 440 });

// Log errors with stack traces
tracer.error('audio', 'playback-failed', error);

// Track state changes
tracer.stateChange('scheduler', 'isRunning', false, true);
```

**Features**:
- Correlation IDs for tracking operations across modules
- Parent/child span relationships
- Duration measurement
- Performance statistics
- Persists to IndexedDB log store

---

### Bug Pattern Registry

**Location**: `src/utils/bug-patterns.ts`

Registry of known bugs with symptoms, detection, and fixes.

**Current Patterns**:

| ID | Name | Severity | Category |
|----|------|----------|----------|
| `audio-context-mismatch` | AudioContext Mismatch (HMR) | Critical | audio-context |
| `stale-state-after-stop` | Stale State After Stop | Medium | state-management |
| `silent-instrument` | Silent Instrument | High | routing |
| `play-before-ready` | Play Before Ready | High | race-condition |

**Pattern Structure**:
```typescript
{
  id: 'pattern-id',
  name: 'Human Readable Name',
  category: 'category',
  severity: 'critical' | 'high' | 'medium' | 'low',
  description: 'What this bug is',
  symptoms: ['What user sees'],
  rootCause: 'Why it happens',
  detection: {
    runtime: () => detectFunction(),      // Runtime detection
    codePatterns: ['regex patterns'],     // Static analysis
    logPatterns: ['log output patterns'], // Log search
  },
  fix: {
    summary: 'How to fix',
    steps: ['Step 1', 'Step 2'],
    codeExample: '...',
  },
  prevention: ['How to prevent'],
  relatedFiles: ['affected files'],
}
```

---

### Logger Utility

**Location**: `src/utils/logger.ts`

Production-safe logging with automatic persistence.

```typescript
import { logger } from './utils/logger';

logger.log('General message');           // Dev only
logger.warn('Warning');                  // Dev only
logger.error('Error');                   // Always (production-safe)
logger.debug('Debug info');              // Dev only

// Categorized logging
logger.ws('Connected');                  // [WS] prefix
logger.audio('Playing sample');          // [Audio] prefix
logger.multiplayer('Syncing');           // [Multiplayer] prefix
logger.session('Loaded');                // [Session] prefix
```

---

## Browser Console Commands

When debugging is enabled, these commands are available in the browser console:

### Debug Status

```javascript
// Get current debug state
__getDebugStatus__()

// Run full diagnostics
await __runFullDiagnostics__()
```

### Log Queries

```javascript
// Get recent logs
await __getRecentLogs__(100)

// Query with filters
await __queryLogs__({ level: 'error', category: 'audio' })
await __queryLogs__({ level: ['error', 'warn'], limit: 50 })

// Search by text
await __searchLogs__('AudioContext')

// Get logs from current session
await __getCurrentSessionLogs__()

// Get logs from last N minutes
await __getLogsFromLastMinutes__(5)

// Get statistics
await __getLogStats__()

// Export to file
await __exportLogsToFile__()

// Clear all logs
await __clearAllLogs__()
```

### Bug Detection

```javascript
// Run all runtime detections
__runBugDetection__()

// Search stored logs for patterns (last 30 min)
await __detectFromLogs__(30)

// Search for specific symptom
await __searchLogsForSymptom__('no sound')

// Get recent errors
await __getRecentErrors__(30)

// Get all patterns
__getBugPatterns__()

// Search by symptom keyword
__searchBugPatterns__('silent')
```

### Tracing

```javascript
// Enable/disable tracing
window.__DEBUG_TRACE__ = true
window.__DEBUG_TRACE__ = false

// Filter traces
window.__TRACE_FILTER__ = 'scheduler'

// Get all traces
__getTraces__()

// Export traces as JSON
__exportTraces__()

// Get performance stats
__getSpanStats__()

// Get traces by correlation ID
__getCorrelation__('cor_123')

// Clear traces
__clearTraces__()
```

### Audio Debugging

```javascript
// Enable audio state debugging
window.__AUDIO_DEBUG__ = true

// Get playback state
__getPlaybackState__()

// Assert playback is stopped
__assertPlaybackStopped__()
```

---

## Claude Code Integration

### Slash Commands

**`/post-fix`** (`.claude/commands/post-fix.md`)

Guides Claude through post-fix analysis workflow:
1. Understand the fix
2. Extract the pattern
3. Run post-fix analysis
4. Review high-risk matches
5. Update bug registry if needed

### Skills

**`frontend-design`** (`.claude/skills/frontend-design/`)

Design system for creating distinctive UI components:
- Bold aesthetic direction
- Distinctive typography
- Strategic animations
- Custom visual details

---

## Quick Reference

### Typical Debugging Workflow

```bash
# 1. Start dev server
npm run dev

# 2. Open with debug mode
# http://localhost:5173/?debug=1

# 3. Enable tracing in console
window.__DEBUG_TRACE__ = true

# 4. Reproduce the bug...

# 5. Check for known patterns
__runBugDetection__()

# 6. Export logs for analysis
await __exportLogsToFile__()

# 7. Analyze locally
npx tsx scripts/analyze-logs.ts keyboardia-logs-*.json --errors
```

### After Fixing a Bug

```bash
# 1. Run post-fix analysis
npm run post-fix -- --interactive

# 2. Document the bug
npm run bug:capture

# 3. Review related files
npm run analyze:bugs -- --pattern <new-pattern>
```

### Testing Multiplayer

```bash
# Local development testing
npm run dev                   # Start dev server
npm run dev:multiplayer       # Open two browsers to same session

# Production verification (after deployment)
npx tsx scripts/test-ws-production.ts              # Quick WebSocket health check
npx tsx scripts/test-multiplayer-sync.ts           # Full sync verification (8 checks)

# CI integration
npx tsx scripts/test-multiplayer-sync.ts && echo "PASS" || echo "FAIL"
```

---

## File Locations

| Tool | Location |
|------|----------|
| Session API | `scripts/session-api.ts` |
| Multiplayer Dev | `scripts/dev-multiplayer.ts` |
| Bug Analyzer | `scripts/analyze-bug-patterns.ts` |
| Log Analyzer | `scripts/analyze-logs.ts` |
| Post-Fix Analysis | `scripts/post-fix-analysis.ts` |
| Bug Capture | `scripts/bug-capture.ts` |
| Create Test Sessions | `scripts/create-test-sessions.ts` |
| Production WS Test | `scripts/test-ws-production.ts` |
| Multiplayer Sync Test | `scripts/test-multiplayer-sync.ts` |
| Mock API Plugin | `vite.config.ts` |
| Logger | `src/utils/logger.ts` |
| Log Store | `src/utils/log-store.ts` |
| Debug Tracer | `src/utils/debug-tracer.ts` |
| Debug Coordinator | `src/utils/debug-coordinator.ts` |
| Bug Patterns | `src/utils/bug-patterns.ts` |
| Debug Overlay | `src/debug/DebugOverlay.tsx` |
| Debug Context | `src/debug/DebugContext.tsx` |

---

## Test Sessions

Pre-built session files for testing are located in `scripts/sessions/`:

| File | Description |
|------|-------------|
| `polyrhythm-demo.json` | Polyrhythmic pattern example |
| `chord-exploration.json` | Chord progression demo |
| `afrobeat-groove.json` | Afrobeat pattern |
| `pop-hit.json` | Pop production example |
| `playhead-solo-test.json` | Solo feature test |
| `playhead-mute-test.json` | Mute feature test |
| `playhead-polyrhythm-test.json` | Polyrhythm test |

---

## Architecture Diagram

```
+------------------+     +------------------+     +------------------+
|   Debug Overlay  |     |   Debug Tracer   |     |  Bug Patterns    |
|   (Visual UI)    |<--->|   (Spans/Events) |<--->|  (Detection)     |
+------------------+     +------------------+     +------------------+
         |                       |                        |
         v                       v                        v
+------------------+     +------------------+     +------------------+
|  DebugContext    |     |  Logger Utility  |     | Post-Fix         |
|  (React State)   |     |  (Console)       |     | Analysis         |
+------------------+     +------------------+     +------------------+
         |                       |                        |
         +------------+----------+------------------------+
                      |
                      v
              +------------------+
              |   Log Store      |  <-- IndexedDB persistence
              |   (IndexedDB)    |      Survives page refresh
              +------------------+
                      |
                      v
              +------------------+
              |   CLI Tools      |  <-- analyze-logs.ts, etc.
              +------------------+
```
