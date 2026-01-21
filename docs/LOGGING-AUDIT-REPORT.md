# Logging Audit Report

**Audit Date:** January 21, 2026
**Auditor:** Claude
**Skill Used:** [logging-best-practices](/.claude/skills/logging-best-practices/SKILL.md) by Boris Tane
**Codebase:** Keyboardia

---

## Executive Summary

The Keyboardia codebase has a **dual logging architecture**:

1. **Client-side**: Custom logger with IndexedDB persistence (`app/src/utils/logger.ts`)
2. **Server-side**: Observability 2.0 wide events (`app/src/worker/observability.ts`)

The **server-side logging follows best practices exceptionally well**, implementing the "wide events" pattern (canonical log lines) as recommended. However, the **client-side logging has significant gaps** compared to the best practices outlined in the skill.

### Overall Assessment

| Area | Grade | Summary |
|------|-------|---------|
| **Wide Events (Server)** | A | Excellent implementation with Observability 2.0 pattern |
| **Wide Events (Client)** | D | Scattered logs, no wide event pattern |
| **High Cardinality** | B | Good on server (requestId, playerId); Missing on client |
| **Business Context** | C | Limited business context on both sides |
| **Environment Context** | A | Excellent deployment/infra context on server |
| **Single Logger** | B | Single logger exists but bypassed by 80+ direct console calls |
| **Middleware Pattern** | A | Server uses middleware; Client does not |
| **Structure & Format** | B | JSON on server; Mixed on client |

---

## Detailed Findings

### 1. Wide Events (CRITICAL)

#### Server-Side: EXCELLENT

The server implements the Observability 2.0 pattern with two wide event types:

**Location:** `app/src/worker/observability.ts:127-230`

```typescript
// HTTP Request Wide Event - one per request
export interface HttpRequestEvent {
  event: 'http_request';
  requestId: string;
  method: string;
  path: string;
  deviceType: 'mobile' | 'desktop';
  timestamp: string;
  duration_ms: number;
  status: number;
  outcome: 'ok' | 'error';
  error?: ErrorInfo;
  warnings?: Warning[];
  deploy: DeployInfo;
  infra: InfraInfo;
  service: ServiceInfo;
  // ... more fields
}

// WebSocket Session Wide Event - one per connection
export interface WsSessionEvent {
  event: 'ws_session';
  connectionId: string;
  sessionId: string;
  playerId: string;
  connectedAt: string;
  disconnectedAt: string;
  duration_ms: number;
  messageCount: number;
  messagesByType: Record<string, number>;
  outcome: 'ok' | 'error';
  // ... more fields
}
```

**Strengths:**
- Single event per HTTP request lifecycle
- Single event per WebSocket session lifecycle
- Events emitted in `finally` block pattern
- Includes timing, outcome, errors, and warnings
- Structured JSON format

#### Client-Side: POOR

The client uses **scattered logging** with 339+ individual log calls throughout the codebase. There is no wide event pattern for client operations.

**Anti-pattern examples found:**

**Location:** `app/src/audio/engine.ts` (Multiple scattered logs)
```typescript
// 6+ log lines for a single audio unlock operation
logger.audio.log('AudioContext needs unlock, state:', ctx.state);
// ...later
logger.audio.log('AudioContext resumed, state:', ctx.state);
// ...later
logger.audio.log('AudioContext unlocked successfully');
```

**Location:** `app/src/sync/multiplayer.ts` (Debug assertions as logs)
```typescript
logger.ws.log(`[ASSERT] LOAD_STATE dispatched: reason=${reason}, source=${source}`);
logger.ws.log(`[ASSERT] toggle_step SENT: track=${trackId}, step=${step}, time=${Date.now()}`);
logger.ws.log(`[ASSERT] step_toggled RECEIVED (own message, skipped): ...`);
```

**Recommendation:** Implement a wide event pattern for client operations:
- One event per user interaction (e.g., "step_toggled", "playback_started")
- One event per audio operation lifecycle
- One event per sync operation lifecycle

---

### 2. High Cardinality & Dimensionality (CRITICAL)

#### Server-Side: GOOD

The server includes high-cardinality identifiers:
- `requestId` - unique per request
- `connectionId` - unique per WebSocket
- `sessionId` - unique per music session
- `playerId` - unique per user

**Location:** `app/src/worker/observability.ts:127-176`

#### Client-Side: PARTIAL

The client log store includes `sessionId` per browser session (`log-store.ts:79`):
```typescript
const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
```

**Missing high-cardinality fields on client:**
- No `requestId` linking client to server events
- No `trackId` in audio logs
- No `operationId` for multi-step operations
- No user/session identifiers in structured data

**Recommendation:** Add request ID propagation:
```typescript
// Generate requestId on client, send in headers, include in all logs
const requestId = crypto.randomUUID();
wideEvent.requestId = requestId;
```

