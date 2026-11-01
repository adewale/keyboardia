# Tuning Constants: Cost vs Performance Trade-offs

This document catalogs all tunable constants in Keyboardia that affect cost and performance. Use this as a reference when optimizing for different deployment scenarios.

---

## Quick Reference

| Category | Constant | Value | Cost Impact | Performance Impact |
|----------|----------|-------|-------------|-------------------|
| Debounce | `KV_SAVE_DEBOUNCE_MS` | 5000ms | Higher = fewer KV writes | Higher = more data loss risk |
| Debounce | `SAVE_DEBOUNCE_MS` | 5000ms | Higher = fewer API calls | Higher = slower persistence |
| Sync | `CLOCK_SYNC_INTERVAL_MS` | 5000ms | Higher = fewer messages | Higher = more clock drift |
| Retry | `MAX_RETRIES` | 3 | Higher = more API calls | Higher = better resilience |
| Retry | `RETRY_BASE_DELAY_MS` | 1000ms | Lower = faster retries | Lower = higher server load |
| Throttle | Cursor throttle | 50ms | Higher = fewer messages | Higher = jerkier cursors |
| Limits | `MAX_PLAYERS` | 10 | Higher = more DO memory | Higher = more collaboration |
| TTL | `LOG_TTL_SECONDS` | 3600s | Higher = more KV storage | Higher = better debugging |

---

## 1. Debounce Intervals

### KV Save Debounce (Server-side)

**Files:** `src/worker/live-session.ts` (note: `KV_SAVE_DEBOUNCE_MS` was removed; KV writes now flush on last-player disconnect via `flushPendingKVSave()`)

```typescript
const KV_SAVE_DEBOUNCE_MS = 5000; // 5 seconds
```

**Trade-off:**
- **Lower value (e.g., 2000ms):** More frequent KV writes, less data loss on crash, higher KV costs
- **Higher value (e.g., 10000ms):** Fewer KV writes, more data loss risk, lower KV costs

**Cost context:** Cloudflare KV free tier has 1,000 writes/day. At 5s debounce with continuous editing, a single session could use ~720 writes/hour. At 2s debounce, that jumps to ~1,800 writes/hour.

**Changed:** 2025-12-10 (2000ms → 5000ms) to reduce KV quota exhaustion

---

### Client Save Debounce

**File:** `src/sync/session.ts` (`SAVE_DEBOUNCE_MS`)

```typescript
const SAVE_DEBOUNCE_MS = 5000; // 5 seconds
```

**Trade-off:**
- **Lower value:** More responsive saves, higher API traffic
- **Higher value:** Batches more changes together, lower API traffic

**Note:** Should match server-side debounce to avoid redundant saves.

---

## 2. Network & Sync Timing

### Clock Synchronization

**File:** `src/sync/multiplayer.ts` (`CLOCK_SYNC_SAMPLES`, `CLOCK_SYNC_INTERVAL_MS`)

```typescript
const CLOCK_SYNC_SAMPLES = 5;        // samples before calculating offset
const CLOCK_SYNC_INTERVAL_MS = 5000; // 5 seconds between sync requests
```

**Trade-off:**
- **Lower interval:** More accurate clock sync, more WebSocket messages
- **Higher interval:** Less traffic, potential drift between clients

**Note:** Clock sync does NOT write to KV - it's purely in-memory WebSocket messages.

---

### Reconnection Backoff

**File:** `src/utils/retry.ts` (`DEFAULT_CONFIG`) and `src/sync/multiplayer.ts` (`MAX_RECONNECT_ATTEMPTS`)

```typescript
const RECONNECT_BASE_DELAY_MS = 1000;  // Starting delay
const RECONNECT_MAX_DELAY_MS = 30000;  // Cap at 30 seconds
const RECONNECT_JITTER = 0.25;         // ±25% randomization
const MAX_RECONNECT_ATTEMPTS = 10;     // Before falling back to offline
```

**Trade-off:**
- **Lower delays/more attempts:** Faster recovery, higher server load during outages
- **Higher delays/fewer attempts:** Graceful degradation, slower recovery

---

## 3. Request Timeouts

**File:** `src/sync/session.ts` (`DEFAULT_TIMEOUT_MS`, `SAVE_TIMEOUT_MS`)

```typescript
const DEFAULT_TIMEOUT_MS = 10000; // 10 seconds for most operations
const SAVE_TIMEOUT_MS = 15000;    // 15 seconds for saves (larger payloads)
```

**Trade-off:**
- **Lower timeouts:** Faster failure detection, more false timeouts on slow networks
- **Higher timeouts:** Better tolerance for slow networks, slower error feedback

---

## 3.5 HTTP API Retry (Phase 14)

**File:** `src/sync/session.ts` (`RETRY_BASE_DELAY_MS`, `RETRY_MAX_DELAY_MS`, `RETRY_JITTER`, `MAX_RETRIES`, `RETRYABLE_STATUS_CODES`)

```typescript
const RETRY_BASE_DELAY_MS = 1000;   // Starting delay: 1 second
const RETRY_MAX_DELAY_MS = 30000;   // Cap at 30 seconds
const RETRY_JITTER = 0.25;          // ±25% jitter
const MAX_RETRIES = 3;              // Max retry attempts for transient errors
const RETRYABLE_STATUS_CODES = [408, 429, 500, 502, 503, 504];
```

**Trade-off:**
- **More retries:** Better resilience to transient failures, more API calls during outages
- **Fewer retries:** Faster failure feedback, less load on struggling servers
- **Lower base delay:** Faster recovery, risk of overwhelming recovering servers
- **Higher base delay:** More graceful backoff, slower recovery

