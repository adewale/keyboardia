# Mutation Tracking & Invariant Detection

## Executive Summary

This spec adds lightweight invariant checking to detect when mutations are lost. It leverages **existing infrastructure** (sequence numbers, clock sync, `clientSeq` echo) that was built but never connected for delivery confirmation.

**Cost**: ~30 lines of code, client-only, no server changes.

**Goal**: Detect the bug, log enough to reproduce it, then fix it.

---

## The Original Bug

**Session**: `b65e86fd-5af2-4b8b-bad6-79b457ca90bf`

**Scenario**: User added steps to tracks 6 (Synth) and 7 (Clav). Steps appeared locally. After some time, both tracks showed 0 steps. DO and KV state matched (both empty) - the edits never reached the server.

**Key observation**: The user had no indication that their toggles didn't reach the server. They assumed success.

---

## What Broke Between Spec and Implementation

### Phase 13B Added Sequence Numbers

From `PHASE-13B-LESSONS.md`:

> "WebSocket message ordering: No sequence numbers, conflicting ops had undefined behavior. **Added client-side `clientSeq` and server-side `serverSeq` counters.**"

### The Infrastructure Exists

| Component | Location | Status |
|-----------|----------|--------|
| Client sends `seq` | `multiplayer.ts:566` | ✅ Working |
| Server echoes `clientSeq` | `live-session.ts:1007-1013` | ✅ Working |
| Client tracks `lastServerSeq` | `multiplayer.ts:477` | ✅ Working |
| **Client confirms delivery via `clientSeq`** | - | ❌ **NOT IMPLEMENTED** |

### The Gap

```typescript
// Server sends this (live-session.ts:1013):
{
  type: 'step_toggled',
  trackId: 'synth-1',
  step: 5,
  value: true,
  playerId: 'abc',
  seq: 101,           // Server's broadcast sequence
  clientSeq: 42,      // Echo of MY message sequence
}

// Client receives it, but IGNORES clientSeq!
// We track lastServerSeq for ordering, but never track
// "which of my messages have been confirmed?"
```

The `clientSeq` echo was designed for exactly this purpose but was never used.

---

## The Invariants

### Single-Player Invariant

With one player and one server:

> **Every mutation I send with sequence N must eventually be confirmed by receiving a broadcast with `clientSeq: N`, or appear in the next snapshot.**

If I send `toggle_step` with `seq: 42` and never receive `clientSeq: 42` in any response, and a snapshot arrives showing my step is OFF, the message was lost.

### Multi-Player Extension

With multiple players, discrepancies can be explained by other players' actions:

> **If my mutation is UNCONFIRMED (no `clientSeq` echo) AND NOT SUPERSEDED (no other player touched it) AND snapshot contradicts it → INVARIANT VIOLATION.**

### Temporal Invariant (Using Clock Sync)

> **If mutation sent at server time T₁, and snapshot created at T₂ > T₁ + 2×RTT, the snapshot should include my mutation.**

---

## State Machine

```
                    ┌──────────────────────────────────────────────────────────────┐
                    │                    MUTATION STATES                            │
                    └──────────────────────────────────────────────────────────────┘

┌─────────────┐         ┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   PENDING   │────────▶│  CONFIRMED  │         │  SUPERSEDED │         │    LOST     │
│             │         │             │         │             │         │             │
│ Sent, await │         │ Server echo │         │ Other player│         │ Contradicted│
│ confirmation│         │ received    │         │ touched same│         │ by snapshot │
└─────────────┘         └─────────────┘         └─────────────┘         └─────────────┘
      │                        │                       │                       │
      │ receive broadcast      │                       │                       │
      │ with clientSeq=N       │                       │                       │
      ├────────────────────────┘                       │                       │
      │                                                │                       │
      │ receive broadcast from other player            │                       │
      │ touching same (trackId, step)                  │                       │
      ├────────────────────────────────────────────────┘                       │
      │                                                                        │
      │ receive snapshot that contradicts                                      │
      │ AND mutation is PENDING (not confirmed, not superseded)                │
      └────────────────────────────────────────────────────────────────────────┘
```

### Transition Table

| Current State | Event | Condition | Next State | Action |
|---------------|-------|-----------|------------|--------|
| PENDING | Receive broadcast with `clientSeq=N` | N matches | CONFIRMED | Remove from tracking |
| PENDING | Receive broadcast from other player | Same (trackId, step) | SUPERSEDED | Mark superseded |
| PENDING | Receive snapshot | Contradicts AND not superseded | LOST | **LOG VIOLATION** |
| PENDING | Receive snapshot | Matches local | CONFIRMED | Remove from tracking |
| PENDING | Timeout (30s) | - | LOST | **LOG VIOLATION** |

---

## Implementation

### Data Structures

```typescript
interface TrackedMutation {
  seq: number;                    // My sequence number
  type: string;                   // Message type ('toggle_step', etc.)
  trackId: string;                // Which track
  step?: number;                  // Which step (for toggle_step)
  intendedValue?: boolean;        // What we wanted (for toggle_step)
  sentAt: number;                 // Local timestamp
  sentAtServerTime: number;       // Estimated server time
  state: 'pending' | 'confirmed' | 'superseded' | 'lost';
}

// Track unconfirmed mutations by sequence number
private trackedMutations: Map<number, TrackedMutation> = new Map();

// Track which (trackId, step) pairs were touched by other players
private supersededKeys: Set<string> = new Set();  // "trackId:step"
```

