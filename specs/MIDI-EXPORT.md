# MIDI Export Specification

Export Keyboardia sessions as Standard MIDI Files for use in DAWs and other music software.

---

## Overview

| Aspect | Decision |
|--------|----------|
| **Format** | Standard MIDI File (SMF) Type 1 |
| **File extension** | `.mid` |
| **Tracks** | One MIDI track per Keyboardia track |
| **Resolution** | 128 ticks per quarter note (midi-writer-js default) |
| **Tempo** | Embedded in file header |

### Why Type 1?

SMF (Standard MIDI File) has two common formats:

**Type 0 — Single Track:**
```
MIDI File
└── Track 0: All instruments merged (channel info preserved)
              Kick, Snare, Bass, Lead all interleaved
```
- All events merged into one track
- Channel numbers preserved, but tracks are indistinguishable
- **Problem:** If two Keyboardia tracks use the same MIDI channel (e.g., two synths), they merge permanently when re-imported

**Type 1 — Multi-Track (what we use):**
```
MIDI File
├── Track 0: Tempo/time signature
├── Track 1: Kick
├── Track 2: Snare
├── Track 3: Bass
└── Track 4: Lead
```
- Each instrument is a separate track
- DAWs display them as individual lanes
- Users can edit, mute, reassign instruments per track

**Why Type 1 for Keyboardia?**

Users export MIDI to **edit in a DAW**. Type 1 preserves the track structure they created. Type 0 would collapse everything into one track, defeating the purpose.

All modern DAWs (Ableton, Logic, FL Studio, Cubase, GarageBand) fully support Type 1.

### Why 128 PPQN?

We use 128 ticks per quarter note because it's the default resolution used by the midi-writer-js library. While 480 PPQN is the industry standard, 128 PPQN provides sufficient timing resolution for step-sequencer music:

- At 128 PPQN with 4 steps per beat, each step = 32 ticks
- At 120 BPM, 1 tick ≈ 3.9ms (imperceptible for quantized music)
- 16th-note resolution is preserved with adequate swing granularity

**Note:** For triplet support in future versions, we may need to configure 480 PPQN or use a library that supports it (480 ÷ 12 = 40 ticks per triplet 8th).

---

## Core Principle: What You Hear Is What You Export

**MIDI export MUST produce the same audible result as session playback.**

This is the fundamental requirement. If a track plays during real-time playback, it appears in the exported MIDI. If a track is silent during playback, it is omitted from the export.

This ensures users experience no surprises when opening their exported MIDI in a DAW.

---

## Track Selection Logic

### Source of Truth

Track filtering uses the **same logic as the audio scheduler**. This is a cross-cutting concern that affects playback, playhead visibility, and export.

**Canonical Implementation:** `app/src/audio/scheduler.ts` (search for `// @spec: track-selection`)

```typescript
// @spec: track-selection - This is the golden master for track filtering
const anySoloed = state.tracks.some(t => t.soloed);
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
Final note = clamp(60 + track.transpose + step.parameterLock.pitch, 0, 127)

Example:
- Track transpose: +5 (F4)
- Step pitch lock: +7
- Final MIDI note: 60 + 5 + 7 = 72 (C5)
```

**Note Range Validation (Required):**
```typescript
// MIDI notes must be 0-127. Clamp to prevent wrap-around.
const finalNote = Math.max(0, Math.min(127, BASE_NOTE + track.transpose + pitchOffset));
```

Without clamping, note 144 would wrap to note 16 (144 - 128), causing unexpected low notes.

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

These are standard GM drum mappings (notes 35-81). Staying within this range ensures maximum compatibility across DAWs and GM-compatible devices.

### Velocity Mapping

```typescript
// Volume p-lock (0.0 - 1.0) → percentage (1 - 100)
// midi-writer-js then scales this to MIDI velocity (1 - 127)
const velocity = Math.max(1, Math.round(volumePLock * 100));

// No p-lock = default velocity (100% = MIDI 127)
const DEFAULT_VELOCITY = 100;
```

