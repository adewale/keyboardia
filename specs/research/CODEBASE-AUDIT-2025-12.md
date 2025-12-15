# Codebase Audit - December 2025

> Comprehensive audit of the Keyboardia codebase covering code quality, potential bugs, security, performance, and test coverage.

## Executive Summary

The codebase is **well-structured overall** with strong TypeScript usage, consistent logging patterns, and reasonable test coverage. Key strengths include no `any` types, proper use of a logger utility, and comprehensive input validation. However, several issues need attention, particularly around async error handling and multiplayer state synchronization.

---

## Critical Issues

### 1. Missing `await` on AudioContext Resume

**File:** `src/audio/engine.ts:236-239`

```typescript
if (this.audioContext.state === 'suspended') {
  logger.audio.log('Resuming suspended AudioContext');
  this.audioContext.resume();  // Missing await!
}
```

**Problem:** The `resume()` call returns a Promise but isn't awaited. On mobile browsers, the context may not be resumed before playback begins.

**Impact:** Audio may fail silently on mobile browsers, especially iOS Safari and Chrome.

**Fix:**
```typescript
if (this.audioContext.state === 'suspended') {
  logger.audio.log('Resuming suspended AudioContext');
  await this.audioContext.resume();
}
```

**Complexity:** Low (5 minutes)

---

### 2. Snapshot Staleness Not Checked

**File:** `src/sync/multiplayer.ts:935-972`

**Problem:** The `handleSnapshot()` method applies incoming snapshots without verifying they're newer than the current state. Network packet reordering could cause an older snapshot to overwrite recent local changes.

```typescript
private handleSnapshot(msg: { state: SessionState; players: PlayerInfo[]; ... }): void {
  // No version/timestamp check here!
  this.dispatch({
    type: 'LOAD_STATE',
    tracks: msg.state.tracks,
    tempo: msg.state.tempo,
    swing: msg.state.swing,
    isRemote: true,
  });
}
```

**Impact:** User edits could be silently reverted if network packets arrive out of order.

**Fix:** Add version number or timestamp comparison:
```typescript
private handleSnapshot(msg: { state: SessionState; version: number; ... }): void {
  if (msg.version <= this.lastAppliedVersion) {
    logger.multiplayer.warn('Ignoring stale snapshot', { received: msg.version, current: this.lastAppliedVersion });
    return;
  }
  this.lastAppliedVersion = msg.version;
  // ... apply snapshot
}
```

**Complexity:** Medium (30 minutes) - requires server-side version tracking

---

## High Priority Issues

### 3. Race Condition in Session Loading State Machine

**File:** `src/hooks/useSession.ts:78-110`

**Problem:** The loading state machine uses a ref (`loadingStateRef.current`) to track transitions. If state updates overlap during rapid session switches, the state machine could enter an inconsistent state.

**Current Mitigation:** The code has a cancellation flag pattern, but the complexity of the state machine makes edge cases possible.

**Recommendation:** Consider simplifying to a single `loadingState` state variable with atomic transitions, or use a state machine library like XState for complex async flows.

---

### 4. Interval Not Guaranteed Cleared on Disconnect

**File:** `src/sync/multiplayer.ts:301-303`

**Problem:** The clock sync interval starts on connection but may not be cleared in all disconnect scenarios.

**Impact:** Memory leak if intervals accumulate.

**Fix:** Ensure `clearInterval()` is called in all disconnect code paths, including error handlers.

---

### 5. Limited Memoization in Hot Components

**File:** `src/components/StepSequencer.tsx`

**Problem:** Only 2 components use `React.memo`:
- `StepCell.tsx`
- `ChromaticGrid.tsx`

Other frequently-rendered components like `TrackRow` lack memoization, causing unnecessary re-renders when any state changes.

**Impact:** Performance degradation with many tracks or rapid updates (tempo changes, step toggling).

**Fix:**
```typescript
// TrackRow.tsx
export const TrackRow = React.memo(function TrackRow({ ... }: TrackRowProps) {
  // ...
});
```

Also consider:
- Adding `useMemo` for computed values like `selectedLock`
- Using `useCallback` for all handlers passed to children

