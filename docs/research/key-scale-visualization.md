# Research: Key/Scale Visualization for Step Sequencers

## Context

A user with a DJ background suggested:
> "A vertical key scale that expands out to the right of the tracks could be a cool way to visualize the pitches + keys."

This document explores prior art and design patterns for implementing such a feature in Keyboardia.

---

## Table of Contents

1. [Current State in Keyboardia](#current-state-in-keyboardia)
2. [Keyboardia's Documented Influences](#keyboardias-documented-influences)
3. [Prior Art: DJ Software](#prior-art-dj-software)
4. [Prior Art: DAWs](#prior-art-daws)
5. [Prior Art: Hardware Step Sequencers](#prior-art-hardware-step-sequencers)
6. [Prior Art: Web-Based Sequencers](#prior-art-web-based-sequencers)
7. [Problems Being Solved](#problems-being-solved)
8. [Emerging Patterns](#emerging-patterns)
9. [Design Concepts for Keyboardia](#design-concepts-for-keyboardia)
10. [Recommendations](#recommendations)
11. [References](#references)

---

## Current State in Keyboardia

Keyboardia has a **ChromaticGrid** component (`components/ChromaticGrid.tsx`) that:
- Shows 13 pitch rows spanning 4 octaves (-24 to +24 semitones)
- Displays vertically on the **left side** of tracks
- Highlights root note (C) in blue
- Marks harmonic intervals (fifths, fourths, octaves)
- Expands **horizontally** as steps increase

The grid is excellent for **note placement** but lacks:
- Session-wide harmonic overview
- At-a-glance key/pitch visibility across all tracks
- Scale detection or constraint

---

## Keyboardia's Documented Influences

### Primary Inspiration: Teenage Engineering OP-Z

Keyboardia's UI philosophy is explicitly inspired by the OP-Z (documented in `/specs/UI-PHILOSOPHY.md`):

**Core Principles Adopted:**
- **Direct Manipulation Over Modes** — controls live on the targets they affect, not in hidden menus
- **Visual feedback is immediate** — swing shifts step positions in real-time
- **No confirmation dialogs**
- **Modes are always visible** — drum/chromatic toggle button
- **Progressive disclosure through gesture** — Shift+click for parameter editing
- **Controls positioned upstream** of what they affect

**Design Philosophy:** "Wordy parameters and complex menu systems are replaced with imaginative scenes and interactive imagery."

### Secondary Hardware Influences

Referenced throughout the codebase (`/app/src/shared/sync-types.ts`, `/specs/SYNTHESIS-ENGINE.md`):

| Influence | What Keyboardia Borrows |
|-----------|------------------------|
| **Elektron** (Digitakt, Digitone, Syntakt) | Parameter locks (per-step overrides), polymetric sequencing |
| **Ableton Live** | Synth design (FM/AM/Membrane), educational approach |
| **Roland AIRA** | Compact device linking philosophy |
| **Akai MPC** | Step sequencing traditions |

### Implication for Key/Scale Visualization

Keyboardia's OP-Z inspiration suggests that any scale visualization should:
1. Be **visually immediate** (no menus to access)
2. Use **playful, non-traditional UI** (not just a standard piano roll)
3. Support **progressive disclosure** (simple by default, detailed on demand)
4. Position controls **in context** (near the tracks they affect)

---

## Prior Art: DJ Software

DJ software pioneered visual harmonic mixing with **key columns** in track lists:

| Software | Key Visualization | Compatibility Indicators |
|----------|------------------|--------------------------|
| **Mixed In Key** | Camelot Wheel (8A, 8B notation), color-coded | Energy Level ratings (1-10), expandable wheel UI |
| **Rekordbox** | Green highlight on compatible tracks | "Traffic light" system, Related Tracks tab |
| **Serato DJ** | Key column with color-coding | Camelot/Open Key/Musical notation options |
| **Traktor Pro** | Key Widget in deck header, Open Key notation | Highlights compatible tracks, shows semitone offset |
| **DJ.Studio** | Key Harmony column with compatibility icons | ✓/✗ indicators, auto-bridging suggestions |

**Key insight:** DJs rely on **at-a-glance key visibility** in a vertical column alongside the track list.

### The Camelot Wheel System

The Camelot Wheel represents each musical key by a number and letter combination:
- Outer ring: Major keys (B suffix, e.g., 8B = C Major)
- Inner ring: Minor keys (A suffix, e.g., 8A = A Minor)
- Adjacent numbers (7A → 8A → 9A) are harmonically compatible
- Same number, different letter (8A ↔ 8B) creates pleasant harmonic mixes

This system lets DJs navigate keys "as easy as counting up and down" without music theory knowledge.

### Energy Levels (Mixed In Key)

Beyond key detection, Mixed In Key analyzes **Energy Levels** (1-10 scale):
- Higher rating = more high-octane music
- Can sort playlists by energy
- Cross-reference with key data for optimal set flow

**Insight:** A second dimension beyond key adds depth to harmonic visualization.

---

## Prior Art: DAWs

### Ableton Live 12: Scale Highlighting System

- **Scale Mode Chooser** in transport bar shows active scale for selected clip
- **Purple highlighting** on piano roll keys that belong to the scale
- **Fold to Scale** collapses piano roll to only show in-key notes
- **Highlight Scale** option makes in-scale key tracks visually prominent
- **Scale-aware MIDI effects** (Arpeggiator, Pitch, Random) follow the clip's scale

**Limitation:** Per-clip, not a global session overview.

### Ableton Push 2/3: Pad-Based Scale Visualization

- **64 Notes layout** with 8×8 grid
- **In-Key mode**: Only scale notes are playable; out-of-key pads are unlit
- **Chromatic mode**: All notes available, but in-scale pads are lit differently
- **Color coding**: Root notes highlighted distinctly
- **Layout options**: 4ths, 3rds, Sequential—configurable interval relationships
- **Fixed mode**: Notes stay in same position when changing keys

### Novation Launchpad: Color-Coded Scale Grid

- **Blue pads** = notes in scale
- **Purple pad** = root note
- **Blank/dim pads** = notes outside scale
- **Scale Viewer** shows piano layout with scale notes highlighted
- **Sequential layout in Scale Mode** similar to Novation Circuit

### Bitwig Studio 6: Key Signature Awareness

First DAW to add **project-wide** key awareness:

- **Key signature in transport** (alongside tempo/time signature)
- **Snap to Key [K]** for drawing notes
- **"Adapt to Key" piano roll background** with colorful scale highlighting
- **Key automation** via Arranger or Launcher clips
- **Note FX with "Use Global Key"** option follows harmonic changes

**Insight:** Treating key signature like tempo (always visible, project-wide) is the emerging standard.

### FL Studio: Ghost Notes + Scale Highlighting

- **Scale Highlighting** shows in-scale notes in piano roll background
- **Ghost Notes** display notes from OTHER instruments transparently
- **Combined workflow**: See scales across all instruments simultaneously

**Unique insight:** Ghost notes solve the multi-track visibility problem that Keyboardia faces.

---

## Prior Art: Hardware Step Sequencers

### Elektron Digitakt II / Digitone II (2024-2025)

**Scale Features:**
- **Chord Mode** (Digitone II): One-finger harmonizing with multiple scales, chord types, root notes
- **Keyboard Mode** (Digitakt II): Chromatic playback across 10 octaves
- **Pitch Parameter Locks**: Per-step pitch control with note editing
- **Euclidean Sequencer**: Mathematically-driven melody generation
- **128-Step Sequencer**: Double previous capacity

**Problem Solved:** Quick harmonic context without menu navigation. Chord Mode gives non-musicians access to sophisticated harmonies.

**Tradeoff:** Requires hardware button navigation; not visual at a glance.

### Elektron Syntakt (2022)

**Scale Features:**
- **36 different scales** (major, minor, pentatonic, modal, etc.)
- **User-defined scale, root note, range, octave layout**
- **64-step sequencer** with parameter locks per step
- **Conditional trigs**: Probability and logic-based note triggering
- **Euclidean sequencer**: Mathematically-generated melodic sequences
- **Keyboard layout options**: Single octave or "fold" with multiple octaves

**Problem Solved:** Rich melodic sequencing with scale constraints and generative options.

### Polyend Tracker / Play

**Scale Features:**
- **Scale Filtering**: "Once scale filtering is on, the entire sequence will input and output only the notes that fit the chosen scale"
- **Customizable Scales**: Tracker has editable scales; Play has preset scales
- **48 backlit silicon pads** highlight notes in the active pattern/track
- **Toggle visualization**: Display which notes/instruments are used in pattern

**Problem Solved:** Prevents accidentally playing out-of-scale notes.

**Unique terminology:** "Scale filtering ON/OFF" is clear, accessible language.

### Arturia KeyStep Pro / BeatStep Pro

**Scale Features:**
- **Custom User Scales**: Hold Shift+User1/User2 to define custom scales via LED-lit keyboard
- **Scale Quantization**: Defines which notes are available for sequencing
- **Visual LED feedback**: LEDs above each key light up to show scale membership
- **Sequence color-coding**: Each sequence is color-coded (green, orange, yellow, magenta)

**Problem Solved:** Users define custom scales per project and see membership visually via LEDs.

**Unique:** Per-key LED indicators—hardware equivalent of scale highlighting.

### Native Instruments Maschine

**Scale Features:**
- **Scale/Chord Mode**: Pads play in selected scale with adjustable root note
- **Chord Mode Options**:
  - Chordsets: Static, fixed chords (not scale-dependent)
  - Harmonizer: Scale-based chord generation
- **Keyboard Mode**: 16 pads play same sound at 16 different pitches in chosen scale
- **Visual Pad Feedback**: Pads light up to indicate playable notes

**Limitation:** Chord generation only works via pads, not MIDI input or pattern recording.

**Insight:** Separating "Chordsets" (fixed) from "Harmonizer" (scale-based) is useful UX distinction.

### Akai MPC Force / MPC 3 (2025)

**Scale Features:**
- **Pad Scale Display**: Red notes on pads indicate octaves within the scale
- **Keygroup Setup**: Root note and scale configuration in Main view
- **Chord/Progression Support**: Built-in chord and progression tools
- **8x8 clip launch matrix** with RGB backlighting

**Problem Solved:** Visual pad layout constrains users to playable scale.

### Novation Circuit Tracks / Circuit Rhythm (2023)

**Scale Features:**
- **16 selectable scales**: Major, natural minor, pentatonic, chromatic, Dorian, Mixolydian, etc.
- **Root note transposition**: Change key without re-recording
- **Grid visualization**:
  - Two-octave keyboard layout on 8-pad grid
  - **"Paler" pads indicate root notes** visually
  - Chromatic scale shows one octave with all 12 notes
- **Stay In Key**: Sequencer constrains notes to selected scale
- **Real-time scale changes**: Alter scale during playback to audition different keys

**Problem Solved:** Explore harmonic space without music theory; visual pad layout shows scale structure.

**Most elegant pattern:** "Paler pad" coloring for root notes—minimal, effective, no text required.

### Korg Volca Series

**Scale Features:**
- **Parameter Locks**: Per-step pitch, volume, pan
- **Motion Sequencing**: Real-time parameter automation (Pitch EG depth, attack, decay)
- **16-step grid**: Visual step entry with LED feedback
- **Pitch EG Control**: Shape pitch envelope per step

**Problem Solved:** Automate pitch changes across a pattern without re-recording.

**Limitation:** No visual scale highlighting; relies on tactile knob feedback.

---

## Prior Art: Web-Based Sequencers

### Ableton Learning Music (Educational Platform)

- **Interactive lessons**: Dedicated chapter on "Notes & Scales"
- **Experiential learning**: Each concept has hands-on sequencer interaction
- **Playhead visualization**: Shows current note being played during explanation

**Problem Solved:** Music education through direct manipulation and immediate audio feedback.

**Unique:** Pedagogical approach emphasizing discovery over memorization.

### Soundtrap (by Spotify)

- **Piano roll interface** with pitch and velocity editing
- **16-step grid** with 4 beats per bar
- **Drum selection UI**: Intuitive sound selection

**Limitation:** No visible scale highlighting; generic chromatic grid.

### Splice Beatmaker

- **Parameter grid**: Manipulate volume, pitch, gain, panning per sound
- **4×2 pads view** for up to 8 sounds
- **Pitch control**: Per-sound pitch adjustment via sliders

**Limitation:** No scale quantization or visual scale highlighting.

### BandLab (by ByteDance)

- **Virtual instruments**: Drum machine, guitar effects, sampler
- **MIDI recording** with virtual instruments
- **Multi-track mixing**

**Limitation:** No documented scale mode or visualization features.

**Insight:** Web-based sequencers lag behind hardware in scale visualization—opportunity for Keyboardia.

---

## Problems Being Solved

### Problem 1: Harmonic Blindness (Multi-Track)

**Challenge:** In a 4-16 track sequencer, users must mentally track which pitches are active across all tracks. No visual feedback shows whether tracks are harmonically compatible.

**How Hardware Addresses It:**
| Product | Solution |
|---------|----------|
| Elektron Chord Mode | Harmonic choices are explicit |
| Arturia Custom Scales | Per-project scale definition |
| Novation Circuit | Real-time scale changes for auditioning |
| Akai MPC | Pad layout visualizes available scale notes |

**Tradeoff:** Visual at-a-glance awareness vs. compact interface.

### Problem 2: Context Switching

**Challenge:** Users must:
1. Click a track to view its chromatic grid
2. Look at the grid to understand available pitches
3. Switch to another track to see its pitches

**How Hardware Addresses It:**
| Product | Solution |
|---------|----------|
| Elektron Keyboard Mode | One button press activates scale for all notes |
| Novation Grid Layout | Two-octave keyboard visible on 8 pads; no expansion needed |
| Arturia LEDs | Visual feedback shows scale membership without navigation |

**Tradeoff:** Hardware constraints enable simplicity; web has more screen real estate but more options.

### Problem 3: Music Theory Barrier

**Challenge:** Most users don't understand keys, scales, or harmonic compatibility.

**How Industry Addresses It:**
| Product | Solution |
|---------|----------|
| DJ Software Camelot Wheel | Abstract notation (8A, 8B) instead of theory |
| Novation Paler Pads | Visual design doesn't require naming |
| Maschine Harmonizer | Scale-based chord generation |
| Ableton Learning Music | Experiential learning without prerequisites |

**Tradeoff:** Accessibility vs. musical control granularity.

### Problem 4: Collaborative Confusion (Multiplayer)

**Challenge:** In Keyboardia's 10-player sessions, users on different tracks might use clashing pitches unknowingly.

**Unique to Keyboardia:** No hardware sequencer addresses this because they're single-player devices.

**Potential Solutions:**
- Session-wide scale visualization showing all active pitches across all tracks
- Visual harmony indicators (compatible/incompatible tracks)
- Shared scale choice that constrains all users
- "Ghost notes" showing other players' pitches while editing

---

## Emerging Patterns

### Pattern 1: LED/Color as Primary Visual Language

Hardware prioritizes visual feedback over screens:

| Product | Visual Pattern |
|---------|---------------|
| Novation | Paler pads for root notes |
| Arturia | LEDs above keys show scale membership |
| Maschine | Pad lighting indicates playable notes |
| Circuit | Two-octave keyboard on 8-pad grid |

**Web Application:** Use color and opacity rather than text. Lighter colors = root notes, darker = other scale degrees.

### Pattern 2: Grid-Based Scale Visualization

All hardware uses **grid layouts that map to musical structure**:
- Push/Launchpad: 8×8 pads with in-key/out-of-key coloring
- Circuit: Two-octave keyboard mapped to 8 pads
- Maschine: 16-pad grid with scale constraints
- Syntakt: Keyboard mode folds multiple octaves into pad grid

**Web Application:** Instead of a linear chromatic grid, visualize scales as structured grids.

### Pattern 3: Per-Step Parameter Locks Over Per-Pattern Constraints

**Industry Standard:** Elektron, Korg, Arturia emphasize **per-step pitch control** rather than limiting users to a scale:
- Allows stepping outside scale when desired
- Maximum creative freedom
- Requires more careful editing

**Web Application:** Don't force scales; make them optional. Offer scale snapping as a "helper" not a constraint.

### Pattern 4: Real-Time Scale Switching

**Seen In:** Novation Circuit, Elektron Digitone, Bitwig

**Pattern:** Change scale during playback to:
- Explore different harmonic contexts
- Create key modulations
- Audition different moods

**Web Application:** Scale change should be real-time and audible, not require stopping playback.

### Pattern 5: Camelot as Music Theory Abstraction

**DJ Standard:** Mixed In Key, Serato, Rekordbox use Camelot (8A, 8B) instead of theory names.

**Why It Works:**
- Adjacent numbers are harmonically compatible
- No music theory knowledge required
- Visual system is faster than learning 12 major keys

**Web Application:** Consider a "harmonic distance" visualization instead of requiring scale names.

### Pattern 6: Ghost Notes for Cross-Track Visibility

**FL Studio Pattern:** Show notes from OTHER instruments as transparent overlays.

**Problem Solved:** See chords/melodies from other tracks while sequencing.

**Web Application:** In multiplayer, show other players' notes as ghosted visuals while editing.

---

## Innovative Approaches That Stand Out

### 1. Novation's "Paler Pad" Root Note Visualization

Most elegant scale visualization:
- Root notes are visually distinct (paler/lighter color)
- Doesn't require text labels
- Immediately visible without interaction
- Works on hardware and web

**Adoption:** Use alpha transparency or lighter hue for root notes in any scale grid.

### 2. Bitwig's Key Signature in Transport Bar

First DAW with project-wide key awareness:
- Key signature displayed like tempo (always visible)
- Snap to Key option for MIDI drawing
- Key automation via Arranger
- Represents shift toward harmonic-first thinking

**Adoption:** Add "Session Key" selector in transport, apply scale constraints globally.

### 3. Polyend's "Scale Filtering" Language

Clear terminology:
- "Scale filtering ON" = only scale notes playable
- "Scale filtering OFF" = chromatic

**Adoption:** Toggle labeled "Snap to Scale" or "Scale Mode: ON/OFF" per track.

### 4. FL Studio's Scale Highlighting Background

Simple, effective:
- In-scale keys highlighted in piano roll background
- Out-of-scale keys shown as plain white

**Adoption:** Color in-scale notes on chromatic grid (purple/blue background).

---

## What's NOT Being Done (Opportunities)

| Gap | Opportunity for Keyboardia |
|-----|---------------------------|
| **Cross-Track Harmonic Visualization** | Highlight compatible tracks when selecting a track's scale |
| **Collaborative Scale Selection** | Vote on session scale, constrain collaborative tracks |
| **Scale Presets by Genre** | "Jazz Scales," "Lo-Fi Scales," "EDM Scales" quick-select |
| **Harmonic History** | Undo history shows previous keys; easy harmonic reversion |
| **MIDI Input Quantization** | Quantize external keyboard input to session scale |

---

## Design Concepts for Keyboardia

### Concept A: Key Sidebar Panel (DJ-style)

A persistent panel to the right of tracks showing pitch usage:

```
┌─────────────────────────────────────┬──────────────┐
│ Track 1: Kick   [●●●●●●●●]          │   ┌─────┐    │
│ Track 2: Bass   [●●●○●●○●]          │   │ C   │ ██ │
│ Track 3: Lead   [●○●○●○●○]          │   │ D   │    │
│ Track 4: Pad    [●○○○●○○○]          │   │ E   │ █  │
│                                      │   │ F   │ ███│
│                                      │   │ G   │ █  │
│                                      │   │ A   │    │
│                                      │   │ B   │    │
│                                      │   └─────┘    │
└─────────────────────────────────────┴──────────────┘
                                       ↑ Pitch histogram
```

**Pros:** Always visible, DJ-familiar pattern
**Cons:** Takes horizontal space, may feel disconnected from tracks

### Concept B: Per-Track Key Indicator (Rekordbox-style)

Compact key display per track with compatibility indicators:

```
┌──────────────────────────────────────────┬─────┐
│ Track 1: Kick   [●●●●●●●●]               │     │
│ Track 2: Bass   [●●●○●●○●]  ← C E G      │ Cm  │
│ Track 3: Lead   [●○●○●○●○]  ← C D E F G  │ Cm  │
│ Track 4: Pad    [●○○○●○○○]  ← G B D      │ G   │
└──────────────────────────────────────────┴─────┘
```

**Pros:** Compact, per-track context
**Cons:** Requires scale detection algorithm

### Concept C: Expandable Vertical Piano (Push/Launchpad-style)

Collapsible per-track pitch visualization that expands **to the right**:

```
┌─────────────────────────────────┐ ← Collapsed
│ Track 2: Bass   [●●●○●●○●] [▼]  │
└─────────────────────────────────┘

┌─────────────────────────────────┬──────────────────────┐
│ Track 2: Bass   [●●●○●●○●] [▲]  │  C ████████████████  │ ← Expanded
│                                  │  D      (paler)      │
│                                  │  E ██████            │
│                                  │  F                   │
│                                  │  G ████   (paler)    │
└─────────────────────────────────┴──────────────────────┘
```

**Pros:** On-demand detail, matches DJ's original suggestion
**Cons:** Still requires expansion to see

### Concept D: Session-Wide Scale Overlay

A floating or docked panel showing all active pitches across the session:

```
┌─────────────────────────────────────────────────────┐
│  Session Key: C minor (detected)      [Change ▼]   │
│  ┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐  │
│  │ C │   │ D │D# │   │ F │   │ G │G# │   │A# │   │  │
│  │███│   │ █ │███│   │██ │   │███│ █ │   │ █ │   │  │
│  └───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘  │
│  Track colors: ■ Bass  ■ Lead  ■ Pad                │
└─────────────────────────────────────────────────────┘
```

**Pros:** Complete harmonic picture, scale detection
**Cons:** Additional UI element, may overwhelm

### Concept E: Transport Bar Key Selector (Bitwig-style)

Minimal but always-visible:

```
┌─────────────────────────────────────────────────────────────┐
│  ▶ Play   [BPM: 120]   [Swing: 30%]   [Key: C minor ▼]     │
└─────────────────────────────────────────────────────────────┘
```

**Pros:** No additional space, always visible, matches DAW conventions
**Cons:** Doesn't show per-track detail

### Concept F: Multiplayer Ghost Notes

Show other players' active pitches as transparent overlays while editing:

```
┌─────────────────────────────────────────────────────────────┐
│ Track 2: Bass (You)    [●●●○●●○●]                           │
│   ChromaticGrid:                                            │
│     C  [●][○][●][○][ ][ ][ ][ ]  ← Your notes (solid)       │
│     E  [○][●][○][ ][ ][ ][ ][ ]  ← Ghost: Player 2 (faded)  │
│     G  [●][○][ ][ ][ ][ ][ ][ ]  ← Ghost: Player 3 (faded)  │
└─────────────────────────────────────────────────────────────┘
```

**Pros:** Collaborative harmonic awareness, prevents clashes
**Cons:** Visual complexity, may need toggle

---

## Recommendations

### Phase 1: Foundation (MVP)

1. **Add "Session Key" selector to transport bar** (Bitwig-style)
   - Dropdown with common scales (Major, Minor, Pentatonic, etc.)
   - Always visible alongside BPM and Swing

2. **Apply optional scale highlighting to ChromaticGrid** (FL Studio-style)
   - In-scale rows get subtle background color
   - Root note rows get "paler" treatment (Novation-style)

3. **Per-track scale badge** showing detected/assigned root note (Rekordbox-style)
   - Small badge in track header
   - Click to override

### Phase 2: Visual Polish

1. **Pitch histogram sidebar** (Concept A)
   - Collapsible panel to right of tracks
   - Shows all active pitches across session
   - Color-coded by track

2. **Root note visual emphasis** using Novation's "paler" pattern
   - Apply to ChromaticGrid cells
   - Apply to pitch histogram

3. **Compatibility indicators** showing which tracks harmonize
   - Green/yellow/red badges based on harmonic distance

### Phase 3: Multiplayer-Specific

1. **Collaborative scale voting** (if multiple users, majority rules or host decides)
2. **Ghost notes from other players** while editing (FL Studio-inspired)
3. **"Scale conflict" warnings** when tracks use clashing pitches
4. **Visual pulse** when another player changes pitch in real-time

### Phase 4: Advanced

1. **Genre-based scale presets** ("Jazz," "Lo-Fi," "EDM," etc.)
2. **Harmonic undo history** (revert to previous session key)
3. **MIDI input quantization** to session scale
4. **Camelot-style notation option** for DJ-familiar users
5. **Real-time scale switching** during playback

---

## Key Takeaways

1. **DJ software** pioneered column-based key visibility for quick scanning
2. **Ableton/Push/Novation** use color-coded scale highlighting (purple/blue for in-key, paler for root)
3. **Bitwig** established project-wide key signature as a first-class transport element
4. **FL Studio's ghost notes** solve cross-track pitch visibility
5. **Novation's "paler pad"** pattern is the most elegant root note indicator
6. **Polyend's "Scale Filtering"** terminology is clear and accessible
7. **Hardware sequencers** prioritize per-step freedom over scale constraints
8. **No product addresses multiplayer harmonic collaboration**—Keyboardia's unique opportunity

The DJ's suggestion—"a vertical key scale that expands out to the right of the tracks"—aligns with industry trends toward **persistent, at-a-glance harmonic awareness** and matches Keyboardia's OP-Z-inspired philosophy of **direct manipulation and visual immediacy**.

---

## References

### DJ Software
- [Mixed In Key - Camelot Wheel](https://mixedinkey.com/camelot-wheel/)
- [Mixed In Key - Harmonic Mixing Guide](https://mixedinkey.com/harmonic-mixing-guide/)
- [Rekordbox Key Compatibility](https://www.digitaldjtips.com/dj-software-tips-tricks-how-to-see-key-compatible-tracks-in-rekordbox-5-4/)
- [Serato DJ Track Display](https://support.serato.com/hc/en-us/articles/224968947-Track-Display)
- [Traktor Harmonic Mixing](https://support.native-instruments.com/hc/en-us/articles/115001296849-Key-Detection-and-Harmonic-Mixing-in-TRAKTOR-VIDEO)
- [DJ.Studio Playlist View](https://help.dj.studio/en/articles/8213328-playlist-view)

### DAWs
- [Ableton Live 12 Keys and Scales FAQ](https://help.ableton.com/hc/en-us/articles/11425083250972-Keys-and-Scales-in-Live-12-FAQ)
- [Ableton Push 3 Manual](https://www.ableton.com/en/push/manual/)
- [Ableton Push 2 Manual](https://www.ableton.com/en/manual/using-push-2/)
- [Novation Launchpad X Note Mode](https://support.novationmusic.com/hc/en-gb/articles/360010307540-Note-Mode-Settings-on-the-Launchpad-X)
- [Bitwig Studio 6 Overview](https://www.musicradar.com/music-tech/bitwig-takes-its-flagship-daw-to-another-level-with-studio-6-bringing-improved-automation-scale-awareness-and-a-host-of-workflow-enhancements)
- [FL Studio Piano Roll](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/pianoroll.htm)

### Hardware Sequencers
- [Elektron Digitone II](https://www.elektron.se/explore/digitone-ii)
- [Elektron Syntakt Manual](https://www.elektron.se/support/?connection=syntakt)
- [Polyend Tracker Manual](https://polyend.com/manuals/tracker/)
- [Arturia KeyStep Pro Scales](https://support.arturia.com/hc/en-us/articles/4405741083922-KeyStep-Pro-Scales)
- [Native Instruments Maschine Chord/Scale](https://www.native-instruments.com/en/maschine-mikro-quickstart/working-with-chords/)
- [Akai MPC Force User Guide](http://akai-pro.jp/force/data/Force-UserGuide-v1.0c.pdf)
- [Novation Circuit Tracks Scale Grid](https://userguides.novationmusic.com/hc/en-gb/articles/25494393500562-Using-Circuit-Rhythm-sample-tracks)
- [Korg Volca Sample](https://www.korg.com/us/products/dj/volca_sample/)

### Teenage Engineering
- [OP-Z Product & Guides](https://teenage.engineering/products/op-z)
- [OP-1 Field Guide](https://teenage.engineering/guides/op-1)

### Web Sequencers & Education
- [Ableton Learning Music](https://learningmusic.ableton.com/)
- [Soundtrap](https://www.soundtrap.com/)
- [Splice Beatmaker](https://splice.com/sounds/beatmaker)

### Keyboardia Internal
- `/specs/UI-PHILOSOPHY.md` — OP-Z inspiration details
- `/specs/SYNTHESIS-ENGINE.md` — Audio architecture and influences
- `/app/src/shared/sync-types.ts` — Influence citations
