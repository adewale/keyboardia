# Stack A identity gate

This gate verifies that the CSS-only Stack A refactor preserves the explicitly
covered rendered and interactive contracts. It compares the merge base with
the working tree in the same canonical browser process across the states in
the reviewed identity manifest.

## Run it

```sh
npm run test:identity
```

The comparison server creates a temporary worktree at the merge base, builds
both revisions, and serves them at `/base` and `/head`. It removes the worktree
when the run finishes. Set `STACK_A_BASE_REF` to compare against a ref other
than `origin/main`. If the default local ports are occupied, set
`STACK_A_COMPARISON_PORT`, `STACK_A_BASE_PRODUCT_PORT`, and
`STACK_A_HEAD_PRODUCT_PORT` to three free ports.

## What is compared

Every state must preserve all three contracts:

- viewport screenshot pixels with at most 6/255 per-channel raster noise;
- the Playwright ARIA snapshot;
- computed presentation styles and element geometry.

The screenshot comparator requires zero pixels beyond that narrow channel
allowance. It reports the raw pixel count and largest observed channel delta on
failure. Computed styles and geometry remain exact, so the tolerance cannot
hide a CSS value or layout change. Finite animations are advanced
to their end state and infinite animations are paused at time zero before
capture.

The reviewed manifest covers desktop, mobile portrait, and both narrow and wide
mobile landscape, including
open, closed, selected, focused, disabled, reduced-motion, and interaction
outcomes. Failed runs retain before, after, diff, screenshot, and trace
artifacts.

## Why a catalogue instead of Storybook

The repository did not have Storybook and installing new Storybook packages was
not available in the implementation environment. `stack-a.html` and
`src/stack-a-catalog/` provide the relevant Storybook property here: isolated,
named, deterministic component states driven by real controls. The catalogue
has a separate Vite entry and is not part of the production application bundle.

Storybook can replace the catalogue later without changing the identity
manifest or the three comparison contracts.

## One-PR bootstrap and future authority

The merge base for this first PR predates the harness. To make its before/after
comparison possible, the server copies only the catalogue and Vite entry into
that temporary base checkout; it never copies components or product CSS.

Once the harness exists in the merge base, the server uses that base-owned
catalogue and refuses simultaneous edits to protected identity files. Harness
updates therefore land as explicit prerequisite PRs by setting
`STACK_A_ALLOW_HARNESS_CHANGES=1`; ordinary product refactors cannot weaken
their own evidence.

Portrait and landscape entries exercise responsive CSS in canonical Chromium.
A separate mobile-WebKit project uses emulated touch (`hasTouch`); neither lane
claims physical-device safe-area, browser-chrome, audio, or gesture coverage.
