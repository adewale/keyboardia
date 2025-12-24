# MIDI Export Instrument Mappings

This document describes how Keyboardia instruments map to General MIDI (GM) when exporting to MIDI files.

## Overview

MIDI files use the **General MIDI (GM)** standard, which defines:
- **128 instrument programs** (1-128) for melodic instruments
- **47 percussion sounds** mapped to specific note numbers on **Channel 10**

When you export from Keyboardia, we map our sounds to the closest GM equivalents. DAWs like GarageBand, Logic, Ableton, and FL Studio will play these using their built-in GM sound libraries.

---

## Drum Mappings (Channel 10)

All Keyboardia drum samples are placed on MIDI Channel 10 (the GM drum channel) and mapped to standard GM drum notes:

| Keyboardia Sample | MIDI Note | Note Name | GM Drum Sound |
|-------------------|-----------|-----------|---------------|
| `kick` | 36 | C2 | Bass Drum 1 |
| `snare` | 38 | D2 | Acoustic Snare |
| `hihat` | 42 | F#2 | Closed Hi-Hat |
| `openhat` | 46 | A#2 | Open Hi-Hat |
| `clap` | 39 | D#2 | Hand Clap |
| `tom` | 45 | A2 | Low Tom |
| `rim` | 37 | C#2 | Side Stick / Rimshot |
| `cowbell` | 56 | G#3 | Cowbell |
| `shaker` | 70 | A#4 | Maracas |
| `conga` | 63 | D#4 | Open High Conga |
| `tambourine` | 54 | F#3 | Tambourine |
| `clave` | 75 | D#5 | Claves |
| `cabasa` | 69 | A4 | Cabasa |
| `woodblock` | 76 | E5 | Hi Wood Block |

### Custom Recordings (mic:*)

Custom microphone recordings have no GM equivalent. They are exported as **MIDI note 60 (Middle C)** on Channel 10 as a placeholder. After importing into your DAW, you should:
1. Replace the track with your original audio recording, or
2. Assign a suitable drum sound manually

---

## Synth Mappings (Channels 1-9, 11-16)

Keyboardia synths are mapped to GM program numbers. Each synth track gets its own MIDI channel (skipping Channel 10, which is reserved for drums).

| Keyboardia Synth | GM Program | GM Instrument Name | Sound Category |
|------------------|------------|-------------------|----------------|
| `synth:piano` | 1 | Acoustic Grand Piano | Piano |
| `synth:rhodes` | 5 | Electric Piano 1 | Electric Piano |
| `synth:fm-epiano` | 5 | Electric Piano 1 | Electric Piano |
| `synth:organ` | 17 | Drawbar Organ | Organ |
| `synth:bass` | 33 | Electric Bass (finger) | Bass |
| `synth:funkbass` | 37 | Slap Bass 1 | Bass |
| `synth:subbass` | 39 | Synth Bass 2 | Synth Bass |
| `synth:pluck` | 46 | Orchestral Harp | Plucked |
| `synth:pluck-synth` | 46 | Orchestral Harp | Plucked |
| `tone:membrane` | 47 | Timpani | Percussion |
| `synth:strings` | 49 | String Ensemble 1 | Strings |
| `synth:brass` | 62 | Brass Section | Brass |
| `synth:lead` | 81 | Lead 1 (square) | Synth Lead |
| `synth:am-synth` | 81 | Lead 1 (square) | Synth Lead |
| `synth:acid` | 87 | Lead 7 (fifths) | Synth Lead |
| `synth:pad` | 89 | Pad 1 (new age) | Synth Pad |
| `synth:chord` | 89 | Pad 1 (new age) | Synth Pad |
| `tone:metal` | 14 | Tubular Bells | Chromatic Percussion |

### Unmapped Synths

Synth presets not listed above fall back to **GM Program 1 (Acoustic Grand Piano)**. This includes:
- Advanced synth presets (`advanced:*`)
- Tone.js synths without explicit mappings
- Sampled instruments (`sampled:*`)

