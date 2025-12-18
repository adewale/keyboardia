# Sync Abstractions Specification

## Problem Statement

Adding a new multiplayer-synced feature requires manual updates to **7 different locations** across 4 files, creating a high risk of bugs when any step is missed. The current architecture has:

- **4 duplicated type definitions** between frontend (`types.ts`) and worker (`worker/types.ts`)
- **15 repetitive handler patterns** on both client and server
- **No compile-time safety** to ensure all sync steps are completed

---

## Recommendations Summary

| # | Recommendation | Effort | Impact | Priority |
|---|---------------|--------|--------|----------|
| 1 | Shared Types Package | Low | High | P0 |
| 2 | Track/SessionTrack Parity Tests | Low | High | P0 (Done) |
| 3 | Client Handler Factory | Medium | Medium | P1 |
| 4 | Server Handler Factory | Medium | Medium | P1 |
| 5 | Sync Checklist Validator Script | Medium | High | P1 |
| 6 | SyncAction Registry (Full) | High | Very High | P2 |

---

## Recommendation 1: Shared Types Package

### Problem
Same types defined in two places:
- `FMParams` - `types.ts:36-42` AND `worker/types.ts:60-63`
- `EffectsState` - `types.ts:48-67` AND `worker/types.ts:11-30`
- `ParameterLock` - `types.ts:30-33` AND `worker/types.ts:55-58`
- `PlaybackMode` - imported from `types.ts` into `worker/types.ts`

### Solution
Create `src/shared/sync-types.ts` with canonical definitions imported by both.

### Files to Create/Modify
```
NEW:  src/shared/sync-types.ts      # Canonical type definitions
EDIT: src/types.ts                  # Re-export from shared
EDIT: src/worker/types.ts           # Import from shared
```

### Implementation
```typescript
// src/shared/sync-types.ts
export interface FMParams {
  harmonicity: number;      // 0.5 to 10
  modulationIndex: number;  // 0 to 20
}

export interface ParameterLock {
  pitch?: number;   // -24 to +24 semitones
  volume?: number;  // 0 to 1
}

export interface EffectsState {
  reverb: { decay: number; wet: number };
  delay: { time: string; feedback: number; wet: number };
  chorus: { frequency: number; depth: number; wet: number };
  distortion: { amount: number; wet: number };
}

export type PlaybackMode = 'oneshot' | 'gate';
```

### Testing
```typescript
// src/shared/sync-types.test.ts
import { FMParams, EffectsState, ParameterLock } from './sync-types';
import { FMParams as WorkerFMParams } from '../worker/types';
import { FMParams as FrontendFMParams } from '../types';

// Compile-time test: types are identical
const _fmParityCheck: WorkerFMParams = {} as FrontendFMParams;
const _fmParityCheckReverse: FrontendFMParams = {} as WorkerFMParams;

describe('Shared Types', () => {
  it('should be importable from shared location', () => {
    const fm: FMParams = { harmonicity: 1, modulationIndex: 1 };
    expect(fm).toBeDefined();
  });
});
```

---

## Recommendation 2: Track/SessionTrack Parity Tests

### Status: ✅ ALREADY IMPLEMENTED

Located in `src/state/grid.test.ts` - compile-time type parity checks exist.

### Existing Test
```typescript
// Compile-time parity: Track fields must match SessionTrack
type TrackFields = keyof Track;
type SessionTrackFields = keyof SessionTrack;
const _trackToSession: Record<TrackFields, true> = { ... };
```

### Enhancement
Add runtime field comparison test to catch optional vs required mismatches:
```typescript
it('Track and SessionTrack have same fields', () => {
  const trackFields = Object.keys(createDefaultTrack());
  const sessionFields = Object.keys(trackToSessionTrack(createDefaultTrack()));
  expect(trackFields.sort()).toEqual(sessionFields.sort());
});
```

---

## Recommendation 3: Client Handler Factory

