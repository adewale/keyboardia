# Keyboardia — Motion Opportunities

Applying Emil Kowalski's [`find-animation-opportunities`](https://github.com/emilkowalski/skills)
skill to Keyboardia. The skill is a **filter as much as a finder** — its thesis is "the best
animation is no animation," and it caps output at ≤7 suggestions that each survive a four-question
gate. Originally a read-only audit; see **Implementation status** below for where each
opportunity stands today (several landed via PR #62, the rest survive here as measured recipes).

## The gate every candidate must pass

1. **Frequency** — reject keyboard-initiated / 100+-per-session actions; rare/first-time moments get
   the delight budget; frequent elements get *imperceptible* motion or none.
2. **Purpose** — must be named: *Feedback · Spatial Consistency · State Indication · Preventing
   Jarring Change · Explanation · Delight*. "Looks cool" disqualifies.
3. **Speed** — must fit budgets (press 100–160ms; panels/modals 200–500ms). Slow/showy fails.
4. **Function** — decoration on dense, functional UI hinders; motion must serve clarity.

Keyboardia is a **dense, real-time, high-frequency instrument** — you click hundreds of steps per
session and drive playback from the keyboard. That pushes most of the UI into "imperceptible or
none," and concentrates the real wins in a handful of **state changes and transitions** — not in the
icons themselves.

## Motion tokens (shared — all suggestions pull from these)

```css
--ease-out:      cubic-bezier(0.16, 1, 0.3, 1);  /* enters, reveals */
--ease-in:       cubic-bezier(0.4, 0, 1, 1);      /* exits */
--ease-standard: cubic-bezier(0.2, 0, 0, 1);      /* icon crossfades (feel #12) */
--dur-press: 90ms;    /* :active feedback */
--dur-fast:  150ms;   /* toggles, chevrons */
--dur-panel: 240ms;   /* panels, editors, overlays */
--dur-out:   150ms;   /* toast/overlay exit */
--press-scale: 0.96;  /* exactly 0.96, never below 0.95 (feel #14) */
--stagger:    100ms;  /* between staggered enter chunks (feel #10) */
```
Reduced motion (`@media (prefers-reduced-motion: reduce)`): keep opacity/colour, **drop movement &
scale** — gentler, not zero. Hover-triggered motion gated behind
`@media (hover: hover) and (pointer: fine)` so touch never fires it.

**Design-engineering refinements** — from Emil Kowalski's `emil-design-eng` and Jakub Krehel's
[`make-interfaces-feel-better`](https://github.com/jakubkrehel/make-interfaces-feel-better) checklists,
pinning exact values for the recipes below:

- **Icon crossfade (feel #12)** — animate `opacity 0→1`, `scale 0.25→1`, `blur 4px→0` (not
  visibility-toggle). With Motion present: `type: "spring", duration: 0.3, bounce: 0`; CSS-only:
  cross-fade on `--ease-standard`. *(Supersedes the gallery's `scale 0.7→1, no blur`.)*
- **Scale-on-press (feel #14)** — interactive icon buttons press to **exactly `scale(0.96)`**
  (`--press-scale`), `--dur-press`. This is opportunity #5's precise value.
- **Stagger (feel #10)** — grouped enters (e.g. Copy→Paste targets) break into chunks with a
  `--stagger` (~100ms) delay; **exits stay subtle** — a small fixed `translateY`, not full height.
- **`transition: all` is banned (feel #15)** — every rule names its properties
  (`transition-property: transform, opacity, filter`).

## Implementation status

> **Scope note — shipped motion lives elsewhere.** The branch that implemented all of this
> wholesale was superseded by **PR #62**, now merged. The shipped motion layer is
> `app/src/motion.css`, described in [`specs/ICON-SYSTEM.md`](ICON-SYSTEM.md). The record below
> is the earlier verified implementation, annotated: *(shipped)* = adopted, in some form, on
> `main`; *(not shipped)* = absent from `main`.
>
> Two corrections against the merged system, which takes precedence:
>
> - **Delayed unmount is explicitly rejected.** The shipped spec states the motion layer "does
>   not delay unmounting or retain invisible controls," and synchronizes toast removal with
>   `animationend` plus a 350ms fallback. The p-lock exit recipe below is written around a
>   `useDelayedUnmount` hook; to be viable it must be rewritten onto `animationend`, matching
>   how toasts already work.
> - **The record pulse depends on a custom `RecordFilled` mark**, and the shipped system has no
>   custom drawing layer. It is not portable as written.
>
> The copy→paste **20ms row stagger** is the one item here that is simply absent from `main`
> (verified: no `nth-of-type` rule in `app/src/motion.css`) and not contradicted by any shipped
> decision.

**Reference implementation** — not in the tree. It lived in `src/icons/icons.css` on the
superseded branch (`claude/keyboardia-icon-replacement-4pdqvo`, commit `b0273be`); the shipped
equivalent is `app/src/motion.css`. Measurements below were taken against that reference:
- **#1 Panel reveal — already satisfied by the app** (correction): FX, Mixer, Pitch and
  pattern-tools panels stay mounted inside `*-container` wrappers whose `grid-template-rows`
  transition animates **both open and close** symmetrically. An earlier pass added `kb-panel-in`
  to their inner classes; that only fired once at app mount and has been removed as dead code.
- **#3 Inline p-lock editor** *(enter in #62; exit recipe only)* — the one genuinely
  conditionally-mounted panel. Enters with `kb-panel-in`; the reference branch added a mirrored
  **exit** with `kb-panel-out` (150ms `--ease-in`) via a `useDelayedUnmount` hook holding the
  editor 180ms. #62 kept the enter but dropped the exit — the editor still vanishes abruptly.
  Recipe: `@keyframes kb-panel-out { to { opacity: 0; translate: 0 -6px; } }` + a 180ms
  delayed-unmount (or `onAnimationEnd`) so the node survives the animation.
- **#4 Copy→Paste** *(crossfade in #62; stagger recipe only)* — paste affordances enter with the
  crossfade recipe (`opacity 0→1`, `scale .25→1`, `blur 4px→0`, 150ms `--ease-standard`);
  source-row green latch already transitioned. The reference branch additionally staggered the
  paste buttons **20ms per row** (`.track-row-wrapper:nth-of-type(N) .action-btn.paste
  { animation-delay: (N-1)*20ms }`, rows 2–10) so the affordance visibly cascades down the
  track list. Measured mid-flight at t=55ms: opacities 0.58 / 0.16 / 0.00 across rows.
- **#5 Press feedback** *(in #62)* — exactly `scale(0.96)` @90ms on step cells, track actions,
  transport cluster, header buttons and row toggles, via the independent `scale` property
  (composes with the step-cell's inline swing `transform` and hover transforms). Pre-existing
  0.95 presses normalized to `var(--press-scale)`. Measured: 36px cell → 34.6px while held.
- `transition: all` replaced with named properties on every press target touched *(in #62)*.
- All of the above collapse to opacity-only / no-scale under `prefers-reduced-motion`.

- **#2 Toast mirroring** *(in #62)* — toasts already had an exit phase, but it flew *up* while
  the enter rose from *below*. The exit now mirrors the enter (returns down along the arrival
  path), and both run on tokens (`--dur-fast`/`--ease-out` in, `--dur-out`/`--ease-in` out)
  with a reduced-motion fade variant.
- **#7 Record pulse** *(recipe only)* — the hold-to-record button (behind `?recording=1`)
  carries a red `RecordFilled` dot (see `custom.tsx` in this PR) that pulses via
  `kb-pulse` (scale 1→1.15→1 + opacity breathe, ~1.2s loop) only while recording.

**#6 chevron** rotate shipped earlier, independently of both branches.

## Part 1 — Opportunities (ordered by leverage)

| # | Location | Current | Purpose | Frequency | Motion recipe |
|---|---|---|---|---|---|
| 1 | **Panels** — FX / Mixer / Pitch / pattern-tools open & close | teleport in/out | Spatial Consistency + Preventing Jarring Change | occasional | height + opacity + `translateY(-6px→0)`, `transform-origin` at the toggle, `--dur-panel` `--ease-out`. Reduced-motion: opacity only. **Highest leverage.** |
| 2 | **Toasts** — join / leave / audio-warning | pop in/out | Preventing Jarring Change | event-driven, low | slide-in from edge + fade, `--dur-fast` `--ease-out`; **exit mirrors enter** at `--dur-out` `--ease-in` (this is Emil's Sonner pattern). |
| 3 | **Inline p-lock editor** — Shift+click a step | appears abruptly below the row | Spatial Consistency (it belongs to that step) | per-edit | height + opacity reveal from the step's row, `--dur-panel` `--ease-out`. |
| 4 | **Copy → Paste** — CPY on source, PST appears on targets | buttons pop in | State Indication | occasional | source latches green; PST affordances fade+scale-in on valid targets, 20ms stagger, `--dur-fast`. |
| 5 | **Step-cell press** — toggling a step | instant colour only | Feedback | **very high** | `:active { scale: 0.96 }`, `--dur-press`. The *one* frequent action that earns motion — because it must stay imperceptible. Confirms the tap registered (esp. touch/laptop). |
| 6 | **Chevron** — dropdown / drawer open | already rotates | State Indication | occasional | keep the 180° rotate, `--dur-fast`. (Already shipped.) |
| 7 | **Record-armed pulse** — hold-to-record | — | State Indication (ephemeral) | rare | subtle opacity pulse while armed only; stops on release. (Behind `?recording=1`.) |

## Part 2 — Rejected candidates (and the gate question that killed each)

| Candidate | Killed by | Why |
|---|---|---|
| Gear / Settings **spin on hover** | **Purpose** | "Looks cool" (Delight) on a frequent functional control — decoration, not clarity. *(Trims a suggestion from the earlier icon gallery.)* |
| Close **X spin on hover** | **Purpose** | Same — motion adds nothing to a plain dismiss. |
| **Play ↔ Stop** icon morph | **Frequency** | Space-initiated, 100+/session → imperceptible only; an instant swap is correct. |
| **Playhead** smooth glide between steps | **Function** | On a quantised step grid, tweening implies between-step timing that doesn't exist — actively misleads. |
| "Juice" (bounce/flash) on **every step toggle** | **Frequency + Function** | The core hundreds-per-session action must stay instant; motion would add latency and visual noise to the exact thing you do most. |

## Part 3 — Verdict

Keyboardia's motion need is **low-to-moderate, and it is not about the icons**. The icons should be
static, crisp, `currentColor` marks; reserve motion for the few **state changes and transitions**
above. The single highest-leverage change is **#1 — give panels and overlays an origin-aware
open/close**: today FX/Mixer/Pitch/pattern-tools teleport, which is the most jarring moment in the
app. After that, matched toast enter/exit (#2) and the inline p-lock reveal (#3). Everything else —
especially anything on the step grid or the transport — should stay instant. The discipline of *not*
animating the high-frequency surface is exactly what will make the rest feel like an instrument.

> Handoff: `improve-animations plan <row>` turns any Part-1 row into an implementation.