---

### 3. Business Context (CRITICAL)

#### Server-Side: LIMITED

The server includes some context:
- `isPublished` - whether session is published
- `isCreator` - whether user created the session
- `peakConcurrentPlayers` - collaboration metric

**Missing business context:**
- No track count per session
- No complexity metrics (BPM, effects enabled)
- No user engagement metrics (edit count, play count during edit)

**Location:** `app/src/worker/observability.ts:178-230`

#### Client-Side: POOR

Client logs rarely include business context:

```typescript
// Current: Just technical details
logger.audio.log('Playing sample', {
  instrumentId,
  startTime,
  duration
});

// Should include business context:
// - Track name/index
// - Is user playing or is it a preview?
// - Session complexity (track count, total steps)
// - User session duration
```

**Recommendation:** Add business context to all events:
```typescript
wideEvent.session = {
  trackCount: tracks.length,
  totalSteps: tracks.reduce((sum, t) => sum + t.steps.filter(Boolean).length, 0),
  bpm: state.bpm,
  hasEffects: state.effects.some(e => e.enabled),
};
```

---

### 4. Environment Characteristics (CRITICAL)

#### Server-Side: EXCELLENT

The server captures comprehensive deployment info:

**Location:** `app/src/worker/observability.ts:236-271`

```typescript
export function getDeployInfo(env: Env): DeployInfo {
  return {
    versionId: metadata?.id ?? 'unknown',
    versionTag: metadata?.tag,
    deployedAt: metadata?.timestamp,
  };
}

export function getInfraInfo(request: Request): InfraInfo {
  return {
    colo: cf?.colo ?? 'unknown',    // Cloudflare data center
    country: cf?.country ?? 'unknown',
  };
}

export function getServiceInfo(env: Env): ServiceInfo {
  return {
    name: env.SERVICE_NAME ?? 'keyboardia',
    environment: env.ENVIRONMENT ?? 'production',
  };
}
```

#### Client-Side: MISSING

The client logger does NOT include:
- Browser version
- App version/build hash
- User locale/timezone
- Screen size/device type
- Feature flags enabled

**Recommendation:** Add environment context at logger initialization:
```typescript
const envContext = {
  appVersion: import.meta.env.VITE_APP_VERSION,
  commitHash: import.meta.env.VITE_COMMIT_SHA,
  browser: navigator.userAgent,
  locale: navigator.language,
  screenSize: `${window.innerWidth}x${window.innerHeight}`,
  deviceType: /mobile/i.test(navigator.userAgent) ? 'mobile' : 'desktop',
};
```

---

### 5. Single Logger (HIGH)

#### Implementation: GOOD BUT BYPASSED

**Location:** `app/src/utils/logger.ts:106-114`

```typescript
export const logger = {
  ...createLogger(),
  ws: createLogger('[WS]'),
  audio: createLogger('[Audio]'),
  multiplayer: createLogger('[Multiplayer]'),
  session: createLogger('[Session]'),
};
```

**Problem: 80+ Direct Console Calls**

The codebase has 80+ `console.log`, `console.warn`, `console.error` calls that bypass the logger:

| Location | Count | Issue |
|----------|-------|-------|
| `app/src/utils/log-store.ts` | 10+ | Logs about logging itself |
| `app/src/utils/debug-coordinator.ts` | 9 | Debug system logs |
| `app/src/worker/live-session.ts` | 75+ | Server-side console.log |
| `app/src/debug/audio-debug.ts` | 100+ | Debug tools |
| `app/src/components/*.tsx` | 5+ | Component-level logs |

**Server-side exception:** The server (`worker/`) correctly uses `console.log(JSON.stringify(...))` to emit wide events to Cloudflare Workers Logs. This is intentional and correct.

**Recommendation:**
1. Audit all client-side `console.*` calls
2. Replace with `logger.*` calls or remove entirely
3. Add ESLint rule: `no-console` with exceptions for production error handling

---

### 6. Middleware Pattern (HIGH)

#### Server-Side: IMPLEMENTED

The server uses the observability module as middleware-like infrastructure:

**Location:** `app/src/worker/live-session.ts:32-45`

```typescript
import {
  emitWsSessionEvent,
  getDeployInfo,
  getInfraInfo,
  getServiceInfo,
  // ...
} from './observability';
```

Wide events are emitted at connection close with all accumulated context.

#### Client-Side: NOT IMPLEMENTED

The client has no logging middleware. Each component/module logs independently.

**Recommendation:** Create a React context or global middleware that:
1. Initializes a wide event at operation start
2. Accumulates context during operation
3. Emits the event in cleanup/finally

---

### 7. Structure & Consistency (HIGH)

#### Server-Side: EXCELLENT

- Uses JSON format consistently
- Consistent field naming (`duration_ms`, `outcome`, etc.)
- Two log levels: events logged at info level, errors embedded in events