### Hook Points (3 locations)

#### 1. On Send (track mutation)

```typescript
// In send(), after adding seq:
if (MUTATING_MESSAGE_TYPES.has(message.type)) {
  const mutation: TrackedMutation = {
    seq: messageWithSeq.seq!,
    type: message.type,
    trackId: (message as any).trackId,
    step: (message as any).step,
    intendedValue: message.type === 'toggle_step'
      ? !this.getLocalStepValue((message as any).trackId, (message as any).step)
      : undefined,
    sentAt: Date.now(),
    sentAtServerTime: this.clockSync.getServerTime(),
    state: 'pending',
  };
  this.trackedMutations.set(mutation.seq, mutation);
}
```

#### 2. On Receive Broadcast (confirm or supersede)

```typescript
// In handleMessage(), after parsing:
if (msg.clientSeq !== undefined) {
  // This broadcast confirms one of our messages
  const mutation = this.trackedMutations.get(msg.clientSeq);
  if (mutation) {
    mutation.state = 'confirmed';
    this.trackedMutations.delete(msg.clientSeq);
  }
}

// For step_toggled from another player, mark superseded
if (msg.type === 'step_toggled' && msg.playerId !== this.state.playerId) {
  this.supersededKeys.add(`${msg.trackId}:${msg.step}`);
}
```

#### 3. On Receive Snapshot (check invariant)

```typescript
private checkMutationInvariant(snapshot: SessionState, snapshotTimestamp: number): void {
  const now = Date.now();
  const playerCount = snapshot.players?.length ?? 1;

  for (const [seq, mut] of this.trackedMutations) {
    if (mut.state !== 'pending') continue;

    // Check if superseded
    const key = `${mut.trackId}:${mut.step}`;
    if (this.supersededKeys.has(key)) {
      mut.state = 'superseded';
      continue;
    }

    // Check if snapshot contradicts
    if (mut.type === 'toggle_step' && mut.intendedValue !== undefined) {
      const snapshotTrack = snapshot.tracks.find(t => t.id === mut.trackId);
      const snapshotValue = snapshotTrack?.steps[mut.step!] ?? false;

      if (snapshotValue !== mut.intendedValue) {
        mut.state = 'lost';

        // LOG EVERYTHING NEEDED TO REPRODUCE
        logger.error('[INVARIANT VIOLATION] Unconfirmed mutation contradicted by snapshot', {
          // What was lost
          mutation: {
            seq: mut.seq,
            type: mut.type,
            trackId: mut.trackId,
            step: mut.step,
            intendedValue: mut.intendedValue,
            actualValue: snapshotValue,
          },

          // Timing (for causality analysis)
          timing: {
            mutationAge: now - mut.sentAt,
            mutationServerTime: mut.sentAtServerTime,
            snapshotTimestamp,
            gap: snapshotTimestamp - mut.sentAtServerTime,
            rttMs: this.clockSync.getRtt(),
          },

          // Connection state (for reproduction)
          connection: {
            wsReadyState: this.ws?.readyState,
            wsReadyStateLabel: ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'][this.ws?.readyState ?? 3],
            lastServerSeq: this.lastServerSeq,
            outOfOrderCount: this.outOfOrderCount,
            playerCount,
          },

          // Context
          sessionId: this.sessionId,
          playerId: this.state.playerId,
        });
      }
    }
  }

  // Clear superseded set after snapshot (fresh start)
  this.supersededKeys.clear();

  // Prune old mutations (> 30s)
  for (const [seq, mut] of this.trackedMutations) {
    if (now - mut.sentAt > 30000) {
      if (mut.state === 'pending') {
        logger.warn('[MUTATION TIMEOUT] Mutation never confirmed', { seq, mutation: mut });
      }
      this.trackedMutations.delete(seq);
    }
  }
}
```

---

## Test Scenarios

### Scenario 1: Original Bug (Single Player, Steps Lost)

**Setup**: Single player, add steps to track

**Sequence**:
1. Player toggles step 5 ON → sends `seq: 42`
2. Connection degrades (appears OPEN but not delivering)
3. Player toggles more steps → sends `seq: 43, 44, 45`
4. Connection drops, reconnects
5. Server sends snapshot (steps are all OFF)

**Expected Detection**:
```json
{
  "level": "error",
  "message": "[INVARIANT VIOLATION] Unconfirmed mutation contradicted by snapshot",
  "mutation": { "seq": 42, "step": 5, "intendedValue": true, "actualValue": false },
  "timing": { "mutationAge": 5234, "gap": 4800 },
  "connection": { "wsReadyState": 1, "playerCount": 1 }
}
```

**Invariant violated**: Single player, mutation unconfirmed, snapshot contradicts.

### Scenario 2: Multi-Player, Other Player Supersedes

**Setup**: Two players

**Sequence**:
1. Player A toggles step 5 ON → sends `seq: 42`
2. Player B toggles step 5 OFF → server broadcasts with `playerId: B`
3. Player A receives broadcast, marks (track, step 5) superseded
4. Snapshot arrives showing step 5 = OFF

**Expected**: NO violation (superseded explains discrepancy)

### Scenario 3: Multi-Player, True Loss

