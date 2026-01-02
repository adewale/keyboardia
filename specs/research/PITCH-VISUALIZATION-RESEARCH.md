# Research: Pitch Visualization & Musical Context

## Origin

This research emerged from programmatically extending a session to 128 steps, which revealed that the current pitch system is **mathematically correct but musically opaque**:

- Pitch values like "+7 semitones" require mental translation to "a fifth above"
- Track transpose values obscure the effective key
- No visual indication when notes exceed instrument range
- No way to see harmonic relationships between tracks

> **The Core Insight**: The data model captures *what* (steps, pitches) but not *why* (melody, harmony, chord progression). Users need musical meaning, not just numbers.

---

## Improvement Options (Filtered Through UI Philosophy)

Each option is evaluated against Keyboardia's core principles:
1. **Controls live where they act** — No separate panels for things that affect the grid
2. **Visual feedback is immediate** — See the effect without clicking anything
3. **Modes are visible, not hidden** — State is always shown
4. **Progressive disclosure through gesture** — Click vs. Shift+click
5. **One screen, no navigation** — Everything visible at once

---

## Option 1: Note Name Tooltips

**What**: Hover over a step with a pitch lock to see "G4 (5th of C minor)"

**User Benefit**: Quick pitch identification without expanding chromatic view or doing mental math.

**UI Philosophy Alignment**:
| Principle | Score | Notes |
|-----------|-------|-------|
| Controls on target | ✅ | Tooltip appears on the step itself |
| Immediate feedback | ✅ | Hover = instant info |
| Modes visible | ✅ | No mode switching required |
| Progressive disclosure | ✅ | Basic view → hover for detail |
| One screen | ✅ | No navigation |

**Implementation**:
- Extend existing step tooltip infrastructure
- Calculate: `baseMIDI + transpose + pitch` → note name
- If scale locked: show scale degree ("5th of C minor")
- If not locked: show just note name ("G4")

**Complexity**: Low — Tooltip already exists, just add content

---

## Option 2: Per-Track Key Display

**What**: Badge on track header showing effective key: `[C]`, `[G]`, `[F]`

**User Benefit**: Instantly see track relationships — "Bass is in C, lead is in G"

**UI Philosophy Alignment**:
| Principle | Score | Notes |
|-----------|-------|-------|
| Controls on target | ✅ | Badge is on the track it describes |
| Immediate feedback | ✅ | Always visible |
| Modes visible | ✅ | Key is always shown |
| Progressive disclosure | ⚪ | N/A — always visible |
| One screen | ✅ | Part of track row |

**Design Mockup**:
```
┌────────────────────────────────────────────────────────┐
│ Session: C minor pentatonic                            │
├────────────────────────────────────────────────────────┤
│ [C] Bass      M S ●●○○●●○○│●●○○●●○○                    │  ← Transpose: 0
│ [G] Lead      M S ○●○●○●○●│○●○●○●○●                    │  ← Transpose: +7
│ [F] Pad       M S ●○○○○○○○│●○○○○○○○                    │  ← Transpose: +5
└────────────────────────────────────────────────────────┘
```

**Implementation**:
- Calculate: `scaleRoot + transpose mod 12` → note name
- Display as small badge in TrackRow header
- Color matches scale sidebar accent

**Complexity**: Low — Simple calculation, minimal UI change

---

## Option 3: Active Usage Indicators in Scale Sidebar

**What**: Transform ScaleSidebar from passive reference to active dashboard showing which scale degrees are used.

**User Benefit**:
- Instantly see harmonic coverage: "Using root and fifth but no 3rd"
- Validate programmatically-generated sessions use the scale correctly
- Answer "what pitches am I using?" visually

**UI Philosophy Alignment**:
| Principle | Score | Notes |
|-----------|-------|-------|
| Controls on target | ⚪ | Sidebar is separate, but shows aggregated track data |
| Immediate feedback | ✅ | Updates in real-time |
| Modes visible | ✅ | Always shows what's active |
| Progressive disclosure | ⚪ | N/A — always visible |
| One screen | ✅ | Sidebar already exists |