**Behavior:**
- Exponential backoff: 1s → 2s → 4s → 8s (capped at 30s)
- Jitter (±25%) prevents "thundering herd" when server recovers
- Respects `Retry-After` header from server (e.g., quota errors)
- Quota errors (503 with Retry-After > 5 min) are NOT retried

**Retryable scenarios:**
| Status | Meaning | Retry? |
|--------|---------|--------|
| 408 | Request Timeout | Yes |
| 429 | Too Many Requests | Yes (with Retry-After) |
| 500 | Internal Server Error | Yes |
| 502 | Bad Gateway | Yes |
| 503 | Service Unavailable | Yes (unless quota error) |
| 504 | Gateway Timeout | Yes |
| Network error | Fetch failed | Yes |
| AbortError | Timeout | Yes |

**Added:** 2025-12-10 to improve resilience to transient failures

---

## 4. Throttle Intervals

### Cursor Position Updates

**File:** `src/hooks/useMultiplayer.ts` (`throttledSendCursor` / `lastCursorSendRef`, inline 50ms throttle)

```typescript
if (now - lastCursorSendRef.current < 50) return; // 50ms throttle
```

**Trade-off:**
- **Lower value (e.g., 16ms):** Smooth 60fps cursor updates, high message volume
- **Higher value (e.g., 100ms):** Jerkier cursors, lower bandwidth usage

**Note:** At 50ms, cursor updates generate ~20 messages/second per active user.

---

## 5. Queue & Buffer Limits

### Offline Message Queue

**File:** `src/sync/MessageQueue.ts` (`MessageQueue` constructor defaults: `maxSize`, `maxAge`)

```typescript
maxQueueSize: number = 100;    // Maximum queued messages
maxQueueAge: number = 30000;   // 30 seconds max age
```

**Trade-off:**
- **Larger queue:** More offline resilience, higher memory usage
- **Smaller queue:** Less memory, may drop changes during disconnection

---

## 6. Resource Limits

### Session Capacity

**File:** `src/shared/constants.ts` (`MAX_TRACKS`, `MAX_STEPS`; re-exported via `src/worker/invariants.ts`)

```typescript
export const MAX_TRACKS = 16;
export const MAX_STEPS = 128;
```

**Trade-off:**
- **Higher limits:** More creative freedom, larger session payloads
- **Lower limits:** Smaller payloads, faster sync

---

### Concurrent Players

**File:** `src/worker/live-session.ts` (`MAX_PLAYERS`)

```typescript
const MAX_PLAYERS = 10;
```

**Trade-off:**
- **Higher limit:** More collaboration, higher DO memory usage
- **Lower limit:** Less memory per DO, limited collaboration

**Cost context:** Each player maintains WebSocket state in DO memory. DOs are billed by duration × memory.

---

### Message Size

**File:** `src/shared/constants.ts` (`MAX_MESSAGE_SIZE`; re-exported via `src/worker/invariants.ts`)

```typescript
export const MAX_MESSAGE_SIZE = 64 * 1024; // 64KB
```

**Trade-off:**
- **Higher limit:** Can send larger state updates, higher bandwidth
- **Lower limit:** Forces smaller messages, may require chunking

---

## 7. TTL & Retention

### Request Logs

**File:** Removed (legacy logging replaced by Observability 2.0 wide events in `src/worker/observability.ts`)

```typescript
const LOG_TTL_SECONDS = 3600;         // 1 hour
const MAX_LOGS_PER_SESSION = 100;
```

### WebSocket Logs

**File:** Removed (legacy logging replaced by Observability 2.0 wide events in `src/worker/observability.ts`)

```typescript
const WS_LOG_TTL_SECONDS = 3600;      // 1 hour
const MAX_WS_LOGS_PER_SESSION = 500;
```

### Metrics Retention

**File:** Removed (legacy logging replaced by Observability 2.0 wide events in `src/worker/observability.ts`)

```typescript
// These constants were removed when logging was replaced by Observability 2.0.
// Request metrics window: 10 minutes
// Daily metrics: 7 days
// WebSocket metrics: 24 hours
```

**Trade-off:**
- **Longer TTL:** Better debugging capability, higher KV storage costs
- **Shorter TTL:** Lower storage costs, less historical data

---

## 8. Session Lifecycle

### Orphan Detection

**File:** `src/hooks/useSession.ts` (`ORPHAN_THRESHOLD_MS`)

```typescript
const ORPHAN_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
```

**Trade-off:**
- **Longer threshold:** Sessions persist longer, higher storage usage
- **Shorter threshold:** Faster cleanup, risk of deleting active sessions

---

## Cost Optimization Profiles

### Free Tier Optimized (Current)
- KV debounce: 5000ms
- HTTP retries: 3 (with exponential backoff)
- Logging: Minimal retention
- Max players: 10

### Performance Optimized
- KV debounce: 2000ms
- HTTP retries: 5 (more resilient)
- Cursor throttle: 16ms (60fps)
- Clock sync: 2000ms

### High-Scale
- KV debounce: 10000ms
- HTTP retries: 2 (fail fast)
- Max players: 5
- Queue size: 50
- Logging disabled

---

## Cloudflare Pricing Context

| Resource | Free Tier | Paid Tier |
|----------|-----------|-----------|
| KV Reads | 100,000/day | $0.50/million |
| KV Writes | 1,000/day | $5.00/million |
| KV Storage | 1GB | $0.50/GB-month |
| DO Requests | 1M included | $0.15/million |
| DO Duration | 400K GB-s | $12.50/million GB-s |

The 5-second debounce was specifically chosen to stay within free tier KV write limits during normal usage patterns.
