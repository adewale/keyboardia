# Keyboardia icon and interaction system

Status: implemented by the accessible icon-system PR.

## Goals

- Replace only platform-dependent glyphs whose SVG equivalent is materially clearer.
- Preserve visible words for unfamiliar, destructive, or product-specific actions.
- Keep the system small enough to audit and remove.
- Treat accessibility, touch targets, reduced motion, and visual evidence as part of the feature.

## Dependency and architecture

Keyboardia uses `lucide-react` through the semantic barrel at
`app/src/icons/index.ts`. The barrel exports only icons used by production.
There is no custom drawing layer, animated icon API, or runtime icon registry.
The pinned Lucide version is imported through direct ESM icon paths so Vite
visits only the icons Keyboardia uses; the ambient declaration beside the barrel
provides types for those package paths.

Cross-surface interaction feedback lives in `app/src/motion.css`. Icon modules do
not own panel lifecycle or feature-specific state.

## Decision rules

1. Keep text when the word is clearer than the icon.
2. Icon-only controls require an `aria-label`; `title` is supplementary.
3. Icons beside visible text are decorative and use `aria-hidden="true"`.
4. Toggle and disclosure controls expose `aria-pressed` or `aria-expanded`.
5. Destructive actions keep visible labels and neutral resting treatment.
6. Touch controls use real, non-overlapping layout boxes of at least 44px where
   the landscape layout is explicitly touch-oriented.

## Approved replacements and label augmentation

| Existing glyph or label | Meaning | Replacement |
|---|---|---|
| `✕`, `×`, one-off X SVG | Close/dismiss | Lucide `X` |
| `‹`, `›`, `▲`, `▼` | Disclosure/navigation | Lucide chevrons |
| `▶`, `■` | Play/stop | Lucide `Play`/`Square`, filled in transport controls |
| `○`, `◉` | Scale unlocked/locked | Lucide `LockOpen`/`Lock` |
| `⊞`, `↗`, `✓` | QR/share/complete | Lucide `QrCode`/`Share2`/`Check` |
| `⚠`, `🔊` | Warning/audio warning | Lucide `TriangleAlert`/`Volume2` |
| `⊗`, `●` beside status text | Effects bypassed/active | Lucide `PowerOff`/`Power` plus the existing label |
| `→`, `←` in player toasts | Player joined/left | Lucide `UserPlus`/`UserMinus` |
| `↻` beside Rotate to edit | Device rotation hint | Lucide `RotateCw` plus the existing label |
| `+`, `−` in icon controls | Increment/decrement | Lucide `Plus`/`Minus` |
| `✂` beside Auto-Slice | Slice | Lucide `Scissors` plus the existing label |
| Copy Link, Show QR Code | Share-menu recognition | Lucide `Link`/`QrCode` plus the existing labels |

The following remain text or existing domain marks because no replacement is a
clear enough improvement:

- Copy, Paste, Clear, Delete
- FX, Mixer, Pitch
- Mute and Solo (`M`, `S`)
- Pattern rotate, invert, reverse, and smart mirror
- Velocity and pattern-tools toggles
- Piano/chromatic track marks and parameter-lock badges

## Motion

`app/src/motion.css` provides short entry and press feedback. It does not delay
unmounting or retain invisible controls. Under `prefers-reduced-motion: reduce`,
shared transitions and animations are disabled rather than replaced with timed
fades.

Toast removal is synchronized with `animationend`; reduced-motion exit uses a
1ms opacity-only animation so cleanup remains deterministic without visible
movement. A 350ms cleanup fallback prevents a stuck toast if a browser suppresses
or interrupts animation events. Actionable URL toasts use sibling Copy and
Dismiss buttons, pause while focused or hovered, and announce copy completion.

## Accessibility and focus

- Parameter-lock `Clear lock` remains visibly labeled; Pitch and Volume use
  associated labels, and Tie exposes visible text plus `aria-pressed`.
- Closing the editor from a focused internal control restores focus to the
  invoking step. Clicking elsewhere does not steal focus back.
- Pitch, velocity, pattern, effects, track, and mobile edit disclosures expose
  their expanded/pressed state.
- Pattern transformation controls have explicit accessible names even where the
  compact visual mark remains unchanged.

## Validation

Required validation for changes to this system:

- Icon export/component tests
- Accessible-name and focus tests
- Landscape 44px target geometry test
- Standard and reduced-motion browser style tests
- A blocking mock-compatible CI subset for names, focus, disclosure, touch
  geometry, motion, portrait controls, and example publication
- Local macOS desktop, landscape, portrait, populated-session, and interaction
  screenshots
- Full unit, integration, build, lint, validation, and Chromium E2E suites

## Review evidence

The checked-in screenshots use the same populated session at fixed viewports.
Local macOS portrait and landscape baselines also load the exact checked-in
Holby artifact through the seeded mock UUID before asserting all ten tracks:
`holby-populated-{portrait,landscape}-chromium-darwin.png`. These baselines test
the web UI on the development platform; they do not add or remove runtime OS
support for end users.

| Surface | Before | After |
|---|---|---|
| Desktop | `docs/images/accessibility-icon-system/before-desktop-session.png` | `docs/images/accessibility-icon-system/after-desktop-session.png` |
| Landscape drawer | `docs/images/accessibility-icon-system/before-landscape-drawer.png` | `docs/images/accessibility-icon-system/after-landscape-drawer.png` |
| Portrait | `docs/images/accessibility-icon-system/before-portrait-session.png` | `docs/images/accessibility-icon-system/after-portrait-session.png` |

Current measured bundle data belongs in the PR body so it stays tied to the
exact commit under review.
