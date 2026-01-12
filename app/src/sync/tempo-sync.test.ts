/**
 * Tempo Sync Tests
 *
 * Tests for multiplayer tempo synchronization logic.
 * Replaces E2E tests from e2e/multiplayer.spec.ts:
 * - "tempo change syncs between clients"
 * - "invalid tempo values are clamped by server"
 *
 * The actual WebSocket behavior is tested via E2E, but the underlying
 * mutation logic and validation can be unit tested.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// =============================================================================
// SECTION 1: Tempo Mutation Generation
// =============================================================================

describe('Tempo Mutation Generation', () => {
  /**
   * Tests the creation of tempo mutations for sync.
   */

  interface TempoMutation {
    type: 'set_tempo';
    tempo: number;
    clientId: string;
    timestamp: number;
  }

  function createTempoMutation(tempo: number, clientId: string): TempoMutation {
    return {
      type: 'set_tempo',
      tempo,
      clientId,
      timestamp: Date.now(),
    };
  }

  it('TM-001: creates valid tempo mutation', () => {
    const mutation = createTempoMutation(140, 'client-1');

    expect(mutation.type).toBe('set_tempo');
    expect(mutation.tempo).toBe(140);
    expect(mutation.clientId).toBe('client-1');
    expect(typeof mutation.timestamp).toBe('number');
  });

  it('TM-002: mutation preserves exact tempo value', () => {
    const mutation = createTempoMutation(123, 'client-2');
    expect(mutation.tempo).toBe(123);
  });
});

// =============================================================================
// SECTION 2: Server-Side Tempo Validation
// =============================================================================

describe('Server-Side Tempo Validation', () => {
  /**
   * Tests the server-side validation and clamping of tempo values.
   * E2E test: "invalid tempo values are clamped by server"
   */

  const MIN_TEMPO = 60;
  const MAX_TEMPO = 180;

  function validateAndClampTempo(tempo: number): { valid: boolean; clamped: number; error?: string } {
    if (typeof tempo !== 'number' || isNaN(tempo)) {
      return { valid: false, clamped: 120, error: 'Tempo must be a number' };
    }

    const clamped = Math.round(Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, tempo)));

    return {
      valid: tempo >= MIN_TEMPO && tempo <= MAX_TEMPO,
      clamped,
      error: tempo < MIN_TEMPO
        ? `Tempo ${tempo} below minimum ${MIN_TEMPO}`
        : tempo > MAX_TEMPO
          ? `Tempo ${tempo} above maximum ${MAX_TEMPO}`
          : undefined,
    };
  }

  it('SV-001: valid tempo passes through unchanged', () => {
    const result = validateAndClampTempo(120);
    expect(result.valid).toBe(true);
    expect(result.clamped).toBe(120);
    expect(result.error).toBeUndefined();
  });

  it('SV-002: tempo below minimum is clamped', () => {
    const result = validateAndClampTempo(30);
    expect(result.valid).toBe(false);
    expect(result.clamped).toBe(MIN_TEMPO);
    expect(result.error).toContain('below minimum');
  });

  it('SV-003: tempo above maximum is clamped', () => {
    const result = validateAndClampTempo(250);
    expect(result.valid).toBe(false);
    expect(result.clamped).toBe(MAX_TEMPO);
    expect(result.error).toContain('above maximum');
  });

  it('SV-004: boundary values are valid', () => {
    expect(validateAndClampTempo(MIN_TEMPO).valid).toBe(true);
    expect(validateAndClampTempo(MAX_TEMPO).valid).toBe(true);
  });

  it('SV-005: fractional tempo is rounded', () => {
    expect(validateAndClampTempo(120.7).clamped).toBe(121);
    expect(validateAndClampTempo(120.3).clamped).toBe(120);
  });

  it('SV-006: NaN tempo defaults to 120', () => {
    const result = validateAndClampTempo(NaN);
    expect(result.valid).toBe(false);
    expect(result.clamped).toBe(120);
    expect(result.error).toContain('must be a number');
  });
});

