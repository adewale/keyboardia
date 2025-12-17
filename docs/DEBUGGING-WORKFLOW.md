# Local Debugging & Observability Workflow

This document describes the integrated debugging and observability approach for local development. It combines multiple tools into a cohesive workflow that makes debugging efficient and ensures learnings are captured.

## Quick Start

```bash
# 1. Start dev server with debug mode
npm run dev
# Open http://localhost:5173/?debug=1

# 2. Enable tracing in browser console
window.__DEBUG_TRACE__ = true

# 3. Run bug detection
window.__runBugDetection__()
```

## The Debugging Stack

```
+------------------+     +------------------+     +------------------+
|   Debug Overlay  |     |   Debug Tracer   |     |  Bug Patterns    |
|   (Visual UI)    |<--->|   (Structured)   |<--->|  (Detection)     |
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
              |   Log Store      |  <-- NEW: IndexedDB persistence
              |   (IndexedDB)    |      Survives page refresh!
              +------------------+
                      |
                      v
              +------------------+
              | DEBUGGING-       |
              | LESSONS-         |
              | LEARNED.md       |
              +------------------+
```

## Log Persistence (NEW)

Logs are automatically persisted to IndexedDB and survive page refreshes. This allows you to:
- Go back and see what happened before a crash
- Export logs to a file for analysis
- Query historical logs by category, level, or text search

### Enable/Disable Persistence
```javascript
// Persistence is ON by default in dev mode
window.__LOG_PERSIST__ = true   // Enable
window.__LOG_PERSIST__ = false  // Disable
```

### Query Persisted Logs
```javascript
// Get recent logs
await __getRecentLogs__(100)

// Query with filters
await __queryLogs__({ level: 'error', category: 'Audio' })
await __queryLogs__({ level: ['error', 'warn'], limit: 50 })

// Search by text
await __searchLogs__('AudioContext')

// Get logs from current session
await __getCurrentSessionLogs__()

// Get logs from last N minutes
await __getLogsFromLastMinutes__(5)

// Get statistics
await __getLogStats__()
```

### Export and Analyze
```javascript
// Export to JSON file (downloads automatically)
await __exportLogsToFile__()
```

Then analyze with the CLI tool:
```bash
# Summary + error overview
npm run analyze:logs -- exported-logs.json

# Show all errors grouped by message
npm run analyze:logs -- exported-logs.json --errors

# Filter by category
npm run analyze:logs -- exported-logs.json --category Audio

# Search for text
npm run analyze:logs -- exported-logs.json --search "AudioContext"

# Show activity timeline
npm run analyze:logs -- exported-logs.json --timeline

# Show session breakdown
npm run analyze:logs -- exported-logs.json --sessions
```

### Clear Old Logs
```javascript
// Clear all persisted logs
await __clearAllLogs__()
```

## Phase 1: Observation (Before Reproducing)

### Enable Debug Mode

Add `?debug=1` to the URL to enable the debug overlay:
```
http://localhost:5173/?debug=1
```

This shows:
- HTTP request/response logs
- WebSocket events
- State changes
- Multiplayer sync status

### Enable Structured Tracing

In the browser console:
```javascript
// Enable all traces
window.__DEBUG_TRACE__ = true

// Or filter by subsystem
window.__TRACE_FILTER__ = 'scheduler'  // Only scheduler traces
window.__TRACE_FILTER__ = 'audio'      // Only audio traces
```

### Logger Output

The app uses `logger.audio()`, `logger.ws()`, etc. which only output in development:
```javascript
// These appear automatically in dev mode
[Audio] Playing synth acid at step 6
[WS] Connected to session abc123
```

## Phase 2: Reproduction (Capturing the Bug)

### Start a Trace Span

When you're about to reproduce a bug, start a named span:
```javascript
// In console
window.__startSpan__('reproduce-silent-instrument')

// ... reproduce the bug ...

window.__endSpan__('reproduce-silent-instrument')
```

### Check for Known Patterns

Run detection for known bug patterns:
```javascript
window.__runBugDetection__()
// Returns: Map of pattern IDs to detection results
```

Search by symptom:
```javascript
window.__searchBugPatterns__('no sound')
// Returns: Array of patterns matching the symptom
```

### Export Traces for Analysis

```javascript
// Get all traces
const traces = window.__getTraces__()

// Export as JSON (copies to clipboard)
window.__exportTraces__()

// Get performance statistics
window.__getSpanStats__()
```

## Phase 3: Investigation (Finding Root Cause)

### Use Correlation IDs

When investigating a specific operation, use correlation IDs to trace across modules:
```javascript
// Find all traces for a specific operation
window.__getCorrelation__('abc123')
```

### Playback State Debugging

For audio/playback issues:
```javascript
window.__AUDIO_DEBUG__ = true
window.__getPlaybackState__()
// Shows: isRunning, currentStep, timerId, pendingTimers

// After stopping playback:
window.__assertPlaybackStopped__()
// Throws if state is inconsistent
```

### Audio Context Verification

Check for AudioContext mismatches (common after HMR):
```javascript
const result = window.__runBugDetection__().get('audio-context-mismatch')
console.log(result)
```

## Phase 4: Fix Confirmation

### Run Tests

```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# All tests
npm run test:all
```

### Verify in Debug Mode

1. Enable debug mode and tracing
2. Reproduce the original bug scenario
3. Confirm the fix works
4. Check traces show expected behavior

## Phase 5: Post-Fix Analysis (CRITICAL)

**This is the most important step.** After confirming a fix, IMMEDIATELY run the post-fix analysis to find similar issues.

