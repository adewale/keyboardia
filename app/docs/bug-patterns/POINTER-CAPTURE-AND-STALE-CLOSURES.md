# Bug Pattern: Pointer Capture & Stale Closures in Drag Operations

> **Discovered:** 2026-01-01 in drag-to-paint feature audit
> **Severity:** Critical (feature completely broken without fix)
> **Affected Files:** `StepCell.tsx`, `TrackRow.tsx`

## Summary

Drag-based interactions in React require careful handling of:
1. **Pointer Capture** - Ensuring events follow the pointer, not the element
2. **Stale Closures** - Avoiding useCallback/useEffect dependencies that cause race conditions
3. **Global Listener Lifecycle** - Preventing memory leaks from repeated listener registration

## Pattern 1: Missing Pointer Capture

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

## Detection Checklist

When reviewing drag/pointer interaction code, check for:

- [ ] `setPointerCapture()` called on pointer down
- [ ] `releasePointerCapture()` called on pointer up
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