---

## Medium Priority Issues

### 6. Silent Failures in Audio Engine

**File:** `src/audio/engine.ts:241-244`

```typescript
const sample = this.samples.get(sampleId);
if (!sample?.buffer) {
  logger.audio.warn(`Sample not found: ${sampleId}`);
  return;  // Silent failure
}
```

**Problem:** When a sample isn't found, the code logs a warning but doesn't notify the user. The step plays silence.

**Recommendation:** Consider surfacing audio errors to the UI, at least in debug mode.

---

### 7. Clipboard Error Handling

**File:** `src/utils/clipboard.ts`

**Problem:** Fallback error handlers catch all errors silently with empty catch blocks.

**Recommendation:** Log errors even in fallback paths to aid debugging.

---

### 8. WebSocket Message Ordering

**File:** `src/sync/multiplayer.ts:838-850`

**Problem:** Sequence number checking logs warnings but doesn't prevent out-of-order messages from being applied.

**Impact:** Under network congestion, actions could be applied in the wrong order.

**Trade-off:** Blocking out-of-order messages could cause perceived lag. Current approach favors responsiveness over strict ordering.

---

### 9. Outstanding TODOs

Two TODO comments found in the codebase:

| File | Line | TODO |
|------|------|------|
| `src/hooks/useMultiplayer.ts` | 99 | `messagesSent: 0, // TODO: Track these` |
| `src/components/ErrorBoundary.tsx` | 44 | `// TODO: Send to error tracking service in production` |

---

## Low Priority Issues

### 10. Parameter Lock Volume Reset Timing

**File:** `src/audio/scheduler.ts:217-225`

**Problem:** Volume reset uses `duration * 1000 + 50ms` as a hardcoded delay, which is an approximation.

**Impact:** Minor audio glitches on parameter-locked steps with very short durations.

---

### 11. No Rate Limiting on Session Creation

**File:** Worker endpoints

**Problem:** No rate limiting configured on `POST /api/sessions`.

**Risk:** Could be abused to exhaust KV quota.

**Fix:** Add Cloudflare Rate Limiting rules or implement DO-based rate limiting.

---

## Positive Findings

| Area | Status | Notes |
|------|--------|-------|
| TypeScript strict mode | **Excellent** | No `any` types found in codebase |
| Console logging | **Good** | Uses `logger` utility consistently (62 occurrences in appropriate files) |
| XSS protection | **Good** | Session names validated server-side in `worker/validation.ts`, JSX auto-escapes |
| Test coverage | **Good** | 12 test files covering critical paths |
| Error boundaries | **Present** | Top-level ErrorBoundary in App.tsx |
| Input validation | **Comprehensive** | `worker/validation.ts` covers all inputs |
| Code organization | **Good** | Clear separation: audio/, sync/, state/, components/, worker/ |
| Singleton pattern | **Appropriate** | Used for audioEngine (correct for Web Audio API) |
| Context pattern | **Good** | Used for multiplayer state |

---

## Test Coverage Assessment

### Well-Tested Modules

| Module | Test File | Assessment |
|--------|-----------|------------|
| Grid state reducer | `grid.test.ts` | Comprehensive action coverage |
| Synth engine | `synth.test.ts` | Full preset coverage, audibility tests |
| Audio engineering | `audio-engineering.test.ts` | Gain staging, frequency tests |
| Scheduler | `scheduler.test.ts` | Timing, swing calculation |
| Worker logging | `logging.test.ts` | Request/response logging |
| Worker types | `types.test.ts` | Type parity between client/server |
| Sample definitions | `samples.test.ts` | Sample ID consistency |
| Synth sessions | `synth-sessions.test.ts` | Preset playback verification |

### Gaps Identified

| Area | Missing Tests |
|------|---------------|
| Multiplayer sync | Out-of-order message handling |
| Multiplayer sync | Snapshot staleness/version checking |
| Session loading | Race conditions during rapid session switches |
| Audio engine | Context resume failure scenarios |
| Reconnection | Queue replay after reconnect |
| Error boundaries | Component-level error isolation |

---

