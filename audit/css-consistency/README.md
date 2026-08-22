# Keyboardia CSS consistency comparison

Compared on 2026-08-12:

- Keyboardia `main` source and the live landing/session surfaces.
- Claude public artifact `MAKE/LOOPS`, including its live preview DOM and exact HTML/CSS source.

Screenshot capture in the in-app browser timed out on both sites, including a
minimal 320x240 test. The comparison therefore uses live DOM inspection,
computed styles, and source rather than attached screenshots.

## Summary

Keyboardia has a coherent product vocabulary: 36px desktop controls, dark
surface layers, an orange primary accent, consistent step states, semantic
track/effect colors, visible focus, and good reduced-motion coverage. The
visual result is functional and recognizably one product.

Its consistency risk is implementation drift. Forty global CSS files contain
10,990 lines, 202 distinct raw color strings, 28 border-radius forms, 29
font-size forms, and 50 transition formulations. The design-language document
defines spacing and radius scales only conceptually, so components repeatedly
recreate the same control grammar.

The Claude artifact is more aesthetically resolved because seventeen widgets
reuse one compact set of primitives: `.device`, `.dhead`, `.model`, `.dname`,
`.led`, `.btn`, `.ctl`, `.lbl`, `.cell`, and `.pad`. Its 311-line stylesheet
has 18 custom properties and a strong physical-instrument metaphor. The same
panel shell, labels, controls, active treatment, and readouts recur everywhere.

## Highest-impact findings

1. Keyboardia has two parallel, context-specific FX surfaces. `Transport.css`
   and `EffectsPanel.css` reproduce labels, sliders, selects, effect colors,
   and bypass controls, but differ in ownership, available controls, panel
   radius, slider-thumb size, and muted semantic colors. This is not safe to
   treat as CSS duplication alone: narrow landscape currently exposes the
   standalone surface while wide landscape hides it, contrary to the mobile
   specification.
2. Step-count and transpose dropdown styles are almost copies. Extracting a
   shared dropdown/control primitive would preserve their intentional small
   differences without duplicating the whole skin.
3. Global generic selectors can collide. Both `StepCountDropdown.css` and
   `SamplePicker.css` define unscoped `.category-header` and `.category-label`.
   `TransposeDropdown.css` demonstrates the safer parent-scoped pattern.
4. The token contract is incomplete. `index.css` calls itself the single source
   of truth for colors, yet component CSS still contains 359 raw color
   occurrences outside that file. `--color-success-muted`,
   `--color-warning-muted`, `--color-accent-rgb`, and `--font-mono` are used
   without canonical root definitions, producing inconsistent fallbacks.
5. Keyboardia's live controls are mostly flat: no shadow on the sampled track,
   step, FX, picker, selector, or XY-pad surfaces. The artifact gains physical
   hierarchy from one restrained recipe: a slight vertical gradient, a 1px
   inset highlight, a dark edge, and a small active translation.
6. Keyboardia exposes more simultaneous density. In the sampled new session,
   the picker rendered 99 instrument buttons across six expanded categories.
   The artifact keeps each device focused on one lesson and one dominant task.

## What to borrow

- Pilot narrowly shared CSS recipes where two surfaces have the same DOM and
  interaction contract. Do not create a generic component library until a
  pilot demonstrates net deletion without more overrides or coupling.
- Add real spacing, radius, typography, control-height, shadow, and semantic
  muted-color tokens; declare `--font-mono` once.
- Use a repeated machine header for dense panels: compact model/section label,
  plain-language name, and a value/status readout.
- Apply physical depth selectively to panels and buttons, while keeping the
  high-frequency step grid crisp and immediate.
- Keep orange dominant for primary/active state. Reserve the wider feature
  palette for track identity, effect labels, slider thumbs, warnings, and
  selection—not every surface.
- Explore a collapsed or filterable instrument catalogue, including discovery
  and recovery paths. Treat recent and favorite choices as separate product
  decisions rather than assumed parts of the same change.

## What not to borrow

- Do not copy the artifact's single-file/global-CSS architecture.
- Do not copy its 9–10px dim labels without contrast changes. `#77777f` on
  `#17171a` is about 4.03:1, and orange `#ff4b00` on the light paper is about
  2.86:1.
- Do not copy its control-label helper as written: it creates a visual `span`
  beside a range input rather than an associated `label`, so many sliders have
  no accessible name.

## Updated implementation plan

Updated after multi-agent audits of CSS architecture, mobile behavior,
testability, and PR delivery risk. The original long Stack A and Stack B are
**not approved as written**, and Stack C is **not approved for implementation
as one programme**. Proceed with sequential test-harness prerequisites,
surface-specific decisions, bounded pilots, and explicit stop/go reviews. Use
a stack only after the shared harness is on `main` and one accepted evidence PR
has one dependent implementation PR; maximum depth is two.

### Lessons learned from building Stack A

Stack A was ultimately built as one PR at the maintainer's request, including
the state catalogue, differential runner, CI lane, selector containment, exact
legacy aliases, and the dropdown extraction pilot. That exception taught us:

1. **Accidental cascade is part of the current contract.** Containing
   `.category-header` initially changed dropdown and picker typography, cursor,
   and hover treatment. A zero-difference refactor must record today's computed
   result—including bugs—then move any correction into an intentional visual
   or behavior change.
2. **The real parent and stylesheet order belong in the fixture.** Standalone
   dropdown stories missed `TrackRow.css` grouping rules. The catalogue now
   imports the production parent context and includes a composite collision
   canary. Future fixtures must include the smallest real parent that owns
   contextual overrides.
3. **Responsive CSS needs interaction states at its boundaries.** Desktop-only
   checks missed mobile cursor and hover behavior. The reviewed matrix now
   includes portrait, compact/narrow/wide landscape, 768/769 neighbors, hover,
   focus, selection, disabled, and reduced motion; emulated-touch WebKit is a
   separate behavior contract rather than a pixel authority.
4. **“Exact token alias” does not mean “semantic token.”** Preserving an old
   fallback under a canonical-sounding name can encode a false color
   relationship. Exact legacy values now use feature-specific names; Stack B
   may replace them with approved semantic tokens when it intentionally changes
   pixels.
