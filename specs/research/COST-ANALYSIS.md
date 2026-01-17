# Keyboardia Cost Analysis

> **Research Date:** 2025-12-11
> **Production URL:** https://keyboardia.adewale-883.workers.dev
> **Analysis Period:** Current snapshot + historical metrics

---

## Data Sources

| Section | Data Type | Source |
|---------|-----------|--------|
| 1. Current Metrics | Measured | Workers Logs, `wrangler kv key list` |
| 2. Pricing Tables | Published | Cloudflare documentation (linked) |
| 3. Usage Scenarios | Projected | Assumptions + Cloudflare pricing |
| 4. Cost Drivers | Estimated | Code analysis of `src/worker/` |
| 5. Active Sessions | Measured | Debug endpoints, KV queries |

---

## Executive Summary

**Current Status:**
- **Total Sessions Created:** 32 (lifetime), 1 active in KV
- **Current Monthly Cost:** $5.00 ([Workers Paid plan base fee](https://developers.cloudflare.com/workers/platform/pricing/))
- **Usage Level:** Minimal (personal/testing phase)
- **Cost Structure:** Fixed $5/mo baseline, effectively unlimited headroom before additional charges

**Key Finding:** Keyboardia's architecture is extremely cost-efficient. At current usage (near-zero), costs are the minimum $5/month. Even scaling to 10,000 sessions/day would cost approximately $9.14/month (projected) due to Cloudflare's generous free tier allowances.

---

## 1. Current Production Metrics

### 1.1 Live System Data (2025-12-11)

> **Note:** The `/api/metrics` endpoint was removed as part of Observability 2.0 migration.
> Current metrics are derived from Workers Logs wide events. Data below is historical.

Retrieved at time of analysis:

```json
{
  "sessions": {
    "total": 32,
    "createdToday": 0,
    "accessedToday": 29
  },
  "requests": {
    "last5Minutes": {
      "creates": 0,
      "reads": 0,
      "updates": 0,
      "remixes": 0
    }
  }
}
```

**Interpretation:**
- 32 total sessions created since deployment
- 29 sessions accessed today (likely metrics query counting as access)
- Zero active traffic in last 5 minutes
- **Actual sessions stored in KV:** Only 1 (29 sessions were likely counted incorrectly or cleaned up)

### 1.2 KV Storage Analysis

Current KV keys (via `wrangler kv key list`):

```
1. metrics:daily:2025-12-10
2. metrics:total-sessions
3. session:1e81b85e-ad75-46cd-976c-ab3f3f91b6b8
```

**Session Data Size:**
- Sample session size: 5,672 bytes (~5.5 KB)
- Breakdown:
  - 6 tracks with 64 steps each
  - Parameter locks (volume/pitch automation)
  - Metadata (tempo: 110, swing: 10%)

**Storage Utilization:**
- Current KV storage: <10 KB
- Free tier limit: 1 GB
- Utilization: 0.001%

### 1.3 Request Logs

Retrieved via `/api/debug/logs?last=100`:
- **Result:** Empty array `[]`
- Logs have 1-hour TTL and no recent activity

---

## 2. Cost Breakdown by Service

### 2.1 Cloudflare Workers

**Pricing Model:** ([source](https://developers.cloudflare.com/workers/platform/pricing/))
- Free tier: 100,000 requests/day
- Paid plan: $5/month base + $0.30/million requests
- CPU time: Billed on actual CPU time (not wall time)
- 10ms CPU limit per request on free tier

**Current Usage:**
- Daily requests: <100 (estimated from access patterns)
- Status: Well within free tier
- **Cost:** $0.00 (covered by $5 base plan)

**Endpoints by Frequency (estimated):**
1. `GET /api/sessions/:id` - Session loads (low volume)
2. `PUT /api/sessions/:id` - Session updates (very low)
3. `POST /api/sessions` - Session creation (very low)
4. `POST /api/sessions/:id/remix` - Remixes (rare)
5. `GET /api/debug/*` - Debug endpoints (development only)

### 2.2 Workers KV

**Pricing Model:** ([source](https://developers.cloudflare.com/kv/platform/pricing/))
| Component | Free Tier | Paid Plan ($5/mo) | Overage |
|-----------|-----------|-------------------|---------|
| Storage | 1 GB | 1 GB included | $0.50/GB/month |
| Reads | 100,000/day | 10M/month included | $0.50/million |
| Writes | 1,000/day | 1M/month included | $5.00/million |
| Deletes | 1,000/day | 1M/month included | $5.00/million |
| Lists | 1,000/day | 1M/month included | $5.00/million |

**Current Usage:**
- **Reads:** Approximately 30-50/day (estimated)
- **Writes:** <10/day (estimated)
- **Storage:** <10 KB / 1 GB (0.001% utilization)
- **Cost:** $0.00 (far below included allowances)

**Key Patterns by Operation Type:** (from code analysis of `src/worker/`)

**Reads (per session interaction):**
1. Session load: 1 read (`session:{id}`)
2. Metrics display: 2-3 reads (daily metrics, total count)
3. Debug endpoint: 1-3 reads (session data, logs, WS metrics)

**Writes (per session creation):**
1. Session data: 1 write (`session:{id}`)
2. Total counter: 1 write (`metrics:total-sessions`)
3. Daily metrics: 1 write (`metrics:daily:{date}`)
4. Request log: 2-3 writes (log entry, session index, recent list)
5. **Total per create:** ~5-6 writes

**Writes (per session update):**
1. Session data: 1 write
2. Request log: 2-3 writes
3. Metrics: 1 write
4. **Total per update:** ~4-5 writes

**Storage Keys by Category:**
- Session data: `session:{uuid}` (5-10 KB each, 30-day TTL)
- Metrics: `metrics:*` (small, 7-day or permanent)
- Logs: `log:{id}`, `session-logs:{id}`, `logs:recent` (1-hour TTL)
- WebSocket logs: `ws-log:{id}`, `ws-session-logs:{id}`, `ws-metrics:{id}` (1-24 hour TTL)

### 2.3 Durable Objects

**Pricing Model:** ([source](https://developers.cloudflare.com/durable-objects/platform/pricing/))
| Component | Free Tier | Paid Plan ($5/mo) | Overage |
|-----------|-----------|-------------------|---------|
| Requests | 100,000/day | 1M/month included | $0.15/million |
| Duration (GB-s) | 13,000/day | 400K/month included | $12.50/million GB-s |
| Storage (SQLite) | 5 GB | See below | $0.20/GB-month |

**WebSocket-Specific Billing:**
- WebSocket connection: 1 request
- 20 incoming messages: 1 request (20:1 ratio)
- Outgoing messages: Free
- **Hibernation API:** Zero duration charges when idle

**Current Usage:**
- Active Durable Objects: 0 (no multiplayer sessions active)
- WebSocket connections: 0
- **Cost:** $0.00

**Implementation Status:**
- Durable Object class: `LiveSessionDurableObject` (implemented in Phase 8)
- WebSocket endpoint: `GET /api/sessions/:id/ws` (functional)
- Hibernation API: Implemented (essential for cost efficiency)
- Debug endpoint: `GET /api/debug/durable-object/:id` (implemented)

**Cost Protection Mechanisms:**
1. **WebSocket Hibernation:** DO goes idle when no messages, zero billing
2. **Auto-eviction:** DOs evict from memory when inactive
3. **20:1 message ratio:** High-frequency collaboration is cheap
4. **KV persistence:** Long-term state stored in KV, not DO storage

### 2.4 R2 Storage

**Status:** Not currently used

**Evidence:**
- `R2Bucket` defined in types (`SAMPLES: R2Bucket`)
- No actual usage in worker code (grep shows only type definition)
- Audio samples likely served as static assets from `/public`

**Future Consideration:**
If R2 is used for audio sample storage:
- Storage: $0.015/GB/month
- Class A operations (writes): $4.50/million
- Class B operations (reads): $0.36/million
- No egress fees

**Recommendation:** Keep samples as static assets (free via Workers Assets) unless dynamic sample loading is required.

---

## 3. Cost by Usage Scenario

> **Note:** Sections 3.2-3.5 are projections based on assumptions about user behavior and Cloudflare's published pricing.

### 3.1 Current Usage (Personal/Testing)

**Actual Monthly Usage:**
- Sessions created: ~1-5/month
- Sessions loaded: ~10-20/month (estimated)
- Multiplayer sessions: 0/month
- WebSocket connections: 0/month

**Actual Monthly Cost:**
```
Workers:         $0.00 (within free tier)
KV:             $0.00 (within included)
Durable Objects: $0.00 (none active)
───────────────────────────────
Base plan:      $5.00
TOTAL:          $5.00/month
```

### 3.2 Low Usage (100 sessions/day)

**Assumptions:**
- 100 sessions created/day (3,000/month)
- Average 2 loads per session
- 10% use multiplayer (20 connections/day)
- Average multiplayer session: 30 min, 60 messages/hour
- WebSocket Hibernation enabled

**Monthly Cost Calculation:**

```
Workers:
  Requests: 3,000 creates + 6,000 loads = 9,000
  Within 3M/month free tier
  Cost: $0.00

KV:
  Writes: 3,000 creates × 6 = 18,000 writes
  Reads: 6,000 loads × 1 = 6,000 reads
  Within 1M writes, 10M reads included
  Cost: $0.00

Durable Objects:
  Requests:
    - Connections: 20/day × 30 = 600
    - Messages: 600 × 30 msg = 18,000 / 20 = 900
    - Total: 1,500 requests/month
  Duration (with Hibernation):
    - Active time: 18,000 msg × 10ms = 180s/month
    - GB-seconds: 180 × 0.125 = 22.5 GB-s
  Within 1M requests, 400K GB-s included
  Cost: $0.00

───────────────────────────────
TOTAL: $5.00/month (base plan only)
```

### 3.3 Medium Usage (1,000 sessions/day)

**Assumptions:**
- 1,000 sessions/day (30,000/month)
- 30% use multiplayer (300 connections/day)
- Higher engagement: 120 messages/hour average

**Monthly Cost Calculation:**

```
Workers:
  Requests: 90,000 (within 3M included)
  Cost: $0.00

KV:
  Writes: 180,000 (within 1M included)
  Reads: 60,000 (within 10M included)
  Cost: $0.00

Durable Objects:
  Requests:
    - Connections: 9,000
    - Messages: 1,080,000 / 20 = 54,000
    - Total: 63,000 requests/month
  Duration (with Hibernation):
    - Active time: 1,080,000 × 10ms = 10,800s
    - GB-seconds: 10,800 × 0.125 = 1,350 GB-s
  Within included allowances
  Cost: $0.00

───────────────────────────────
TOTAL: $5.00/month (base plan only)
```

### 3.4 High Usage (10,000 sessions/day)

**Assumptions:**
- 10,000 sessions/day (300,000/month)
- 50% use multiplayer (5,000 connections/day)
- Active collaboration: 240 messages/hour

**Monthly Cost Calculation:**

```
Workers:
  Requests: 900,000 (within 3M included)
  Cost: $0.00

KV:
  Writes: 1,800,000
  Overage: 800,000 × $5/million = $4.00
  Reads: 600,000 (within 10M included)
  Cost: $4.00

Durable Objects:
  Requests:
    - Connections: 150,000
    - Messages: 36,000,000 / 20 = 1,800,000
    - Total: 1,950,000 requests/month
  Overage: 950,000 × $0.15/million = $0.14
  Duration (with Hibernation):
    - Active time: 36M × 10ms = 360,000s
    - GB-seconds: 360,000 × 0.125 = 45,000 GB-s
  Within 400K GB-s included
  Cost: $0.14

───────────────────────────────
Base plan:      $5.00
KV overage:     $4.00
DO overage:     $0.14
TOTAL:          $9.14/month
```

**Note:** This represents 300,000 monthly sessions - a massive scale for a drum machine app.

### 3.5 Enterprise Usage (100,000 sessions/day)

**Monthly Cost Estimate:** ~$50-80/month

At this scale:
- KV writes become significant ($40-50/month)
- DO requests add up ($15-20/month)
- Still remarkably affordable for 3M sessions/month

---

## 4. Where Costs Come From

> **Note:** The KV write counts in this section are derived from code analysis of `src/worker/sessions.ts` and `src/worker/logging.ts`.

### 4.1 Cost Drivers (Ranked by Impact)

**1. KV Writes (Highest Impact at Scale)**

Per session lifecycle:
```
Session Create:
  - session:{id}                    1 write
  - metrics:total-sessions          1 write
  - metrics:daily:{date}            1 write
  - log:{requestId}                 1 write
  - logs:recent                     1 write
  - metrics:requests                1 write
  Total: 6 writes

Session Update:
  - session:{id}                    1 write
  - log:{requestId}                 1 write
  - session-logs:{sessionId}        1 write
  - logs:recent                     1 write
  - metrics:requests                1 write
  Total: 5 writes

Session Load:
  - log:{requestId}                 1 write
  - logs:recent                     1 write
  - metrics:daily:{date}            1 write
  - metrics:requests                1 write
  Total: 4 writes
```

**Cost Impact:** At 10,000 sessions/day with 2 loads each:
- Creates: 60,000 writes/day
- Loads: 80,000 writes/day
- Total: 140,000 writes/day = 4.2M/month
- Overage: 3.2M × $5/million = $16/month

**2. Durable Objects Requests (Medium Impact)**

With WebSocket Hibernation:
- Connection establishment: 1 request per user
- Messages: 1 request per 20 messages
- Very affordable even at high volume

**Without Hibernation (DO NOT DO THIS):**
- Duration billing would skyrocket to $1,687/month at 10K sessions/day

**3. KV Reads (Low Impact)**

Reads are cheap ($0.50/million) and have large free tier (10M/month included).

**4. Workers Requests (Negligible Impact)**

$0.30/million and 3M/month included means Workers costs are essentially zero until extreme scale.

### 4.2 Logging Overhead

**Current Logging Strategy:**

Every API request creates:
- 1 log entry in KV (`log:{requestId}`)
- 1 index update (`session-logs:{sessionId}` or `logs:recent`)
- 1 metric update (`metrics:requests` or `metrics:daily`)

**Overhead:** 3 KV writes per request

**Cost at 10K sessions/day:**
- Base operations: 60,000 writes
- Logging overhead: 180,000 writes
- **Logging is 3x the base cost**

**Optimization Opportunity:**
1. Reduce log TTL to 15 minutes instead of 1 hour
2. Sample logs (e.g., 10% of requests)
3. Buffer logs in memory, batch writes
4. Remove `logs:recent` global index (use per-session only)

**Potential Savings:** Reduce logging writes by 50-75%

### 4.3 WebSocket Message Volume

**Message Types by Frequency (estimated):**

```
High Frequency (per beat, 120 BPM = 2/sec):
  - playback_tick                  ~120/min

Medium Frequency (per user action):
  - toggle_step                    ~10-20/min
  - set_tempo                      ~1-2/min
  - set_swing                      ~1-2/min
  - set_volume                     ~5-10/min

Low Frequency:
  - player_join                    1/session
  - player_leave                   1/session
  - sync_state                     1/min (periodic)
```

**Total estimated messages:**
- Active jamming: 150-200 messages/min
- Idle (playback only): 120 messages/min
- Per 30-min session: 3,600-6,000 messages

**Cost Impact:**
- 6,000 messages / 20 = 300 DO requests
- 300 × $0.15/million = $0.000045 per session
- At 10K sessions/day: 150,000 requests/month = $0.022

**Conclusion:** WebSocket message volume is not a cost concern.

---

## 5. Most Active Sessions Analysis

### 5.1 Current Active Sessions

**Query:** Attempted to retrieve session activity via debug endpoints

**Results:**
- Only 1 session found in KV storage
- Session ID: `1e81b85e-ad75-46cd-976c-ab3f3f91b6b8`
- No WebSocket activity (WS logs empty)
- No multiplayer connections active

**Sample Session Details:**
```
Tracks: 6
  - Chord (64 steps, parameter locks)
  - Bass (16 steps)
  - Cowbell (8 steps)
  - Sub Bass (4 steps)
  - Lead (64 steps, 2 parameter locks)
  - Pluck (64 steps, 9 parameter locks)

Tempo: 110 BPM
Swing: 10%
Size: 5,672 bytes
Created: Dec 2025
Last accessed: Dec 2025 (recent)
```

**Interpretation:** This appears to be a test/demo session.

### 5.2 Historical Activity Patterns

Based on metrics:
- 32 total sessions created since deployment
- Most sessions likely expired (30-day TTL)
- Current retention: 3% (1 of 32 still in KV)
- Average session lifespan: <30 days (most cleaned up)

**Session Cleanup Working As Expected:**
- TTL mechanism is functioning
- Storage doesn't accumulate indefinitely
- Only active/recent sessions retained

### 5.3 No Multiplayer Activity Yet

**Evidence:**
- No WebSocket logs in KV
- No WebSocket metrics
- Debug endpoints return empty data for connections
- Durable Objects not actively used

**Conclusion:** Multiplayer features implemented but not yet in production use.

---

## 6. Recommendations

### 6.1 Immediate Actions

**1. Reduce Logging Overhead**
- **Current:** Every request writes 3-5 KV entries
- **Recommendation:** Implement sampling (log 10% of requests)
- **Savings:** 70-90% reduction in log writes
- **Impact:** At 10K sessions/day, saves ~$12/month

**2. Monitor for Free Tier Graduation**
- Set up billing alerts at 80% of included limits
- Monitor KV write operations specifically
- Watch for unexpected Durable Object duration spikes

**3. Validate WebSocket Hibernation**
- When multiplayer goes live, verify DOs are hibernating
- Check duration billing in Cloudflare dashboard
- Alert if any DO is active >1 minute continuously

### 6.2 Optimization Opportunities

**1. Batch KV Writes**
```typescript
// Current: 3 writes per request
await env.SESSIONS.put(logKey, data);
await env.SESSIONS.put(indexKey, index);
await env.SESSIONS.put(metricsKey, metrics);

// Optimized: Batch in memory, flush every 10 seconds
await batchWrite([
  { key: logKey, value: data },
  { key: indexKey, value: index },
  { key: metricsKey, value: metrics }
]);
```

**Savings:** Reduce write operations by 50-70%

**2. Lazy Metric Updates**
- Don't update metrics on every read
- Update in background with Durable Objects alarm
- Only update metrics once per hour per session

**3. Compress Session Data**
```typescript
// Current: 5.6 KB average
// With gzip compression: ~1-2 KB
// Savings: 60-70% storage reduction
```

**Note:** Compression has minimal cost impact (storage is cheap), but reduces KV read/write bandwidth.

**4. Remove `logs:recent` Global Index**
- Per-session logs are sufficient for debugging
- Global log index is rarely used
- **Savings:** 1 write per request = 33% reduction in log overhead

### 6.3 Future Considerations

**1. SQLite Storage Billing (Now Active)**

SQLite storage billing is now enabled with generous included allowances:
- 25 billion row reads/month included
- 50 million row writes/month included
- 5 GB-month storage included

Current approach (already implemented):
- Store session state in KV (long-term persistence)
- Use DO SQLite only for active multiplayer state
- When DO evicts, state already saved to KV

**If SQLite costs become significant:**
- Minimize DO storage writes
- Use in-memory only, persist to KV on save
- Monitor row read/write metrics via [GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/)

**2. If Scaling Past 10K Sessions/Day**

At 100K sessions/day (~$80/month):
- Consider request sampling for logging
- Implement CDN caching for GET requests
- Evaluate alternative session storage (D1, external DB)

**3. Alternative: Cloudflare D1**

D1 Database pricing:
- 5M row reads/day free
- 100K row writes/day free
- $0.001 per million rows read/written

**Use case:** Could replace KV for session storage if scale requires SQL queries or transactions. Current usage would be entirely free.

---

## 7. Cloudflare Cost Optimization Best Practices

This section documents Cloudflare's official recommendations for cost optimization, applied to Keyboardia.

> **Sources:** [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/), [DO Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers Optimization Blog](https://blog.cloudflare.com/workers-optimization-reduces-your-bill/)

### 7.1 Workers Best Practices

| Practice | Keyboardia Status | Notes |
|----------|-------------------|-------|
| **Use Service Bindings** (no extra request fees) | N/A | Single Worker architecture |
| **Leverage Static Assets** (free, unlimited) | ✅ Implemented | Audio samples served via Workers Assets |
| **Set CPU time limits** (prevent runaway bills) | ⚠️ Not set | Consider adding `cpu_ms` limit in wrangler.jsonc |
| **Stream responses** (reduce "in use" time) | ✅ Automatic | Cloudflare's Dec 2024 optimization reduces duration 70% |

**Action Item:** Add CPU limit to prevent denial-of-wallet attacks:
```jsonc
// wrangler.jsonc
{
  "limits": {
    "cpu_ms": 50  // 50ms max CPU per request
  }
}
```

### 7.2 KV Best Practices

| Practice | Keyboardia Status | Notes |
|----------|-------------------|-------|
| **Minimize write operations** ($5/million) | ⚠️ High overhead | 3-6 writes per request due to logging |
| **Batch updates when possible** | ❌ Not implemented | Each log/metric is separate write |
| **Audit and remove obsolete data** | ✅ TTL-based | 1-hour TTL on logs, sessions persist |
| **Monitor read operations** ($0.50/million) | ✅ Within limits | 10M/month included is plenty |

**Optimization Priority:** KV writes are the #1 cost driver at scale. Implement batching or sampling.

### 7.3 Durable Objects Best Practices

| Practice | Keyboardia Status | Notes |
|----------|-------------------|-------|
| **Use WebSocket Hibernation** (critical) | ✅ Implemented | Prevents $1,600+/month in duration charges |
| **Minimize active duration** | ✅ Auto-eviction | DOs go idle when no messages |
| **Use SQLite backend** (recommended) | ✅ Configured | Using `new_sqlite_classes` in migrations |
| **Clean up storage** (auto-removes empty DOs) | ✅ Automatic | State saved to KV, DO can evict cleanly |
| **Leverage 20:1 message ratio** | ✅ Natural fit | High-frequency collaboration is cheap |

**Key Insight:** The WebSocket Hibernation API is the single most important cost optimization. Without it, idle WebSockets would incur continuous duration charges.

### 7.4 General Cost Protection

| Practice | Keyboardia Status | Action |
|----------|-------------------|--------|
| **Set billing alerts** | ❌ Not configured | Add alerts at 80% of included limits |
| **Monitor via [GraphQL Analytics](https://developers.cloudflare.com/analytics/graphql-api/)** | ⚠️ Manual only | Consider automated daily reports |
| **Use dashboard to track usage** | ✅ Available | Check Workers Analytics weekly |

---

## 8. Monitoring & Alerting

### 8.1 Key Metrics to Track

**In Cloudflare Dashboard:**

1. **Workers Analytics**
   - Requests per day
   - CPU time per request
   - Error rate

2. **KV Analytics**
   - Read operations (watch for 10M/month limit)
   - Write operations (watch for 1M/month limit)
   - Storage usage (1 GB limit)

3. **Durable Objects Analytics**
   - Request count
   - Duration (GB-seconds)
   - Active objects count

**Via Observability 2.0 (Workers Logs):**

1. **`wrangler tail`** (real-time streaming)
   - HTTP request events with session actions
   - WebSocket session events with message counts
   - Error tracking with context

2. **Cloudflare Dashboard** (Workers Logs)
   - Filter by event type, session ID, action
   - Aggregate metrics over time periods

3. **Debug Endpoints** (`/api/debug/session/:id/*`)
   - Connection status
   - WebSocket message volume
   - State sync health

### 8.2 Recommended Alerts

**Set up billing alerts for:**

1. **KV Writes > 800K/month**
   - 80% of free tier
   - Action: Investigate logging overhead

2. **DO Duration > 320K GB-seconds/month**
   - 80% of free tier
   - Action: Verify WebSocket Hibernation is working

3. **Unexpected cost spike > $10/month**
   - Action: Check for runaway DOs or logging loops

**Implementation:**
- Use Cloudflare Workers Analytics + Logpush
- Set up email/Slack alerts via Cloudflare API
- Monitor daily, review weekly

### 8.3 Dashboard Queries

**Check KV Usage:**
```bash
# List KV keys
wrangler kv key list --binding=SESSIONS

# Count keys by type
wrangler kv key list --binding=SESSIONS | jq '[.[] | .name | split(":")[0]] | group_by(.) | map({type: .[0], count: length})'
```

**Check Metrics (Observability 2.0):**
```bash
# Real-time log streaming
wrangler tail --format=json

# Filter for specific event types
wrangler tail --format=json | jq 'select(.event == "http_request")'

# Debug specific session
curl https://keyboardia.adewale-883.workers.dev/api/debug/session/{id}
```

**Check Active Sessions:**
```bash
# List all session IDs
wrangler kv key list --binding=SESSIONS | jq -r '.[] | select(.name | startswith("session:")) | .name | sub("session:"; "")'

# Debug specific session
curl https://keyboardia.adewale-883.workers.dev/api/debug/session/{id}
```

---

## 9. Conclusion

### 9.1 Current State

Keyboardia's operational costs are **$5.00/month** (Cloudflare Workers paid plan minimum). This covers:
- Unlimited requests (within generous limits)
- 1 GB KV storage
- 1M KV writes/month
- 10M KV reads/month
- 1M Durable Objects requests/month
- 400K GB-seconds DO duration/month

**Current usage is <1% of available capacity across all services.**

### 9.2 Cost Scaling

| Daily Sessions | Monthly Cost | Cost per Session |
|----------------|--------------|------------------|
| 100 | $5.00 | $0.017 |
| 1,000 | $5.00 | $0.0017 |
| 10,000 | $9.14 | $0.0003 |
| 100,000 | ~$80 | $0.00027 |

**Key Insight:** Cloudflare's pricing model means marginal cost per session **decreases** as scale increases.

### 9.3 Architecture Validation

**The architecture is extremely cost-efficient:**

1. **Workers:** Serverless, pay-per-request, CPU-time billing
2. **KV:** Perfect for session persistence, generous free tier
3. **Durable Objects + Hibernation:** Real-time multiplayer for pennies
4. **R2 (unused):** Available if needed for recordings/exports

**Cost protection mechanisms:**
- 30-day TTL on sessions (auto-cleanup)
- 1-hour TTL on logs (prevents accumulation)
- WebSocket Hibernation (zero cost when idle)
- 20:1 message ratio (bulk messages are cheap)

### 9.4 Operational Readiness

**For public launch at 1,000 sessions/day:**
- Current architecture is ready
- No cost concerns
- Monitoring in place
- Debug endpoints functional

**For growth to 10,000 sessions/day:**
- Optimize logging (reduce writes by 50%)
- Set up billing alerts
- Monitor WebSocket Hibernation effectiveness
- Expected cost: <$10/month

**For enterprise scale (100,000 sessions/day):**
- Consider D1 database for session storage
- Implement request sampling for logs
- Potential cost: $50-80/month (still remarkably affordable)

---

## 10. Periodic Analysis Guide

This document is designed to be re-run periodically. Here's how to update it efficiently.

### 10.1 When to Re-run

| Trigger | Recommended Action |
|---------|-------------------|
| Monthly (routine) | Update Section 1 metrics, spot-check costs |
| After launch milestone | Full refresh of all sections |
| Cost spike detected | Investigate Section 4 cost drivers |
| New feature deployed | Review Section 7 best practices compliance |
| Quarterly review | Full document refresh + trend analysis |

### 10.2 Quick Refresh Commands

```bash
# 1. Stream real-time metrics (Observability 2.0)
wrangler tail --format=json

# 2. Count KV keys by type
wrangler kv key list --binding=SESSIONS | jq '[.[] | .name | split(":")[0]] | group_by(.) | map({type: .[0], count: length})'

# 3. Check for active sessions
wrangler kv key list --binding=SESSIONS | jq '[.[] | select(.name | startswith("session:"))] | length'

# 4. Debug a specific session
curl -s https://keyboardia.adewale-883.workers.dev/api/debug/session/{session-id} | jq .
```

### 10.3 Data Collection Template

When refreshing this document, collect and update these values:

```
Analysis Date: ____________

CURRENT STATE:
- Total sessions (lifetime): ____________
- Sessions in KV: ____________
- Active WebSocket connections: ____________

MONTHLY USAGE (estimate):
- Sessions created/month: ____________
- Session loads/month: ____________
- Multiplayer sessions/month: ____________

COSTS:
- Base plan: $5.00
- KV overage: $____________
- DO overage: $____________
- TOTAL: $____________

HEALTH CHECK:
[ ] WebSocket Hibernation working (check DO duration)
[ ] Session cleanup working (compare lifetime vs active)
[ ] No unexpected cost spikes
[ ] Logging not exceeding limits
```

### 10.4 Trend Tracking

Add a row each time you refresh this analysis:

| Date | Sessions (lifetime) | Sessions (active) | Monthly Cost | Notes |
|------|---------------------|-------------------|--------------|-------|
| 2025-12-11 | 32 | 1 | $5.00 | Initial analysis, pre-launch |
| | | | | |
| | | | | |

### 10.5 Automation Opportunities

For future automation, consider:

1. **Scheduled Worker** — Run daily metrics collection, store in KV
2. **[GraphQL Analytics API](https://developers.cloudflare.com/analytics/graphql-api/)** — Query Cloudflare directly for billing data
3. **Slack/Discord alerts** — Notify when approaching limits
4. **Dashboard** — Build internal observability page with these metrics

**Example: Daily metrics collector**
```typescript
// Could be added as a Cron Trigger
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    const today = new Date().toISOString().split('T')[0];
    const metrics = await collectMetrics(env);
    await env.SESSIONS.put(`analysis:${today}`, JSON.stringify(metrics));
  }
};
```

---

## 11. References

### 11.1 Production Endpoints

- Production URL: https://keyboardia.adewale-883.workers.dev
- Session Debug: `/api/debug/session/:id`
- Clock Sync Debug: `/api/debug/session/:id/clock`
- State Sync Debug: `/api/debug/session/:id/state-sync`
- Durable Object Debug: `/api/debug/durable-object/:id`

**Note:** Metrics are now derived from Workers Logs via Observability 2.0.
Use `wrangler tail` for real-time monitoring.

### 11.2 Cloudflare Documentation

**Pricing:**
- [Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers KV Pricing](https://developers.cloudflare.com/kv/platform/pricing/)
- [Durable Objects Pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

**Best Practices:**
- [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Storage Options Guide](https://developers.cloudflare.com/workers/platform/storage-options/)

**Blog Posts:**
- [New Workers Pricing - Never Pay to Wait on I/O](https://blog.cloudflare.com/workers-pricing-scale-to-zero/)
- [A Workers Optimization That Reduces Your Bill](https://blog.cloudflare.com/workers-optimization-reduces-your-bill/) — 70% duration reduction
- [Workers KV Free Tier](https://blog.cloudflare.com/workers-kv-free-tier/)

### 11.3 Internal Documentation

- Architecture: `/specs/ARCHITECTURE.md`
- Observability: `/specs/OBSERVABILITY.md`
- Durable Objects Cost Analysis: `/specs/research/DURABLE-OBJECTS-COSTS.md`
- Logging Implementation: `/app/src/worker/logging.ts`

---

**Document Version:** 1.3
**Last Updated:** 2026-01-17
**Next Review:** After public launch or when daily sessions exceed 1,000
**Changelog:**
- v1.3: Removed deprecated `/api/metrics` endpoint; updated to Observability 2.0 (Workers Logs wide events)
- v1.2: Simplified data source markers, removed inline emoji
- v1.1: Added Cloudflare best practices (Section 7), periodic analysis guide (Section 10), fixed SQLite billing info
