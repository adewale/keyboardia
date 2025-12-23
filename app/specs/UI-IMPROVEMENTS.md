# UI Improvements Specification

This spec describes UI improvements to be implemented on the main branch. These features were originally prototyped on `claude/improve-ui-design-*` branch but main has diverged significantly, so this spec provides implementation guidance for rebuilding them.

## Overview

The improvements fall into five categories:
1. **Keyboard Shortcuts** - Quick access to common actions
2. **Visual Feedback** - Progress and state indicators
3. **Workflow Shortcuts** - Buttons for common operations
4. **Pattern Manipulation** - Tools for editing step patterns
5. **Visual Design** - Typography, colors, and motion

---

## 1. Keyboard Shortcuts

### 1.1 Escape: Stop/Reset Playhead

**Behavior:**
- If in copy mode (selecting destination track), cancel copy mode
- Otherwise, stop playback and reset `currentStep` to -1

**Implementation (StepSequencer.tsx):**

```tsx
useEffect(() => {
  const handleKeyDown = (e: KeyboardEvent) => {
    // Don't trigger if user is typing in an input
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    if (e.key === 'Escape') {
      if (copySource) {
        setCopySource(null);
      } else {
        // Stop and reset
        if (state.isPlaying) {
          scheduler.stop();
          dispatch({ type: 'SET_PLAYING', isPlaying: false });
        }
        dispatch({ type: 'SET_CURRENT_STEP', step: -1 });
      }
      return;
    }
  };
  window.addEventListener('keydown', handleKeyDown);
  return () => window.removeEventListener('keydown', handleKeyDown);
}, [copySource, state.isPlaying, dispatch]);
```

### 1.2 Number Keys 1-8: Solo Tracks

**Behavior:**
- Press `1-8` to toggle solo on tracks 1-8
- Press `Shift+1-8` to toggle mute on tracks 1-8

**Implementation (StepSequencer.tsx):**

```tsx
const num = parseInt(e.key);
if (num >= 1 && num <= 8) {
  const trackIndex = num - 1;
  if (trackIndex < state.tracks.length) {
    const trackId = state.tracks[trackIndex].id;
    if (e.shiftKey) {
      handleToggleMute(trackId);
    } else {
      handleToggleSolo(trackId);
    }
  }
  return;
}
```

---

## 2. Visual Feedback

### 2.1 Progress Bar Above Grid

**Behavior:**
- Thin horizontal bar above the step grid
- Shows current position in the pattern as percentage
- Only visible during playback

**Implementation:**

**StepSequencer.tsx:**
```tsx
const maxSteps = useMemo(() => {
  if (state.tracks.length === 0) return 16;
  return Math.max(...state.tracks.map(t => t.stepCount ?? 16));
}, [state.tracks]);

const progressPercent = useMemo(() => {
  if (!state.isPlaying || state.currentStep < 0) return 0;
  return ((state.currentStep % maxSteps) / maxSteps) * 100;
}, [state.isPlaying, state.currentStep, maxSteps]);

// In JSX:
{state.isPlaying && (
  <div className="progress-bar-container">
    <div className="progress-bar-spacer" />
    <div className="progress-bar">
      <div
        className="progress-bar-fill"
        style={{ width: `${progressPercent}%` }}
      />
    </div>
  </div>
)}
```

**StepSequencer.css:**
```css
.progress-bar-container {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 4px 0;
}

.progress-bar-spacer {
  /* Match track controls width */
  min-width: 362px;
  flex-shrink: 0;
}

.progress-bar {
  flex: 1;
  height: 3px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: var(--color-accent);
  transition: width 50ms linear;
}
```

### 2.2 Metronome Pulse on Play Button

**Behavior:**
- When playing, the play button pulses in sync with the tempo
- Uses CSS animation with duration derived from BPM

**Implementation:**

**Transport.tsx:**
```tsx
const beatDuration = 60 / tempo; // seconds per beat

<button
  className={`play-button ${isPlaying ? 'playing' : ''}`}
  style={isPlaying ? { '--beat-duration': `${beatDuration}s` } as React.CSSProperties : undefined}
>
```

**Transport.css:**
```css
.play-button.playing {
  animation: metronome-pulse var(--beat-duration, 0.5s) ease-in-out infinite;
}

@keyframes metronome-pulse {
  0%, 100% { box-shadow: 0 0 16px rgba(255, 82, 82, 0.4); }
  50% { box-shadow: 0 0 32px rgba(255, 82, 82, 0.7); }
}
```