5. **A metric that is not gated is temporary.** The CSS check now caps both
   dropdown declarations and duplicate component declarations, as well as raw
   colors, `!important`, collision-prone selectors, root-token completeness,
   and shared consumers.
6. **The proof must protect itself.** The first PR necessarily bootstraps its
   base fixture from head. After landing, ordinary product PRs use the
   merge-base catalogue and may not change protected manifests, comparators, or
   fixtures in the same PR. Harness changes are explicit prerequisites.
7. **Verification has a real maintenance cost.** The pilot adds a catalogue,
   two browser contracts, an exact title inventory, a direct PNG dependency,
   and CI time. That cost is justified for shared/global CSS, but it argues
   against expanding the harness into a full component framework without a
   concrete refactor or regression risk.
8. **Byte-identical PNGs are not a stable browser contract.** In the same
   Chromium process, sparse anti-aliased pixels varied by up to six 8-bit
   channel values while the ARIA, computed-style, and geometry contracts were
   exact. The screenshot gate therefore permits at most 6/255 channel noise and
   requires zero pixels beyond it; it reports the raw count and maximum delta.
   Stack B/C descriptions must distinguish raster tolerance from approved
   design differences.
9. **A component contract should not accidentally become an integration
   test.** Selecting a sampled instrument started asynchronous audio/manifest
   work that could stall a WebKit component run even though the synchronous UI
   event was correct. The deterministic catalogue now tests picker expansion
   without external audio I/O. Live audio, network, and persistence belong in
   separately named integration contracts with their own fixtures and timeouts.
10. **Wait for causes, not elapsed time.** Opening a portalled dropdown starts a
    React effect that scrolls its selected option. Hovering the next option too
    soon raced that effect and produced two valid scroll positions. The runner
    now waits two animation frames after every action, then settles animations;
    arbitrary sleeps would only make the race less frequent. Stack B/C tests
    should wait for the state transition each action causes before continuing.
11. **Evidence expires when the merge base moves.** While Stack A was under
    review, `main` gained unrelated CSS and audio-test work. The CSS reductions
    stayed the same, but the absolute line/declaration counts and comparison
    base changed, and the CI workflow needed a safe rebase resolution. Rebase
    before final visual approval, regenerate the complete evidence set against
    that exact merge base, and treat any later base movement as invalidating the
    approval until the affected evidence is refreshed.
12. **Cross-browser coverage needs a named authority per contract.** The rebase
    brought in a real-audio multiplayer assertion that is deterministic in
    Chromium but cannot reliably create its required track bus in headless
    WebKit. Repeating, serializing, and lengthening the WebKit run did not make
    that precondition valid. The test remains gating in the real-audio Chromium
    lane and is a reviewed, inventory-checked skip in WebKit, whose role remains
    UI, collaboration, and layout. A larger browser matrix is not stronger
    evidence when a runner cannot supply the capability under test.
13. **A component fixture must reproduce production asset order.** The focused
    catalogue originally imported the dropdown before the lazy picker, while
    the production bundle loads their styles in the opposite order. Its 42
    contracts passed even though the full-app Linux canary found picker headers
    4px taller on desktop and 12px taller at 768px. The fix records the old
    padding explicitly and gives the catalogue the production order. Focused
    stories are excellent state factories, but they do not replace at least one
    full-app canary at each affected responsive mode and bundle boundary.

Measured result at the Stack A checkpoint:

| Metric | Before | After |
|---|---:|---:|
| Known collision-prone unscoped selectors | 16 | 0 |
| Undefined required root tokens | 6 | 0 |
| Duplicate declarations between dropdown component files | 73 | 0 |
| Dropdown recipe declarations | 163 | 125 |
| Product CSS declarations | 5,066 | 5,036 |
| Product CSS lines | 11,066 | 10,987 |
| Raw colors outside `index.css` | 359 | 346 |
| `!important` declarations | 20 | 20 |
| Shared dropdown consumers | 0 | 2 |

What got worse is explicit: product CSS files increase from 40 to 41; local
selector specificity increases where SamplePicker rules are contained; the
verification layer adds substantial non-product code and CI work; and the
product's aesthetics do not improve. The last point is the intended Stack A
result, not a hidden benefit.

#### Consequences for Stack B

- The dropdown pilot became **verification-unblocked** after issue #93 recorded
  its approved visual brief, accessibility target, and density/touch decision.
- Stack B must use the merge-base-owned manifest and add approved changed-pixel
  evidence in a separate implementation PR. It may extend coverage only in a
  preceding harness PR.
- Every intentional change must map to a named state and viewport. Unchanged
  ARIA, event payloads, dismissal, geometry outside the target, and
  reduced-motion behavior remain exact. The final audit pulled one narrowly
  scoped behavior repair into this pilot: selection and Escape now restore
  focus to the owning trigger and are asserted directly.
- Prefer feature-specific tokens during the pilot. Promote a value to a shared
  semantic token only after two real consumers share meaning as well as value.
- Keep Stack B surface-sized. Do not start FX or picker visual consolidation
  merely because the dropdown extraction succeeded.
- Keep the visual pilot deterministic: do not make approved-pixel evidence
  depend on audio loading, network fixtures, persistence, or other integration
  paths that Stack B is required to leave behaviorally unchanged.
- Sequence multi-action states around observable transitions or render frames,
  never fixed delays; a flaky expected-diff review is not usable evidence.
- Rebase immediately before design sign-off and regenerate the baseline,
  approved changed-pixel mask, metrics, and unchanged contracts together. Do
  not carry an approval across a changed merge base merely because the product
  diff still looks small.
- Name the authoritative browser for each changed and unchanged contract.
  Chromium remains the pixel authority; emulated-touch WebKit may prove touch
  behavior, but it must not be stretched into visual or real-audio evidence.
- Require both focused catalogue evidence and a production-built full-app
  canary for the affected surface and responsive modes. If they disagree,
  repair the fixture or the implementation; do not update snapshots until the
  source of the disagreement is understood and approved.