**Important:** See [midi-writer-js Quirks](#midi-writer-js-quirks) section — the library treats velocity as percentage (0-100), not MIDI value (0-127).

### Timing Calculation

```typescript
const TICKS_PER_QUARTER = 128;  // midi-writer-js default
const STEPS_PER_BEAT = 4;  // 16th notes
const TICKS_PER_STEP = TICKS_PER_QUARTER / STEPS_PER_BEAT;  // 32 ticks

function stepToTicks(step: number, swing: number): number {
  const baseTicks = step * TICKS_PER_STEP;

  // Apply swing to off-beat steps (1, 3, 5, 7...)
  if (step % 2 === 1 && swing > 0) {
    // Swing offset ranges from 0 to half a step (0-16 ticks at 100% swing)
    const swingOffset = (swing / 100) * TICKS_PER_STEP * 0.5;
    return Math.round(baseTicks + swingOffset);
  }

  return baseTicks;
}
```

### Note Duration and Note-Off Timing

```typescript
// One-shot mode: note plays for one step minus 1 tick
const NOTE_DURATION_TICKS = TICKS_PER_STEP - 1;  // 31 ticks

// Gate mode (future): duration = number of consecutive steps
```

**Why minus 1 tick?**

When the same MIDI note plays repeatedly, if note-off and next note-on occur at the same tick, the order matters:
- Wrong order (note-on then note-off): note never plays
- Correct order (note-off then note-on): note plays correctly

Using `TICKS_PER_STEP - 1` ensures note-off always occurs before the next note-on:
```
Note-on:  tick 0
Note-off: tick 31
Next note-on: tick 32  ✅ No conflict
```

---

## File Structure

### SMF Type 1 Layout

```
MIDI File
├── Header Chunk (MThd)
│   ├── Format: 1 (multi-track)
│   ├── Number of tracks: N + 1 (tempo track + N instrument tracks)
│   └── Ticks per quarter: 128
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

### midi-writer-js Quirks

The library has some behaviors to be aware of:

**Velocity is percentage-based (0-100):**
```typescript
// ⚠️ midi-writer-js treats velocity as percentage, NOT MIDI value
// Input: 100 (interpreted as 100%) → Output: 127 (MIDI velocity)
// Input: 50 (interpreted as 50%) → Output: 64 (MIDI velocity)

// Our getVelocity returns percentage (0-100) not MIDI (0-127)
function getVelocity(pLock: ParameterLock | null): number {
  if (pLock?.volume !== undefined) {
    return Math.max(1, Math.round(pLock.volume * 100));  // percentage
  }
  return 100;  // 100% = MIDI 127
}
```

**Program numbers are 0-indexed:**
```typescript
// GM spec uses 1-indexed (1-128), MIDI files use 0-indexed (0-127)
const program = getSynthProgram(track);  // Returns 1-indexed (e.g., 33 for bass)
new MidiWriter.ProgramChangeEvent({ instrument: program - 1, channel });  // 0-indexed
```

**Fixed PPQN of 128:**
The library always uses 128 ticks per quarter note. This is sufficient for step-sequencer music but differs from the industry-standard 480 PPQN.

### Conceptual Overview

The reference implementation below is simplified for clarity. See `app/src/audio/midiExport.ts` for the actual implementation, which includes:

- Full polyrhythm support (LCM calculation, loop expansion)
- Proper channel assignment (dedicated counter that skips channel 10)
- Separate functions for drum vs synth note pitch
- Note clamping to 0-127 range (prevents wrap-around)
- `MidiExportResult` return type with blob and filename
- `Pick<GridState, 'tracks' | 'tempo' | 'swing'>` for minimal type requirements
- ArrayBuffer workaround for TypeScript Blob compatibility

```typescript
import MidiWriter from 'midi-writer-js';

// Conceptual implementation - see midiExport.ts for actual code
function exportToMidi(state: GridState): MidiExportResult {
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

    // ... add program changes, notes, etc.

    tracks.push(midiTrack);
  }

  const writer = new MidiWriter.Writer(tracks);
  const blob = new Blob([writer.buildFile()], { type: 'audio/midi' });
  return { blob, filename: `${sessionName}.mid` };
}
```

### File Download

```typescript
function downloadMidi(
  state: Pick<GridState, 'tracks' | 'tempo' | 'swing'>,
  sessionName: string | null = null
): void {
  const { blob, filename } = exportToMidi(state, { sessionName });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;

  // Append to DOM for better browser compatibility (especially Safari)
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Required: release the object URL to prevent memory leaks
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
| subbass | 39 (Synth Bass 2) |
| lead | 81 (Lead 1 Square) |
| pad | 89 (Pad 1 New Age) |
| chord | 89 (Pad 1 New Age) |
| pluck | 46 (Orchestral Harp) |
| acid | 87 (Lead 7 Fifths) |
| rhodes | 5 (Electric Piano 1) |
| organ | 17 (Drawbar Organ) |
| strings | 49 (String Ensemble 1) |
| brass | 62 (Brass Section) |
| piano | 1 (Acoustic Grand Piano) |
| funkbass | 37 (Slap Bass 1) |
| fm-epiano | 5 (Electric Piano 1) |
| am-synth | 81 (Lead 1 Square) |
| membrane | 47 (Timpani) |
| metal | 14 (Tubular Bells) |
| pluck-synth | 46 (Orchestral Harp) |
| *default* | 1 (Acoustic Grand Piano) |

**Program Change Limitations:**

GM program changes are included for compatibility with GM-compatible hardware and basic soft-synth libraries. However:

- Modern DAWs with custom soft-synths often ignore program changes
- Most producers immediately replace GM instruments with their preferred VSTs
- If using non-GM instruments, users may need to disable program changes in their DAW settings

**Never include GM RESET SysEx messages** — they override all settings and force all parts to "Concert Grand," which is catastrophic for user experience.

### Adding New Instruments

When adding new samples or synth presets to Keyboardia, update the MIDI export mappings:

**For new drum samples:**
1. Add to `DRUM_NOTE_MAP` in `app/src/audio/midiExport.ts`
2. Use standard GM drum notes (35-81) when possible
3. Add test case to `getDrumNote` test suite

**For new synth presets:**
1. Add to `SYNTH_PROGRAM_MAP` in `app/src/audio/midiExport.ts`
2. Choose closest GM program number (see [General MIDI spec](https://en.wikipedia.org/wiki/General_MIDI))
3. Add test case to `getSynthProgram` test suite

**Fallback Behavior (Current):**
```typescript
// Unknown presets silently fall back to piano (program 1)
return SYNTH_PROGRAM_MAP[preset] ?? SYNTH_PROGRAM_MAP.default;
```

⚠️ **Warning:** If you add a new preset without updating `SYNTH_PROGRAM_MAP`, it will export as piano with no error or test failure. Users may be confused when their bass synth appears as piano in their DAW.

**Cross-References:**
| File | Contains |
|------|----------|
| `app/src/audio/synth.ts` | `SYNTH_PRESETS` (32 presets) |
| `app/src/audio/toneSynths.ts` | `TONE_SYNTH_PRESETS` |
| `app/src/audio/advancedSynth.ts` | `ADVANCED_SYNTH_PRESETS` (8 presets) |
| `app/src/audio/midiExport.ts` | `DRUM_NOTE_MAP`, `SYNTH_PROGRAM_MAP` |

### Recommended: Coverage Test

To prevent silent fallbacks, add a test that verifies all presets have explicit MIDI mappings.

**Implementation Note:** `SYNTH_PROGRAM_MAP` is currently not exported. To enable this test:
1. Export `SYNTH_PROGRAM_MAP` from `midiExport.ts`, OR
2. Add a helper function `hasExplicitMapping(presetId: string): boolean`

```typescript
import { SYNTH_PRESETS } from './synth';
import { SYNTH_PROGRAM_MAP } from './midiExport'; // requires export

describe('MIDI Export: Preset Coverage', () => {
  it('all synth presets have explicit MIDI program mappings', () => {
    const unmapped = Object.keys(SYNTH_PRESETS).filter(
      preset => !SYNTH_PROGRAM_MAP[preset]
    );

    expect(unmapped).toEqual([]);
    // If this fails, add the missing presets to SYNTH_PROGRAM_MAP
  });
});
```

**Status:** ⚠️ Not yet implemented. This test would fail today because only 17 of 32 synth presets have explicit mappings.

---

## DAW Compatibility

### Known Issues by DAW

| DAW | Notes |
|-----|-------|
| **Ableton Live** | Program changes only apply to whole clips. May need to disable GM drum map for correct note mapping. Does not export tempo changes (import only). |
| **Logic Pro** | Full compatibility. Uses 960 PPQN internally (converts automatically). |
| **FL Studio** | Full compatibility. Default 96 PPQN may cause slight quantization on import. |
| **GarageBand** | Limited MIDI import. Cannot export MIDI with program changes. |
| **Cubase** | Full compatibility. Known bug in v12 where program changes may be missing from exports. |
| **Reaper** | Full compatibility. |
| **BandLab** | Browser-based, limited testing. Basic import works. |

### Channel 10 Drum Quirks

- Some DAWs have internal drum maps that intercept channel 10 MIDI, causing wrong notes to play
- Solution: Users may need to set DAW to "GM mode" or disable drum mapping
- Stick to standard GM drum note mappings (35-81) for maximum compatibility

### Import Testing Checklist

Before release, import exported MIDI into at least 3 DAWs:
1. Ableton Live (industry standard)
2. Logic Pro or FL Studio (popular alternatives)
3. GarageBand (lowest common denominator)

If all three accept and play the file correctly, structure is sound.

---

## Validation

### Behavioral Parity Tests

Tests verify the core principle: "What you hear is what you export."

```typescript
describe('MIDI Export: Behavioral Parity', () => {
  it('exports only soloed tracks when any track is soloed', () => {
    const soloedTrack = createTrack({ soloed: true, steps: [true, false, false, false] });
    const notSoloedTrack = createTrack({ soloed: false, steps: [false, true, false, true] });
    const state = createState({ tracks: [soloedTrack, notSoloedTrack] });

    const result = exportToMidi(state);

    // Verify by comparing to export with only the soloed track
    const stateSoloOnly = createState({ tracks: [soloedTrack] });
    const resultSoloOnly = exportToMidi(stateSoloOnly);

    expect(result.blob.size).toBe(resultSoloOnly.blob.size);
  });

  it('solo wins over mute (soloed+muted track is exported)', () => {
    const track = createTrack({ soloed: true, muted: true, steps: [true, false, false, false] });
    const state = createState({ tracks: [track] });

    const result = exportToMidi(state);

    expect(result.blob.size).toBeGreaterThan(0);
  });
});
```

### Fidelity Tests

The behavioral parity tests above verify track selection logic. We also have comprehensive **fidelity tests** that parse the actual MIDI output and verify:

| Category | What's Verified |
|----------|----------------|
| **File Structure** | SMF Type 1 format, 128 PPQN, correct track count |
| **Tempo** | Microseconds per quarter note matches BPM |
| **Note Timing** | Tick positions, swing offsets |
| **Note Pitch** | Drum GM notes, synth pitches, transpose, p-locks, clamping |
| **Velocity** | Default velocity, volume p-lock scaling |
| **Channels** | Drums on 10, synths skip 10 |
| **Program Changes** | Correct GM programs, 0-indexed |
| **Polyrhythms** | LCM expansion, correct loop counts |
| **Track Selection** | Mute/solo behavior |

**Implementation:** `app/src/audio/midiExport.fidelity.test.ts`

Uses the `midi-file` npm package to parse exported MIDI:

```typescript
import { parseMidi, MidiData } from 'midi-file';

function parseMidiData(midiData: Uint8Array): MidiData {
  return parseMidi(midiData);
}

// Extract note-on events with absolute tick positions
function extractNoteEvents(midi: MidiData): NoteEvent[] {
  const notes: NoteEvent[] = [];
  midi.tracks.forEach((track, trackIndex) => {
    let absoluteTick = 0;
    for (const event of track) {
      absoluteTick += event.deltaTime;
      if (event.type === 'noteOn' && event.velocity > 0) {
        notes.push({
          track: trackIndex,
          channel: event.channel,
          noteNumber: event.noteNumber,
          velocity: event.velocity,
          absoluteTick,
        });
      }
    }
  });
  return notes;
}
```

**Key Test Example:**

```typescript
it('places notes at correct tick positions (no swing)', async () => {
  const track = createTrack({
    sampleId: 'kick',
    steps: [true, false, true, false, true, false, true, false],
  });
  const state = createState({ tracks: [track], swing: 0 });
  const result = exportToMidi(state);
  const midi = parseMidiData(result._midiData);
  const notes = extractNoteEvents(midi);

  // Each step = 32 ticks (128 PPQN / 4 steps per beat)
  expect(notes[0].absoluteTick).toBe(0);   // Step 0
  expect(notes[1].absoluteTick).toBe(64);  // Step 2
  expect(notes[2].absoluteTick).toBe(128); // Step 4
  expect(notes[3].absoluteTick).toBe(192); // Step 6
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

### MIDI Validation Tools

For debugging malformed MIDI files:

| Tool | Purpose |
|------|---------|
| [MIDICSV](https://www.fourmilab.ch/webtools/midicsv/) | Convert MIDI ↔ CSV for text analysis |
| [MidiExplorer](https://midiexplorer.sourceforge.io/) | Visual MIDI file inspection |
| [GNMIDI Check](https://www.gnmidi.com/handbook/english/checkrepair.htm) | Validate MIDI structure |

### Common "File Corrupted" Causes

1. **Missing MTrk chunks** — Track not properly written
2. **Track count mismatch** — Header says 5 tracks, file contains 3
3. **Missing end-of-track markers** — File ends abruptly
4. **Truncated download** — File transfer interrupted

The midi-writer-js library handles track/header structure correctly. If corruption occurs, check for interrupted downloads or memory issues.

---

## Success Criteria

| Criterion | Status | Notes |
|-----------|--------|-------|
| Exported MIDI plays correctly in Ableton Live | ⚠️ Untested | Manual testing required |
| Tempo matches Keyboardia session | ✅ Verified | Fidelity tests parse tempo meta event |
| Note pitches match (including transpose + p-locks) | ✅ Verified | 34 fidelity tests verify all pitch scenarios |
| Note timing correct (tick positions, swing) | ✅ Verified | Fidelity tests verify absolute tick positions |
| Velocities reflect volume p-locks | ✅ Verified | Fidelity tests verify MIDI velocity values |
| Swing timing is audible | ✅ Verified | Fidelity tests verify swing tick offsets |
| Drums appear on channel 10 | ✅ Verified | Fidelity tests check channel assignment |
| Synths have correct GM programs | ✅ Verified | Fidelity tests verify 0-indexed program numbers |
| Polyrhythms expand correctly | ✅ Verified | Fidelity tests verify LCM calculation |
| File size < 100KB for typical session | ✅ Expected | MIDI files are extremely compact |
| Export completes in < 100ms | ⚠️ Unmeasured | No performance benchmarks yet |
| Works on mobile Safari/Chrome | ⚠️ Untested | File download should work; no Web MIDI API needed |
| Behavioral parity (mute/solo states) | ✅ Verified | 6+ dedicated unit tests + fidelity tests |

---

## Browser Considerations

### File Download

Uses `createObjectURL()` for reliable downloads:
- Works for files of any size
- Must call `revokeObjectURL()` after download to prevent memory leaks
- Append anchor to DOM before clicking for Safari compatibility

### Mobile Support

- **File downloads work** on iOS Safari and Chrome
- **Web MIDI API not supported** on Safari (Apple blocks due to fingerprinting concerns)
- Web MIDI API is not needed for file export — only for live MIDI device access

### Memory

MIDI files are extremely compact (<100KB for complex sessions). Browser memory limits (hundreds of MB to GB) are not a concern. However, always revoke object URLs to allow garbage collection.

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
| `app/src/audio/scheduler.ts` | Canonical track filtering logic (search: `@spec: track-selection`) |
| `app/src/audio/midiExport.ts` | Reference implementation |
| `app/src/audio/midiExport.test.ts` | Behavioral parity tests |

### Dependent Features

When modifying track selection behavior (mute, solo), update:
- Audio scheduler (source of truth)
- MIDI export (this spec)
- Future: Audio export

---

## Future Enhancements

| Feature | Description | Considerations |
|---------|-------------|----------------|
| **MIDI Import** | Drag MIDI file onto Keyboardia | Quantize to 16th-note grid. Convert PPQN (480→128 divide by 3.75, 960→128 divide by 7.5). Parameter locks lost except velocity→volume. |
| **CC Export** | Filter cutoff as CC messages | CC#74 (brightness) or CC#1 (mod wheel) |
| **Clip Export** | Export individual clips | Useful for loop-based DAW workflows |
| **Direct DAW Send** | Ableton Link / MIDI over WebSocket | Requires Web MIDI API (not supported in Safari) |
| **Audio Export** | Bounce to WAV | Requires latency compensation |

### MIDI Import Considerations (Future)

When importing MIDI files into Keyboardia:

1. **Information typically lost:**
   - Instrument sound design (MIDI is notes, not audio)
   - Effects chains, mixer settings
   - Polyrhythm structure (MIDI shows results, not intent)

2. **Quantization strategy:**
   ```typescript
   function quantizeToStep(tick: number, sourcePPQN: number): number {
     const ticksPerStep = sourcePPQN / 4; // 4 steps per beat
     return Math.round(tick / ticksPerStep);
   }
   ```

3. **PPQN conversion:**
   - From 128 PPQN: 1:1 mapping (32 ticks per step)
   - From 480 PPQN: Divide by 3.75 (120 source ticks → 32 target ticks)
   - From 960 PPQN: Divide by 7.5 (240 source ticks → 32 target ticks)
   - From 96 PPQN: Multiply by 1.33 (24 source ticks → 32 target ticks)

4. **Channel mapping:**
   - Channel 10 → Drum tracks
   - Channels 1-9, 11-16 → Synth tracks

---

## Changelog

| Date | Change |
|------|--------|
| Phase 32 | Initial implementation |
| Phase 32.1 | Added Track Selection Logic section, behavioral parity tests, solo mode support |
| Phase 32.2 | Fixed spec inconsistencies: updated line references to use code markers, completed synth preset table (17 mappings), added DAW compatibility section, added note range validation requirement, marked success criteria verification status, added MIDI import considerations, improved technical explanations for PPQN choice and note-off timing |
| Phase 32.3 | Enhanced Type 0 vs Type 1 explanation with visual diagrams, added note clamping to implementation feature list, internal consistency audit |
| Phase 32.4 | Added "Adding New Instruments" extensibility section, documented fallback behavior, cross-references to preset definitions, recommended coverage test pattern |
| Phase 32.5 | **Comprehensive fidelity testing:** Added 34 tests that parse MIDI output using midi-file package. Fixed PPQN (480→128 to match midi-writer-js). Documented velocity percentage scaling and program number 0-indexing. Updated timing constants and examples. |

---

*MIDI export was implemented in Phase 32. See [ROADMAP.md](./ROADMAP.md) for timeline.*
