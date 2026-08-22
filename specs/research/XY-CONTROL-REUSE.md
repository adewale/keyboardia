# XY Control Reuse in Keyboardia

**Status:** Accepted design input for `ADSR-OVERHAUL-v2`  
**Date:** 2026-08-22

## Decision

Keyboardia SHOULD reuse the XY pad's normalized two-dimensional gesture and
batch-transaction machinery. It MUST NOT treat the current list of parameter
mappings as a generally reusable product surface.

An XY control is justified only when:

1. both axes describe one coherent musical gesture;
2. the target and scope are visible before the gesture starts;
3. both values have canonical state or are explicitly labelled as temporary
   performance preview;
4. the pad derives its position from that state rather than becoming a second
   source of truth;
5. the exact underlying values remain visible and independently editable; and
6. one gesture previews locally and commits one atomic mutation.

This is stricter than “two parameters fit in a square.” Parameter mapping
changes how an electronic instrument feels, and accidental coupling makes
precise editing harder.

## Repository audit

The existing implementation contains three different layers that must be
separated before reuse:

| Layer | Current implementation | Reuse disposition |
|---|---|---|
| Gesture | `components/XYPad.tsx` clamps a normalized position, supports pointer and keyboard input, previews continuously, batches a gesture, commits once, and supports Escape rollback | reuse after accessibility work |
| Mapping | `audio/xyPad.ts` maps X/Y to a closed union of synth and effect parameter names with linear or quadratic curves | split into domain-owned macro definitions |
| Routing/state | `Transport.tsx` sends effects, envelopes, and synth controls through different state paths | do not generalize until every destination declares scope, persistence, sync, and reconciliation |

The current presets are not equally safe:

- `space-control`, `reverb-control`, and `delay-modulation` write the synced
  global `EffectsState` in one batch. A global FX panel is the right scope.
- `envelope-shape` derives Attack/Release from the selected track and commits a
  per-track envelope mutation. Its state behavior is sound, but the control is
  located in a global FX panel rather than next to the track it changes.
- `filter-sweep`, `lfo-control`, and `oscillator-filter` call shared engine
  setters. Those setters fan out to every registered advanced synth and store
  local engine overrides for synths created later. They are not canonical
  per-track session state, so they do not persist, publish, remix, reconnect, or
  give collaborators the same sound.
- `XYPadState` can serialize position and mappings, but production code does not
  put that object in session state. `xyPreset` and `xyPos` are local React state.
  The header comment calling the controller “multiplayer-syncable” therefore
  describes a possible capability, not shipped behavior.

The component also exposes a two-dimensional control as one ARIA `slider` whose
numeric value is only X. ARIA's slider pattern is one-dimensional. General reuse
MUST provide two independently operable exact controls and tested composite
semantics rather than relying on `aria-roledescription` to create a new widget
contract.

## Product precedent