- Bind approval to an immutable source revision, not merely to image hashes.
  The final evidence-only commit records base/source SHAs, generator schema,
  input/config hashes, check results, and every review-file hash; CI rejects
  source drift after that approved revision.
- Measure contrast against every opaque gradient stop that can be rendered,
  including non-text selection indicators and each independently meaningful
  control/menu boundary. A fallback `background-color` is not the visible
  surface when an opaque gradient covers it.

#### Lessons learned from the Stack B candidate

The complete dropdown pilot is implemented in one maintainer-requested PR. Its
candidate evidence and final consistency audit produced seventeen lessons:

1. **A responsive component state is not proof that the product exposes that
   component in the same mode.** The catalogue can render the shared portalled
   dropdown at landscape dimensions, but production landscape uses a native
   step-count select and transpose buttons inside `TrackDrawer`. Full-product
   portrait and landscape screenshots are therefore identity canaries, not
   approved-pixel baselines for this dropdown family.
2. **Expected-difference tests can be stricter than snapshots.** The Stack B
   contract keeps ARIA, every visible rectangle, all non-decorative computed
   properties, and pixels outside a target-plus-halo mask exact. An image update
   alone cannot authorize a layout or behavior regression.
3. **Stabilize unrelated asynchronous UI by cause.** A static production build
   has no WebSocket, so connection text can change between geometry capture and
   screenshot. The canary removes only the live presence/status region from
   layout; it does not add timing sleeps or broaden pixel tolerances.
4. **Review crops must ignore zero-area descendants.** CSS descendants of a
   hidden parent can retain `display:flex` while producing a 0×0 rectangle.
   Target-region capture now requires positive geometry, preventing invisible
   controls from turning an identity screenshot into a one-pixel crop.
5. **Consistent selection does not mean one colour for every `.active`
   class.** The rejected menu treatment reused orange as row tint, leading rail,
   check, and open-trigger state. The approved replacement defines cues by
   meaning: single-choice popup items use a neutral tonal row plus orange check;
   sequencer-object selection keeps its information-blue outline; modes and
   binary actions keep their owning feature colours; and the playhead remains
   white. A focused browser contract now proves the two `aria-selected`
   dropdown families compute to the same selected surface and indicator.
6. **A screenshot hash proves integrity, not freshness.** Receipts must name the
   immutable source revision that produced the pixels, and CI must reject later
   product, harness, workflow, or documentation changes until evidence is
   regenerated. Contact sheets and focused approval crops belong in the same
   bound file inventory as their raw images.
7. **Machine pixel authority and human review rendering are different jobs.**
   Same-process Linux Chromium comparisons enforce containment and identity in
   CI. Committed Chromium screenshots may be rendered on the review machine as
   long as their source revision and environment are explicit; they are not
   cross-platform golden screenshots.
8. **Responsive evidence follows the named product matrix, even for unchanged
   modes.** The 480×320 and 667×375 landscape canaries prove that the native
   TrackDrawer path remains exact, while 1024×768 proves the tablet-landscape
   desktop editor receives the approved dropdown treatment.
9. **Approval sheets must show the decision at useful scale.** An exhaustive
   menu sheet is not enough when its most important row is hard to inspect. The
   package now includes a dedicated full-height selected-option comparison.
10. **Visual inference must be checked against computed style.** The final audit
    initially read the earlier neutral trigger shadow as an orange inner focus
    halo. Chromium disproved that reading, and the flattened recipe now removes
    the trigger shadow entirely while asserting both the absence of shadow and
    the blue outline. A genuinely mixed focus treatment fails mechanically.
11. **One-time migration allowances must expire.** Stack B permits reviewed
    decorative differences only while the comparison base is the frozen Stack
    B migration SHA. Later dropdown changes return to exact computed-style
    identity instead of relying on the 6/255 raster allowance to catch small
    line or text colour drift.
12. **A contrast assertion must sample the neutral state it names.** The first
    control-edge check read the trigger after opening it, so it measured the
    orange open border and allowed the old 2.06:1 neutral edge to pass. The
    repaired test captures the closed edge before interaction. Independent
    independent calculations prove the old control edge (2.06:1), menu edge
    (2.23:1), and pre-pilot global scrollbar (`#3a3a3a`, 1.22:1 at the
    lightest menu stop) each fail. The 1.85:1 result seen during development
    belonged to the stronger intermediate `#54545e` scrollbar.
13. **Focus recovery needs a discriminating direct assertion.** Escape looked
    correct while the trigger happened to retain focus. The evidence action now
    moves focus to an option before Escape, and a head-only contract directly
    proves focus returns after both dropdown selections and Escape. Removing
    the hook repair makes that contract fail.
14. **Focus ownership is a cross-modality contract.** The shared close path is
    also used by touch selection, while outside dismissal deliberately is not.
    Emulated-touch tests now assert that selection returns focus to the trigger,
    and the head-only contract proves clicking a focusable outside target keeps
    focus there. This prevents a future cleanup from silently stealing focus.
15. **Text contrast must cover semantic variants and interaction states.** The
    original text audit missed active transpose blue on hover. A
    dropdown-specific `#5eb3ea` keeps feature identity while clearing 4.5:1 in
    both flat closed and hover states, and both are now asserted.
16. **Focus colour belongs to focus, not to a global button default.** Popup
    options inherited an orange button halo even though Keyboardia reserves
    orange for open/hover disclosure. The shared option rule now uses the same
    information-blue focus grammar as triggers, with an inset outline that is
    not clipped by menu overflow.
17. **A component can improve locally and still diverge globally.** The tactile
    dropdown recipe passed its scoped contrast and consistency checks but added
    a private `.68` text tier plus gradients and inset highlights absent from
    neighbouring neutral controls. The site-wide audit led to a flat correction
    that keeps the stronger boundaries, state colours, selection grammar, and
    focus ownership while reusing the product's existing surfaces and `.60`
    muted text tier.