### Problem
15 handlers in `multiplayer.ts` follow identical pattern:
```typescript
private handleXXXChanged(msg: { xxx; playerId: string }): void {
  if (msg.playerId === this.state.playerId) return;  // Skip own
  if (this.dispatch) {
    this.dispatch({ type: 'SET_XXX', xxx: msg.xxx, isRemote: true });
  }
}
```

### Solution
Create `createRemoteHandler` factory function.

### Files to Create/Modify
```
NEW:  src/sync/handler-factory.ts
EDIT: src/sync/multiplayer.ts       # Use factory for handlers
```

### Implementation
```typescript
// src/sync/handler-factory.ts

type DispatchFn = (action: GridAction) => void;

interface HandlerContext {
  playerId: string | null;
  dispatch: DispatchFn | null;
}

/**
 * Creates a handler that skips own messages and dispatches remote actions
 */
export function createRemoteHandler<T extends { playerId: string }>(
  actionCreator: (msg: Omit<T, 'playerId'>) => GridAction,
) {
  return function(this: HandlerContext, msg: T): void {
    if (msg.playerId === this.playerId) return;
    if (this.dispatch) {
      const { playerId: _, ...rest } = msg;
      this.dispatch({ ...actionCreator(rest), isRemote: true });
    }
  };
}

// Usage in multiplayer.ts:
private handleTrackVolumeSet = createRemoteHandler<{
  trackId: string;
  volume: number;
  playerId: string;
}>((msg) => ({
  type: 'SET_TRACK_VOLUME',
  trackId: msg.trackId,
  volume: msg.volume,
}));
```

### Testing
```typescript
// src/sync/handler-factory.test.ts
describe('createRemoteHandler', () => {
  it('should skip own messages', () => {
    const dispatch = vi.fn();
    const handler = createRemoteHandler<{ value: number; playerId: string }>(
      (msg) => ({ type: 'SET_VALUE', value: msg.value })
    );

    const context = { playerId: 'player-1', dispatch };
    handler.call(context, { value: 42, playerId: 'player-1' });

    expect(dispatch).not.toHaveBeenCalled();
  });

  it('should dispatch for remote messages', () => {
    const dispatch = vi.fn();
    const handler = createRemoteHandler<{ value: number; playerId: string }>(
      (msg) => ({ type: 'SET_VALUE', value: msg.value })
    );

    const context = { playerId: 'player-1', dispatch };
    handler.call(context, { value: 42, playerId: 'player-2' });

    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_VALUE',
      value: 42,
      isRemote: true,
    });
  });

  it('should handle null dispatch gracefully', () => {
    const handler = createRemoteHandler<{ value: number; playerId: string }>(
      (msg) => ({ type: 'SET_VALUE', value: msg.value })
    );

    const context = { playerId: 'player-1', dispatch: null };
    expect(() => handler.call(context, { value: 42, playerId: 'player-2' }))
      .not.toThrow();
  });
});
```

---

## Recommendation 4: Server Handler Factory

### Problem
15 handlers in `live-session.ts` follow similar pattern:
```typescript
private handleSetXXX(ws, player, msg): void {
  if (!this.state) return;
  const track = this.state.tracks.find(t => t.id === msg.trackId);
  if (!track) return;
  track.xxx = clamp(msg.xxx, MIN, MAX);
  this.broadcast({ type: 'xxx_changed', ...msg, playerId: player.id });
  this.scheduleKVSave();
}
```

### Solution
Create `createTrackMutationHandler` factory for track-based mutations.

### Files to Create/Modify
```
NEW:  src/worker/handler-factory.ts
EDIT: src/worker/live-session.ts    # Use factory for handlers
```

