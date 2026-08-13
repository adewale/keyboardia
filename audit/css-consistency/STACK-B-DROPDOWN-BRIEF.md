# Stack B dropdown visual pilot

## Approval target

Make the step-count and transpose controls read as one deliberate component
family: compact dark instrument controls with clearer depth, consistent
disclosure emphasis, stronger focus visibility, and more legible menu states.
The existing Keyboardia dark palette and orange accent are the product source
of truth. The Claude artifact is an influence for tactile depth and hierarchy,
not a pixel target.

## Intended changes

1. Give closed triggers a restrained vertical gradient, inset highlight,
   visible edge, compact shadow, and softer 7px corners.
2. Use a brighter variant of that treatment on hover.
3. Replace the inconsistent cyan open treatment with Keyboardia orange while
   retaining transpose blue when it is active and closed.
4. Add the documented information-blue `:focus-visible` outline.
5. Give portalled menus a layered dark surface, clearer edge, 10px corners,
   inset highlight, and stronger elevation.
6. Give hovered options a tactile gradient and selected options a restrained
   orange gradient with a leading inset marker.
7. Increase secondary option-label and selected-check contrast without changing
   typography or layout.
8. Keep the decoration responsive in desktop, component portrait, compact
   landscape, wide landscape, and the 768/769 boundary. Keep the production
   portrait and landscape surfaces pixel-identical: portrait hides editing,
   while landscape `TrackDrawer` uses a native select and transpose buttons
   rather than this dropdown family.

## Frozen behavior and geometry

- No TSX, DOM, role, accessible name, event payload, keyboard, touch, focus
  path, dismissal, portal, visibility, disclosure, persistence, breakpoint, or
  product-mode change.
- Trigger, option, category, menu, and hit-area rectangles must be identical at
  base and head.
- Animation names, durations, easing, and reduced-motion behavior remain exact.
- Pixels may change only within dropdown controls and their decorative shadow
  or focus halo.
- Decorative computed-style changes are limited to color, background,
  border-color, border-radius, box-shadow, opacity, and focus-outline
  properties on dropdown elements.

## Accessibility target

- Primary and secondary text retain at least 4.5:1 contrast on their resulting
  dark surfaces.
- Keyboard focus is visible with a 2px information-blue outline and 2px offset.
- Disabled controls keep their existing semantics and 0.5 opacity.
- The existing 36px triggers and option heights remain unchanged. They satisfy
  WCAG 2.2 Target Size (Minimum), while the separate 44px Keyboardia mobile
  aspiration remains a Stack C decision because enlarging hit areas changes
  behavior.
- Reduced motion continues to remove the menu entrance animation.

Measured contrast for the candidate treatment is 12.97:1 for primary menu
text, 8.38:1 for secondary option labels, 6.83:1 for category labels, 5.38:1
for orange open-trigger text, and 5.29:1 for the information-blue focus outline
against the adjacent dark surface.

## Evidence and approval

Chromium is the pixel authority. Emulated-touch WebKit proves touch behavior,
not pixels. The PR must include named base/head images for every dropdown state
in the merge-base-owned catalogue and production-build canaries for desktop,
portrait, compact landscape, wide landscape, and the 768/769 boundary.

Approval is valid only for the exact merge-base/head pair recorded in the
evidence receipt. Moving the merge base expires the images. The PR remains a
draft until the maintainer approves the before/after evidence and records a
stop, revise, or continue decision for any later Stack B surface.
