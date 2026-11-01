# Phase 13B: Frontend Hardening - Lessons Learned

**Date**: 2025-12-10
**Status**: Complete

## Overview

Phase 13B addressed technical debt discovered during a comprehensive codebase audit. This document captures the patterns, anti-patterns, and lessons learned during implementation.

---

## Issues Fixed

### Critical Issues

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Race condition in useSession.ts | Fragile `skipNextSaveRef` flag could lose data during session loading | Replaced with proper state machine: `idle` → `loading` → `applying` → `ready` |
| WebSocket message ordering | No sequence numbers, conflicting ops had undefined behavior | Added client-side `clientSeq` and server-side `serverSeq` counters |
| Missing Error Boundary | App crashed to white screen on render errors | Added React Error Boundary with recovery UI |

### High Priority Issues

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Memory leak in RemoteChangeContext | `setTimeout` never cancelled on unmount | Track timers in Set, clear in cleanup |
| Audio volume reset timers | Timers not cleaned up on stop | Added `pendingTimers` Set with cleanup on `stop()` |
| Missing null check | Player could disconnect before callback | Added defensive null checks with fallback |
| Race condition in useMultiplayer | Multiple connections if sessionId changes rapidly | Added cancellation flag pattern |
| Unbounded message queue | Critical messages (add/delete track) could be dropped | Added priority queue: `high` > `normal` > `low` |

### Medium Priority Issues

| Issue | Root Cause | Fix |
|-------|-----------|-----|
| Inconsistent constants | `MIN_TEMPO`/`MAX_TEMPO` differed between client (60-180) and server (30-300) | Aligned server with client bounds + added parity tests |
| Audio decode errors | `decodeAudioData` rejection not caught | Added try/catch with meaningful error messages |
| Scheduler timing drift | Additive timing accumulates floating-point errors | Changed to multiplicative: `startTime + (stepCount * duration)` |
| Missing mic cleanup | MediaStream tracks never stopped | Added `releaseMicAccess()` to stop tracks |

---

## Patterns & Anti-Patterns

### 1. State Machine for Async Loading

**Anti-pattern**: Boolean flags for async state
```typescript
// BAD: Race condition prone
const skipNextSaveRef = useRef(false);
skipNextSaveRef.current = true;
loadState(data);
// State update is async, flag might be checked before state updates
```

**Pattern**: Explicit state machine
```typescript
// GOOD: Clear state transitions
type LoadingState = 'idle' | 'loading' | 'applying' | 'ready';
const loadingStateRef = useRef<LoadingState>('idle');

// Transition: idle → loading → applying → ready
// Only enable auto-save when in 'ready' state
```

### 2. Timer Cleanup

**Anti-pattern**: Untracked timers
```typescript
// BAD: Timer leak on unmount/stop
setTimeout(() => doSomething(), delay);
```

**Pattern**: Track timers in a Set
```typescript
// GOOD: All timers cleaned up on stop
private pendingTimers: Set<ReturnType<typeof setTimeout>> = new Set();

const timer = setTimeout(() => {
  this.pendingTimers.delete(timer);
  doSomething();
}, delay);
this.pendingTimers.add(timer);

// Cleanup
for (const timer of this.pendingTimers) {
  clearTimeout(timer);
}
this.pendingTimers.clear();
```

### 3. Cancellation Flag for Effects

**Anti-pattern**: Stale callbacks after unmount
```typescript
// BAD: Callback executes after effect cleanup
useEffect(() => {
  fetchData().then(data => setState(data)); // May run after unmount
}, []);
```

**Pattern**: Cancellation flag
```typescript
// GOOD: Callbacks respect cleanup
useEffect(() => {
  let cancelled = false;

  fetchData().then(data => {
    if (cancelled) return;
    setState(data);
  });

  return () => { cancelled = true; };
}, []);
```

### 4. Multiplicative vs Additive Timing

**Anti-pattern**: Accumulating time
```typescript
// BAD: Floating-point errors accumulate
nextTime += stepDuration; // Drift over thousands of steps
```

**Pattern**: Compute from start time
```typescript
// GOOD: No drift
nextTime = startTime + (stepCount * stepDuration);
```

### 5. Message Priority Queue

**Anti-pattern**: FIFO queue for all messages
```typescript
// BAD: Critical messages can be dropped when queue is full
queue.push(message);
if (queue.length > MAX) queue.shift(); // Drops oldest regardless of importance
```

**Pattern**: Priority-based eviction
```typescript
// GOOD: Protect critical messages
type Priority = 'high' | 'normal' | 'low';

function evictLowestPriority(): boolean {
  // Find and remove lowest priority message
  // Never evict 'high' priority to make room
}
```