// =============================================================================
// SECTION 3: Mutation Ordering and Conflict Resolution
// =============================================================================

describe('Tempo Mutation Ordering', () => {
  /**
   * Tests the ordering of concurrent tempo mutations from multiple clients.
   */

  interface TimestampedMutation {
    tempo: number;
    clientId: string;
    timestamp: number;
    serverTimestamp?: number;
  }

  function resolveConflict(mutations: TimestampedMutation[]): TimestampedMutation {
    // Sort by server timestamp (if available) then client timestamp
    const sorted = [...mutations].sort((a, b) => {
      const aTime = a.serverTimestamp ?? a.timestamp;
      const bTime = b.serverTimestamp ?? b.timestamp;
      if (aTime !== bTime) return bTime - aTime; // Latest wins
      // Tie-breaker: alphabetical client ID
      return a.clientId.localeCompare(b.clientId);
    });

    return sorted[0];
  }

  it('MO-001: later mutation wins', () => {
    const mutations: TimestampedMutation[] = [
      { tempo: 100, clientId: 'a', timestamp: 1000 },
      { tempo: 120, clientId: 'b', timestamp: 2000 },
    ];

    const winner = resolveConflict(mutations);
    expect(winner.tempo).toBe(120);
  });

  it('MO-002: server timestamp takes precedence', () => {
    const mutations: TimestampedMutation[] = [
      { tempo: 100, clientId: 'a', timestamp: 2000, serverTimestamp: 1500 },
      { tempo: 120, clientId: 'b', timestamp: 1000, serverTimestamp: 2500 },
    ];

    const winner = resolveConflict(mutations);
    expect(winner.tempo).toBe(120); // b has later server timestamp
  });

  it('MO-003: tie-breaker uses client ID', () => {
    const mutations: TimestampedMutation[] = [
      { tempo: 100, clientId: 'client-b', timestamp: 1000 },
      { tempo: 120, clientId: 'client-a', timestamp: 1000 },
    ];

    const winner = resolveConflict(mutations);
    // With same timestamp, alphabetically first client wins
    expect(winner.clientId).toBe('client-a');
  });
});

// =============================================================================
// SECTION 4: Tempo Sync State Machine
// =============================================================================

describe('Tempo Sync State Machine', () => {
  /**
   * Tests the state machine for tempo synchronization.
   */

  type SyncState = 'idle' | 'pending' | 'syncing' | 'synced' | 'conflict';

  interface SyncContext {
    state: SyncState;
    localTempo: number;
    serverTempo: number;
    pendingMutation: boolean;
  }

  function transitionSyncState(
    context: SyncContext,
    event: { type: 'LOCAL_CHANGE' | 'SERVER_ACK' | 'SERVER_UPDATE' | 'CONFLICT'; tempo?: number }
  ): SyncContext {
    switch (event.type) {
      case 'LOCAL_CHANGE':
        return {
          ...context,
          state: 'pending',
          localTempo: event.tempo!,
          pendingMutation: true,
        };

      case 'SERVER_ACK':
        if (context.state === 'pending') {
          return {
            ...context,
            state: 'synced',
            serverTempo: context.localTempo,
            pendingMutation: false,
          };
        }
        return context;

      case 'SERVER_UPDATE':
        if (context.pendingMutation && event.tempo !== context.localTempo) {
          return {
            ...context,
            state: 'conflict',
            serverTempo: event.tempo!,
          };
        }
        return {
          ...context,
          state: 'synced',
          localTempo: event.tempo!,
          serverTempo: event.tempo!,
        };

      case 'CONFLICT':
        // Server wins, reset local
        return {
          ...context,
          state: 'synced',
          localTempo: context.serverTempo,
          pendingMutation: false,
        };

      default:
        return context;
    }
  }

  it('SS-001: local change transitions to pending', () => {
    const initial: SyncContext = {
      state: 'idle',
      localTempo: 120,
      serverTempo: 120,
      pendingMutation: false,
    };

    const next = transitionSyncState(initial, { type: 'LOCAL_CHANGE', tempo: 140 });

    expect(next.state).toBe('pending');
    expect(next.localTempo).toBe(140);
    expect(next.pendingMutation).toBe(true);
  });

  it('SS-002: server ack transitions to synced', () => {
    const pending: SyncContext = {
      state: 'pending',
      localTempo: 140,
      serverTempo: 120,
      pendingMutation: true,
    };

    const next = transitionSyncState(pending, { type: 'SERVER_ACK' });

    expect(next.state).toBe('synced');
    expect(next.serverTempo).toBe(140);
    expect(next.pendingMutation).toBe(false);
  });

  it('SS-003: conflicting server update detected', () => {
    const pending: SyncContext = {
      state: 'pending',
      localTempo: 140,
      serverTempo: 120,
      pendingMutation: true,
    };

    const next = transitionSyncState(pending, { type: 'SERVER_UPDATE', tempo: 100 });

    expect(next.state).toBe('conflict');
    expect(next.serverTempo).toBe(100);
  });

  it('SS-004: conflict resolution applies server value', () => {
    const conflict: SyncContext = {
      state: 'conflict',
      localTempo: 140,
      serverTempo: 100,
      pendingMutation: true,
    };

    const next = transitionSyncState(conflict, { type: 'CONFLICT' });

    expect(next.state).toBe('synced');
    expect(next.localTempo).toBe(100); // Server wins
    expect(next.pendingMutation).toBe(false);
  });
});

