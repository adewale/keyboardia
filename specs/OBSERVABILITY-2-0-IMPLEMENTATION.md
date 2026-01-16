# Observability 2.0 Implementation Spec

> **Type:** Implementation Spec
> **Status:** Draft
> **Research:** [OBSERVABILITY-2-0.md](./research/OBSERVABILITY-2-0.md)
> **Supersedes:** [OBSERVABILITY.md](./OBSERVABILITY.md) (upon completion)

---

## Overview

This spec defines the wide events for Keyboardia's Observability 2.0 implementation. The goal is to replace per-action logging with lifecycle-based wide events emitted to Cloudflare Workers Logs.

---

## Configuration

Enable Workers Logs and version metadata in `wrangler.jsonc`:

```jsonc
{
  "observability": {
    "enabled": true,
    "logs": {
      "enabled": true,
      "invocation_logs": true,
      "head_sampling_rate": 1  // 1 = 100%, 0.1 = 10%
    }
  },
  // Version metadata binding for deploy tracking
  "version_metadata": {
    "binding": "CF_VERSION_METADATA"
  }
}
```

**Accessing version metadata in code:**

```typescript
interface Env {
  CF_VERSION_METADATA: {
    id: string;       // versionId (e.g., "a5f9abc123")
    tag?: string;     // versionTag (e.g., "v0.2.1") - set via wrangler deploy --tag
    timestamp: string; // deployedAt (ISO 8601)
  };
}

// Usage in handler
const deploy = {
  versionId: env.CF_VERSION_METADATA.id,
  versionTag: env.CF_VERSION_METADATA.tag,
  deployedAt: env.CF_VERSION_METADATA.timestamp,
};
```

**Infrastructure from request.cf (free tier):**

```typescript
const infra = {
  colo: request.cf?.colo ?? 'unknown',     // "SFO", "LHR"
  country: request.cf?.country ?? 'unknown', // "US", "GB"
};
```

---

## Wide Events

### 1. `http_request`

Emitted once per HTTP request, at response time.

**Trigger:** End of every HTTP request handler

**Schema:**

```typescript
interface HttpRequestEvent {
  event: "http_request";

  // Request identity
  requestId: string;
  method: string;
  path: string;
  deviceType: "mobile" | "desktop";  // Derived from User-Agent

  // Timing
  timestamp: string;        // ISO 8601
  duration_ms: number;

  // Response
  status: number;
  responseSize?: number;

  // Context
  sessionId?: string;       // If request relates to a session
  playerId?: string;        // From X-Player-ID header or cookie
  isPublished?: boolean;    // true if accessing a published (read-only) session
  sourceSessionId?: string; // Only for remix: the session being remixed FROM

  // Classification
  routePattern: string;     // e.g., "/api/sessions/:id"
  action?: string;          // "create", "access", "publish", "remix"

  // Outcome (Boris Tane pattern)
  outcome: "ok" | "error";

  // Error context (only if outcome === "error")
  error?: {
    type: string;           // e.g., "ValidationError", "KVError"
    message: string;
    slug: string;           // Machine-readable (e.g., "kv-quota-exceeded")
    expected: boolean;      // true for 404, rate limit; false for unexpected
    handler?: string;       // e.g., "handleSessionAccess"
    stack?: string;         // Truncated to 500 chars
  };

  // Performance
  kvReads?: number;
  kvWrites?: number;
  doRequests?: number;

  // Recovered errors (see Warning type below)
  warnings?: Warning[];

  // Deployment (from CF_VERSION_METADATA binding)
  deploy: {
    versionId: string;      // Unique deployment ID
    versionTag?: string;    // Optional tag (e.g., "v0.2.1")
    deployedAt: string;     // ISO 8601 - when this version was deployed
  };

  // Infrastructure (from request.cf)
  infra: {
    colo: string;           // 3-letter airport code (SFO, LHR)
    country: string;        // 2-letter country code (US, GB)
  };

  // Service identity
  service: {
    name: string;           // "keyboardia" or "keyboardia-staging"
    environment: string;    // "production" | "staging"
  };
}
```

**Example (joiner accessing published session):**