Candidate pilot CSS scorecard: product files remain 41;
product declarations increase from 5,036 to 5,055; product CSS lines increase
from 10,987 to 11,016; the shared dropdown recipe increases by four declarations
from 127 to 131; raw colors outside `index.css` fall from 346 to 340; duplicate
dropdown declarations remain zero; `!important` remains 20. The declaration
and line increases are the explicit maintenance cost of adding visual depth,
focus color, and feature-specific tokens rather than hiding new values as raw
component colors.

#### Consequences for Stack C

- Stack A does **not** make Stack C implementation-ready. It strengthens the
  need to close C0-viewport, FX visibility, picker, published-session, and
  touch-target contracts before changing structure or behavior.
- Stack C should reuse the catalogue as a state factory, but base-versus-head
  pixel equality is not its success criterion. Each slice needs an approved
  expected diff, a task outcome, a guardrail, and a rollback threshold.
- Changes involving gestures, rotation, safe areas, browser chrome, or audio
  still require named physical-device/device-cloud evidence; emulated WebKit
  is useful but insufficient.
- Split deterministic component behavior from live integrations in the impact
  manifest. A Stack C audio or data-flow change must exercise the real path in
  a dedicated contract; unrelated visual and gesture states should use stable
  fixtures so an integration outage cannot invalidate their evidence.
- A structural Stack C change supersedes Stack B on the same surface. Do not
  polish markup or CSS that the approved C slice will replace.
- Bind each approved outcome and rollback threshold to an exact base/head pair.
  After a rebase, rerun both deterministic evidence and any affected
  device/integration evidence; if the rebase changes the surface or flow,
  product approval is required again before merge.
- Put audio outcomes in a real-audio Chromium and physical-device contract;
  keep headless WebKit focused on UI, collaboration, and layout. A reviewed
  capability skip must stay explicit and inventory-gated rather than becoming
  a retry, a longer timeout, or an unreported coverage gap.
- Treat the catalogue only as a deterministic state factory. The full product
  journey, production bundle/order, and named device evidence are authoritative
  for Stack C outcomes; retain at least one end-to-end canary for each affected
  responsive mode and integration boundary.

### Responsive contract for every change

Portrait and landscape are different product modes, not just sizes. A change
may be consistent within a mode without looking identical across modes.

| Contract | Representative viewport | Required intent |
|---|---:|---|
| Desktop | 1280×800 | Full editing and production controls |
| Mobile portrait | 375×812 | Read-only consumption, play/pause, share/QR, no horizontal overflow |
| Narrow mobile landscape | 667×375 and 480×320 | Editing with the inline drawer; no desktop-only FX, Mixer, Pitch, Scale, or Unmute controls |
| Wide mobile landscape | 844×390 | Same product capabilities as narrow landscape unless a documented exception is approved |
| Tablet portrait | 768×1024 | Product decision required; define by viewport and input contract, not device name |
| Tablet landscape | 1024×768 | Product decision required; define by viewport and input contract, not device name |

The production mode classifier depends on both coordinates and checks desktop
first. A width-only breakpoint list is therefore ambiguous. C0-viewport must
approve the intended result for this boundary matrix and align the spec,
JavaScript, CSS media queries, and `data-orientation` consumers:

| CSS viewport | Current JS result | Contract risk to resolve |
|---:|---|---|
| 767×1024 | portrait | Neighbor of the inclusive 768px CSS boundary |
| 768×1024 | desktop | Mobile `max-width: 768px` CSS can still apply |
| 769×1024 | desktop | Upper width-boundary control |
| 844×499 | landscape | Lower neighbor of the 500px height boundary |
| 844×500 | desktop | Spec examples using `max-height: 500px` disagree at equality |
| 844×501 | desktop | Upper height-boundary control |
| 600×599 | landscape | Square-boundary neighbor where width exceeds height |
| 600×600 | portrait | Exact square currently falls through to portrait |
| 600×601 | portrait | Portrait neighbor |

Extract or export the production classifier as a pure function and table-test
this matrix. Existing width-only test helpers that accept multiple results are
not the product contract. Use full-app E2E only for representative modes after
the unit matrix is authoritative. Also record the minimum supported CSS
viewport before treating 480×320 as the lower bound.

For affected rotation work, test portrait → landscape, landscape → portrait,
and a complete round trip. Specify which state survives and which intentionally
resets: pattern data and playback must survive; focus must move to a visible
control; drawer, picker, selected step, portrait page, panel, scroll, and
pending edits each need an explicit decision. Do not call a round trip
“identical” when it only compares visibility booleans. Treat orientation lock
as a persistent-portrait fallback, not a browser capability to detect: playback
remains usable, read-only behavior holds, and rotate guidance is understandable
and dismissible. Published-session behavior needs an explicit row in every
affected orientation contract.

### Prerequisites and decision gates

1. Add deterministic coverage for open step-count and transpose menus, the
   expanded desktop FX panel, the standalone FX surface, the open landscape
   drawer, and the landscape instrument picker.
2. Maintain the landed catalogue, identity runner, and merge-base comparison
   workflow as protected infrastructure. Future harness changes land before,
   and separately from, product CSS changes.
3. Put new identity specs in a dedicated directory and Playwright config with
   its own collected CI lane. Extend the repository's unrun-test inventory
   check instead of adding tests to full-app lanes with hard-coded title counts.
4. Pin the canonical visual environment, fetch enough Git history to resolve
   the merge-base, and add PR concurrency cancellation. Existing tolerant or
   macOS screenshots remain broad evidence, not Stack A identity authority.
5. Add a gating Playwright mobile-WebKit/`hasTouch` behavior lane and describe
   it accurately as emulated touch. Require a named physical-device or
   device-farm smoke owner only for slices affecting gestures, orientation,
   browser chrome/safe areas, or audio.
6. Resolve the coordinate mode matrix, minimum CSS viewport, tablet behavior,
   published-session × orientation behavior, and the `<500` versus `<=500`
   boundary before changing mode detection or shared responsive primitives.
7. Decide whether 36px persistent landscape controls are an intentional dense
   exception to the documented 44px touch-target rule. Enlarging a target or
   changing overlap is behavior work for that surface.