**Setup**: Two players

**Sequence**:
1. Player A toggles step 5 ON → sends `seq: 42`
2. Player B toggles step 7 (different step)
3. Snapshot arrives showing step 5 = OFF

**Expected Detection**: Violation logged (step 5 was not superseded)

### Scenario 4: Normal Operation

**Setup**: Single player

**Sequence**:
1. Player toggles step 5 → sends `seq: 42`
2. Server broadcasts `{ type: 'step_toggled', clientSeq: 42 }`
3. Client removes seq 42 from tracking (confirmed)
4. Snapshot arrives

**Expected**: No violation (mutation was confirmed before snapshot)

### Scenario 5: Delayed Confirmation

**Setup**: Single player, slow network

**Sequence**:
1. Player toggles step 5 → sends `seq: 42`
2. 2 seconds pass (no confirmation yet)
3. Snapshot arrives showing step 5 = ON (server has it!)

**Expected**: No violation (snapshot matches intended value, mutation confirmed implicitly)

### Scenario 6: Timeout Without Snapshot

**Setup**: Single player, connection stuck

**Sequence**:
1. Player toggles step 5 → sends `seq: 42`
2. 30 seconds pass, no confirmation, no snapshot

**Expected Warning**:
```json
{
  "level": "warn",
  "message": "[MUTATION TIMEOUT] Mutation never confirmed",
  "seq": 42,
  "mutation": { "type": "toggle_step", "step": 5 }
}
```

---

## What We Learn From Logs

### If Violation Logged

The log contains everything needed to reproduce:

1. **What was lost**: `mutation.seq`, `mutation.step`, `mutation.intendedValue`
2. **Timing**: `mutationAge` (how long ago), `gap` (time between mutation and snapshot)
3. **Connection state**: `wsReadyState`, `playerCount`
4. **Session**: `sessionId` for investigating server logs

### Reproduction Checklist

From the log:

- [ ] `playerCount === 1`? → Single player, no supersession possible
- [ ] `wsReadyState === 1`? → Connection appeared OPEN
- [ ] `gap > rttMs * 2`? → Mutation should have arrived before snapshot
- [ ] `mutationAge < 30000`? → Not a stale mutation

If all checked → **reliable reproduction of silent message loss**

---

## Integration with Debugging Workflow

### 1. Enable in Debug Mode

Add to debug overlay when `?debug=1`:

```typescript
// Show pending mutations count
Pending Mutations: {trackedMutations.size}
```

### 2. Console Commands

```javascript
// Get all pending mutations
window.__getPendingMutations__()

// Get mutation tracking stats
window.__getMutationStats__()
// Returns: { pending: 2, confirmed: 47, superseded: 3, lost: 1 }
```

### 3. Bug Pattern Registry

Add to `bug-patterns.ts`:

```typescript
{
  id: 'unconfirmed-mutation-lost',
  name: 'Unconfirmed Mutation Lost',
  category: 'sync',
  severity: 'high',
  description: 'Mutation sent but never confirmed, then contradicted by snapshot',
  symptoms: ['Steps disappear', 'Changes not saved', 'State reverts'],
  detection: {
    runtime: () => {
      const stats = window.__getMutationStats__?.();
      return stats?.lost > 0;
    },
    logPatterns: ['INVARIANT VIOLATION.*Unconfirmed mutation'],
  },
  relatedFiles: ['src/sync/multiplayer.ts'],
}
```

---

## Why This Approach

### What We're NOT Doing

| Approach | Why Not |
|----------|---------|
| Server acknowledgments (acks) | ~300 lines, server changes, solves problem we can't reproduce yet |
| CRDTs | Massive complexity, wrong tool for single-master |
| Retry with backoff | Only helps if we KNOW message failed |
| More frequent hash checks | Detects but doesn't explain |

### What We ARE Doing

| Approach | Why |
|----------|-----|
| Use existing `clientSeq` echo | Infrastructure already built, just not connected |
| Track intended outcome | Know what we WANTED, not just what we DID |
| Log for reproduction | Can't fix what we can't reproduce |
| State machine for clarity | Clear transitions, testable |

### Cost

- ~30 lines of new code
- 3 hook points in existing code
- No server changes
- No new network messages
- Negligible runtime overhead (Map of ~50 entries max)

---

## Success Criteria

1. **Detection**: When the original bug occurs, we see `[INVARIANT VIOLATION]` in logs
2. **Reproduction data**: Log contains enough to reproduce (session, timing, connection state)
3. **No false positives**: Multi-player supersession doesn't trigger violation
4. **Normal operation unaffected**: Confirmed mutations are cleaned up quickly

---

## Next Steps (After Detection)

Once we can reliably detect and reproduce:

1. **Analyze logs**: What's the connection state pattern before failures?
2. **Add server-side sequence tracking**: Does server see the messages?
3. **Targeted fix**: Based on what we learn (zombie connection? race condition?)

---

## Phase 13B: Features Built But Never Used

This section documents the gap between what was specified/built in Phase 13B and what is actually used. This pattern of "spec → built → not connected" is a bug category we need to prevent.

### 1. `clientSeq` Echo (Delivery Confirmation) ❌ NOT USED

**Specified in Phase 13B:**
```typescript
// worker/types.ts:182-188
interface ServerMessageSequence {
  seq?: number;       // Server broadcast sequence number
  clientSeq?: number; // Client message seq being responded to
}
```

