# Bug Pattern: Pointer Capture & Stale Closures in Drag Operations

> **Discovered:** 2026-01-01 in drag-to-paint feature audit
> **Severity:** Critical (feature completely broken without fix)
> **Affected Files:** `StepCell.tsx`, `TrackRow.tsx`

## Summary

Drag-based interactions in React require careful handling of:
1. **Pointer Capture** - Ensuring events follow the pointer, not the element
2. **Stale Closures** - Avoiding useCallback/useEffect dependencies that cause race conditions
3. **Global Listener Lifecycle** - Preventing memory leaks from repeated listener registration

---

## ⚠️ Critical Decision: When to Use setPointerCapture

**The same API that fixes one problem causes another.** Choose based on interaction type:

| Interaction Type | Use `setPointerCapture`? | Why |
|-----------------|-------------------------|-----|
| **Single-element drag** (sliders, knobs, resize handles) | ✅ YES | Keeps events on one element even when pointer leaves bounds |
| **Multi-element paint** (step sequencer, drawing across cells) | ❌ NO | Prevents `pointerenter` from firing on sibling elements |

**Rule of thumb:**
- Dragging **one thing** → use pointer capture
- Painting **across many things** → use container-based event handling

See **Pattern 1** for when to USE pointer capture, and **Pattern 4** for when to AVOID it.

---

## Pattern 1: Missing Pointer Capture (Single-Element Drags)

### Symptoms
- Drag operation only affects the first element clicked
- Fast dragging "loses" the drag operation
- Pointer moving outside element bounds breaks the interaction

### Root Cause
Without `setPointerCapture()`, pointer events are dispatched to the element under the cursor, not the element that initiated the drag.

### Bad Code
```typescript
const handlePointerDown = (e: React.PointerEvent) => {
  setDragMode(true);
  // BUG: Events will stop if pointer leaves this element
};
```

### Fixed Code
```typescript
const handlePointerDown = (e: React.PointerEvent) => {
  setDragMode(true);

  // Capture pointer to receive ALL events until release
  try {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    // Ignore if capture fails (some touch browsers)
  }
};

const handlePointerUp = (e: React.PointerEvent) => {
  // Release capture
  try {
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  } catch {
    // Ignore if release fails
  }
  setDragMode(false);
};
```

---

## Pattern 2: Stale Closures in Event Handlers

### Symptoms
- State reads inside callbacks show old values
- Intermittent race conditions during rapid interactions
- Works on first use, breaks on subsequent uses

### Root Cause
Closures in `useCallback` capture the value of state at creation time. If dependencies re-create the callback, memoized handlers elsewhere may still reference old closures.

### Bad Code
```typescript
// paintMode in deps causes re-creation on each change
const handlePaintEnter = useCallback((stepIndex: number) => {
  if (paintMode === null) return;  // May be stale!
  // ...
}, [paintMode, track.steps, onToggleStep]);
```

### Fixed Code
```typescript
// Use ref to always read current value
const paintModeRef = useRef<PaintMode>(null);
paintModeRef.current = paintMode;

const handlePaintEnter = useCallback((stepIndex: number) => {
  const currentPaintMode = paintModeRef.current;  // Always fresh
  if (currentPaintMode === null) return;
  // ...
}, [track.steps, onToggleStep]);  // paintMode removed from deps
```

---

## Pattern 3: Per-Component Global Listeners

### Symptoms
- Memory usage grows over time
- Multiple event handlers fire for single event
- Cleanup doesn't remove all listeners

### Root Cause
Each component instance registers its own global listener. With N components, N listeners accumulate.

### Bad Code
```typescript
// In a component rendered N times (e.g., TrackRow)
useEffect(() => {
  if (paintMode === null) return;  // Conditional registration

  const handlePointerUp = () => setPaintMode(null);
  document.addEventListener('pointerup', handlePointerUp);

  return () => {
    document.removeEventListener('pointerup', handlePointerUp);
  };
}, [paintMode]);  // Re-runs on each paintMode change!
```

### Fixed Code
```typescript
// Register once on mount, use ref for current state
useEffect(() => {
  const handlePointerUp = () => {
    if (paintModeRef.current !== null) {
      setPaintMode(null);
    }
  };

  document.addEventListener('pointerup', handlePointerUp);
  document.addEventListener('pointercancel', handlePointerUp);

  return () => {
    document.removeEventListener('pointerup', handlePointerUp);
    document.removeEventListener('pointercancel', handlePointerUp);
  };
}, []);  // Empty deps - register once
```

### Better Fix (Centralized)
Move global listener to parent component (e.g., StepSequencer) instead of each child (TrackRow).

---

## Pattern 4: setPointerCapture Anti-Pattern for Multi-Element Interactions

> **Related:** Bug pattern `pointer-capture-multi-element` in `src/utils/bug-patterns.ts`