```json
{
  "event": "http_request",
  "requestId": "req_abc123",
  "method": "GET",
  "path": "/api/sessions/sess_xyz789",
  "deviceType": "mobile",
  "timestamp": "2026-01-15T10:30:00.000Z",
  "duration_ms": 45,
  "status": 200,
  "routePattern": "/api/sessions/:id",
  "action": "access",
  "outcome": "ok",
  "sessionId": "sess_xyz789",
  "playerId": "player_456",
  "isPublished": true,
  "kvReads": 1,
  "kvWrites": 0,
  "doRequests": 1,
  "deploy": {
    "versionId": "a5f9abc123",
    "versionTag": "v0.2.1",
    "deployedAt": "2026-01-14T18:00:00.000Z"
  },
  "infra": {
    "colo": "SFO",
    "country": "US"
  },
  "service": {
    "name": "keyboardia",
    "environment": "production"
  }
}
```

**Example (remix action - virality tracking):**

```json
{
  "event": "http_request",
  "requestId": "req_def456",
  "method": "POST",
  "path": "/api/sessions/sess_xyz789/remix",
  "deviceType": "desktop",
  "timestamp": "2026-01-15T11:00:00.000Z",
  "duration_ms": 120,
  "status": 201,
  "routePattern": "/api/sessions/:id/remix",
  "action": "remix",
  "sessionId": "sess_new123",
  "sourceSessionId": "sess_xyz789",
  "playerId": "player_789",
  "isPublished": false,
  "kvReads": 1,
  "kvWrites": 1,
  "doRequests": 2
}
```

**Example (publish action):**

```json
{
  "event": "http_request",
  "requestId": "req_ghi789",
  "method": "POST",
  "path": "/api/sessions/sess_abc/publish",
  "deviceType": "desktop",
  "timestamp": "2026-01-15T12:00:00.000Z",
  "duration_ms": 85,
  "status": 201,
  "routePattern": "/api/sessions/:id/publish",
  "action": "publish",
  "sessionId": "sess_published456",
  "sourceSessionId": "sess_abc",
  "playerId": "player_creator",
  "isPublished": true,
  "kvReads": 1,
  "kvWrites": 1,
  "doRequests": 1
}
```

**Example (error - session not found):**

```json
{
  "event": "http_request",
  "requestId": "req_err456",
  "method": "GET",
  "path": "/api/sessions/sess_nonexistent",
  "deviceType": "mobile",
  "timestamp": "2026-01-15T12:30:00.000Z",
  "duration_ms": 12,
  "status": 404,
  "routePattern": "/api/sessions/:id",
  "action": "access",
  "outcome": "error",
  "error": {
    "type": "NotFoundError",
    "message": "Session not found",
    "slug": "session-not-found",
    "expected": true,
    "handler": "handleSessionAccess"
  },
  "kvReads": 1,
  "kvWrites": 0,
  "doRequests": 0,
  "deploy": {
    "versionId": "a5f9abc123",
    "deployedAt": "2026-01-14T18:00:00.000Z"
  },
  "infra": {
    "colo": "LHR",
    "country": "GB"
  },
  "service": {
    "name": "keyboardia",
    "environment": "production"
  }
}
```

**Queryable questions:**
- "Which sessions generated the most remixes?" → `COUNT(*) WHERE action = 'remix' GROUP BY sourceSessionId`
- "What's the remix rate for published vs editable?" → `COUNT(*) WHERE action = 'remix' GROUP BY isPublished`
- "How many sessions were published today?" → `COUNT(*) WHERE action = 'publish'`
- "Are mobile users more likely to consume or create?" → `COUNT(*) GROUP BY deviceType, action`
- "Are people mostly consuming published content?" → `COUNT(*) WHERE action = 'access' GROUP BY isPublished`
- "What are our error rates by endpoint?" → `COUNT(*) WHERE outcome = 'error' GROUP BY routePattern`
- "Which unexpected errors are most common?" → `COUNT(*) WHERE outcome = 'error' AND error.expected = false GROUP BY error.slug`

---

### 2. `ws_session`

Emitted once per WebSocket connection, at disconnect time.

**Trigger:** WebSocket `close` event

**Schema:**

