# Test Suite Audit Report

**Date:** 2025-12-17
**Context:** Analysis following two critical production bugs:
1. WebSocket connection storm (caused by unstable React callback references)
2. State hash mismatch (caused by serialization boundary differences between client/server)

Both bugs escaped detection because existing tests used mocks instead of real infrastructure.

---

## Executive Summary

The Keyboardia test suite has **47 test files** organized into:
- **6 E2E tests** (Playwright) - Test real browser/API behavior
- **1 Integration test** (Cloudflare vitest-pool-workers) - Tests real Durable Objects
- **40 Unit tests** - Test isolated logic with mocks

**Critical Finding:** The WebSocket and state synchronization paths have extensive *unit test* coverage for logic, but lack *integration tests* that exercise real infrastructure. This pattern allowed both production bugs to escape detection.

---

## Test File Categorization

### E2E Tests (Real Browser + Real API)

| File | Description | Status |
|------|-------------|--------|
| `/e2e/multiplayer.spec.ts` | Real-time sync between browser contexts | **Good** - Uses real WebSocket |
| `/e2e/session-persistence.spec.ts` | Session create/load/update cycle | **Good** - Uses real API |
| `/e2e/playback.spec.ts` | Playhead stability during playback | **Good** - Tests real UI |
| `/e2e/last-cell-flicker.spec.ts` | UI flicker prevention | Skipped (flaky) |
| `/e2e/scrollbar.spec.ts` | Scrollbar behavior | UI test |
| `/e2e/plock-editor.spec.ts` | Parameter lock editor | UI test |

### Integration Tests (Real Cloudflare Infrastructure)

| File | Description | Status |
|------|-------------|--------|
| `/test/integration/live-session.test.ts` | LiveSessionDurableObject + Router | **Good** - Uses real DO, KV |

### Unit Tests - Multiplayer/WebSocket Related

| File | Current Type | Assessment |
|------|--------------|------------|
| `/src/hooks/useMultiplayer.test.ts` | Unit (mocked) | Tests callback stability pattern, NOT real WebSocket |
| `/src/hooks/useStableCallback.test.ts` | Unit (pure) | Tests utility hook - **Appropriate as unit test** |
| `/src/hooks/callback-stability.test.ts` | Unit (pure) | Pattern documentation - **Appropriate as unit test** |
| `/src/sync/multiplayer.test.ts` | Unit (mocked) | 1400+ lines testing mocked reconnection, state machine |
| `/src/sync/canonicalHash.test.ts` | Unit (pure) | Tests hash function - **Appropriate as unit test** |
| `/src/hooks/useSession.test.ts` | Unit (mocked) | Tests race condition logic, not real save/load |

### Unit Tests - Worker/Durable Object Related

| File | Current Type | Assessment |
|------|--------------|------------|
| `/src/worker/mock-durable-object.test.ts` | Unit (mock) | Tests MOCK DO, not real implementation |
| `/src/worker/types.test.ts` | Unit (type check) | Compile-time parity check - **Appropriate** |
| `/src/worker/logging.test.ts` | Unit | Tests logging utilities |
| `/test/unit/mutation-types.test.ts` | Unit | Tests type classification - **Appropriate** |

### Unit Tests - State/Reducer Related

| File | Current Type | Assessment |
|------|--------------|------------|
| `/src/state/grid.test.ts` | Unit (pure) | Tests reducer logic - **Appropriate as unit test** |
| `/src/state/grid-effects.test.ts` | Unit (pure) | Tests grid effects |

### Unit Tests - Audio Related (23 files)

All audio tests are appropriately unit tests with mocked AudioContext since Web Audio API testing is inherently difficult. Examples:
- `/src/audio/scheduler.test.ts` - Pure timing math
- `/src/audio/sampled-instrument-integration.test.ts` - Mocked fetch/AudioContext
- `/src/audio/toneSynths.test.ts`, `/src/audio/toneEffects.test.ts` - Synth logic

### Unit Tests - Component Related

| File | Current Type | Assessment |
|------|--------------|------------|
| `/src/components/EffectsPanel.test.tsx` | Unit | Component test |
| `/src/components/SamplePicker.test.ts` | Unit | Component logic |
| `/src/components/TrackRow.test.ts` | Unit | Component logic |
| `/src/components/sample-constants.test.ts` | Unit | Constants validation |

---

## Critical Gap Analysis

### Gap 1: WebSocket Connection Lifecycle (HIGH PRIORITY)

**Current Coverage:**
- E2E `multiplayer.spec.ts` tests real WebSocket at high level
- Unit `useMultiplayer.test.ts` tests callback stability pattern with mocks
- Unit `multiplayer.test.ts` tests reconnection logic with mocks