---

## 3. Workflow Shortcuts

### 3.1 Unmute All Button

**Behavior:**
- Button in transport bar that unmutes all tracks at once
- Also provide "Mute All" and "Clear Solos" buttons

**Implementation:**

**Transport.tsx (props):**
```tsx
interface TransportProps {
  // ... existing props
  onMuteAll?: () => void;
  onUnmuteAll?: () => void;
  onClearSolos?: () => void;
}
```

**StepSequencer.tsx (handlers):**
```tsx
const handleUnmuteAll = useCallback(() => {
  state.tracks.forEach(track => {
    if (track.muted) {
      dispatch({ type: 'TOGGLE_MUTE', trackId: track.id });
    }
  });
}, [dispatch, state.tracks]);

const handleClearSolos = useCallback(() => {
  dispatch({ type: 'CLEAR_ALL_SOLOS' });
}, [dispatch]);
```

**grid.tsx (new action):**
```tsx
case 'CLEAR_ALL_SOLOS': {
  const tracks = state.tracks.map(track => ({ ...track, soloed: false }));
  return { ...state, tracks };
}
```

**Transport.tsx (JSX):**
```tsx
<div className="transport-actions">
  <button className="transport-action-btn" onClick={onUnmuteAll}>
    Unmute All
  </button>
  <button className="transport-action-btn" onClick={onClearSolos}>
    Clear Solos
  </button>
</div>
```

### 3.2 Click Track Name to Preview Sample

**Behavior:**
- Single click on track name plays a preview of that track's sample/synth
- Uses the audio engine to play a short one-shot

**Implementation (TrackRow.tsx):**
```tsx
const handlePreviewSample = useCallback(() => {
  if (audioEngine.isInitialized()) {
    const time = audioEngine.getCurrentTime();
    if (isSynthTrack) {
      const preset = track.sampleId.replace('synth:', '');
      audioEngine.playSynthNote(`preview-${track.id}`, preset, track.transpose ?? 0, time, 0.3);
    } else {
      audioEngine.playSample(track.sampleId, `preview-${track.id}`, time, undefined, 'oneshot', track.transpose ?? 0);
    }
  }
}, [track.sampleId, track.id, track.transpose, isSynthTrack]);

// In JSX:
<span
  className="track-name"
  onClick={handlePreviewSample}
  onDoubleClick={handleStartRename}
>
  {track.name}
</span>
```

---

## 4. Pattern Manipulation

### 4.1 Rotate Pattern Left/Right

**Behavior:**
- Shift all active steps one position left or right
- Steps wrap around (last becomes first, or vice versa)

**Implementation (grid.tsx):**
```tsx
case 'ROTATE_TRACK': {
  const direction = action.direction ?? 1; // 1 = right, -1 = left
  const tracks = state.tracks.map((track) => {
    if (track.id !== action.trackId) return track;
    const stepCount = track.stepCount ?? STEPS_PER_PAGE;
    const steps = [...track.steps];
    const activeSteps = steps.slice(0, stepCount);

    if (direction > 0) {
      // Rotate right: last element moves to front
      const last = activeSteps.pop();
      activeSteps.unshift(last ?? false);
    } else {
      // Rotate left: first element moves to end
      const first = activeSteps.shift();
      activeSteps.push(first ?? false);
    }

    for (let i = 0; i < stepCount; i++) {
      steps[i] = activeSteps[i];
    }
    return { ...track, steps };
  });
  return { ...state, tracks };
}
```

**TrackRow.tsx (buttons):**
```tsx
<div className="action-btn-group">
  <button onClick={() => onRotate(-1)} disabled={!hasSteps} title="Rotate left">
    ←
  </button>
  <button onClick={() => onRotate(1)} disabled={!hasSteps} title="Rotate right">
    →
  </button>
</div>
```

### 4.2 Invert Pattern

**Behavior:**
- Toggle all steps (active becomes inactive, inactive becomes active)

**Implementation (grid.tsx):**
```tsx
case 'INVERT_TRACK': {
  const tracks = state.tracks.map((track) => {
    if (track.id !== action.trackId) return track;
    const stepCount = track.stepCount ?? STEPS_PER_PAGE;
    const steps = [...track.steps];
    for (let i = 0; i < stepCount; i++) {
      steps[i] = !steps[i];
    }
    return { ...track, steps };
  });
  return { ...state, tracks };
}
```

### 4.3 Random Fill

**Behavior:**
- Fill track with random steps at configurable density (default 50%)