**Built:**
- Server adds `clientSeq` to broadcasts (`live-session.ts:1007-1013`)
- Client receives messages with `clientSeq` field populated

**NOT Used:**
```typescript
// multiplayer.ts:862-875 - We track server seq, but IGNORE clientSeq
if (msg.seq !== undefined) {
  // We check SERVER sequence for ordering...
  // But we never look at msg.clientSeq for confirmation!
}
```

**Original Purpose:** Confirm "the server received and processed MY message #42"

**What We Lost:** Delivery confirmation - the core capability needed to detect lost mutations.

---

### 2. `ack` Field (Last Acknowledged Server Sequence) ❌ NOT USED

**Specified:**
```typescript
// multiplayer.ts:55-58
interface MessageSequence {
  seq?: number;    // Message sequence number (client-incremented)
  ack?: number;    // Last acknowledged server sequence  ← NEVER USED
}
```

**Built:**
- Field is defined in the interface
- Client sends `ack: this.lastServerSeq` with every message (`multiplayer.ts:566`)

**NOT Used:**
- Server never reads the `ack` field
- No code path uses it for anything

**Original Purpose:** Tell server "I've received up to your message #100" (enables server-side gap detection)

**What We Lost:** Server cannot detect when client is falling behind or missing messages.

---

### 3. `outOfOrderCount` (Connection Quality Metric) ⚠️ TRACKED BUT NOT SURFACED

**Built:**
```typescript
// multiplayer.ts:478
private outOfOrderCount: number = 0;

// multiplayer.ts:867
if (msg.seq > expectedSeq) {
  this.outOfOrderCount++;  // Counted...
  logger.ws.warn(...);      // ...logged...
}
// But never exposed to UI, never triggers recovery!
```

**Original Purpose:** Detect when messages are being lost or reordered

**What We Lost:** Warning indicator that connection quality is degraded before data loss occurs.

---

### Impact Analysis: What Would Change If Used

| Feature | If We Used It | Impact |
|---------|---------------|--------|
| `clientSeq` echo | Track which mutations server confirmed | Detect "sent but never confirmed" - **solves the original bug** |
| `ack` field | Server detects client falling behind | Proactive snapshot before hash mismatch |
| `outOfOrderCount` | Surface in UI when > threshold | User knows connection is degraded |

---

## Bug Patterns

### Bug Pattern 1: Spec-Implementation Gap

**ID:** `spec-implementation-gap`

**Category:** Architecture

**Severity:** High

**Description:** Feature is specified and built, but never connected to the system that needs it. Infrastructure exists but isn't used.

**Symptoms:**
- Code comments reference a feature that doesn't work
- Types/interfaces have fields that are never read
- Tests pass but the feature doesn't actually function

**Examples in Keyboardia:**
| Feature | Specified | Built | Connected |
|---------|-----------|-------|-----------|
| `clientSeq` echo | Phase 13B | ✅ Server sends | ❌ Client ignores |
| `ack` field | Phase 13B | ✅ Client sends | ❌ Server ignores |
| `outOfOrderCount` | Phase 13B | ✅ Tracked | ❌ Not surfaced |
| Handler factories | SYNC-ABSTRACTIONS.md | ✅ Partially | ⚠️ Some handlers |

**Root Cause:** No automated check that "if A sends X, B processes X"

**Detection:**
```typescript
// Proposed: grep for fields that are written but never read
// Example: clientSeq is set in live-session.ts but never read in multiplayer.ts
```

**Prevention:**
1. Spec compliance audit tool
2. Integration tests that verify round-trip behavior
3. Code review checklist: "Is every field that's sent also read?"

---

### Bug Pattern 2: Unconfirmed Mutation Lost

**ID:** `unconfirmed-mutation-lost`

**Category:** Sync

**Severity:** Critical

**Description:** Mutation sent to server but never confirmed. Server didn't receive it, but client assumed success. Snapshot later overwrites local state.

**Symptoms:**
- Steps disappear after a period of time
- Changes not saved
- State reverts to earlier version
- Only affects tracks user recently edited

**Root Cause:** WebSocket `send()` succeeds (message queued) but message never reaches server. No delivery confirmation mechanism.

**Detection:**
```typescript
// Runtime detection
if (trackedMutation.state === 'pending' && snapshotContradicts) {
  log('[INVARIANT VIOLATION] Unconfirmed mutation contradicted');
}

// Log pattern
/INVARIANT VIOLATION.*Unconfirmed mutation/
```

**Prevention:**
1. Track all mutations with sequence numbers
2. Confirm delivery via `clientSeq` echo
3. Alert user when mutations are pending too long

---

### Bug Pattern 3: Zombie Connection

**ID:** `zombie-connection`

**Category:** Network

**Severity:** High

**Description:** WebSocket appears OPEN (`readyState === 1`) but is not actually delivering messages. Client continues sending, assuming success.

**Symptoms:**
- Connection status shows "connected"
- User's changes don't appear on other devices
- Changes disappear on refresh
- `wsReadyState === 1` in violation logs

**Root Cause:** TCP connection is technically open but the path is blocked (NAT timeout, proxy issue, mobile network switch).

