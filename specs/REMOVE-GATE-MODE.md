# Spec: Remove Gate Mode (playbackMode)

**Status**: Ready for Implementation
**Branch**: `claude/remove-gate-mode`
**Estimated Changes**: ~80 files, ~620 lines removed

## Overview

Remove the `playbackMode` track-level setting entirely. All samples will use oneshot behavior (play to completion). Synths already ignore this setting and use `tiedDuration` for note length control via the Phase 29B tie implementation.

## Rationale

1. **Gate mode is unused for synths** — Synths use `tiedDuration` via the Phase 29B tie implementation
2. **Gate mode doesn't make sense for drums** — Cutting drum samples at step boundaries sounds broken
3. **Dead code leads to bugs** — 78 files reference this unused feature
4. **User confusion** — UI toggle does nothing for 80% of instruments
5. **Industry standard** — Research shows professional systems (Elektron, OP-Z, Ableton) separate instrument-level behavior from per-step articulation; we now have ties for articulation

## Background

The original `HELD-NOTES.md` spec proposed removing `playbackMode`:

> "Gate mode is a workaround for not having per-note duration. If we add per-step ties, gate mode becomes redundant."
>
> "**Ties subsume gate mode as a more fundamental primitive.**"

Phase 29B implemented ties but never completed the removal of `playbackMode`. This spec completes that work.

---

## Files to Modify

### 1. Type Definitions

#### `app/src/shared/sync-types.ts`

Remove the `PlaybackMode` type definition (lines 12-24):

```diff
- /**
-  * Playback mode for samples - based on industry standards from
-  * Teenage Engineering, Elektron, Ableton, Roland, and Akai.
-  *
-  * - 'oneshot': Sample plays to completion regardless of step duration.
-  *              This is the DEFAULT and industry standard behavior.
-  *              Best for: drums, recordings, one-shot samples.
-  *
-  * - 'gate': Sample is cut at step boundary (gated playback).
-  *           Sample only plays while "held" (for the step duration).
-  *           Best for: sustained synth pads, drones.
-  */
- export type PlaybackMode = 'oneshot' | 'gate';
```

#### `app/src/types.ts`

Remove `PlaybackMode` from exports/imports and `Track` interface:

```diff
- export type { PlaybackMode, ParameterLock, FMParams, EffectsState, ScaleState } from './shared/sync-types';
+ export type { ParameterLock, FMParams, EffectsState, ScaleState } from './shared/sync-types';

- import type { PlaybackMode, ParameterLock, FMParams, EffectsState, ScaleState } from './shared/sync-types';
+ import type { ParameterLock, FMParams, EffectsState, ScaleState } from './shared/sync-types';

  export interface Track {
    id: string;
    name: string;
    sampleId: string;
    steps: boolean[];
    parameterLocks: (ParameterLock | null)[];
    volume: number;
    muted: boolean;
    soloed: boolean;
-   playbackMode: PlaybackMode;
    transpose: number;
    stepCount: number;
    fmParams?: FMParams;
  }

  export type GridAction =
    ...
-   | ({ type: 'SET_TRACK_PLAYBACK_MODE'; trackId: string; playbackMode: PlaybackMode } & BaseAction)
    ...
```

#### `app/src/shared/state.ts`

Keep field as optional for backwards compatibility but mark deprecated:

```diff
- import type { PlaybackMode, ParameterLock, FMParams, EffectsState, ScaleState } from './sync-types';
+ import type { ParameterLock, FMParams, EffectsState, ScaleState } from './sync-types';

  export interface SessionTrack {
    id: string;
    name: string;
    sampleId: string;
    steps: boolean[];
    parameterLocks: (ParameterLock | null)[];
    volume: number;
    muted: boolean;
    soloed?: boolean;
-   playbackMode: PlaybackMode;
+   playbackMode?: string;  // DEPRECATED: Ignored on load, kept for backwards compatibility
    transpose: number;
    stepCount?: number;
    fmParams?: FMParams;
  }
```