**Missing:**
- No test verifies that **React callback reference changes don't cause reconnections**
- No test exercises the **actual useMultiplayer hook** with a real (or realistic) WebSocket
- The connection storm bug would have been caught by a test that:
  1. Mounts the real useMultiplayer hook
  2. Triggers state changes that update `getStateForHash`
  3. Verifies WebSocket disconnect/reconnect count stays at 0

**Recommendation:** Convert `/src/hooks/useMultiplayer.test.ts` to use a mock WebSocket server (e.g., `ws` library in Node) that counts actual connection attempts.

### Gap 2: State Hash Client/Server Parity (HIGH PRIORITY)

**Current Coverage:**
- Unit `canonicalHash.test.ts` tests hash function locally
- Unit `types.test.ts` tests that client/server use same fields (compile-time)
- Unit `types.test.ts` imports both `canonicalizeForHash` functions and compares output

**Missing:**
- No **end-to-end test** verifies hash match after real network round-trip
- The hash mismatch bug was caused by **serialization boundary differences** that only manifest when:
  1. Client has track with `soloed: false` (explicit)
  2. Server loads from KV with `soloed: undefined` (optional field)
  3. `JSON.stringify` produces different output

**Recommendation:** Add integration test that:
1. Creates session via API with specific state
2. Loads in client, modifies state
3. Triggers state_hash message
4. Verifies server response matches client's computed hash

### Gap 3: Mock Durable Object vs Real Durable Object (MEDIUM)

**Current Coverage:**
- `/src/worker/mock-durable-object.test.ts` - 800+ lines testing mock DO behavior
- `/test/integration/live-session.test.ts` - Tests real DO via HTTP

**Missing:**
- No test verifies that `MockLiveSession` behavior matches `LiveSessionDurableObject`
- If mock and real implementation diverge, client tests pass but production breaks

**Recommendation:** Add contract tests that run the same scenarios against both mock and real DO, comparing outputs.

### Gap 4: Session Loading Race Condition (MEDIUM)

**Current Coverage:**
- Unit `useSession.test.ts` tests the `skipNextSaveRef` logic with mocked functions

**Missing:**
- No integration test exercises the actual race condition scenario with real timing
- Race conditions are timing-dependent; mocked tests can't catch all cases

**Recommendation:** Add E2E test that creates a session with data, loads it, and verifies the data isn't overwritten by auto-save.

---

## Tests That Should Be Integration Tests

### 1. `/src/sync/multiplayer.test.ts`

**What it tests (with mocks):**
- Exponential backoff with jitter (lines 19-100)
- Offline queue behavior (lines 103-179)
- Connection status tracking (lines 181-207)
- Clock synchronization algorithm (lines 255-378)
- State hash comparison (lines 384-491)
- Message serialization (lines 497-758)
- Connection state machine (lines 764-986)
- Advanced offline queue (lines 992-1139)
- Message validation (lines 1145-1300)

**What SHOULD be integration tests:**
- Connection state machine should use real WebSocket
- Offline queue replay should test real message delivery
- State hash should verify client/server match

### 2. `/src/hooks/useMultiplayer.test.ts`

**What it tests (with mocks):**
- Callback stability pattern (simulates useEffect behavior)

**What SHOULD be integration tests:**
- Should mount real hook with mock WebSocket server
- Should verify connection count under real React lifecycle

### 3. `/src/worker/mock-durable-object.test.ts`

**What it tests:**
- Mock implementation behavior (connect, message handling, state sync)

**What SHOULD be integration tests:**
- Contract tests ensuring mock matches real DO
- Scenarios should run against real DO for verification

---

## Specific Tests to Add

### High Priority

1. **WebSocket Callback Stability Integration Test**
   ```
   Location: /test/integration/websocket-stability.test.ts
   Purpose: Verify getStateForHash changes don't cause reconnections
   Approach: Use MSW or ws library to mock WebSocket server, count connections
   ```

2. **State Hash Round-Trip Test**
   ```
   Location: /test/integration/state-hash-parity.test.ts
   Purpose: Verify client and server hash match after real API calls
   Approach: Create session, load in test, trigger hash comparison
   ```

3. **E2E Connection Storm Prevention**
   ```
   Location: /e2e/connection-storm.spec.ts
   Purpose: Verify rapid state changes don't cause reconnections
   Approach: Use Playwright, modify state rapidly, check DevTools network tab
   ```

### Medium Priority

4. **Mock/Real DO Contract Tests**
   ```
   Location: /test/contract/durable-object.test.ts
   Purpose: Verify MockLiveSession matches LiveSessionDurableObject
   Approach: Run same scenarios, compare message outputs
   ```