```typescript
interface WsSessionEvent {
  event: "ws_session";

  // Connection identity
  connectionId: string;
  sessionId: string;
  playerId: string;
  isCreator: boolean;       // true if this player created the session
  isPublished: boolean;     // true if viewing published (read-only) session

  // Timing
  connectedAt: string;      // ISO 8601
  disconnectedAt: string;   // ISO 8601
  duration_ms: number;

  // Message stats
  messageCount: number;
  messagesByType: Record<string, number>;

  // Collaboration context
  peakConcurrentPlayers: number;
  playersSeenCount: number;

  // Playback
  playCount: number;
  totalPlayTime_ms: number;

  // Sync health
  syncRequestCount: number;
  syncErrorCount: number;

  // Outcome (Boris Tane pattern)
  outcome: "ok" | "error";
  disconnectReason: "normal_close" | "timeout" | "replaced" | "error";

  // Error context (only if outcome === "error")
  error?: {
    type: string;           // e.g., "WebSocketError", "StateCorruption"
    message: string;
    slug: string;           // Machine-readable (e.g., "ws-protocol-error")
    expected: boolean;      // true for timeout; false for unexpected crash
    handler?: string;
    stack?: string;
  };

  // Recovered errors (see Warning type below)
  warnings?: Warning[];

  // Deployment (from CF_VERSION_METADATA binding)
  deploy: {
    versionId: string;
    versionTag?: string;
    deployedAt: string;
  };

  // Infrastructure (from request.cf at connect time)
  infra: {
    colo: string;
    country: string;
  };

  // Service identity
  service: {
    name: string;
    environment: string;
  };
}
```

**Example (joiner viewing published session):**

```json
{
  "event": "ws_session",
  "connectionId": "conn_abc123",
  "sessionId": "sess_xyz789",
  "playerId": "player_456",
  "isCreator": false,
  "isPublished": true,
  "connectedAt": "2026-01-15T10:00:00.000Z",
  "disconnectedAt": "2026-01-15T10:15:00.000Z",
  "duration_ms": 900000,
  "messageCount": 23,
  "messagesByType": {
    "play": 15,
    "stop": 8
  },
  "peakConcurrentPlayers": 1,
  "playersSeenCount": 1,
  "playCount": 15,
  "totalPlayTime_ms": 180000,
  "syncRequestCount": 0,
  "syncErrorCount": 0,
  "outcome": "ok",
  "disconnectReason": "normal_close",
  "deploy": {
    "versionId": "a5f9abc123",
    "versionTag": "v0.2.1",
    "deployedAt": "2026-01-14T18:00:00.000Z"
  },
  "infra": {
    "colo": "LHR",
    "country": "GB"
  },
  "service": {
    "name": "keyboardia",
    "environment": "production"
  }
}
```

**Reliability:** Guaranteed for every connection. Cloudflare's Hibernation API uses automatic ping/pong (`setWebSocketAutoResponse`) to detect dead connections.

| Close Type | Timing | `disconnectReason` | Cause |
|------------|--------|-------------------|-------|
| Clean | Immediate | `normal_close` | Browser sends close frame (navigation, tab close) |
| Dirty | 10-30s delay | `timeout` | No close frame (tab killed, mobile backgrounded, network drop) |

**Note:** For dirty closes, `duration_ms` includes the ping timeout. Use `messagesByType` activity or `totalPlayTime_ms` for true engagement time.

**Queryable questions:**
- "Do people spend more time on published vs editable?" → `AVG(duration_ms) GROUP BY isPublished`
- "Which sessions get the most total attention?" → `SUM(duration_ms) GROUP BY sessionId ORDER BY 1 DESC`
- "What's the creator-to-joiner ratio?" → `COUNT(*) GROUP BY isCreator`
- "Which published sessions have the most unique viewers?" → `COUNT(DISTINCT playerId) WHERE isPublished GROUP BY sessionId`

**Expected behavioral patterns:**

| Dimension | Published (read-only) | Editable |
|-----------|----------------------|----------|
| `messagesByType` | Mostly `play`/`stop` | Rich: `toggle_step`, `set_tempo`, etc. |
| `peakConcurrentPlayers` | Usually 1 (viewing alone) | Higher (collaboration) |
| `messageCount` | Low (passive consumption) | High (active editing) |
| View count | Higher (shareable) | Lower (private work) |
| Engagement depth | Shallow but broad | Deep but narrow |

