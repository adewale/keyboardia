# Logging Guidelines Spec

> **Status:** Proposal
> **Source:** [loggingsucks.com](https://loggingsucks.com/), Cloudflare Workers docs, Honeycomb/Charity Majors
> **Related:** [OBSERVABILITY.md](./OBSERVABILITY.md), [QUOTA-OBSERVABILITY.md](./QUOTA-OBSERVABILITY.md)

---

## Executive Summary

This document defines Keyboardia's logging and observability strategy based on three sources:

1. **loggingsucks.com** - The case for wide events over traditional logging
2. **Cloudflare Workers Observability** - Platform-native capabilities we should leverage
3. **Observability 2.0 (Charity Majors / Honeycomb)** - The philosophical foundation

### The Core Shift: Observability 1.0 → 2.0

| Observability 1.0 (avoid) | Observability 2.0 (target) |
|---------------------------|---------------------------|
| Three pillars (metrics, logs, traces) as separate concerns | **Single source of truth**: wide structured events |
| Collect metrics independently, then correlate | **Derive metrics from events** at query time |
| Design for known questions (dashboards, alerts) | **Design for unknown unknowns** (arbitrary queries) |
| Schema defined upfront, low cardinality | **Schema-free, high cardinality** embraced |
| Aggregate at write time | **Never smoosh data**—keep raw events |

> "Observability 2.0 has one source of truth, wide structured log events, from which you can derive all the other data types. That's it. That's what defines each generation."
> — Charity Majors

---

## Part 1: Foundational Principles

### 1.1 Wide Events: The Single Source of Truth

**Principle**: Instead of emitting many small log lines throughout a request, build up a single rich event throughout the request lifecycle and emit it once at the end.

```typescript
// ❌ Observability 1.0: Multiple emissions, context scattered
function handleRequest(req) {
  logger.log('Request received', { path: req.path });
  metrics.increment('requests_total');
  logger.log('Authenticated user', { userId: user.id });
  logger.log('Fetched data', { recordCount: 42 });
  metrics.histogram('request_duration', duration);
  logger.log('Response sent', { status: 200, duration: 150 });
}

// ✅ Observability 2.0: Single wide event, metrics derived
function handleRequest(req) {
  const event = { path: req.path, startTime: Date.now() };

  event.userId = authenticate(req);
  event.recordCount = fetchData().length;
  event.status = 200;
  event.duration = Date.now() - event.startTime;

  emit(event); // Single emission—metrics computed at query time
}
```

**Why this matters**: Once you aggregate data (count requests, compute averages), you can never un-aggregate it. By keeping raw events, you can answer questions you didn't anticipate.

### 1.2 High Cardinality Is Required, Not Feared

**Principle**: Your observability tool must support high cardinality and high dimensionality. If it can't, it's not observability—it's monitoring.

> "If you ask your vendors one thing, one thing, ask them how they handle high cardinality."
> — Charity Majors

**Include these fields liberally:**
- `userId`, `sessionId`, `requestId`, `playerId`, `correlationId`
- `userAgent`, `ipHash`, `region`, `colo` (Cloudflare data center)
- `buildVersion`, `featureFlags`, `deploymentId`
- Domain-specific: `trackId`, `sampleId`, `messageType`, `stateHash`

**Cardinality explosion is only a problem in Observability 1.0 tools** (Datadog, traditional metrics). Modern columnar stores (ClickHouse, Honeycomb, Cloudflare's Workers Logs) handle it natively.

### 1.3 Derive Metrics From Events

**Principle**: Metrics should be computed at query time from events, not collected separately.

```typescript
// ❌ Observability 1.0: Separate metrics collection
await trackWsMessage(env, sessionId, messageType);  // Increments counter in KV
await storeWsLog(env, log);  // Stores event separately

// ✅ Observability 2.0: Store event, derive metrics
await storeWideEvent(env, event);  // Contains messageType, duration, everything

// Query: "SELECT messageType, COUNT(*) FROM events GROUP BY messageType"
// Query: "SELECT percentile(duration, 0.99) FROM events WHERE error = true"
```

**Current anti-pattern in Keyboardia**: `WebSocketMetrics` in `logging.ts` tracks `active`, `total`, and `messages` counts separately from event logs. This duplicates data and limits queryability.

### 1.4 Design for Unknown Unknowns

**Principle**: Observability is the ability to ask new questions of your system without shipping new code.

> "Monitoring is about known-unknowns and actionable alerts. Observability is about unknown-unknowns and empowering you to ask arbitrary new questions."
> — Honeycomb

**Query-first mindset**:
- "Show me all WebSocket sessions where `hashMismatchCount > 0` AND `region = 'ewr'`"
- "What's the p99 duration for sessions with `messageType = 'set_tempo'`?"
- "Find all sessions from `userId = X` in the last 24 hours"

**Current gap**: Debug endpoints answer pre-defined questions. We need to enable arbitrary slicing.

---

## Part 2: Cloudflare-Native Configuration

### 2.1 Enable Workers Logs (Required)

Workers Logs provides 7-day retention with native structured log support. **This should replace KV-based log storage.**

**wrangler.toml configuration:**
```toml
[observability]
enabled = true

[observability.logs]
enabled = true
head_sampling_rate = 1.0      # 100% in dev/staging
invocation_logs = true        # Include Cloudflare's automatic request metadata
```

**Environment-specific sampling:**
```toml
[env.production.observability.logs]
head_sampling_rate = 0.1      # 10% head sampling for high-traffic production
```

### 2.2 Head Sampling vs Tail Sampling

Cloudflare Workers supports **head-based sampling** (decide before execution). We also implement **tail-based sampling** (decide after execution). Use both.

| Sampling Type | When Decision Made | Use Case |
|---------------|-------------------|----------|
| **Head sampling** | Before request executes | Reduce volume for high-traffic routes |
| **Tail sampling** | After request completes | Keep 100% of errors, slow requests |

```typescript
// Tail sampling: Applied AFTER we have full context
function shouldRetainEvent(event: WsSessionEvent): boolean {
  // Always keep errors (overrides head sampling for importance)
  if (event.disconnectReason !== 'normal_close') return true;

  // Always keep anomalies
  if (event.hashMismatchCount > 0) return true;
  if (event.duration > 3600) return true; // > 1 hour session
  if (event.messageCount > 1000) return true; // Very active

  // Head sampling already reduced volume; tail sample the rest
  return Math.random() < 0.1;
}
```

### 2.3 Leverage Automatic Instrumentation

Cloudflare Workers automatically instruments:
- **Subrequests**: fetch() calls to external APIs
- **KV operations**: get, put, delete with timing
- **Durable Object calls**: RPC timing and errors
- **Cache operations**: hit/miss with timing

**These appear in Workers Logs automatically when `invocation_logs = true`.**

Enable automatic tracing for richer instrumentation:
```toml
[observability.traces]
enabled = true    # Automatic span generation for all platform calls
```

### 2.4 Workers Logs vs KV Storage

**Recommendation**: Use Workers Logs for observability, reserve KV for application state.

| Aspect | Workers Logs (recommended) | KV-based (current) |
|--------|---------------------------|-------------------|
| **Retention** | 7 days | 1 hour TTL |
| **Cost** | Separate billing, generous free tier | Counts against KV write quota |
| **Queryability** | Query Builder in dashboard | Custom debug endpoints |
| **Limits** | 256KB per log, 5B/day | 25MB per key |
| **Indexing** | Automatic on all JSON fields | Manual |

**Migration path**: Emit structured JSON via `console.log()`. Workers Logs automatically ingests, indexes, and makes it queryable.

```typescript
// Automatically indexed by Workers Logs
console.log(JSON.stringify({
  _event: 'ws_session_end',
  sessionId,
  playerId,
  duration,
  messageCount,
  hashMismatchCount,
  disconnectReason,
}));
```

---

## Part 3: Delta Analysis with Current Implementation

### What Keyboardia Does Well

| Guideline | Current Implementation | Status |
|-----------|----------------------|--------|
| Structured data | `WebSocketLog` interface with typed fields | ✅ Good |
| Session/Player IDs | Every log includes `sessionId`, `playerId` | ✅ Good |
| State hashing | Canonical hashing for consistency detection | ✅ Good |
| Debug endpoints | Queryable APIs for connections, state, logs | ✅ Good |
| Categorized logging | `logger.ws()`, `logger.audio()`, etc. | ✅ Good |

### Gaps to Address

#### Gap 1: Multiple Emissions Instead of Wide Events

**Current** (`logging.ts`):
```typescript
// 3+ KV writes per WebSocket connection
storeWsLog(env, createWsConnectLog(sessionId, playerId));
storeWsLog(env, createWsMessageLog(sessionId, playerId, type, payload));
storeWsLog(env, createWsDisconnectLog(sessionId, playerId, reason, duration));
```

**Target**:
```typescript
// 1 event per WebSocket lifecycle, emitted on disconnect
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
  colo?: string;
}
```

#### Gap 2: Metrics Collected Separately from Events

**Current** (`logging.ts`):
```typescript
// Separate metrics tracking
export async function trackWsConnect(env: Env, sessionId: string): Promise<void> {
  const metrics = existing ?? { active: 0, total: 0, messages: {} };
  metrics.active++;
  metrics.total++;
  await env.SESSIONS.put(key, JSON.stringify(metrics), { expirationTtl: 86400 });
}
```

**Target**: Delete `trackWsConnect`, `trackWsDisconnect`, `trackWsMessage`. Derive counts from events:
```sql
-- Metrics derived at query time
SELECT COUNT(*) as total_connections FROM events WHERE _event = 'ws_session_end'
SELECT messageType, SUM(count) FROM events, UNNEST(messagesByType) GROUP BY messageType
```

#### Gap 3: Console Logs Are String-Formatted

**Current** (`logging.ts:484-494`):
```typescript
console.log(`[WS] ${typeLabel.toLowerCase()} session=${sessionId} player=${playerId}`);
```

**Target**:
```typescript
console.log(JSON.stringify({
  _event: 'ws_connect',
  sessionId,
  playerId,
  timestamp: Date.now(),
  colo: request.cf?.colo,
}));
```

#### Gap 4: Using KV Instead of Workers Logs

**Current**: Logs stored in KV with 1-hour TTL, consuming write quota.

**Target**: Emit to `console.log()` as structured JSON. Workers Logs handles storage, indexing, and 7-day retention automatically.

#### Gap 5: No Correlation IDs

**Current**: Session-level correlation only.

**Target**: Request-level correlation linking client action → server processing → broadcast.

```typescript
// Client generates correlationId
const correlationId = crypto.randomUUID().slice(0, 8);
ws.send(JSON.stringify({ type: 'toggle_step', correlationId, trackId, step }));

// Server includes in event
console.log(JSON.stringify({
  _event: 'ws_message',
  correlationId,
  sessionId,
  playerId,
  messageType: 'toggle_step',
}));
```

### Summary Matrix

| Aspect | Observability 2.0 Target | Keyboardia Current | Gap |
|--------|-------------------------|-------------------|-----|
| Event granularity | Wide (1 per lifecycle) | Narrow (many per lifecycle) | 🔴 Major |
| Metrics approach | Derived from events | Collected separately | 🔴 Major |
| Storage layer | Workers Logs (7 days) | KV (1 hour TTL) | 🔴 Major |
| Console format | JSON structured | String formatted | 🟡 Moderate |
| Sampling strategy | Head + Tail | Store everything | 🟡 Moderate |
| Correlation | Request-level IDs | Session-level only | 🟡 Moderate |
| Queryability | Arbitrary slicing | Pre-defined endpoints | 🟡 Moderate |
| Cardinality | High (embraced) | Good (session/player) | 🟢 Minor |

---

## Part 4: Implementation Plan

### Phase 1: Cloudflare-Native Foundation

**Enable Workers Logs and structured output.**

1. Add `observability` config to `wrangler.toml`
2. Convert all `console.log()` calls to emit structured JSON
3. Add `_event` field to all log emissions for filtering

**wrangler.toml:**
```toml
[observability]
enabled = true

[observability.logs]
enabled = true
head_sampling_rate = 1.0
invocation_logs = true

[env.production.observability.logs]
head_sampling_rate = 0.1
```

**Effort**: 2-3 hours | **Impact**: Enables all subsequent phases

### Phase 2: Wide Events for WebSocket Sessions

**Replace per-event logging with lifecycle events.**

```typescript
class WsSessionContext {
  readonly sessionId: string;
  readonly playerId: string;
  readonly connectedAt = Date.now();
  readonly stateHashAtConnect: string;

  private messageCount = 0;
  private messagesByType: Record<string, number> = {};
  private hashMismatches = 0;

  constructor(sessionId: string, playerId: string, initialHash: string) {
    this.sessionId = sessionId;
    this.playerId = playerId;
    this.stateHashAtConnect = initialHash;
  }

  recordMessage(type: string) {
    this.messageCount++;
    this.messagesByType[type] = (this.messagesByType[type] ?? 0) + 1;
  }

  recordHashMismatch() {
    this.hashMismatches++;
  }

  emitFinalEvent(disconnectReason: string, finalHash: string, colo?: string) {
    console.log(JSON.stringify({
      _event: 'ws_session_end',
      sessionId: this.sessionId,
      playerId: this.playerId,
      connectedAt: this.connectedAt,
      disconnectedAt: Date.now(),
      duration: Date.now() - this.connectedAt,
      messageCount: this.messageCount,
      messagesByType: this.messagesByType,
      stateHashAtConnect: this.stateHashAtConnect,
      stateHashAtDisconnect: finalHash,
      hashMismatchCount: this.hashMismatches,
      disconnectReason,
      colo,
    }));
  }
}
```

**Effort**: 4-6 hours | **Impact**: ~70% reduction in log volume, richer context

### Phase 3: Delete Separate Metrics Collection

**Remove redundant metrics tracking.**

Files to modify:
- `logging.ts`: Remove `trackWsConnect`, `trackWsDisconnect`, `trackWsMessage`, `getWsMetrics`
- `LiveSessionDurableObject`: Remove calls to metrics functions

**Metrics now derived via Workers Logs Query Builder:**
```
// Active connections: events where _event = 'ws_session_end' in last hour
// Message breakdown: GROUP BY messageType from messagesByType field
```

**Effort**: 2 hours | **Impact**: Simplified code, no KV writes for metrics

### Phase 4: Tail Sampling

**Only persist to KV what truly needs custom storage.**

```typescript
async function onDisconnect(ctx: WsSessionContext, reason: string, hash: string, colo?: string) {
  // Always emit to Workers Logs (via console.log)
  ctx.emitFinalEvent(reason, hash, colo);

  // Only persist to KV if this event needs custom handling
  // (e.g., for debug endpoints that need immediate consistency)
  if (needsKvPersistence(ctx)) {
    await storeToKv(env, ctx.toEvent(reason));
  }
}

function needsKvPersistence(ctx: WsSessionContext): boolean {
  // Persist hash mismatches for immediate debugging
  return ctx.hashMismatchCount > 0;
}
```

**Effort**: 2 hours | **Impact**: KV writes reduced to exceptional cases only

### Phase 5: Correlation IDs

**Link client actions to server processing.**

```typescript
// Shared type
interface CorrelatedMessage {
  type: string;
  correlationId: string;  // Client-generated UUID
  // ... payload fields
}

// Client side
function sendMessage(type: string, payload: object) {
  const correlationId = crypto.randomUUID().slice(0, 8);
  ws.send(JSON.stringify({ type, correlationId, ...payload }));
  logger.ws.log('Sent', { correlationId, type });
}

// Server side
function handleMessage(msg: CorrelatedMessage, ctx: WsSessionContext) {
  console.log(JSON.stringify({
    _event: 'ws_message',
    correlationId: msg.correlationId,
    sessionId: ctx.sessionId,
    playerId: ctx.playerId,
    messageType: msg.type,
  }));
  ctx.recordMessage(msg.type);
}
```

**Effort**: 3-4 hours | **Impact**: End-to-end tracing of user actions

---

## Appendix A: Wide Event Checklist

When designing a new event type, include:

- [ ] **Identifiers**: sessionId, playerId, correlationId, requestId
- [ ] **Action**: _event type, messageType, action
- [ ] **Timing**: timestamp, duration, startTime, endTime
- [ ] **Location**: region, colo, path, component
- [ ] **Counts**: messageCount, retryCount, errorCount
- [ ] **Outcome**: status, error, success, hashMatch
- [ ] **Context**: userAgent, buildVersion, featureFlags

### The "Blob" Philosophy

> "Initialize an empty blob at the beginning, when the request first enters the service. Stuff any and all interesting detail about the request into that blob throughout the lifetime of the request. Emit a single event per request per service."
> — Charity Majors

**Don't filter at write time. Capture everything. Filter at query time.**

---

## Appendix B: Sampling Decision Tree

```
                    ┌─────────────────┐
                    │ Request arrives │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │ HEAD SAMPLING (Cloudflare)  │
              │ head_sampling_rate = 0.1    │
              └──────────────┬──────────────┘
                             │
                    90% dropped here
                             │
                             ▼
                    ┌─────────────────┐
                    │ Request executes │
                    └────────┬────────┘
                             │
              ┌──────────────┴──────────────┐
              │    TAIL SAMPLING (App)      │
              └──────────────┬──────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
    ┌──────────┐      ┌──────────┐       ┌──────────┐
    │ Is error?│──Yes─▶│   KEEP   │       │ Is slow? │
    └────┬─────┘      └──────────┘       └────┬─────┘
         │No                                   │
         ▼                                     ▼
    ┌──────────┐                         ┌──────────┐
    │ Hash     │──Yes─▶ KEEP             │ > p99?   │──Yes─▶ KEEP
    │ mismatch?│                         └────┬─────┘
    └────┬─────┘                              │No
         │No                                  ▼
         ▼                              ┌──────────┐
    ┌──────────┐                        │Random 10%│──Yes─▶ KEEP
    │   DROP   │                        └────┬─────┘
    └──────────┘                             │No
                                             ▼
                                        ┌──────────┐
                                        │   DROP   │
                                        └──────────┘
```

---

## Appendix C: Query Examples

With Workers Logs Query Builder, answer questions like:

```sql
-- Error rate by message type
SELECT
  messageType,
  COUNT(*) as total,
  COUNTIF(disconnectReason != 'normal_close') as errors,
  errors / total as error_rate
FROM events
WHERE _event = 'ws_session_end'
GROUP BY messageType
ORDER BY error_rate DESC

-- P99 session duration by region
SELECT
  colo,
  APPROX_PERCENTILE(duration, 0.99) as p99_duration
FROM events
WHERE _event = 'ws_session_end'
GROUP BY colo

-- Sessions with state hash mismatches
SELECT *
FROM events
WHERE _event = 'ws_session_end'
  AND hashMismatchCount > 0
ORDER BY disconnectedAt DESC
LIMIT 100

-- Specific user's session history
SELECT *
FROM events
WHERE _event = 'ws_session_end'
  AND playerId = 'abc123'
ORDER BY connectedAt DESC
```

---

## Sources

### Logging Philosophy
- [Logging Sucks - Your Logs Are Lying To You](https://loggingsucks.com/)

### Cloudflare Workers
- [Workers Logs Documentation](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Introducing Workers Observability](https://blog.cloudflare.com/introducing-workers-observability-logs-metrics-and-queries-all-in-one-place/)
- [Workers Automatic Tracing (Open Beta)](https://blog.cloudflare.com/workers-tracing-now-in-open-beta/)

### Observability 2.0 / Honeycomb
- [Observability: Present and Future - Charity Majors (Pragmatic Engineer)](https://newsletter.pragmaticengineer.com/p/observability-the-present-and-future)
- [Observability 1.0 vs 2.0 (Honeycomb)](https://www.honeycomb.io/blog/one-key-difference-observability1dot0-2dot0)
- [Structured Events Are the Basis of Observability](https://www.honeycomb.io/blog/structured-events-basis-observability)
- [Logs vs Structured Events - charity.wtf](https://charity.wtf/2019/02/05/logs-vs-structured-events/)
- [Observability Engineering Book (O'Reilly)](https://www.oreilly.com/library/view/observability-engineering/9781492076438/)

---

*Document created: December 2025*
*Last updated: December 2025*
