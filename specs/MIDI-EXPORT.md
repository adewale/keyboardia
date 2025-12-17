# MIDI Export Specification

Export Keyboardia sessions as Standard MIDI Files for use in DAWs and other music software.

---

## Overview

| Aspect | Decision |
|--------|----------|
| **Format** | Standard MIDI File (SMF) Type 1 |
| **File extension** | `.mid` |
| **Tracks** | One MIDI track per Keyboardia track |
| **Resolution** | 480 ticks per quarter note (industry standard) |
| **Tempo** | Embedded in file header |

---

## Core Principle: What You Hear Is What You Export

**MIDI export MUST produce the same audible result as session playback.**

This is the fundamental requirement. If a track plays during real-time playback, it appears in the exported MIDI. If a track is silent during playback, it is omitted from the export.

This ensures users experience no surprises when opening their exported MIDI in a DAW.

---

## Track Selection Logic

### Source of Truth

Track filtering uses the **same logic as the audio scheduler**. This is a cross-cutting concern that affects playback, playhead visibility, and export.

**Canonical Implementation:** `app/src/audio/scheduler.ts:249-251`

```typescript
// This is the golden master for track selection logic
const anySoloed = tracks.some(t => t.soloed);
const shouldPlay = anySoloed ? track.soloed : !track.muted;
```

### Filtering Rules

| Condition | Which Tracks Export |
|-----------|---------------------|
| No tracks soloed | All unmuted tracks |
| Any track soloed | Only soloed tracks (regardless of mute state) |
| Track is muted + soloed | **Exports** (solo wins over mute) |

### Implementation Requirement

**MUST** use or replicate the scheduler's filtering logic. **DO NOT** implement separate filtering logic by checking `track.muted` directly without considering `track.soloed`.

**Anti-pattern (incorrect):**
```typescript
// ❌ WRONG: Ignores solo mode entirely
if (track.muted) continue;
```

**Correct pattern:**
```typescript
// ✅ CORRECT: Same logic as audio scheduler
const anySoloed = tracks.some(t => t.soloed);
const shouldExport = anySoloed ? track.soloed : !track.muted;
if (!shouldExport) continue;
```

### Behavioral Parity Test Matrix

These test cases verify MIDI export matches real-time playback:

| ID | Track 1 | Track 2 | Track 3 | Plays During Playback | Appears in MIDI |
|----|---------|---------|---------|----------------------|-----------------|
| BP-01 | normal | normal | normal | 1, 2, 3 | 1, 2, 3 |
| BP-02 | muted | normal | normal | 2, 3 | 2, 3 |
| BP-03 | soloed | normal | normal | 1 only | 1 only |
| BP-04 | soloed | soloed | normal | 1, 2 | 1, 2 |
| BP-05 | muted+soloed | normal | normal | 1 only | 1 only |
| BP-06 | muted | muted | muted | none | none (tempo only) |
| BP-07 | soloed | muted | muted | 1 only | 1 only |
| BP-08 | normal | soloed | muted+soloed | 2, 3 | 2, 3 |

**Parity Requirement:** For every row, "Plays During Playback" MUST equal "Appears in MIDI".

---

## Data Mapping

### Keyboardia → MIDI

```
KEYBOARDIA                          MIDI
──────────────────────────────────────────────────────
Session tempo (BPM)           →     Tempo meta event
Track                         →     MIDI Track
Step (on)                     →     Note On + Note Off
Step (off)                    →     (nothing)
Parameter lock: pitch         →     Note number offset
Parameter lock: volume        →     Velocity (0-127)
Track transpose               →     Added to note number
Track selection               →     See "Track Selection Logic" above
Swing                         →     Timing offset on off-beat steps
```

### Note Mapping

**Synth tracks:**
```
Base note: 60 (Middle C / C4)
Final note = 60 + track.transpose + step.parameterLock.pitch

Example:
- Track transpose: +5 (F4)
- Step pitch lock: +7
- Final MIDI note: 60 + 5 + 7 = 72 (C5)
```

**Drum tracks:**
```
Channel: 10 (General MIDI drum channel)
Note mapping:
  kick    → 36 (C2)
  snare   → 38 (D2)
  hihat   → 42 (F#2)
  openhat → 46 (A#2)
  clap    → 39 (D#2)
  tom     → 45 (A2)
  rim     → 37 (C#2)
  cowbell → 56 (G#3)
```

### Velocity Mapping