### Implementation
```typescript
// src/worker/handler-factory.ts

interface TrackMutationConfig<TMsg, TBroadcast> {
  /** Extract track ID from message */
  getTrackId: (msg: TMsg) => string;
  /** Validate and transform the message (clamping, etc.) */
  validate?: (msg: TMsg) => TMsg;
  /** Apply mutation to track */
  mutate: (track: SessionTrack, msg: TMsg) => void;
  /** Create broadcast message */
  toBroadcast: (msg: TMsg, playerId: string) => TBroadcast;
}

export function createTrackMutationHandler<
  TMsg extends { trackId: string },
  TBroadcast extends { playerId: string }
>(config: TrackMutationConfig<TMsg, TBroadcast>) {
  return function(
    this: LiveSessionContext,
    ws: WebSocket,
    player: PlayerInfo,
    msg: TMsg
  ): void {
    if (!this.state) return;

    const trackId = config.getTrackId(msg);
    const track = this.state.tracks.find(t => t.id === trackId);
    if (!track) return;

    const validated = config.validate ? config.validate(msg) : msg;
    config.mutate(track, validated);

    this.broadcast(config.toBroadcast(validated, player.id));
    this.scheduleKVSave();
  };
}

// Usage:
private handleSetTrackVolume = createTrackMutationHandler({
  getTrackId: (msg) => msg.trackId,
  validate: (msg) => ({ ...msg, volume: clamp(msg.volume, 0, 1) }),
  mutate: (track, msg) => { track.volume = msg.volume; },
  toBroadcast: (msg, playerId) => ({
    type: 'track_volume_set' as const,
    trackId: msg.trackId,
    volume: msg.volume,
    playerId,
  }),
});
```

### Testing
```typescript
// src/worker/handler-factory.test.ts
describe('createTrackMutationHandler', () => {
  it('should return early if state is null', () => {
    const handler = createTrackMutationHandler({
      getTrackId: (msg) => msg.trackId,
      mutate: (track, msg) => { track.volume = msg.volume; },
      toBroadcast: (msg, playerId) => ({ type: 'test', playerId }),
    });

    const context = { state: null, broadcast: vi.fn(), scheduleKVSave: vi.fn() };
    handler.call(context, {} as WebSocket, {} as PlayerInfo, { trackId: 't1', volume: 0.5 });

    expect(context.broadcast).not.toHaveBeenCalled();
  });

  it('should return early if track not found', () => {
    const handler = createTrackMutationHandler({ ... });
    const context = {
      state: { tracks: [] },
      broadcast: vi.fn(),
      scheduleKVSave: vi.fn()
    };

    handler.call(context, ws, player, { trackId: 'nonexistent', volume: 0.5 });
    expect(context.broadcast).not.toHaveBeenCalled();
  });

  it('should validate, mutate, broadcast, and save', () => {
    const handler = createTrackMutationHandler({
      getTrackId: (msg) => msg.trackId,
      validate: (msg) => ({ ...msg, volume: Math.min(msg.volume, 1) }),
      mutate: (track, msg) => { track.volume = msg.volume; },
      toBroadcast: (msg, playerId) => ({
        type: 'track_volume_set',
        trackId: msg.trackId,
        volume: msg.volume,
        playerId
      }),
    });

    const track = { id: 't1', volume: 1 };
    const context = {
      state: { tracks: [track] },
      broadcast: vi.fn(),
      scheduleKVSave: vi.fn(),
    };

    handler.call(context, ws, { id: 'p1' }, { trackId: 't1', volume: 1.5 });

    expect(track.volume).toBe(1); // Clamped
    expect(context.broadcast).toHaveBeenCalledWith({
      type: 'track_volume_set',
      trackId: 't1',
      volume: 1,
      playerId: 'p1',
    });
    expect(context.scheduleKVSave).toHaveBeenCalled();
  });
});
```

---

## Recommendation 5: Sync Checklist Validator Script

### Problem
Adding new sync'd feature requires 7 manual steps - easy to miss one.

### Solution
Script that validates all sync checklist items are present for each message type.

### Files to Create
```
NEW:  scripts/validate-sync-checklist.ts
```