- [Ableton Learning Synths](https://learningsynths.ableton.com/en/recipes/setting-up-your-own-controls)
  teaches mapping explicitly: X and Y are assigned to named controls, reachable
  ranges are visible and editable, and moving an underlying control can remove
  its mapping. Keyboardia should show axis names, values, ranges, and targets;
  preset names alone are not enough.
- [Apple Alchemy](https://support.apple.com/en-ie/guide/logicpro/lgsi6215646f/10.7/mac/11.0)
  uses XY both for two-parameter performance control and for meaningful
  four-source crossfade/morph geometry. It also keeps exact performance
  controls and snapshots around the pad.
- [Korg KAOSS](https://www.korg.com/download/global/html_manual/kaossreplay/us/index.html)
  treats XY as a live performance instrument and records the gesture as Pad
  Motion. This is precedent for future Keyboardia automation, not permission to
  smuggle ephemeral sound changes into a persistent collaborative session.
- [Teenage Engineering OP-Z](https://teenage.engineering/guides/op-z/general-operation)
  records live parameter tweaks into steps and supports deliberate per-step
  locks. Keyboardia should reuse its existing p-lock model before inventing a
  second automation format for step-scoped XY gestures.

## Recommended Keyboardia uses

| Priority | Surface | X | Y | Scope/state | Decision |
|---|---|---|---|---|---|
| Now | Master Space | reverb amount | delay amount | synced global effects | keep in FX panel |
| Now | Master Reverb/Delay | wet amount | decay or feedback | synced global effects | keep as named performance macros with exact sliders below |
| Now | Track Shape | Start: Sharp to Gentle | Tail: Tight to Long | selected track envelope | move beside the track; make this part of the musical Shape layer |
| Prototype | Step Expression | pitch | velocity | selected step's existing p-locks | useful for exploration, but ship only if task tests show coupling beats two direct fields |
| After state work | Track Tone | brightness/cutoff | edge/resonance | new canonical per-track synth state | replace the current global ephemeral filter preset |
| After state work | Track Movement | rate | depth | new canonical per-track modulation state | capability-gated; never silently affect every synth track |
| After state work | Track Mix | pan | level | selected track; requires canonical pan state | place in Mixer, not FX |
| Later research | Sound morph | two-dimensional interpolation between four named snapshots | track or instrument snapshot state | promising, but interpolation, capability, CPU, and migration semantics need a separate spec |
| Later research | Motion recording | time-varying XY gesture | automation lane with overdub/conflict rules | strong performance value; needs a canonical automation model, sampling/simplification policy, and multiplayer merge semantics |

The Step Expression prototype MUST make the selected step unmistakable, batch
pitch and velocity as one p-lock mutation, and keep the existing numeric
controls. If users repeatedly move one parameter accidentally while targeting
the other, reject the pad and keep independent controls.

## Uses that should not become XY pads

- Full A/H/D/S/R editing: four dependent stages belong on the envelope curve
  and in exact fields. The two-axis Start/Tail macro is a friendly summary, not
  a replacement for the model.
- Trigger/Gate/Loop or AD/AHD/AR/ADSR selection: these are discrete, visible
  modes and must use labelled choices.
- Sample start/end or loop points: constrained handles on the waveform preserve
  ordering and show the audio evidence directly.
- Tempo and swing: they are global but not one perceptually coherent gesture;
  accidental tempo movement is especially disruptive.
- Pattern density/randomness: continuous generation rewrites many steps and is
  difficult to explain, undo, merge, and reproduce. It needs a separately
  previewed transformation tool if pursued.

## Required architecture

Refactor toward three domain-independent pieces:

```ts
interface XYMacroAxis {
  id: string;
  label: string;
  lowLabel: string;
  highLabel: string;
  format(value: number): string;
}

interface XYMacroDefinition<State, Mutation> {
  id: string;
  name: string;
  scope: 'global' | 'track' | 'step';
  x: XYMacroAxis;
  y: XYMacroAxis;
  isAvailable(state: State): boolean;
  derivePosition(state: State): { x: number; y: number };
  preview(state: State, position: { x: number; y: number }): State;
  commit(baseline: State, draft: State): Mutation;
}
```

- `XYGestureSurface` owns normalized pointer/keyboard mechanics only.
- `useBatchedGesture` owns baseline, local preview, cancel, single commit,
  rejection, and remote reconciliation.
- Envelope, effects, step locks, and future synth domains own their macro
  definitions and validation. The audio folder MUST NOT become the source of
  truth for UI, protocol, and state semantics.
- Macro position is derived from canonical state. Do not sync an additional
  generic `XYPadState` unless motion recording becomes its own authored object.
- Each pad shows friendly axis endpoints and live exact values. Its detailed
  controls are the accessible and precision-editing alternative.

## Acceptance gates

Every shipped macro MUST prove:

- domain range, monotonicity, inverse/round-trip, clamping, and finite-value
  properties;
- exactly one destination classification per mapped value;
- exact target scope: global, one track, or one selected step;
- local preview plus exactly one canonical mutation per pointer or keyboard
  transaction, including cancellation, lost capture, rejection, and reconnect;
- two-client convergence and reload/publish/remix persistence when the macro is
  authored state;
- capability gating with no silent no-op;
- friendly labels, two independent exact inputs, touch and keyboard operation,
  screen-reader output for both values, and at least 24 by 24 CSS-pixel targets;
- observed-task evidence that users can predict both audible consequences and
  identify the target before moving the pad;
- no initial-bundle dependency and no animation/automation data growth unless
  separately budgeted.

Until these gates pass, the current global synth presets are developer preview
controls, not reusable session features.