```typescript
// Volume p-lock (0.0 - 1.0) → MIDI velocity (1 - 127)
const velocity = Math.max(1, Math.round(volumePLock * 127));

// No p-lock = default velocity
const DEFAULT_VELOCITY = 100;
```

### Timing Calculation

```typescript
const TICKS_PER_QUARTER = 480;
const STEPS_PER_BEAT = 4;  // 16th notes
const TICKS_PER_STEP = TICKS_PER_QUARTER / STEPS_PER_BEAT;  // 120 ticks

function stepToTicks(step: number, swing: number): number {
  const baseTicks = step * TICKS_PER_STEP;

  // Apply swing to off-beat steps (1, 3, 5, 7...)
  if (step % 2 === 1 && swing > 0) {
    const swingOffset = (swing / 100) * TICKS_PER_STEP * 0.5;
    return baseTicks + swingOffset;
  }

  return baseTicks;
}
```

### Note Duration

```typescript
// One-shot mode: note plays for one step
const NOTE_DURATION_TICKS = TICKS_PER_STEP - 1;  // 119 ticks

// Gate mode (future): duration = number of consecutive steps
```

---

## File Structure

### SMF Type 1 Layout

```
MIDI File
├── Header Chunk (MThd)
│   ├── Format: 1 (multi-track)
│   ├── Number of tracks: N + 1 (tempo track + N instrument tracks)
│   └── Ticks per quarter: 480
│
├── Track 0: Tempo Track
│   ├── Time signature: 4/4
│   ├── Tempo: microseconds per quarter note
│   └── End of track
│
├── Track 1: First Keyboardia track
│   ├── Track name: "Kick" (or instrument name)
│   ├── Program change (for synths)
│   ├── Note events...
│   └── End of track
│
├── Track 2: Second Keyboardia track
│   └── ...
│
└── Track N: Last Keyboardia track
```

### Tempo Calculation

```typescript
// MIDI tempo is microseconds per quarter note
const microsecondsPerQuarter = Math.round(60_000_000 / bpm);

// Example: 120 BPM = 500,000 μs per quarter
```

---

## UI Design

### Principle: No New Clutter

MIDI export should not add buttons, dropdowns, or modals. One click, one outcome.

### MVP: Download Icon

Add a download icon (↓) to the header. One click downloads MIDI.

```
┌─────────────────────────────────────────────────────────────┐
│  KEYBOARDIA                      [Invite] [Send Copy] [↓]   │
└─────────────────────────────────────────────────────────────┘
                                                         ↑
                                                   Downloads .mid
```

- **No dropdown menu**
- **No format selection**
- **No options modal**
- Tooltip: "Download MIDI"

### Behavior

| Action | Result |
|--------|--------|
| Click ↓ | Downloads `{session-name}.mid` immediately |
| Empty session | Downloads valid empty MIDI file |
| All tracks muted | Downloads MIDI with tempo only |
| Some tracks soloed | Downloads only soloed tracks |

### Future: Multiple Export Formats

When audio export is added, move downloads into the "Send Copy" modal:

```
┌─────────────────────────┐
│  Share this session     │
│                         │
│  [Copy Link]            │
│  [Download MIDI]        │
│  [Download Audio]       │
│                         │
└─────────────────────────┘
```

This keeps the header clean and groups "take this elsewhere" actions together.

### What Gets Exported

- All tracks where `shouldExport === true` (see Track Selection Logic)
- Full pattern length (LCM of per-track step counts for polyrhythms)
- Tempo and swing embedded
- No options — sensible defaults only

---

## Implementation

### Recommended Library