**Implementation (grid.tsx):**
```tsx
case 'RANDOM_FILL_TRACK': {
  const density = action.density ?? 50;
  const tracks = state.tracks.map((track) => {
    if (track.id !== action.trackId) return track;
    const stepCount = track.stepCount ?? STEPS_PER_PAGE;
    const steps = [...track.steps];
    for (let i = 0; i < stepCount; i++) {
      steps[i] = Math.random() * 100 < density;
    }
    return { ...track, steps };
  });
  return { ...state, tracks };
}
```

---

## 5. Information Display

### 5.1 Category Color Coding on Tracks

**Behavior:**
- Each track has a colored left border based on its instrument category
- Categories: drums (orange), bass (blue), synth (purple), fx (green)

**Implementation (TrackRow.tsx):**
```tsx
const getSampleCategory = (sampleId: string): string => {
  if (sampleId.startsWith('synth:')) return 'synth';
  const drumSamples = ['kick', 'snare', 'hihat', 'clap', 'tom', 'rim', 'cowbell', 'openhat'];
  const bassSamples = ['bass', 'subbass'];
  const fxSamples = ['zap', 'noise'];
  if (drumSamples.includes(sampleId)) return 'drums';
  if (bassSamples.includes(sampleId)) return 'bass';
  if (fxSamples.includes(sampleId)) return 'fx';
  return 'other';
};

const sampleCategory = getSampleCategory(track.sampleId);

// In JSX:
<span className={`track-name category-${sampleCategory}`}>
```

**TrackRow.css:**
```css
.track-name {
  position: relative;
  border-left: 2px solid #444;
  padding-left: 6px;
}

.track-name.category-drums { border-left-color: #e67e22; }
.track-name.category-bass { border-left-color: #3498db; }
.track-name.category-synth { border-left-color: #9b59b6; }
.track-name.category-fx { border-left-color: #2ecc71; }
```

### 5.2 Dim Unused Beat Markers

**Behavior:**
- Beat markers (bar numbers) above the grid are dimmed beyond the shortest track's length
- Helps visualize where tracks of different lengths align

**Implementation (StepSequencer.tsx):**
```tsx
const minSteps = useMemo(() => {
  if (state.tracks.length === 0) return 16;
  return Math.min(...state.tracks.map(t => t.stepCount ?? 16));
}, [state.tracks]);

// In beat markers:
{Array.from({ length: maxSteps }, (_, i) => {
  const isDownbeat = i % 4 === 0;
  const beatNumber = Math.floor(i / 4) + 1;
  const isDimmed = i >= minSteps && state.tracks.length > 1;
  return (
    <span
      key={i}
      className={`beat-marker ${isDownbeat ? 'downbeat' : ''} ${isDimmed ? 'dimmed' : ''}`}
    >
      {isDownbeat ? beatNumber : '·'}
    </span>
  );
})}
```

**StepSequencer.css:**
```css
.beat-marker.dimmed {
  opacity: 0.3;
}
```

---

## 6. Editing Conveniences

### 6.1 Double-Click Track Name to Rename

**Behavior:**
- Double-click on track name enters inline edit mode
- Enter commits the rename, Escape cancels
- Clicking outside also commits

**Implementation (TrackRow.tsx):**
```tsx
const [isRenaming, setIsRenaming] = useState(false);
const [renameValue, setRenameValue] = useState(track.name);
const renameInputRef = useRef<HTMLInputElement>(null);

const handleStartRename = useCallback(() => {
  setRenameValue(track.name);
  setIsRenaming(true);
  setTimeout(() => renameInputRef.current?.focus(), 0);
}, [track.name]);

const handleFinishRename = useCallback(() => {
  if (renameValue.trim() && renameValue !== track.name && onRename) {
    onRename(renameValue.trim());
  }
  setIsRenaming(false);
}, [renameValue, track.name, onRename]);

const handleRenameKeyDown = useCallback((e: React.KeyboardEvent) => {
  if (e.key === 'Enter') {
    handleFinishRename();
  } else if (e.key === 'Escape') {
    setIsRenaming(false);
    setRenameValue(track.name);
  }
}, [handleFinishRename, track.name]);

// In JSX:
<span className="track-name" onDoubleClick={handleStartRename}>
  {isRenaming ? (
    <input
      ref={renameInputRef}
      className="track-name-input"
      value={renameValue}
      onChange={(e) => setRenameValue(e.target.value)}
      onBlur={handleFinishRename}
      onKeyDown={handleRenameKeyDown}
      onClick={(e) => e.stopPropagation()}
    />
  ) : (
    track.name
  )}
</span>
```

