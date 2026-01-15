# Observability 2.0 Research

> **Type:** Research Document
> **Status:** Reference material for future implementation decisions
> **Related:** [OBSERVABILITY.md](../OBSERVABILITY.md) (current implementation)

---

## Summary

This document captures research into modern observability practices, specifically the "Observability 2.0" philosophy championed by Charity Majors (Honeycomb) and articulated on loggingsucks.com. The goal is to inform future decisions, not prescribe immediate changes.

---

## Key Sources

| Source | Key Contribution |
|--------|------------------|
| [loggingsucks.com](https://loggingsucks.com/) | Wide events pattern, "emit once at end" |
| [Charity Majors / Honeycomb](https://charity.wtf/) | Observability 2.0 framework, high-cardinality advocacy |
| [Observability Engineering (O'Reilly)](https://www.oreilly.com/library/view/observability-engineering/9781492076438/) | Industry best practices |
| [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) | Platform-native capabilities |

---

## Core Insight: Observability 1.0 vs 2.0

| Observability 1.0 | Observability 2.0 |
|-------------------|-------------------|
| Three pillars (metrics, logs, traces) as separate concerns | **Single source of truth**: wide structured events |
| Collect metrics independently | **Derive metrics** from events at query time |
| Design for known questions | **Design for unknown unknowns** |
| Aggregate at write time | **Never aggregate**—keep raw events |

> "Observability 2.0 has one source of truth, wide structured log events, from which you can derive all the other data types."
> — Charity Majors

---

## Wide Events Pattern

Instead of emitting many log lines throughout a request lifecycle, **build up context in memory and emit once at the end**.

**Traditional approach** (many emissions):
```
[WS] connect session=abc player=xyz
[WS] message session=abc type=toggle_step
[WS] message session=abc type=set_tempo
[WS] disconnect session=abc duration=120s
```

**Wide event approach** (single emission with everything):
```json
{
  "sessionId": "abc",
  "playerId": "xyz",
  "duration": 120,
  "messageCount": 47,
  "messagesByType": { "toggle_step": 42, "set_tempo": 5 },
  "disconnectReason": "normal_close"
}
```

**Benefits:**
- Richer context for debugging (all fields together)
- Fewer writes (cost savings)
- Enables arbitrary queries ("show me sessions where X AND Y AND Z")

---

## Designing Wide Events

**Principles:**

1. **One event per lifecycle** — Identify the natural lifecycle (HTTP request, WebSocket connection, background job) and emit exactly one event when it ends.

2. **Build context, emit once** — Accumulate data in memory during the lifecycle. Don't log as you go; capture everything and emit at the end.

3. **Include identifiers freely** — `sessionId`, `playerId`, `requestId` — high cardinality is fine. These enable filtering and grouping.

4. **Aggregate inside the event** — Instead of emitting 47 `message_received` events, emit one event with `messageCount: 47` and `messagesByType: { toggle_step: 42, set_tempo: 5 }`.

5. **Capture both outcome and journey** — Include the result (`status`, `disconnectReason`) AND what happened along the way (`duration_ms`, `errorCount`, `kvWrites`).

6. **Design for unknown questions** — Include fields you might want to query later, even if you don't need them now.

**Litmus test:** If you need to JOIN or correlate multiple log lines to answer a question, your events aren't wide enough.

---

## Cloudflare Workers Logs

Cloudflare provides native observability that we're not currently using:

| Feature | Capability |
|---------|------------|
| **Workers Logs** | 7-day retention, automatic JSON indexing, Query Builder |
| **Head sampling** | `head_sampling_rate` in wrangler.jsonc |
| **Automatic instrumentation** | KV, DO, fetch() calls traced automatically |
| **Invocation logs** | Request metadata captured without code |

**Key configuration:**
```jsonc
{
  "observability": {
    "enabled": true,
    "logs": {
      "enabled": true,
      "invocation_logs": true
    }
  }
}
```

This would replace our KV-based logging with zero additional infrastructure.

---

## Applicability to Keyboardia

### Current State (Phase 7)
- Per-event logging to KV (connect, message, disconnect)
- Separate metrics tracking functions
- 1-hour TTL in KV
- String-formatted console logs

### If We Adopted Obs 2.0
- Single `ws_session_end` event per connection lifecycle
- Metrics derived from events, not collected separately
- 7-day retention via Workers Logs
- Structured JSON for queryability

### Trade-offs

| Aspect | Current | Obs 2.0 |
|--------|---------|---------|
| Implementation effort | Done | ~15 hours |
| KV writes for observability | Multiple per connection | Zero |
| Retention | 1 hour | 7 days |
| Query flexibility | Fixed debug endpoints | Arbitrary SQL-like queries |
| Complexity | Simple, understood | New patterns to learn |

---

## Event Volume Estimates

### Assumptions

| Behavior | Rate |
|----------|------|
| Sessions created/user | 0.5 |
| Session accesses/user | 3 |
| Multiplayer adoption | 30% |
| Plays per session | 5 |

**~16 events/user/day**

### Volume by Scale

| DAU | Events/Day | % of 5B Limit | Context |
|-----|------------|---------------|---------|
| 30 | ~480 | 0.00001% | Early launch |
| 1,000 | ~16,000 | 0.0003% | **Primary baseline** |
| 10,000 | ~160,000 | 0.003% | Growth target |
| 100,000 | ~1.6M | 0.03% | Scale scenario |

---

## Cost Analysis

### Workers Logs Pricing

As of January 2026, Workers Logs are **included in all Workers plans** (Free and Paid):

| Plan | Log Limit | Cost |
|------|-----------|------|
| Free | 5B logs/day | $0 |
| Paid ($5/mo) | 5B logs/day | Included |

**At 1,000 DAU baseline: Zero additional cost.**

### Total Observability Cost

| Component | Current (Phase 7) | With Obs 2.0 |
|-----------|-------------------|--------------|
| KV writes for logs | ~$0.05/month | $0 (eliminated) |
| Workers Logs | N/A | $0 (included) |
| Paid Workers plan | $5/month | $5/month |
| **Total** | **~$5.05/month** | **$5/month** |

Obs 2.0 would slightly reduce costs by eliminating KV writes for logging, while providing 7-day retention (vs 1-hour) and query capabilities.

---

## Recommendation

**No immediate action required.**

The current Phase 7 observability is functional. Obs 2.0 principles are worth adopting if/when:

1. KV quota becomes a constraint (it hasn't since QUOTA-OBSERVABILITY.md)
2. We need to debug issues that require richer context
3. We want longer retention (7 days vs 1 hour)
4. We want arbitrary query capability

Keep this document as reference for when those needs arise.

---

*Research compiled: January 2026*
