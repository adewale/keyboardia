# Hybrid Persistence: Code Removal Audit

This document identifies functionality that can be REMOVED or SIMPLIFIED now that we're implementing the hybrid persistence strategy (DO Storage per-mutation + KV on-disconnect).

---

## Summary by Impact

### Quick Wins (Easy Removals)
| Item | File | Lines | Risk |
|------|------|-------|------|
| KV_SAVE_DEBOUNCE_MS constant | live-session.ts | 99 | Low |
| setAlarm() call | live-session.ts | 1333 | Low |
| alarm() method | live-session.ts | 1348-1379 | Low |
| deleteAlarm() call | live-session.ts | 534 | Low |
| THEORY-1-INVARIANT log | live-session.ts | 238-240 | Low |
| Debounce comments | live-session.ts | Various | Low |

### Medium Complexity
| Item | File | Lines | Notes |
|------|------|-------|-------|
| scheduleKVSave() method | live-session.ts | 1312-1336 | Replace 10 calls with DO writes |
| flushPendingKVSave() | live-session.ts | 521-540 | Simplify (remove debounce checks) |
| pendingKVSave persistence | live-session.ts | 1318, 1350, 1377 | Remove hibernation logic |
| THEORY-2-INVARIANT logs | multiplayer.ts | 1462-1470, 2007-2015 | Reframe as network protection |

### Tests to Rewrite
| File | Notes |
|------|-------|
| kv-staleness.test.ts | Repurpose to test "flush on disconnect" |
| mock-durable-object.test.ts | Update debounce test cases |

---

## 1. KV DEBOUNCE TIMER & SCHEDULING

### 1.1 KV_SAVE_DEBOUNCE_MS Constant
- **File:** `src/worker/live-session.ts:99`
- **Code:** `const KV_SAVE_DEBOUNCE_MS = 5000;`
- **Action:** REMOVE
- **Also:** Remove from `mock-durable-object.ts:51`

### 1.2 scheduleKVSave() Method
- **File:** `src/worker/live-session.ts:1312-1336`
- **Action:** REMOVE entire method
- **Replace with:** Direct `ctx.storage.put()` calls in each mutation handler

### 1.3 scheduleKVSave() Calls (10 total)
- **File:** `src/worker/live-session.ts`
- **Lines:** 632, 749, 787, 814, 850, 878, 918, 1025, 1086, 1127
- **Action:** Replace each with `await this.ctx.storage.put('sessionState', { state: this.state, updatedAt: Date.now() });`

### 1.4 alarm() Method
- **File:** `src/worker/live-session.ts:1348-1379`
- **Action:** REMOVE entire method
- **Reason:** Alarm system no longer needed

### 1.5 pendingKVSave Flag Persistence
- **File:** `src/worker/live-session.ts`
- **Lines:** 1318, 1350, 1377
- **Action:** REMOVE all persistence logic for this flag

---

## 2. PENDINQKVSAVE TRACKING

### 2.1 pendingKVSave Class Variable
- **File:** `src/worker/live-session.ts:115-117`
- **Action:** SIMPLIFY - keep only as derived field for debug info
- **New role:** "has unflushed state" (informational, not data safety)

### 2.2 Mock Implementation Updates
- **File:** `src/worker/mock-durable-object.ts`
- **Lines:** 72, 827, 839, 877, 902
- **Action:** Update mock to match new behavior

---

## 3. THEORY INVARIANT LOGGING

### 3.1 THEORY-1-INVARIANT Log
- **File:** `src/worker/live-session.ts:238-240`
- **Action:** REMOVE or replace with simpler message
- **Reason:** Theory 1 scenario impossible with immediate DO writes

### 3.2 THEORY-2-INVARIANT Logs
- **File:** `src/sync/multiplayer.ts:1462-1470, 2007-2015`
- **Action:** REMOVE "may be stale" framing
- **Keep:** Timestamp tracking for network reordering protection

---

## 4. KEEP BUT SIMPLIFY

### 4.1 lastAppliedSnapshotTimestamp
- **File:** `src/sync/multiplayer.ts:426, 1451-1475`
- **Action:** Keep comparison logic, remove staleness narrative
- **New role:** Network reordering protection only

### 4.2 checkSnapshotRegression
- **File:** `src/sync/multiplayer.ts:901-958`
- **Action:** KEEP entirely
- **Reason:** Detects real sync bugs, not debounce issues

### 4.3 Recovery Request Debounce
- **File:** `src/sync/multiplayer.ts:110, 817-832`
- **Action:** KEEP (network optimization, unrelated to persistence)

### 4.4 Client-side Session Debounce
- **File:** `src/sync/session.ts:51, 305-317`
- **Action:** KEEP (solo sessions, separate concern)

---

## 5. KV FLUSH ON DISCONNECT

### 5.1 flushPendingKVSave() Method
- **File:** `src/worker/live-session.ts:521-540`
- **Action:** SIMPLIFY
- **Changes:**
  - Remove `if (!this.pendingKVSave)` check (always write)
  - Remove `deleteAlarm()` call
  - Simplify to: call `saveToKV()` directly

### 5.2 Call Sites
- **File:** `src/worker/live-session.ts:512, 570`
- **Action:** KEEP (correct placement, logic simplifies)

---

## 6. DEBUG ENDPOINT

### 6.1 pendingKVSave in Debug Response
- **File:** `src/worker/live-session.ts:1449`
- **Action:** KEEP but update semantics
- **New meaning:** "unflushed to KV" (informational, not critical)
- **Consider:** Rename to `pendingKVFlush` for clarity

---

## 7. TESTS TO UPDATE

### 7.1 kv-staleness.test.ts (Entire File)
- **File:** `test/staging/kv-staleness.test.ts`
- **Action:** REPURPOSE
- **Obsolete tests:**
  - "KV state lags behind DO state" (line 210)
  - "Reconnect receives stale KV data" (line 256)
  - "Rapid operations during debounce" (line 300)
- **New tests:** "KV matches DO after disconnect"

### 7.2 mock-durable-object.test.ts
- **File:** `src/worker/mock-durable-object.test.ts`
- **Obsolete tests:**
  - Line 900: "KV should not have been saved yet (debounce)"
  - Line 911: "should debounce multiple rapid changes"
  - Line 996: "should lose pending save if DO hibernates"
  - Line 1011: "Advance time past debounce"
  - Line 1057: "schedules a debounced save"

---

## Implementation Order

1. **Phase 1:** Add immediate DO storage writes (keep scheduleKVSave temporarily)
2. **Phase 2:** Update flushPendingKVSave for new architecture
3. **Phase 3:** Remove scheduleKVSave + alarm handler
4. **Phase 4:** Simplify pendingKVSave flag
5. **Phase 5:** Update logging (remove Theory 1 & 2)
6. **Phase 6:** Rewrite tests
7. **Phase 7:** Update documentation

---

## Files Summary

| File | Changes |
|------|---------|
| `src/worker/live-session.ts` | Major: Remove debounce, add DO writes |
| `src/worker/mock-durable-object.ts` | Update mock to match |
| `src/sync/multiplayer.ts` | Remove Theory 2 logs, simplify timestamps |
| `test/staging/kv-staleness.test.ts` | Repurpose for new behavior |
| `src/worker/mock-durable-object.test.ts` | Update debounce tests |
