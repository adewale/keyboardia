# Clipboard and Pattern Reuse

> Research specification for enabling personal pattern reuse in Keyboardia through clipboard operations, text notation, and selection-based workflows.

**Status:** Research / Proposal
**Date:** January 2026
**Related:** [`SESSION-NOTATION.md`](../SESSION-NOTATION.md), [`EMERGENCE.md`](./EMERGENCE.md), [`KEYBOARD-SHORTCUTS.md`](../KEYBOARD-SHORTCUTS.md)

---

## Executive Summary

Users create musical ideas they want to reuse. Currently, Keyboardia supports whole-track copying within a session, but lacks:
- Keyboard shortcuts for copy/paste
- Sub-track selection copying
- Cross-session pattern reuse
- Text notation round-trip (copy as text, paste text to create pattern)

This spec explores workflows for helping users **reuse bits of their own work**, from duplicating tracks to building personal pattern libraries.

---

## Table of Contents

1. [Core Workflows](#core-workflows)
2. [Text Notation Round-Trip](#text-notation-round-trip)
3. [Implementation Layers](#implementation-layers)
4. [Keyboard Shortcuts](#keyboard-shortcuts)
5. [Selection Model](#selection-model)
6. [Paste Targeting](#paste-targeting)
7. [Cross-Session Reuse](#cross-session-reuse)
8. [Future Explorations](#future-explorations)
9. [Non-Goals](#non-goals)
10. [Open Questions](#open-questions)

---

## Core Workflows

### Workflow 1: Duplicate Track Pattern

> "I want to copy the kick pattern to the snare"

**Current state:** Works, but requires 3 clicks (Copy → click target → Paste).

**Proposed enhancement:**
- `Ctrl/Cmd+C` on focused track → copies to clipboard buffer
- `Ctrl/Cmd+V` on focused track → pastes from buffer
- `Ctrl/Cmd+Shift+V` → paste as new track (append to session)

**What gets copied:**
```typescript
interface TrackClipboard {
  steps: boolean[];              // Full 128-step array
  parameterLocks: (ParameterLock | null)[];
  stepCount: number;             // Pattern length
  // Optionally:
  name?: string;                 // Track name hint
  sampleId?: string;             // Instrument hint
  transpose?: number;            // Pitch offset
}
```

**Multiplayer sync:** Paste dispatches existing `COPY_SEQUENCE` action, already synced.

---

### Workflow 2: Copy Steps Within Track

> "I want to copy these 4 steps to later in the same track"

**Use case:** Building a 32-step pattern from an 8-step motif.

**Flow:**
1. Select steps 0-7 (drag or Shift+Click range)
2. `Ctrl/Cmd+C` → copies selected steps
3. Click step 8 to set paste target
4. `Ctrl/Cmd+V` → pastes steps 0-7 to steps 8-15

**What gets copied:**
```typescript
interface StepRangeClipboard {
  // Relative to selection start, not absolute indices
  steps: { offset: number; active: boolean; lock: ParameterLock | null }[];
  length: number;  // Number of steps in range
}
```

**Paste behavior:**
- Steps paste starting at the clicked position
- Overflow wraps or truncates (configurable)
- Existing steps in target range are overwritten

**Edge cases:**
| Scenario | Behavior |
|----------|----------|
| Paste at step 60 (64-step track), 8 steps copied | Steps 60-63 filled, steps 4-7 discarded |
| Paste into shorter track | Expands stepCount if `autoExpandOnPaste` enabled |
| Paste across stepCount boundary | Wraps or truncates based on mode |

---

### Workflow 3: Save Patterns for Later Sessions

> "I want to save this phrase and use it next week"

**The insight:** Text notation enables this without server-side storage.

**Flow:**
1. User copies track as text: `Kick: x---x---x---x--- [stepCount:16]`
2. Pastes into any notes app (Apple Notes, Notion, text file)
3. Days/weeks later, opens new Keyboardia session
4. Pastes text into Keyboardia → track created from notation

**Why text is the right format:**
- Zero server infrastructure needed
- Works offline
- User owns their pattern library
- Survives platform changes (URLs rot, text doesn't)
- Searchable ("find all my kick patterns")
- Works with AI assistants ("make this more syncopated")

**Personal pattern library example:**
```
# My Pattern Library

## Kicks
Four on floor: x---x---x---x---
Offbeat:       --x---x---x---x-
Syncopated:    x--x--x---x-x---

## Snares
Backbeat:      ----x-------x---
Ghost groove:  --o-x-----o-x--- [o=ghost]

## Hi-hats
Straight 8ths: x-x-x-x-x-x-x-x-
Open/closed:   x-xox-x-x-xox-x- [o=open]
```

---

### Workflow 4: Layer Rhythm on Different Sound

> "I want to use this hi-hat rhythm on a shaker instead"

**Flow:**
1. Select steps in hi-hat track (or select entire track)
2. `Ctrl/Cmd+C` → copies rhythm pattern
3. Create or focus shaker track
4. `Ctrl/Cmd+V` → pastes rhythm (keeps shaker's instrument)

**Key distinction:** Paste copies **rhythm and p-locks**, not instrument.

**What transfers:**
| Property | Transfers? | Notes |
|----------|-----------|-------|
| `steps[]` | ✅ Yes | The rhythm itself |
| `parameterLocks[]` | ✅ Yes | Volume, pitch, tie |
| `stepCount` | ✅ Yes | Pattern length |
| `sampleId` | ❌ No | Target keeps its instrument |
| `name` | ❌ No | Target keeps its name |
| `transpose` | ⚠️ Optional | Could offer "paste with transpose" |

---

## Text Notation Round-Trip

### The Core Feature

**Copy as text:**
```
Right-click track → "Copy as Text"
Ctrl/Cmd+Shift+C → copies track as text notation

Result in clipboard:
Kick: x---x---x---x--- [stepCount:16, transpose:-2]
```

**Paste from text:**
```
Ctrl/Cmd+V with text in clipboard
→ Parser detects notation
→ Creates new track OR updates focused track

Paste modes:
- If text is track notation → creates/updates track
- If text is multi-track → creates multiple tracks
- If text is step pattern only → updates focused track steps
```

### Parser Behavior

**Input recognition:**
```typescript
function detectClipboardContent(text: string): ClipboardContentType {
  if (isJSON(text)) return 'json';           // Layer 3
  if (hasTrackLabel(text)) return 'notation'; // Layer 2 (Kick: x---)
  if (isStepPattern(text)) return 'pattern';  // Layer 1 (x---x---)
  return 'unknown';
}
```

**Graceful degradation:**
```
Input: "x---x---x---x--- [unknownKey:value]"
→ Parses pattern: 16 steps, 4 active
→ Ignores unknown annotation
→ Warns user (optional): "Unknown annotation 'unknownKey' ignored"
```

### Three Clipboard Layers

From [`SESSION-NOTATION.md`](../SESSION-NOTATION.md#three-layer-architecture):

| Layer | Format | When Used |
|-------|--------|-----------|
| **1. Plain Text** | `x---x---x---x---` | Discord, SMS, anywhere |
| **2. Annotated** | `Kick: x---x--- [swing:60]` | Clipboard with metadata |
| **3. JSON** | `{"steps":[...]}` | Full fidelity round-trip |

**Copy behavior:**
- Default: Layer 2 (annotated text) for shareability
- `Ctrl/Cmd+Alt+C`: Layer 3 (JSON) for full fidelity
- Context menu: Choose format

**Paste behavior:**
- Auto-detect format and parse appropriately
- Layer 3 preserves everything
- Layer 2 preserves most
- Layer 1 preserves rhythm only

### Multi-Track Copy/Paste

**Copying entire session (or selection of tracks):**
```
Kick:  x---x---x---x---
Snare: ----x-------x---
HiHat: x-x-x-x-x-x-x-x-

[bpm:120, swing:55]
```

**Paste behavior:**
- Creates missing tracks
- Updates existing tracks if names match
- Session-level metadata applied

---

## Implementation Layers

### Layer 0: Keyboard Shortcuts for Existing Copy (Low effort)

Wire `Ctrl/Cmd+C` and `Ctrl/Cmd+V` to existing track copy mechanism.

**Changes:**
- Add keyboard event listeners in `StepSequencer.tsx`
- Track "focused track" state (which track last received interaction)
- Dispatch existing `COPY_SEQUENCE` action

**No new message types needed.** Uses existing sync infrastructure.

### Layer 1: Text Export on Copy (Medium effort)

When copying, also write text notation to system clipboard.

**Changes:**
- Implement `trackToNotation(track: SessionTrack): string`
- Call `navigator.clipboard.writeText()` alongside internal copy
- Handle iOS clipboard quirks (already solved in `clipboard.ts`)

### Layer 2: Text Import on Paste (Medium effort)

Parse text notation from clipboard and create/update tracks.

**Changes:**
- Implement `notationToTrack(text: string): Partial<SessionTrack>`
- Detect paste source (internal buffer vs. external text)
- Handle track creation vs. update

### Layer 3: Selection-Based Copy (Higher effort)

Copy selected steps within a track.

**Changes:**
- Extend clipboard buffer to store step ranges
- Implement paste offset logic
- Handle wrap/truncate modes

### Layer 4: Pattern Library UI (Future)

Visual interface for saved patterns.

**Deferred:** Text-based personal libraries work without this.

---

## Keyboard Shortcuts

### Proposed Shortcuts

| Shortcut | Action | Scope |
|----------|--------|-------|
| `Ctrl/Cmd+C` | Copy focused track (or selection) | Global |
| `Ctrl/Cmd+V` | Paste to focused track | Global |
| `Ctrl/Cmd+Shift+V` | Paste as new track | Global |
| `Ctrl/Cmd+Shift+C` | Copy as text notation | Global |
| `Ctrl/Cmd+Alt+C` | Copy as JSON (full fidelity) | Power user |
| `Ctrl/Cmd+A` | Select all steps in focused track | Track context |
| `Ctrl/Cmd+D` | Duplicate focused track | Track context |

### Focus Model

**Current state:** No explicit focus model exists.

**Proposed:**
```typescript
interface FocusState {
  focusedTrackId: string | null;      // Last-interacted track
  focusedStepIndex: number | null;    // Last-clicked step (for paste offset)
}
```

**Focus is set by:**
- Clicking any element within a track row
- Using arrow keys to navigate (future)
- Tab navigation (accessibility)

**Focus is cleared by:**
- Clicking outside track area
- Pressing Escape

---

## Selection Model

### Current State

From `types.ts`:
```typescript
interface SelectionState {
  trackId: string;
  steps: Set<number>;      // Selected step indices
  anchor: number | null;   // For Shift+extend
}
```

**Current capabilities:**
- `Ctrl/Cmd+Click` toggles individual steps
- `Shift+Click` extends from anchor
- `Delete/Backspace` clears selected steps
- Selection is per-track only (cannot select across tracks)

### Proposed Extensions

**Range selection for copy:**
```typescript
interface CopyableSelection {
  trackId: string;
  range: { start: number; end: number };  // Contiguous range
  // OR
  steps: Set<number>;                      // Sparse selection
}
```

**Copy behavior by selection type:**
| Selection | Copy Result |
|-----------|-------------|
| No selection | Copy entire track |
| Contiguous range | Copy range (paste at offset) |
| Sparse selection | Copy sparse (paste at same indices) |

### Cross-Track Selection (Future)

**Not proposed for initial implementation.**

Would require:
```typescript
interface MultiTrackSelection {
  tracks: Map<string, Set<number>>;  // trackId → selected steps
}
```

Complexity: High. Defer unless strong user demand.

---

## Paste Targeting

### The Core Question

When user pastes, where do the steps go?

### Paste Modes

| Mode | Behavior | Best For |
|------|----------|----------|
| **Same Indices** | Steps 0,4,8 paste to 0,4,8 | Layering same rhythm |
| **At Cursor** | Steps paste starting at clicked position | Building patterns |
| **Compact** | Steps paste to 0,1,2,3... | Extracting motifs |
| **Into Selection** | Paste replaces selected steps | Surgical edits |

### Proposed Default

**Same Indices** for sparse selections (intuitive for layering).
**At Cursor** for range selections (intuitive for building).

### Offset Paste Flow

```
1. User copies steps [0,1,2,3] from Kick
2. User clicks step 8 in Snare (sets paste target)
3. User presses Ctrl+V
4. Steps paste at [8,9,10,11] in Snare
```

**Implementation:**
```typescript
function pasteWithOffset(
  source: StepRangeClipboard,
  targetTrackId: string,
  pasteOffset: number,
  mode: 'wrap' | 'truncate' | 'expand'
): PasteAction {
  // Map source offsets to target indices
  // Handle overflow based on mode
}
```

---

## Cross-Session Reuse

### Personal Pattern Library (Text-Based)

The simplest and most powerful approach: users maintain their own text files.

**Advantages:**
- Zero infrastructure cost
- Works offline
- User-controlled
- Platform-agnostic
- AI-friendly

**User flow:**
```
1. Create patterns in Keyboardia
2. Copy as text → paste into notes app
3. Organize by genre, mood, instrument
4. Later: copy from notes → paste into new session
```

### Session Seeds as Templates

**Existing feature:** Session seed files in `app/scripts/sessions/`.

**Proposed extension:** "New from template" button that loads a seed session.

Users could share `.json` session files that serve as starting points.

### URL-Based Pattern Sharing (Already Exists)

Session URLs already enable sharing. Enhance with:
- "Remix" button that forks session
- Clearer "copy track" affordance in remixed sessions

---

## Future Explorations

### 1. Pattern Probability

Random variation within copied patterns:

```
Notation: x?--x?-- (? = 50% chance)

Copy with probability:
- Original: x---x---
- Variation 1: x---x---
- Variation 2: ----x---
- Variation 3: x-------
```

**Implementation:** Store probability in `ParameterLock`.

### 2. Pattern Transformations on Paste

Modifier keys alter pasted content:

| Modifier | Transformation |
|----------|----------------|
| `Shift+Paste` | Paste inverted |
| `Alt+Paste` | Paste reversed |
| `Ctrl+Shift+Paste` | Paste at half speed (double length) |

**Risk:** Complex modifier meanings. May violate "no hidden features" principle.

### 3. Clipboard History

Visual panel showing recently copied patterns:

```
┌─────────────────────────────┐
│ 📋 Recent Patterns          │
│ ├─ Kick: x---x---          │
│ ├─ Snare: ----x---         │
│ └─ [From 2 sessions ago]    │
└─────────────────────────────┘
```

**Implementation:** `localStorage` for persistence. Ring buffer of last N copies.

### 4. AI Pattern Generation

Leverage text notation for AI integration:

```
User: "Make this pattern more syncopated"
Current: x---x---x---x---

AI returns: x--x--x---x-x---
→ User pastes result
```

**Why text notation enables this:**
- LLMs understand `x` and `-`
- No special parsing needed
- Works in any AI interface (ChatGPT, Claude, etc.)

### 5. MIDI Clipboard Interop

Copy pattern → get MIDI data on clipboard for DAW paste.

**Technical challenge:** Clipboard MIME types, DAW compatibility varies.

**Deferred:** Text notation works for most sharing needs.

### 6. Pattern Diff View

When pasting over existing content, show what will change:

```
Before: x---x---x---x---
After:  x--x--x---x-x---
Diff:   ..+.+....+.+....
```

**Use case:** Reviewing AI suggestions before applying.

### 7. Undo/Redo System

**Currently missing.** Critical for safe paste operations.

| Action | Undo Behavior |
|--------|---------------|
| Paste | Restore previous pattern |
| Delete | Restore deleted steps |
| Clear track | Restore all content |

**Implementation:** Command pattern with state snapshots.

**Multiplayer consideration:** Undo is local (your actions only), not global.

### 8. Loop/Repeat Pattern

Quick way to fill track by repeating a motif:

```
User has: x-x- (4 steps)
Action: "Repeat to fill 16 steps"
Result: x-x-x-x-x-x-x-x-
```

**Keyboard shortcut:** `Ctrl+R` (repeat selection)?

### 9. Pattern Variations Generator

Generate related patterns from a seed:

```
Original:   x---x---x---x---
Variation 1: x---x---x--xx--- (add ghost)
Variation 2: x-----x-x---x--- (shift beat)
Variation 3: x---x-x-x---x--- (add syncopation)
```

**UI:** "Suggest variations" button in pattern tools.

### 10. Import from External Sources

Parse patterns from other formats:

```
MIDI file → tracks
Drum tab text → tracks
YouTube video description → if contains pattern notation
```

**Most valuable:** MIDI import (Phase 24 in EMERGENCE.md).

---

## Non-Goals

These are explicitly out of scope for this spec:

| Feature | Why Out of Scope |
|---------|------------------|
| **Cloud pattern library** | Adds infrastructure complexity; text files work |
| **Pattern marketplace** | Community/business feature, not reuse |
| **Cross-track selection** | High complexity, unclear benefit |
| **Real-time collaborative paste** | Paste is local, then synced normally |
| **Version history per pattern** | Text files can be version controlled |
| **Pattern ownership/licensing** | Community policy, not technical |

---

## Open Questions

### 1. Paste Mode Default

Should default be "same indices" or "at cursor"?

**Argument for same indices:** More intuitive for layering.
**Argument for at cursor:** More intuitive for building.

**Proposal:** Detect context. Range selection → at cursor. Sparse selection → same indices.

### 2. Should Paste Preserve Instrument?

Currently proposed: No. Target keeps its instrument.

Alternative: Offer "paste with instrument" option.

**Question for users:** When you paste a hi-hat pattern onto a shaker, do you want the hi-hat sound or just the rhythm?

### 3. Text Notation Clipboard Priority

When copying, should we always include text notation?

**Pro:** Universal shareability.
**Con:** May interfere with internal app paste (if text is detected first).

**Proposal:** Internal buffer has priority. Text is fallback.

### 4. How to Handle stepCount Mismatch?

Copying 32-step pattern to 16-step track:

| Option | Behavior |
|--------|----------|
| Truncate | Paste steps 0-15 only |
| Expand | Increase target stepCount to 32 |
| Warn | Ask user before paste |

**Proposal:** Expand silently (least surprising).

### 5. Should Selection Persist Across Track Changes?

User selects steps in Kick, then clicks Snare. Is Kick selection cleared?

**Current:** Yes, selection is per-track and cleared when focus moves.

**Alternative:** Keep selection, enable cross-track operations.

**Proposal:** Keep current behavior for simplicity.

---

## Implementation Priority

| Phase | Feature | Effort | Impact |
|-------|---------|--------|--------|
| **1** | Ctrl+C/V for whole track | Low | High |
| **2** | Copy as text notation | Medium | Very High |
| **3** | Paste from text notation | Medium | Very High |
| **4** | Selection-based copy | Medium | Medium |
| **5** | Paste at offset | Medium | Medium |
| **6** | Clipboard history UI | High | Low |

**Recommendation:** Phases 1-3 deliver most value. Text notation round-trip is the key unlock for personal pattern reuse.

---

## References

- [`specs/SESSION-NOTATION.md`](../SESSION-NOTATION.md) — Text notation syntax
- [`specs/research/EMERGENCE.md`](./EMERGENCE.md) — Community emergence through text sharing
- [`specs/KEYBOARD-SHORTCUTS.md`](../KEYBOARD-SHORTCUTS.md) — Existing shortcut patterns
- [`specs/PHASE-31-UI-ENHANCEMENTS.md`](../PHASE-31-UI-ENHANCEMENTS.md) — Selection model (31F)
- [`app/src/utils/clipboard.ts`](../../app/src/utils/clipboard.ts) — Current clipboard utility

---

*Document created: January 2026*
*Status: Research / Proposal*
