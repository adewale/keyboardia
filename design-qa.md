# Stack B flat dropdown design QA

## Comparison target

- Historical selection-cue reference:
  `audit/css-consistency/stack-b-evidence/reference/option-1-tonal-selection.png`
- Current implementation screenshot:
  `audit/css-consistency/stack-b-evidence/review/after/catalogue--step-count-open.png`
- Combined comparison:
  `audit/css-consistency/stack-b-evidence/qa/option-1-source-vs-implementation.png`
- Site-wide pre/post audits:
  `audit/css-consistency/site-wide-audit/2026-08-22/README.md` and
  `audit/css-consistency/site-wide-audit/2026-08-22-flat/README.md`
- State: step-count menu open with `16 / 1 bar` selected
- CSS viewport: 1280 x 800 at device scale factor 1

The Option 1 bitmap is historical evidence for the approved selection cue:
a quiet neutral row plus an orange check, without an orange banner or leading
marker. It is not the material source of truth. The maintainer subsequently
requested site-consistent flat surfaces while retaining every accessibility
and behavioural repair. Keyboardia's production tokens, typography, content,
DOM, geometry, and interaction contracts remain authoritative.

## Findings

No Stack B P0, P1, or P2 mismatch remains in the candidate implementation.

- Typography: primary menu values use the global `.87` tier; secondary labels,
  categories, and inactive values reuse the global `.60` muted tier. The
  dropdowns no longer introduce a private `.68` neutral tier.
- Geometry: trigger, row, menu, and hit-area rectangles remain exact relative
  to the merge base. Base trigger and menu radii are 6px; connected group
  corners remain owned by `TrackRow`.
- Materials: closed triggers and menus reuse the flat `#2a2a2a` elevated
  surface. Hover uses flat `#333`; selection uses flat `#444`. Triggers have no
  shadow. Menus reuse the Invite popup's single external
  `0 4px 12px rgba(0,0,0,.3)` shadow and have no gradient or inset highlight.
- Semantic colour: orange is confined to hover/open disclosure and the selected
  check. Information blue identifies focus. Active Transpose retains the
  feature-specific `#5eb3ea` text colour. Step and Transpose selection recipes
  are identical.
- Contrast: primary text is at least 7.88:1 and muted text at least 4.70:1
  across menu, hover, and selected surfaces. Open orange text is 5.38:1. Active
  Transpose text is 6.23:1 closed and 5.48:1 hovered.
- Focus and lines: trigger focus is one information-blue outside outline;
  option focus is an inset blue outline. Neither has an orange halo. Control
  edge (`#6c6c76`, 3.21:1), menu edge (`#74747f`, 3.11:1 against its fill and
  3.61:1 against the card), and scrollbar (`#787883`, 3.29:1) independently
  clear WCAG 1.4.11. Option focus remains at least 3.09:1 and the selected
  check 3.30:1.
- Behaviour and accessibility: visible accessibility trees, event payloads,
  and target rectangles remain exact. Selection by pointer or touch and Escape
  return focus to the owning trigger; native keyboard activation shares the
  same selection path. Outside clicks preserve focus on the clicked target.
  Direct Playwright assertions cover both controls and both touch selections.
- Motion: names, durations, easing, delay, iteration count, and reduced-motion
  removal are captured in the computed-style ratchet.
- Responsiveness: evidence covers 375 x 812, 480 x 320, 667 x 375, 844 x 390,
  768 x 1024, 769 x 1024, and 1024 x 768. Production portrait and landscape
  modes that omit this family remain pixel-identical.

The repeat site-wide audit also found pre-existing small-text contrast failures
outside Stack B, including unsafe uses of the `.38` dimmed tier and raw feature
colours. They are global palette-usage debt, not regressions from this PR. The
forward fix is to classify tokens by permitted role and add text-safe variants,
not to weaken the dropdown boundaries or reintroduce a private text tier.

## Evidence review

The five contact sheets cover all 29 named pairs. The dedicated selected-option
sheet keeps the flat selected row, check alignment, line hierarchy, and popup
shadow legible when GitHub scales the exhaustive sheets. Every receipt binds
the merge base to one immutable candidate source, and the following commit is
evidence-only.

The combined Option 1 comparison remains useful only for the selection grammar.
Material consistency is established by the fresh site-wide screenshots and
computed recipes: the Stack B menu and Invite popup now share flat `#2a2a2a`
fill, 6px radius, primary text, and the same external shadow. Stack B's edge is
intentionally stronger because the legacy Invite edge does not independently
meet the new 3:1 boundary requirement.

## Comparison history

1. The rejected candidate used an orange-tinted row, a 3px leading marker, and
   a wide `0 14px 32px` menu shadow.
2. Option 1 replaced that with a neutral row and orange check.
3. The first Stack B implementation added tactile gradients, inset highlights,
   a private `.68` text tier, 7/10px radii, and trigger shadow. It passed scoped
   contrast but diverged from the site's flat material and text grammar.
4. The current candidate flattens those surfaces and reuses the global `.60`
   muted tier while preserving the stronger boundaries, semantic colours,
   selected check, visible focus, and focus-ownership repair.

## Implementation checklist

- [x] Keep the approved Option 1 selected-row cue without a leading marker.
- [x] Reuse site-wide flat surface and neutral text tokens.
- [x] Match the existing popup radius and shadow; remove trigger shadow.
- [x] Keep Step and Transpose selected states identical.
- [x] Keep focused controls free of an orange halo.
- [x] Give every neutral control/menu boundary independent 3:1 contrast.
- [x] Restore trigger focus after selection and Escape; preserve outside focus.
- [x] Preserve geometry, ARIA, event payloads, motion, and reduced motion.
- [x] Verify desktop, portrait, compact/narrow/wide landscape, tablet landscape,
      and 768/769 boundaries.
- [x] Bind images and receipts to an immutable source revision.
- [ ] Obtain renewed maintainer approval of the final flattened evidence.

Implementation QA result: passed. Visual approval: pending.
