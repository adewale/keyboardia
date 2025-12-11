# Lessons Learned

Debugging war stories and insights from building Keyboardia.

---

## 2024-12-11: The Ghost Click Bug (Mobile Toggle Revert)

### Symptom
On iOS Chrome, tapping a step to toggle it would briefly show the change, then immediately revert. The UI appeared to "flash" the toggled state before returning to the original.

### Initial Hypotheses (All Wrong)
1. WebSocket sync race condition
2. State hash mismatch triggering unwanted snapshots
3. Optimistic update being overwritten by server response
4. Stale closure in React state management

### How We Found the Real Cause
Added assertion logging (`[ASSERT]` tags) to both client and server to trace the exact sequence of events:

```typescript
// Server-side logging
console.log(`[ASSERT] toggle_step RECEIVED: track=${msg.trackId}, step=${msg.step}, time=${Date.now()}`);
console.log(`[ASSERT] toggle_step APPLIED: ${oldValue} -> ${newValue}`);
```

Running `wrangler tail` while testing on the real device revealed:
```
toggle_step RECEIVED: step=2, time=1765475417245
toggle_step APPLIED: step=2, false -> true
toggle_step RECEIVED: step=2, time=1765475417257  (12ms later!)
toggle_step APPLIED: step=2, true -> false
```

**Each tap was sending TWO toggle messages.**

### Root Cause: Ghost Clicks
Mobile browsers fire both touch AND mouse events for a single tap:
```
touchstart → touchend → onClick() #1
       ↓ (0-300ms later, synthesized)
mousedown → mouseup → onClick() #2
```

Our original `useLongPress` hook had handlers for both touch and mouse events, causing `onClick` to fire twice.

---

## Why We Didn't Know

**This is a well-documented, classic problem** - we just didn't look for it.

### Resources We Should Have Read
| Resource | What It Covers |
|----------|----------------|
| [web.dev: Touch and Mouse](https://web.dev/mobile-touchandmouse/) | Google's canonical guide on handling both input types |
| [MDN: Touch Events](https://developer.mozilla.org/en-US/docs/Web/API/Touch_events) | Comprehensive reference with mouse event emulation notes |
| [MDN: Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) | The modern, unified solution |
| [Apple Safari Handling Events](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/HandlingEvents/HandlingEvents.html) | Official iOS touch event documentation |
| [Chrome: 300ms Tap Delay](https://developer.chrome.com/blog/300ms-tap-delay-gone-away) | History and current state of mobile browser delays |

### Why DevTools Emulation Didn't Show the Bug
Chrome DevTools mobile emulation:
- ✅ Fires touch events
- ❌ Does NOT fire synthesized mouse events after touch
- ❌ Does NOT simulate the ghost click sequence

**The bug is invisible in emulation. Real device testing is required.**

---

## The Fix: Pointer Events API

### Before (Buggy): Dual Touch + Mouse Handlers
```typescript
// OLD - Vulnerable to ghost clicks
return {
  onMouseDown,
  onMouseUp: end,
  onTouchStart,
  onTouchEnd: end,  // Both call end() → onClick()
};
```

### After (Fixed): Unified Pointer Events
```typescript
// NEW - Single event system, no ghost clicks possible
return {
  onPointerDown,
  onPointerUp,
  onPointerLeave: cancel,
  onPointerCancel: cancel,
};
```

The [Pointer Events API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) unifies mouse, touch, and stylus into a single event stream. Browser support is 96%+.

### Why Pointer Events Are Better
| Aspect | Touch + Mouse | Pointer Events |
|--------|---------------|----------------|
| Event streams | Two (touch, mouse) | One (pointer) |
| Ghost click risk | Yes, requires mitigation | No, impossible |
| Input type detection | Separate handlers | `e.pointerType` |
| Multi-touch handling | Complex | `e.pointerId` tracking |
| Code complexity | Higher | Lower |

---

## Key Takeaways

### 1. Observability beats speculation
We spent time on wrong hypotheses. Adding targeted logging immediately revealed the real issue.

### 2. Test on real devices
Chrome DevTools emulation doesn't replicate mobile browser quirks. The ghost click bug only appears on actual iOS/Android devices.

### 3. Write failing tests first
Our new tests explicitly test the failure mode:
```typescript
it('uses single event system - no ghost click handling needed', () => {
  // Documents the architectural decision
});
```

### 4. Use modern APIs
The Pointer Events API exists precisely to solve this problem. We reinvented a wheel that was already rolling.

### 5. Read the docs first
The ghost click problem is extensively documented. A 10-minute read of MDN or web.dev would have prevented hours of debugging.

---

## Code Review Checklist for Touch/Mouse Event Code

### Pre-Implementation
- [ ] **Why not use an existing library?** (React Aria, @use-gesture, etc.)
- [ ] **Have you read the [MDN Pointer Events guide](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)?**
- [ ] **Do you understand the touch → mouse event sequence on mobile?**

### Implementation
- [ ] **Prefer Pointer Events** over separate touch/mouse handlers
- [ ] **If using both touch AND mouse**:
  - [ ] Implement ghost click prevention (timestamp guard or `preventDefault()`)
  - [ ] Document WHY both are needed
- [ ] **Touch targets are at least 44x44px** (WCAG accessibility)

### Testing
- [ ] **Unit tests for each pointer type** (mouse, touch, pen)
- [ ] **Unit tests for pointer ID tracking** (multi-touch safety)
- [ ] **Real device testing** (or BrowserStack/Sauce Labs)
- [ ] **Test on both iOS Safari AND iOS Chrome** (different behaviors!)

### Code Patterns to Flag in Review
```typescript
// RED FLAG: Dual handlers without deduplication
return {
  onMouseUp: handleEnd,
  onTouchEnd: handleEnd,  // Ghost click vulnerability!
};

// GREEN FLAG: Pointer events (single system)
return {
  onPointerUp: handleEnd,
};
```

### Questions for PR Review
1. "How does this handle a tap on mobile Chrome/Safari?"
2. "What happens if both touch and mouse events fire?"
3. "Has this been tested on a real mobile device?"
4. "Why aren't we using Pointer Events or React Aria for this?"

---

## Files Changed
- `src/hooks/useLongPress.ts` - Migrated from touch+mouse to Pointer Events
- `test/unit/useLongPress.test.ts` - 13 tests covering all pointer scenarios
- `docs/lessons-learned.md` - This document

## Related Links
- [MDN: Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)
- [MDN: Touch Events](https://developer.mozilla.org/en-US/docs/Web/API/Touch_events)
- [web.dev: Touch and Mouse](https://web.dev/mobile-touchandmouse/)
- [Can I Use: Pointer Events](https://caniuse.com/pointer) (96%+ support)
- [React Aria usePress](https://react-spectrum.adobe.com/blog/building-a-button-part-1.html)
- [@use-gesture/react](https://github.com/pmndrs/use-gesture)