#### `app/src/worker/types.ts`

Remove `PlaybackMode` from re-exports:

```diff
- export type { PlaybackMode, ParameterLock, FMParams, EffectsState, ScaleState } from '../shared/sync-types';
+ export type { ParameterLock, FMParams, EffectsState, ScaleState } from '../shared/sync-types';
```

---

### 2. State Management

#### `app/src/state/grid.tsx`

Remove the `SET_TRACK_PLAYBACK_MODE` reducer case (lines 106-112):

```diff
- case 'SET_TRACK_PLAYBACK_MODE': {
-   const tracks = state.tracks.map((track) => {
-     if (track.id !== action.trackId) return track;
-     return { ...track, playbackMode: action.playbackMode };
-   });
-   return { ...state, tracks };
- }
```

Also remove `playbackMode: 'oneshot'` from any default track creation.

---

### 3. Audio Engine

#### `app/src/audio/engine.ts`

Remove `playbackMode` parameter and gate logic from `playSample()` (lines 489-577):

```diff
  playSample(
    sampleId: string,
    trackId: string,
    startTime?: number,
    duration?: number,
-   playbackMode: 'oneshot' | 'gate' = 'oneshot',
    pitchSemitones: number = 0,
    volume: number = 1
  ): void {
    ...
-   // Gate mode: cut sample at step boundary with fade-out to prevent clicks
-   // One-shot mode (default): let sample play to completion
-   // One-shot is industry standard for drums and recordings
-   if (playbackMode === 'gate' && duration !== undefined) {
-     const stopTime = actualStartTime + duration;
-     // Fade out before stopping to prevent click (from current volume to 0)
-     envGain.gain.setValueAtTime(volume, stopTime - FADE_TIME);
-     envGain.gain.linearRampToValueAtTime(0, stopTime);
-     source.stop(stopTime);
-   }
    ...
  }
```

#### `app/src/audio/scheduler.ts`

Update `playSample()` call (line 381):

```diff
- audioEngine.playSample(track.sampleId, track.id, swungTime, tiedDuration, track.playbackMode, pitchSemitones, volumeMultiplier);
+ audioEngine.playSample(track.sampleId, track.id, swungTime, tiedDuration, pitchSemitones, volumeMultiplier);
```

---

### 4. UI Components

#### `app/src/components/TrackRow.tsx`

Remove all playback mode UI:

```diff
- import type { Track, ParameterLock, PlaybackMode, FMParams, ScaleState } from '../types';
+ import type { Track, ParameterLock, FMParams, ScaleState } from '../types';

  interface TrackRowProps {
    track: Track;
    ...
-   onSetPlaybackMode?: (playbackMode: PlaybackMode) => void;
    ...
  }

  export const TrackRow: React.FC<TrackRowProps> = ({
    track,
    ...
-   onSetPlaybackMode,
    ...
  }) => {

- const handlePlaybackModeChange = useCallback(() => {
-   if (!onSetPlaybackMode) return;
-   const newMode: PlaybackMode = track.playbackMode === 'oneshot' ? 'gate' : 'oneshot';
-   onSetPlaybackMode(newMode);
- }, [onSetPlaybackMode, track.playbackMode]);

  // Remove desktop button (lines 338-348)
- {/* Grid column: playback-mode */}
- <button
-   className={`playback-mode-btn ${track.playbackMode === 'gate' ? 'gate' : 'oneshot'}`}
-   onClick={handlePlaybackModeChange}
-   title={track.playbackMode === 'oneshot'
-     ? 'One-shot: plays to completion. Click for Gate mode.'
-     : 'Gate: cuts at step boundary. Click for One-shot mode.'}
-   aria-label={`Playback mode: ${track.playbackMode ?? 'oneshot'}`}
- >
-   {track.playbackMode === 'gate' ? '▬' : '●'}
- </button>

  // Remove mobile drawer button (lines 525-531)
- <button
-   className={`drawer-mode-btn ${track.playbackMode === 'gate' ? 'gate' : ''}`}
-   onClick={handlePlaybackModeChange}
-   title={track.playbackMode === 'oneshot'
-     ? 'One-shot: plays to completion'
-     : 'Gate: cuts at step boundary'}
- >
-   {track.playbackMode === 'oneshot' ? '● One-shot' : '▬ Gate'}
- </button>
```