---

## Pattern Length and Looping

**MIDI files do not loop automatically.** Standard MIDI Files have no loop metadata - they play from start to end and stop. Looping is controlled by your DAW, not the file.

### What Gets Exported

Keyboardia exports **exactly one pattern cycle**:

| Your Pattern | Exported Length | At 120 BPM |
|--------------|-----------------|------------|
| 16 steps (default) | 1 bar (4 beats) | 2 seconds |
| 32 steps | 2 bars (8 beats) | 4 seconds |
| Mixed (e.g., 12 + 16) | LCM = 48 steps = 3 bars | 6 seconds |

This is the ideal format because:
- DAWs can easily loop a single pattern
- No redundant data in the file
- Clean edit points at pattern boundaries

### How to Loop in Your DAW

| DAW | How to Loop |
|-----|-------------|
| **GarageBand** | Drag the right edge of the region to extend, or Option-drag to duplicate |
| **Logic Pro** | Select region → Press **L** to loop, or drag the loop handle in the top-right |
| **Ableton Live** | Drag the clip's right edge to extend, or **Cmd+D** to duplicate |
| **FL Studio** | Drag the pattern in the Playlist, or right-click → Paint mode |

---

## What Gets Preserved

| Feature | Preserved in MIDI? | Notes |
|---------|-------------------|-------|
| Note timing | Yes | Exact step positions exported |
| Swing | Yes | Applied to off-beat notes (steps 1, 3, 5, 7...) |
| Tempo | Yes | Stored as MIDI tempo meta event |
| Note pitch | Yes | Base note + transpose + p-lock pitch offset |
| Velocity/Volume | Yes | Volume p-locks become MIDI velocity |
| Track structure | Yes | Each Keyboardia track = one MIDI track |
| Mute/Solo | Yes | Muted tracks excluded; solo filters to soloed tracks only |
| Polyrhythms | Yes | Different step counts expanded to LCM |

## What Is NOT Preserved

| Feature | Why Not? |
|---------|----------|
| Exact sound/timbre | GM sounds are approximations of Keyboardia synths |
| Effects (reverb, delay, etc.) | MIDI doesn't support audio effects |
| Filter settings | No GM equivalent for filter cutoff/resonance |
| LFO modulation | No standard MIDI representation |
| Envelope shapes | GM instruments have fixed envelopes |
| Custom mic recordings | No audio in MIDI; placeholder note only |

---

## Channel Assignment

- **Channel 10**: All drum tracks (kick, snare, hihat, etc.)
- **Channels 1-9, 11-16**: Synth tracks (assigned sequentially, skipping 10)

If you have more than 15 synth tracks, channels wrap around (though Keyboardia typically limits to 16 tracks total).

---

## DAW Import Tips

### GarageBand / Logic Pro
1. File > Import > MIDI File
2. Each track appears as a Software Instrument track
3. Drums auto-map to the Drum Kit instrument
4. Replace synth sounds with your preferred plugins

### Ableton Live
1. Drag the .mid file into a MIDI track or arrangement
2. Each track becomes a separate MIDI clip
3. Assign instruments to each track

### FL Studio
1. File > Import > MIDI File
2. Choose "Start new project" or import into current
3. Assign instruments via Channel Rack

### Pro Tips
- **Replace sounds**: Use the MIDI as a starting point, then load better VST instruments
- **Velocity editing**: Volume dynamics are preserved as velocity; tweak in piano roll if needed
- **Tempo sync**: The exported tempo matches your Keyboardia session exactly

---

## Technical Reference

For implementation details, see:
- Source: [`app/src/audio/midiExport.ts`](../app/src/audio/midiExport.ts)
- Spec: [`specs/MIDI-EXPORT.md`](../specs/MIDI-EXPORT.md)
- Tests: [`app/src/audio/midiExport.test.ts`](../app/src/audio/midiExport.test.ts)