**Detection:**
```typescript
// No server messages received for extended period
if (Date.now() - lastServerMessageAt > 30000 && ws.readyState === 1) {
  log('[ZOMBIE CONNECTION] WebSocket OPEN but silent');
}
```

**Prevention:**
1. Periodic ping/pong with timeout
2. Reconnect if no server messages for N seconds
3. Surface "connection quality" indicator

---

### Bug Pattern 4: Snapshot Overwrites Recent Work

**ID:** `snapshot-overwrites-work`

**Category:** Sync

**Severity:** Critical

**Description:** Snapshot arrives from server and replaces local state, losing user's recent edits that hadn't been synced.

**Symptoms:**
- Work disappears immediately after reconnection
- State "jumps back" to earlier version
- Multiple steps disappear at once

**Root Cause:** Snapshot application doesn't consider pending local mutations.

**Detection:**
```typescript
// On snapshot receive, check for pending mutations
if (pendingMutations.size > 0 && snapshotContradicts) {
  log('[SNAPSHOT OVERWRITES WORK] Snapshot contradicts pending mutations');
}
```

**Prevention:**
1. Track pending mutations
2. Log when snapshot contradicts pending work
3. Consider: don't apply snapshot for state that has pending mutations (complex)

---

## Comprehensive Test Scenarios

### Unit Tests: TrackedMutation State Machine

```typescript
describe('TrackedMutation state machine', () => {
  describe('PENDING → CONFIRMED', () => {
    it('should transition when clientSeq echo received', () => {
      tracker.trackMutation({ seq: 42, type: 'toggle_step', trackId: 't1', step: 5 });
      expect(tracker.getState(42)).toBe('pending');

      tracker.handleBroadcast({ clientSeq: 42, type: 'step_toggled' });
      expect(tracker.getState(42)).toBeUndefined(); // Removed after confirm
    });

    it('should not confirm for different clientSeq', () => {
      tracker.trackMutation({ seq: 42, ... });
      tracker.handleBroadcast({ clientSeq: 43 }); // Different seq
      expect(tracker.getState(42)).toBe('pending');
    });

    it('should handle multiple pending mutations', () => {
      tracker.trackMutation({ seq: 42, ... });
      tracker.trackMutation({ seq: 43, ... });
      tracker.trackMutation({ seq: 44, ... });

      tracker.handleBroadcast({ clientSeq: 43 });

      expect(tracker.getState(42)).toBe('pending');
      expect(tracker.getState(43)).toBeUndefined();
      expect(tracker.getState(44)).toBe('pending');
    });
  });

  describe('PENDING → SUPERSEDED', () => {
    it('should transition when other player touches same step', () => {
      tracker.trackMutation({ seq: 42, type: 'toggle_step', trackId: 't1', step: 5, intendedValue: true });

      tracker.handleBroadcast({ type: 'step_toggled', trackId: 't1', step: 5, playerId: 'other' });

      expect(tracker.isSuperseded('t1', 5)).toBe(true);
    });

    it('should not supersede for different step', () => {
      tracker.trackMutation({ seq: 42, trackId: 't1', step: 5 });

      tracker.handleBroadcast({ type: 'step_toggled', trackId: 't1', step: 6, playerId: 'other' });

      expect(tracker.isSuperseded('t1', 5)).toBe(false);
    });

    it('should not supersede for own message', () => {
      tracker.trackMutation({ seq: 42, trackId: 't1', step: 5 });

      tracker.handleBroadcast({ type: 'step_toggled', trackId: 't1', step: 5, playerId: 'self' });

      expect(tracker.isSuperseded('t1', 5)).toBe(false);
    });
  });

  describe('PENDING → LOST', () => {
    it('should log violation when snapshot contradicts pending mutation', () => {
      const logSpy = vi.spyOn(logger, 'error');

      tracker.trackMutation({ seq: 42, type: 'toggle_step', trackId: 't1', step: 5, intendedValue: true });

      tracker.checkInvariant({
        tracks: [{ id: 't1', steps: [false, false, false, false, false, false] }]
      }, Date.now());

      expect(logSpy).toHaveBeenCalledWith(
        '[INVARIANT VIOLATION] Unconfirmed mutation contradicted by snapshot',
        expect.objectContaining({
          mutation: expect.objectContaining({ seq: 42, intendedValue: true, actualValue: false })
        })
      );
    });

    it('should NOT log violation when snapshot matches intended value', () => {
      const logSpy = vi.spyOn(logger, 'error');

      tracker.trackMutation({ seq: 42, trackId: 't1', step: 5, intendedValue: true });

      tracker.checkInvariant({
        tracks: [{ id: 't1', steps: [false, false, false, false, false, true] }]
      }, Date.now());

      expect(logSpy).not.toHaveBeenCalled();
    });

    it('should NOT log violation when mutation is superseded', () => {
      const logSpy = vi.spyOn(logger, 'error');

      tracker.trackMutation({ seq: 42, trackId: 't1', step: 5, intendedValue: true });
      tracker.handleBroadcast({ type: 'step_toggled', trackId: 't1', step: 5, playerId: 'other' });

      tracker.checkInvariant({
        tracks: [{ id: 't1', steps: [false, false, false, false, false, false] }]
      }, Date.now());

      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('Timeout', () => {
    it('should warn after 30 seconds without confirmation', () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(logger, 'warn');

      tracker.trackMutation({ seq: 42, type: 'toggle_step', sentAt: Date.now() });

      vi.advanceTimersByTime(31000);
      tracker.pruneOldMutations();

      expect(warnSpy).toHaveBeenCalledWith(
        '[MUTATION TIMEOUT] Mutation never confirmed',
        expect.objectContaining({ seq: 42 })
      );
    });
  });
});
```