**Design Mockup**:
```
┌───────────────┐
│ C min pent    │
├───────────────┤
│ C   ●●● (3)   │  ← 3 tracks use C
│ D#  ○   (0)   │  ← Not used
│ F   ●   (1)   │
│ G   ●●  (2)   │
│ A#  ○   (0)   │  ← Gap identified
└───────────────┘
```

**Implementation**:
- Scan all tracks for active pitches
- Normalize to scale degrees
- Count tracks using each degree
- Update on step changes

**Complexity**: Medium — Requires aggregating pitch data across all tracks

---

## Option 4: Range Warnings

**What**: Red highlight/badge on steps where pitch exceeds instrument range.

**User Benefit**: Prevent silent failures where notes are technically set but don't play or sound bad.

**UI Philosophy Alignment**:
| Principle | Score | Notes |
|-----------|-------|-------|
| Controls on target | ✅ | Warning appears on the problematic step |
| Immediate feedback | ✅ | See issues instantly |
| Modes visible | ✅ | Problem state always shown |
| Progressive disclosure | ⚪ | N/A — always visible |
| One screen | ✅ | Part of existing step display |

**Design Mockup**:
```
Step with out-of-range pitch:
┌─────┐
│ ●⚠  │  ← Red warning badge
└─────┘

Tooltip: "Note too high for Alto Sax (max: E6)"
```

**Implementation**:
- Add instrument range metadata: `{ minMIDI: number, maxMIDI: number }`
- Calculate effective MIDI: `baseMIDI + transpose + pitch`
- If outside range: add warning class + tooltip

**Complexity**: Medium — Requires instrument metadata (new data), plus UI indicators

---

## Option 5: Full Piano Roll View

**What**: Industry-standard chromatic view with actual note names (C4, D4, E4) instead of semitone offsets.

**User Benefit**: Familiar DAW interface that musicians already understand from Ableton, FL Studio, Logic.

**UI Philosophy Alignment**:
| Principle | Score | Notes |
|-----------|-------|-------|
| Controls on target | ✅ | Notes placed on piano roll rows |
| Immediate feedback | ✅ | See notes visually |
| Modes visible | ⚠️ | Requires expanding chromatic grid |
| Progressive disclosure | ✅ | Grid → expand to piano roll |
| One screen | ⚠️ | May require scrolling with many rows |

**Design Mockup**:
```
┌──┬────────────────────────────────────┐
│█ │ C5  ○○○○○○○○│○○○○○○○○              │
│ █│ B4  ○○○○○○○○│○○○○○○○○              │
│█ │ A#4 ○○○○○○○○│○○○○○○○○              │
│ █│ A4  ○○○○○○○○│○○○○○○○○              │
│█ │ G#4 ○○○○○○○○│○○○○○○○○              │
│ █│ G4  ○●○○○●○○│○●○○○●○○  ← Fifth     │
│█ │ F#4 ○○○○○○○○│○○○○○○○○              │
│ █│ F4  ○○○○○○○○│○○○○○○○○              │
│█ │ E4  ○○○○○○○○│○○○○○○○○              │
│ █│ D#4 ○○●○○○●○│○○●○○○●○              │
│█ │ D4  ○○○○○○○○│○○○○○○○○              │
│ █│ C4  ●○○○●○○○│●○○○●○○○  ← Root      │
└──┴────────────────────────────────────┘
  ↑
 Mini piano keyboard
```

**Implementation**:
- New ChromaticGrid layout mode (or new component)
- MIDI number to note name conversion
- Mini piano keyboard on left edge
- Virtual scrolling for performance (48+ rows)

**Complexity**: High — Significant UI work, performance considerations

---

## Option 6: Multi-Track Pitch Overview

**What**: Condensed panel showing all tracks' melodic content stacked, like DAW piano roll layers.

**User Benefit**: See arrangement structure at a glance — which tracks play in same register, parallel vs. contrary motion.