### Implementation
```typescript
// scripts/validate-sync-checklist.ts
/**
 * Validates that all multiplayer sync checklist items are complete.
 *
 * For each message type in MUTATING_MESSAGE_TYPES, checks:
 * 1. ClientMessageBase has the type
 * 2. ServerMessageBase has the corresponding broadcast type
 * 3. live-session.ts has a handler in the switch
 * 4. live-session.ts has a handleXXX method
 * 5. multiplayer.ts has a handler in the switch
 * 6. multiplayer.ts has a handleXXX method
 * 7. actionToMessage has a case (if applicable)
 */

import * as fs from 'fs';
import * as path from 'path';

const MUTATING_TYPES = [
  'toggle_step', 'set_tempo', 'set_swing', 'mute_track', 'solo_track',
  'set_parameter_lock', 'add_track', 'delete_track', 'clear_track',
  'set_track_sample', 'set_track_volume', 'set_track_transpose',
  'set_track_step_count', 'set_effects', 'set_fm_params',
];

const CLIENT_TO_SERVER_MAP: Record<string, string> = {
  'toggle_step': 'step_toggled',
  'set_tempo': 'tempo_changed',
  'set_swing': 'swing_changed',
  // ... complete mapping
};

function validateChecklist(): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  const workerTypes = fs.readFileSync('src/worker/types.ts', 'utf-8');
  const liveSession = fs.readFileSync('src/worker/live-session.ts', 'utf-8');
  const multiplayer = fs.readFileSync('src/sync/multiplayer.ts', 'utf-8');

  for (const msgType of MUTATING_TYPES) {
    // Check 1: ClientMessageBase
    if (!workerTypes.includes(`type: '${msgType}'`)) {
      errors.push(`Missing ClientMessageBase: ${msgType}`);
    }

    // Check 2: ServerMessageBase
    const serverType = CLIENT_TO_SERVER_MAP[msgType];
    if (serverType && !workerTypes.includes(`type: '${serverType}'`)) {
      errors.push(`Missing ServerMessageBase: ${serverType}`);
    }

    // Check 3: Server switch case
    if (!liveSession.includes(`case '${msgType}':`)) {
      errors.push(`Missing server switch case: ${msgType}`);
    }

    // Check 4: Server handler method
    const serverHandler = `handle${toPascalCase(msgType)}`;
    if (!liveSession.includes(serverHandler)) {
      errors.push(`Missing server handler: ${serverHandler}`);
    }

    // Check 5: Client switch case
    if (serverType && !multiplayer.includes(`case '${serverType}':`)) {
      errors.push(`Missing client switch case: ${serverType}`);
    }

    // Check 6: Client handler method
    if (serverType) {
      const clientHandler = `handle${toPascalCase(serverType)}`;
      if (!multiplayer.includes(clientHandler)) {
        errors.push(`Missing client handler: ${clientHandler}`);
      }
    }
  }

  return { errors, warnings };
}

// Run validation
const { errors, warnings } = validateChecklist();
if (errors.length > 0) {
  console.error('❌ Sync checklist validation failed:');
  errors.forEach(e => console.error(`  - ${e}`));
  process.exit(1);
} else {
  console.log('✅ Sync checklist validation passed');
}
```

### Testing
```bash
# Add to package.json scripts
"validate:sync": "npx tsx scripts/validate-sync-checklist.ts"

# Add to CI
npm run validate:sync
```

### Test Cases
```typescript
// scripts/validate-sync-checklist.test.ts
describe('validate-sync-checklist', () => {
  it('should detect missing ClientMessageBase type', () => {
    // Mock file with missing type
    const result = validateWithMock({ workerTypes: '// no set_tempo' });
    expect(result.errors).toContain('Missing ClientMessageBase: set_tempo');
  });

  it('should detect missing server handler', () => {
    const result = validateWithMock({ liveSession: '// no handleSetTempo' });
    expect(result.errors).toContain('Missing server handler: handleSetTempo');
  });

  it('should pass for complete implementation', () => {
    const result = validateWithRealFiles();
    expect(result.errors).toHaveLength(0);
  });
});
```

