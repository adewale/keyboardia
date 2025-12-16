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
Track muted                   →     Track omitted (or all velocity 0)
Swing                         →     Timing offset on even steps
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

  // Apply swing to even steps (1, 3, 5, 7...)
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

- All unmuted tracks
- Full pattern length (respects per-track step counts)
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

```typescript
import MidiWriter from 'midi-writer-js';

function exportToMidi(session: Session): Blob {
  const tracks: MidiWriter.Track[] = [];

  // Track 0: Tempo
  const tempoTrack = new MidiWriter.Track();
  tempoTrack.setTempo(session.tempo);
  tempoTrack.setTimeSignature(4, 4);
  tracks.push(tempoTrack);

  // Instrument tracks
  for (const track of session.tracks) {
    if (track.muted) continue;

    const midiTrack = new MidiWriter.Track();
    midiTrack.addTrackName(track.name);

    // Set channel (10 for drums)
    const channel = isDrumTrack(track) ? 10 : tracks.length;

    // Add notes
    for (let step = 0; step < track.stepCount; step++) {
      if (!track.steps[step]) continue;

      const pLock = track.parameterLocks[step] || {};
      const pitch = getNotePitch(track, step, pLock);
      const velocity = getVelocity(pLock);
      const startTick = stepToTicks(step, session.swing);

      midiTrack.addEvent(new MidiWriter.NoteEvent({
        pitch: pitch,
        velocity: velocity,
        startTick: startTick,
        duration: 'T' + NOTE_DURATION_TICKS,
        channel: channel
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
function downloadMidi(session: Session): void {
  const blob = exportToMidi(session);
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(session.name)}.mid`;
  a.click();

  URL.revokeObjectURL(url);
}
```

---

## Edge Cases

### Polyrhythms (Different Step Counts)

Each track exports its own loop length. MIDI file length = LCM of all track lengths.

```
Track A: 16 steps (1 bar)   → loops 4×
Track B: 64 steps (4 bars)  → loops 1×
MIDI file: 4 bars total
```

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

### Test Cases

1. **Basic export** — 4 tracks, 16 steps each, no p-locks
2. **With pitch locks** — Melody using chromatic grid
3. **With volume locks** — Velocity variation
4. **With swing** — Verify timing offsets
5. **Polyrhythm** — 16-step + 32-step tracks
6. **Drums only** — Verify channel 10
7. **Synths only** — Verify program changes
8. **Empty session** — Should produce valid (empty) MIDI
9. **Muted tracks** — Should be omitted
10. **Max complexity** — 16 tracks, 64 steps, all p-locks

### DAW Compatibility Testing

- Ableton Live
- FL Studio
- Logic Pro
- GarageBand
- Reaper
- BandLab (browser)

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

## Future Enhancements

| Feature | Description | Phase |
|---------|-------------|-------|
| **MIDI Import** | Drag MIDI file onto Keyboardia | Phase 24 |
| **CC Export** | Filter cutoff as CC messages | Future |
| **Clip Export** | Export individual clips | Future |
| **Direct DAW Send** | Ableton Link / MIDI over WebSocket | Future |
| **Audio Export** | Bounce to WAV (requires latency compensation) | Future |

---

*MIDI export is planned for Phase 32. See [ROADMAP.md](./ROADMAP.md) for timeline.*