**UI Philosophy Alignment**:
| Principle | Score | Notes |
|-----------|-------|-------|
| Controls on target | ⚠️ | Overview is separate from editing |
| Immediate feedback | ✅ | Updates in real-time |
| Modes visible | ✅ | Shows all tracks simultaneously |
| Progressive disclosure | ✅ | Collapsed by default, expand to view |
| One screen | ⚠️ | Requires panel space |

**Design Mockup**:
```
┌──────────────────────────────────────────────────┐
│ Pitch Overview                                   │
├──────────────────────────────────────────────────┤
│ High ─────────────────────────────────────────── │
│      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│      ░░░░░░░░████░░░░░░░░████░░░░░░░░████░░░░░░ │ ← Lead (blue)
│      ░░░████░░░░░░░████░░░░░░░████░░░░░░░████░░ │ ← Keys (cyan)
│      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│ Mid  ─────────────────────────────────────────── │
│      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│      ████░░░░████░░░░████░░░░████░░░░████░░░░██ │ ← Bass (purple)
│ Low  ─────────────────────────────────────────── │
└──────────────────────────────────────────────────┘
```

**Implementation**:
- New component aggregating pitch data
- Color-coded lines per track
- Compact Y-axis (pitch zones)
- Performance optimization needed

**Complexity**: High — New visualization component, aggregation logic

---

## Option 7: Chord Detection

**What**: Analyze simultaneous steps across tracks, display detected chords above the grid.

**User Benefit**: See harmonic progression at a glance — transforms raw pitch data into musical meaning.

**UI Philosophy Alignment**:
| Principle | Score | Notes |
|-----------|-------|-------|
| Controls on target | ⚠️ | Display is above, not on the steps |
| Immediate feedback | ✅ | Updates as steps change |
| Modes visible | ✅ | Chords always shown when active |
| Progressive disclosure | ✅ | Optional feature to enable |
| One screen | ✅ | Fits in existing header area |

**Design Mockup**:
```
Step:     1    5    9    13
Chord:   Cm   Fm   Gm   Cm
         ▼    ▼    ▼    ▼
┌────────────────────────────────────────┐
│ Bass   ●○○○│●○○○│●○○○│●○○○             │
│ Keys   ●○○○│●○○○│●○○○│●○○○             │
│ Lead   ●○○○│●○○○│●○○○│●○○○             │
└────────────────────────────────────────┘
```

**Implementation**:
- Chord detection algorithm (compare pitches to templates)
- Multi-track pitch analysis at each step position
- Display above timeline
- Handle ambiguous voicings

**Complexity**: High — Algorithmic complexity, UI integration

---

## Recommended Priority

### Phase 1: Quick Wins (Low complexity, high value)
1. **Note Name Tooltips** — Immediate context on hover
2. **Per-Track Key Display** — Simple badge, high clarity

### Phase 2: Core Improvements
3. **Range Warnings** — Critical for programmatic editing
4. **Active Usage Indicators** — Makes sidebar genuinely useful

### Phase 3: Advanced Features
5. **Full Piano Roll** — Major UX upgrade
6. **Multi-Track Overview** — Powerful compositional tool
7. **Chord Detection** — Impressive but complex

---

## Key Principle

> **Make the invisible visible, but don't add clutter.**

These improvements should feel like natural extensions of the existing UI — information that "was always there" but now you can see it. They should pass the OP-Z test:

1. Can I see the effect immediately? ✅
2. Is the info on or near the thing it affects? ✅
3. Does it require mode switching or navigation? ❌
4. Can I discover it by experimenting? ✅

---

## Related Specs

- [UI-PHILOSOPHY.md](../UI-PHILOSOPHY.md) — Core design principles
- [DESIGN-LANGUAGE.md](../DESIGN-LANGUAGE.md) — Color and visual language
- [key-assistant.md](../../docs/research/key-assistant.md) — Scale Lock research
- [PHASE-31-UI-ENHANCEMENTS.md](../PHASE-31-UI-ENHANCEMENTS.md) — UI enhancement roadmap