### Unit Tests: Invariant Log Content

```typescript
describe('Invariant violation logging', () => {
  it('should include all reproduction data', () => {
    const logSpy = vi.spyOn(logger, 'error');

    tracker.trackMutation({
      seq: 42,
      type: 'toggle_step',
      trackId: 'synth-1',
      step: 5,
      intendedValue: true,
      sentAt: Date.now() - 5000,
      sentAtServerTime: 1702934567920,
    });

    tracker.checkInvariant(snapshotWithStepOff, 1702934570000);

    const logCall = logSpy.mock.calls[0];
    const logData = logCall[1];

    // Verify all reproduction data is present
    expect(logData.mutation).toEqual({
      seq: 42,
      type: 'toggle_step',
      trackId: 'synth-1',
      step: 5,
      intendedValue: true,
      actualValue: false,
    });

    expect(logData.timing).toEqual({
      mutationAge: expect.any(Number),
      mutationServerTime: 1702934567920,
      snapshotTimestamp: 1702934570000,
      gap: 2080,
      rttMs: expect.any(Number),
    });

    expect(logData.connection).toEqual({
      wsReadyState: expect.any(Number),
      wsReadyStateLabel: expect.stringMatching(/CONNECTING|OPEN|CLOSING|CLOSED/),
      lastServerSeq: expect.any(Number),
      outOfOrderCount: expect.any(Number),
      playerCount: expect.any(Number),
    });

    expect(logData.sessionId).toBeDefined();
    expect(logData.playerId).toBeDefined();
  });
});
```

### Integration Tests: End-to-End Scenarios

```typescript
describe('Mutation tracking integration', () => {
  describe('Scenario 1: Original Bug (Single Player, Steps Lost)', () => {
    it('should detect lost mutation when snapshot contradicts', async () => {
      const { multiplayer, mockWs } = createTestMultiplayer();
      const logSpy = vi.spyOn(logger, 'error');

      // 1. Player toggles step 5 ON
      multiplayer.send({ type: 'toggle_step', trackId: 't1', step: 5 });

      // 2. Simulate connection degradation (messages don't reach server)
      // No clientSeq echo received

      // 3. Player toggles more steps
      multiplayer.send({ type: 'toggle_step', trackId: 't1', step: 6 });
      multiplayer.send({ type: 'toggle_step', trackId: 't1', step: 7 });

      // 4. Connection drops, reconnects
      mockWs.close();
      await multiplayer.reconnect();

      // 5. Server sends snapshot (steps are all OFF)
      mockWs.receive({
        type: 'snapshot',
        state: { tracks: [{ id: 't1', steps: Array(16).fill(false) }] },
        players: [{ id: 'self' }],
        snapshotTimestamp: Date.now(),
      });

      // Should detect violation for all 3 mutations
      expect(logSpy).toHaveBeenCalledTimes(3);
      expect(logSpy).toHaveBeenCalledWith(
        '[INVARIANT VIOLATION] Unconfirmed mutation contradicted by snapshot',
        expect.objectContaining({ mutation: expect.objectContaining({ step: 5 }) })
      );
    });
  });

  describe('Scenario 2: Multi-Player, Other Player Supersedes', () => {
    it('should NOT log violation when superseded by other player', async () => {
      const { multiplayer, mockWs } = createTestMultiplayer();
      const logSpy = vi.spyOn(logger, 'error');

      // 1. Player A toggles step 5 ON
      multiplayer.send({ type: 'toggle_step', trackId: 't1', step: 5 });

      // 2. Player B toggles step 5 OFF (before we get confirmation)
      mockWs.receive({
        type: 'step_toggled',
        trackId: 't1',
        step: 5,
        value: false,
        playerId: 'player-b', // Different player
      });

      // 3. Snapshot arrives showing step 5 = OFF
      mockWs.receive({
        type: 'snapshot',
        state: { tracks: [{ id: 't1', steps: Array(16).fill(false) }] },
        players: [{ id: 'self' }, { id: 'player-b' }],
      });

      // Should NOT log violation (superseded explains it)
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 3: Normal Operation', () => {
    it('should not log when mutation is confirmed before snapshot', async () => {
      const { multiplayer, mockWs } = createTestMultiplayer();
      const logSpy = vi.spyOn(logger, 'error');

      // 1. Player toggles step
      multiplayer.send({ type: 'toggle_step', trackId: 't1', step: 5 });
      const sentSeq = multiplayer.getLastSentSeq();

      // 2. Server confirms via clientSeq echo
      mockWs.receive({
        type: 'step_toggled',
        trackId: 't1',
        step: 5,
        value: true,
        playerId: 'self',
        clientSeq: sentSeq, // Confirmation!
      });

      // 3. Later, snapshot arrives
      mockWs.receive({
        type: 'snapshot',
        state: { tracks: [{ id: 't1', steps: [false, false, false, false, false, true] }] },
        players: [{ id: 'self' }],
      });

      // Should NOT log violation (was confirmed)
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('Scenario 4: Delayed Confirmation via Snapshot Match', () => {
    it('should implicitly confirm when snapshot matches intended value', async () => {
      const { multiplayer, mockWs } = createTestMultiplayer();
      const logSpy = vi.spyOn(logger, 'error');

      // 1. Player toggles step (wants it ON)
      multiplayer.send({ type: 'toggle_step', trackId: 't1', step: 5 });

      // 2. No clientSeq echo received (slow network)

      // 3. Snapshot arrives showing step 5 = ON (server has it!)
      mockWs.receive({
        type: 'snapshot',
        state: { tracks: [{ id: 't1', steps: [false, false, false, false, false, true] }] },
        players: [{ id: 'self' }],
      });

      // Should NOT log violation (snapshot matches what we wanted)
      expect(logSpy).not.toHaveBeenCalled();

      // Mutation should be cleaned up (implicitly confirmed)
      expect(multiplayer.getPendingMutationCount()).toBe(0);
    });
  });

  describe('Scenario 5: Multi-Player, True Loss', () => {
    it('should log violation when other player touches different step', async () => {
      const { multiplayer, mockWs } = createTestMultiplayer();
      const logSpy = vi.spyOn(logger, 'error');

      // 1. Player A toggles step 5
      multiplayer.send({ type: 'toggle_step', trackId: 't1', step: 5 });

      // 2. Player B toggles step 7 (DIFFERENT step - doesn't supersede)
      mockWs.receive({
        type: 'step_toggled',
        trackId: 't1',
        step: 7,
        value: true,
        playerId: 'player-b',
      });

      // 3. Snapshot arrives showing step 5 = OFF
      mockWs.receive({
        type: 'snapshot',
        state: { tracks: [{ id: 't1', steps: Array(16).fill(false) }] },
        players: [{ id: 'self' }, { id: 'player-b' }],
      });

      // Should log violation (step 5 was not superseded, but is wrong)
      expect(logSpy).toHaveBeenCalledWith(
        '[INVARIANT VIOLATION] Unconfirmed mutation contradicted by snapshot',
        expect.objectContaining({ mutation: expect.objectContaining({ step: 5 }) })
      );
    });
  });
});
```

