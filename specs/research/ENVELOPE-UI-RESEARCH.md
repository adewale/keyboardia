# Envelope UI Research and Decision

**Status:** Accepted design input for `ADSR-OVERHAUL-v2`; D2 implementation pending  
**Date:** 2026-08-22

## Decision

Replace the proposed always-visible four-linear-slider strip with a
capability-aware, three-level editor:

1. A compact per-track summary shows a miniature envelope, effective model,
   sample playback behavior, a friendly Shape name, and Preset/Override state.
2. Activating it opens a musical Shape editor attached to that track (inline on
   desktop, bottom sheet on mobile). It leads with playback behavior, named
   `Hit`/`Pluck`/`Hold`/`Swell` recipes, and `Start` and `Tail` character
   controls. `Details` reveals the exact envelope model.
3. The exact layer combines a responsive envelope graph with stage fields. The
   graph supports direct manipulation, immediate local audio preview, and
   one synced mutation per completed drag. It is not the only input method.
4. Exact fields support keyboard, single-pointer, screen-reader, and typed
   entry. Only meaningful stages appear; incompatible sample modes are not
   offered.
5. Per-step envelope locks stay in the selected-step editor. The XY gesture
   primitive may power the Shape layer's selected-track `Start`/`Tail` macro,
   but the global FX pad is not the canonical envelope editor.

## Why the existing proposal is insufficient

The first `EnvelopeEditor.tsx` strip rendered A/D/S/R for every instrument, used
one detached seconds/steps selector, mapped multi-order-of-magnitude times onto
linear HTML ranges, and emitted `onChange` continuously. That conflicted with
the v2 model, where AD, AHD, AR, and ADSR are distinct; duration units belong to
each value; some samples are trigger/gate/loop capable; and a drag is one network
transaction. The shipped exact editor has corrected those mechanics.

The strip also spends scarce track width on controls most users are not editing
and becomes a two-column stack below 900 px. It communicates numbers but does
not teach how stages relate over time or why a control is absent for a finite
sample.

The earlier two-level replacement still jumped from a descriptive summary
straight to graph handles, A/H/D/S/R names, numeric ranges, and units. Ableton's
Learning Synths tutorial shows the missing teaching step: let the user hear and
manipulate a small number of consequences, give those consequences musical
names, then reveal the conventional synthesis model. Keyboardia therefore adds
a musical middle layer without weakening its exact, notation-safe state.

## Research synthesis