8. Decide intended landscape FX behavior before sharing FX CSS. The spec hides
   FX in landscape, but remaining width-only visibility exposes the standalone
   panel at 667×375 and hides it at 844×390.
9. Approve a Keyboardia-specific visual brief before appearance work. The
   Claude artifact is comparison evidence, not an implementation target.

### Stack A identity-verification architecture

“Equivalent” means equivalent for the explicitly covered states, viewports,
and canonical rendering engine, with the documented 6/255 raster allowance. A
finite suite cannot prove equivalence for every browser and input, so Stack A
needs a risk-based state manifest plus four
independent contracts:

| Contract | What it detects |
|---|---|
| Strict screenshot | Pixel, geometry, typography, color, and layout changes |
| Interaction | Click, touch, keyboard, selection, dismissal, and focus regressions |
| Accessibility tree | Role, name, expanded, selected, disabled, and reading-order changes |
| Computed style/geometry | Subtle targeted differences hidden by broad page noise |

#### Focused state catalogue (Storybook or equivalent)

Stack A implemented a minimal React/Vite catalogue rather than adding the
Storybook dependency. That accepted equivalent imports real production
components and global CSS in production cascade order. It covers:

- Step count and transpose: closed, open, selected, focused, and disabled.
- Sample picker: add/change variants and collapsed/expanded categories.
- Desktop and standalone FX: inactive, active, bypassed, disabled, and open.
- Landscape drawer: closed, open, keyboard-focused, and destructive-action
  states.

Reach interactive states through the real control rather than introducing
screenshot-only component props. Screenshot the whole catalogue page for
portalled dropdown menus because the menu is attached to `document.body`,
outside the component root.

Use frozen `isPlaying` and `currentStep` story state for playing screenshots;
never capture a live scheduler tick. Full-app tests should assert scheduler and
audio progression without pixel capture.

Component isolation can conceal Keyboardia's global CSS collisions. The
catalogue therefore includes a composite collision canary that renders
StepCountDropdown and SamplePicker together, plus full-application Playwright
coverage for lazy stylesheet load-order behavior. A focused catalogue is a
deterministic state factory; it is not a replacement for the assembled app.

#### Strict Playwright identity suite

Create a dedicated identity directory and Playwright config, with an
`@stack-a-identity` project, rather than tightening every broad visual smoke
test or placing the new specs in the existing full-app E2E inventory. Give it
its own collected CI lane and manifest-owned expected count. Its screenshot
policy is:

- Canonical Chromium/Linux environment pinned by container digest or fixed
  image, rather than a moving `ubuntu-latest` contract.
- Zero pixels beyond a maximum 6/255 per-channel raster allowance; exact
  computed-style and geometry comparison remains the backstop.
- CSS-pixel scale, fixed viewport, device scale, locale, timezone, color
  scheme, and reduced-motion setting.
- Animations disabled, caret hidden, application fonts loaded, fixed time, and
  deterministic API/WebSocket/session data.
- Semantic readiness assertions before capture; no arbitrary sleeps.
- Locator screenshots for the smallest stable surface, with full-page captures
  only where global cascade, overflow, or responsive composition is the risk.
- No masking inside the component or layout under test. Mask only unrelated,
  proven volatility such as generated presence identity.

The existing tolerant screenshots remain useful broad regression tests, but
they do not certify Stack A identity. Cross-browser, emulated-touch, and
selective physical-device checks verify behavior; they do not share pixel
baselines with canonical Chromium.

#### Same-job base-versus-head comparison

The strongest Stack A CI gate renders the PR merge-base and PR head in the same
pinned environment. It became authoritative after the catalogue and identity
manifest merged to `main`:

1. Check out and build both revisions, including their static catalogues.
2. Serve them on separate ports.
3. Use the same browser process and fixed state manifest to capture both.
4. Compare paired screenshots with the documented raster allowance and no
   spatial pixel budget.
5. Compare accessibility-tree and computed-style/geometry outputs exactly.
6. Upload before, after, and diff artifacts on failure.

Fetch full merge-base history explicitly and cancel superseded PR runs. Keep
the state catalogue, identity runner, and differential workflow as sequential
bootstrap PRs: a dependent PR cannot claim its merge-base owns a manifest that
exists only in its unmerged parent.

Run the canonical comparison manifest from the merge-base so a refactor cannot
weaken its own test. Stack A PRs may not change identity baselines, manifests,
masks, or snapshot-update configuration. If coverage must change, land that as
a prerequisite PR first. Never run `--update-snapshots` in Stack A CI.

#### Required state and viewport manifest

The first identity manifest must cover open step-count and transpose menus,
the expanded desktop FX panel, the standalone FX surface if it remains, the
open landscape drawer, and the landscape instrument picker. Exercise desktop
1280×800, portrait 375×812, narrow landscape 667×375 and 480×320, wide
landscape 844×390, and the coordinate boundary matrix where the affected
component is present. Avoid a full Cartesian product: each change declares
which manifest entries it can affect and all of those entries gate the PR.

### Changes that reduce duplication without altering appearance or behavior

Treat this as **A-lite**, not the original broad Stack A.

1. Scope collision-prone selectors only after recording the current open-state
   computed styles. Portal menus must be scoped from their menu root. If
   corrected cascade behavior changes pixels, move that change to the next
   category and document it as a bug fix.
2. Add only exact-value token aliases. Where one undefined token currently has
   different normal and hover fallbacks, create separate aliases rather than
   choosing one canonical value. Do not normalize colors in this category.
3. Pilot one shared dropdown CSS recipe for step count and transpose. Preserve
   explicit modifier classes for genuine differences. Their behavior is
   already largely shared through `useDropdownMenu`, so continue only if the
   CSS pilot removes declarations without increasing specificity or overrides.
4. After the landscape FX product decision, optionally extract only the shared
   parameter-row/range recipe. Do not merge the panel shells, React components,
   breakpoints, or behavior here.
5. Do not introduce generic `Panel`, `Control`, `Range`, `Readout`, or
   `SequencerCell` components as a goal in themselves.

Acceptance gate for each change:

- No baseline files change.
- Targeted computed style, geometry, accessibility name/role, keyboard, and
  reduced-motion contracts remain unchanged.
- All affected manifest entries pass; require the entire responsive matrix only
  for global CSS, mode-detection, or breakpoint changes.
- Rotation preserves the explicitly named product state.
- The diff produces measurable net deletion and does not add override rules or
  specificity to recover the old appearance.

### Changes that primarily reduce inconsistency with minor appearance changes

Do not build these as a dependent Stack B. Take one independent, surface-sized
change at a time after the responsive and product decisions above.

#### Stack B readiness gate

Stack B becomes available one surface at a time. A dropdown visual pilot need
not wait for an unrelated FX decision, but every gate that affects the chosen
surface must be closed before its implementation PR starts.

Tracking issue: [#93 — Unblock Stack B: define and validate the dropdown
visual-consistency pilot](https://github.com/adewale/keyboardia/issues/93).

1. **Approved visual brief:** Name the target surface, the user problem, the
   intended hierarchy, and what should remain intentionally different between
   desktop, portrait, and landscape. Include approved reference screenshots or
   mockups. Do not use the Claude artifact as the target by default.
2. **Resolved product contract:** Decide visibility, editing capability,
   disclosure, breakpoint/tablet behavior, state persistence, and touch-target
   exceptions for that surface. FX has a confirmed narrow/wide landscape
   contradiction. Characterize the picker at 667×375 and 844×390 before
   claiming a picker capability mismatch.
3. **Documented visual language:** Record the chosen spacing, radius,
   typography, control-height, focus, depth, color, and motion rules in
   `DESIGN-LANGUAGE.md`, including allowed mode-specific exceptions.
4. **Accessibility target:** Approve contrast, focus-visible, accessible-name,
   keyboard, reduced-motion, zoom/reflow, and touch-target acceptance criteria.
   Automated axe checks are a gate but do not constitute complete accessibility
   approval.
5. **Deterministic evidence:** The relevant component-catalogue and full-app
   Playwright states must exist before implementation. The focused fixture must
   reproduce production stylesheet and bundle order, and at least one
   production-built canary must cover every affected responsive mode. Stack B
   uses the same fixed environment as Stack A but expects an explicitly
   reviewed pixel diff. A focused/full-app disagreement blocks baseline updates.
6. **Behavior freeze:** DOM and accessible order, role/name, keyboard and touch
   behavior, focus path, hit area, visibility, default disclosure, and product
   state remain unchanged unless the maintainer explicitly pulls forward a
   narrowly scoped blocker repair with its own direct test. Reordering, hiding,
   progressive disclosure, target enlargement, or changed default expansion is
   Stack C even when presented as styling.
7. **No imminent structural replacement:** Do not visually normalize a surface
   that a planned behavior PR will soon remove or reorganize. Finish or reject
   that product change first.
8. **One pilot and a stop/go review:** Start with one complete component family,
   preferably the dropdowns. Review its annotated before/after evidence at all
   affected viewports, maintenance impact, and user-facing result before
   approving another visual pilot.

For each pilot, the approved brief, state manifest, intentional-difference
list, accessibility criteria, and reviewer sign-off form the baseline-update
authority. Any changed pixel not explained by that package is a regression.

Candidates:

1. Correct global-selector collisions whose current winning cascade gives a
   component the wrong label, padding, or hover treatment.
2. Define separate normal/hover muted semantic tokens, align the accent RGB
   token with the approved accent, and define the missing monospace/text tokens.
3. Normalize focus treatment, control state contrast, typography, spacing, and
   radii within one component family—not across the entire product at once.
4. Align equivalent dropdown or FX parameter states while preserving deliberate
   desktop/portrait/landscape density differences.

Acceptance gate for each change:

- Include annotated before/after evidence at every affected viewport and state.
- State every intended pixel change; do not hide it inside baseline updates.
- Preserve visibility, roles, accessible names, focus order, keyboard behavior,
  touch behavior, reduced motion, and portrait read-only behavior.
- Meet the chosen contrast and touch-target targets.
- Stop after each pilot and decide whether the consistency gain justified the
  visual churn before starting another.

### Changes that alter appearance and behavior

This is **Stack C**, but it must not be one dependent chain. These are product
changes and must not ride on a CSS-cleanup or Stack B appearance PR. Some Stack
C work is an early contract repair that unblocks A or B; optional redesigns
come later as independent product slices.

Classify work by its highest impact. Stack A changes neither pixels nor
behavior. Stack B changes approved pixels while normally preserving
DOM/accessibility order, hit areas, visibility, focus paths, and disclosure.
This pilot includes one explicitly requested Stack C pull-forward—restoring
trigger focus after selection and Escape—because shipping the visual focus
treatment without a reliable focus owner would leave a verified accessibility
gap. It has a direct negative-control-backed test and is not precedent for
bundling broader behavior work into visual pilots. Any other change to those
contracts is Stack C. On one surface, planned structural Stack C work
supersedes Stack B rather than depending on it; unrelated A-lite and B work may
proceed while that surface waits for its C decision.

#### Stack C readiness gate

1. **Outcome, guardrail, and owners:** Record one primary user outcome, one
   guardrail, a rollback threshold, product-contract owner, visual/accessibility
   approver, implementation owner, and test/evidence owner. Include approval
   date and source commit. “More consistent” is not a sufficient outcome.
2. **Per-mode behavior specification:** State what users can see and do in
   desktop, portrait, narrow landscape, wide landscape, tablet portrait,
   tablet landscape, published sessions, and persistent-portrait/orientation-
   lock fallback. Unaffected rows may say unchanged or N/A with evidence.
3. **Chosen interaction target:** Approve a prototype, mockup, or existing
   product pattern showing initial, active, focused, loading, empty, error,
   disabled, and completion states where relevant.
4. **State-transition contract:** Decide what survives resize, rotation,
   reconnect, refresh, and mode changes. Cover playback, pattern data,
   selection, focus, drawers/pickers/panels, scroll, and pending edits only
   where the slice can affect them.
5. **Accessibility and input contract:** Specify keyboard, emulated touch,
   focus recovery, reduced motion, reflow/zoom, and target-size behavior.
   Automated ARIA/axe checks cannot prove screen-reader announcements; add a
   manual assistive-technology smoke check when navigation, live regions,
   announcements, or focus ownership changes.
6. **Deterministic evidence:** Characterize the old divergence without blessing
   a known defect as a durable baseline, then encode the desired acceptance
   path. Use frozen Storybook state as a deterministic state factory, while
   production-built full-app Playwright remains authoritative for bundle/order,
   scheduling, audio, rotation, publication, and collaboration behavior. Cover
   every affected responsive mode and investigate any disagreement before
   approving screenshots.
7. **Impact manifest:** Mark each row below Affected, Unchanged, or N/A and link
   its evidence. This selects proportional tests instead of forcing every
   Stack C slice through every expensive flow.

   | Impact row | Evidence when affected |
   |---|---|
   | Visual modes and coordinate boundaries | Storybook plus representative full-app assertions |
   | Keyboard, emulated touch, focus, zoom/reflow | Interaction and accessibility tests |
   | Physical gestures, rotation, browser chrome/safe areas | Named device/device-farm smoke owner |
   | Refresh, reconnect, queued/offline work | Deterministic state-transition tests |
   | Multiplayer and wire protocol | Two-client and authoritative-state tests |
   | Audio engine and live playback | State/audio assertions without live pixel capture |
   | Published/read-only and remix | Immutable-session and compatibility tests |
   | Persistence and personal preferences | Storage version/failure/reset tests |
   | Screen-reader announcements | Manual AT smoke record |

8. **Mutation and data boundary:** Viewport changes, orientation, panel
   disclosure, catalogue search/filter, recents, and favourites send zero
   session/WebSocket mutations. Musical selections and effect edits continue
   through existing shared dispatch and authoritative server paths. A viewport
   or personal preference must never become shared `SessionState` by accident.
9. **Compatibility:** Default to no `SessionState`, message, URL, published, or
   remix-format change. If a protocol/schema change is unavoidable, require
   optional/defaulted fields, versioned migration, old-client/new-server and
   new-client/old-server coverage, published/remix snapshot compatibility,
   dual-read where necessary, and a tested rollback.
10. **Rollout:** Prefer one small revertable C0 slice to a permanent dual path.
    Current `VITE_FEATURE_*` flags are build-time, not percentage rollout. A
    flagged change needs old/default and new/enabled build lanes, a named owner,
    removal issue/date, compatible persisted state, a kill threshold, and an
    explicit acknowledgement that rollback requires rebuild/redeployment. A
    flag may not fork persisted state or wire shape.

Stack C screenshot differences are expected but insufficient. Acceptance
requires the intended task to work, the prior invalid path to be removed or
redirected, and all state/interaction/accessibility assertions to pass.

#### Early Stack C0 decisions

Each C0 item is its own decision/spec PR followed, if approved, by one
implementation slice. It blocks only work on the affected surface.

1. **C0-viewport:** Choose inclusive/exclusive width and height semantics for
   the coordinate matrix, minimum CSS viewport, tablet portrait/landscape,
   published-session × orientation behavior, and persistent-portrait fallback.
   Extract and unit-test the production classifier before changing it. Do not
   silently select a breakpoint in a styling PR.
2. **C0-FX:** Resolve the confirmed landscape contradiction as an explicit
   product fork: retain the mobile spec, hide FX in every landscape, and remove
   the now-unreachable standalone production surface; or revise the spec and
   expose one supported FX experience consistently across narrow and wide
   landscape. Do not extract shared FX CSS until this lands. With active FX,
   rotation/unmounting must not reset effect or bypass state, interrupt
   playback, apply engine state twice, diverge between collaborators, or lose
   state on reconnect or published playback.
3. **C0-picker characterization:** Capture Add Track and Change Instrument at
   667×375 and 844×390. Current evidence proves the wide picker is reachable;
   it does not prove a narrow/wide capability mismatch. Open a picker behavior
   decision only if evidence shows inconsistent capability or disclosure.
   Instrument replacement must retain its local, remote, reconnect, and
   load-state audio reconciliation.
4. **C0-touch policy:** Decide the documented 44px target versus existing 36px
   dense landscape controls per affected control. Enlarging targets or changing
   overlap is Stack C; the policy does not block unrelated desktop/dropdown
   work.

#### Independent Stack C candidates

1. Treat catalogue search/collapse, recents, and favourites as three separable
   slices. Validate discovery and recovery before choosing default collapse.
   Add Track and Change Instrument may share a picker but remain distinct user
   operations and acceptance flows.
2. Assign catalogue state deliberately:

   | State | Default ownership |
   |---|---|
   | Query, expanded categories, open drawer/picker | Ephemeral component/client state; never synchronized |
   | Recents/favourites, if approved | Versioned, failure-tolerant local storage with reset |
   | Shared musical session data | Existing authoritative session dispatch only |

   Moving personal catalogue state into shared session data requires a separate
   collaboration/schema proposal.
3. Split the artifact-inspired machine-panel direction by effect: physical
   depth or typography alone can be Stack B; reordering, hiding, progressive
   disclosure, or changed focus order is Stack C and needs a task prototype.
4. Change panel disclosure, navigation, or orientation-transition behavior only
   with a per-mode table covering editable/read-only state, focus, scrolling,
   playback, published sessions, and persistent-portrait fallback.

Deliver one vertical slice at a time. Contract PRs normally merge before
implementation begins. After the shared harness is on `main`, a two-PR stack
may expose an accepted evidence prerequisite and its dependent implementation
for parallel review. Never stack unrelated picker, FX, viewport, touch, or
panel work.

Use three evidence tiers: canonical Chromium/Linux for pixels; gating
Playwright mobile-WebKit/`hasTouch` for emulated-touch behavior; and recorded
physical-device/device-farm smoke only for affected gestures, orientation,
browser chrome/safe areas, or audio. Replace fixed rotation sleeps with semantic
mode readiness. Review frozen closed/open/focused/playing/disabled/error visual
states that the slice affects, but judge Stack C on its outcome, guardrails,
and behavior—not pixel similarity.

### Other changes

1. Add a narrow CSS invariant check for new unscoped generic selectors,
   undefined design tokens, and unexplained raw colors. CSS is not currently
   covered by lint-staged or a stylesheet linter, so cleanup would otherwise
   drift immediately.
2. Keep the visual-baseline workflow human-reviewed. Never regenerate snapshots
   simply to make a refactor green.
3. Use Storybook as the recommended state factory for affected component
   families across all stacks. An equivalent deterministic component harness
   is acceptable, but ordinary full-app screenshots alone are not. Storybook
   does not replace full-app orientation, touch, audio, or rotation tests.
4. Record intentional exceptions in `DESIGN-LANGUAGE.md`, especially mode-based
   density, the 768px/tablet contract, and any sub-44px landscape controls.
5. Remeasure duplication after the dropdown pilot and the landscape FX decision.
   Delete obsolete surfaces before abstracting code that may no longer be needed.
6. Record a small scorecard for each initiative:

   - Stack A: zero pixels beyond the raster allowance and exact
     ARIA/interaction/style/geometry contracts; fewer declarations; at least
     two real shared-rule consumers; no increase in `!important`, maximum
     specificity, or recovery overrides; acceptable identity-job duration and
     flake rate.
   - Stack B: every changed pixel maps to the approved brief; the sole approved
     behavior repair is directly tested; all other behavior remains frozen;
     contrast, focus, target size, and design-language decisions pass; a
     reviewer records go/no-go before the next surface.
   - Stack C: one outcome, guardrail, rollback threshold, and feasible
     observation method; test audio, multiplayer, persistence, publication,
     accessibility, and mobile only where the impact manifest selects them.
7. Keep review units economical: one surface, one decision, and one acceptance
   manifest per PR; no unrelated refactoring in behavior PRs; split above
   roughly 400 non-generated changed lines or 10 hand-edited files unless
   atomicity requires otherwise. Keep reviewed B/C baselines with the
   implementation PR so code and intentional pixels can be reviewed together.

### Delivery order

1. **Complete — Stack A bootstrap and dropdown A-lite:** the maintainer-requested
   single PR landed the deterministic catalogue, protected differential runner,
   dedicated Chromium and emulated-touch WebKit contracts, CSS invariants,
   selector containment, exact feature aliases, and shared dropdown recipe.
2. **Complete — A checkpoint:** the scorecard above shows net CSS deletion and
   zero remaining duplicate component declarations, so the dropdown pilot is a
   go; broader abstraction is not implied.
3. **Implementation complete; renewed review pending — Dropdown B pilot:** the
   dropdown-only brief, accessibility, density, touch decision, deterministic
   expected-difference contract, and 29 before/after pairs are implemented in
   one maintainer-requested PR. The maintainer approved Option 1 for the
   selected row; the later focus-ownership and non-text-contrast corrections
   require review of the regenerated source-bound evidence and final CI. The
   pilot decision remains **stop**: do not begin another Stack B surface
   without its own surface-specific gate. The package covers desktop, portrait,
   480×320 and 667×375 landscape, 844×390 wide landscape, 1024×768 tablet
   landscape, and the 768/769 boundary. Merging PR #95 after renewed approval
   does not authorize a product-wide Stack B rollout.
4. **C0 in parallel, per surface:** merge only the viewport, FX, picker-
   characterization, or touch decision needed by that surface; then implement
   it as one vertical slice. Do not make all A/B wait for all C0 decisions.
5. **Optional FX A/B:** proceed only after C0-FX confirms which surfaces
   survive. **Optional picker A/B:** proceed only after characterization and
   only if imminent catalogue Stack C will not supersede it.
6. **Optional Stack C:** merge one decision/evidence PR, implement one vertical
   slice, test both build paths if flagged, observe the outcome and guardrail,
   roll back or continue, and remove an obsolete flag before selecting another
   slice.

The dependency rule is surface-specific:

| Work | Actual prerequisite |
|---|---|
| Dropdown A-lite | Complete |
| Dropdown B | Issue #93 brief, accessibility target, and affected density/touch decision |
| FX A/B | C0-FX contract; confirmation that both surfaces survive |
| Picker A/B | Picker characterization and no imminent catalogue replacement |
| Shared responsive primitives | Approved C0-viewport contract |
| Catalogue Stack C | Picker evidence and product brief; supersedes picker B |

The one-PR Stack A bootstrap was an explicit maintainer exception. Do not repeat
that pattern: once the harness is on `main`, maximum stack depth is two and only
for an accepted evidence PR plus its implementation. Stacking is for parallel
review, not for bypassing an unresolved decision. Avoid the original long A/B
chains: lower-level changes would cascade through every child, repeatedly run
expensive E2E/visual lanes, and churn the same binary baselines.

### Multi-agent audit verdict

Independent architecture, mobile/test, and delivery/review-economics audits
converged on these corrections:

- **The bounded dropdown Stack A pilot is complete and is a go.** It preserved
  the reviewed contracts and delivered net deletion, but it does not approve
  broad primitives or FX/picker consolidation.
- **Do not build a product-wide Stack B.** The dropdown pilot becomes eligible
  only after issue #93's surface-specific gates close. There is no approved
  product-wide Keyboardia visual target, mobile modes are intentionally
  different, and planned structural Stack C work supersedes B on its surface.
- **Protect the landed evidence before more product work.** Future manifest,
  comparator, or catalogue changes are prerequisite PRs; an implementation may
  not weaken its own evidence.
- **Do not treat Stack C as the final layer of one program.** Land contract
  repairs early when they unblock a surface; let intentional Stack C redesigns
  supersede Stack B for that surface; and deliver each product outcome as an
  independent vertical slice.
- **Stack C implementation is currently no-go; its contract/evidence PRs are
  go.** Resolve the coordinate classifier, published/tablet/orientation
  decisions, FX fork, affected touch policy, evidence tiers, and mutation/data
  ownership before implementing the corresponding mobile behavior.