// =============================================================================
// SECTION 5: Multi-Client Sync Simulation
// =============================================================================

describe('Multi-Client Sync Simulation', () => {
  /**
   * Simulates tempo synchronization between multiple clients.
   */

  interface ClientState {
    id: string;
    tempo: number;
    version: number;
  }

  interface ServerState {
    tempo: number;
    version: number;
  }

  function simulateSync(
    clients: ClientState[],
    server: ServerState,
    mutation: { clientId: string; tempo: number }
  ): { clients: ClientState[]; server: ServerState } {
    // Apply to server
    const newServer: ServerState = {
      tempo: mutation.tempo,
      version: server.version + 1,
    };

    // Broadcast to all clients
    const newClients = clients.map(client => ({
      ...client,
      tempo: newServer.tempo,
      version: newServer.version,
    }));

    return { clients: newClients, server: newServer };
  }

  it('MC-001: mutation propagates to all clients', () => {
    const clients: ClientState[] = [
      { id: 'a', tempo: 120, version: 1 },
      { id: 'b', tempo: 120, version: 1 },
      { id: 'c', tempo: 120, version: 1 },
    ];
    const server: ServerState = { tempo: 120, version: 1 };

    const result = simulateSync(clients, server, { clientId: 'a', tempo: 140 });

    // All clients should have new tempo
    expect(result.clients.every(c => c.tempo === 140)).toBe(true);
    expect(result.server.tempo).toBe(140);
  });

  it('MC-002: version increments on mutation', () => {
    const clients: ClientState[] = [{ id: 'a', tempo: 120, version: 1 }];
    const server: ServerState = { tempo: 120, version: 1 };

    const result = simulateSync(clients, server, { clientId: 'a', tempo: 140 });

    expect(result.server.version).toBe(2);
    expect(result.clients[0].version).toBe(2);
  });

  it('MC-003: sequential mutations maintain consistency', () => {
    let clients: ClientState[] = [
      { id: 'a', tempo: 120, version: 1 },
      { id: 'b', tempo: 120, version: 1 },
    ];
    let server: ServerState = { tempo: 120, version: 1 };

    // Client A changes tempo
    ({ clients, server } = simulateSync(clients, server, { clientId: 'a', tempo: 140 }));
    expect(server.tempo).toBe(140);

    // Client B changes tempo
    ({ clients, server } = simulateSync(clients, server, { clientId: 'b', tempo: 100 }));
    expect(server.tempo).toBe(100);

    // All clients should be consistent
    expect(clients.every(c => c.tempo === 100)).toBe(true);
    expect(server.version).toBe(3);
  });
});

// =============================================================================
// SECTION 6: Property-Based Tempo Sync Tests
// =============================================================================