5. **Session Race Condition E2E Test**
   ```
   Location: /e2e/session-race.spec.ts
   Purpose: Verify loaded sessions aren't overwritten
   Approach: Create session with data, load in browser, verify data persists
   ```

### Low Priority

6. **Reconnection E2E Test**
   ```
   Location: /e2e/reconnection.spec.ts
   Purpose: Verify reconnection after network disruption
   Approach: Use Playwright's setOffline, verify state sync after reconnect
   ```
   Note: `/e2e/multiplayer.spec.ts` already has a basic version of this.

---

## Summary of Mocking Patterns

### Appropriate Mocks (Keep as Unit Tests)

| Pattern | Example | Reason |
|---------|---------|--------|
| AudioContext | `/src/audio/*.test.ts` | Web Audio API can't run in Node |
| Pure functions | `/src/sync/canonicalHash.test.ts` | No external dependencies |
| React hooks (logic only) | `/src/hooks/useStableCallback.test.ts` | Testing pattern, not integration |
| Type checks | `/src/worker/types.test.ts` | Compile-time verification |

### Inappropriate Mocks (Convert to Integration Tests)

| Pattern | Example | Problem |
|---------|---------|---------|
| Mock WebSocket connection | `/src/sync/multiplayer.test.ts` | Doesn't catch real timing issues |
| Mock Durable Object | `/src/worker/mock-durable-object.test.ts` | Mock may diverge from real |
| Mock save/load | `/src/hooks/useSession.test.ts` | Race conditions are timing-dependent |

---

## Action Items

1. **[HIGH]** Create integration test for WebSocket callback stability
2. **[HIGH]** Create integration test for state hash client/server parity
3. **[MEDIUM]** Add contract tests for Mock DO vs Real DO
4. **[MEDIUM]** Add E2E test for session loading race condition
5. **[LOW]** Document which mocks are intentional vs technical debt
6. **[LOW]** Consider using MSW (Mock Service Worker) for more realistic API mocking

---

## Appendix: Complete Test File List

### E2E Tests (6 files)
- `/e2e/multiplayer.spec.ts`
- `/e2e/session-persistence.spec.ts`
- `/e2e/playback.spec.ts`
- `/e2e/last-cell-flicker.spec.ts`
- `/e2e/scrollbar.spec.ts`
- `/e2e/plock-editor.spec.ts`

### Integration Tests (1 file)
- `/test/integration/live-session.test.ts`

### Unit Tests - Hooks (4 files)
- `/src/hooks/useMultiplayer.test.ts`
- `/src/hooks/useStableCallback.test.ts`
- `/src/hooks/callback-stability.test.ts`
- `/src/hooks/useSession.test.ts`

### Unit Tests - Sync (2 files)
- `/src/sync/multiplayer.test.ts`
- `/src/sync/canonicalHash.test.ts`

### Unit Tests - Worker (3 files)
- `/src/worker/types.test.ts`
- `/src/worker/logging.test.ts`
- `/src/worker/mock-durable-object.test.ts`

### Unit Tests - State (2 files)
- `/src/state/grid.test.ts`
- `/src/state/grid-effects.test.ts`

### Unit Tests - Components (4 files)
- `/src/components/EffectsPanel.test.tsx`
- `/src/components/SamplePicker.test.ts`
- `/src/components/TrackRow.test.ts`
- `/src/components/sample-constants.test.ts`

### Unit Tests - Audio (23 files)
- `/src/audio/lazyAudioLoader.test.ts`
- `/src/audio/scheduler-synths.test.ts`
- `/src/audio/audio-engineering.test.ts`
- `/src/audio/scheduler.test.ts`
- `/src/audio/engine-sampled.test.ts`
- `/src/audio/audio-context-safety.test.ts`
- `/src/audio/lru-sample-cache.test.ts`
- `/src/audio/sampled-instrument.test.ts`
- `/src/audio/toneEffects.test.ts`
- `/src/audio/synth-sessions.test.ts`
- `/src/audio/volume-verification.test.ts`
- `/src/audio/samples.test.ts`
- `/src/audio/toneSynths.test.ts`
- `/src/audio/playback-state-debug.test.ts`
- `/src/audio/note-player.test.ts`
- `/src/audio/constants.test.ts`
- `/src/audio/instrument-routing.test.ts`
- `/src/audio/instrument-types.test.ts`
- `/src/audio/audioTriggers.test.ts`
- `/src/audio/xyPad.test.ts`
- `/src/audio/advancedSynth.test.ts`
- `/src/audio/synth.test.ts`
- `/src/audio/sampled-instrument-integration.test.ts`

### Other Unit Tests (2 files)
- `/test/unit/mutation-types.test.ts`
- `/test/unit/useLongPress.test.ts`
