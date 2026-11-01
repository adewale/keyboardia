# Site-wide colour-role safety correction

This is a follow-up to the flattened Stack B dropdown candidate. Its base is
`8c0049109f5ee5de365eddcf8a0f64084e9817db`, the merge commit that landed the
exact Stack B evidence head `96d9a29cc9532a2aca33e5c6f5223e12e9d8bdf8`.
Stack B's source-bound evidence therefore remains unchanged and independently
reviewable.

## Why this follow-up exists

The final Stack B consistency audit found that the dropdowns had stopped using
a private material treatment, but the wider site still used colour tokens in
ways that were neither consistent nor reliably readable:

- `.38` neutral text was used for informative labels, values, placeholders,
  counts, and footer copy even though it measured only 3.24–3.57:1 on common
  dark surfaces.
- Raw feature hues doubled as borders, fills, decoration, and small text. Bass
  and Leads picker headings measured 3.07:1 and 3.30:1.
- Neutral white text was inherited by bright feature-filled controls. The
  landing CTA measured 3.54:1 at rest and 2.95:1 on hover.
- A parent `opacity: .7` on preview-unavailable instrument buttons reduced
  otherwise safe text to 3.60:1. Token-only calculations did not see it.

These were pre-existing product issues exposed by broadening the audit; they
were not caused by the flattened dropdown CSS. Reverting the dropdowns would
therefore hide the symptom without fixing the system.

## Root cause

We optimized one component before classifying the host product's colour roles.
The external comparator and the dropdown's internal states received more
weight than Keyboardia's established flat surfaces and site-wide text usage.
At the same time, generic names such as `--color-purple` and
`--color-text-dimmed` did not encode where they were safe to use. Scoped
screenshots proved local consistency, while the automated checks neither
forbade role mixing nor measured real rendered opacity.

The resulting process was backwards: choose a polished component treatment,
then try to reconcile it with the product. The forward process is: capture the
host product, classify semantic roles, enforce the roles, and only then use an
outside reference to challenge or refine the established system.

## Implemented rule

1. `.87` remains primary neutral text and `.60` remains informative secondary
   text. `.38` is reserved for disabled or decorative content.
2. Unsuffixed feature tokens own fills, borders, charts, and decoration.
   `-text` variants own normal-sized text on neutral surfaces.
3. Feature-filled controls use an explicit `--color-on-*` foreground selected
   for the actual fill; they do not inherit neutral site text.
4. Category labels use text-safe variants while their card borders and active
   fills retain the original category colours.
5. The preview-unavailable container no longer dims every instrument choice.
   Actual disabled controls retain their existing disabled opacity.

This preserves Keyboardia's hues and flat material grammar. It changes role,
not identity: decorative colour blocks retain their original RGB values while
small text becomes a lighter version of the same hue.

## Mechanical guardrails

- The CSS consistency check rejects raw feature/fill tokens in `color`
  declarations and rejects unclassified white/neutral text on feature fills.
- Unit tests assert every classified text token against the lightest shared
  neutral surface and every filled-control foreground against its fill.
- Playwright measures rendered landing and picker text, including ancestor
  opacity, at 1280×800 desktop, 375×812 portrait, and 844×390 landscape.
- Existing ARIA, event, focus, geometry, and non-approved computed styles stay
  exact. Changed pixels must remain inside the exact elements whose approved
  colour pair changed.
- The visual and harness exceptions activate only when the comparison base is
  the exact merged Stack B commit above. They expire automatically for later
  work.
- The style ablation proves each used exception is discriminating. A state may
  still be pixel-identical when its changed element is clipped or off-canvas;
  any raster change that does occur must remain inside an approved element.

## Measured result

| Element/state | Before | After |
| --- | ---: | ---: |
| Landing primary CTA, rest | 3.54:1 | 5.30:1 |
| Landing primary CTA, hover | 2.95:1 | 6.35:1 |
| Landing “Remix” text | 4.01:1 | 7.12:1 |
| Picker Bass heading | 3.07:1 | 5.45:1 |
| Picker Leads heading | 3.30:1 | 5.49:1 |
| Preview-unavailable instrument text | 3.60:1 | at least 5.66:1 |

All measured normal-sized text in the covered landing and picker states clears
WCAG 2.1 AA's 4.5:1 threshold. This is a focused colour-role correction, not a
claim of complete product conformance; live collaboration states, forced
colours, physical browser chrome, and every feature-filled state still require
their own proportional coverage when changed.

## Review evidence

The source-bound before/after images and their receipt are generated only after
the source commit is frozen. They cover landing and picker states at desktop,
portrait, and landscape sizes and are stored beside this file under
`evidence/`. The evidence harness neutralizes the decorative landing playhead
in both revisions, preventing its 300 ms demo timer and cell transition from
being misreported as a colour-role change.