### Integration Tests: Timing and Causality

```typescript
describe('Temporal invariant checks', () => {
  it('should include timing gap in violation log', () => {
    const { multiplayer, mockWs } = createTestMultiplayer();
    const logSpy = vi.spyOn(logger, 'error');

    // Mutation sent at server time T1
    const mutationServerTime = 1702934567920;
    vi.spyOn(multiplayer.clockSync, 'getServerTime').mockReturnValue(mutationServerTime);

    multiplayer.send({ type: 'toggle_step', trackId: 't1', step: 5 });

    // Snapshot created at server time T2 (2 seconds later)
    const snapshotTimestamp = mutationServerTime + 2000;

    mockWs.receive({
      type: 'snapshot',
      state: { tracks: [{ id: 't1', steps: Array(16).fill(false) }] },
      snapshotTimestamp,
    });

    const logData = logSpy.mock.calls[0][1];
    expect(logData.timing.gap).toBe(2000);
    expect(logData.timing.mutationServerTime).toBe(mutationServerTime);
    expect(logData.timing.snapshotTimestamp).toBe(snapshotTimestamp);
  });

  it('should flag when gap is much larger than RTT', () => {
    // If gap >> 2*RTT, message definitely should have arrived
    const { multiplayer, mockWs } = createTestMultiplayer();
    const logSpy = vi.spyOn(logger, 'error');

    vi.spyOn(multiplayer.clockSync, 'getRtt').mockReturnValue(50); // 50ms RTT

    multiplayer.send({ type: 'toggle_step', trackId: 't1', step: 5 });

    // Snapshot arrives 5 seconds later (100x the RTT)
    mockWs.receive({
      type: 'snapshot',
      state: { tracks: [{ id: 't1', steps: Array(16).fill(false) }] },
      snapshotTimestamp: Date.now() + 5000,
    });

    const logData = logSpy.mock.calls[0][1];
    expect(logData.timing.gap).toBeGreaterThan(logData.timing.rttMs * 10);
  });
});
```

### E2E Tests: Real Browser Behavior

```typescript
// e2e/mutation-tracking.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Mutation tracking E2E', () => {
  test('should detect lost mutations in production-like scenario', async ({ page, context }) => {
    // Setup console log capture
    const consoleLogs: string[] = [];
    page.on('console', msg => consoleLogs.push(msg.text()));

    // Navigate to session
    await page.goto('/s/test-session?debug=1');

    // Toggle several steps rapidly
    for (let i = 0; i < 5; i++) {
      await page.click(`[data-step="${i}"]`);
    }

    // Simulate network interruption
    await context.setOffline(true);
    await page.waitForTimeout(1000);
    await context.setOffline(false);

    // Wait for reconnection and snapshot
    await page.waitForSelector('[data-connection-status="connected"]');

    // Check if any violations were logged
    const violations = consoleLogs.filter(log =>
      log.includes('[INVARIANT VIOLATION]')
    );

    // In normal operation, should be 0
    // If network caused data loss, violations will be logged
    console.log(`Detected ${violations.length} violations`);

    // Verify debug overlay shows pending count
    const pendingCount = await page.locator('[data-pending-mutations]').textContent();
    expect(pendingCount).toBe('0'); // After reconnect, should be resolved
  });

  test('debug overlay shows pending mutations count', async ({ page }) => {
    await page.goto('/s/test-session?debug=1');

    // Initially should show 0
    await expect(page.locator('[data-pending-mutations]')).toHaveText('0');

    // Toggle a step
    await page.click('[data-step="0"]');

    // Should briefly show 1 (before confirmation)
    // Note: This may be too fast to catch reliably
  });
});
```