---

### 3. Client Errors (Exception to Wide Event Rule)

Client-side errors (React crashes, audio failures) have no parent server-side unit of work. They require a dedicated `client_error` event — the only exception to embedding errors in wide events.

**Current state:** No transport exists. `ErrorBoundary.tsx` logs to console only. `log-store.ts` persists to IndexedDB locally.

**Transport flow:**

```
Error occurs → Store in IndexedDB → Transport to server
                                          │
                    ┌─────────────────────┼─────────────────────┐
                    ▼                     ▼                     ▼
             WS connected?          Page unloading?        Neither?
                    │                     │                     │
                    ▼                     ▼                     ▼
             Send via WS            sendBeacon()         Keep in queue,
         (type: client_error)    to POST /api/errors    retry on reconnect
```

**Implementation phases:**

**Phase 1: Dedicated endpoint** (Low effort)

```typescript
// Worker: POST /api/errors
app.post('/api/errors', async (c) => {
  const errors = await c.req.json();
  for (const error of errors) {
    console.log(JSON.stringify({ event: "client_error", ...error }));
  }
  return c.json({ received: errors.length });
});
```

**Phase 2: Beacon on pagehide** (Low effort)

```typescript
// Client: src/utils/error-reporter.ts
window.addEventListener('pagehide', () => {
  const pending = getQueuedErrors(); // From IndexedDB or memory
  if (pending.length > 0) {
    navigator.sendBeacon('/api/errors', JSON.stringify(pending));
  }
});
```

**Phase 3: WebSocket client_error message** (Medium effort)

```typescript
// Client: Send error over existing WS connection
function reportError(error: ErrorEvent) {
  if (multiplayer.isConnected()) {
    multiplayer.send({ type: 'client_error', error });
  } else {
    queueError(error); // Will be sent via beacon or on reconnect
  }
}

// Server: Handle in live-session.ts
case 'client_error':
  console.log(JSON.stringify({
    event: "client_error",
    connectionId,
    sessionId: this.sessionId,
    playerId: player.id,
    ...msg.error
  }));
  break;
```

**Schema:**

```typescript
interface ClientErrorEvent {
  event: "client_error";

  // Error identity
  type: string;             // e.g., "ReactError", "AudioError"
  message: string;
  slug: string;             // Machine-readable (e.g., "audio-context-suspended")
  expected: boolean;

  // Timing
  timestamp: string;
  queuedAt?: string;        // If delayed delivery

  // Context (added by server)
  connectionId?: string;
  sessionId?: string;
  playerId?: string;

  // Client environment
  browser: {
    userAgent: string;
    online: boolean;
    audioContextState?: "running" | "suspended" | "closed";
  };

  // Transport
  transportMethod: "websocket" | "beacon" | "fetch";

  // Stack (truncated to 500 chars)
  stack?: string;
}
```

**What to report:**