## Architecture Observations

### Good Patterns

1. **Singleton for AudioEngine** — Appropriate for Web Audio API which requires a single AudioContext per page.

2. **Ref Pattern for Scheduler State** — `stateRef.current` updated via useEffect allows scheduler callback to always access latest state without re-binding.

3. **State Machine for Session Loading** — Clear states (idle → loading → applying → ready) prevent race conditions.

4. **useCallback for Handlers** — All handlers in StepSequencer are wrapped in useCallback with proper dependencies.

5. **Cancellation Flags** — Async operations check cancellation flags to prevent stale updates.

### Areas for Improvement

1. **Consider Zustand** — For high-frequency sequencer state (noted in Phase 21 roadmap).

2. **Feature-Level Error Boundaries** — Currently only top-level boundary exists. Audio and multiplayer errors should be isolated.

3. **Virtual Scrolling** — Not needed now (max 16 tracks) but would be required if track limit increases.

4. **State Machine Library** — Complex async flows in useSession could benefit from XState.

---

## Security Assessment

### Implemented Protections

| Protection | Location | Implementation |
|------------|----------|----------------|
| XSS in session names | `worker/validation.ts:158-187` | Rejects `<script>`, `javascript:`, `on*=` patterns |
| Input size limits | `worker/validation.ts` | Content-Length validation |
| UUID validation | `worker/index.ts` | Format check before DO routing |
| CORS | `worker/index.ts` | Configured for allowed origins |

### Not Implemented (Potential Risks)

| Risk | Severity | Notes |
|------|----------|-------|
| Rate limiting | Medium | Could exhaust KV quota |
| CSRF tokens | Low | Relying on CORS only |
| Session enumeration | Low | UUIDs are unguessable |

---

## Recommended Fix Priority

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| 1 | Add `await` to audioContext.resume() | 5 min | Fixes mobile audio failures |
| 2 | Add snapshot version checking | 30 min | Prevents data loss |
| 3 | Ensure interval cleanup on disconnect | 15 min | Fixes memory leak |
| 4 | Add React.memo to TrackRow | 10 min | Performance improvement |
| 5 | Add rate limiting | 1 hour | Security hardening |
| 6 | Add feature-level error boundaries | 30 min | Better error isolation |
| 7 | Track TODO items | Ongoing | Resolve or document decisions |

---

## Appendix: Files Reviewed

```
src/
├── audio/
│   ├── engine.ts           ← Critical: await issue
│   ├── scheduler.ts        ← Low: timing approximation
│   ├── synth.ts            ✓ Well-tested
│   └── samples.ts          ✓ Well-tested
├── components/
│   ├── StepSequencer.tsx   ← High: memoization needed
│   ├── TrackRow.tsx        ← High: needs React.memo
│   ├── StepCell.tsx        ✓ Has React.memo
│   ├── SessionName.tsx     ✓ XSS-safe (JSX escapes)
│   └── ErrorBoundary.tsx   ← Medium: add error tracking
├── hooks/
│   ├── useSession.ts       ← High: race condition risk
│   └── useMultiplayer.ts   ← Low: TODO comment
├── sync/
│   ├── multiplayer.ts      ← Critical: snapshot staleness
│   └── session.ts          ✓ Good error handling
├── state/
│   └── grid.tsx            ✓ Well-tested reducer
├── worker/
│   ├── index.ts            ← Medium: needs rate limiting
│   ├── validation.ts       ✓ Comprehensive
│   └── live-session.ts     ✓ Good structure
└── utils/
    ├── logger.ts           ✓ Used consistently
    └── clipboard.ts        ← Medium: silent failures
```

---

## Related Documents

- [PHASE-13B-LESSONS.md](./PHASE-13B-LESSONS.md) — Frontend hardening patterns
- [REACT-BEST-PRACTICES.md](./REACT-BEST-PRACTICES.md) — React optimization patterns
- [DURABLE-OBJECTS-TESTING.md](./DURABLE-OBJECTS-TESTING.md) — DO testing strategies
- [ROADMAP.md](../ROADMAP.md) — Phase 21 (Polish) addresses several issues noted here