---

## Recommendations

### Priority 1: Immediate (This Spec)

| # | Recommendation | Effort | Impact |
|---|----------------|--------|--------|
| 1.1 | **Implement mutation tracking** | ~30 lines | Detect lost mutations |
| 1.2 | **Use `clientSeq` echo for confirmation** | ~5 lines | Know which mutations server received |
| 1.3 | **Log invariant violations with full context** | ~20 lines | Enable reproduction |
| 1.4 | **Add to debug overlay** | ~10 lines | Visibility during testing |
| 1.5 | **Add bug patterns to registry** | ~30 lines | Runtime detection |

### Priority 2: Short-Term (After Detection Works)

| # | Recommendation | Effort | Impact |
|---|----------------|--------|--------|
| 2.1 | **Surface `outOfOrderCount` in UI** | Low | Warn user of connection issues |
| 2.2 | **Add mutation stats to debug overlay** | Low | Visibility: pending/confirmed/lost |
| 2.3 | **Server-side: Read `ack` field** | Medium | Detect client falling behind |
| 2.4 | **Periodic ping/pong with timeout** | Medium | Detect zombie connections |

### Priority 3: Medium-Term (Prevent Recurrence)

| # | Recommendation | Effort | Impact |
|---|----------------|--------|--------|
| 3.1 | **Spec compliance audit tool** | High | Detect "built but not used" features |
| 3.2 | **Integration tests for round-trip behavior** | Medium | Verify A sends → B processes |
| 3.3 | **Code review checklist update** | Low | Human process improvement |
| 3.4 | **Handler factory migration** | Medium | Systematic sync patterns |

### Priority 4: Long-Term (If Bug Persists)

| # | Recommendation | Effort | Impact |
|---|----------------|--------|--------|
| 4.1 | **Server acknowledgments (full ack system)** | High | Guaranteed delivery |
| 4.2 | **Retry with exponential backoff** | Medium | Recover from transient failures |
| 4.3 | **Pending mutations UI indicator** | Low | User knows sync is in progress |

---

## Spec Compliance Audit Gap

### Current Audit Tools

| Tool | What It Checks | What It Misses |
|------|----------------|----------------|
| `validate-sync-checklist.ts` | Message types exist, handlers exist | Features actually work |
| Type parity tests | Constants match, shapes compatible | Fields are processed |
| Codebase audit (manual) | Code quality, obvious bugs | Unused infrastructure |

### Proposed: Spec Compliance Audit

```typescript
// scripts/audit-spec-compliance.ts

interface FeatureCheck {
  name: string;
  specLocation: string;
  implementation: { file: string; line: number };
  usage: { expected: string[]; actual: string[] };
  status: 'used' | 'built-not-used' | 'not-built';
}

const FEATURES_TO_CHECK: FeatureCheck[] = [
  {
    name: 'clientSeq delivery confirmation',
    specLocation: 'PHASE-13B-LESSONS.md',
    implementation: { file: 'live-session.ts', line: 1013 },
    usage: {
      expected: ['multiplayer.ts: confirm delivery'],
      actual: [],  // Grep for msg.clientSeq usage
    },
    status: 'built-not-used',
  },
  {
    name: 'ack field for gap detection',
    specLocation: 'PHASE-13B-LESSONS.md',
    implementation: { file: 'multiplayer.ts', line: 566 },
    usage: {
      expected: ['live-session.ts: detect client behind'],
      actual: [],  // Grep for msg.ack usage
    },
    status: 'built-not-used',
  },
  // ... more features
];

function auditSpecCompliance(): void {
  for (const feature of FEATURES_TO_CHECK) {
    if (feature.actual.length === 0) {
      console.warn(`[SPEC GAP] ${feature.name}: built but not used`);
      console.warn(`  Spec: ${feature.specLocation}`);
      console.warn(`  Built: ${feature.implementation.file}:${feature.implementation.line}`);
      console.warn(`  Expected usage: ${feature.usage.expected.join(', ')}`);
    }
  }
}
```

---

## References

### Existing Infrastructure

- `multiplayer.ts:476`: `clientSeq` tracking
- `multiplayer.ts:566`: Adding `seq` to outgoing messages
- `live-session.ts:1007-1013`: Server echoes `clientSeq` in broadcasts
- `clockSync.getServerTime()`: Shared clock for temporal reasoning

### Related Specs

- `PHASE-13B-LESSONS.md`: Original sequence number implementation
- `ARCHITECTURE.md`: Clock sync design
- `ARCHITECTURE-PRINCIPLES.md`: The 10 architectural principles
- `DEBUGGING-WORKFLOW.md`: How this fits into debugging

### Archived

- `archive/CLIENT-RESILIENCE.md`: Over-engineered solution, archived in favor of this approach
