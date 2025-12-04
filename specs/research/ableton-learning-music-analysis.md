# Ableton Learning Music - Technical & UX Analysis

Research compiled from web sources to inform Keyboardia development.

---

## Overview

[Learning Music](https://learningmusic.ableton.com/) is Ableton's free, interactive browser-based music education platform launched in 2017. It teaches music fundamentals (beats, melodies, harmony, basslines, song structure) through hands-on sequencer interactions—no prior experience or equipment required.

**Key differentiator:** Every lesson includes a functional web-based sequencer that mimics Ableton Live's interface, allowing immediate experimentation with concepts being taught.

---

## Structure & Content

### Chapters (10 total)

| Chapter | Focus |
|---------|-------|
| Beats | Drum patterns, rhythm, tempo |
| Notes & Scales | Pitch, major/minor tonality |
| Melodies | Creating melodic phrases |
| Chords | Major/minor triads, progressions |
| Basslines | Bass patterns, analyzing classic bass parts |
| Song Structure | Intro, verse, chorus, arrangement |
| The Playground | Free-form creation space |
| Advanced Topics | Additional chapters on specific techniques |

### Pedagogical Approach

- **Progressive disclosure**: Concepts introduced incrementally
- **Immediate application**: Every concept has an interactive exercise
- **No prerequisites**: Assumes zero musical knowledge
- **Multi-language**: English, German, Spanish, French, Japanese, Dutch, Italian

---

## UI/UX Design

### Sequencer Interface

The grid interface shows the "inside" of a musical pattern:

```
     1   2   3   4   5   6   7   8   (steps/beats)
Kick [■] [ ] [ ] [ ] [■] [ ] [ ] [ ]
Snare[ ] [ ] [■] [ ] [ ] [ ] [■] [ ]
HiHat[■] [■] [■] [■] [■] [■] [■] [■]
```

**Interactions:**
- Click grid cell to toggle note on/off
- Visual playhead shows current position
- Instant audio feedback on changes
- Pre-populated examples that users can modify

### Design Language

Per [CDM](https://cdm.link/playground-learning-music-free-browser-ableton/): "Part of what makes Ableton who they are is their design language and clarity, and that's also a major part of the presentation and user experience."

**Key UX patterns:**
- Minimalist, focused interface
- One concept per screen
- Immediate visual + audio feedback
- Consistent color coding for different elements
- Smooth animations for state changes

### Visual Feedback

- Playing notes highlight/animate
- Waveform visualizations for audio concepts
- Parameter changes show immediate visual response
- Progress indicators through lessons

---

## Audio Technology

### Web Audio API Foundation

The site uses the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) for all audio operations. Per [Frontend Masters](https://frontendmasters.com/courses/web-audio/learning-synths-with-ableton/): "They reproduce the old school service analogue synths... using entirely digital Web Audio API structure."

**Uncertain:** Whether they use [Tone.js](https://tonejs.github.io/) or a custom Web Audio implementation. The interface resembles Tone.js patterns but may be proprietary.

### Clock & Scheduling (Critical for Keyboardia)

Browser audio scheduling is a solved problem with a well-documented pattern. Per [web.dev "A Tale of Two Clocks"](https://web.dev/articles/audio-scheduling):

#### The Two Clocks Problem

| Clock | Precision | Use |
|-------|-----------|-----|
| `AudioContext.currentTime` | Sample-accurate (hardware crystal) | Schedule audio events |
| `setTimeout`/`setInterval` | ~millisecond, unreliable | UI updates, periodic checks |

**Solution: Lookahead Scheduling**

```javascript
// Configuration
const lookahead = 25.0;        // Check every 25ms
const scheduleAheadTime = 0.1; // Schedule 100ms into future

function scheduler() {
  while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
    scheduleNote(currentNote, nextNoteTime);
    advanceNote();
  }
  setTimeout(scheduler, lookahead);
}
```

**Why this works:**
- JavaScript callback (`setTimeout`) runs frequently (~25ms)
- Each callback schedules audio events 100ms ahead
- Even if JS thread blocks briefly, audio continues uninterrupted
- Audio clock is authoritative; JS clock just triggers scheduling

#### Recommended Values

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Lookahead interval | 25ms | How often JS scheduler runs |
| Schedule ahead time | 100ms | How far into future to schedule |
| Overlap | ~75ms | Resilience buffer for slow machines |

#### Browser Tab Throttling

Modern browsers throttle `setTimeout` to 1Hz when tab is backgrounded. Solutions:
1. **Web Workers**: Run scheduler in worker (not throttled)
2. **Visibility API**: Schedule more events when losing focus

#### Visual Synchronization

Use `requestAnimationFrame` for visual updates, not the audio clock:

```javascript
function draw() {
  const currentTime = audioContext.currentTime;
  // Update playhead position based on currentTime
  // Highlight currently-playing notes
  requestAnimationFrame(draw);
}
```

### Sample Management

- Samples loaded as `AudioBuffer` objects
- Triggered via `AudioBufferSourceNode`
- Per-track gain nodes for mixing
- Master output gain for overall volume

---

## Technical Implementation

### Framework (Unconfirmed)

The specific frontend framework is not publicly documented. Possibilities:
- **Ember.js** (Ableton has used Ember historically)
- **React** (common for interactive UIs)
- **Custom/vanilla** (for performance)

To determine: Inspect page source for framework signatures (e.g., `data-ember-*` attributes, React DevTools detection).

### State Management

Likely patterns based on the UI behavior:
- Local component state for UI interactions
- Centralized store for sequencer state (grid, tempo, playback)
- Audio engine as separate module, receives state updates

### Export to Live Set

A standout feature: users can export their creations as Ableton Live project files.

Per [Ableton's export documentation](https://ableton.github.io/export/):

**What gets exported:**
- ALS document (Ableton Live Set file)
- Audio resources in project folder structure
- Self-contained, portable project

**Technical implementation:**
- Library generates project folder structure
- Creates ALS XML document
- Copies audio samples to project
- Zips for download

**Limitations by Live edition:**
- Live Lite: 8 tracks, 8 scenes max
- Live Intro: 16 tracks, 8 scenes max
- Standard/Suite: Unlimited

---

## Learning Synths (Companion Site)

[Learning Synths](https://learningsynths.ableton.com/) is a sister site focused on synthesis:

**Features:**
- Full synthesizer in browser
- Controls for amplitude, filter, envelope
- Visual feedback for all parameters
- Export to Live (added later)
- Record creations as audio

**Technical approach:**
- Oscillators, filters, envelopes via Web Audio API
- Real-time parameter manipulation
- Canvas-based visualizations

---

## Key Takeaways for Keyboardia

### What to Emulate

1. **Immediate feedback**: Every interaction produces instant audio + visual response
2. **Grid-based interface**: Proven, intuitive for sequencing
3. **Progressive complexity**: Start simple, add features as needed
4. **Clean design language**: Minimal UI, clear visual hierarchy
5. **Lookahead scheduling**: Essential for reliable timing

### What to Adapt

1. **Multi-player sync**: Ableton's site is single-user; Keyboardia needs distributed clock sync
2. **Real-time collaboration**: State changes must broadcast to all participants
3. **Sample upload**: Learning Music uses preset samples only
4. **Ephemeral sessions**: No export/persistence in v1

### Technical Patterns to Use

```javascript
// Audio scheduling pattern
const LOOKAHEAD = 25;           // ms
const SCHEDULE_AHEAD = 0.1;     // seconds

// For Keyboardia: add server clock offset
function getServerTime() {
  return audioContext.currentTime + serverClockOffset;
}

function scheduler() {
  const serverNow = getServerTime();
  while (nextNoteTime < serverNow + SCHEDULE_AHEAD) {
    scheduleNote(currentNote, nextNoteTime);
    advanceNote();
  }
  setTimeout(scheduler, LOOKAHEAD);
}
```

### Sync Challenge Unique to Keyboardia

Learning Music only syncs audio to its own clock. Keyboardia must:
1. Synchronize multiple clients to server clock
2. Compensate for network latency
3. Handle clock drift over time
4. Resolve conflicts for simultaneous edits

The Durable Object becomes the authoritative clock source, similar to how `AudioContext.currentTime` is authoritative locally.

---

## Sources

- [Learning Music](https://learningmusic.ableton.com/)
- [Learning Synths](https://learningsynths.ableton.com/)
- [A Tale of Two Clocks - web.dev](https://web.dev/articles/audio-scheduling)
- [Web Audio API - MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Tone.js](https://tonejs.github.io/)
- [Ableton Live Set Export](https://ableton.github.io/export/)
- [Ableton Link Documentation](https://ableton.github.io/link/)
- [Learning Synths with Ableton - Frontend Masters](https://frontendmasters.com/courses/web-audio/learning-synths-with-ableton/)
- [CDM - Learning Music Review](https://cdm.link/playground-learning-music-free-browser-ableton/)
- [NYU MusEDLab - Learning Music Analysis](https://wp.nyu.edu/musedlab/2017/05/30/learning-music-from-ableton/)
- [DJ TechTools - Learning Music Launch](https://djtechtools.com/2017/05/10/ableton-launches-learning-music-production-education-web-app/)
