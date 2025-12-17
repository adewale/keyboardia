# Lessons Learned: Production-Only Bugs

This document captures critical lessons from bugs that only manifested in production, not during local development.

## Executive Summary

Two critical bugs escaped local testing and only appeared after production deployment:
1. **WebSocket Connection Storm** - Every state change caused disconnect/reconnect cycles
2. **State Hash Mismatch** - Client and server computed different hashes for identical state

Both bugs share a common root cause: **the local development environment didn't exercise the same code paths as production**.

---

## Bug 1: WebSocket Connection Storm

### The Bug
Every user interaction (clicking a step, changing tempo) caused the WebSocket to disconnect and reconnect with a new player ID. A single user session could generate hundreds of unique player IDs.

### Root Cause
```typescript
// App.tsx - BUGGY PATTERN
const getStateForHash = useCallback(() => ({
  tracks: state.tracks,
  tempo: state.tempo,
  swing: state.swing,
}), [state.tracks, state.tempo, state.swing]); // Dependencies change on every state update

// useMultiplayer.ts
useEffect(() => {
  connect(sessionId, getStateForHash);
  return () => disconnect();
}, [sessionId, getStateForHash]); // Effect re-runs when callback changes!
```

### Why It Wasn't Caught Locally

| Environment | WebSocket Connection | Bug Triggered |
|-------------|---------------------|---------------|
| `npm run dev` (Vite) | Mock API - no real WebSocket | No |
| `npx wrangler dev` | Real WebSocket | Yes, but not observed |
| Production | Real WebSocket | Yes, visible in logs |

The Vite development server uses a mock API plugin that intercepts `/api/*` requests. WebSocket upgrade requests either fail silently or return mock responses. **The buggy code path was never executed during normal development.**

### The Fix
```typescript
// App.tsx - FIXED PATTERN
const stateRef = useRef(state);
stateRef.current = state; // Always update ref

const getStateForHash = useCallback(() => ({
  tracks: stateRef.current.tracks,
  tempo: stateRef.current.tempo,
  swing: stateRef.current.swing,
}), []); // Empty deps = stable reference
```

---

## Bug 2: State Hash Mismatch

### The Bug
Client and server computed different hashes for what should be identical state, causing "state mismatch" warnings and potential sync issues.

### Root Cause
```typescript
// Client Track type
interface Track {
  id: string;
  soloed?: boolean;  // Optional - may be undefined
  stepCount?: number; // Optional - may be undefined
}

// Server SessionTrack type
interface SessionTrack {
  id: string;
  soloed: boolean;  // Required - always present
  stepCount: number; // Required - always present
}

// JSON.stringify produces different output:
// Client: {"id":"1"}  (undefined fields omitted)
// Server: {"id":"1","soloed":false,"stepCount":16}
```

### Why It Wasn't Caught Locally
- Unit tests mocked the server response, never testing real serialization
- No integration tests compared actual client/server hash computation
- The mismatch only occurred with specific field combinations

### The Fix
1. Compile-time type parity check ensures Track and SessionTrack have same fields
2. Canonical hash function with explicit field ordering
3. Normalization before hashing

---

## Systemic Issues

### 1. Environment Parity Gap

```
Local Development              Production
─────────────────              ──────────
Mock API                       Real Cloudflare Workers
No WebSockets                  Durable Objects WebSockets
Single user testing            Multiple concurrent users
Sessions last minutes          Sessions last hours
No monitoring                  (Initially) no monitoring
```

### 2. Mock-Heavy Testing Strategy
- Unit tests passed but didn't exercise real integration points
- Mocks verified interface contracts, not actual behavior
- No tests for "does the WebSocket actually stay connected?"

### 3. Missing Observability
- No connection count monitoring
- No player ID uniqueness tracking
- No alerts for anomalous behavior

---

## Recommendations Implemented

### 1. Real Backend in Development
Modified `vite.config.ts` to proxy to wrangler instead of mocking, ensuring development exercises the same code paths as production.

### 2. Connection Stability Tests
Added `scripts/monitor-connections.ts` for automated connection health monitoring:
- Tracks connection count over time
- Detects connection storms (rapid reconnections)
- Measures connection establishment latency

### 3. Runtime Storm Detection
Added warning in `multiplayer.ts` that logs when 5+ reconnections occur within 10 seconds.

### 4. Compile-Time Type Safety
Added type parity check in `types.test.ts` that fails compilation if Track and SessionTrack diverge.

### 5. Debug Overlay Enhancements
Added unique player ID count to debug overlay - if count exceeds expected, indicates storm.

### 6. ESLint Rule
Custom rule to flag callbacks as useEffect dependencies (the pattern that caused the storm).

### 7. Staging Environment
Configured `wrangler.jsonc` with staging environment that mirrors production but isolated for testing.

---

## Key Takeaways

1. **If you mock it, you don't test it.** Mocks verify interface contracts, not system behavior.

2. **Development should match production.** The further they diverge, the more bugs hide.

3. **Build observability first.** If you can't measure it, you can't detect when it breaks.

4. **Test stability, not just functionality.** "Does it work?" is different from "Does it keep working?"

5. **Enforce constraints at compile time.** Runtime bugs are harder to catch than compile errors.

---

## Checklist for Future Features

Before shipping any feature that involves:
- [ ] WebSocket connections - test with real wrangler dev, not mocks
- [ ] State synchronization - verify hash computation matches client/server
- [ ] Multiplayer features - test with multiple concurrent browsers
- [ ] Long-running sessions - monitor for resource leaks and instability
- [ ] Type boundaries - ensure types match across serialization boundaries

---

## Related Documentation

- [Bug Patterns](./bug-patterns.md) - Detailed technical patterns for these bugs
- [Test Audit](./test-audit.md) - Analysis of unit vs integration test coverage
- [Durable Objects Audit](./durable-objects-audit.md) - Comparison with Cloudflare best practices
