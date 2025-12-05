# Keyboardia UI Philosophy

Inspired by the Teenage Engineering OP-Z and lessons learned during implementation.

---

## Core Principle: Direct Manipulation Over Modes

The OP-Z's genius is that complex features are accessed through **physical gestures on the thing itself**, not through menu navigation. Every control affects something you can see or hear immediately.

### What We Learned

| Problem | Bad Solution | Good Solution |
|---------|--------------|---------------|
| Clear a track | Menu → "Clear steps" → Confirm | CLR button directly on the track |
| Copy pattern | Modal picker to select source/dest | CPY on source → PST appears on destinations |
| Per-step pitch | Right-click → modal editor | Shift+click step → inline sliders appear below |
| Chromatic mode | Hidden in track menu | Mode toggle (●/♪) always visible on track |
| Auto-slice | Modal with preset buttons | Waveform + sensitivity slider with live preview |

**The pattern**: If an action requires selecting a target, the control should be *on* the target.

---

## OP-Z Principles Applied to Keyboardia

### 1. Controls Live Where They Act

**OP-Z**: Each track has its own row of buttons. You don't "select track 3 then press clear" — you press the button that's physically on track 3.

**Keyboardia**:
- CLR/CPY/DEL buttons are on each track row, not in a toolbar
- Mode toggle (drum/chromatic) is on each track header
- P-lock editor appears inline below the track being edited

### 2. Visual Feedback Is Immediate

**OP-Z**: LEDs show state changes instantly. Twist a knob, see the LED respond.

**Keyboardia**:
- Swing visually shifts step positions in real-time
- Parameter lock badges (↑/↓ for pitch, +/− for volume) appear on steps
- Slice markers move as you drag the sensitivity slider
- Copy source highlights green, destinations show PST button

### 3. No Confirmation Dialogs

**OP-Z**: Press a button, it happens. Undo by doing the opposite action.

**Keyboardia**:
- CLR clears immediately (can re-add steps)
- DEL removes immediately (can re-record)
- No "Are you sure?" interruptions

### 4. Modes Are Visible, Not Hidden

**OP-Z**: Track type is shown by LED color and button position. You always know what mode you're in.

**Keyboardia**:
- Drum/Chromatic toggle is always visible (●/♪ buttons)
- Copy mode shows blue bar + PST buttons on valid targets
- Selected step shows cyan border + inline editor

### 5. Progressive Disclosure Through Gesture

**OP-Z**: Hold SHIFT to reveal secondary functions. Hold a step to see/edit its parameters.

**Keyboardia**:
- Normal click = toggle step on/off
- Shift+click = select step for parameter editing
- Click waveform region = preview that slice
- Drag slice marker = adjust slice point

---

## Information Hierarchy

Controls should be positioned **upstream** of what they affect:

```
┌─────────────────────────────────────────────────────────────┐
│  Transport: [▶] [BPM ====120] [Swing ====30%]               │  ← Global controls
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [M] Kick  [●][♪]  [■][■][□][□][■][□]...  [CPY][CLR]       │  ← Per-track controls
│  [M] Snare [●][♪]  [□][□][■][□][□][■]...  [CPY][CLR]       │     on same row as
│  [M] HiHat [●][♪]  [■][■][■][■][■][■]...  [CPY][CLR]       │     the thing they
│  [M] Clap  [●][♪]  [□][□][□][□][■][□]...  [CPY][CLR]       │     control
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  [Hold to Record]  ════════════════════  [4/8 tracks]       │  ← Recording below
│                                                             │     (creates new tracks)
└─────────────────────────────────────────────────────────────┘
```

---

## Color Language

Consistent color coding helps users learn the interface without reading labels:

| Color | Meaning | Examples |
|-------|---------|----------|
| **Orange** | Active step, primary action | Lit steps, record button |
| **Blue** | Pitch, selection | Pitch badges, selected step border |
| **Orange/Red** | Volume, destructive | Volume badges, DEL button hover |
| **Purple** | Mode, parameter locks | Chromatic mode, p-lock border |
| **Green** | Source, positive | Copy source highlight, add button |
| **Cyan** | Selection state | Selected step for editing |
| **Yellow/Orange** | Slice markers | Waveform slice points |

---

## Future Improvements (OP-Z Inspired)

### Step Components
OP-Z allows per-step modifiers that affect timing, probability, or direction. We could add:
- **Probability**: Step has X% chance of playing
- **Ratchet**: Step repeats N times within its duration
- **Nudge**: Micro-timing offset (finer than swing)

### Punch-In Effects
Hold a key while playing to apply a temporary effect:
- Hold R = reverse current sample
- Hold H = half-speed
- Hold D = delay feedback burst

### Track Mute Groups
OP-Z has mute groups where muting one track can unmute another. Useful for variations:
- Mute "Kick A" → auto-unmute "Kick B"

### Pattern Chaining
Multiple 16-step patterns that can be chained into longer sequences.

### Motion Recording
Record knob movements (tempo, swing, volume) as automation that plays back with the pattern.

---

## Anti-Patterns to Avoid

1. **Modals for simple actions** - If it's one click, don't make it two
2. **Modes that aren't visible** - If state changes behavior, show the state
3. **Confirmation dialogs** - Trust the user, make undo easy instead
4. **Separate pages/views** - Keep everything on one screen if possible
5. **Tooltips as primary documentation** - UI should be self-evident
6. **Controls far from targets** - Action buttons belong on the thing they affect

---

## The Test

For any new feature, ask:

1. Can I see the effect immediately?
2. Is the control on or near the thing it affects?
3. Does it require mode switching or navigation?
4. Would this work on a device with no screen?
5. Can I discover it by experimenting?

If the answer to #3 is "yes" or #4/#5 is "no", reconsider the design.
