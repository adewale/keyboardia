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

  // Error context (if status >= 400)
  errorType?: string;
  errorMessage?: string;

  // Performance
  kvReads?: number;
  kvWrites?: number;
  doRequests?: number;
}
```

**Example (joiner accessing published session):**

```json
{
  "event": "http_request_end",
  "requestId": "req_abc123",
  "method": "GET",
  "path": "/api/sessions/sess_xyz789",
  "deviceType": "mobile",
  "timestamp": "2026-01-15T10:30:00.000Z",
  "duration_ms": 45,
  "status": 200,
  "routePattern": "/api/sessions/:id",
  "action": "access",
  "sessionId": "sess_xyz789",
  "playerId": "player_456",
  "isPublished": true,
  "kvReads": 1,
  "kvWrites": 0,
  "doRequests": 1
}
```

**Example (remix action - virality tracking):**

```json
{
  "event": "http_request_end",
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
  "event": "http_request_end",
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

**Queryable questions:**
- "Which sessions generated the most remixes?" → `COUNT(*) WHERE action = 'remix' GROUP BY sourceSessionId`
- "What's the remix rate for published vs editable?" → `COUNT(*) WHERE action = 'remix' GROUP BY isPublished`
- "How many sessions were published today?" → `COUNT(*) WHERE action = 'publish'`
- "Are mobile users more likely to consume or create?" → `COUNT(*) GROUP BY deviceType, action`
- "Are people mostly consuming published content?" → `COUNT(*) WHERE action = 'access' GROUP BY isPublished`

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

  // Disconnect
  disconnectReason: "normal_close" | "error" | "timeout" | "replaced";
  errorMessage?: string;
}
```

**Example (joiner viewing published session):**

```json
{
  "event": "ws_session_end",
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
  "disconnectReason": "normal_close"
}
```

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

## Design Decisions

### `http_request_end` — Included vs Excluded

| Included | Why | Excluded | Why Not |
|----------|-----|----------|---------|
| `playerId` | Per-user analytics, isCreator derivation | Request body | Too large, rarely needed |
| `sessionId` | Link requests to sessions | Response body | Too large |
| `sourceSessionId` | Remix virality tracking | IP address | Privacy, not useful |
| `isPublished` | Published vs editable consumption | Full User-Agent | Noise, deviceType suffices |
| `deviceType` | Mobile vs desktop segmentation | Headers | Noise |
| `action` (create/access/publish/remix) | Business metrics, funnel analysis | Geo location | Overkill for MVP |
| `duration_ms` | Performance debugging | | |
| `kvReads`, `kvWrites`, `doRequests` | Cost attribution | | |

**Note on `isCreator`:** Derived by correlating `playerId` from `action: "create"` with subsequent `ws_session_end` events for the same `sessionId`. The player who created the session is the creator.

### `ws_session_end` — Included vs Excluded

| Included | Why | Excluded | Why Not |
|----------|-----|----------|---------|
| `isCreator` | Segment creators vs joiners | Individual message payloads | Massive, in DO already |
| `isPublished` | Published vs editable engagement | Full player list | Privacy, rarely needed |
| `messagesByType` | Understand usage patterns | Per-message timestamps | Too granular |
| `peakConcurrentPlayers` | Multiplayer health | Pattern state snapshots | Huge, stored in DO |
| `playCount`, `totalPlayTime_ms` | Engagement metrics | Network latency samples | Complex to capture |

### `error` — Included vs Excluded

| Included | Why | Excluded | Why Not |
|----------|-----|----------|---------|
| `errorType`, `errorMessage` | Classification | Full stack trace | Truncate to 500 chars |
| `handler` | Locate code path | Environment variables | Security risk |
| `sessionId`, `playerId` | Correlation | Full request context | Redundant |

---

## Typical Traces

Most users **join** sessions rather than create them. The traces differ:

### Creator Flow (minority of users)

```
┌─────────────────────┐
│ http_request_end    │  POST /api/sessions
│ action: "create"    │
│ playerId: creator1  │
│ sessionId: abc      │
└─────────────────────┘
         │
         ▼
    (WebSocket lifecycle - messages accumulated, not logged)
         │
         ▼
┌─────────────────────┐
│ ws_session_end      │
│ playerId: creator1  │
│ sessionId: abc      │
│ isCreator: true     │  ← Creator
│ messageCount: 200   │
└─────────────────────┘
```

### Joiner Flow (majority of users)

```
┌─────────────────────┐
│ http_request_end    │  GET /api/sessions/abc
│ action: "access"    │  ← Access, not create
│ playerId: joiner1   │
│ sessionId: abc      │
└─────────────────────┘
         │
         ▼
    (WebSocket lifecycle - messages accumulated, not logged)
         │
         ▼
┌─────────────────────┐
│ ws_session_end      │
│ playerId: joiner1   │
│ sessionId: abc      │
│ isCreator: false    │  ← Joiner
│ messageCount: 47    │
└─────────────────────┘
```

### Combined: One Session, Multiple Users

```
Timeline
────────────────────────────────────────────────────────────────────────►

Creator creates session
│
▼
┌───────────────────┐
│ http_request_end  │ action: "create", playerId: creator1
└───────────────────┘
         │
    Creator shares link
         │
         ├──────────────────────────────────────┐
         │                                      │
         ▼                                      ▼
    Joiner A clicks link                   Joiner B clicks link
         │                                      │
         ▼                                      ▼
┌───────────────────┐                  ┌───────────────────┐
│ http_request_end  │                  │ http_request_end  │
│ action: "access"  │                  │ action: "access"  │
│ playerId: joinerA │                  │ playerId: joinerB │
└───────────────────┘                  └───────────────────┘
         │                                      │
         ▼                                      ▼
    All 3 collaborate via WebSocket (no events during)
         │
         ▼
┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
│ ws_session_end    │  │ ws_session_end    │  │ ws_session_end    │
│ isCreator: true   │  │ isCreator: false  │  │ isCreator: false  │
│ playerId: creator │  │ playerId: joinerA │  │ playerId: joinerB │
│ messageCount: 200 │  │ messageCount: 47  │  │ messageCount: 23  │
└───────────────────┘  └───────────────────┘  └───────────────────┘

Total events for this session: 3 http_request_end + 3 ws_session_end = 6
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
     │                    │  │ http_request_end │  │                  │
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
     │                    │                        │  context = {     │
     │                    │                        │    isCreator:    │
     │                    │                        │      false,      │
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
     │                    │                        │  │ ws_session_end      │
     │                    │                        │  │ isCreator: false    │
     │                    │                        │  │ messageCount: 47    │
     │                    │                        │  └─────────┬───────────┘
     │                    │                        │            │
     │                    │                        │            ▼
     │                    │                        │      Workers Logs
```

---

## Implementation

### Context Accumulator Pattern

For wide events, accumulate context during the lifecycle:

```typescript
// In Durable Object
class SessionDO {
  private wsContext: Map<string, WsContext> = new Map();
  private creatorId: string;  // Set when session is created

  handleWebSocketConnect(ws: WebSocket, playerId: string) {
    this.wsContext.set(ws, {
      connectionId: crypto.randomUUID(),
      playerId,
      isCreator: playerId === this.creatorId,  // Most will be false
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
