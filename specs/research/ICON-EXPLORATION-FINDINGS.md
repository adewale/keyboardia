# Icon exploration — surviving findings

An exploration of Keyboardia's icon vocabulary ran ahead of the work that became PR #62. **#62
shipped the icon system; [`specs/ICON-SYSTEM.md`](../ICON-SYSTEM.md) is authoritative and nothing
here overrides it.** The exploration's proposal, mockups and galleries have been discarded — they
described a migration that was not the one adopted, and keeping them invited misreading. This file
is what outlived them: one open gap, one retraction, and the reviewed geometry.

Full history is on the branch `claude/keyboardia-icon-replacement-4pdqvo` if the discarded material
is ever wanted.

## 1. The drag handle `⠿` was never decided

Re-scanning `app/src/components` against `main` (`b2ea754`) turns up 15 remaining glyph
occurrences. Most are not icon candidates — the `×` in `StepCountDropdown`'s `7×2` / `5×3` labels
and in `TrackRow`'s `harmonicity 1.5×` are multiplication signs and correctly stay text. The
parameter-lock badges (`⌒ ↑ ↓ − +`) and the `♪` marks are settled as text by the shipped spec.

One is neither:

| Mark | Site | |
|---|---|---|
| `⠿` | `TrackRow.tsx:600` | drag handle |

It appears in **none** of the shipped spec's lists — not the replacement table, not the "remains
text" list — and in none of the 23 exports in `app/src/icons/index.ts`. It was not decided either
way; it was missed. `GripVertical` covers it, so resolving it needs no custom drawing layer: one
barrel export, one glyph swap. **Done in PR #85.**

> **Correction.** An earlier version of this file also listed `⚙` (`TrackRow.tsx:707`,
> pattern-tools toggle) as undecided. That was a misreading: the shipped spec's "remains text or
> existing domain marks" list includes *"the compact desktop velocity and pattern-tools marks"* —
> which covers both `▎` and `⚙`. The gear is settled, and PR #85 leaves it alone.
>
> Separately worth raising, but not acted on: `⚙` is U+2699, an emoji-presentation codepoint that
> some platforms render in colour — the precise failure mode the icon system exists to prevent, and
> in tension with the spec's own first goal ("replace only platform-dependent glyphs whose SVG
> equivalent is materially clearer"). Reopening it is a decision for `specs/ICON-SYSTEM.md`, not a
> gap to fill quietly. Note also that Lucide's `Settings2` is a **sliders** icon, not a gear — the
> like-for-like replacement is `Settings`.

## 2. Retracted: the track-row density argument

The exploration argued for dropping text labels on density grounds, on the claim that the desktop
track row overflows at a 1280px viewport. **That claim is wrong and should not be refiled.**

The number reproduces — `.track-row` reports a `getBoundingClientRect().width` of 1354.4px at
1280px, with Copy 48.5 / Clear 55.1 / Delete 61.8 — but it describes nothing a user encounters.
Measured on `main` at 860, 950, 1024, 1100, 1280 and 1440px, the Delete button lands **72px inside
the right edge at every width**, `fullyVisible: true`, with `document.scrollWidth ===
document.clientWidth` throughout. The steps area flexes and absorbs the difference. The row was
never scrolling, so there is no "scrolling to fitting" improvement to win, and no layout bug to
file.

## 3. Archived: reviewed custom geometry

Twelve custom domain marks were drawn and reviewed before the shipped spec settled on "no custom
drawing layer." The code (`app/src/icons/custom.tsx`, `Icon.tsx`) has been removed — each mark
either duplicated a barrel icon, had no consumer, or targeted a site the spec keeps as text.

The geometry is recorded here because it was the reviewed part and existed nowhere else. All on the
Lucide grid: 24×24, 2px centered `currentColor` stroke, round caps/joins, ≥1px padding. Filled
transport marks were a deliberate exception — OP-Z transport buttons read as solid.

| Mark | Geometry | Decision |
|---|---|---|
| `PlayFilled` | `<path d="M8.5 5.5 L8.5 18.5 L19 12 Z" strokeLinejoin="round"/>` | **+1px optical nudge** so the centroid lands on x=12 in a round button |
| `StopFilled` | `<rect x="6" y="6" width="12" height="12" rx="2"/>` | 2px radius (≥8px shape) |
| `PauseFilled` | `<rect x="6.5" y="5" width="4" height="14" rx="1"/>` ×2, second at `x="13.5"` | 1px radius (<8px) |
| `RecordFilled` | `<circle cx="12" cy="12" r="6"/>` | |
| `TrackModeDrum` | `<circle cx="12" cy="12" r="9.5"/>` + filled `<circle cx="12" cy="12" r="2.5"/>` | **ring r9.5** over a tighter ring — reads as a drum pad |
| `TrackModeChromatic` | `<rect x="3" y="5" width="18" height="14" rx="2"/>` + filled sharps `x="8"` / `x="13.4"`, `width="2.6" height="8" rx="1"` | **simplified** — dividers dropped, they muddied at 12–16px |
| `Tie` | `<path d="M4 16 Q12 5 20 16"/>` | **deep arch** over shallow — reads as a slur, not an underline |
| `PitchUp` | `<path d="M12 19 L12 6 M6.5 11 L12 5.5 L17.5 11"/>` | stroke **2.25px** to hold at 12px badge size |
| `PitchDown` | `<path d="M12 5 L12 18 M6.5 13 L12 18.5 L17.5 13"/>` | same |
| `PatternInvert` | `<rect x="4" y="4" width="16" height="16" rx="2"/>` + filled right half | |
| `VelocityBars` | lines at `x=6,12,18`, tops `y=15,9,5`, baseline `y=19` | |
| `StepPads` | 2×2 of `7×7 rx="1"` at `x,y ∈ {4,13}`, diagonal pair filled | |

Reopen the decision in [`specs/ICON-SYSTEM.md`](../ICON-SYSTEM.md) before using any of these; they
are a starting point, not an approved direction.

## 4. Motion

See [`specs/MOTION-OPPORTUNITIES.md`](../MOTION-OPPORTUNITIES.md). The copy→paste **20ms row
stagger** is the one recipe genuinely absent from `app/src/motion.css` and uncontradicted by any
shipped decision. The p-lock exit assumed a delayed-unmount hook the shipped spec explicitly
rejects and would need rewriting onto `animationend`; the record pulse depended on the removed
`RecordFilled` mark.
