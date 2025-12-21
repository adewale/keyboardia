> **STATUS: IMPLEMENTED in Phase 27**
> The hybrid approach (DO Storage per-mutation + KV write on-disconnect) is now in production.
> See `live-session.ts` for implementation.

# Cost Analysis: DO Storage vs KV Debounced Writes

## Pricing Comparison

| Operation | KV Price | DO Storage Price | DO Advantage |
|-----------|----------|------------------|--------------|
| **Writes** | $5.00/million | $1.00/million | **5x cheaper** |
| **Reads** | $0.50/million | $0.20/million | **2.5x cheaper** |
| **Storage** | $0.50/GB-month | $0.20/GB-month | **2.5x cheaper** |

### Free Tier (Monthly)
| Metric | KV | DO Storage |
|--------|-----|------------|
| Writes | 1 million | 1 million |
| Reads | 10 million | 1 million |
| Storage | 1 GB | 1 GB |

---

## Usage Model Assumptions

### Session Activity Patterns
| Pattern | Mutations/min | Typical Duration | Total Mutations |
|---------|---------------|------------------|-----------------|
| Light editing | 10 | 5 min | 50 |
| Normal editing | 30 | 10 min | 300 |
| Heavy editing | 60 | 15 min | 900 |
| Rapid jam session | 120 | 20 min | 2,400 |

### Current Architecture (KV Debounced)
- **Debounce interval:** 5 seconds
- **Max writes per minute:** 12
- **Writes per session:** ~12-60 (regardless of mutation count)

### Proposed Architecture (DO Storage per mutation)
- **Writes per mutation:** 1
- **Writes per session:** 50-2,400 (scales with mutations)

---

## Cost Modeling

### Scenario A: 1,000 Sessions/Month (Hobbyist)

**Current (KV Debounced):**
```
Avg writes per session: 30 (assuming 2.5 min active editing)
Total KV writes: 30 × 1,000 = 30,000

Cost: Within free tier (1M writes)
      = $0.00
```

**Proposed (DO Storage):**
```
Avg mutations per session: 150 (normal editing)
Total DO writes: 150 × 1,000 = 150,000

Cost: Within free tier (1M writes)
      = $0.00
```

**Delta: $0.00** ✅

---

### Scenario B: 10,000 Sessions/Month (Growing App)

**Current (KV Debounced):**
```
Total KV writes: 30 × 10,000 = 300,000

Cost: Within free tier (1M writes)
      = $0.00
```

**Proposed (DO Storage):**
```
Total DO writes: 150 × 10,000 = 1,500,000
Overage: 500,000 writes

Cost: 0.5 × $1.00 = $0.50/month
```

**Delta: +$0.50/month** ⚠️ (minor)

---

### Scenario C: 100,000 Sessions/Month (Popular App)

**Current (KV Debounced):**
```
Total KV writes: 30 × 100,000 = 3,000,000
Overage: 2,000,000 writes

Cost: 2 × $5.00 = $10.00/month
```

**Proposed (DO Storage):**
```
Total DO writes: 150 × 100,000 = 15,000,000
Overage: 14,000,000 writes

Cost: 14 × $1.00 = $14.00/month
```

**Delta: +$4.00/month** ⚠️

---

### Scenario D: 1,000,000 Sessions/Month (Viral App)

**Current (KV Debounced):**
```
Total KV writes: 30 × 1,000,000 = 30,000,000
Overage: 29,000,000 writes

Cost: 29 × $5.00 = $145.00/month
```

**Proposed (DO Storage):**
```
Total DO writes: 150 × 1,000,000 = 150,000,000
Overage: 149,000,000 writes

Cost: 149 × $1.00 = $149.00/month
```

**Delta: +$4.00/month** ⚠️

---

## Break-Even Analysis

DO storage becomes cheaper when write volume is low enough:
- KV: $5.00/million
- DO: $1.00/million

**Per-write cost ratio:** DO is 5x cheaper per write

**Break-even point:** When DO write volume < 5× KV write volume

```
Current: 30 writes/session (debounced)
Proposed: 150 writes/session (every mutation)

Ratio: 150 / 30 = 5x more writes
```