**[midi-writer-js](https://www.npmjs.com/package/midi-writer-js)**

- Zero dependencies
- 15KB minified
- Well-maintained
- Simple API

### Reference Implementation

```typescript
import MidiWriter from 'midi-writer-js';

function exportToMidi(state: GridState): Blob {
  const tracks: MidiTrack[] = [];

  // Track 0: Tempo
  const tempoTrack = new MidiWriter.Track();
  tempoTrack.setTempo(state.tempo);
  tempoTrack.setTimeSignature(4, 4, 24, 8);
  tempoTrack.addTrackName('Tempo');
  tracks.push(tempoTrack);

  // Determine track selection (MUST match scheduler logic)
  const anySoloed = state.tracks.some(t => t.soloed);

  // Instrument tracks
  for (const track of state.tracks) {
    // ✅ CORRECT: Same logic as audio scheduler
    const shouldExport = anySoloed ? track.soloed : !track.muted;
    if (!shouldExport) continue;

    // Skip empty tracks
    if (!track.steps.some(s => s)) continue;

    const midiTrack = new MidiWriter.Track();
    midiTrack.addTrackName(track.name);

    // Set channel (10 for drums)
    const channel = isDrumTrack(track) ? 10 : tracks.length;

    // Add program change for synths
    if (!isDrumTrack(track)) {
      midiTrack.addEvent(new MidiWriter.ProgramChangeEvent({
        instrument: getSynthProgram(track),
        channel
      }));
    }

    // Add notes
    for (let step = 0; step < track.stepCount; step++) {
      if (!track.steps[step]) continue;

      const pLock = track.parameterLocks[step] || {};
      const pitch = getNotePitch(track, pLock);
      const velocity = getVelocity(pLock);
      const startTick = stepToTicks(step, state.swing);

      midiTrack.addEvent(new MidiWriter.NoteEvent({
        pitch: [pitch],
        velocity,
        startTick,
        duration: `T${NOTE_DURATION_TICKS}`,
        channel
      }));
    }

    tracks.push(midiTrack);
  }

  const writer = new MidiWriter.Writer(tracks);
  return new Blob([writer.buildFile()], { type: 'audio/midi' });
}
```

### File Download

```typescript
function downloadMidi(state: GridState, sessionName: string | null): void {
  const blob = exportToMidi(state);
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(sessionName)}.mid`;
  a.click();

  URL.revokeObjectURL(url);
}
```

---

## Edge Cases

### Polyrhythms (Different Step Counts)

Each track exports its own loop length. MIDI file length = LCM of all active track lengths.

```
Track A: 16 steps (1 bar)   → loops 4×
Track B: 64 steps (4 bars)  → loops 1×
MIDI file: 4 bars total
```

**Note:** LCM calculation MUST also respect track selection logic. Only include step counts from tracks that will be exported.

### Empty Tracks

Skip tracks with no active steps.

### Custom Recordings

Drum samples from microphone recordings export as notes on channel 10, using a placeholder note (e.g., 60). User can reassign in DAW.

### Synth Presets → Program Changes

| Keyboardia Preset | General MIDI Program |
|-------------------|---------------------|
| bass | 33 (Electric Bass Finger) |
| lead | 81 (Lead 1 Square) |
| pad | 89 (Pad 1 New Age) |
| pluck | 46 (Orchestral Harp) |
| acid | 87 (Lead 7 Fifths) |
| rhodes | 5 (Electric Piano 1) |
| organ | 17 (Drawbar Organ) |
| strings | 49 (String Ensemble 1) |
| brass | 62 (Brass Section) |

---

## Validation

### Behavioral Parity Tests (Priority: Critical)

These tests verify the core principle: "What you hear is what you export."

```typescript
describe('MIDI Export: Behavioral Parity', () => {
  const TEST_CASES = [
    { id: 'BP-01', t1: {}, t2: {}, t3: {}, expected: [1, 2, 3] },
    { id: 'BP-02', t1: { muted: true }, t2: {}, t3: {}, expected: [2, 3] },
    { id: 'BP-03', t1: { soloed: true }, t2: {}, t3: {}, expected: [1] },
    { id: 'BP-04', t1: { soloed: true }, t2: { soloed: true }, t3: {}, expected: [1, 2] },
    { id: 'BP-05', t1: { muted: true, soloed: true }, t2: {}, t3: {}, expected: [1] },
    { id: 'BP-06', t1: { muted: true }, t2: { muted: true }, t3: { muted: true }, expected: [] },
    { id: 'BP-07', t1: { soloed: true }, t2: { muted: true }, t3: { muted: true }, expected: [1] },
    { id: 'BP-08', t1: {}, t2: { soloed: true }, t3: { muted: true, soloed: true }, expected: [2, 3] },
  ];

  TEST_CASES.forEach(({ id, t1, t2, t3, expected }) => {
    it(`${id}: exported tracks match playback`, () => {
      const session = createSession({
        tracks: [
          createTrack({ id: '1', ...t1 }),
          createTrack({ id: '2', ...t2 }),
          createTrack({ id: '3', ...t3 }),
        ]
      });

      // Golden master: scheduler logic
      const anySoloed = session.tracks.some(t => t.soloed);
      const playingIds = session.tracks
        .filter(t => anySoloed ? t.soloed : !t.muted)
        .map(t => parseInt(t.id));

      // Subject under test
      const midi = exportToMidi(session);
      const exportedIds = parseMidiTrackIds(midi);

      expect(exportedIds).toEqual(expected);
      expect(exportedIds).toEqual(playingIds);
    });
  });
});
```

### Feature Tests

1. **Basic export** — 4 tracks, 16 steps each, no p-locks
2. **With pitch locks** — Melody using chromatic grid
3. **With volume locks** — Velocity variation
4. **With swing** — Verify timing offsets
5. **Polyrhythm** — 16-step + 32-step tracks
6. **Drums only** — Verify channel 10
7. **Synths only** — Verify program changes
8. **Empty session** — Should produce valid (empty) MIDI
9. **Max complexity** — 16 tracks, 64 steps, all p-locks

### DAW Compatibility Testing

Import exported MIDI into:
- Ableton Live
- FL Studio
- Logic Pro
- GarageBand
- Reaper
- BandLab (browser)

**Success Criterion:** Playback in DAW should contain the same tracks that were audible during Keyboardia playback.

---

## Success Criteria

- [ ] Exported MIDI plays correctly in Ableton Live
- [ ] Tempo matches Keyboardia session
- [ ] Note pitches match (including transpose + p-locks)
- [ ] Velocities reflect volume p-locks
- [ ] Swing timing is audible
- [ ] Drums appear on channel 10
- [ ] File size < 100KB for typical session
- [ ] Export completes in < 100ms
- [ ] Works on mobile Safari/Chrome
- [ ] **Behavioral parity: exported tracks match playback tracks for all mute/solo states**

---

## Output Latency Compensation

### Why MIDI Export Is Unaffected by Effects Latency

Keyboardia's audio engine has two signal paths:

1. **Native synth path**: `masterGain → compressor → destination` (direct, minimal latency)
2. **Effects path**: `masterGain → effects chain → limiter → destination` (added processing latency)

When effects are enabled, Tone.js nodes (distortion, chorus, delay, reverb, limiter) introduce small processing delays (a few milliseconds per node, totaling <10ms).

**Key insight:** MIDI export captures **logical note events** (step positions), not the audio output. The exported MIDI file represents the *intended* timing of notes, which is what DAWs need for further editing and arrangement.

| Aspect | Real-time Playback | MIDI Export |
|--------|-------------------|-------------|
| Effects latency | Affects audio output (~5-10ms) | **Not applicable** |
| Note timing | Scheduled via Web Audio | Written as tick positions |
| Swing offset | Applied at audio time | Calculated as tick offset |
| Result | What you hear | What you wrote |

### When Latency Matters

Effects latency would only matter if Keyboardia supported:
- Live MIDI output to external hardware (not implemented)
- Synchronization with external DAWs (not implemented)
- Audio recording/bounce to WAV (not implemented)

For MIDI export, the file correctly represents the musical intent without any latency artifacts.

### Future Consideration: Audio Export

If Keyboardia adds audio export (bounce to WAV), the effects chain latency will need to be accounted for:
- Either: Start recording slightly before playback and trim the beginning
- Or: Apply latency compensation offset to align audio with MIDI

This is a known consideration for Phase 25+ features.

---

## Cross-References

### Normative References (MUST follow)

| Document | Section | Relevance |
|----------|---------|-----------|
| This spec | Track Selection Logic | Defines which tracks to export |

### Informative References (Implementation guidance)

| File | Purpose |
|------|---------|
| `app/src/audio/scheduler.ts:249-251` | Canonical track filtering logic |
| `app/src/audio/midiExport.ts` | Reference implementation |
| `app/src/audio/midiExport.test.ts` | Behavioral parity tests |

### Dependent Features

When modifying track selection behavior (mute, solo), update:
- Audio scheduler (source of truth)
- MIDI export (this spec)
- Future: Audio export

---

## Future Enhancements

| Feature | Description | Phase |
|---------|-------------|-------|
| **MIDI Import** | Drag MIDI file onto Keyboardia | Future |
| **CC Export** | Filter cutoff as CC messages | Future |
| **Clip Export** | Export individual clips | Future |
| **Direct DAW Send** | Ableton Link / MIDI over WebSocket | Future |
| **Audio Export** | Bounce to WAV (requires latency compensation) | Future |

---

## Changelog

| Date | Change |
|------|--------|
| Phase 32 | Initial implementation |
| Phase 32.1 | Added Track Selection Logic section, behavioral parity tests, solo mode support |

---

*MIDI export was implemented in Phase 32. See [ROADMAP.md](./ROADMAP.md) for timeline.*
