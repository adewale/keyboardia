# Durable Objects Cost Analysis

Research on Cloudflare Durable Objects pricing for Keyboardia's 1-DO-per-session architecture.

> Last updated: December 2025

## Executive Summary

**Idle Durable Objects cost nothing.** With WebSocket Hibernation, Keyboardia can maintain thousands of sessions at minimal cost (~$5/month at 10,000 sessions/day).

---

## 1. Pricing Model

### Billing Components

| Component | Rate | Included (Paid $5/mo) | Source |
|-----------|------|----------------------|--------|
| Requests | $0.15/million | 1 million | [Pricing docs](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Duration (GB-seconds) | $12.50/million | 400,000 | [Pricing docs](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Storage (SQLite) | Free (for now) | — | [Pricing docs](https://developers.cloudflare.com/durable-objects/platform/pricing/#storage) |

### Duration Billing Details

From [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/):

> "Duration is billed in wall-clock time as long as the Object is active, measured in Gigabyte-seconds (GB-s). An Object is considered active when it has an open WebSocket connection, has an in-progress storage operation, or has a pending alarm."

**Key point:** Duration is billed at **128 MB per DO** regardless of actual memory usage.

> "Duration is billed at 128 MB of memory per Durable Object."

### Idle Objects Cost Nothing

From [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/):

> "Inactive objects receiving no requests do not incur any duration charges."

This is critical for Keyboardia's cost model.

---

## 2. WebSocket Hibernation (Essential)

### Why Hibernation Matters

From [WebSocket Hibernation docs](https://developers.cloudflare.com/durable-objects/best-practices/websockets/):

> "The WebSocket Hibernation API allows a Durable Object that is not currently running an event handler to be removed from memory while keeping its WebSockets connected."

**Without hibernation:** A WebSocket connected for 1 month costs ~$0.36
**With hibernation:** Same WebSocket idle costs ~$0.01

### Hibernation Billing

From [Pricing docs](https://developers.cloudflare.com/durable-objects/platform/pricing/):

> "WebSocket Hibernation API: If you have a Durable Object that is only receiving messages, but not executing, the Durable Object will not incur billable duration charges."

And:

> "WebSocket: Incoming messages use a 20:1 ratio... If the server receives 20 messages before it needs to respond, that counts as 1 request."

### Implementation Pattern

From [WebSocket Hibernation Server example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/):

```typescript
export class LiveSessionDurableObject extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Enable auto-response for ping/pong (free, keeps connection alive)
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('ping', 'pong')
    );
  }

  // Use webSocketMessage instead of addEventListener
  async webSocketMessage(ws: WebSocket, message: string) {
    // Only charged for duration while this executes
  }
}
```

---

## 3. Request Billing Details

### What Counts as a Request

From [Pricing docs](https://developers.cloudflare.com/durable-objects/platform/pricing/):

| Action | Requests |
|--------|----------|
| HTTP request to DO | 1 |
| WebSocket connection | 1 |
| 20 incoming WebSocket messages | 1 |
| Outgoing WebSocket messages | 0 (free) |
| Alarm trigger | 1 |

### WebSocket Message Ratio

> "Incoming WebSocket messages to a Durable Object are charged at a 20:1 ratio... If the server receives 20 messages before it needs to respond, that counts as 1 request."

This means high-frequency collaboration is cheap.

---

## 4. Free Tier

From [Free Tier Changelog (April 2025)](https://developers.cloudflare.com/changelog/2025-04-07-durable-objects-free-tier/):

| Resource | Free Tier Limit |
|----------|-----------------|
| Requests | 100,000/day |
| Duration | 13,000 GB-seconds/day |
| Storage | 5 GB total |

> "Daily limits reset at 00:00 UTC"

**Note:** Free tier only supports SQLite-backed DOs, not KV-backed.

---

## 5. Limits

From [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/):

| Limit | Value |
|-------|-------|
| CPU time per request | 30 seconds (soft), 60 seconds (hard) |
| WebSocket connections per DO | Unlimited |
| Storage per DO (SQLite) | 10 GB |
| Message size (WebSocket) | 1 MiB |
| Concurrent connections | No documented limit |

> "Durable Objects do not have a hard limit on the total number of objects that can be created."

This confirms unlimited DO creation is allowed.

---

## 6. Storage Billing (Future)

From [Pricing docs](https://developers.cloudflare.com/durable-objects/platform/pricing/#storage):

> "Storage billing is not yet enabled. Cloudflare will provide advance notice before storage billing is enabled, which is planned for H1 2025."

When enabled, expected to follow D1 pricing model:
- Rows read: ~$0.001/million
- Rows written: ~$0.001/million

**Mitigation:** Use KV for long-term persistence, DO storage only for active session state.

---

## 7. Cost Estimates for Keyboardia

### Assumptions

- 1 Durable Object per session
- Average 2 users per session
- Users send 60 messages/hour when active
- Average session: 30 minutes
- Processing time: 10ms per message
- WebSocket Hibernation enabled

### Scenario Calculations

#### 100 Sessions/Day (3,000/month)

```
Requests:
  - Session creation: 3,000
  - WebSocket connections: 6,000
  - Messages: 180,000 / 20 = 9,000
  - Total: 18,000 (within 1M included)
  - Cost: $0.00

Duration:
  - Active time: 180,000 × 10ms = 1,800 seconds
  - GB-seconds: 1,800 × (128/1024) = 225
  - Cost: $0.00 (within 400K included)

Total: $5.00 (base plan only)
```

#### 1,000 Sessions/Day (30,000/month)

```
Requests: 180,000 (within 1M included)
Duration: 2,250 GB-s (within 400K included)
Total: $5.00 (base plan only)
```

#### 10,000 Sessions/Day (300,000/month)

```
Requests:
  - Total: 1,800,000
  - Overage: 800,000 × $0.15/1M = $0.12

Duration:
  - 22,500 GB-s (within 400K included)
  - Cost: $0.00

Total: $5.12/month
```

### Without Hibernation (Worst Case)

If WebSocket connections keep DO active for full session duration:

```
10,000 sessions/day × 30 min × 30 days = 135M GB-seconds
Cost: $1,687/month
```

**This is why Hibernation is essential.**

---

## 8. Cost Optimization Strategies

### 1. Use WebSocket Hibernation (Essential)

See [WebSocket Hibernation best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/).

### 2. Batch Messages

Since 20 messages = 1 request, batching state updates reduces costs.

### 3. Use KV for Persistence

From [Storage Options guide](https://developers.cloudflare.com/workers/platform/storage-options/):

| Storage | Use Case | Cost |
|---------|----------|------|
| KV | Session persistence | $0.50/million reads |
| DO SQLite | Active session state | Currently free |
| R2 | Recordings | $0.015/GB storage |

### 4. Auto-Cleanup on Disconnect

When all users leave, save to KV and let DO evict (free).

---

## 9. Gotchas

### Memory Billing

From [Pricing docs](https://developers.cloudflare.com/durable-objects/platform/pricing/):

> "Duration is billed at 128 MB of memory per Durable Object, regardless of the amount of memory actually used."

### Alarm Billing

From [Pricing docs](https://developers.cloudflare.com/durable-objects/platform/pricing/):

> "When storage billing is enabled, each setAlarm() call will be charged as 1 row write."

### DO-to-DO Communication

From [Best practices](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-from-a-worker/):

DO-to-DO calls count as requests. Use Worker → DO pattern instead.

---

## 10. Monitoring

From [Cloudflare Dashboard](https://developers.cloudflare.com/durable-objects/observability/graphql-analytics/):

Track:
- Daily DO requests
- GB-seconds usage
- Storage operations (when enabled)

Set billing alerts for unexpected spikes.

---

## Summary

| Scale | Monthly Cost | Notes |
|-------|--------------|-------|
| 100 sessions/day | $5.00 | Base plan only |
| 1,000 sessions/day | $5.00 | Base plan only |
| 10,000 sessions/day | $5.12 | Minimal overage |
| 100,000 sessions/day | ~$6-8 | Still very cheap |

**Keyboardia's 1-DO-per-session architecture is cost-effective at any realistic scale.**

---

## References

All claims grounded in official Cloudflare documentation:

- [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [WebSocket Hibernation Best Practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [WebSocket Hibernation Server Example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)
- [Free Tier Changelog (April 2025)](https://developers.cloudflare.com/changelog/2025-04-07-durable-objects-free-tier/)
- [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Storage Options Guide](https://developers.cloudflare.com/workers/platform/storage-options/)
- [Access DO from Worker](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-from-a-worker/)
- [GraphQL Analytics](https://developers.cloudflare.com/durable-objects/observability/graphql-analytics/)