### Using the Post-Fix Analysis Tool

```bash
# Interactive mode (recommended for first time)
npx tsx scripts/post-fix-analysis.ts --interactive

# Or specify patterns directly
npx tsx scripts/post-fix-analysis.ts \
  --pattern "getInstance\(\)" \
  --risky-context "Tone\." \
  --file src/audio/engine.ts \
  --symptom "no sound after HMR"
```

### Example: After Fixing Singleton Bug

```bash
npx tsx scripts/post-fix-analysis.ts \
  --pattern "let\\s+\\w+Instance.*=.*null" \
  --risky-context "new Tone\\." \
  --symptom "AudioContext mismatch" \
  --category "singleton" \
  --severity "high"
```

### What the Tool Does

1. **Searches entire codebase** for the pattern
2. **Ranks by risk level** (high if risky context found)
3. **Generates a report** saved to `debug-reports/`
4. **Suggests bug pattern entry** for the registry

### Using Claude Code for Post-Fix Analysis

When working with Claude Code, after confirming a fix, say:

> "The bug is fixed. Run post-fix analysis to find similar issues. The pattern was [description] in [file]."

Claude Code will:
1. Run the post-fix analysis tool
2. Review high-risk matches
3. Suggest which files need review
4. Update DEBUGGING-LESSONS-LEARNED.md if warranted

## Phase 6: Documentation

### Update Bug Patterns Registry

If this is a new pattern, add it to `src/utils/bug-patterns.ts`:

```typescript
{
  id: 'new-pattern-id',
  name: 'Descriptive Name',
  category: 'category',
  severity: 'high',
  description: 'What this bug is',
  symptoms: ['What user sees'],
  rootCause: 'Why it happens',
  detection: {
    runtime: () => detectFunction(),
    codePatterns: ['regex patterns'],
    logPatterns: ['log output patterns'],
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

### Update Lessons Learned

Add an entry to `docs/DEBUGGING-LESSONS-LEARNED.md`:

```markdown
## #XXX: Bug Title

**Date**: YYYY-MM-DD
**Severity**: high
**Category**: category

### Symptoms
- What user observed

### Root Cause
Why it happened

### Detection Strategy
How to find this bug

### Fix
What was done

### Prevention
How to prevent recurrence

### Post-Fix Analysis
\`\`\`bash
# Command to find similar issues
npx tsx scripts/post-fix-analysis.ts --pattern "..."
\`\`\`
```

## Tool Reference

### Debug Overlay (`?debug=1`)

| Feature | Description |
|---------|-------------|
| HTTP Logs | Request/response with timing |
| WebSocket Events | Connect, message, disconnect |
| Multiplayer Status | Players, sync quality |
| State Hashes | Local vs server comparison |

### Debug Tracer (Console)

| Command | Description |
|---------|-------------|
| `window.__DEBUG_TRACE__ = true` | Enable tracing |
| `window.__getTraces__()` | Get all traces |
| `window.__exportTraces__()` | Export as JSON |
| `window.__filterTraces__('term')` | Filter traces |
| `window.__getSpanStats__()` | Performance stats |
| `window.__getCorrelation__(id)` | Get by correlation ID |
| `window.__clearTraces__()` | Clear all traces |

### Bug Detection (Console)

| Command | Description |
|---------|-------------|
| `window.__runBugDetection__()` | Run all detectors |
| `window.__getBugPatterns__()` | Get all patterns |
| `window.__searchBugPatterns__('term')` | Search by symptom |

### Playback Debug (Console)

| Command | Description |
|---------|-------------|
| `window.__AUDIO_DEBUG__ = true` | Enable audio debug |
| `window.__getPlaybackState__()` | Get playback state |
| `window.__assertPlaybackStopped__()` | Assert stopped state |

### Analysis Scripts (Terminal)

| Script | Description |
|--------|-------------|
| `npm run analyze:bugs` | Run bug pattern analysis |
| `npm run analyze:bugs -- --pattern X` | Analyze specific pattern |
| `npx tsx scripts/post-fix-analysis.ts` | Post-fix similar bug search |

## Best Practices

### 1. Always Enable Debug Mode During Development

```
http://localhost:5173/?debug=1
```

This catches issues early and provides context when bugs occur.

### 2. Use Structured Logging

```typescript
// Good: Structured with context
logger.audio.log(`Playing ${preset} at step ${step}, freq=${freq}`);

// Bad: Unstructured
console.log('playing note');
```

### 3. Add Correlation IDs for Complex Operations

```typescript
import { tracer } from './debug-tracer';

function complexOperation() {
  const correlationId = tracer.startSpan('complex-operation');
  try {
    // ... operations ...
    tracer.event('step-completed', 'Did thing', { correlationId });
  } finally {
    tracer.endSpan('complex-operation');
  }
}
```

### 4. Run Post-Fix Analysis Immediately

Don't skip this step. It takes 30 seconds and often finds similar bugs:

```bash
npx tsx scripts/post-fix-analysis.ts --interactive
```

### 5. Document Non-Obvious Bugs

If a bug took more than 15 minutes to diagnose, it deserves an entry in DEBUGGING-LESSONS-LEARNED.md.

## Integration with Claude Code

Claude Code is configured to automatically:

1. **Check bug patterns** when debugging issues
2. **Run post-fix analysis** after confirming fixes
3. **Update documentation** when new patterns are discovered

To trigger manual analysis with Claude Code:

```
"Run post-fix analysis for [pattern] with risky context [context]"
```

Claude Code will dispatch the analysis and review results.
