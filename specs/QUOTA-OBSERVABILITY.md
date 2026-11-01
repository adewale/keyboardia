# Quota Observability & Detection Strategy

## Problem Statement

We recently hit Cloudflare KV quota limits ("KV put() limit exceeded for the day") on the free tier:
- **Free tier limit**: 1,000 writes/day
- **Error visibility**: Opaque - saves silently failed until user noticed data loss
- **Detection**: No early warning before quota exhaustion
- **Diagnosis**: Hard to identify which operations consumed quota

This document outlines strategies for detecting, monitoring, and mitigating quota issues.

---

## Current Mitigations (Already Implemented)

| Fix | Location | Impact |
|-----|----------|--------|
| 503 response with `Retry-After` header | `sessions.ts` | Users get clear error + retry time |
| Increased debounce (2s → 5s) | `live-session.ts`, `session.ts` | ~60% fewer KV writes |
| HTTP retry with exponential backoff | `session.ts` | Graceful handling of transient errors |

---

## Cloudflare Quota Landscape

| Resource | Free Tier | Paid Tier | Monitoring Priority |
|----------|-----------|-----------|---------------------|
| KV Reads | 100,000/day | $0.50/million | Low |
| **KV Writes** | **1,000/day** | **$5.00/million** | **HIGH** |
| KV Storage | 1GB | $0.50/GB-month | Medium |
| DO Requests | 1M included | $0.15/million | Medium |
| DO Duration | 400K GB-s | $12.50/million GB-s | Low |
| R2 Writes | 10M/month | $0.0045/1K ops | Low |
| R2 Reads | 10M/month | Free | Low |

**Key insight**: KV writes are the bottleneck. Everything else has comfortable headroom.

---

## Observability Strategy

### 1. In-Memory Write Counter (Zero-Cost)

Track writes in Durable Object memory without any additional KV writes.

```typescript
// In LiveSessionDurableObject
class QuotaTracker {
  private kvWriteCount = 0;
  private kvWritesByHour: Map<string, number> = new Map();

  recordWrite() {
    this.kvWriteCount++;
    const hour = new Date().toISOString().slice(0, 13); // "2024-12-10T22"
    this.kvWritesByHour.set(hour, (this.kvWritesByHour.get(hour) ?? 0) + 1);

    // Purge old hours (keep last 24)
    if (this.kvWritesByHour.size > 24) {
      const oldestHour = Array.from(this.kvWritesByHour.keys())[0];
      this.kvWritesByHour.delete(oldestHour);
    }
  }

  getStats() {
    return {
      totalWrites: this.kvWriteCount,
      hourlyBreakdown: Object.fromEntries(this.kvWritesByHour),
      projectedDaily: this.estimateDailyUsage(),
    };
  }

  private estimateDailyUsage(): number {
    // Average writes/hour * 24
    const hourlyAvg = this.kvWriteCount / this.kvWritesByHour.size;
    return Math.round(hourlyAvg * 24);
  }
}
```

**Pros**: Zero KV cost, real-time, per-session granularity
**Cons**: Lost on DO eviction, doesn't track Worker-level writes

---

### 2. Cloudflare Analytics API (External)

Use Cloudflare's built-in analytics for aggregate monitoring.

**GraphQL Query** (for dashboard or external monitor):
```graphql
query KVAnalytics($accountId: String!, $kvId: String!, $date: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountId }) {
      kvStorageAdaptiveGroups(
        filter: { date: $date, kvId: $kvId }
        limit: 100
      ) {
        dimensions { date }
        sum { requestCount }
      }
    }
  }
}
```

**Implementation via `/api/admin/quota` endpoint**:
```typescript
// Requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID env vars
app.get('/api/admin/quota', async (c) => {
  const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${c.env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  return c.json(await response.json());
});
```

**Pros**: Official source of truth, historical data
**Cons**: 24-48 hour lag, requires API token, doesn't prevent quota hits

---

### 3. Proactive Write Budgeting

Implement a daily write budget system that throttles when approaching limits.

```typescript
// Constants
const DAILY_WRITE_BUDGET = 900; // Reserve 10% buffer from 1000 limit
const CRITICAL_THRESHOLD = 0.8; // 80% = 720 writes

interface WriteBudget {
  date: string;       // "2024-12-10"
  used: number;       // Current count
  reserved: number;   // Pre-reserved for active sessions
}

// Store budget in KV (1 write/day to update)
async function checkWriteBudget(env: Env): Promise<{ allowed: boolean; remaining: number }> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `budget:${today}`;

  const budget = await env.SESSIONS.get(key, 'json') as WriteBudget | null;
  const used = budget?.used ?? 0;
  const remaining = DAILY_WRITE_BUDGET - used;

  return {
    allowed: remaining > 0,
    remaining,
  };
}

async function recordWrite(env: Env): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const key = `budget:${today}`;

  const budget = await env.SESSIONS.get(key, 'json') as WriteBudget | null;
  const newBudget: WriteBudget = {
    date: today,
    used: (budget?.used ?? 0) + 1,
    reserved: budget?.reserved ?? 0,
  };

  // This write itself counts against budget
  await env.SESSIONS.put(key, JSON.stringify(newBudget), {
    expirationTtl: 86400 * 2, // 2 days
  });
}
```

