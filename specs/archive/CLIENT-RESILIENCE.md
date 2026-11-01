# Client-Side Resilience Specification

## Executive Summary

This spec addresses silent data loss in Keyboardia's multiplayer sync system. Users can make edits that appear locally but never reach the server, with no indication of failure.

**Core Problem**: WebSocket messages are fire-and-forget. The client has no confirmation that mutations reached the Durable Object.

**Core Solution**: Server acknowledgments with client-side pending queue and retry.

---

## Table of Contents

1. [Alignment with Architecture Principles](#alignment-with-architecture-principles)
2. [Root Cause Analysis](#root-cause-analysis)
3. [Architectural Analysis](#architectural-analysis)
4. [Solution Design](#solution-design)
5. [Reusing Existing Abstractions](#reusing-existing-abstractions)
6. [Implementation Plan](#implementation-plan)
7. [Conflict Resolution](#conflict-resolution)
8. [Testing Strategy](#testing-strategy)
9. [Alternatives Considered](#alternatives-considered)
10. [Deprecation Plan](#deprecation-plan)

---

## Alignment with Architecture Principles

This spec fills a gap in Keyboardia's reliability stack. Here's how it aligns with—and is constrained by—the architectural principles documented in `ARCHITECTURE-PRINCIPLES.md`.

### Principle 1: Single Source of Truth

**How it affects the spec:**
- Acks confirm the DO (source of truth) received and applied the mutation
- Client pending queue is *not* a source of truth—it's a tracking mechanism
- If ack fails after max retries, we request snapshot (defer to server truth)

**Constraint:** The ack system must never cause client to believe it has authority. Server always wins.

### Principle 2: Three Surfaces Must Align

**How it affects the spec:**

| Surface | What We Add |
|---------|-------------|
| **API** | `pendingOps` Map, `getPendingCount()`, ack handlers |
| **UI** | Sync indicator ("Syncing..."), error state on failure |
| **State** | `pendingCount` in `MultiplayerState` |

**Constraint:** Cannot ship ack system without visible pending indicator in UI.

### Principle 3: Audio-Affecting Features Must Sync

**How it affects the spec:**
- Every audio-affecting mutation (toggle_step, set_tempo, etc.) requires ack
- Transient messages (cursor_move, play, stop) do NOT require ack
- This is why `MUTATING_MESSAGE_TYPES` already exists—reuse it for `REQUIRE_ACK`

**Constraint:** The sets must be identical. If a message mutates state, it needs an ack.

### Principle 4: Last-Write-Wins (No Change)

**How it affects the spec:**
- Acks confirm *delivery*, not *ordering*
- Two players editing same step: both get acks, last write wins
- No optimistic locking, no version conflicts, no rollback

**Constraint:** Ack system must not introduce conflict resolution complexity.

### Principle 5: Graceful Degradation

**How it affects the spec:**

Current degradation:
```
Connected → Disconnected → Reconnecting → Single Player
```

New degradation (adds pending layer):
```
Connected → Pending → Retrying → Failed → Snapshot Recovery
    │          │          │          │
    │          │          │          └─► Request snapshot, continue
    │          │          └─► Show retry indicator
    │          └─► Show "Syncing..." indicator
    └─► Normal operation
```

**Constraint:** User can always continue working. Ack failures never block UI.

### Principle 6: Server-Side Validation

**How it affects the spec:**
- Acks should include validation results: `{ success: true }` or `{ success: false, error: 'invalid_tempo' }`
- Server may ack with failure if mutation was rejected (e.g., value out of range)
- Client should handle rejected mutations gracefully (revert optimistic update? show error?)

**Addition to spec:** Include `error` field in `AckMessage` for validation failures.

### Principle 7: Type Parity

**How it affects the spec:**

New types must be defined identically on client and server:

```typescript
// Must match exactly:
// Client: src/sync/multiplayer.ts
// Server: src/worker/types.ts

interface AckMessage {
  type: 'ack';
  opId: string;
  success: boolean;
  error?: string;
}
```

**Constraint:** Add parity test for `AckMessage` in `types.test.ts`.

### Principle 8: Debounced Persistence

**How it affects the spec:**
- Acks confirm DO in-memory update, NOT KV persistence
- This is correct—clients need fast confirmation
- KV write happens later (5s debounce), but that's okay

**No change needed:** The ack timing is already correct (immediate, not after KV).

### Principle 9: Handler Factories

**How it affects the spec:**

Instead of adding ack logic to each handler:
```typescript
// BAD: Repetitive
handleSetTempo(ws, player, msg) {
  // ...mutation...
  if (msg.opId) this.sendTo(ws, { type: 'ack', opId: msg.opId, success: true });
}
```

Modify factories to auto-send acks:
```typescript
// GOOD: Systematic
createGlobalMutationHandler({
  // ...existing config...
  // Factory automatically sends ack if opId present
});
```

**Constraint:** Implement via factory modification, not per-handler changes.

### Principle 10: Safety Nets

**How it affects the spec:**

| Layer | Before | After |
|-------|--------|-------|
| Hash Verification | Primary detection (30s) | Safety net (60-120s) |
| Debug Assertions | Diagnostic workaround | **REMOVE** |
| Mismatch Counter | Delay recovery | **SIMPLIFY** |
| Delivery Confirmation | MISSING | **PRIMARY** |

**Deprecations enabled by this spec:**
1. `debugAssert` object (~60 lines) - replaced by pending ops tracking
2. `ToggleRecord` + `lastToggle` (~20 lines) - replaced by `PendingOperation`
3. `consecutiveMismatches` logic (~30 lines) - simplify to "mismatch + no pending = snapshot"
4. Hash metrics in SyncMetrics (~10 lines) - replace with ack metrics

**Total: ~120 lines can be removed**

---

### Summary: Principles as Constraints

| Principle | Constraint on This Spec |
|-----------|------------------------|
| Single Source of Truth | Acks confirm DO receipt, never client authority |
| Three Surfaces | Must add UI indicator for pending state |
| Audio Must Sync | All mutating messages require acks |
| Last-Write-Wins | Acks confirm delivery only, no conflict resolution |
| Graceful Degradation | Failures never block UI, always recoverable |
| Server Validates | Include validation result in ack response |
| Type Parity | Add parity test for AckMessage |
| Debounced Persistence | Ack confirms memory update, not KV |
| Handler Factories | Implement via factory modification |
| Safety Nets | Hash check becomes backup, remove debug workarounds |

---

## Root Cause Analysis

### The Incident

Session `b65e86fd-5af2-4b8b-bad6-79b457ca90bf`: User added steps to tracks 6 (Synth) and 7 (Clav). Steps appeared locally. After some time, both tracks showed 0 steps. DO and KV state matched (both empty) - the edits never reached the server.

### Why Simple Retries Wouldn't Help

The user asked: "Would merely having client-side retries have solved this problem?"

**No.** Simple retries only help when you **know** a message failed. This was **silent** failure:

```
┌─────────────────────────────────────────────────────────────────┐
│                    CURRENT MESSAGE FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│  1. User toggles step                                           │
│  2. Local state updated (optimistic)                            │
│  3. ws.send(message)  ──────────────────────────────────────►  │
│  4. Client assumes success                                      │
│  5. ... 30 seconds pass ...                                     │
│  6. Hash check: "Everything matches!" (or doesn't)              │
│  7. If mismatch: request snapshot → user sees work disappear    │
└─────────────────────────────────────────────────────────────────┘

The message at step 3 can silently fail:
- WebSocket appears OPEN but is in degraded state
- Network drops packet, no TCP error surfaced to app
- Server processes but response lost
- Race condition with DO hibernation
```

### The Gap in Current Architecture

| Layer | What Exists | What's Missing |
|-------|-------------|----------------|
| **Optimistic Updates** | ✅ Local state updated immediately | - |
| **Offline Queue** | ✅ Messages buffered during disconnect | - |
| **Sequence Numbers** | ✅ `seq` sent with messages | ❌ Not used for ack correlation |
| **Hash Verification** | ✅ Every 30 seconds | ❌ Too slow, detects but doesn't prevent |
| **Mismatch Recovery** | ✅ Request snapshot after 2 mismatches | ❌ Destructive - loses local changes |
| **Delivery Confirmation** | ❌ None | ❌ **THE GAP** |

---

## Architectural Analysis

### Is This an Architectural Bug?

**Yes.** The architecture assumes WebSocket delivery is reliable. It isn't.

The reliability stack has a missing layer:

```
┌─────────────────────────────────────────────────────────────────┐
│  RELIABILITY STACK                                              │
├─────────────────────────────────────────────────────────────────┤
│  Layer 5: Conflict Resolution    [PARTIAL - hash-based]        │
│  Layer 4: Delivery Confirmation  [MISSING]  ◄── THE BUG        │
│  Layer 3: Connection Recovery    [EXISTS - reconnect + replay] │
│  Layer 2: Message Ordering       [EXISTS - seq numbers]        │
│  Layer 1: Transport              [WebSocket - unreliable]      │
└─────────────────────────────────────────────────────────────────┘
```

### The Role of Durable Objects

Durable Objects are **not** designed to solve this problem. They provide:

| DO Responsibility | How It Helps |
|-------------------|--------------|
| **Single Source of Truth** | All clients connect to same DO instance |
| **Consistency** | Single-threaded execution, no race conditions |
| **Durability** | State persists via storage API and KV |
| **Coordination** | Broadcasts changes to all connected clients |

DOs do **not** provide:
- **Guaranteed message delivery** - WebSocket messages can be lost
- **Client-side state management** - That's the client's job
- **Acknowledgment protocols** - Must be implemented in application layer

The architecture should be:
```
Client: Optimistic updates + track pending + retry on no-ack
   │
   ▼ (unreliable WebSocket)
   │
DO: Apply mutations + send acks + broadcast + persist
```

### What Cloudflare Recommends

Cloudflare provides **no explicit guidance** on client-side WebSocket resilience for DOs. Their implicit recommendation is **PartyKit/PartySocket**, which provides:

- ✅ Automatic reconnection with backoff
- ✅ Message buffering during disconnect
- ❌ No delivery guarantees
- ❌ No acknowledgment protocol

PartySocket is better than raw WebSocket but still doesn't solve silent message loss.

---

## Solution Design

### The Simplest Principled Approach

**Principle**: A client cannot assume delivery without confirmation from the server.

**Implementation**:
1. Server sends `ack` after applying each mutation
2. Client tracks pending operations
3. Client retries operations that aren't acknowledged within timeout
4. UI shows pending state

This is the **minimum viable solution** that:
- Uses the existing architecture (DO as single source of truth)
- Adds minimal new code (~200 lines client, ~50 lines server)
- Solves the actual problem (silent message loss)
- Is testable (can simulate network failures)
- Doesn't require CRDTs or complex merge logic

### Message Flow (Proposed)

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROPOSED MESSAGE FLOW                        │
├─────────────────────────────────────────────────────────────────┤
│  1. User toggles step                                           │
│  2. Generate operation ID: opId = crypto.randomUUID()           │
│  3. Add to pending queue: pending.set(opId, {msg, sentAt, 0})   │
│  4. Local state updated (optimistic)                            │
│  5. ws.send({...message, opId})  ─────────────────────────────► │
│  6. Start ack timeout (3 seconds)                               │
│                                                                 │
│  Server receives, applies mutation, broadcasts:                 │
│  ◄─────────────────────  {type: 'ack', opId, success: true}     │
│                                                                 │
│  7. Client receives ack                                         │
│  8. pending.delete(opId)                                        │
│  9. Clear timeout                                               │
│                                                                 │
│  IF NO ACK WITHIN TIMEOUT:                                      │
│  10. Increment retry count                                      │
│  11. If retries < MAX_RETRIES: resend message                   │
│  12. If retries >= MAX_RETRIES: surface error to user           │
└─────────────────────────────────────────────────────────────────┘
```

### Data Structures

```typescript
// Client-side pending operation
interface PendingOperation {
  opId: string;              // Unique operation ID
  message: ClientMessage;    // The message to send
  sentAt: number;           // When first sent
  retries: number;          // Retry count
  timeoutId: number;        // Timeout handle for cleanup
}

// Extended client message (adds opId to existing ClientMessage)
type ClientMessageWithOp = ClientMessage & { opId?: string };

// New server message type
type AckMessage = {
  type: 'ack';
  opId: string;
  success: boolean;
  error?: string;  // If success=false, why?
};
```

### Configuration

```typescript
const ACK_CONFIG = {
  // How long to wait for ack before retrying
  ACK_TIMEOUT_MS: 3000,

  // Maximum retry attempts before surfacing error
  MAX_RETRIES: 3,

  // Backoff multiplier for retries (uses existing retry.ts)
  USE_EXPONENTIAL_BACKOFF: true,

  // Which message types require acks (mutating messages only)
  REQUIRE_ACK: new Set([
    'toggle_step', 'set_tempo', 'set_swing', 'mute_track', 'solo_track',
    'set_parameter_lock', 'add_track', 'delete_track', 'clear_track',
    'set_track_sample', 'set_track_volume', 'set_track_transpose',
    'set_track_step_count', 'set_effects', 'set_fm_params',
  ]),

  // Message types that don't need acks (transient/read-only)
  NO_ACK_REQUIRED: new Set([
    'cursor_move', 'play', 'stop', 'clock_sync_request',
    'state_hash', 'request_snapshot',
  ]),
};
```

---

## Reusing Existing Abstractions

The codebase already has most building blocks needed:

### 1. Offline Queue → Pending Operations Queue

**Existing** (`multiplayer.ts:470-473`):
```typescript
private offlineQueue: QueuedMessage[] = [];
private maxQueueSize: number = 100;
private maxQueueAge: number = 30000;
```

**Reuse**: Same queue structure, different purpose. Offline queue holds messages during disconnect. Pending queue holds messages awaiting ack.

### 2. Message Priority → Retry Priority

**Existing** (`multiplayer.ts:432-450`):
```typescript
function getMessagePriority(messageType): MessagePriority {
  switch (messageType) {
    case 'add_track':
    case 'delete_track':
      return 'high';
    case 'cursor_move':
      return 'low';
    default:
      return 'normal';
  }
}
```

**Reuse**: High-priority messages get more retries, faster timeout.

### 3. Sequence Numbers → Operation IDs

**Existing** (`multiplayer.ts:475-478`):
```typescript
private clientSeq: number = 0;
private lastServerSeq: number = 0;
```

**Reuse**: Already incrementing client sequence. Use as basis for opId, or switch to UUID for better debugging.

### 4. Retry Utility → Ack Timeout Backoff

**Existing** (`retry.ts:49-66`):
```typescript
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): number {
  const exponentialDelay = Math.min(
    config.baseDelay * Math.pow(2, attempt),
    config.maxDelay
  );
  // Add jitter...
}
```

**Reuse**: Apply backoff to ack retry timeouts.

### 5. State Hash → Ack Verification

**Existing** (`multiplayer.ts:789-833`):
```typescript
private sendStateHash(): void {
  if (!this.getStateForHash) return;
  const state = this.getStateForHash();
  const canonical = canonicalizeForHash(state as StateForHash);
  const hash = hashState(canonical);
  this.send({ type: 'state_hash', hash });
}
```

**Reuse**: Keep hash checking as safety net. If hash mismatches AND no pending ops, something is wrong.

### 6. Handler Factory → Ack Handler

**Existing** (`handler-factory.ts:42-59`):
```typescript
export function createRemoteHandler<T extends { playerId: string }>(
  actionCreator: (msg: Omit<T, 'playerId'>) => GridAction,
) {
  return function(this: HandlerContext, msg: T): void {
    if (msg.playerId === this.playerId) return;
    if (this.dispatch) {
      this.dispatch({ ...actionCreator(msg), isRemote: true });
    }
  };
}
```

**Reuse**: Create `createAckHandler` for processing server acks.

### 7. Mutating Message Types → Ack-Required Messages

**Existing** (`worker/types.ts:93-123`):
```typescript
export const MUTATING_MESSAGE_TYPES = new Set([
  'toggle_step', 'set_tempo', 'set_swing', ...
]);
```

**Reuse**: Exactly the set of messages that need acks.

---

## Implementation Plan

### Phase 1: Server Acknowledgments (Foundation)

**Files to modify:**
- `src/worker/types.ts` - Add `AckMessage` type
- `src/worker/live-session.ts` - Send ack after mutations

**Server changes:**

```typescript
// In live-session.ts, after each mutation handler:
private handleToggleStep(ws: WebSocket, player: PlayerInfo, msg: ClientMessage & { opId?: string }): void {
  // ... existing mutation logic ...

  // NEW: Send acknowledgment to the sender
  if (msg.opId) {
    this.sendTo(ws, { type: 'ack', opId: msg.opId, success: true });
  }

  // ... existing broadcast logic ...
}
```

**Alternative (cleaner):** Modify handler factories to auto-send acks:

```typescript
// In worker/handler-factory.ts
export function createTrackMutationHandler<TMsg, TBroadcast>(
  config: TrackMutationConfig<TMsg, TBroadcast>
) {
  return function(this: LiveSessionContext, ws: WebSocket, player: PlayerInfo, msg: TMsg & { opId?: string }): void {
    // ... existing logic ...

    // Auto-send ack if opId present
    if (msg.opId) {
      this.sendTo(ws, { type: 'ack', opId: msg.opId, success: true });
    }
  };
}
```

### Phase 2: Client Pending Queue

**Files to modify:**
- `src/sync/multiplayer.ts` - Add pending queue and timeout logic

**New code structure:**

```typescript
// In multiplayer.ts

interface PendingOperation {
  opId: string;
  message: ClientMessage;
  sentAt: number;
  retries: number;
  timeoutId: ReturnType<typeof setTimeout>;
}

class MultiplayerConnection {
  // NEW: Pending operations awaiting ack
  private pendingOps: Map<string, PendingOperation> = new Map();

  // Extend send() to track pending operations
  send(message: ClientMessage): void {
    const needsAck = MUTATING_MESSAGE_TYPES.has(message.type);

    if (needsAck) {
      const opId = crypto.randomUUID();
      const messageWithOp = { ...message, opId };

      // Track pending operation
      this.trackPendingOp(opId, messageWithOp);

      // Send with opId
      this.rawSend(messageWithOp);
    } else {
      // Send without tracking (transient messages)
      this.rawSend(message);
    }
  }

  private trackPendingOp(opId: string, message: ClientMessage): void {
    const timeoutId = setTimeout(
      () => this.handleAckTimeout(opId),
      ACK_CONFIG.ACK_TIMEOUT_MS
    );

    this.pendingOps.set(opId, {
      opId,
      message,
      sentAt: Date.now(),
      retries: 0,
      timeoutId,
    });

    // Update UI to show pending state
    this.updateState({ pendingCount: this.pendingOps.size });
  }

  private handleAckTimeout(opId: string): void {
    const op = this.pendingOps.get(opId);
    if (!op) return;

    if (op.retries < ACK_CONFIG.MAX_RETRIES) {
      // Retry with backoff
      op.retries++;
      const delay = calculateBackoffDelay(op.retries);

      logger.ws.warn(`[ACK] Timeout for ${op.message.type}, retry ${op.retries}/${ACK_CONFIG.MAX_RETRIES}`);

      op.timeoutId = setTimeout(
        () => this.handleAckTimeout(opId),
        delay
      );

      this.rawSend({ ...op.message, opId });
    } else {
      // Max retries exceeded - surface error
      logger.ws.error(`[ACK] Failed after ${ACK_CONFIG.MAX_RETRIES} retries: ${op.message.type}`);

      this.pendingOps.delete(opId);
      this.updateState({
        pendingCount: this.pendingOps.size,
        lastError: `Failed to sync: ${op.message.type}`,
      });

      // Optionally request snapshot to resync
      this.send({ type: 'request_snapshot' });
    }
  }

  private handleAck(msg: AckMessage): void {
    const op = this.pendingOps.get(msg.opId);
    if (!op) {
      logger.ws.warn(`[ACK] Received ack for unknown opId: ${msg.opId}`);
      return;
    }

    clearTimeout(op.timeoutId);
    this.pendingOps.delete(msg.opId);

    this.updateState({ pendingCount: this.pendingOps.size });

    if (!msg.success) {
      logger.ws.error(`[ACK] Server rejected operation: ${msg.error}`);
      // Could trigger snapshot request or rollback here
    }
  }
}
```

### Phase 3: UI Indication

**Files to modify:**
- `src/components/Transport.tsx` or `ConnectionStatus.tsx` - Show pending state

**Minimal UI:**
```tsx
// In connection status component
{state.pendingCount > 0 && (
  <span className="sync-indicator syncing">
    Syncing ({state.pendingCount})...
  </span>
)}
```

### Phase 4: Server-Side Deduplication

**Problem:** If client retries, server may receive duplicate messages.

**Solution:** Server tracks recent opIds to deduplicate.

```typescript
// In live-session.ts
private processedOps: Set<string> = new Set();
private readonly MAX_PROCESSED_OPS = 1000;

private handleMessage(ws: WebSocket, message: ClientMessage & { opId?: string }): void {
  // Deduplicate by opId
  if (message.opId) {
    if (this.processedOps.has(message.opId)) {
      // Already processed - just send ack again
      this.sendTo(ws, { type: 'ack', opId: message.opId, success: true });
      return;
    }

    // Track processed op (with size limit)
    this.processedOps.add(message.opId);
    if (this.processedOps.size > this.MAX_PROCESSED_OPS) {
      // Remove oldest (Set maintains insertion order)
      const oldest = this.processedOps.values().next().value;
      this.processedOps.delete(oldest);
    }
  }

  // ... existing message handling ...
}
```

**Persistence consideration:** For maximum durability, store processedOps in DO storage. For Keyboardia's use case, in-memory with eviction is acceptable (worst case: duplicate toggle = no-op, duplicate add_track = rejected by existing track).

---

## Conflict Resolution

### Current Approach: Last-Write-Wins

Keyboardia uses last-write-wins (LWW) for all mutations. The DO applies mutations in order of receipt. This is simple and works well because:

1. **Step toggles are idempotent-ish**: Toggle(on→off→on) = on. Order matters but the operation is self-correcting.
2. **Parameter changes overwrite**: Tempo 120→130→125 = 125. Last value wins.
3. **Structural changes have guards**: Delete non-existent track = no-op.

### Does Ack System Change This?

**No.** The ack system doesn't change conflict resolution. It ensures messages **arrive** - what happens after arrival is unchanged.

### Potential Enhancement: Optimistic Locking

If we wanted stronger consistency (not recommended for Keyboardia):

```typescript
// Client includes expected version
{ type: 'toggle_step', trackId, step, expectedVersion: 42 }

// Server checks version
if (state.version !== msg.expectedVersion) {
  sendTo(ws, { type: 'ack', opId, success: false, error: 'version_mismatch' });
  return;
}
```

**Why not for Keyboardia?** Real-time music collaboration benefits from eventual consistency over strict ordering. If two people toggle the same step simultaneously, either outcome is musically valid.

### Hash Check as Safety Net

The existing 30-second hash check remains valuable:

- **Before acks**: Primary detection mechanism (slow)
- **With acks**: Safety net for edge cases (ack lost, DO restart, etc.)

If hash mismatches AND pending queue is empty, something unexpected happened. Request snapshot.

---

## Testing Strategy

Based on lessons learned from LESSONS-LEARNED.md and BUG-PATTERNS.md:

### Unit Tests

**File:** `src/sync/pending-ops.test.ts`

```typescript
describe('PendingOperations', () => {
  describe('trackPendingOp', () => {
    it('should add operation to pending map', () => {
      const mp = new MultiplayerConnection();
      mp.trackPendingOp('op-1', { type: 'toggle_step', trackId: 't1', step: 0 });
      expect(mp.getPendingCount()).toBe(1);
    });

    it('should set timeout for ack', () => {
      vi.useFakeTimers();
      const mp = new MultiplayerConnection();
      const handleTimeout = vi.spyOn(mp as any, 'handleAckTimeout');

      mp.trackPendingOp('op-1', { type: 'toggle_step', trackId: 't1', step: 0 });

      vi.advanceTimersByTime(ACK_CONFIG.ACK_TIMEOUT_MS);
      expect(handleTimeout).toHaveBeenCalledWith('op-1');
    });
  });

  describe('handleAck', () => {
    it('should remove operation from pending on success', () => {
      const mp = new MultiplayerConnection();
      mp.trackPendingOp('op-1', { type: 'toggle_step', trackId: 't1', step: 0 });

      mp.handleAck({ type: 'ack', opId: 'op-1', success: true });

      expect(mp.getPendingCount()).toBe(0);
    });

    it('should clear timeout on ack', () => {
      vi.useFakeTimers();
      const mp = new MultiplayerConnection();
      const handleTimeout = vi.spyOn(mp as any, 'handleAckTimeout');

      mp.trackPendingOp('op-1', { type: 'toggle_step', trackId: 't1', step: 0 });
      mp.handleAck({ type: 'ack', opId: 'op-1', success: true });

      vi.advanceTimersByTime(ACK_CONFIG.ACK_TIMEOUT_MS * 2);
      expect(handleTimeout).not.toHaveBeenCalled();
    });

    it('should ignore ack for unknown opId (no crash)', () => {
      const mp = new MultiplayerConnection();
      expect(() => {
        mp.handleAck({ type: 'ack', opId: 'unknown', success: true });
      }).not.toThrow();
    });
  });

  describe('handleAckTimeout', () => {
    it('should retry on timeout up to MAX_RETRIES', () => {
      vi.useFakeTimers();
      const mp = new MultiplayerConnection();
      const rawSend = vi.spyOn(mp as any, 'rawSend');

      mp.trackPendingOp('op-1', { type: 'toggle_step', trackId: 't1', step: 0 });

      // Initial send
      expect(rawSend).toHaveBeenCalledTimes(1);

      // Timeout → retry 1
      vi.advanceTimersByTime(ACK_CONFIG.ACK_TIMEOUT_MS);
      expect(rawSend).toHaveBeenCalledTimes(2);

      // Timeout → retry 2
      vi.advanceTimersByTime(ACK_CONFIG.ACK_TIMEOUT_MS * 2); // backoff
      expect(rawSend).toHaveBeenCalledTimes(3);

      // Timeout → retry 3
      vi.advanceTimersByTime(ACK_CONFIG.ACK_TIMEOUT_MS * 4);
      expect(rawSend).toHaveBeenCalledTimes(4);

      // Timeout → max retries exceeded, no more sends
      vi.advanceTimersByTime(ACK_CONFIG.ACK_TIMEOUT_MS * 8);
      expect(rawSend).toHaveBeenCalledTimes(4);
      expect(mp.getPendingCount()).toBe(0);
    });

    it('should request snapshot after max retries', () => {
      vi.useFakeTimers();
      const mp = new MultiplayerConnection();
      const rawSend = vi.spyOn(mp as any, 'rawSend');

      mp.trackPendingOp('op-1', { type: 'toggle_step', trackId: 't1', step: 0 });

      // Exhaust retries
      for (let i = 0; i <= ACK_CONFIG.MAX_RETRIES; i++) {
        vi.advanceTimersByTime(ACK_CONFIG.ACK_TIMEOUT_MS * Math.pow(2, i));
      }

      // Should have sent request_snapshot
      expect(rawSend).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'request_snapshot' })
      );
    });
  });
});
```

### Integration Tests

**File:** `src/sync/ack-integration.test.ts`

```typescript
describe('Ack System Integration', () => {
  it('should complete round-trip: send → server ack → pending cleared', async () => {
    // Setup mock WebSocket server that sends acks
    const { client, server } = createMockMultiplayerPair();

    // Client sends mutation
    client.send({ type: 'toggle_step', trackId: 't1', step: 0 });

    // Verify pending
    expect(client.getPendingCount()).toBe(1);

    // Server receives and acks
    await server.processNextMessage();

    // Client receives ack
    await client.processNextMessage();

    // Pending cleared
    expect(client.getPendingCount()).toBe(0);
  });

  it('should retry and succeed on delayed ack', async () => {
    vi.useFakeTimers();
    const { client, server } = createMockMultiplayerPair({ ackDelay: 5000 });

    client.send({ type: 'toggle_step', trackId: 't1', step: 0 });

    // First timeout triggers retry
    vi.advanceTimersByTime(ACK_CONFIG.ACK_TIMEOUT_MS);
    expect(client.getRetryCount('op-1')).toBe(1);

    // Server finally acks
    vi.advanceTimersByTime(2000);
    await server.processNextMessage();
    await client.processNextMessage();

    // Success despite retry
    expect(client.getPendingCount()).toBe(0);
  });
});
```

### Server Deduplication Tests

**File:** `src/worker/dedup.test.ts`

```typescript
describe('Server Deduplication', () => {
  it('should not apply duplicate mutations', async () => {
    const session = new LiveSessionDurableObject(ctx, env);
    await session.loadState();

    const initialStepValue = session.getState().tracks[0].steps[0];

    // First toggle
    await session.handleMessage(ws, {
      type: 'toggle_step',
      trackId: 't1',
      step: 0,
      opId: 'op-1'
    });

    const afterFirst = session.getState().tracks[0].steps[0];
    expect(afterFirst).toBe(!initialStepValue);

    // Duplicate (same opId)
    await session.handleMessage(ws, {
      type: 'toggle_step',
      trackId: 't1',
      step: 0,
      opId: 'op-1'  // Same opId
    });

    // Should NOT have toggled again
    const afterDuplicate = session.getState().tracks[0].steps[0];
    expect(afterDuplicate).toBe(afterFirst);
  });

  it('should still send ack for duplicate', async () => {
    const session = new LiveSessionDurableObject(ctx, env);
    const sendTo = vi.spyOn(session, 'sendTo');

    // First
    await session.handleMessage(ws, { type: 'toggle_step', trackId: 't1', step: 0, opId: 'op-1' });
    expect(sendTo).toHaveBeenCalledWith(ws, { type: 'ack', opId: 'op-1', success: true });

    sendTo.mockClear();

    // Duplicate
    await session.handleMessage(ws, { type: 'toggle_step', trackId: 't1', step: 0, opId: 'op-1' });

    // Still acks (client may have missed first ack)
    expect(sendTo).toHaveBeenCalledWith(ws, { type: 'ack', opId: 'op-1', success: true });
  });
});
```

### E2E Tests

**File:** `scripts/test-ack-e2e.ts`

Based on Lesson 17 (test scripts must match server message structure):

```typescript
#!/usr/bin/env npx tsx
/**
 * E2E test for acknowledgment system
 * Tests the full flow: client → server → ack → client
 */

import WebSocket from 'ws';

const SESSION_ID = process.argv[2] || crypto.randomUUID();
const WS_URL = `wss://keyboardia.adewale-883.workers.dev/api/sessions/${SESSION_ID}/ws`;

async function testAckFlow(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const opId = crypto.randomUUID();
    let gotAck = false;

    ws.on('open', () => {
      console.log('Connected, sending join...');
      ws.send(JSON.stringify({ type: 'join', name: 'AckTester', color: '#888' }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'snapshot') {
        console.log('Got snapshot, sending toggle with opId...');
        ws.send(JSON.stringify({
          type: 'toggle_step',
          trackId: msg.state.tracks[0]?.id || 'track-1',
          step: 0,
          opId: opId,
        }));
      }

      if (msg.type === 'ack') {
        console.log(`Got ack: opId=${msg.opId}, success=${msg.success}`);
        if (msg.opId === opId) {
          gotAck = true;
          ws.close(1000);
        }
      }
    });

    ws.on('close', () => {
      if (gotAck) {
        console.log('✓ Ack flow works!');
        resolve();
      } else {
        reject(new Error('Did not receive ack'));
      }
    });

    ws.on('error', reject);

    setTimeout(() => reject(new Error('Timeout')), 10000);
  });
}

testAckFlow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('✗ Test failed:', err.message);
    process.exit(1);
  });
```

### Bug Pattern Prevention

Based on BUG-PATTERNS.md, add these specific tests:

**1. Serialization Boundary Mismatch (Bug Pattern #1):**
```typescript
// Ensure ack message types match client/server
it('AckMessage type matches between client and server', () => {
  // Compile-time check
  type ClientAckMessage = Extract<ServerMessage, { type: 'ack' }>;
  type ServerAckMessage = AckMessage;

  const _parity: ClientAckMessage = {} as ServerAckMessage;
  const _parityReverse: ServerAckMessage = {} as ClientAckMessage;
});
```

**2. Unstable Callback (Bug Pattern #2):**
```typescript
// Pending ops should not cause connection storm
it('should not trigger reconnection when pending queue changes', () => {
  const connectionCount = { value: 0 };
  const mp = new MultiplayerConnection({
    onConnect: () => connectionCount.value++
  });

  mp.connect(sessionId, dispatch);
  expect(connectionCount.value).toBe(1);

  // Add many pending ops
  for (let i = 0; i < 100; i++) {
    mp.trackPendingOp(`op-${i}`, { type: 'toggle_step', trackId: 't1', step: i % 16 });
  }

  // Should NOT have reconnected
  expect(connectionCount.value).toBe(1);
});
```

**3. Computed Value Not Used (Bug Pattern #3):**
```typescript
// Ensure opId is actually sent, not just logged
it('should include opId in sent message', () => {
  const sentMessages: any[] = [];
  const mp = new MultiplayerConnection({
    rawSend: (msg) => sentMessages.push(msg)
  });

  mp.send({ type: 'toggle_step', trackId: 't1', step: 0 });

  // opId must be in sent message, not just logged
  expect(sentMessages[0]).toHaveProperty('opId');
  expect(typeof sentMessages[0].opId).toBe('string');
});
```

---

## Alternatives Considered

### 1. CRDTs (Yjs, Automerge)

**What it is:** Conflict-free Replicated Data Types enable multi-master editing with automatic merge.

**Why not:**
- Keyboardia has a single source of truth (DO)
- CRDTs solve multi-master; we have single-master
- Adds 50KB+ to bundle
- Complexity not warranted for current problem

**When to reconsider:** If we add offline-first editing where users edit without any server connection for extended periods.

### 2. Event Sourcing

**What it is:** Store operations, not state. Replay to reconstruct.

**Why not:**
- Significant architecture change
- Current state-based approach works well
- Would need to replay entire history on load

**When to reconsider:** If we need audit trails, time-travel debugging, or complex undo.

### 3. More Frequent Hash Checks

**What it is:** Reduce hash check interval from 30s to 5s.

**Why not:**
- Detects but doesn't prevent data loss
- User still sees work disappear (just faster)
- More server load

**When to reconsider:** As a quick interim fix if ack system takes time.

### 4. PartyKit Migration

**What it is:** Use Cloudflare's PartyKit instead of raw DOs.

**Why not:**
- Still doesn't have delivery guarantees
- Would require significant refactoring
- Adds external dependency

**When to reconsider:** If we need more PartyKit features (rooms, presence primitives, etc.).

### 5. Optimistic Locking with Versions

**What it is:** Every message includes expected state version. Server rejects if mismatch.

**Why not:**
- More restrictive than needed for music collaboration
- Would reject valid concurrent edits
- Ack system is simpler and sufficient

**When to reconsider:** If we need stricter consistency for certain operations.

---

## Success Criteria

1. **No silent data loss:** User edits that appear locally will eventually either sync or show error
2. **Clear feedback:** UI indicates pending state and sync errors
3. **Graceful degradation:** System falls back to snapshot resync on persistent failures
4. **No performance regression:** Ack overhead < 10ms latency increase
5. **Testable:** Can simulate network failures in tests
6. **Backward compatible:** Old clients (without opId) still work

---

## Implementation Order

```
Phase 1: Server Acks [1-2 hours]
├── Add AckMessage type
├── Modify handler factories to send acks
└── Test: Server sends acks

Phase 2: Client Pending Queue [2-3 hours]
├── Add PendingOperation tracking
├── Implement timeout + retry logic
├── Integrate with existing send()
└── Test: Client tracks and retries

Phase 3: Server Deduplication [1 hour]
├── Add processedOps Set
├── Dedupe in message handler
└── Test: Duplicates ignored

Phase 4: UI Integration [1 hour]
├── Expose pendingCount in state
├── Show sync indicator in UI
└── Show error state on failure

Phase 5: Testing [1-2 hours]
├── Unit tests for all paths
├── Integration tests
├── E2E script
└── Bug pattern prevention tests
```

**Total estimate: 6-9 hours**

---

## Deprecation Plan

Once the ack system is implemented, these components become redundant and should be removed. This reduces complexity and makes the codebase more maintainable.

### Phase 6: Cleanup (After Acks Are Stable)

**Only perform after ack system is deployed and verified in production.**

#### 6.1 Remove Debug Assertion System (~80 lines)

**Files:** `src/sync/multiplayer.ts`

```typescript
// REMOVE: Lines 165-241
interface ToggleRecord { ... }           // DELETE
const debugAssert = { ... }              // DELETE

// REMOVE: Line 485
private lastToggle: ToggleRecord | null = null;  // DELETE

// REMOVE: Lines 551-556
this.lastToggle = { trackId, step, sentAt };     // DELETE
debugAssert.toggleSent(...);                      // DELETE

// REMOVE: Calls to debugAssert.* throughout file
debugAssert.snapshotExpected(...)    // Line 968
debugAssert.loadStateExpected(...)   // Line 1001
debugAssert.stepToggledReceived(...) // Line 1030
debugAssert.mismatchReceived(...)    // Line 1263
```

**Why removable:** The pending ops queue provides better tracking than `lastToggle`. Every operation is tracked with opId, timeout, and retry count.

#### 6.2 Simplify Hash Mismatch Logic (~30 lines)

**Files:** `src/sync/multiplayer.ts`

```typescript
// BEFORE: Wait for 2 consecutive mismatches
recordHashCheck(matched: boolean): void {
  this.metrics.hashCheckCount++;
  if (!matched) {
    this.metrics.mismatchCount++;
    this.metrics.consecutiveMismatches++;
  } else {
    this.metrics.consecutiveMismatches = 0;
  }
}

shouldRequestSnapshot(): boolean {
  return this.metrics.consecutiveMismatches >= MAX_CONSECUTIVE_MISMATCHES;
}

// AFTER: Immediate action if no pending ops
handleStateMismatch(serverHash: string): void {
  if (this.pendingOps.size === 0) {
    // No pending ops but hash differs → unexpected, request snapshot
    logger.ws.warn('State mismatch with no pending ops, requesting snapshot');
    this.send({ type: 'request_snapshot' });
  } else {
    // Pending ops exist → expected, wait for acks
    logger.ws.log(`State mismatch (${this.pendingOps.size} pending ops, waiting for acks)`);
  }
}
```

**Remove:**
- `consecutiveMismatches` from `SyncMetrics`
- `MAX_CONSECUTIVE_MISMATCHES` constant
- `shouldRequestSnapshot()` method
- `resetMismatchCounter()` method

#### 6.3 Reduce Hash Check Frequency

**Files:** `src/sync/multiplayer.ts`

```typescript
// BEFORE
const STATE_HASH_CHECK_INTERVAL_MS = 30000;  // 30 seconds

// AFTER
const STATE_HASH_CHECK_INTERVAL_MS = 120000;  // 2 minutes (safety net only)
```

**Alternative:** Make hash checking conditional:
```typescript
private startStateHashCheck(): void {
  this.stateHashInterval = setInterval(() => {
    // Only check if no pending ops (otherwise mismatch is expected)
    if (this.pendingOps.size === 0) {
      this.sendStateHash();
    }
  }, STATE_HASH_CHECK_INTERVAL_MS);
}
```

#### 6.4 Simplify SyncMetrics (~10 lines)

**Files:** `src/sync/multiplayer.ts`

```typescript
// BEFORE: Many hash-related metrics
interface SyncMetrics {
  rttMs: number;
  rttP95Ms: number;
  rttSamples: number[];
  offsetMs: number;
  maxDriftMs: number;
  syncCount: number;
  hashCheckCount: number;         // REMOVE
  mismatchCount: number;          // REMOVE
  lastHashCheckAt: number;        // REMOVE
  consecutiveMismatches: number;  // REMOVE
}

// AFTER: Focus on what matters
interface SyncMetrics {
  rttMs: number;
  rttP95Ms: number;
  rttSamples: number[];
  offsetMs: number;
  syncCount: number;
}

// NEW: Ack metrics (added in Phase 2)
interface AckMetrics {
  pendingCount: number;
  ackSuccessCount: number;
  ackFailureCount: number;
  avgAckLatencyMs: number;
}
```

### Summary of Removals

| Component | Lines | File | Reason |
|-----------|-------|------|--------|
| `ToggleRecord` interface | 5 | multiplayer.ts | Replaced by `PendingOperation` |
| `debugAssert` object | 60 | multiplayer.ts | Replaced by pending ops logging |
| `lastToggle` field + tracking | 15 | multiplayer.ts | Replaced by pending ops Map |
| `consecutiveMismatches` logic | 30 | multiplayer.ts | Simplified to "mismatch + no pending" |
| Hash metrics in SyncMetrics | 10 | multiplayer.ts | Replaced by ack metrics |
| **Total** | **~120** | | |

### Migration Checklist

Before removing deprecated code:

- [ ] Ack system deployed to production
- [ ] Ack system verified working for 1 week
- [ ] No data loss incidents reported
- [ ] Ack metrics showing expected patterns
- [ ] Hash check still working as safety net
- [ ] All tests passing without deprecated code

### Test Updates Required

When removing deprecated code, update these tests:

1. `src/sync/multiplayer.test.ts` - Remove `consecutiveMismatches` tests
2. `src/sync/multiplayer.test.ts` - Add ack-based mismatch handling tests
3. `src/sync/canonicalHash.test.ts` - No changes (still needed for safety net)

---

## References

**Keyboardia Documentation:**
- `ARCHITECTURE-PRINCIPLES.md` - Architectural principles (this spec must align)
- `../docs/BUG-PATTERNS.md` - Prevention checklist
- `../docs/LESSONS-LEARNED.md` - Testing lessons

**External:**
- [Cloudflare Durable Objects Docs](https://developers.cloudflare.com/durable-objects/)
- [PartySocket Source](https://github.com/partykit/partykit/tree/main/packages/partysocket)
- [Azure Web PubSub Reliable Protocol](https://learn.microsoft.com/en-us/azure/azure-web-pubsub/reference-json-reliable-webpubsub-subprotocol)
- [Socket.IO Delivery Guarantees](https://socket.io/docs/v4/delivery-guarantees/)