**grid.tsx (action):**
```tsx
case 'RENAME_TRACK': {
  const tracks = state.tracks.map((track) => {
    if (track.id !== action.trackId) return track;
    return { ...track, name: action.name };
  });
  return { ...state, tracks };
}
```

---

## 7. Typography

### 7.1 Font Stack

Add Google Fonts import to `index.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=JetBrains+Mono:wght@400;500;600;700&family=Work+Sans:wght@400;500;600;700&display=swap');

:root {
  --font-display: 'Archivo Black', 'Impact', sans-serif;
  --font-body: 'Work Sans', 'Helvetica Neue', sans-serif;
  --font-mono: 'JetBrains Mono', 'SF Mono', monospace;

  font-family: var(--font-body);
}
```

**Usage:**
- `--font-display`: Headings, transport title, major labels
- `--font-body`: All body text, buttons, track names
- `--font-mono`: Numeric values (tempo, swing, step counts)

---

## 8. Motion

### 8.1 CSS Variables for Animation

```css
:root {
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
  --duration-fast: 150ms;
  --duration-normal: 250ms;
}
```

### 8.2 Play Button Fill Effect on Hover

**Behavior:**
- Play button has outline style by default
- On hover, fills with color from center using `::before` pseudo-element

**Transport.css:**
```css
.play-button {
  width: 60px;
  height: 60px;
  border: 3px solid var(--color-success);
  border-radius: 50%;
  background: transparent;
  color: var(--color-success);
  position: relative;
  overflow: hidden;
  transition: all var(--duration-normal) var(--ease-smooth);
}

.play-button::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--color-success);
  border-radius: 50%;
  transform: scale(0);
  transition: transform var(--duration-normal) var(--ease-smooth);
}

.play-button:hover::before {
  transform: scale(1);
}

.play-button:hover {
  box-shadow: 0 0 20px rgba(0, 245, 160, 0.4);
  transform: scale(1.05);
}
```

### 8.3 LED Glow Pulses on Active Elements

**Behavior:**
- Active step cells have a glowing box-shadow
- Glow intensifies on hover

**StepCell.css:**
```css
.step-cell.active {
  background: linear-gradient(180deg, var(--color-accent-light) 0%, var(--color-accent) 100%);
  border-color: var(--color-accent-light);
  box-shadow:
    0 0 12px var(--color-accent-glow),
    0 0 24px rgba(255, 87, 34, 0.2),
    inset 0 1px 0 rgba(255, 255, 255, 0.2);
}

.step-cell.active:hover {
  box-shadow:
    0 0 16px var(--color-accent-glow),
    0 0 32px rgba(255, 87, 34, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.3);
  transform: scale(1.05);
}
```

### 8.4 Smooth Easing with CSS Variables

Apply consistent easing across all interactive elements:

```css
.step-cell {
  transition: transform var(--duration-fast) var(--ease-smooth),
              box-shadow var(--duration-fast) var(--ease-smooth);
}

button {
  transition: all var(--duration-fast) var(--ease-smooth);
}
```

---

## Required Type Definitions

Add to `types.ts` or inline:

```tsx
// Grid action types to add
type GridAction =
  | { type: 'FILL_TRACK'; trackId: string; interval?: number }
  | { type: 'ROTATE_TRACK'; trackId: string; direction: number }
  | { type: 'INVERT_TRACK'; trackId: string }
  | { type: 'RANDOM_FILL_TRACK'; trackId: string; density?: number }
  | { type: 'RENAME_TRACK'; trackId: string; name: string }
  | { type: 'CLEAR_ALL_SOLOS' }
  // ... existing actions
```

---

## Implementation Order

Recommended order for implementing these features:

1. **Typography & CSS Variables** - Foundation for other visual changes
2. **Keyboard Shortcuts** - High impact, low complexity
3. **Pattern Manipulation Actions** - Reducer changes first
4. **Visual Feedback** - Progress bar, beat markers
5. **Workflow Shortcuts** - Transport buttons
6. **Motion & Polish** - Animations last

---

## Testing Considerations

- Test keyboard shortcuts don't fire when typing in inputs
- Test pattern manipulation preserves p-locks
- Test rename with empty string (should reject)
- Test progress bar with tracks of different lengths
- Test category detection for all sample types
- Test animations don't cause layout shift
