# Observability 2.0 Research

> **Type:** Research Document
> **Status:** Reference material for future implementation decisions
> **Related:** [OBSERVABILITY.md](./OBSERVABILITY.md) (current implementation)

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

## Cloudflare Workers Logs

Cloudflare provides native observability that we're not currently using:

| Feature | Capability |
|---------|------------|
| **Workers Logs** | 7-day retention, automatic JSON indexing, Query Builder |
| **Head sampling** | `head_sampling_rate` in wrangler.toml |
| **Automatic instrumentation** | KV, DO, fetch() calls traced automatically |
| **Invocation logs** | Request metadata captured without code |

**Key configuration:**
```toml
[observability]
enabled = true

[observability.logs]
enabled = true
invocation_logs = true
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

Based on 500 DAU assumption:

| Behavior | Rate |
|----------|------|
| Sessions created/user | 0.5 |
| Session accesses/user | 3 |
| Multiplayer adoption | 30% |
| Plays per session | 5 |

**Result: ~8,000 events/day at 500 DAU**

Workers Logs limit is 5 billion/day. Even at 500K DAU (~8M events/day), we'd use only 0.2% of capacity.

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
