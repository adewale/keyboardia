# Multiplayer Sync Guide

This document describes how to add new multiplayer-synced features to Keyboardia.

## Overview

Keyboardia uses WebSocket-based real-time synchronization via Cloudflare Durable Objects. When a user makes a change, it:

1. Updates local state immediately (optimistic)
2. Sends a message to the Durable Object server
3. Server validates, persists, and broadcasts to all clients
4. Other clients receive the broadcast and update their state

## The 7-Step Sync Checklist

Adding a new synced feature requires changes in **7 locations across 4 files**. The `validate:sync` script enforces this checklist.

### Required Steps

| # | File | Location | What to Add |
|---|------|----------|-------------|
| 1 | `worker/types.ts` | `ClientMessageBase` | Client → Server message type |
| 2 | `worker/types.ts` | `ServerMessageBase` | Server → Client broadcast type |
| 3 | `worker/live-session.ts` | `switch` statement | Case for client message |
| 4 | `worker/live-session.ts` | Handler method | `handleSetXxx()` method |
| 5 | `sync/multiplayer.ts` | `switch` statement | Case for server broadcast |
| 6 | `sync/multiplayer.ts` | Handler method | `handleXxxChanged()` method |
| 7 | `sync/multiplayer.ts` | `actionToMessage()` | Map action to client message |

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Client message | `snake_case` verb | `set_track_volume` |
| Server broadcast | `snake_case` past tense | `track_volume_set` |
| Server handler | `handleSetXxx` | `handleSetTrackVolume` |
| Client handler | `handleXxxChanged` | `handleTrackVolumeSet` |
| Action type | `SCREAMING_SNAKE` | `SET_TRACK_VOLUME` |

## Using Handler Factories

To reduce boilerplate, use the handler factory functions.

### Client Handlers (`sync/handler-factory.ts`)

```typescript
import { createRemoteHandler } from './handler-factory';

// Simple pattern: skip own message, dispatch action
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

### Server Handlers (`worker/handler-factory.ts`)

```typescript
import { createTrackMutationHandler, createGlobalMutationHandler } from './handler-factory';

// Track mutation with validation
private handleSetTrackVolume = createTrackMutationHandler<
  { trackId: string; volume: number },
  ServerMessage
>({
  getTrackId: (msg) => msg.trackId,
  validate: (msg) => ({ ...msg, volume: clamp(msg.volume, 0, 1) }),
  mutate: (track, msg) => { track.volume = msg.volume; },
  toBroadcast: (msg, playerId) => ({
    type: 'track_volume_set',
    trackId: msg.trackId,
    volume: msg.volume,
    playerId,
  }),
});

// Global state mutation
private handleSetTempo = createGlobalMutationHandler<
  { tempo: number },
  ServerMessage
>({
  validate: (msg) => ({ ...msg, tempo: clamp(msg.tempo, 60, 180) }),
  mutate: (state, msg) => { state.tempo = msg.tempo; },
  toBroadcast: (msg, playerId) => ({
    type: 'tempo_changed',
    tempo: msg.tempo,
    playerId,
  }),
});
```

## Running the Validator

The sync checklist validator runs automatically on pre-commit. You can also run it manually:

```bash
npm run validate:sync
```

This checks all 15 message types against the 7-step checklist and reports any missing implementations.

## Example: Adding a New Synced Property

Let's say we want to sync a new `trackPan` property:

### Step 1-2: Add Types (`worker/types.ts`)

```typescript
// In ClientMessageBase union
| { type: 'set_track_pan'; trackId: string; pan: number }

// In ServerMessageBase union
| { type: 'track_pan_set'; trackId: string; pan: number; playerId: string }

// Add to MUTATING_MESSAGE_TYPES
export const MUTATING_MESSAGE_TYPES = new Set([
  // ... existing types
  'set_track_pan',
] as const);
```

### Step 3-4: Add Server Handler (`worker/live-session.ts`)

```typescript
// In switch statement
case 'set_track_pan':
  this.handleSetTrackPan(ws, player, msg);
  break;

// Handler method using factory
private handleSetTrackPan = createTrackMutationHandler<
  { trackId: string; pan: number },
  ServerMessage
>({
  getTrackId: (msg) => msg.trackId,
  validate: (msg) => ({ ...msg, pan: clamp(msg.pan, -1, 1) }),
  mutate: (track, msg) => { track.pan = msg.pan; },
  toBroadcast: (msg, playerId) => ({
    type: 'track_pan_set',
    trackId: msg.trackId,
    pan: msg.pan,
    playerId,
  }),
});
```

### Step 5-6: Add Client Handler (`sync/multiplayer.ts`)

```typescript
// In switch statement
case 'track_pan_set':
  this.handleTrackPanSet(msg);
  break;

// Handler method using factory
private handleTrackPanSet = createRemoteHandler<{
  trackId: string;
  pan: number;
  playerId: string;
}>((msg) => ({
  type: 'SET_TRACK_PAN',
  trackId: msg.trackId,
  pan: msg.pan,
}));
```

### Step 7: Add Action Mapping (`sync/multiplayer.ts`)

```typescript
// In actionToMessage function
case 'SET_TRACK_PAN':
  return {
    type: 'set_track_pan',
    trackId: action.trackId,
    pan: action.pan,
  };
```

### Update Validator Config

Add to `scripts/validate-sync-checklist.ts`:

```typescript
const MUTATING_TYPES = [
  // ... existing types
  'set_track_pan',
];

const CLIENT_TO_SERVER_MAP = {
  // ... existing mappings
  'set_track_pan': 'track_pan_set',
};
```

## Handlers That Don't Use Factories

Some handlers have complex logic that doesn't fit the factory pattern:

- `handleToggleStep` - Toggle logic with debug assertions
- `handleAddTrack` / `handleDeleteTrack` - Array operations
- `handleClearTrack` - Complex array mutation
- `handleSetEffects` - Deep nested validation
- `handleSetFMParams` - Complex validation with early return
- Playback handlers - Use callbacks, not dispatch

For these, write the handler manually following the existing patterns.

## Shared Types

Types used by both client and server are defined in `src/shared/sync-types.ts`:

- `PlaybackMode`
- `ParameterLock`
- `FMParams`
- `EffectsState`

Both `types.ts` and `worker/types.ts` re-export from this shared location to ensure type consistency across the serialization boundary.