#### Client-Side: INCONSISTENT

**Problem: Multiple log formats:**

```typescript
// Format 1: Unstructured string
logger.audio.log('AudioContext needs unlock, state:', ctx.state);

// Format 2: Structured object
logger.ws.log('[ASSERT] LOAD_STATE dispatched:', { reason, source });

// Format 3: Template literal
console.log(`[Log Store] Cleanup: deleted ${deleted} logs`);
```

**Problem: Inconsistent field names:**

| Location | Field Name | Should Be |
|----------|------------|-----------|
| Various | `instrumentId` | `instrument_id` |
| Various | `sessionId` | `session_id` |
| Various | `trackId` | `track_id` |

**Recommendation:**
1. Define a shared schema for log fields
2. Use snake_case consistently (matches server)
3. Always log structured objects, not string interpolation

---

### 8. Anti-Patterns Found

#### Anti-Pattern 1: Too Many Log Lines Per Request

**Location:** `app/src/audio/audioTriggers.ts:183-424`

The audio unlock sequence has **20+ log lines** for a single user gesture:

```typescript
logger.audio.log('Audio unlock starting...');
logger.audio.log('Creating audio context...');
logger.audio.log('Resuming audio context...');
// ...15 more lines
logger.audio.log('Audio unlock complete');
```

**Fix:** Consolidate into a single wide event with all context.

#### Anti-Pattern 2: Missing Request Correlation

Client logs have no way to correlate with server logs:

```typescript
// Client sends toggle request
logger.ws.log('toggle_step SENT:', { trackId, step });

// Server receives and processes (different log system)
console.log('[DO] Processing toggle_step');

// No requestId links these events
```

**Fix:** Generate requestId on client, include in WebSocket messages, log on both ends.

#### Anti-Pattern 3: Unstructured Strings

**Location:** `app/src/utils/log-store.ts:532-542`

```typescript
console.log(`
📁 Log Store Initialized (Session: ${SESSION_ID})
   Query:     await __queryLogs__({ level: 'error', category: 'audio' })
   ...
`);
```

**Fix:** Log structured initialization event, output help text separately or remove.

---

## Recommendations Summary

### Critical (Implement First)

1. **Add Wide Events to Client**
   - Create `clientWideEvent.ts` module
   - One event per user interaction
   - One event per operation lifecycle
   - Emit at operation end in finally block

2. **Add Request ID Propagation**
   - Generate requestId on client
   - Include in all HTTP/WebSocket messages
   - Log on both client and server

3. **Add Business Context**
   - Session complexity metrics
   - User engagement metrics
   - Feature usage tracking

### High Priority

4. **Consolidate to Single Logger**
   - Replace all `console.*` calls with `logger.*`
   - Add ESLint rule to enforce

5. **Add Environment Context to Client**
   - App version, commit hash
   - Device type, browser info
   - Feature flags

6. **Standardize Field Names**
   - Use snake_case consistently
   - Document schema in shared module

### Medium Priority

7. **Create Logging Middleware**
   - React context for wide event accumulation
   - Automatic timing and outcome tracking

8. **Reduce Log Volume**
   - Consolidate scattered logs into wide events
   - Remove debug-only logs from production builds

---

## Files Requiring Changes

| Priority | File | Change Required |
|----------|------|-----------------|
| Critical | NEW: `app/src/utils/wideEvent.ts` | Create client-side wide event module |
| Critical | `app/src/utils/logger.ts` | Add environment context, structured format |
| High | `app/src/utils/log-store.ts` | Replace console.log with logger calls |
| High | `app/src/utils/debug-coordinator.ts` | Replace console.log with logger calls |
| High | `app/src/audio/engine.ts` | Consolidate to wide events |
| High | `app/src/audio/audioTriggers.ts` | Consolidate to wide events |
| High | `app/src/sync/multiplayer.ts` | Add requestId, consolidate logs |
| Medium | `app/src/components/*.tsx` | Remove/consolidate console calls |
| Medium | `app/src/debug/*.ts` | Review debug-only logging |

---

## Metrics to Track After Implementation

1. **Log Volume Reduction**: Target 80% fewer log lines per operation
2. **Query Coverage**: 100% of operations queryable by requestId
3. **Debug Time**: Measure time to diagnose issues before/after
4. **Storage Efficiency**: Monitor IndexedDB size with wide events vs scattered logs

---

## References

- [Logging Sucks](https://loggingsucks.com) - Boris Tane's motivation for wide events
- [Observability Wide Events 101](https://boristane.com/blog/observability-wide-events-101/) - Detailed explanation
- [Stripe - Canonical Log Lines](https://stripe.com/blog/canonical-log-lines) - Industry best practice

---

*This audit was conducted using the logging-best-practices skill. The skill is installed at `.claude/skills/logging-best-practices/`.*
