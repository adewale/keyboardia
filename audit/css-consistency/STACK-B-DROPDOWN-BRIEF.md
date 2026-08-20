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
   inset highlight, and compact elevation.
6. Give hovered options a tactile gradient and selected options a quiet neutral
   tonal fill. Retain the orange check as the semantic selection indicator;
   do not add a tinted row, leading rail, or other decorative marker.
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

## Selection-state consistency

- A chosen item in a single-choice menu uses two cues: a neutral tonal row and
  an orange check. Step-count and transpose share the same rule through
  `Dropdown.css`; neither component may introduce its own selected treatment.
- Blue outlines remain reserved for selecting sequencer objects for editing.
- Feature-coloured filled controls remain reserved for modes and on/off states.
- Orange trigger treatment means the popup is open, not that its current value
  is selected. The check inside the menu carries that meaning.
- The project-wide taxonomy also classifies `aria-current` chooser items,
  sequencer-object selection, modes, binary actions, playback, pagination, and
  native selects. This pilot changes and mechanically enforces only the shared
  custom single-choice popup row.

Worst-stop measured contrast for the candidate treatment is 10.88:1 for
primary menu text, 7.28:1 for secondary option labels, 6.03:1 for category
labels, 4.56:1 for orange open-trigger text, 5.29:1 for the information-blue
focus outline against the adjacent dark surface, and 3.82:1 for the orange
selected check against the lightest selected-row gradient stop.

## Evidence and approval

Same-process Chromium comparison on GitHub Actions Linux is the machine pixel
authority. The committed Chromium review images are provenance-bound human
evidence, not cross-platform pixel baselines. Emulated-touch WebKit proves
touch behavior, not pixels. The PR must include named base/head images for
every dropdown state in the merge-base-owned catalogue and production-build
canaries for desktop, portrait, 480×320 and 667×375 landscape, 844×390 wide
landscape, 1024×768 tablet landscape, and the 768/769 boundary.

Approval is valid only for the exact merge base and approved source revision
recorded in every receipt. The following commit may contain only the generated
evidence package; CI rejects any product, harness, workflow, or documentation
drift after the approved source revision. Moving the merge base expires the
images. The PR remains a draft until the maintainer approves the before/after
evidence and records a stop, revise, or continue decision for any later Stack B
surface.