#### `app/src/components/TrackRow.css`

Remove grid column and styles:

```diff
  // Update grid template (line 44) - remove [playback-mode] 32px
  grid-template-columns:
    [mute] 32px
    [solo] 32px
    [volume] 60px
    [name] minmax(80px, 1fr)
    [transpose] 48px
    [step-count] 48px
-   [playback-mode] 32px
    [expand] 32px
    [steps] auto
    [actions] 32px;

  // Remove from mobile hide list (line 78)
- .playback-mode-btn,

  // Remove styles (lines 764-798)
- .playback-mode-btn {
-   ...
- }
- .playback-mode-btn:hover {
-   ...
- }
- .playback-mode-btn.oneshot {
-   ...
- }
- .playback-mode-btn.gate {
-   ...
- }
- .playback-mode-btn.gate:hover {
-   ...
- }
```

#### `app/src/components/StepSequencer.tsx`

Remove playback mode handler:

```diff
- import type { ParameterLock, EffectsState, PlaybackMode, FMParams, ScaleState } from '../types';
+ import type { ParameterLock, EffectsState, FMParams, ScaleState } from '../types';

- const handleSetPlaybackMode = useCallback((trackId: string, playbackMode: PlaybackMode) => {
-   dispatch({ type: 'SET_TRACK_PLAYBACK_MODE', trackId, playbackMode });
- }, [dispatch]);

  // Remove prop from TrackRow (line 283)
- onSetPlaybackMode={(playbackMode) => handleSetPlaybackMode(track.id, playbackMode)}
```

#### `app/src/App.tsx`

Remove from default track creation (line 582):

```diff
  const defaultTracks = samples.map((sample) => ({
    ...
    parameterLocks: Array(16).fill(null),
-   playbackMode: 'oneshot' as const,
    ...
  }));
```

---

### 5. Multiplayer Sync

#### `app/src/shared/message-types.ts`

Remove message types:

```diff
- import type { ParameterLock, EffectsState, FMParams, PlaybackMode, ScaleState } from './sync-types';
+ import type { ParameterLock, EffectsState, FMParams, ScaleState } from './sync-types';

  export type ClientMessageBase =
    ...
-   | { type: 'set_track_playback_mode'; trackId: string; playbackMode: PlaybackMode }
    ...

  export type ServerMessageBase =
    ...
-   | { type: 'track_playback_mode_set'; trackId: string; playbackMode: PlaybackMode; playerId: string }
    ...
```

#### `app/src/shared/messages.ts`

Remove from message type lists:

```diff
  export const MUTATING_MESSAGE_TYPES = [
    ...
-   'set_track_playback_mode',
    ...
  ] as const;

  export const BROADCAST_MESSAGE_TYPES = [
    ...
-   'track_playback_mode_set',
    ...
  ] as const;
```

#### `app/src/shared/sync-classification.ts`

Remove from synced actions:

```diff
  export const SYNCED_ACTIONS = new Set([
    ...
-   'SET_TRACK_PLAYBACK_MODE',
    ...
  ] as const);
```

#### `app/src/sync/multiplayer.ts`

Remove handler and message conversion:

```diff
- import type { GridAction, Track, ParameterLock, EffectsState, FMParams, PlaybackMode, ScaleState } from '../types';
+ import type { GridAction, Track, ParameterLock, EffectsState, FMParams, ScaleState } from '../types';

  // Remove case in message handler (lines 1410-1411)
- case 'track_playback_mode_set':
-   this.handleTrackPlaybackModeSet(msg);
-   break;

  // Remove handler function (lines 1727-1736)
- private handleTrackPlaybackModeSet = createRemoteHandler<{
-   trackId: string;
-   playbackMode: PlaybackMode;
- }>((msg) => ({
-   type: 'SET_TRACK_PLAYBACK_MODE',
-   trackId: msg.trackId,
-   playbackMode: msg.playbackMode,
- }));

  // Remove from actionToMessage (lines 2158-2163)
- case 'SET_TRACK_PLAYBACK_MODE':
-   return {
-     type: 'set_track_playback_mode',
-     trackId: action.trackId,
-     playbackMode: action.playbackMode,
-   };
```

---

### 6. Worker (Durable Object)

#### `app/src/worker/live-session.ts`

Remove handler:

```diff
- import { PlaybackMode, ... } from './types';

  // Remove case (lines 451-452)
- case 'set_track_playback_mode':
-   this.handleSetTrackPlaybackMode(ws, player, msg);
-   break;

  // Remove handler function (lines 863-889)
- /**
-  * Phase 26: Handle set_track_playback_mode message
-  */
- private async handleSetTrackPlaybackMode(
-   ws: WebSocket,
-   player: PlayerInfo,
-   msg: { type: 'set_track_playback_mode'; trackId: string; playbackMode: PlaybackMode; seq?: number }
- ): Promise<void> {
-   ...
- }
```

#### `app/src/worker/mock-durable-object.ts`

Remove handler:

```diff
  // Remove case (lines 275-276)
- case 'set_track_playback_mode':
-   this.handleSetTrackPlaybackMode(playerId, message);
-   break;

  // Remove handler function
- private handleSetTrackPlaybackMode(playerId: string, message: any): void {
-   ...
- }
```

---

### 7. Canonical Hash

#### `app/src/sync/canonicalHash.ts`

Remove from hash calculation:

```diff
  interface TrackForHash {
    id: string;
    name: string;
    sampleId: string;
    steps: boolean[];
    parameterLocks: (ParameterLock | null)[];
    volume: number;
    muted: boolean;
    soloed: boolean;
-   playbackMode: string;
    transpose: number;
    stepCount: number;
    fmParams?: FMParams;
  }

  // Remove from canonicalizeTrack (line 109)
  return {
    id: track.id,
    name: track.name,
    sampleId: track.sampleId,
    steps: track.steps,
    parameterLocks: track.parameterLocks,
    volume: track.volume,
    muted: track.muted,
    soloed: track.soloed ?? false,
-   playbackMode: track.playbackMode,
    transpose: track.transpose,
    stepCount: track.stepCount ?? 16,
    fmParams: track.fmParams,
  };
```

#### `app/src/worker/logging.ts`

Remove from logging hash interfaces and function (lines 542, 564, 617):

```diff
  interface TrackForHash {
    ...
    volume: number;
    muted: boolean;
    soloed?: boolean;
-   playbackMode: string;
    transpose: number;
    stepCount?: number;
  }

  interface CanonicalTrack {
    ...
    volume: number;
    // NOTE: muted and soloed are EXCLUDED from hash
-   playbackMode: string;
    transpose: number;
    stepCount: number;
  }

  // In canonicalizeTrack function (line 617)
  return {
    ...
    volume: track.volume,
-   playbackMode: track.playbackMode,
    transpose: track.transpose,
    stepCount,
  };
```

---

### 8. Session Files (JSON)

Remove `playbackMode` field from all tracks in these files:

