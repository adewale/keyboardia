# Keyboardia: Multiplayer Realtime Music Sequencer

## Overview

Keyboardia is a web-based, multiplayer music sequencer that enables 5-10 users to collaboratively create music in real-time. Users can record short samples via their microphone and trigger loops together in a shared session. The focus is on casual, fun, ephemeral jam sessions accessible via link sharing—no accounts required.

**Core principle: Everyone hears the same music.** Multiple players add clips to a shared grid, and all participants hear identical, synchronized playback regardless of who triggered what or when they joined.

---

## Design Philosophy

Inspired by [Ableton's Learning Music](https://learningmusic.ableton.com/), Keyboardia prioritizes:

1. **Immediate feedback** — Every interaction produces instant audio + visual response
2. **Grid-based simplicity** — Click cells to toggle sounds, no musical knowledge required
3. **Progressive disclosure** — Start with a playing beat, let users modify it
4. **Shared experience** — The magic is hearing your contribution in sync with others

---

## Core Concepts

### Session
A temporary collaborative space where players make music together. Sessions are ephemeral and exist only while at least one participant is connected.

### Player
An anonymous participant in a session, identified by a randomly generated name/avatar. No authentication required.

### Clip
A triggerable audio element placed in the grid. Can be a user-recorded sample or a preset sound.

### Track
A horizontal row in the sequencer representing one audio channel. Each track can hold multiple clips.

### Scene
A vertical column in the grid. All clips in a scene can be triggered together, enabling song structure (intro, verse, chorus, etc.).

---

## Features

### 1. Session Management

| Feature | Description |
|---------|-------------|
| Create session | Generate a new session with unique shareable URL |
| Join via link | Anyone with the URL can join instantly |
| Player limit | 5-10 concurrent players per session |
| Auto-cleanup | Session destroyed when last player leaves |
| Reconnection | Brief grace period for reconnecting dropped players |

### 2. Instruments & Samples

An **Instrument** in Keyboardia is a **Sample Kit** — a collection of related samples that work together.

#### Sample Kits

| Kit Type | Contents | Example |
|----------|----------|---------|
| Drum Kit | Kick, snare, hi-hat, clap, etc. | "808 Kit", "Acoustic Kit" |
| Bass Kit | Different bass notes/hits | "Sub Bass", "Funk Bass" |
| Melodic Kit | Chord stabs, pads, leads | "Piano Chords", "Synth Stabs" |
| FX Kit | Risers, impacts, textures | "Transitions", "Atmospheres" |
| Custom Kit | User-recorded samples | Created in-session |

#### Sample Properties

| Property | Description |
|----------|-------------|
| Audio data | The waveform (stored in R2, cached as AudioBuffer) |
| Name | Display name (e.g., "Kick", "Snare") |
| Default duration | How long the sample naturally plays |
| Category | Which kit/group it belongs to |

#### Playback Modes

Samples support two playback modes (industry standard from Teenage Engineering, Elektron, Ableton):

| Mode | Behavior | Best For |
|------|----------|----------|
| **One-shot** (default) | Sample plays to completion regardless of step duration | Drums, recordings, most samples |
| **Gate** | Sample cuts at step boundary | Sustained pads, drones (future) |

```
ONE-SHOT (default):
Sample:    [====KICK========]
Step:      [--ON--][next...]
Output:    [====KICK========]  ← sample plays fully

GATE:
Sample:    [====PAD=========]
Step:      [--ON--][OFF]
Output:    [==PAD=][   ]  ← sample cuts when step ends
```

See [RESEARCH-PLAYBACK-MODES.md](./RESEARCH-PLAYBACK-MODES.md) for detailed research.

### 3. Sequencer Interface (Dual View)

The interface combines **two views side-by-side**:

```
┌─────────────────────────────────────────────────────────────────┐
│  STEP SEQUENCER (Drums)                                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Kit: 808 Drums                    BPM: 120    [▶ Play]    │  │
│  │                                                           │  │
│  │        1   2   3   4   5   6   7   8   9  10  11  12 ... │  │
│  │ Kick  [■] [ ] [ ] [ ] [■] [ ] [ ] [ ] [■] [ ] [ ] [ ]    │  │
│  │ Snare [ ] [ ] [ ] [ ] [ ] [ ] [ ] [ ] [ ] [ ] [ ] [ ]    │  │
│  │ HiHat [■] [■] [■] [■] [■] [■] [■] [■] [■] [■] [■] [■]    │  │
│  │ Clap  [ ] [ ] [■] [ ] [ ] [ ] [■] [ ] [ ] [ ] [■] [ ]    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  CLIP LAUNCHER (Loops & Sounds)                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │        Scene 1   Scene 2   Scene 3   Scene 4              │  │
│  │ Bass   [Clip]    [Clip]    [    ]    [Clip]               │  │
│  │ Keys   [    ]    [Clip]    [Clip]    [    ]               │  │
│  │ FX     [Clip]    [    ]    [Clip]    [Clip]               │  │
│  │        [▶ All]   [▶ All]   [▶ All]   [▶ All]              │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

#### Step Sequencer (Top)

For percussive, rhythmic content. Classic drum machine interface.

| Feature | Description |
|---------|-------------|
| Grid | 4 to 128 steps per track (configurable per track) |
| Rows | One row per sample in the kit |
| Click to toggle | Turn steps on/off |
| Auto-looping | Each track loops independently at its own length (polyrhythmic) |
| Step duration | Each step = 1/16th note |
| Inline scrolling | Steps scroll horizontally within each track row |

##### Per-Track Step Count & Polyrhythms

Each track has its own step count (4, 8, 12, 16, 24, 32, 64, 96, or 128 steps), creating polyrhythmic patterns:

```
Kick (16 steps):    [1][2][3]...[16]  → loops 8× per 128 steps
Snare (16 steps):   [1][2][3]...[16]  → loops 8× per 128 steps
Bass (64 steps):    [1][2][3]...[64]  → loops 2× per 128 steps
Lead (128 steps):   [1][2][3]...[128] → loops 1× (full verse/chorus)
```

**How it works:**
- Global step counter runs from 0-127 (MAX_STEPS = 128)
- Each track uses modulo to find its current position: `globalStep % trackStepCount`
- A 16-step track plays its full pattern 8 times while a 128-step track plays once
- The playhead on each track shows its own position, not the global position

**Research insight:** This matches how hardware like the Elektron Digitakt and OP-Z handle polyrhythms — per-track length creates evolving patterns without complex UI.

#### Clip Launcher (Bottom)

For loops, longer samples, and layering scenes.

| Feature | Description |
|---------|-------------|
| Grid layout | Tracks (rows) × Scenes (columns) |
| Clip triggering | Click to start/stop individual clips |
| Scene triggering | Launch all clips in a column simultaneously |
| Quantized launch | Clips start on next bar/beat boundary |
| Visual feedback | Playing clips show progress, queued clips blink |
| Track controls | Volume, mute, solo per track |

### 4. Sample Recording

| Feature | Description |
|---------|-------------|
| In-browser recording | Record from microphone using Web Audio API |
| Duration limit | 5 seconds max (auto-stop at limit) |
| Hold-to-record | Hold button to record, release to stop |
| Preview | Listen before committing to grid |
| Basic processing | Normalize volume, trim silence |
| **Add as new instrument** | Recording becomes a new track (row) in the sequencer |

#### Recording Behavior: Additive, Not Destructive

Recordings create **new instruments** rather than replacing existing ones:
- User records a sample → new track appears in the sequencer
- Original preset instruments (kick, snare, etc.) remain unchanged
- User can have both preset sounds AND custom recordings playing together
- Maximum tracks limit applies (8 tracks per session)

#### Auto-Slice Recording

Turn a longer recording into multiple playable slices automatically:

| Feature | Description |
|---------|-------------|
| Record longer loop | Record 2-8 bars of audio |
| Auto-detect slices | Find transients (drum hits) or divide evenly |
| Create multi-sample track | Each slice becomes a step trigger |
| Slice modes | Transient detection, equal divisions (4, 8, 16), manual |

**Use cases**:
- Record a 4-bar drum loop → auto-slice into 16 one-shots → rearrange the beat
- Record yourself saying "one two three four" → each word becomes a trigger
- Sample a song → chop into equal slices → create new patterns

```
Recording: [kick-snare-hat-hat-kick-snare-hat-clap]
                │     │    │   │    │     │    │   │
Auto-slice:    [1]   [2]  [3] [4]  [5]   [6]  [7] [8]
                │
                ▼
New track:  Each slice mapped to steps 1-8, ready to re-sequence
```

This is what makes devices like the PO-33 and SP-404 so creative—record once, rearrange infinitely.

### 5. Track/Sequence Management

| Feature | Description |
|---------|-------------|
| Copy sequence | Copy step pattern from one track to another (includes step count) |
| Move sequence | Move step pattern from one track to another (clears source, resets source to 16 steps) |
| Clear track | Remove all steps from a track |
| Delete track | Remove a custom recording track entirely |

#### Copy/Move Behavior

Copy/Move operations transfer **pattern data only**, preserving the destination track's identity. This is intentional — it allows reusing rhythm patterns across different instruments.

**What IS copied (Pattern Data):**

| Property | Copied? | Notes |
|----------|---------|-------|
| `steps` | ✅ Yes | All step on/off states (up to 128) |
| `parameterLocks` | ✅ Yes | Per-step pitch and volume offsets |
| `stepCount` | ✅ Yes | Loop length (4-128) for polyrhythms |

**What is NOT copied (Track Identity):**

| Property | Copied? | Rationale |
|----------|---------|-----------|
| `sampleId` | ❌ No | Destination keeps its instrument |
| `name` | ❌ No | Destination keeps its label |
| `volume` | ❌ No | Track-level volume preserved |
| `transpose` | ❌ No | Track-level pitch preserved |
| `playbackMode` | ❌ No | Gate/oneshot setting preserved |
| `muted` | ❌ No | Mute state preserved |

> **Design rationale:** This separation enables workflows like "copy kick pattern to snare" without changing the snare's overall volume or pitch. Per-step variations (via parameter locks) ARE copied, but the track's overall settings remain unchanged.

#### Copy/Move Use Cases
- Record a sound, then copy the kick drum's rhythm to it
- Experiment with different samples using the same beat pattern
- Quickly duplicate patterns across multiple tracks
- Copy a 128-step pattern to preserve its full arrangement
- Create variations: copy pattern, then modify destination's transpose or volume

### 6. Sound Library (Minimal)

A small set of built-in sounds to get started:

| Category | Examples |
|----------|----------|
| Drums | Kick, snare, hi-hat, clap |
| Bass | Simple bass hits/loops |
| Keys | Piano chords, synth stabs |
| FX | Risers, impacts, vinyl crackle |

Sounds are royalty-free and optimized for quick loading.

### 7. Real-Time Collaboration

| Feature | Description |
|---------|-------------|
| Server clock sync | Central server maintains authoritative timing |
| State synchronization | All grid changes broadcast to all players instantly |
| Latency compensation | Visual feedback accounts for network delay |
| Conflict resolution | Last-write-wins for simultaneous edits |
| Player cursors | See where others are interacting (optional) |
| Player indicators | Show who added/is playing each clip |

### 8. Audio Engine

| Feature | Description |
|---------|-------------|
| Web Audio API | Browser-native audio processing |
| Sample playback | Low-latency triggering of audio buffers |
| Mixing | Per-track volume, master output |
| Tempo | Adjustable BPM (60-180), synced across all players |
| Time signature | 4/4 default, potentially configurable |
| Loop points | Clips loop seamlessly until stopped |
| **Swing/Shuffle** | Adjustable groove feel (0-100%) |

#### Swing/Shuffle

Transform rigid, quantized beats into human-feeling grooves with a single knob:

| Feature | Description |
|---------|-------------|
| Global swing | One knob affects all tracks (0-100%) |
| Per-track swing | Optional override per track |
| Swing amount | 0% = straight, 50% = triplet feel, 100% = extreme shuffle |

**How it works**: Swing delays every other 16th note (steps 2, 4, 6, 8...) by a percentage of the step duration.

```
Straight (0% swing):
Step:  1   2   3   4   5   6   7   8
Time:  |   |   |   |   |   |   |   |

50% swing (triplet feel):
Step:  1     2 3     4 5     6 7     8
Time:  |     | |     | |     | |     |
       └──┬──┘ └──┬──┘ └──┬──┘ └──┬──┘
        "long-short" triplet pattern
```

**Why it matters**: Nearly every genre uses swing. Hip-hop, house, jazz, funk—all rely on swing to feel right. A beat can go from "robotic" to "groovy" with one knob turn.

#### Audio Graph Structure

```
                    ┌──────────────┐
                    │ Master Gain  │──→ audioContext.destination
                    └──────────────┘
                           ▲
          ┌────────────────┼────────────────┐
          │                │                │
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │ Track 1 Gain │ │ Track 2 Gain │ │ Track 3 Gain │
   └──────────────┘ └──────────────┘ └──────────────┘
          ▲                ▲                ▲
          │                │                │
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │AudioBuffer   │ │AudioBuffer   │ │AudioBuffer   │
   │SourceNode   │ │ SourceNode   │ │ SourceNode   │
   │(per clip)    │ │(per clip)    │ │(per clip)    │
   └──────────────┘ └──────────────┘ └──────────────┘
```

#### Sample Loading Strategy

1. **Preset sounds**: Bundled with app, loaded on session join
2. **User samples**: Uploaded to R2, URL broadcast to all clients
3. **Lazy loading**: Clips not in current view load on-demand
4. **Caching**: `AudioBuffer` objects cached per-session in memory

---

## User Interface

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  KEYBOARDIA                    [Tempo: 120] [▶ Play]    │
│  Session: fuzzy-penguin-42     Players: 🟢🟢🟢🟡🟢       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              CLIP GRID (main area)               │   │
│  │                                                  │   │
│  │   Track controls | Scene 1 | Scene 2 | Scene 3  │   │
│  │   ─────────────────────────────────────────────  │   │
│  │   🔊 Vol [M] [S] │ [███] │ [   ] │ [███]        │   │
│  │   🔊 Vol [M] [S] │ [   ] │ [███] │ [   ]        │   │
│  │   🔊 Vol [M] [S] │ [███] │ [███] │ [███]        │   │
│  │                                                  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────┐  ┌─────────────────────────────┐   │
│  │  🎤 RECORD      │  │  SOUND LIBRARY              │   │
│  │  [Hold to Rec]  │  │  [Kick] [Snare] [HiHat]    │   │
│  │  ────────────── │  │  [Bass] [Keys]  [FX]       │   │
│  │  [Preview] [Add]│  │                             │   │
│  └─────────────────┘  └─────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Interactions

| Action | Behavior |
|--------|----------|
| Click empty slot | Opens add clip menu (record or library) |
| Click filled slot | Toggle play/stop (queued to next beat) |
| Right-click slot | Context menu (delete, replace, copy) |
| Drag clip | Move to different slot |
| Click scene trigger | Launch all clips in that scene |
| Hold record button | Capture microphone audio |

### Visual Feedback

- **Playing step**: Glow effect with box-shadow pulse, subtle scale animation
- **Active step (has note)**: Orange accent color with enhanced glow when triggered
- **Queued clip**: Blinking/pulsing effect
- **Other players' actions**: Subtle cursor/highlight showing who's doing what
- **Recording**: Red pulsing indicator, progress bar (5 second max)
- **Playhead**: Per-track position indicator (each track shows its own loop position)
- **Velocity indicator**: Fill height shows volume p-lock (lower volume = shorter fill)
- **Parameter lock badges**: Color-coded indicators (blue for pitch, orange for volume)
- **Page separators**: Visual gap every 16 steps for longer patterns

#### Dark Mode Design

Following Material Design dark theme guidelines:

| Element | Color | Rationale |
|---------|-------|-----------|
| Background | `#121212` | Not pure black (reduces eye strain, better contrast) |
| Surface | `#1e1e1e` | Elevated surfaces slightly lighter |
| Accent | `#e85a30` (desaturated orange) | Reduced saturation for dark backgrounds |
| Text | `rgba(255,255,255,0.87)` | High emphasis text |
| Muted text | `rgba(255,255,255,0.5)` | Secondary text |

**Research insight:** Pure black backgrounds with saturated colors cause visual vibration and eye strain. Desaturated accents on #121212 is the industry standard (Spotify, YouTube Music, Ableton Live).

---

## Technical Architecture

### Frontend

| Component | Technology |
|-----------|------------|
| Framework | React + TypeScript |
| Build tool | Vite |
| Audio | Web Audio API |
| Recording | MediaRecorder API |
| Real-time | WebSocket connection |
| State | React Context + useReducer, synced via WebSocket |
| UI | CSS Grid for sequencer, Canvas for waveforms |

### Backend (Cloudflare Stack)

| Component | Technology | Documentation |
|-----------|------------|---------------|
| Hosting | Cloudflare Pages (static frontend) | [Pages Docs](https://developers.cloudflare.com/pages/) |
| Real-time | Durable Objects (WebSocket + state) | [Durable Objects Docs](https://developers.cloudflare.com/durable-objects/) |
| API | Cloudflare Workers | [Workers Docs](https://developers.cloudflare.com/workers/) |
| Clock sync | Durable Object as authoritative clock per session | [In-memory State](https://developers.cloudflare.com/durable-objects/reference/in-memory-state/) |
| Session state | Durable Object (in-memory, single-threaded) | [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| Sample storage | R2 (temporary, lifecycle-based cleanup) | [R2 Lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) |
| Edge routing | Cloudflare Workers (route to Durable Object) | [Data Location](https://developers.cloudflare.com/durable-objects/reference/data-location/) |

### Data Flow

```
Player A records sample
        │
        ▼
[Encode & upload to server]
        │
        ▼
[Server stores temporarily, broadcasts to all]
        │
        ▼
[All players download & cache sample]
        │
        ▼
[Sample available in shared grid]
```

### Clock Synchronization & The "Same Music" Guarantee

The central challenge: **all players must hear identical audio at the same moment**, despite network latency and different devices.

#### The Two Clocks Problem

Every browser has two clocks with different characteristics:

| Clock | Precision | Reliability | Use |
|-------|-----------|-------------|-----|
| `AudioContext.currentTime` | Sample-accurate (hardware) | Rock solid | Schedule audio events |
| `setTimeout` / `setInterval` | ~millisecond | Unreliable (GC, rendering) | UI updates, periodic checks |

**Key insight from Ableton Learning Music:** Never schedule audio directly from JS timers. Instead, use JS timers to *look ahead* and schedule events on the audio clock.

#### Lookahead Scheduling Pattern

```javascript
const LOOKAHEAD_MS = 25;        // JS timer interval
const SCHEDULE_AHEAD_SEC = 0.1; // How far ahead to schedule audio

function scheduler() {
  // Schedule all notes that need to play in the next 100ms
  while (nextNoteTime < audioContext.currentTime + SCHEDULE_AHEAD_SEC) {
    scheduleNote(currentNote, nextNoteTime);
    advanceToNextNote();
  }
  setTimeout(scheduler, LOOKAHEAD_MS);
}
```

This pattern ensures audio plays precisely even if the JS thread is briefly blocked.

#### Adding Server Clock for Multiplayer

For single-player apps, `AudioContext.currentTime` is the source of truth. For Keyboardia, the **Durable Object's clock becomes the global authority**:

```javascript
// Each client calculates their offset to server time
const serverClockOffset = serverTime - localTime + (roundTripTime / 2);

// Convert server time to local audio time
function serverTimeToAudioTime(serverTime) {
  return serverTime - serverClockOffset + audioContext.currentTime;
}

// Schedule notes using server-relative timing
function scheduler() {
  const serverNow = Date.now() + serverClockOffset;
  while (nextNoteServerTime < serverNow + (SCHEDULE_AHEAD_SEC * 1000)) {
    const localAudioTime = serverTimeToAudioTime(nextNoteServerTime);
    scheduleNote(currentNote, localAudioTime);
    advanceToNextNote();
  }
  setTimeout(scheduler, LOOKAHEAD_MS);
}
```

#### Synchronization Protocol

```
┌─────────────────────────────────────────────────────────────────┐
│                     DURABLE OBJECT (Server)                      │
│  - Authoritative clock (Date.now())                             │
│  - Authoritative state (grid, tempo, playing clips)             │
│  - Broadcasts clock sync every 50ms                             │
│  - Broadcasts state changes immediately                         │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   ┌─────────┐           ┌─────────┐           ┌─────────┐
   │Client A │           │Client B │           │Client C │
   │         │           │         │           │         │
   │ offset: │           │ offset: │           │ offset: │
   │  +15ms  │           │  -8ms   │           │  +42ms  │
   │         │           │         │           │         │
   │ Audio   │           │ Audio   │           │ Audio   │
   │ Context │           │ Context │           │ Context │
   └─────────┘           └─────────┘           └─────────┘
        │                     │                     │
        ▼                     ▼                     ▼
   [Same audio plays at same absolute moment across all clients]
```

**Clock sync message (server → clients, every 50ms):**
```json
{
  "type": "clock",
  "serverTime": 1699999999999,
  "beat": 3,
  "bar": 2,
  "nextBarAt": 1700000000500
}
```

**State change message (server → clients, on any change):**
```json
{
  "type": "clip_triggered",
  "trackId": 2,
  "sceneId": 1,
  "startAtServerTime": 1700000000500,
  "clipId": "kick-01",
  "triggeredBy": "player-xyz"
}
```

#### Handling Late Joiners

When a new player joins mid-session:
1. Server sends full state snapshot (grid, all clips, current tempo)
2. Server sends current playback state (which clips are playing, where in the loop)
3. Client calculates offset from clock sync messages
4. Client schedules currently-playing clips to resume at correct position
5. Within 100-200ms, new player hears same audio as everyone else

#### Browser Tab Throttling

Browsers throttle `setTimeout` to 1Hz when tabs are backgrounded. Solutions:
1. **Web Worker scheduler** — Run the scheduler loop in a Worker (not throttled)
2. **Visibility API fallback** — Schedule more events ahead when tab loses focus

---

## Constraints & Limits

| Constraint | Value | Rationale |
|------------|-------|-----------|
| Max players per session | 10 | Performance, UI clarity |
| Sample duration | 5 seconds | Storage, quick loops |
| Sample size | ~500KB (compressed) | Bandwidth |
| Tracks per session | 16 | UI space, mixing clarity |
| Steps per track | 4-64 | Polyrhythmic flexibility |
| Tempo range | 60-180 BPM | Musical range |
| Swing range | 0-66% | Standard groove range |
| Session persistence | Permanent | No TTL (sessions never expire) |

---

## Non-Goals (v1)

The following are explicitly out of scope for the initial version:

- User accounts and authentication
- Audio export/download
- MIDI input/output
- Effects processing (reverb, delay, etc.)
- Chat or video communication
- Public session discovery

**Note:** Some original non-goals are now implemented:
- ✅ Persistent session storage (KV, sessions never expire)
- ✅ Step sequencer views (chromatic grid for melodic input)
- ✅ Mobile-responsive interface (portrait mode with expandable panels, touch-optimized)

---

## Success Metrics

| Metric | Target | How to Verify |
|--------|--------|---------------|
| Time to first sound | < 30 seconds from landing | User testing |
| Latency (perceived) | < 50ms for local actions | Measure click-to-sound time |
| Sync accuracy | < 20ms drift between players | Compare recordings from two clients |
| Session stability | No crashes during 30-min session | Automated testing |
| Browser support | Chrome, Firefox, Safari, Edge (latest) | Cross-browser testing |

### The "Same Music" Test

To verify all players hear identical audio:
1. Two players join a session from different locations
2. Both screen-record their session with audio
3. Compare the audio tracks—they should align within 20ms
4. Repeat with players triggering clips at different times

---

## Open Questions

1. **Tempo changes**: Should tempo be adjustable mid-session? By whom?
2. **Track ownership**: Can anyone edit any track, or claim ownership?
3. **Kick/ban**: Should the session creator have moderator powers?
4. **Sample moderation**: Any content filtering for recorded samples?
5. **Mobile**: Read-only mobile view for observers?

---

## Future Considerations (v2+)

- Optional user accounts for saving favorite samples (Phase 16: Authentication)
- Export session as audio file
- Effects per track (reverb, filter, etc.) (Phase 19: Advanced Synthesis Engine)
- Public session lobby (Phase 18: Publishing Platform)
- Chat/reactions
- MIDI controller support

**Note:** Some future considerations are now implemented:
- ✅ Step sequencer mode for drums (Phase 4B: Chromatic Step View)
- ✅ Mobile-responsive design (Phase 15: Mobile Portrait Mode)