### Symptoms
- Drag-to-paint only toggles the first clicked element
- `pointerenter` events never fire on sibling elements during drag
- E2E tests detect the bug but the feature "works" in isolation
- Works fine with single clicks, breaks only during drag

### Root Cause

`setPointerCapture()` routes ALL pointer events to the capturing element. This is intentional—it's the whole point of the API. But for multi-element interactions where you need `pointerenter` to fire on siblings, this completely breaks the feature.

```
Mouse dragging across steps:

WITHOUT setPointerCapture (correct for multi-element):
┌─────┐  ┌─────┐  ┌─────┐
│ [1] │→→│ [2] │→→│ [3] │    pointerenter fires on [2], [3]
└──▲──┘  └─────┘  └─────┘
   │
pointerdown

WITH setPointerCapture (BROKEN for multi-element):
┌─────┐  ┌─────┐  ┌─────┐
│ [1] │  │ [2] │  │ [3] │    ALL events go to [1]
└──▲──┘  └─────┘  └─────┘    pointerenter NEVER fires on [2], [3]
   │
   └── pointer captured here
```

### Bad Code

```typescript
// In StepCell.tsx - each cell captures pointer on click
const handlePointerDown = (e: React.PointerEvent) => {
  onPaintStart(stepIndex);

  // BUG: This prevents pointerenter on other cells!
  try {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    // ...
  }
};
```

### Fixed Code (Container-Based Hit-Testing)

```typescript
// In TrackRow.tsx - container handles all pointer events
const stepsContainerRef = useRef<HTMLDivElement>(null);

const getStepFromEvent = useCallback((e: React.PointerEvent) => {
  const target = e.target as HTMLElement;
  const stepCell = target.closest('[data-step]') as HTMLElement | null;
  if (!stepCell) return null;
  return parseInt(stepCell.dataset.step!, 10);
}, []);

const handlePointerDown = useCallback((e: React.PointerEvent) => {
  const step = getStepFromEvent(e);
  if (step === null) return;

  const newState = !track.steps[step];
  onToggleStep(step);
  setPaintMode(newState ? 'on' : 'off');
  lastStepRef.current = step;
  // NO setPointerCapture!
}, [track.steps, onToggleStep, getStepFromEvent]);

const handlePointerMove = useCallback((e: React.PointerEvent) => {
  if (paintModeRef.current === null) return;

  const step = getStepFromEvent(e);
  if (step === null || step === lastStepRef.current) return;

  // Paint this step
  const isActive = track.steps[step];
  if ((paintModeRef.current === 'on') !== isActive) {
    onToggleStep(step);
  }
  lastStepRef.current = step;
}, [track.steps, onToggleStep, getStepFromEvent]);

// On the container:
<div
  ref={stepsContainerRef}
  className="steps"
  onPointerDown={handlePointerDown}
  onPointerMove={handlePointerMove}
  onPointerUp={() => setPaintMode(null)}
>
  {steps.map((_, i) => (
    <div key={i} className="step-cell" data-step={i}>...</div>
  ))}
</div>
```

### Key Differences

| Aspect | Per-Cell Handlers | Container-Based |
|--------|-------------------|-----------------|
| Event attachment | Each cell has handlers | Container has handlers |
| Hit detection | Implicit (event target) | Explicit (`closest('[data-step]')`) |
| Pointer capture | Breaks multi-element | Not needed |
| Performance | N handlers | 1 handler |

### Reference Implementation

See `VelocityLane.tsx` for a working container-based drag implementation.

---

## Detection Checklist

When reviewing drag/pointer interaction code, check for:

**First, determine interaction type:**
- [ ] Is this a **single-element drag** (slider, knob, resize)? → Use pointer capture (Pattern 1)
- [ ] Is this a **multi-element paint** (step grid, canvas)? → Use container-based (Pattern 4)

**For single-element drags:**
- [ ] `setPointerCapture()` called on pointer down
- [ ] `releasePointerCapture()` called on pointer up

**For multi-element paints:**
- [ ] NO `setPointerCapture()` anywhere in the flow
- [ ] Container handles `onPointerMove` with hit-testing
- [ ] Individual elements have `data-*` attributes for identification

**For all drag interactions:**
- [ ] State referenced in callbacks uses refs, not direct state
- [ ] useEffect dependencies for global listeners are `[]` (empty)
- [ ] Global listeners are centralized in parent, not per-child
- [ ] `pointercancel` is handled alongside `pointerup`

## Files to Audit

Any component with:
- `onPointerDown` / `onMouseDown` handlers
- `document.addEventListener` in useEffect
- Drag-and-drop functionality
- Canvas/drawing interactions
- Slider/range controls with custom handlers

## Related Patterns

- [Serialization Boundary Mismatch](./SERIALIZATION-BOUNDARY-MISMATCH.md)
- React useCallback stale closure pattern
- Event delegation anti-patterns
- Bug pattern `pointer-capture-multi-element` in `src/utils/bug-patterns.ts`
