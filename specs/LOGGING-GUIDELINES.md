# Logging Guidelines Spec

> **Status:** Proposal
> **Source:** [loggingsucks.com](https://loggingsucks.com/) analysis
> **Related:** [OBSERVABILITY.md](./OBSERVABILITY.md), [QUOTA-OBSERVABILITY.md](./QUOTA-OBSERVABILITY.md)

---

## Executive Summary

This document extracts actionable guidelines from modern logging philosophy (loggingsucks.com) and evaluates Keyboardia's current observability approach against these principles. The core insight: **traditional line-by-line logging was designed for monolithic applications—modern distributed systems need "wide events" with rich context**.

---

## Part 1: Extracted Guidelines from loggingsucks.com

### The Core Problem

> "Logs were designed for a different era—an era of monoliths, single servers, and problems you could reproduce locally. Today, a single user request might touch 15 services, 3 databases, 2 caches, and a message queue."

Traditional logging fails because:
1. **Missing context**: Individual log lines lack the full picture
2. **Correlation is hard**: Stitching related events across services requires manual effort
3. **Low signal-to-noise**: Verbose logs make finding issues harder, not easier
4. **Expensive at scale**: Storing everything is cost-prohibitive

### Actionable Guidelines

#### 1. Build Wide Events, Emit Once

**Principle**: Instead of emitting many small log lines throughout a request, build up a single rich event throughout the request lifecycle and emit it once at the end.

```typescript
// ❌ Traditional logging (multiple emissions)
function handleRequest(req) {
  logger.log('Request received', { path: req.path });
  logger.log('Authenticated user', { userId: user.id });
  logger.log('Fetched data', { recordCount: 42 });
  logger.log('Response sent', { status: 200, duration: 150 });
}

// ✅ Wide event (single emission with full context)
function handleRequest(req) {
  const event = { path: req.path, startTime: Date.now() };

  event.userId = authenticate(req);
  event.recordCount = fetchData().length;
  event.status = 200;
  event.duration = Date.now() - event.startTime;

  emit(event); // Single emission with everything
}
```

#### 2. Embrace High-Cardinality Fields

**Principle**: Don't fear unique identifiers. Modern tools handle them well.

**Include these fields liberally:**
- `userId`, `sessionId`, `requestId`, `playerId`
- `userAgent`, `ipHash`, `region`
- `buildVersion`, `featureFlags`
- Specific identifiers like `trackId`, `sampleId`, `messageType`

#### 3. Use Structured Data, Not Strings

**Principle**: Emit structured (JSON) data that can be queried, not formatted strings.

```typescript
// ❌ String formatting (hard to query)
console.log(`[WS] connect session=${sessionId} player=${playerId}`);

// ✅ Structured data (queryable)
emit({
  type: 'ws_connect',
  sessionId,
  playerId,
  timestamp: Date.now(),
  metadata: { region, userAgent }
});
```

#### 4. Implement Smart Tail Sampling

**Principle**: At scale, keep only a percentage of events—but sample intelligently.

**Tail Sampling Rules:**
| Rule | Retention | Rationale |
|------|-----------|-----------|
| Errors (5xx, exceptions) | 100% | Always need to debug failures |
| Slow requests (> p99 latency) | 100% | Performance issues are critical |
| VIP users / test accounts | 100% | Need full visibility for key accounts |
| Random sample of success | 1-10% | Baseline understanding |

#### 5. Wide Events Complement Tracing

**Principle**: Tracing shows request flow across services; wide events provide context within a service. They're complementary.

Ideal state: **Wide events ARE your trace spans**, enriched with all context.

#### 6. Design for Analytics, Not Grep

**Principle**: Structure data for columnar databases (ClickHouse, BigQuery), not text search.

**Query patterns to enable:**
- "Show me all requests where `duration > 500ms` AND `userId = X`"
- "Group by `messageType` and show p50/p95/p99 latencies"
- "Find all sessions where `stateHashMismatch = true`"

---

## Part 2: Delta Analysis with Keyboardia's Current Approach

### What Keyboardia Does Well ✅

| Guideline | Current Implementation | Status |
|-----------|----------------------|--------|
| Structured data | `WebSocketLog` interface with typed fields | ✅ Good |
| Session/Player IDs | Every log includes `sessionId`, `playerId` | ✅ Good |
| State hashing | Canonical hashing for consistency detection | ✅ Good |
| Debug endpoints | Queryable APIs for connections, state, logs | ✅ Good |
| Categorized logging | `logger.ws()`, `logger.audio()`, etc. | ✅ Good |

### Gaps Identified ⚠️

#### Gap 1: Multiple Emissions Instead of Wide Events

**Current approach** (in `logging.ts`):
```typescript
// Emits separate logs for each WebSocket event
storeWsLog(env, createWsConnectLog(sessionId, playerId));
storeWsLog(env, createWsMessageLog(sessionId, playerId, type, payload));
storeWsLog(env, createWsDisconnectLog(sessionId, playerId, reason, duration));
```

**Wide event approach**:
```typescript
// Build up context, emit once on disconnect
interface WsSessionEvent {
  sessionId: string;
  playerId: string;
  connectedAt: number;
  disconnectedAt: number;
  duration: number;
  messageCount: number;
  messagesByType: Record<string, number>;
  stateHashAtConnect: string;
  stateHashAtDisconnect: string;
  hashMismatchCount: number;
  disconnectReason: string;
  region?: string;
}
```

**Impact**: 3+ KV writes per connection → 1 KV write per connection

---

#### Gap 2: Console Logs Are String-Formatted

**Current approach** (in `logging.ts:484-494`):
```typescript
console.log(`[WS] ${typeLabel.toLowerCase()} session=${sessionId} player=${playerId}`);
```

**Recommended approach**:
```typescript
console.log(JSON.stringify({
  event: 'ws_connect',
  sessionId,
  playerId,
  timestamp: Date.now(),
}));
```

**Impact**: Enables `wrangler tail --format=json | jq` queries

---

#### Gap 3: No Tail Sampling Strategy

**Current approach**: Store everything (limited by KV quota)

**Recommended approach**:
```typescript
function shouldRetainEvent(event: WsSessionEvent): boolean {
  // Always keep errors
  if (event.disconnectReason === 'error') return true;

  // Always keep slow connections (> 1 minute with no messages = likely stuck)
  if (event.duration > 60 && event.messageCount === 0) return true;

  // Always keep hash mismatches
  if (event.hashMismatchCount > 0) return true;

  // Sample 10% of normal sessions
  return Math.random() < 0.1;
}
```

**Impact**: 90% reduction in storage for healthy sessions

---

#### Gap 4: No Request-Level Wide Events

HTTP requests log individual lines but don't build wide events.

**Current approach** (`RequestLog` interface):
- Captures request/response basics
- Missing: full context accumulated during request

**Recommended addition**:
```typescript
interface HttpRequestEvent {
  // Request context
  requestId: string;
  method: string;
  path: string;
  sessionId?: string;

  // Accumulated context
  kvReadsCount: number;
  kvWritesCount: number;
  durableObjectCalls: number;

  // Outcome
  status: number;
  duration: number;
  error?: string;

  // Computed flags (for filtering)
  isError: boolean;
  isSlow: boolean; // > p95
}
```

---

#### Gap 5: Client Logs Don't Link to Server Traces

**Current approach**:
- Client logs to IndexedDB with `sessionId`
- Server logs to KV with `sessionId`
- No correlation ID linking specific client actions to server events

**Recommended approach**:
```typescript
// Client generates correlationId for each user action
const correlationId = generateCorrelationId();

// Send with WebSocket message
ws.send(JSON.stringify({
  type: 'toggle_step',
  correlationId,  // New field
  trackId,
  step
}));

// Log locally
logger.ws.log('Sent toggle_step', { correlationId, trackId, step });

// Server logs include correlationId
createWsMessageLog(sessionId, playerId, 'toggle_step', { correlationId, ...payload });
```

**Impact**: Can trace a specific user click through client → server → broadcast

---

### Summary Matrix

| Aspect | loggingsucks.com Ideal | Keyboardia Current | Gap |
|--------|----------------------|-------------------|-----|
| Event granularity | Wide (1 per lifecycle) | Narrow (many per lifecycle) | 🔴 Major |
| Console format | JSON structured | String formatted | 🟡 Moderate |
| Sampling | Tail sampling with rules | Store everything | 🟡 Moderate |
| HTTP events | Full context accumulated | Basic request/response | 🟡 Moderate |
| Correlation | End-to-end tracing | Session-level only | 🟡 Moderate |
| Cardinality | High (user/session/request) | Good (session/player) | 🟢 Minor |
| Queryability | Analytics-first | Debug-endpoint first | 🟢 Minor |

---

## Part 3: Implementation Recommendations

### Phase 1: Wide Events for WebSocket Sessions (Low Effort, High Impact)

Replace per-event logging with session-lifecycle events.

**Changes required:**
1. Add `WsSessionContext` class to accumulate state during connection
2. Emit single `WsSessionEvent` on disconnect
3. Keep real-time console logs for `wrangler tail` (formatted JSON)

**KV impact**: ~70% reduction in writes

```typescript
class WsSessionContext {
  readonly sessionId: string;
  readonly playerId: string;
  readonly connectedAt: number;

  private messageCount = 0;
  private messagesByType: Record<string, number> = {};
  private hashMismatches = 0;

  recordMessage(type: string) {
    this.messageCount++;
    this.messagesByType[type] = (this.messagesByType[type] ?? 0) + 1;
  }

  recordHashMismatch() {
    this.hashMismatches++;
  }

  toEvent(disconnectReason: string): WsSessionEvent {
    return {
      sessionId: this.sessionId,
      playerId: this.playerId,
      connectedAt: this.connectedAt,
      disconnectedAt: Date.now(),
      duration: Date.now() - this.connectedAt,
      messageCount: this.messageCount,
      messagesByType: this.messagesByType,
      hashMismatchCount: this.hashMismatches,
      disconnectReason,
    };
  }
}
```

---

### Phase 2: Smart Tail Sampling

Only persist events that matter.

**Changes required:**
1. Add `shouldRetainEvent()` function
2. Always log to console (for real-time tail)
3. Only write to KV if retained

```typescript
async function onDisconnect(ctx: WsSessionContext, reason: string) {
  const event = ctx.toEvent(reason);

  // Always log for real-time visibility
  console.log(JSON.stringify({ ...event, _event: 'ws_session_end' }));

  // Only persist interesting events
  if (shouldRetainEvent(event)) {
    await storeWsSessionEvent(env, event);
  }
}

function shouldRetainEvent(event: WsSessionEvent): boolean {
  if (event.disconnectReason !== 'normal_close') return true;
  if (event.hashMismatchCount > 0) return true;
  if (event.duration > 3600) return true; // > 1 hour
  if (event.messageCount > 1000) return true; // Very active
  return Math.random() < 0.1; // 10% sample of normal
}
```

---

### Phase 3: Correlation IDs

Link client actions to server processing.

**Changes required:**
1. Add `correlationId` to client action events
2. Include in WebSocket messages
3. Log on both sides with same ID

**Schema addition:**
```typescript
interface MultplayerMessage {
  type: string;
  correlationId?: string; // New: UUID generated by client
  // ... existing fields
}
```

---

### Phase 4: Structured Console Output

Make `wrangler tail` output machine-parseable.

**Changes required:**
1. Replace template string logs with JSON.stringify
2. Add `_event` field for filtering

```typescript
// Before
console.log(`[WS] connect session=${sessionId} player=${playerId}`);

// After
console.log(JSON.stringify({
  _event: 'ws_connect',
  sessionId,
  playerId,
  timestamp: Date.now(),
}));
```

**Usage:**
```bash
wrangler tail --format=json | jq 'select(._event == "ws_connect")'
```

---

## Appendix: Quick Reference

### Wide Event Checklist

When designing a new event type, include:

- [ ] **Who**: userId, sessionId, playerId
- [ ] **What**: eventType, action, targetId
- [ ] **When**: timestamp, duration
- [ ] **Where**: region, path, component
- [ ] **How**: messageCount, retryCount, latency
- [ ] **Outcome**: status, error, hashMatch

### Sampling Decision Tree

```
Is this an error? ──Yes──→ KEEP
       │
       No
       │
Is this slow (>p99)? ──Yes──→ KEEP
       │
       No
       │
Is this a VIP/test user? ──Yes──→ KEEP
       │
       No
       │
Random(0.1)? ──Yes──→ KEEP
       │
       No
       │
       DROP
```

---

## Sources

- [Logging Sucks - Your Logs Are Lying To You](https://loggingsucks.com/)
- [Hacker News Discussion](https://news.ycombinator.com/item?id=46346796)

---

*Document created: December 2025*