### 6. Constants Parity Testing

**Anti-pattern**: Duplicated constants without verification
```typescript
// types.ts
export const MAX_TEMPO = 180;

// worker/invariants.ts
export const MAX_TEMPO = 300; // Silently drifted!
```

**Pattern**: Parity tests catch drift
```typescript
// types.test.ts
import { MAX_TEMPO as APP_MAX_TEMPO } from '../types';
import { MAX_TEMPO as WORKER_MAX_TEMPO } from './invariants';

it('MAX_TEMPO should match', () => {
  expect(APP_MAX_TEMPO).toBe(WORKER_MAX_TEMPO);
});
```

### 7. Defensive Error Handling for External APIs

**Anti-pattern**: Assuming external APIs succeed
```typescript
// BAD: Uncaught rejection if audio is corrupted
const buffer = await audioContext.decodeAudioData(arrayBuffer);
```

**Pattern**: Catch and provide context
```typescript
// GOOD: Meaningful errors
try {
  buffer = await audioContext.decodeAudioData(arrayBuffer);
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  throw new Error(`Failed to decode audio: ${message}`);
}
```

### 8. Resource Cleanup (MediaStream)

**Anti-pattern**: Request resource, never release
```typescript
// BAD: Mic stays active forever (green indicator)
this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
```

**Pattern**: Explicit release method
```typescript
// GOOD: Release when done
releaseMicAccess(): void {
  if (this.stream) {
    this.stream.getTracks().forEach(track => track.stop());
    this.stream = null;
  }
}
```

---

## WebSocket Best Practices

### Sequence Numbers for Ordering

```typescript
// Client: Track outgoing sequence
private clientSeq: number = 0;
send(message) {
  const messageWithSeq = { ...message, seq: ++this.clientSeq };
}

// Server: Track broadcast sequence
private serverSeq: number = 0;
broadcast(message) {
  const messageWithSeq = { ...message, seq: ++this.serverSeq };
}

// Client: Detect out-of-order messages
if (msg.seq !== this.lastServerSeq + 1) {
  console.warn(`Missed messages: expected ${this.lastServerSeq + 1}, got ${msg.seq}`);
}
```

### Priority-Based Queue Management

```typescript
// Message priorities
function getMessagePriority(type: string): 'high' | 'normal' | 'low' {
  switch (type) {
    case 'add_track':
    case 'delete_track':
      return 'high';    // Structural changes must not be lost
    case 'cursor_move':
    case 'play':
      return 'low';     // Transient, can be regenerated
    default:
      return 'normal';
  }
}

// On replay, send high priority first
const sorted = queue.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
```

---

## Testing Recommendations

### Parity Tests Prevent Drift

When the same constants exist in multiple files, add explicit parity tests:

```typescript
describe('Constants parity', () => {
  it('MIN_TEMPO should match', () => {
    expect(APP_MIN_TEMPO).toBe(WORKER_MIN_TEMPO);
  });
  // ... for each shared constant
});
```

### Test Timer Cleanup

```typescript
it('should clean up timers on stop', () => {
  scheduler.start(getState);
  expect(scheduler['pendingTimers'].size).toBeGreaterThan(0);

  scheduler.stop();
  expect(scheduler['pendingTimers'].size).toBe(0);
});
```

---

## Key Takeaways

1. **State machines > boolean flags** for async operations
2. **Track all timers** in a Set for reliable cleanup
3. **Use cancellation flags** in useEffect to prevent stale callbacks
4. **Multiplicative timing** prevents drift in schedulers
5. **Priority queues** protect critical messages
6. **Parity tests** catch constant drift between modules
7. **Always catch** external API errors with meaningful messages
8. **Release resources** (MediaStream tracks, WebSockets) explicitly

---

## Files Modified

| File | Changes |
|------|---------|
| `src/hooks/useSession.ts` | State machine for loading |
| `src/sync/multiplayer.ts` | Sequence numbers, priority queue |
| `src/worker/live-session.ts` | Server sequence numbers |
| `src/worker/types.ts` | Message sequence types |
| `src/worker/invariants.ts` | Aligned tempo constants |
| `src/worker/types.test.ts` | Parity tests |
| `src/audio/engine.ts` | Audio decode error handling |
| `src/audio/scheduler.ts` | Multiplicative timing, timer cleanup |
| `src/audio/recorder.ts` | Mic release method |
| `src/components/ErrorBoundary.tsx` | New component |

---

## Related Documentation

- [DURABLE-OBJECTS-TESTING.md](./DURABLE-OBJECTS-TESTING.md) - Testing patterns for Durable Objects