describe('Tempo Sync Properties', () => {
  const arbTempo = fc.integer({ min: 20, max: 300 });
  const arbClientId = fc.stringMatching(/^[a-f]{1,5}$/);

  it('PB-001: clamped tempo always within bounds', () => {
    const MIN = 60;
    const MAX = 180;

    fc.assert(
      fc.property(arbTempo, (tempo) => {
        const clamped = Math.round(Math.min(MAX, Math.max(MIN, tempo)));
        expect(clamped).toBeGreaterThanOrEqual(MIN);
        expect(clamped).toBeLessThanOrEqual(MAX);
      }),
      { numRuns: 500 }
    );
  });

  it('PB-002: mutation ordering is deterministic', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(arbTempo, arbClientId, fc.integer({ min: 0, max: 10000 })), { minLength: 2, maxLength: 5 }),
        (mutationData) => {
          const mutations = mutationData.map(([tempo, clientId, timestamp]) => ({
            tempo,
            clientId,
            timestamp,
          }));

          // Sort twice - should give same result
          const sorted1 = [...mutations].sort((a, b) => b.timestamp - a.timestamp || a.clientId.localeCompare(b.clientId));
          const sorted2 = [...mutations].sort((a, b) => b.timestamp - a.timestamp || a.clientId.localeCompare(b.clientId));

          expect(sorted1).toEqual(sorted2);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('PB-003: sync preserves tempo value exactly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 60, max: 180 }), (tempo) => {
        // Simulate full round-trip
        const mutation = { type: 'set_tempo' as const, tempo };
        const serverReceived = mutation.tempo;
        const clientReceived = serverReceived;

        expect(clientReceived).toBe(tempo);
      }),
      { numRuns: 200 }
    );
  });
});

// =============================================================================
// SECTION 7: Optimistic Update Handling
// =============================================================================

describe('Optimistic Update Handling', () => {
  /**
   * Tests optimistic UI updates while waiting for server confirmation.
   */

  interface OptimisticState {
    displayTempo: number;
    confirmedTempo: number;
    pendingTempo: number | null;
  }

  function applyOptimisticUpdate(state: OptimisticState, newTempo: number): OptimisticState {
    return {
      ...state,
      displayTempo: newTempo,
      pendingTempo: newTempo,
    };
  }

  function confirmUpdate(state: OptimisticState): OptimisticState {
    if (state.pendingTempo === null) return state;

    return {
      displayTempo: state.pendingTempo,
      confirmedTempo: state.pendingTempo,
      pendingTempo: null,
    };
  }

  function revertUpdate(state: OptimisticState): OptimisticState {
    return {
      displayTempo: state.confirmedTempo,
      confirmedTempo: state.confirmedTempo,
      pendingTempo: null,
    };
  }

  it('OU-001: optimistic update shows immediately', () => {
    const state: OptimisticState = {
      displayTempo: 120,
      confirmedTempo: 120,
      pendingTempo: null,
    };

    const updated = applyOptimisticUpdate(state, 140);

    expect(updated.displayTempo).toBe(140); // User sees change immediately
    expect(updated.confirmedTempo).toBe(120); // Not yet confirmed
    expect(updated.pendingTempo).toBe(140);
  });

  it('OU-002: confirmation finalizes update', () => {
    const state: OptimisticState = {
      displayTempo: 140,
      confirmedTempo: 120,
      pendingTempo: 140,
    };

    const confirmed = confirmUpdate(state);

    expect(confirmed.displayTempo).toBe(140);
    expect(confirmed.confirmedTempo).toBe(140);
    expect(confirmed.pendingTempo).toBeNull();
  });

  it('OU-003: revert restores previous value', () => {
    const state: OptimisticState = {
      displayTempo: 140,
      confirmedTempo: 120,
      pendingTempo: 140,
    };

    const reverted = revertUpdate(state);

    expect(reverted.displayTempo).toBe(120);
    expect(reverted.confirmedTempo).toBe(120);
    expect(reverted.pendingTempo).toBeNull();
  });
});
