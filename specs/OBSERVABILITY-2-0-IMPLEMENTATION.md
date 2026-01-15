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

Enable Workers Logs in `wrangler.jsonc`:

```jsonc
{
  "observability": {
    "enabled": true,
    "logs": {
      "enabled": true,
      "invocation_logs": true,
      "head_sampling_rate": 1  // 1 = 100%, 0.1 = 10%
    }
  }
}
```

---

## Wide Events

### 1. `http_request_end`

Emitted once per HTTP request, at response time.

**Trigger:** End of every HTTP request handler

**Schema:**

```typescript
interface HttpRequestEndEvent {
  event: "http_request_end";

  // Request identity
  requestId: string;
  method: string;
  path: string;

  // Timing
  timestamp: string;        // ISO 8601
  duration_ms: number;

  // Response
  status: number;
  responseSize?: number;

  // Context
  sessionId?: string;       // If request relates to a session
  playerId?: string;        // From X-Player-ID header or cookie

  // Classification
  routePattern: string;     // e.g., "/api/sessions/:id"
  action?: string;          // e.g., "create", "publish", "remix"

  // Error context (if status >= 400)
  errorType?: string;
  errorMessage?: string;

  // Performance
  kvReads?: number;
  kvWrites?: number;
  doRequests?: number;
}
```

**Example:**

```json
{
  "event": "http_request_end",
  "requestId": "req_abc123",
  "method": "POST",
  "path": "/api/sessions",
  "timestamp": "2026-01-15T10:30:00.000Z",
  "duration_ms": 45,
  "status": 201,
  "routePattern": "/api/sessions",
  "action": "create",
  "sessionId": "sess_xyz789",
  "playerId": "player_456",
  "kvReads": 0,
  "kvWrites": 1,
  "doRequests": 1
}
```

**Queryable questions:**
- "How many sessions were created today per unique user?" → `GROUP BY playerId WHERE action = 'create'`
- "Show me all requests slower than 100ms"
- "What's the error rate for /api/sessions/:id/publish?"
- "Which routes have the highest KV write counts?"

---

### 2. `ws_session_end`

Emitted once per WebSocket connection, at disconnect time.

**Trigger:** WebSocket `close` event

**Schema:**

```typescript
interface WsSessionEndEvent {
  event: "ws_session_end";

  // Connection identity
  connectionId: string;
  sessionId: string;
  playerId: string;

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

  // Disconnect
  disconnectReason: "normal_close" | "error" | "timeout" | "replaced";
  errorMessage?: string;
}
```

**Example:**

```json
{
  "event": "ws_session_end",
  "connectionId": "conn_abc123",
  "sessionId": "sess_xyz789",
  "playerId": "player_456",
  "connectedAt": "2026-01-15T10:00:00.000Z",
  "disconnectedAt": "2026-01-15T10:15:00.000Z",
  "duration_ms": 900000,
  "messageCount": 147,
  "messagesByType": {
    "toggle_step": 89,
    "set_tempo": 12,
    "select_instrument": 23,
    "play": 15,
    "stop": 8
  },
  "peakConcurrentPlayers": 3,
  "playersSeenCount": 4,
  "playCount": 15,
  "totalPlayTime_ms": 180000,
  "syncRequestCount": 2,
  "syncErrorCount": 0,
  "disconnectReason": "normal_close"
}
```

**Queryable questions:**
- "Show me sessions with sync errors"
- "What's the average session duration for multiplayer vs solo?"
- "Which message types are most common?"
- "How many sessions have 3+ concurrent players?"

---

### 3. `error`

Emitted on any caught exception or error condition.

**Trigger:** Catch blocks, error boundaries

**Schema:**

```typescript
interface ErrorEvent {
  event: "error";

  // Error identity
  errorId: string;
  errorType: string;        // e.g., "ValidationError", "KVError"
  errorMessage: string;

  // Timing
  timestamp: string;

  // Context
  requestId?: string;
  connectionId?: string;
  sessionId?: string;
  playerId?: string;

  // Location
  source: "worker" | "durable_object" | "client";
  handler?: string;         // e.g., "handleToggleStep"

  // Stack (truncated)
  stack?: string;
}
```

**Example:**

```json
{
  "event": "error",
  "errorId": "err_abc123",
  "errorType": "KVError",
  "errorMessage": "KV write failed: quota exceeded",
  "timestamp": "2026-01-15T10:30:00.000Z",
  "sessionId": "sess_xyz789",
  "source": "durable_object",
  "handler": "handleStateSync",
  "stack": "Error: KV write failed...(truncated)"
}
```

---

## Implementation

### Context Accumulator Pattern

For wide events, accumulate context during the lifecycle:

```typescript
// In Durable Object
class SessionDO {
  private wsContext: Map<string, WsContext> = new Map();

  handleWebSocketConnect(ws: WebSocket, playerId: string) {
    this.wsContext.set(ws, {
      connectionId: crypto.randomUUID(),
      playerId,
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
      event: "ws_session_end",
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

Wrap handlers to emit `http_request_end`:

```typescript
function withObservability(handler: Handler): Handler {
  return async (request, env, ctx) => {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const metrics = { kvReads: 0, kvWrites: 0, doRequests: 0 };

    try {
      const response = await handler(request, env, { ...ctx, requestId, metrics });

      console.log(JSON.stringify({
        event: "http_request_end",
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
        event: "http_request_end",
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
- Implement `http_request_end` in API routes
- Implement `ws_session_end` in Durable Object
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
| http_request_end | Every API call | ~10,000 |
| ws_session_end | Every WS disconnect | ~1,500 |
| error | On errors only | ~50 |
| **Total** | | **~11,550** |

Workers Logs limit: 5 billion/day. Usage: 0.0002%

---

*Spec created: January 2026*
