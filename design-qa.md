# Stack B Option 1 design QA

## Comparison target

- Source visual truth: `audit/css-consistency/stack-b-evidence/reference/option-1-tonal-selection.png`
- Implementation screenshot: `audit/css-consistency/stack-b-evidence/review/after/catalogue--step-count-open.png`
- Combined comparison: `audit/css-consistency/stack-b-evidence/qa/option-1-source-vs-implementation.png`
- State: step-count menu open with `16 / 1 bar` selected
- Implementation CSS viewport: 1280 x 800 at device scale factor 1
- Source pixels: 1028 x 1530, normalized to 305 x 454 for comparison
- Implementation pixels: 305 x 454 focused review crop from the 1280 x 800 capture

The source is an approved visual direction rather than a pixel-accurate layout
specification. Existing Keyboardia typography, content, DOM, geometry, and
interaction behavior remain authoritative where the mock differs.

## Findings

No actionable P0, P1, or P2 mismatches remain.

- Fonts and typography: production system typography, weights, line heights,
  labels, and numeric alignment are unchanged. Their hierarchy matches the
  source direction.
- Spacing and layout rhythm: trigger, row, menu, and hit-area rectangles remain
  exact relative to the merge base. The selected fill covers the complete row
  without adding an inset rail or nested container.
- Colors and visual tokens: the selected row is a neutral graphite gradient
  (`#3a3a41` to `#323238`, `#35353b` fallback). Orange is confined to the
  existing check and open-trigger affordance. The menu shadow is compact
  (`0 4px 10px rgba(0,0,0,.35)`) instead of a wide diffuse halo.
- Image quality and asset fidelity: this surface has no product imagery. The
  existing Lucide check remains sharp and aligned; no substitute asset or CSS
  drawing was introduced.
- Copy and content: production labels and values are unchanged.
- Behavior and accessibility: the visible accessibility tree, keyboard/touch
  behavior, focus recovery, event payloads, and target rectangles remain exact.
  The selected menu item retains both a tonal surface and a non-colour check.
- Responsiveness: in-app checks at 375 x 812, 480 x 320, 844 x 390, 768 x 1024,
  and 769 x 1024 found one visible selected item, the same selected background,
  and no horizontal overflow. Production portrait and both landscape modes
  remain pixel-identical because they do not expose this dropdown family.

## Full-view comparison evidence

`audit/css-consistency/stack-b-evidence/qa/option-1-source-vs-implementation.png`
places the normalized source on the left and the implementation on the right.
It confirms the intended neutral selected row, orange check, layered dark menu,
crisp edge, and restrained depth.

## Focused-region comparison evidence

The implementation screenshot is already a focused crop around both grouped
triggers, the open menu, selected row, and surrounding collision-canary content.
No smaller crop is required to judge typography, check alignment, row fill, or
shadow extent.

## Browser verification

- Local implementation: `http://127.0.0.1:4174/stack-a.html?story=dropdowns`
- Primary interaction tested: open the step-count popup and inspect the chosen
  item, menu geometry, overflow, and accessibility state.
- Selected item count: 1
- Selected background: `rgb(53, 53, 59)` plus the approved vertical gradient
- Check color: `rgb(240, 112, 72)`
- Console errors or warnings: none

## Comparison history

1. The rejected candidate used an orange-tinted row, a 3px leading marker, and
   a `0 14px 32px` menu shadow.
2. The implementation replaces that treatment with the selected Option 1
   neutral tonal row and orange check, and reduces the shadow to `0 4px 10px`.
3. The post-fix combined comparison and five responsive in-app checks found no
   remaining P0/P1/P2 issue.

## Implementation checklist

- [x] Match Option 1's selected-row hierarchy.
- [x] Remove the leading accent marker and orange row tint.
- [x] Replace the wide diffuse menu shadow with compact depth.
- [x] Keep step-count and transpose selected states identical.
- [x] Preserve geometry, behavior, accessibility, and reduced motion.
- [x] Verify desktop, portrait, compact/wide landscape, and 768/769 boundaries.

## Follow-up polish

None required for this approved direction.

final result: passed