| File | Notes |
|------|-------|
| `app/scripts/sessions/afrobeat-groove.json` | Remove from all tracks |
| `app/scripts/sessions/ambient-soundscape.json` | Remove from all tracks |
| `app/scripts/sessions/chord-exploration.json` | Remove from all tracks |
| `app/scripts/sessions/edm-drop-section.json` | Remove from all tracks |
| `app/scripts/sessions/electronic-leads.json` | Remove from all tracks |
| `app/scripts/sessions/extended-afrobeat.json` | Remove from all tracks |
| `app/scripts/sessions/fx-and-percussion.json` | Remove from all tracks |
| `app/scripts/sessions/gate-mode-demo.json` | **DELETE ENTIRE FILE** |
| `app/scripts/sessions/keys-and-piano.json` | Remove from all tracks |
| `app/scripts/sessions/latin-percussion-showcase.json` | Remove from all tracks |
| `app/scripts/sessions/playhead-mute-test.json` | Remove from all tracks |
| `app/scripts/sessions/playhead-polyrhythm-test.json` | Remove from all tracks |
| `app/scripts/sessions/playhead-solo-test.json` | Remove from all tracks |
| `app/scripts/sessions/polyrhythm-demo.json` | Remove from all tracks |
| `app/scripts/sessions/polyrhythmic-evolution.json` | Remove from all tracks |
| `app/scripts/sessions/pop-hit.json` | Remove from all tracks |
| `app/scripts/sessions/progressive-house-build.json` | Remove from all tracks |
| `app/scripts/sessions/synth-bass-showcase.json` | Remove from all tracks |
| `app/scripts/evolved-session.json` | Remove from all tracks |

---

### 9. Test Files

Remove `playbackMode` from track fixtures in all test files:

| File | Changes |
|------|---------|
| `app/e2e/session-persistence.spec.ts` | Remove `playbackMode` from track objects |
| `app/e2e/multiplayer.spec.ts` | Remove `playbackMode` from track objects |
| `app/e2e/session-race.spec.ts` | Remove `playbackMode` from track objects |
| `app/e2e/connection-storm.spec.ts` | Remove `playbackMode` from track objects |
| `app/e2e/test-utils.ts` | Remove from Track type definition |
| `app/src/audio/scheduler.test.ts` | Remove `playbackMode` from track fixtures |
| `app/src/audio/audio-routing-integration.test.ts` | Remove `playbackMode` |
| `app/src/audio/midiExport.test.ts` | Remove `playbackMode` if present |
| `app/src/audio/midiExport.fidelity.test.ts` | Remove `playbackMode` if present |
| `app/src/audio/volume-plock.test.ts` | Remove `playbackMode` if present |
| `app/src/sync/canonicalHash.test.ts` | Remove `playbackMode` from all fixtures |
| `app/src/sync/multiplayer.test.ts` | Remove playback mode tests |
| `app/src/sync/mutation-sequencing-integration.test.ts` | Remove `playbackMode` |
| `app/src/shared/sync-types.test.ts` | Remove PlaybackMode tests if any |
| `app/src/state/grid.test.ts` | Remove SET_TRACK_PLAYBACK_MODE tests |
| `app/src/state/grid-load-state.test.ts` | Remove `playbackMode` |
| `app/src/worker/types.test.ts` | Remove `playbackMode` from fixtures, remove from message type lists |
| `app/src/worker/mock-durable-object.test.ts` | Remove `playbackMode` from all fixtures |
| `app/src/worker/handler-factory.test.ts` | Remove `playbackMode` |
| `app/test/integration/durable-object-contract.test.ts` | Remove `playbackMode` |
| `app/test/integration/live-session.test.ts` | Remove `playbackMode`, remove playback mode test |
| `app/test/integration/shared-types.test.ts` | Remove `playbackMode` |
| `app/test/integration/state-hash-parity.test.ts` | Remove `playbackMode` |
| `app/test/integration/validators.test.ts` | Remove `playbackMode` |
| `app/test/integration/message-types.test.ts` | Remove from message type lists |
| `app/test/staging/effects-bypass-sync.test.ts` | Remove `playbackMode` |
| `app/test/staging/effects-immediate-sync.test.ts` | Remove `playbackMode` |
| `app/test/staging/failure-modes.test.ts` | Remove `playbackMode` |
| `app/test/staging/kv-staleness.test.ts` | Remove `playbackMode` |
| `app/test/staging/multiplayer-sync.test.ts` | Remove `playbackMode` |
| `app/test/unit/sync-classification.test.ts` | Remove `SET_TRACK_PLAYBACK_MODE` test case |
| `app/test/unit/mutation-types.test.ts` | Remove `set_track_playback_mode` from lists |