| Error Type | Report? | `expected` | Example slug |
|------------|---------|------------|--------------|
| React crash | ✅ | `false` | `react-render-error` |
| Audio failure | ✅ | `false` | `audio-context-suspended` |
| Network 5xx | ✅ | `false` | `server-error` |
| Expected 404 | ✅ | `true` | `session-not-found` |
| Rate limit hit | ✅ | `true` | `rate-limit-exceeded` |
| Retries exhausted | ✅ | `false` | `retries-exhausted` |
| Validation error | ❌ | — | (don't report) |

**Slug convention:** lowercase-kebab-case, specific enough to identify the error class without being unique per instance. Good: `kv-quota-exceeded`. Bad: `error` or `kv-quota-exceeded-sess_abc123`.

---

### Warning Type

Warnings capture recovered errors and near-misses — operations that succeeded despite problems.

```typescript
interface Warning {
  type: string;              // "KVReadRetry", "SlowDO", "StateRepair"
  message: string;           // Human-readable description
  occurredAt: string;        // ISO 8601

  recoveryAction:
    | "retry_succeeded"      // Failed, retried, eventually worked
    | "fallback_used"        // Primary failed, fallback worked
    | "auto_repaired"        // State corruption fixed automatically
    | "degraded_response";   // Partial success (e.g., served stale)

  attemptNumber?: number;    // Which attempt succeeded
  totalAttempts?: number;    // Total attempts made
  latency_ms?: number;       // For slow operation warnings
}
```

**Warning types:**

| Type | Action | Trigger |
|------|--------|---------|
| `KVReadRetry` | `retry_succeeded` | KV read failed then succeeded |
| `KVWriteRetry` | `retry_succeeded` | KV write failed then succeeded |
| `DORequestRetry` | `retry_succeeded` | DO request failed then succeeded |
| `StateRepair` | `auto_repaired` | Invariant violation fixed |
| `SlowKV` | `degraded_response` | KV latency > 500ms |
| `SlowDO` | `degraded_response` | DO latency > 200ms |

**Limit:** Max 10 warnings per event to prevent unbounded growth.

---

### Collecting Warnings

Warnings are collected during execution and included in the final wide event.

**HTTP requests — explicit parameter:**

```typescript
// Handler creates warnings array, passes to helpers
async function handleSessionAccess(request: Request, env: Env): Promise<Response> {
  const warnings: Warning[] = [];
  const startTime = Date.now();

  const session = await kvGetWithRetry(env.SESSIONS, key, warnings);

  // At end, emit wide event
  console.log(JSON.stringify({
    event: "http_request",
    duration_ms: Date.now() - startTime,
    warnings,
    // ...
  }));

  return new Response(JSON.stringify(session));
}

// Helper adds warnings when recovering
async function kvGetWithRetry(
  kv: KVNamespace,
  key: string,
  warnings: Warning[]
): Promise<unknown> {
  try {
    return await kv.get(key, 'json');
  } catch (error) {
    const result = await kv.get(key, 'json');  // Retry
    warnings.push({
      type: "KVReadRetry",
      message: `Retry succeeded for ${key}`,
      occurredAt: new Date().toISOString(),
      recoveryAction: "retry_succeeded",
      attemptNumber: 2,
      totalAttempts: 2
    });
    return result;
  }
}
```

**WebSocket sessions — instance Map:**

```typescript
class LiveSessionDurableObject {
  private connectionWarnings = new Map<WebSocket, Warning[]>();

  private addWarning(ws: WebSocket, warning: Omit<Warning, 'occurredAt'>) {
    const warnings = this.connectionWarnings.get(ws) ?? [];
    if (warnings.length < 10) {
      warnings.push({ ...warning, occurredAt: new Date().toISOString() });
      this.connectionWarnings.set(ws, warnings);
    }
  }

  async webSocketClose(ws: WebSocket) {
    console.log(JSON.stringify({
      event: "ws_session",
      warnings: this.connectionWarnings.get(ws) ?? [],
      // ...
    }));
    this.connectionWarnings.delete(ws);
  }
}
```

---

## Design Decisions

### `http_request` — Included vs Excluded

| Included | Why | Excluded | Why Not |
|----------|-----|----------|---------|
| `playerId` | Per-connection analytics, session linking | Request body | Too large, rarely needed |
| `sessionId` | Link requests to sessions | Response body | Too large |
| `sourceSessionId` | Remix virality tracking | IP address | Privacy (used server-side for isCreator, not logged) |
| `isPublished` | Published vs editable consumption | Full User-Agent | Noise, deviceType suffices |
| `deviceType` | Mobile vs desktop segmentation | Headers | Noise |
| `action` (create/access/publish/remix) | Business metrics, funnel analysis | Detailed geo | City/region overkill; colo+country sufficient |
| `duration_ms` | Performance debugging | | |
| `kvReads`, `kvWrites`, `doRequests` | Cost attribution | | |
| `deploy`, `infra`, `service` | Release correlation, regional patterns | | |

**Note on `isCreator`:** Determined by comparing the connecting user's identity with the stored creator identity. Creator identity is captured at session creation time as:
- `CF-Connecting-IP` — Cloudflare-provided client IP address
- `User-Agent` hash — SHA-256 hash of browser User-Agent string

This is more reliable than `playerId` because:
1. `playerId` is generated server-side on every WebSocket connection (ephemeral)
2. Page refresh = new `playerId`, but IP + User-Agent remains stable
3. Creator identity persists across page refreshes within the same browser/network

**Storage:** Creator identity is stored in DO state when session is created, then compared on each WebSocket connection.

**Limitations:**
- Different network (VPN, mobile data switch) = different IP = not recognized as creator
- Different browser = different User-Agent hash = not recognized as creator
- Shared IP (NAT, office network) with same browser = false positive possible (rare)

These limitations are acceptable because:
1. Creator/joiner segmentation is for analytics patterns, not access control
2. False negatives (creator appears as joiner) only slightly skew metrics
3. The majority case (same browser, same network) works correctly

### `ws_session` — Included vs Excluded

| Included | Why | Excluded | Why Not |
|----------|-----|----------|---------|
| `isCreator` | Segment creators vs joiners | Individual message payloads | Massive, in DO already |
| `isPublished` | Published vs editable engagement | Full player list | Privacy, rarely needed |
| `messagesByType` | Understand usage patterns | Per-message timestamps | Too granular |
| `peakConcurrentPlayers` | Multiplayer health | Pattern state snapshots | Huge, stored in DO |
| `playCount`, `totalPlayTime_ms` | Engagement metrics | Network latency samples | Complex to capture |
| `deploy`, `infra`, `service` | Release correlation, regional patterns | | |

### Error Fields (embedded in `http_request` and `ws_session`)

| Included | Why | Excluded | Why Not |
|----------|-----|----------|---------|
| `outcome` | Instant filtering (ok vs error) | | |
| `error.type`, `error.message` | Classification | Full stack trace | Truncate to 500 chars |
| `error.slug` | Machine-readable grouping, alerting | Error instance ID | Slug is for classes, not instances |
| `error.expected` | Filter noise in dashboards | Severity levels | Binary is simpler |
| `error.handler` | Locate code path | Environment variables | Security risk |

### `client_error` (Exception to Wide Event Rule)

| Included | Why | Excluded | Why Not |
|----------|-----|----------|---------|
| `browser.*` | Debug client environment | Full localStorage | Privacy, size |
| `transportMethod` | Understand delivery path | | |
| `sessionId`, `playerId` | Correlation (added server-side) | | |

---

## Typical Traces

Most users **join** sessions rather than create them. The traces differ:

### Creator Flow (minority of users)

```
┌─────────────────────┐
│ http_request    │  POST /api/sessions
│ action: "create"    │
│ sessionId: abc      │
│ (IP: 1.2.3.4)       │  ← Creator IP captured
└─────────────────────┘
         │
         ▼
    DO stores creatorIdentity = { ip: "1.2.3.4", userAgentHash: "a1b2c3" }
         │
         ▼
    (WebSocket lifecycle - messages accumulated, not logged)
         │
         ▼
┌─────────────────────┐
│ ws_session      │
│ sessionId: abc      │
│ isCreator: true     │  ← IP matches stored creatorIdentity
│ messageCount: 200   │
└─────────────────────┘
```

### Joiner Flow (majority of users)

```
┌─────────────────────┐
│ http_request    │  GET /api/sessions/abc
│ action: "access"    │  ← Access, not create
│ sessionId: abc      │
│ (IP: 5.6.7.8)       │  ← Different IP
└─────────────────────┘
         │
         ▼
    DO compares { ip: "5.6.7.8", userAgentHash: "x9y8z7" } != creatorIdentity
         │
         ▼
    (WebSocket lifecycle - messages accumulated, not logged)
         │
         ▼
┌─────────────────────┐
│ ws_session      │
│ sessionId: abc      │
│ isCreator: false    │  ← IP doesn't match = joiner
│ messageCount: 47    │
└─────────────────────┘
```

### Combined: One Session, Multiple Users

```
Timeline
────────────────────────────────────────────────────────────────────────►

Creator creates session (IP: 1.2.3.4)
│
▼
┌───────────────────┐
│ http_request  │ action: "create"
└───────────────────┘
         │
    DO stores creatorIdentity = { ip: "1.2.3.4", userAgentHash: "..." }
         │
    Creator shares link
         │
         ├──────────────────────────────────────┐
         │                                      │
         ▼                                      ▼
    Joiner A clicks link (IP: 5.6.7.8)    Joiner B clicks link (IP: 9.0.1.2)
         │                                      │
         ▼                                      ▼
┌───────────────────┐                  ┌───────────────────┐
│ http_request  │                  │ http_request  │
│ action: "access"  │                  │ action: "access"  │
└───────────────────┘                  └───────────────────┘
         │                                      │
         ▼                                      ▼
    All 3 collaborate via WebSocket (no events during)
         │
         ▼
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│ ws_session    │  │ ws_session    │  │ ws_session    │
│ isCreator: true   │  │ isCreator: false  │  │ isCreator: false  │
│ (IP matched)      │  │ (IP: 5.6.7.8)     │  │ (IP: 9.0.1.2)     │
│ messageCount: 200 │  │ messageCount: 47  │  │ messageCount: 23  │
└───────────────────┘  └───────────────────┘  └───────────────────┘

Total events for this session: 3 http_request + 3 ws_session = 6
Traditional logging would emit: ~300+ log lines
```

---

## Architecture Sequence Diagram

```
┌──────────┐     ┌──────────────────┐     ┌─────────────────┐     ┌─────┐
│  Browser │     │ Cloudflare Worker│     │  Durable Object │     │ KV  │
│  (React) │     │     (API)        │     │   (SessionDO)   │     │     │
└────┬─────┘     └────────┬─────────┘     └────────┬────────┘     └──┬──┘
     │                    │                        │                  │
     │ GET /api/sessions/abc (joiner)              │                  │
     │───────────────────>│                        │                  │
     │                    │  get session           │                  │
     │                    │───────────────────────>│                  │
     │                    │                        │  get(session)    │
     │                    │                        │─────────────────>│
     │                    │◄───────────────────────│◄─────────────────│
     │                    │                        │                  │
     │                    │  ┌──────────────────┐  │                  │
     │                    │  │ http_request │  │                  │
     │                    │  │ action: "access" │  │                  │
     │                    │  └────────┬─────────┘  │                  │
     │◄───────────────────│           │            │                  │
     │   200 OK           │           ▼            │                  │
     │                    │     Workers Logs       │                  │
     │                    │                        │                  │
     │  WebSocket upgrade │                        │                  │
     │───────────────────>│───────────────────────>│                  │
     │◄────────────────────────────────────────────│ (WS established) │
     │                    │                        │                  │
     │                    │                        │  // Compare IP with creatorIdentity
     │                    │                        │  context = {     │
     │                    │                        │    isCreator:    │
     │                    │                        │      false,      │  ← IP doesn't match
     │                    │                        │    msgCount: 0   │
     │                    │                        │  }               │
     │                    │                        │                  │
     │  toggle_step ─────────────────────────────>│  context.msgCount++
     │  set_tempo ───────────────────────────────>│  context.msgCount++
     │  play ────────────────────────────────────>│  context.msgCount++
     │  ...more messages...                        │                  │
     │                    │                        │                  │
     │  close ───────────────────────────────────>│                  │
     │                    │                        │                  │
     │                    │                        │  ┌─────────────────────┐
     │                    │                        │  │ ws_session      │
     │                    │                        │  │ isCreator: false    │
     │                    │                        │  │ messageCount: 47    │
     │                    │                        │  └─────────┬───────────┘
     │                    │                        │            │
     │                    │                        │            ▼
     │                    │                        │      Workers Logs
```

---

## Implementation

### Creator Identity

Creator identity is determined by IP address + User-Agent hash, stored when session is created:

```typescript
interface CreatorIdentity {
  ip: string;           // CF-Connecting-IP header
  userAgentHash: string; // SHA-256 of User-Agent
}

// Hash User-Agent to avoid storing raw strings
async function hashUserAgent(userAgent: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(userAgent);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);  // First 16 chars sufficient
}

function identitiesMatch(a: CreatorIdentity, b: CreatorIdentity): boolean {
  return a.ip === b.ip && a.userAgentHash === b.userAgentHash;
}
```

### Context Accumulator Pattern

For wide events, accumulate context during the lifecycle:

```typescript
// In Durable Object
class SessionDO {
  private wsContext: Map<WebSocket, WsContext> = new Map();
  private creatorIdentity: CreatorIdentity | null = null;  // Set when session is created

  async handleSessionCreate(request: Request) {
    // Capture creator identity from the creation request
    this.creatorIdentity = {
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      userAgentHash: await hashUserAgent(request.headers.get('User-Agent') || ''),
    };
  }

  async handleWebSocketConnect(ws: WebSocket, playerId: string, request: Request) {
    // Derive connecting user's identity
    const connectingIdentity: CreatorIdentity = {
      ip: request.headers.get('CF-Connecting-IP') || 'unknown',
      userAgentHash: await hashUserAgent(request.headers.get('User-Agent') || ''),
    };

    // Compare with stored creator identity
    const isCreator = this.creatorIdentity
      ? identitiesMatch(this.creatorIdentity, connectingIdentity)
      : false;

    this.wsContext.set(ws, {
      connectionId: crypto.randomUUID(),
      playerId,
      isCreator,  // Based on IP + User-Agent, not playerId
      connectedAt: new Date().toISOString(),
      messageCount: 0,
      messagesByType: {},
      peakConcurrentPlayers: this.connections.size,
      // ... other fields initialized
    });
  }

  handleWebSocketMessage(ws: WebSocket, message: Message) {
    const ctx = this.wsContext.get(ws)!;
    ctx.messageCount++;
    ctx.messagesByType[message.type] = (ctx.messagesByType[message.type] || 0) + 1;
    ctx.peakConcurrentPlayers = Math.max(ctx.peakConcurrentPlayers, this.connections.size);
    // ... handle message
  }

  handleWebSocketClose(ws: WebSocket, reason: string) {
    const ctx = this.wsContext.get(ws)!;

    // Emit wide event
    console.log(JSON.stringify({
      event: "ws_session",
      ...ctx,
      disconnectedAt: new Date().toISOString(),
      duration_ms: Date.now() - new Date(ctx.connectedAt).getTime(),
      disconnectReason: reason,
    }));

    this.wsContext.delete(ws);
  }
}
```

### HTTP Middleware

Wrap handlers to emit `http_request`.

> **Note:** This example shows the basic pattern. Full implementation would also extract `deviceType` (from User-Agent), `sessionId`/`playerId` (from request context), `isPublished` (from session lookup), `routePattern` (from router), and `action` (from route handler).

```typescript
function withObservability(handler: Handler): Handler {
  return async (request, env, ctx) => {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const metrics = { kvReads: 0, kvWrites: 0, doRequests: 0 };

    try {
      const response = await handler(request, env, { ...ctx, requestId, metrics });

      console.log(JSON.stringify({
        event: "http_request",
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        status: response.status,
        ...metrics,
      }));

      return response;
    } catch (error) {
      console.log(JSON.stringify({
        event: "http_request",
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        timestamp: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        status: 500,
        errorType: error.name,
        errorMessage: error.message,
        ...metrics,
      }));
      throw error;
    }
  };
}
```

---

## Migration Path

### Phase 1: Enable Workers Logs
- Add `observability` config to wrangler.jsonc
- No code changes, get automatic invocation logs

### Phase 2: Add Wide Events
- Implement `http_request` in API routes
- Implement `ws_session` in Durable Object
- Run in parallel with existing logging

### Phase 3: Remove Legacy Logging
- Remove KV-based log writes
- Remove per-action console.log calls
- Update debug endpoints to query Workers Logs API

---

## Estimated Effort

| Phase | Work | Estimate |
|-------|------|----------|
| Phase 1 | Config only | 30 min |
| Phase 2 | Wide events | 8 hours |
| Phase 3 | Cleanup | 4 hours |
| **Total** | | **~13 hours** |

---

## Event Volume (1,000 DAU baseline)

| Event | Frequency | Daily Volume |
|-------|-----------|--------------|
| http_request | Every API call | ~10,000 |
| ws_session | Every WS disconnect | ~1,500 |
| client_error | Client-side errors only | ~50 |
| **Total** | | **~11,550** |

**Note:** Server-side errors are embedded in `http_request` and `ws_session` (with `outcome: "error"`), not separate events. Only client-side errors generate a distinct event type.

Workers Logs limit: 5 billion/day. Usage: 0.0002%

---

*Spec created: January 2026*
