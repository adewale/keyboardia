# Mobile UI Lessons for Desktop Backport

Lessons learned from implementing the Swim Lanes mobile UI that could improve the desktop experience.

## 1. Inline Drawers > Modal Dialogs

**Mobile Pattern:** Tap track name → drawer expands below the track row
**Current Desktop:** Shift+Click → inline p-lock panel appears

**Lesson:** Inline expansion keeps context better than modals or bottom sheets.
**Desktop Opportunity:** Extend the inline drawer pattern to ALL track controls. When user clicks track name on desktop, expand the same drawer with transpose/steps/actions. This creates a unified interaction model across platforms.

```
Desktop before:  [M] Kick  [-][0][+] [16][32][64] ████████████  [Copy][Clear][Del]
Desktop after:   [M] Kick ▼ ████████████████████████████████
                    └── Transpose: [-] 0 [+]  |  Steps: 16 32 64  |  Copy Clear Delete
```

## 2. Drag-to-Adjust Values (TE Knob Style)

**Mobile Pattern:** Drag up/down on tempo/swing values to adjust
**Current Desktop:** +/- buttons with sliders

**Lesson:** Direct manipulation feels more musical than button clicks.
**Desktop Opportunity:** Make tempo/swing values draggable on desktop too. Mouse drag up = increase, drag down = decrease. Keep +/- buttons for precision.

## 3. Long-Press Discoverable Actions

**Mobile Pattern:** Long-press step → p-lock editor
**Current Desktop:** Shift+Click (hidden affordance)

**Lesson:** Long-press is more discoverable than modifier keys.
**Desktop Opportunity:** Already backported! The `useLongPress` hook works with mouse-hold on desktop too. Tooltip now says "Hold or Shift+Click to edit" making it discoverable.

## 4. Tap-to-Toggle Track Name

**Mobile Pattern:** Tap track name to expand/collapse drawer
**Current Desktop:** Track name is not interactive

**Lesson:** Make the track name a control, not just a label.
**Desktop Opportunity:** Make track name clickable on desktop to toggle inline drawer. Provides quick access to settings without hunting for small buttons.

## 5. Horizontal Scroll for Steps

**Mobile Pattern:** Steps scroll horizontally within the track row
**Current Desktop:** All steps visible, panel scrolls if needed

**Lesson:** Horizontal scroll per-track allows each track to be independently navigated.
**Desktop Opportunity:** For 64-step patterns, allow per-track horizontal scroll. User can align different tracks at different positions to compare polyrhythms.

## 6. Visual Hierarchy Through Spacing

**Mobile Pattern:** Larger touch targets (44px), more spacing
**Current Desktop:** Dense 36px cells

**Lesson:** More breathing room improves focus and reduces errors.
**Desktop Opportunity:** Consider a "comfortable" density mode for desktop that increases cell size to 44px. Better for mouse users and accessibility.

## 7. Clear Primary Action (FAB)

**Mobile Pattern:** Floating + button always visible
**Current Desktop:** Add track buried in sample picker dropdown

**Lesson:** Primary actions should be visually prominent.
**Desktop Opportunity:** Consider making "Add Track" a more prominent button, not hidden in dropdown. Or show empty track slot at bottom with "+" to add.

## Implementation Priority

| Lesson | Effort | Impact | Priority |
|--------|--------|--------|----------|
| Tap track name to expand drawer | Low | High | 1 |
| Drag-to-adjust tempo/swing | Low | Medium | 2 |
| Long-press for p-lock | Done | High | ✓ |
| Make track name clickable | Low | Medium | 3 |
| Per-track horizontal scroll | Medium | Low | 4 |
| Comfortable density mode | Low | Medium | 5 |
| Prominent Add Track | Low | Low | 6 |

## Code Artifacts Ready for Backport

1. `InlineDrawer` component - can be used on desktop
2. `useLongPress` hook - already works on desktop
3. `TransportBar` drag interaction - pattern can be added to desktop Transport
4. Track name onClick handler - already in place, just needs desktop CSS