---

### 10. Scripts

#### `app/scripts/session-api.ts`

Remove validation:

```diff
- type PlaybackMode = 'oneshot' | 'gated';

  interface Track {
    ...
-   playbackMode?: PlaybackMode;
    ...
  }

  // Remove validation (lines 236-237)
- if (t.playbackMode !== undefined && !['oneshot', 'gated'].includes(t.playbackMode as string)) {
-   errors.push({ path: `${path}.playbackMode`, message: `Must be 'oneshot' or 'gated', got ${t.playbackMode}` });
- }
```

> **Note**: This file has a pre-existing bug where it uses `'gated'` instead of `'gate'`.
> The rest of the codebase uses `'gate'`. This inconsistency is fixed by removal.

#### `app/scripts/debug-state-hash.ts`

Remove from hash debugging:

```diff
  interface Track {
    ...
-   playbackMode: string;
    ...
  }

- console.log(`    playbackMode: ${track.playbackMode}`);

  const expectedKeys = [
    'id', 'name', 'sampleId', 'steps', 'parameterLocks',
-   'volume', 'muted', 'soloed', 'playbackMode', 'transpose', 'stepCount'
+   'volume', 'muted', 'soloed', 'transpose', 'stepCount'
  ];
```

#### `app/scripts/staging-e2e-test.ts`

Remove from type:

```diff
  interface Track {
    ...
-   playbackMode: 'oneshot' | 'gate' | 'loop';
    ...
  }
```

#### `app/scripts/create-test-sessions.ts`

Remove from track creation:

```diff
  const track = {
    ...
-   playbackMode: 'oneshot',
    ...
  };
```

#### `app/scripts/dev-multiplayer.ts`

Remove from track fixtures:

```diff
  const tracks = [
    {
      ...
-     playbackMode: 'oneshot',
      ...
    }
  ];
```

#### `app/scripts/ci-connection-stability.ts`

Remove from track fixtures:

```diff
  const track = {
    ...
-   playbackMode: 'oneshot',
    ...
  };
```

#### `app/scripts/debug-ws-storm-local.ts`

Remove from test track fixtures (lines 61, 73):

```diff
  const tracks = [
    {
      ...
      parameterLocks: Array(128).fill(null),
      volume: 1,
      muted: false,
-     playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    },
    {
      ...
      parameterLocks: Array(128).fill(null),
      volume: 0.7,
      muted: false,
-     playbackMode: 'oneshot',
      transpose: 0,
      stepCount: 16,
    },
  ];
```

---

### 11. Documentation / Specs

| File | Action |
|------|--------|
| `specs/HELD-NOTES.md` | Mark "Remove playbackMode" task as complete |
| `specs/HIDDEN-UI-FEATURES.md` | Remove playback mode section (lines 106-176) |
| `specs/SPEC.md` | Remove playbackMode from persistence table |
| `specs/ROADMAP.md` | Update Phase 24 to note playbackMode was removed |
| `specs/SYNC-ABSTRACTIONS.md` | Remove PlaybackMode references |
| `specs/UNIFIED-AUDIO-BUS.md` | Update playSample signature |
| `specs/research/RESEARCH-PLAYBACK-MODES.md` | Add deprecation notice at top |
| `specs/research/SESSION-NOTATION-RESEARCH.md` | Remove playbackMode from interface |
| `docs/MULTIPLAYER-SYNC.md` | Remove PlaybackMode from shared types list |
| `specs/LANDING-PAGE.md` | Remove playbackMode from session example |

