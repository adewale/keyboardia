# Playhead Visibility Specification

> Status: **Experimental** — Easy to roll back if needed

## Overview

The playhead (active step indicator) is hidden on tracks that produce no audio. This creates a "what you see = what you hear" visual model.

## The Rule

> **If a track produces no audio, show no playhead.**

| Track State | Playhead Visible? |
|-------------|-------------------|
| Normal (unmuted, nothing soloed) | ✅ Yes |
| Muted | ❌ No |
| Not soloed (when any track is soloed) | ❌ No |
| Soloed | ✅ Yes |

## Visual Example

```
Before: All playheads move regardless of audio state

Kick  [M][ ] ████▌░░░████░░░░  ← playhead visible (but muted!)
Snare [ ][ ] ░░░░▌███░░░░████  ← playhead visible (but not soloed!)
HiHat [ ][S] ██░░▌█░░██░░██░░  ← playhead visible (soloed)

After: Only audible tracks show playhead

Kick  [M][ ] ████░░░░████░░░░  ← no playhead (muted)
Snare [ ][ ] ░░░░████░░░░████  ← no playhead (not soloed)
HiHat [ ][S] ██░░▌█░░██░░██░░  ← playhead visible (soloed)
```

## Implementation

### Logic

```typescript
// Determine if track should show playhead
const anySoloed = tracks.some(t => t.soloed);
const isAudible = anySoloed ? track.soloed : !track.muted;
const showPlayhead = state.isPlaying && isAudible;
```

### Feature Flag

The feature is controlled by a constant for easy rollback:

```typescript
// src/constants.ts or inline
const HIDE_PLAYHEAD_ON_SILENT_TRACKS = true;

// To rollback, simply set to false:
const HIDE_PLAYHEAD_ON_SILENT_TRACKS = false;
```

### Files Modified

| File | Change |
|------|--------|
| `StepCell.tsx` | Accept new `audible` prop |
| `TrackRow.tsx` | Calculate `isAudible`, pass to StepCell |
| `StepSequencer.tsx` | Pass `anySoloed` to TrackRow |
| `ChromaticGrid.tsx` | Same logic for chromatic view |

## Corner Cases

### 1. All Tracks Muted
- No playheads visible anywhere
- Transport bar still shows playing state
- User can see playback is active via play button

### 2. Solo Then Unsolo
- Playheads reappear on all unmuted tracks
- No transition animation (instant, like mute behavior)

### 3. Mute While Playing
- Playhead disappears immediately
- Track row dims (existing behavior)

### 4. Polyrhythmic Tracks
- 4-step muted track: no playhead
- 16-step soloed track: playhead at its own position
- Position information is "lost" for muted tracks, but this is acceptable since they're not audible

### 5. Editing Muted Tracks
- User can still click to toggle steps
- No playhead to indicate current position
- Acceptable tradeoff for visual clarity

### 6. Chromatic Grid View
- Same rule applies: only show playing indicator if track is audible

## Rationale

### Benefits
1. **"What you see = what you hear"** — Strong visual/audio correspondence
2. **Focus** — Eye drawn to what's actually playing
3. **Reduced visual noise** — Fewer moving elements
4. **Clearer mixing feedback** — Instantly see which tracks contribute

### Tradeoffs
1. **Lose position awareness** on muted tracks — Acceptable since you can't hear them anyway
2. **Editing blind** — Minor inconvenience, can unmute temporarily

## Rollback Plan

If this behavior is undesirable:

1. Set `HIDE_PLAYHEAD_ON_SILENT_TRACKS = false`
2. Or revert the commit

No data migration needed. Pure UI change.

## Test Sessions

Three sessions are provided to test corner cases:

| Session | Purpose | Tests |
|---------|---------|-------|
| `playhead-mute-test` | Multiple muted tracks | Mute behavior, all-muted state |
| `playhead-solo-test` | Solo combinations | Solo/unsolo, multiple solos |
| `playhead-polyrhythm-test` | Different step counts | Polyrhythmic mute/solo |

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2024-12 | Hide playhead on silent tracks | Cleaner visual model, matches "hear what you see" philosophy |
| 2024-12 | No fade transition | Matches instant mute/solo behavior |
| 2024-12 | Feature flag for rollback | Low-risk experimentation |
