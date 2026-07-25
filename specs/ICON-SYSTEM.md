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

Two things about the direct ESM paths are easy to get wrong later:

- **The payoff is build traversal, not bundle size.** Measured on the same
  commit, the barrel form transforms 2,981 modules and the direct form 1,255,
  but the emitted output is the same to within a rounding error (146.53 vs
  146.54 KB gzip on the main chunk). Rewrite to the barrel and builds get
  slower; do not expect bytes back either way.
- **The paths resolve only because `lucide-react` ships no `exports` map.** If
  a future version adds one — routine package hardening — every path in the
  barrel breaks at build time. This is why the dependency is pinned to an exact
  version rather than a range, and why `src/icons/index.test.tsx` renders every
  export: a broken path fails the unit suite rather than reaching a deploy.

Cross-surface interaction feedback lives in `app/src/motion.css`. Icon modules do
not own panel lifecycle or feature-specific state.

## Decision rules

1. Keep text when the word is clearer than the icon.
2. Icon-only controls require an `aria-label`; `title` is supplementary.
3. Icons beside visible text are decorative and use `aria-hidden="true"`.
4. Toggle labels remain stable while `aria-pressed` exposes state; disclosures use `aria-expanded`.
5. Destructive actions keep visible labels and a subtle but distinct resting treatment.
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
- Pattern rotate arrows; Invert, Reverse, and Mirror keep visible words
- The compact desktop velocity and pattern-tools marks; touch drawers use visible words
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

The polite live region is the persistent `.toast-container`, not the individual
toast. A live region inserted into the DOM together with its text is commonly
not announced at all; only urgent toasts carry `role="alert"`, which does
announce on insertion. Per-toast polite regions would also nest inside the
container region and risk duplicate announcements.

## Accessibility and focus

- Parameter-lock `Clear lock` remains visibly labeled; Pitch and Volume use
  associated labels, and Tie exposes visible text plus `aria-pressed`.
- Closing the editor from a focused internal control restores focus to the
  invoking step. Clicking elsewhere does not steal focus back. Toasts follow
  the same ownership rule and clear restoration history when focus leaves.
- Portrait tap-anywhere playback is an exposed Play/Stop button with a visible
  focus ring; no pointer-focusable control is hidden with `aria-hidden`.
- Pitch, velocity, pattern, effects, track, and mobile edit disclosures expose
  their expanded/pressed state.
- Domain-specific pattern transformations retain visible Invert, Reverse, and
  Mirror words rather than relying on hover titles or private glyphs.
- `aria-controls` references an existing controlled region. Animated collapsed
  panels stay mounted but become both `inert` and `aria-hidden`; regions that
  unmount omit `aria-controls` while absent.
- Destructive actions keep a muted resting distinction rather than a hover-only
  one. The landscape drawer is a touch surface where `:hover` and
  `:focus-visible` never fire, so a hover-only treatment would leave Delete
  identical to the Clear button beside it.

## Validation

Required validation for changes to this system:

- Icon export/component tests
- Accessible-name and focus tests
- Landscape 44px target geometry test
- Standard and reduced-motion browser style tests
- Every test in the five-file `e2e/mock-compatible-files.txt` manifest is
  blocking for names, focus, disclosure, touch geometry, motion, portrait
  controls, and publication. CI asserts exact file membership and 65 ordinary
  passes with zero skipped, flaky, or unexpected results.
- Every remaining offline Chromium spec is also blocking and runs with zero
  retries. Collaboration then runs against a real Wrangler Worker; mock mode is
  never used as WebSocket or Durable Object evidence.
- Local macOS desktop, landscape, portrait, and interaction screenshots, plus
  two blocking Holby visual comparisons on pinned `macos-14`
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

Bundle measurement methodology, comparison SHA, and results belong in the PR
body so the evidence remains tied to its stated baseline.