---

## Migration Strategy

### Backwards Compatibility

Sessions saved with `playbackMode` field will still load:

1. **Ignored on load**: Field is not mapped to Track interface
2. **Not written on save**: New sessions won't include field
3. **Stripped on re-save**: If session is edited and saved, field is removed

### Hash Parity

Removing `playbackMode` from `canonicalHash.ts` changes state hashes:

- Hash is used for sync verification, not persistence
- All clients update simultaneously (deployment)
- Existing sessions rehash on next load
- No migration needed

---

## Verification Tests

After implementation, verify these behaviors:

### Unit Tests

```bash
# All existing tests should pass
npm test

# Specific areas to verify:
npm test -- --grep "scheduler"
npm test -- --grep "canonicalHash"
npm test -- --grep "multiplayer"
npm test -- --grep "grid"
```

### Integration Tests

```bash
# E2E tests
npm run test:e2e

# Staging tests
npm run test:staging
```

### Manual Verification Checklist

- [ ] **Drums play to completion**: Load any session, trigger drum sounds, verify they play full sample
- [ ] **Synth ties work**: Create tied notes on synth track, verify legato playback
- [ ] **No UI button**: Verify playback mode toggle is gone from TrackRow
- [ ] **Session loads**: Load `ambient-soundscape.json` (had gate tracks), verify it loads without error
- [ ] **Multiplayer sync**: Two clients, verify track changes sync (minus playbackMode)
- [ ] **No console errors**: Check browser console for any type errors or missing handlers

### Regression Tests to Add

Create a new test file `app/test/integration/playback-mode-removal.test.ts`:

```typescript
/**
 * Regression tests for playbackMode removal.
 * Verifies backwards compatibility and correct behavior.
 */

describe('playbackMode removal', () => {
  it('loads sessions with playbackMode field without error', () => {
    // Load a session JSON that has playbackMode
    // Verify it loads successfully
    // Verify playbackMode is ignored (not on Track object)
  });

  it('saves sessions without playbackMode field', () => {
    // Create a session
    // Save it
    // Verify output JSON has no playbackMode
  });

  it('drums play to completion (oneshot behavior)', () => {
    // Schedule a drum hit
    // Verify it plays full duration, not cut at step boundary
  });

  it('synth notes respect tie duration', () => {
    // Create tied synth notes
    // Verify duration extends across tied steps
  });

  it('Track interface has no playbackMode', () => {
    // TypeScript compilation test
    // Verify Track type doesn't include playbackMode
  });
});
```

---

## Summary

| Category | Files | Lines Removed (approx) |
|----------|-------|------------------------|
| Types | 5 | 20 |
| State | 1 | 7 |
| Audio | 2 | 15 |
| UI | 4 | 55 |
| Multiplayer | 4 | 40 |
| Worker | 3 | 40 |
| Hash | 1 | 5 |
| Tests | 25+ | 200+ |
| Scripts | 7 | 25 |
| Sessions (JSON) | 19 | 150+ |
| Docs | 9 | 50+ |
| **Total** | **~80** | **~620** |

---

## Implementation Order

1. **Types first**: Remove from sync-types.ts, types.ts, state.ts, worker/types.ts
2. **State management**: Remove reducer case from grid.tsx
3. **Audio**: Update engine.ts and scheduler.ts
4. **UI**: Remove from TrackRow.tsx, TrackRow.css, StepSequencer.tsx, App.tsx
5. **Sync**: Update message-types.ts, messages.ts, sync-classification.ts, multiplayer.ts
6. **Worker**: Update live-session.ts, mock-durable-object.ts, logging.ts
7. **Hash**: Update canonicalHash.ts
8. **Tests**: Update all test files
9. **Scripts**: Update utility scripts (including debug-ws-storm-local.ts)
10. **Sessions**: Update JSON files, delete gate-mode-demo.json
11. **Docs**: Update spec files

Run tests after each major category to catch issues early.
