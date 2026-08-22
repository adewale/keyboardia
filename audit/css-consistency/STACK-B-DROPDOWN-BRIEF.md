# Stack B dropdown visual pilot

## Approval target

Make the step-count and transpose controls read as one deliberate component
family that belongs to Keyboardia's existing flat interface. Use the product's
established neutral surfaces and text hierarchy while retaining the stronger
accessible boundaries, disclosure emphasis, focus visibility, selection cue,
and focus-ownership repair established during the pilot.

## Intended changes

1. Give closed triggers the existing flat elevated surface, a visible edge, no
   inset or drop shadow, and a 6px base radius. Connected group corners remain
   owned by `TrackRow`.
2. Use the existing flat hover surface on hover.
3. Replace the inconsistent cyan open treatment with Keyboardia orange while
   retaining transpose blue when it is active and closed.
4. Keep the documented information-blue `:focus-visible` outline;
   focused-but-closed controls must not inherit the global orange focus halo.
5. Give portalled menus the existing flat elevated surface, a clearer edge,
   6px corners, no inset highlight, and the existing popup shadow.
6. Give hovered options the existing flat hover surface and selected options
   the existing flat active surface. Retain the orange check as the semantic
   selection indicator; do not add a tinted row, leading rail, or other
   decorative marker.
7. Use Keyboardia's existing `.87 / .60 / .38` neutral text hierarchy. Option
   labels use the shared `.60` muted tier; do not introduce a dropdown-only
   opacity tier. Preserve typography and layout.
8. Give the neutral control edge, elevated menu edge, and scrollbar thumb a
   deliberate three-step line hierarchy. Each boundary must independently
   meet WCAG 1.4.11's 3:1 non-text contrast requirement against its adjacent
   surface; the scrollbar is therefore slightly stronger than the menu edge.
9. Keep the decoration responsive in desktop, component portrait, compact
   landscape, wide landscape, and the 768/769 boundary. Keep the production
   portrait and landscape surfaces pixel-identical: portrait hides editing,
   while landscape `TrackDrawer` uses a native select and transpose buttons
   rather than this dropdown family.
10. Repair focus recovery: choosing an option or pressing Escape from an option
    returns focus to the trigger that opened the popup. Outside clicks retain
    normal browser focus on the clicked target.

## Preserved contracts and scoped behavior repair

- No TSX, DOM, role, accessible name, event payload, portal, visibility,
  disclosure, persistence, breakpoint, or product-mode change.
- The only intentional behavior change is deterministic focus restoration to
  the owning trigger after option selection, whether activated by keyboard,
  pointer, or touch, and after Escape. Menu dismissal and selection payloads
  remain unchanged; direct Playwright assertions cover both dropdowns, touch
  selection, and Escape from a focused option. Outside clicks preserve focus
  on the clicked target.
- Trigger, option, category, menu, and hit-area rectangles must be identical at
  base and head.
- Animation names, durations, easing, and reduced-motion behavior remain exact.
- Pixels may change only within dropdown controls, the menu's popup shadow,
  or focus halo.
- Decorative computed-style changes are limited to color, background,
  border-color, border-radius, box-shadow, opacity, and focus-outline
  properties on dropdown elements.

## Accessibility target

- Primary and secondary text retain at least 4.5:1 contrast on their resulting
  dark surfaces. Active transpose blue uses a dropdown-specific lighter blue
  so it also clears 4.5:1 in both closed and hover states.
- The closed neutral control edge, open menu edge, and menu scrollbar thumb
  each retain at least 3:1 contrast against the surface they identify, measured
  independently under WCAG 1.4.11.
- Keyboard focus is visible with a 2px information-blue outline: 2px outside
  triggers and inset on menu options so it is not clipped by menu overflow.
- Focused triggers remain flat and shadow-free; orange remains reserved for
  hover/open borders and disclosure rather than a second focus ring.
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

Measured contrast for the flat candidate is 11.22:1 for primary menu text,
6.16:1 for secondary option and category labels, 5.38:1 for orange open-trigger
text, and 5.29:1 for the information-blue focus outline against the adjacent
dark surface. The option-focus outline is at least 3.09:1 across menu, hover,
and selected surfaces; the orange selected check is 3.30:1 against the selected
surface. The neutral control edge is 3.21:1 against the card; the menu edge is
3.11:1 against its own surface and an elevated neighbour and 3.61:1 against the
card; and the scrollbar thumb is 3.29:1 against the menu. Active transpose text
is 5.48:1 on hover and 6.23:1 when closed.

## Evidence and approval

Same-process Chromium comparison on GitHub Actions Linux is the machine pixel
authority. The committed Chromium review images are provenance-bound human
evidence, not cross-platform pixel baselines. Emulated-touch WebKit proves
touch behavior, not pixels. The PR must include named base/head images for
every dropdown state in the merge-base-owned catalogue and production-build
canaries for desktop, portrait, 480×320 and 667×375 landscape, 844×390 wide
landscape, 1024×768 tablet landscape, and the 768/769 boundary.

Approval is valid only for the exact merge base and candidate source revision
recorded in every receipt. The following commit may contain only the generated
evidence package; CI rejects any product, harness, workflow, or documentation
drift after that candidate source. Moving the merge base expires the images.
The maintainer approved the Option 1 selection direction, then requested this
site-consistent flattening while explicitly retaining every accessibility and
behavioral repair. The regenerated bound before/after evidence still requires
review before merge. The stop decision applies to any additional Stack B
surface.
