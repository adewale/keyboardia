# Keyboard Shortcuts - Phase 36

Desktop-only keyboard shortcuts for efficient workflow.

## Supported Shortcuts

| Key | Action | Status |
|-----|--------|--------|
| Space | Play/Pause | Implemented |
| Escape | Cancel/Clear/Close | Implemented |
| Delete/Backspace | Delete selected steps | Implemented |
| ? | Toggle shortcuts panel | Implemented |
| Cmd/Ctrl+Shift+M | Unmute all tracks | Implemented |
| M | Mute focused track | Ready (handler exists) |
| S | Solo focused track | Ready (handler exists) |
| Arrow Keys | Navigate focus | Ready (handlers exist) |
| Enter | Confirm | Ready (handler exists) |

## Mouse-Based Shortcuts (not in help panel)

| Action | Shortcut |
|--------|----------|
| Toggle step selection | Cmd/Ctrl+Click |
| Open parameter editor | Shift+Click |

## Help Panel (Desktop Only)

Triggered by pressing `?`. Shows keyboard shortcuts in a glassmorphism panel.

```
+----------------------------------------------------------+
|                                                          |
|    BACKDROP (rgba(18,18,18,0.8) + blur(4px))            |
|                                                          |
|    +------------------------------------------+          |
|    |  Keyboard Shortcuts              [X]    |  <-- Header
|    +------------------------------------------+
|    |                                          |
|    |  TRANSPORT                               |  <-- Section
|    |  +-------+                               |
|    |  | Space | Play/Pause                    |  <-- Shortcut row
|    |  +-------+                               |
|    |                                          |
|    |  SELECTION                               |
|    |  +------+                                |
|    |  | Esc  | Clear selection                |
|    |  +------+                                |
|    |  +--------+ +------+                     |
|    |  | Delete | | Bksp | Delete steps        |
|    |  +--------+ +------+                     |
|    |                                          |
|    |  EDITING                                 |
|    |  +------+ +-------+ +---+                |
|    |  | Cmd  | + Shift | + M | Unmute all     |
|    |  +------+ +-------+ +---+                |
|    |                                          |
|    |  GENERAL                                 |
|    |  +---+                                   |
|    |  | ? | Show shortcuts                    |
|    |  +---+                                   |
|    |                                          |
|    +------------------------------------------+
|    |  Press ? or Escape to close             |  <-- Footer
|    +------------------------------------------+
|                                                          |
+----------------------------------------------------------+

BEHAVIOR:
- Open: Press ? (desktop only, not on mobile)
- Close: Press ?, Escape, click backdrop, or click X
- Non-blocking: Space still plays/pauses while panel is open
- Focus trap: Tab/Shift+Tab cycles within panel
- Mobile: Panel is not rendered (no way to trigger or dismiss)
```

## Architecture

### Centralized Keyboard Handling

All keyboard shortcuts flow through the `useKeyboard` hook with a handler map pattern:

```
User presses key
       |
       v
window.keydown event
       |
       v
useKeyboard hook
       |
       +-- HANDLER_MAP lookup (order matters)
       |       |
       |       +-- Match key pattern
       |       +-- Check skipInTextInput flag
       |       +-- Check skipOnMobile flag
       |       +-- Check requireNoModifiers flag
       |       +-- Call handler if all checks pass
       |
       +-- onCustom fallback for unmatched keys
```

### Handler Map

```typescript
const HANDLER_MAP: HandlerMapEntry[] = [
  // Order matters: first match wins
  [(e) => e.key === 'Escape', { handler: 'onEscape', skipInTextInput: false }],
  [(e) => (e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'm', { handler: 'onUnmuteAll' }],
  [(e) => e.key === '?' || (e.shiftKey && e.key === '/'), { handler: 'onHelp', skipOnMobile: true }],
  [(e) => e.key === ' ' || e.code === 'Space', { handler: 'onSpace' }],
  // ... more handlers
];
```

### Conflict Detection

The `isTextEditingContext()` utility checks:
- `<input>` elements (text types)
- `<textarea>` elements
- `contenteditable` elements
- `[role="textbox"]` elements

When the user is in a text editing context, shortcuts are skipped (except Escape).

### Hybrid Device Detection

The `isMobileDevice()` function handles hybrid devices:
- iPad with Magic Keyboard: has fine pointer -> NOT mobile
- Chromebook: has fine pointer -> NOT mobile
- Surface with keyboard: has fine pointer -> NOT mobile
- Phone/tablet without keyboard: only coarse pointer -> IS mobile

Key insight: if a device has a fine pointer (mouse/trackpad), it almost certainly has a keyboard.

### FocusState

```typescript
interface FocusState {
  context: 'track' | 'step' | 'none';
  trackId?: string;
  stepIndex?: number;
}
```

Focus state enables keyboard navigation:
- Arrow Up/Down: Move focus between tracks
- Arrow Left/Right: Move focus between steps within a track
- M: Mute the focused track
- S: Solo the focused track

Focus is distinct from selection:
- **Focus**: Single item for keyboard navigation (like cursor)
- **Selection**: Multiple items for batch operations (like text selection)

## Files

| File | Purpose |
|------|---------|
| `src/hooks/useKeyboard.ts` | Centralized keyboard handling hook with handler map |
| `src/hooks/useKeyboard.test.ts` | 41 unit tests for the hook |
| `src/utils/keyboard.ts` | Conflict detection, shortcuts data, mobile detection |
| `src/components/KeyboardShortcutsPanel/` | Help panel component |
| `src/components/KeyboardShortcutsPanel/KeyboardShortcutsPanel.test.tsx` | 33 component tests |
| `src/types.ts` | FocusState interface |
| `src/state/grid.tsx` | Focus actions in reducer |
| `e2e/keyboard.spec.ts` | 7 E2E tests for help panel |

## Test Coverage

### Unit Tests (useKeyboard.test.ts)
- UK-001: Handler invocation (15 tests)
- UK-002: Event listener lifecycle (5 tests)
- UK-003: Options flags (5 tests)
- UK-004: Text input conflicts (5 tests)
- UK-005: Mobile device detection (2 tests)
- UK-006: Modifier keys (5 tests)
- UK-007: preventDefault behavior (4 tests)

### Component Tests (KeyboardShortcutsPanel.test.tsx)
- KSP-001: Rendering (7 tests)
- KSP-002: Close functionality (7 tests)
- KSP-003: Focus management (3 tests)
- KSP-004: Content (7 tests)
- KSP-005: Accessibility (7 tests)
- KSP-006: Animation & styling (2 tests)

### E2E Tests (keyboard.spec.ts)
- ? key opens help panel
- Help panel closes with Escape
- Help panel closes with ? (toggle)
- Help panel closes with backdrop click
- Help panel closes with X button
- Space works while panel open (non-blocking)
- Accessibility attributes

## Implementation Notes

1. **Handler Map Pattern**: Cleaner than if/else chains, easier to add new shortcuts
2. **Memoized Mobile Detection**: Result cached in ref to avoid repeated media queries
3. **Focus Trap**: Tab/Shift+Tab cycles within panel for accessibility
4. **Non-blocking Panel**: Space continues to work while help panel is open
5. **Glassmorphism**: Uses CSS variables with fallbacks for theming
6. **Ref-based Handlers**: Prevents event listener re-registration on props change
7. **Shortcut Type Separation**: Mouse-based shortcuts excluded from help panel