---

## Recommendation 6: SyncAction Registry (Future)

### Problem
Even with factories, adding new sync still requires editing 7 files.

### Solution
Declarative registry that generates everything from a single definition.

### Deferral Rationale
- High complexity (~500 lines)
- Requires TypeScript codegen or runtime registration
- Recommendations 1-5 provide 80% of the benefit with 20% of the effort

### Future Design Sketch
```typescript
// src/sync/registry.ts
export const syncActions = createSyncRegistry({
  trackVolume: {
    mutating: true,
    client: { type: 'set_track_volume', params: { trackId: 'string', volume: 'number' } },
    server: { type: 'track_volume_set', params: { trackId: 'string', volume: 'number', playerId: 'string' } },
    validate: (msg) => ({ ...msg, volume: clamp(msg.volume, 0, 1) }),
    serverMutate: (state, msg) => {
      const track = state.tracks.find(t => t.id === msg.trackId);
      if (track) track.volume = msg.volume;
    },
    clientAction: (msg) => ({ type: 'SET_TRACK_VOLUME', trackId: msg.trackId, volume: msg.volume }),
  },
  // ... other actions
});

// Auto-generates:
// - MUTATING_MESSAGE_TYPES entries
// - Type definitions
// - Server handlers
// - Client handlers
// - actionToMessage cases
```

---

## Implementation Order

```
Phase 1: Foundation (P0)
├── 1.1 Create src/shared/sync-types.ts
├── 1.2 Update imports in types.ts and worker/types.ts
└── 1.3 Add shared types tests

Phase 2: Factories (P1)
├── 2.1 Create client handler factory
├── 2.2 Migrate 3 client handlers as proof-of-concept
├── 2.3 Create server handler factory
├── 2.4 Migrate 3 server handlers as proof-of-concept
└── 2.5 Migrate remaining handlers

Phase 3: Validation (P1)
├── 3.1 Create sync checklist validator script
├── 3.2 Add to CI pipeline
└── 3.3 Document in CONTRIBUTING.md
```

---

## Files Summary

| File | Action | Lines |
|------|--------|-------|
| `src/shared/sync-types.ts` | NEW | ~50 |
| `src/shared/sync-types.test.ts` | NEW | ~30 |
| `src/types.ts` | EDIT | ~-30 (remove dupes) |
| `src/worker/types.ts` | EDIT | ~-50 (remove dupes) |
| `src/sync/handler-factory.ts` | NEW | ~60 |
| `src/sync/handler-factory.test.ts` | NEW | ~80 |
| `src/worker/handler-factory.ts` | NEW | ~80 |
| `src/worker/handler-factory.test.ts` | NEW | ~100 |
| `src/sync/multiplayer.ts` | EDIT | ~-100 (use factory) |
| `src/worker/live-session.ts` | EDIT | ~-150 (use factory) |
| `scripts/validate-sync-checklist.ts` | NEW | ~120 |

**Total: ~300 new lines, ~330 removed lines = net reduction of ~30 lines + significant maintainability improvement**

---

## Success Criteria

1. **Zero duplicated types** - FMParams, EffectsState, ParameterLock defined once
2. **Handler factories used** - At least 10 handlers migrated to factory pattern
3. **CI validation** - `npm run validate:sync` runs on every PR
4. **Test coverage** - All new code has unit tests
5. **Documentation** - CONTRIBUTING.md updated with sync checklist

---

## Testing Strategy Summary

| Component | Test Type | Coverage Target |
|-----------|-----------|-----------------|
| Shared Types | Compile-time parity | 100% type safety |
| Client Handler Factory | Unit tests | All branches |
| Server Handler Factory | Unit tests | All branches |
| Sync Validator Script | Unit + Integration | All checklist items |
| Migration | Regression | Existing E2E tests pass |