At exactly 5x more writes, costs are **equal**.

Since normal editing produces ~5x more mutations than debounced writes,
the costs are approximately the same in typical usage!

---

## Hidden Savings

### 1. KV Read Costs Eliminated for DO State

**Current flow (every API GET):**
```
GET /api/sessions/:id → reads from KV
```

**Proposed flow:**
```
GET /api/sessions/:id → still reads from KV (for now)
WebSocket connect → reads from DO storage (cheaper)
```

With 100K sessions/month, typical read pattern:
- API reads: 500K reads → 0.5 × $0.50 = $0.25 (KV)
- DO reads: 100K reads → 0.1 × $0.20 = $0.02 (DO storage)

**Potential savings:** ~$0.23/month per 100K sessions

### 2. Storage Costs

KV: $0.50/GB-month
DO: $0.20/GB-month

**60% cheaper storage**

Assuming 10KB per session, 100K sessions = 1GB
- KV: $0.50/month
- DO: $0.20/month

**Savings: $0.30/month** per GB

---

## Summary Cost Table

| Sessions/Month | Current (KV) | Proposed (DO) | Delta | % Change |
|----------------|--------------|---------------|-------|----------|
| 1,000 | $0.00 | $0.00 | $0.00 | 0% |
| 10,000 | $0.00 | $0.50 | +$0.50 | — |
| 100,000 | $10.00 | $14.00 | +$4.00 | +40% |
| 1,000,000 | $145.00 | $149.00 | +$4.00 | +3% |

---

## Conclusion

### Cost Impact: **Negligible to Minor**

1. **Free tier:** No impact (both approaches stay within limits for <10K sessions)

2. **At scale:** DO storage costs ~$4/month more regardless of scale
   - This is because the 5x write volume is offset by 5x cheaper writes
   - The small delta comes from free tier differences

3. **Hidden benefits:**
   - 60% cheaper storage
   - 60% cheaper DO reads
   - **Zero data loss** (priceless for user trust)

### Recommendation

**Proceed with DO storage.** The cost increase is:
- $0 at hobby scale
- ~$4/month at any scale
- Offset by cheaper storage and reads

The data durability benefit far outweighs the minor cost increase.

---

## DECISION: Hybrid Approach Selected

After analysis, we selected the **Hybrid Approach**:

**DO Storage per-mutation + KV write on-disconnect only**

### Why Hybrid is Better Than Naive DO + KV

```
                          WRITES PER SESSION                 COST AT 1M SESSIONS
Architecture              DO Storage    KV                   DO         KV        TOTAL
─────────────────────────────────────────────────────────────────────────────────────────
CURRENT                   0             30                   $0         $145      $145
(KV debounced 5s)

NAIVE DO + KV             150           30                   $149       $145      $294
(add DO, keep debounce)

HYBRID ✓                  150           1                    $149       $0        $149
(DO per-mutation,
 KV on-disconnect)
```

### Hybrid Cost at Scale

| Sessions/Month | Current (KV) | Hybrid | Delta |
|----------------|--------------|--------|-------|
| 1,000          | $0           | $0     | $0    |
| 10,000         | $0           | $0.50  | +$0.50 |
| 100,000        | $10          | $14    | +$4   |
| 1,000,000      | $145         | $149   | +$4   |
| 10,000,000     | $1,450       | $1,490 | +$40  |

### Key Benefits

1. **Zero data loss** - DO storage is immediately durable
2. **Minimal cost increase** - Only +$4/month at any scale
3. **KV stays fresh** - Written on disconnect for API reads
4. **Simple migration** - Legacy sessions migrate lazily

---

## Optimization Options (If Needed)

If costs become a concern at extreme scale:

1. **Batch writes:** Accumulate mutations for 100-500ms, write once
   - Reduces writes by 5-10x
   - Adds small latency to durability (still better than 5s debounce)

2. **Conditional writes:** Only write if state actually changed
   - Duplicate toggle_step = no write
   - Already partially implemented

3. **Tiered approach:** Write critical ops immediately, batch others
   - add_track, delete_track → immediate
   - toggle_step → batched (100ms)