- Seago, Holland, and Mulholland found a semantic gap between synthesizer
  control languages and musicians' descriptions, and recommend multiple levels
  of interaction with unwanted complexity hidden. This supports a musical
  summary plus an exact advanced layer rather than exposing the engine schema
  all at once. [Paper](https://oro.open.ac.uk/5688/1/HCI%202004%20SEAGO%20timbre%20UI.pdf)
- Hunt, Wanderley, and Paradis show that parameter mapping materially changes
  the character of an electronic instrument. The XY mapping must therefore be
  explicit and stable, not an incidental shortcut that silently writes state.
  [Research record](https://pure.york.ac.uk/portal/en/publications/the-importance-of-parameter-mapping-in-electronic-instrument-desi-2/)
- Wessel and Wright identify low and low-variance latency, a coherent control
  model, initial approachability, and room for learned skill as criteria for
  intimate musical control. This supports frame-rate local preview with a
  deterministic commit boundary. [NIME paper](https://www.nime.org/proc/nime2001_wessel/index.html)
- The Timbre Explorer pairs simplified continuous controls with live graphs and
  retains advanced controls for progression. Its envelope visualization gives
  users immediate visual and audio feedback instead of expecting ADSR
  terminology to carry the explanation. [NIME paper](https://nime.pubpub.org/pub/q5oc20wg/release/1)
- JUCE's official audio-UI guidance recommends nonlinear slider mappings for
  time and frequency because small values need finer control. Keyboardia's
  attack/release positioning must be perceptual/log-like while serialization
  remains exact. [JUCE tutorial](https://juce.com/tutorials/tutorial_slider_values/)
- WAI's slider pattern requires meaningful values and conventional keyboard
  operation. WCAG 2.2 also requires a non-drag single-pointer alternative and
  at least 24×24 CSS-pixel targets or sufficient spacing. A custom graph alone
  would not meet this bar. [Slider pattern](https://www.w3.org/WAI/ARIA/apg/patterns/slider/),
  [dragging](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html),
  [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Ableton Learning Synths](https://learningsynths.ableton.com/en/get-started)
  introduces one audible relationship at a time, keeps controls beside the
  sound they change, makes reset safe, and finishes with recipes and a
  playground. Its
  [mapping recipe](https://learningsynths.ableton.com/en/recipes/setting-up-your-own-controls)
  makes X/Y assignments and reachable ranges visible. This supports a
  hear-name-combine-explain progression and transparent macros rather than a
  preset picker that hides what is moving.

This is a synthesis of the sources, not a claim that any one paper specifies
Keyboardia's component layout.

## Product and repository precedent

- Ableton Simpler separates Classic looped behavior from One-Shot Trigger/Gate
  behavior instead of asking one four-stage panel to explain source lifecycle.
  Keyboardia should make playback behavior visible beside, but distinct from,
  the curve. [Ableton instrument reference](https://www.ableton.com/en/manual/live-instrument-reference/)
- Teenage Engineering exposes full ADSR for OP-1 synth engines while its drum
  workflow uses controls suited to sample playback. This supports capability-
  specific stages rather than disabled universal knobs.
  [OP-1 guide](https://teenage.engineering/guides/op-1),
  [synthesizer mode](https://teenage.engineering/guides/op-1/original/synthesizer-mode)
- Elektron places AHD/ADSR selection and per-trig parameter locks in different
  editing contexts. Keyboardia should keep track shape in the track editor and
  onset-specific locks in the step editor.
  [Digitakt II manual](https://www.elektron.se/wp-content/uploads/2025/07/Digitakt-2-User-Manual_ENG_OS1.15A_250708.pdf)
- Keyboardia's own `UI-PHILOSOPHY.md` says controls live where they act, modes
  stay visible, and progressive disclosure happens on the target. The inline
  desktop editor/mobile sheet follows that rule more closely than a global
  envelope modal.
- Apple Alchemy uses XY for two-parameter performance controls and for
  four-corner source morphing while retaining surrounding exact controls and
  snapshots. Korg treats pad motion as recordable performance. These are useful
  future precedents, but Keyboardia first needs explicit target scope and a
  canonical automation model. The code audit and reuse decision are recorded in
  `specs/research/XY-CONTROL-REUSE.md`.

## Interaction architecture

### Collapsed summary

Each track shows one target such as:

```text
Shape  Pluck · Note length   ╱╲___   Preset
```

The graph is descriptive here. The whole target opens the editor, avoiding four
additional focus stops on every track. Unsupported authored state shows a
warning badge without being deleted. The technical model remains available in
the accessible description and exact layer, but is not the first label a novice
must decode.

### Musical Shape editor

The default expanded state answers three questions in this order:

```text
Playback  [One-shot] [Note length] [Loop]
Character [Hit] [Pluck] [Hold] [Swell]
Start     Sharp  ─────●─────  Gentle
Tail      Tight  ───●───────  Long
                           [Details…]
```

- **Playback** is lifecycle, not character. The labels map to supported
  `Trigger`/`Gate`/`Loop` behavior and unsupported choices are absent with an
  explanation.
- **Character recipes** are capability-aware starting points, not new canonical
  values: `Hit` has an immediate start and short body; `Pluck` has an immediate
  start and natural decay; `Hold` continues while the note is held; `Swell` has
  a gentle start and lingering tail. Applying one writes a documented envelope
  through the same mutation path as exact editing.
- **Start** maps the active attack stage from `Sharp` to `Gentle`.
- **Tail** maps the effective decay/release behavior from `Tight` to `Long`.
  For Trigger/AHD sources this primarily shapes hold/decay; for Gate/Loop
  sources it shapes release. The live label MUST say what it changes.
- Friendly values such as `Instant`, `Short`, `Medium`, `Long`, and `1/4 beat`
  are shown before raw seconds. `Details` reveals exact values and per-stage
  units without changing the draft.
- Each recipe includes a short audible comparison against the prior state and
  Reset remains visible. Recipe mappings are versioned fixtures, not hidden
  heuristics that drift between the UI, MCP, and documentation.

The curve animates only while auditioning the selected track: it marks onset,
the current phase, note-off, and the release tail. Animation is explanatory,
not canonical timing evidence, and respects reduced-motion preferences.

### Exact editor

- **Behavior:** model and `Trigger`/`Gate`/`Loop`, constrained by capability.
- **Shape:** an SVG curve generated by the same pure semantic oracle used by
  audio tests. Large stage handles support mouse, pen, and touch.
- **Exact values:** one row per active stage with a nonlinear slider, editable
  numeric value, and per-stage `ms`/`s`/`st` unit. Sustain is a percentage or
  normalized level, never a time.
- **Context:** source capability explains finite buffer, sample loop, or
  recorded release. Preset/Override and Reset are always visible.
- **Audition:** keyboard or pointer changes preview the selected track locally;
  focus/typing never triggers unrelated global shortcuts.

The curve's visual x-coordinate is a presentation mapping, not canonical
seconds. Durations use a reversible nonlinear position/value function with
declared anchor points. The field always displays the exact canonical value.

### Responsive behavior

- Desktop: editor expands directly below the target track.
- Mobile: the same component model appears in a bottom sheet with at least
  24×24 CSS-pixel targets; prefer larger touch targets where space permits.
- Portrait: no rotated or pointer-only variant with different semantics.
- Screen reader: the graph is a labelled summary; native or conformant stage
  controls expose model, stage, value, unit, min/max, and inactive reason.
- Dragging: direct handles are supplemented by single-click track positioning,
  arrow/Page/Home/End keys, and numeric entry.

### State and component boundary

Use a headless editor model rather than embedding protocol logic in controls:

- `EnvelopeSummary`: effective/authored/capability overview;
- `EnvelopeShapeControl`: friendly playback, recipe, Start, and Tail layer;
- `EnvelopeCurve`: SVG presentation plus optional direct handles;
- `EnvelopeStageField`: exact value/unit, nonlinear mapping, keyboard behavior;
- `SamplePlaybackControl`: only supported playback choices;
- `useEnvelopeDraft`: baseline, local preview, one commit/cancel/reconcile;
- shared pure functions for curve landmarks and position/value conversion.
- versioned pure recipe/macro mappings from character controls to canonical
  envelope state and back to the nearest descriptive label.

Do not add a charting or knob library. A small SVG path and native form
controls are sufficient and keep bundle/accessibility behavior reviewable.

The measured 2026-08-03 build already preloads 218.1 KiB gzipped JavaScript,
above the repository's older 200 KB goal. `EnvelopeEditor` is currently reached
through the code-split StepSequencer chunk. The new editor must preserve that
lazy boundary, report its own chunk delta, and avoid making the graph part of
the landing-page module graph.

## Validation before production UI

Prototype the editor against a deterministic local audio session before wiring
multiplayer. Run a cognitive walkthrough and observed tasks with at least
novice and experienced synthesizer users:

- make a sound more percussive;
- make a synth swell slowly;
- shorten a finite sample without claiming sustain;
- switch a looped sample between gate and loop where supported;
- restore the preset;
- add a release lock to one onset;
- complete the same tasks with keyboard and mobile touch.

The four mandatory guided exercises mirror the learning progression rather than
opening with definitions:

1. make a snare tighter;
2. let a pluck ring longer;
3. make a pad swell;
4. make the looped Hammond stop naturally on release.

Record completion, wrong-control choices, reversals, inactive-control attempts,
and the user's explanation of what will happen at note-off. A visually polished
editor fails if users cannot predict the audible result.

## Acceptance criteria

- Active model/stages and sample behavior come from one capability registry.
- The compact summary, Shape layer, and exact layer form one reversible draft;
  opening Details never changes sound or discards state.
- Hit/Pluck/Hold/Swell mappings are documented fixtures, capability-aware, and
  round-trip through canonical envelope state within declared label bands.
- Playback and character remain separate; no recipe silently enables Loop or
  claims sustain for a finite one-shot.
- The curve and audio oracle share landmarks but not UI state.
- Position/value mappings round-trip at boundary and representative values.
- Every drag previews locally and commits exactly once; Escape cancels.
- Exact entry, keyboard operation, and single-pointer alternatives cover every
  direct-manipulation action.
- Screen-reader output contains friendly values and units.
- Any two-axis Start/Tail surface names its selected track and both audible
  consequences, while independent exact controls remain available.
- No new chart/knob dependency enters the initial bundle.
- Desktop, mobile, two-client reconciliation, and real audio preview tests pass.