**Pros**: Prevents quota exhaustion, provides remaining count
**Cons**: Adds 1 KV write per tracked write (doubles writes!), complex

**Better approach**: Batch budget updates via Durable Object alarm

```typescript
// In LiveSessionDurableObject
private pendingWriteCount = 0;

async recordLocalWrite() {
  this.pendingWriteCount++;
}

async alarm() {
  // Flush to KV once every alarm cycle
  if (this.pendingWriteCount > 0) {
    await this.flushWriteCountToKV();
    this.pendingWriteCount = 0;
  }
  // ... existing alarm logic
}
```

---

### 4. Debug Endpoint Enhancement

Extend existing `/api/sessions/:id/debug` to include quota info:

```typescript
// Add to debug response
{
  // ... existing debug info
  quota: {
    kvWriteEstimate: tracker.getStats(),
    debounceMs: KV_SAVE_DEBOUNCE_MS,
    lastSaveAt: lastKvSave?.toISOString(),
    pendingChanges: hasPendingChanges,
  }
}
```

---

## Alerting Strategy

### Tier 1: Log-Based (Zero Cost)

Add structured logs that can be searched via `wrangler tail`:

```typescript
// On quota error
console.error(JSON.stringify({
  event: 'quota_exceeded',
  resource: 'kv_writes',
  sessionId,
  timestamp: new Date().toISOString(),
}));

// On approaching threshold
console.warn(JSON.stringify({
  event: 'quota_warning',
  resource: 'kv_writes',
  percentUsed: 80,
  remaining: 200,
}));
```

**Usage**: `wrangler tail --format=json | jq 'select(.event == "quota_exceeded")'`

---

### Tier 2: Webhook Alerting (Low Cost)

On quota warning, POST to a webhook (Slack, Discord, email service):

```typescript
async function alertQuotaWarning(env: Env, percentUsed: number) {
  if (!env.ALERT_WEBHOOK_URL) return;

  await fetch(env.ALERT_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: `Keyboardia KV quota at ${percentUsed}% (${remaining} writes remaining)`,
      timestamp: new Date().toISOString(),
    }),
  });
}
```

---

## Recommended Implementation Plan

### Phase A: Zero-Cost Observability (Immediate)

1. Add `QuotaTracker` class to `LiveSessionDurableObject`
2. Extend `/debug` endpoint to include quota stats
3. Add structured logging for quota events
4. **Effort**: 2-3 hours, **Cost impact**: None

### Phase B: Proactive Protection (Short-term)

1. Implement batched write counting via DO alarms
2. Add warning logs at 70%, 80%, 90% thresholds
3. Return 503 earlier when budget is exhausted
4. **Effort**: 4-6 hours, **Cost impact**: +1-5 writes/day

### Phase C: External Monitoring (Medium-term)

1. Set up Cloudflare Analytics API queries
2. Create simple dashboard showing historical usage
3. Integrate webhook alerting for threshold breaches
4. **Effort**: 1-2 days, **Cost impact**: API calls only

---

## Key Metrics to Track

| Metric | Source | Alert Threshold |
|--------|--------|-----------------|
| KV writes/day | DO memory + batched KV | 70%, 80%, 90% |
| Active sessions | DO state | >50 concurrent |
| Save failures | Error logs | Any occurrence |
| Average saves/session/hour | DO memory | >10/hour |
| Unique sessions/day | KV (daily batch) | Trend monitoring |

---

## Trade-offs Summary

| Approach | KV Cost | Latency | Accuracy | Complexity |
|----------|---------|---------|----------|------------|
| DO memory counter | 0 writes | Real-time | Session-level | Low |
| Batched budget tracking | +1-5/day | 5-60s delay | Global | Medium |
| CF Analytics API | 0 writes | 24-48h lag | Exact | Medium |
| Per-write tracking | +100% | Real-time | Exact | High |

**Recommendation**: Start with DO memory counters (Phase A), add batched tracking (Phase B) if granular control needed.

---

## Related Documents

- [TUNING-CONSTANTS.md](./TUNING-CONSTANTS.md) - All configurable timing values
- [ROADMAP.md](./ROADMAP.md) - Phase 14 retry implementation
