# Ableton Learning Synths — Envelopes Chapter & Playground Analysis

Primary-source analysis of the [Learning Synths](https://learningsynths.ableton.com/)
envelopes chapter and playground, compiled to inform Keyboardia development.
Companion to [ABLETON-LEARNING-MUSIC-ANALYSIS.md](./ABLETON-LEARNING-MUSIC-ANALYSIS.md)
(which was compiled from secondary web sources; this document is built from the
site's actual content data and JS bundle, so it also confirms several things the
earlier document marked "unconfirmed").

Pages analyzed:

- `/en/playground`
- `/en/envelopes/change-over-time`
- `/en/envelopes/synthesizer-envelopes`
- `/en/envelopes/attack`
- `/en/envelopes/decay-and-sustain`
- `/en/envelopes/release`
- `/en/envelopes/putting-the-envelope-together`
- `/en/envelopes/modulating-amplitude-with-envelopes`
- `/en/envelopes/matching-envelopes`

**Method note:** the site is fully client-rendered (empty HTML shell), so the
analysis comes from its runtime data files, which are plain JSON on the same
origin: `content/lessons/en/synthesis/lesson.json` (all chapters/pages as
markdown chunks + embed descriptors), `content/texts/en/*.json` (UI strings,
15 locales), `presets/preset-catalog.json` (38 presets), and
`presets/mapping-catalog.json` (XY macro mappings), plus the single
`js/musiclab.js` bundle and `rnbo/patches/learning-synth.json` (the compiled
synth patch). That this was possible at all is itself a finding — see
"Content-as-data architecture" below.

---

## How the site is actually built (confirmed)

- **UI**: React + TypeScript (production React externals), one `musiclab.js`
  bundle. (The Learning Music doc listed the framework as unconfirmed; for
  Learning Synths it is React.)
- **Synth engine**: a [RNBO](https://rnbo.cycling74.com/explore/learning-synths-and-rnbo)
  export of "Poli", a Max for Live subtractive synth by Christian Kleine
  (square + saw + noise), compiled to **WebAssembly running in an
  AudioWorklet**. The patch ships as JSON (`rnbo/patches/learning-synth.json`,
  ~575 KB) and is instantiated via the RNBO npm SDK (`createDevice`). Not
  Tone.js, not hand-written Web Audio graphs.
- **DSP ↔ UI contract**: RNBO exposes a typed parameter list; UI code sets
  parameters and subscribes to *message outputs* from the patch to drive
  visualizations (e.g. the dot tracing the envelope). The DSP is the source of
  truth for what is drawn.
- **Team/pedagogy lineage**: built by the team behind Learning Music — Jack
  Schaedler ("Seeing Circles, Sines and Signals") and Dennis DeSantis (Ableton's
  Head of Documentation). Schaedler's stated philosophy: you can't develop
  intuition for a concept unless you can play with it yourself.
- **Export to Live**: a server endpoint (`learningmusic-export.ableton.com/export-ls`)
  turns the current synth state into an Ableton Live set containing a Max for
  Live device built from the *same RNBO patch* — the sound you made in the
  browser is identical in the DAW. Recording (up to 60 s) was added in the same
  update.

---

## The envelopes chapter, page by page

The chapter is 8 pages. Each page is a markdown+embed sequence rendered around
the *same* synth engine, with different parameters exposed, locked, or hidden.

### 1. `change-over-time` — hook before terminology

Copy: "So far, you've made changes to sound by dragging the synth's controls by
hand. But you can also make a synthesizer change aspects of its sound
automatically."

The interactive is a **freehand drawing box** (`synth-envelope` embed, preset
`envelope-drawing`): you draw a curve, and the synth's *pitch* follows it
(±24 st range) on each note. Only after you've done this does the text name the
concept: "As you draw in the box, you're creating an *envelope* — the shape of
a sound changing over time."

**Lesson: experience first, vocabulary second.** The learner produces the
phenomenon before being told what it is called.

### 2. `synthesizer-envelopes` — the family of shapes, then the parts

Introduces the idea that synth envelopes are parameterized shapes, that a dot
traces the shape on each note, and — crucially — the **modulation framing**:
"You don't hear the envelope directly — the synth uses the envelope's shape to
determine how one or more *other* aspects of the sound change over time…
An envelope is an example of a modulator."

The interactive is an **XY pad morphing the whole envelope at once**
(`synth-panel` embed with `visualization: "adsr"`): the X axis simultaneously
moves attack (75→200→600 ms), decay (400→100→25 ms) and release
(150→500→900 ms) through designed piecewise-linear breakpoints; Y moves sustain
(0.1→0.9). A sequenced melody (`\tempo 4 = 85 e4 r e r8 e4 r8`) plays so every
drag is instantly audible. Then the page names the four stages and ADSR.

**Lesson: let the learner sweep the whole space with one gesture before
decomposing it.** A meta-control tuned so *every* position sounds musical gives
the "shape of the space" in seconds; the stage-by-stage pages then explain what
the gesture was made of.

### 3–5. `attack`, `decay-and-sustain`, `release` — one variable at a time

Each page uses the same `synth-adsr` embed (ADSR graph + drag handles + play
button) against the **pitch** modulation envelope, with everything not under
study *locked*. The attack page ships
`attack: 1000, decay: 1, sustain: 1, release: 1, lock: ["decay","sustain","release"],
show: ["x-axis","y-axis","attack-label","interaction-tooltip"]` — the other
stages aren't just fixed, their labels aren't even shown.

The decay/sustain page teaches the parameter *interaction* explicitly, as a
guided experiment: "Try turning the sustain all the way down and then adjust
the decay… Now turn the sustain all the way up… Notice the difference? With
sustain all the way up, decay has no effect."

Two non-obvious design choices worth stealing:

- **Envelopes are taught on pitch, not amplitude.** A pitch sweep is far more
  legible to an untrained ear than a loudness contour (you can literally hear
  where the dot is). Amplitude — the "real" everyday use — is deferred to page
  7, by which point the shape vocabulary is established. It also makes the
  modulation framing honest from the start: an envelope is a signal routed *to*
  something, not "the volume knob".
- **Hidden scaffolding keeps the studied variable audible.** The embeds set
  `linkRelease: true` (and on later pages `linkAttack/linkDecay/linkSustain`)
  so the amplitude envelope tracks the modulation envelope's times — otherwise
  the note would go silent before you heard the pitch release finish. The
  learner never sees this; it just always "works". Instructional interactives
  need this kind of invisible support tuning.

### 6. `putting-the-envelope-together` — recombine + transfer

All four controls unlocked (defaults A 750 ms / D 750 ms / S 0.25 / R 1000 ms).
The copy pushes transfer, not completion: "try to find some settings that
remind you of sounds you've heard. This process of exploration and comparison
is a big part of learning to make your own sounds."

### 7. `modulating-amplitude-with-envelopes` — same shape, new destination

Identical widget, but the four sliders now target
`amplitude_envelope_*` on a piano-ish preset: "Now, instead of adjusting an
envelope that modulates the pitch, we're adjusting an envelope that modulates
the amplitude." One concept (ADSR) is shown to generalize across destinations —
the payoff of the modulator framing.

### 8. `matching-envelopes` — worked examples against real instruments

Three paired examples, each a **real recording** (`one-shot-sampler` embed:
snare; clarinet with slow attack; clarinet with quieter sustain) next to a
synth ADSR preset approximating it, with prose explaining *why* each setting
was chosen: "We wanted this sound to get loud quickly, so we've set an
extremely short attack… sustain to zero and the decay and release to similar
(and fairly short) values." The presets honor the prose exactly: better-snare
is A=0 ms, S=0, D≈282 ms, R≈282 ms; slow-clarinet is A=5000 ms (the knob's
maximum) with S=1 — which is what makes its "decay doesn't matter" experiment
work. The slow-attack example even revisits the
degenerate case: "We've set a sustain of 100%… This means that decay time
doesn't matter; try adjusting it to different values and notice that it has no
effect."

**Lesson: end a chapter with ear-training against real-world referents**, not
a quiz. The "assessment" is perceptual comparison, and it doubles as a sound
design cookbook.

### Chapter-wide patterns

- Text chunks are short (1–3 sentences), alternating position
  (`classes: left/right/centered`), with **captions under widgets that are
  imperative instructions** ("Drag the **Attack** control left…"), never
  descriptions.
- The ADSR visualization is one consistent visual grammar reused everywhere;
  only the y-axis label changes meaning (`pitch` here, `amplitude` on page 7,
  `cutoff frequency` in the filters chapter). Stage labels show live value
  readouts next to the names.
- Every page's sound requires a user gesture (play button / press-and-hold
  key), which is both pedagogy and autoplay-policy compliance.

---

## The playground

The playground is the same engine with *all* panels revealed, organized in tabs
(**Sources / Amplitude / Filter / Modulation**) plus: Sequence (10 preset
sequences), Presets, Perform (XY macro pad), Keyboard (QWERTY playable),
Record, and Export-to-Live. The lesson chapters progressively "unlock"
mental models for panels that were always one synth.

Notable mechanics:

- **Lessons → playground continuity**: recipes and lessons can "open in
  playground" by writing `{preset, xPos, yPos, macroX, macroY, sequence}` to a
  localStorage clipboard the playground reads on load (an "original" copy is
  kept for reset). What you learned travels with you into the free space.
- **Macro XY mappings** (`mapping-catalog.json`) map pad axes onto *curated
  sub-ranges* of parameters (`minControlValue`/`maxControlValue` per target,
  multiple targets per axis) — e.g. wow-bass maps X to filter cutoff only
  between 153 Hz and 2.49 kHz. Guardrails ensure every pad position sounds
  good. A recipe page ("setting up your own controls") then teaches users to
  create their own mappings.
- **Sequences are human-writable text**, LilyPond-style with tempo and parallel
  voices: `\tempo 4 = 102  r8 c,8. c, c, c,8 bf16 c' // r8 hh r hh … // bd4 bd
  bd bd // r4 sn …` — content authors write rhythm in notation, not JSON grids.

### The synth's parameter surface (from the preset catalog)

Every preset stores, per parameter: value, min/max, **scaling curve**, and
**unit** — the UI knob taper is data, not code:

| Parameter | Range | Default | Scaling | Unit |
|---|---|---|---|---|
| `amplitude_envelope_attack` | 0–5000 ms | 30 | exponential^3 | time |
| `amplitude_envelope_decay` | 1–5000 ms | 200 | exponential^3 | time |
| `amplitude_envelope_sustain` | 0–1 | 0.75 | exponential^0.8 | percent |
| `amplitude_envelope_release` | 1–20000 ms | ~1008 | exponential^5 | time |
| `modulation_envelope_*` | same shapes | A/D ≈ 1000 ms | same | |
| `oscillator_pitch_offset_envelope_amount` | −48–+48 st | +24 | linear | pitch |
| `filter_envelope_amount` | −1–1 | 0 | linear | percent |
| `filter_frequency` | 20–20000 Hz | 6089 | **pitch** (log) | frequency |
| `lfo_frequency` | 0.1–1000 Hz | 0.5 | exponential^8 | frequency |
| `global_slew_time` | 0–5000 ms | **50** | linear | time |
| `glide_time` | 0–5000 ms | 0 | exponential^3 | time |

Points of interest:

- **Decay and release minimum is 1 ms, not 0** (attack may be 0); release max
  is 20 s with a very steep taper so the knob's useful low range stays wide.
- **Bipolar modulation amounts** (−1…+1, or ±48 st for pitch): one modulation
  envelope and one LFO are routed to multiple destinations (pitch, filter,
  pulse width, amplitude, LFO rate) each with its own amount — a small fixed
  mod matrix that beginners can't wire into a broken state.
- **`global_slew_time` = 50 ms default**: every parameter change is smoothed in
  the DSP. Dragging never produces zipper noise. This is a patch-level
  property, not per-UI-control code.
- The envelope drawing page and LFO pages reuse `isModulationTarget` flags on
  parameters (pitch offset, filter freq, pulse width, amplitude) — the
  routable surface is explicit metadata.
- The release-stage visualization is backed by an `ADSRHistory` class that
  records *where in the envelope the note was at release*
  (`attackPctAtRelease`, `decayPctAtRelease`, `sustainEnteredAtRelease`) so a
  note released mid-attack draws (and sounds) a release **from the current
  level**, not from sustain. The visualization never lies about the audio.

---

## Content-as-data architecture

The entire course is data, cleanly separated from code:

```
content/lessons/en/synthesis/lesson.json   # every chapter/page: markdown chunks
                                           #   + embed descriptors with props
content/lessons/en/synthesis/<sample>.wav  # lesson audio (snare, clarinet…)
content/texts/<locale>/<namespace>.json    # all UI strings, 15 locales
presets/preset-catalog.json                # 38 named presets (param snapshots
                                           #   with min/max/scaling/unit)
presets/mapping-catalog.json               # named XY macro mappings
rnbo/patches/learning-synth.json           # the compiled synth itself
```

A lesson page is literally a list like:

```json
{ "markdown": "An envelope's *attack* control determines…" },
{ "metadata": { "embed": "synth-adsr", "preset": "pitch-modulation-envelope",
    "attack": 1000, "lock": ["decay","sustain","release"],
    "show": ["x-axis","y-axis","attack-label","interaction-tooltip"],
    "notes": "e,", "linkRelease": true,
    "yAxisLabelKey": "envelopes:axisLabels.pitch" } },
{ "markdown": "Drag the **Attack** control left…", "metadata": { "classes": "centered caption" } }
```

Consequences: content authors compose interactive lessons without touching
code; localization is complete (15 languages including vertical CJK layouts);
the embed vocabulary (~a dozen components: `synth-adsr`, `shared-synth`,
`synth-panel`, `synth-envelope`, `one-shot-sampler`, 3D scenes…) is the entire
"lesson API". Eight lesson pages required zero bespoke pages — only presets,
props, and prose.

---

## What Keyboardia should take from this

Where Keyboardia stands today (verified against the code, 2026-08-04):

- **Envelope correctness is already solved — and independently converged with
  Ableton's design.** `synth.ts` releases from the *analytically computed*
  current envelope value (`holdAtTime` + `amplitudeAt()`,
  `app/src/audio/synth.ts:1004-1046`), guarded by
  `synth-envelope.render.test.ts`, because reading `AudioParam.value`
  "collapsed every release to near-silence". Learning Synths solves the exact
  same released-mid-attack problem on the visualization side with its
  `ADSRHistory` class (`attackPctAtRelease`, `decayPctAtRelease`). Validation
  that this correctness detail is load-bearing, and a ready-made pattern for
  when Keyboardia draws envelopes: the drawn release must start where the
  audio's release starts, and `amplitudeAt(t)` already computes exactly that
  curve.
- **ADSR is effectively invisible to users.** All 51 synth presets ship fixed
  envelopes (`SYNTH_PRESETS` at `synth.ts:85`, `ADVANCED_SYNTH_PRESETS` at
  `advancedSynth.ts:74`, `TONE_SYNTH_PRESETS` at `toneSynths.ts:55`). The only
  runtime path is the XY pad's `envelope-shape` preset (X→attack, Y→release,
  `xyPad.ts:76-82`), which reaches **only** advanced-synth tracks
  (`engine.ts:1402-1428`) and hides behind a dropdown. No component anywhere
  draws an envelope. There is no roadmap item for an envelope editor.
- **Every native preset has a fast attack by design.** The slowest of the 32
  is 0.05 s, with comments like "Fast attack for step sequencer compatibility"
  (`synth.ts:109,196,237,255`); pad character comes from release, not attack.
  The constraint traces to fixed note gates: every note is
  `stepDuration × tieCount × 0.9` (`timing-calculations.ts:93-117`). Ties
  *are* implemented (per-step `tie` p-locks), which is what makes longer
  attacks newly viable on tied notes.

### Recommendations, ranked

1. **Build the ADSR editor + visualization, using Learning Synths' visual
   grammar.** One SVG component: envelope polygon, drag handles per stage,
   stage labels with live value readouts, a playhead dot driven during playback
   — with the y-axis label as a prop (`amplitude` now; `cutoff`/`pitch` later),
   exactly as Learning Synths reuses one component across modulation
   destinations. Keyboardia already has the audio-side math (`amplitudeAt`)
   and the precedent UI idioms (VelocityLane drag-editing, PitchContour SVG).
   Prerequisite plumbing: ADSR setters that fan out to *all three* engines,
   not just `advancedSynthRegistry` — today `setAttack`/`setRelease` skip the
   32 native and 11 Tone.js presets entirely.

2. **Adopt parameter-descriptor metadata as the contract.** Learning Synths
   attaches `{min, max, default, scaling, unit}` to every parameter *as data*,
   and every knob, macro mapping, preset, and the Live export consume the same
   descriptors. Keyboardia has fragments of this (`XYPadMapping` curves in
   `xyPad.ts:41-47`, `EFFECT_PARAM_MAP` in `effect-param-mapping.ts`) but no
   shared descriptor. One table serving the UI, the MCP tool contract, session
   notation, and validation would collapse three current ad-hoc layers.
   Steal the tapers directly: time knobs exponential^3, release ^5 (max 20 s),
   sustain ^0.8, filter cutoff on a pitch (log) scale — and the 1 ms floor on
   decay/release (attack alone may be 0; Keyboardia's current 0.001 s clamp is
   equivalent).

3. **Upgrade the XY pad to macro sub-range mappings, and surface it.**
   Ableton's `mapping-catalog.json` maps each axis to *curated sub-ranges* of
   one or more parameters (`minControlValue`/`maxControlValue` per target) so
   every pad position sounds good — guardrails, the same philosophy as
   Keyboardia's scale lock, applied to timbre. Keyboardia's
   `XYPadController.setMappings()` already accepts custom mappings
   programmatically; nothing exposes it, and ROADMAP's "XY Pad accessible from
   synth tracks" remains unchecked. Sub-range mapping data + per-preset default
   mappings would make the existing engine feature shippable; user-savable
   mappings (Ableton teaches users to build their own in the
   "setting up your own controls" recipe) can follow.

4. **Add a global parameter-slew convention.** The RNBO patch smooths every
   parameter change with `global_slew_time` = 50 ms, so dragging never zippers.
   Keyboardia declicks note starts (3 ms fades, `note-schedule.ts`) but has no
   uniform smoothing for *parameter* changes (XY drags, future ADSR drags).
   A 30–50 ms `setTargetAtTime` convention at the engine boundary — one rule,
   all engines — prevents a whole bug class the repo's AUDIO-ENGINEERING
   docs already chase case-by-case.

5. **Generalize the modulation envelope with bipolar amounts.** Learning
   Synths runs *one* mod envelope into pitch (±48 st), filter, and pulse width
   via per-destination amount knobs — beginners can't wire a broken state, but
   808-drops, lasers, and plucked basses all fall out. Keyboardia's native
   `filterEnv` (already implemented, contra the stale spec) has no release
   segment and no amount generalization; a pitch-envelope amount on synth
   voices is the single highest-fun-per-effort addition (SYNTHESIS-ENGINE.md
   already estimates filter-envelope work at 1–2 days).

6. **Revisit the fast-attack rule now that ties exist.** "Attack < 0.1 s for
   120 BPM" was validated when every note lasted ≤ 90% of one step. With tied
   notes spanning steps, slow-attack pads (Ableton's slow-clarinet lesson
   preset uses a full 5 s attack; Keyboardia's own `advancedSynth` warm-pad
   uses 0.5 s) become musically reachable. Envelope defaults could stay fast while
   the editor (rec. 1) lets users opt into slowness — and the
   decay-and-sustain lesson's degenerate-case walk ("with sustain all the way
   up, decay has no effect") is a preset-audit lens: several native presets
   with sustain ≥ 0.9 carry decay values that do nothing.

### Product/pedagogy patterns (longer horizon)

- **Lessons are data; Keyboardia already has the substrate.** An Ableton
  lesson page = markdown chunks + embed descriptors + a preset name — no
  bespoke code per page. Keyboardia's equivalent primitives exist: published
  sessions, session notation, remix, and MCP. A "recipes" surface — published
  sessions annotated with short imperative captions ("Drag the swing up.
  Notice the hi-hats.") that open via remix — is the Learning Synths
  lessons→playground clipboard, multiplayer-flavored.
- **Isolate-one-variable scaffolding.** Every teaching embed is the full synth
  with stages *locked* and labels *hidden* (`lock:`, `show:` props). If
  Keyboardia builds any guided mode, lockable/hideable controls on existing
  components are the mechanism — not separate teaching widgets.
- **Ear-anchoring against real instruments.** The matching-envelopes page
  pairs real recordings with synth approximations and explains each setting
  choice in one sentence. Keyboardia uniquely has both engines in one app
  (27 sampled instruments + 51 synth presets); pairing them ("here's the 808
  kick sample; here's the synth preset that approximates it; here's why") is
  a differentiated learning surface no single-engine app can copy.
- **Notation gap, cheap to close later:** SESSION-NOTATION.md v2 can express
  `[fm:H,M]` per track but nothing about envelopes; an `[env:A,D,S,R]`
  annotation would slot into the existing grammar once ADSR becomes editable
  (the notation spec explicitly lists automation curves as out of scope — a
  static per-track ADSR is not automation and fits).

### Incidental spec drift found during this research

Worth a cleanup pass, since several statements no longer match the code:

- `specs/HELD-NOTES.md` says "Status: Proposal — Implementation has not
  started", but ties shipped (per-step `tie` p-locks; notation v1.4 lists them
  ✅; gate mode was removed in Phase 29G).
- `specs/SYNTHESIS-ENGINE.md` limitations list "No filter envelope on Web
  Audio synths" and "No LFO on Web Audio synths" — both now exist in
  `synth.ts` (`filterEnv` at :903-945, LFO at :840-863).
- `specs/SYNTHESIS-ENGINE-ARCHITECTURE.md` says 24 native presets; there are 32.
- `README.md` counts "70 Sound Generators (32 + 11 + 27)" but omits the 8
  `advanced:` presets, and its "40+ presets" claim for `synth.ts` is wrong.

---

## Sources

- [Learning Synths](https://learningsynths.ableton.com/) — content JSON, preset
  catalog, mapping catalog, and `musiclab.js` bundle (fetched 2026-08-04)
- [Learning Synths and RNBO — Cycling '74](https://rnbo.cycling74.com/explore/learning-synths-and-rnbo)
- [Engadget: Learning Synths adds record & export](https://www.engadget.com/ableton-learning-synths-update-185544128.html)
- [NYU MusEDLab on Ableton's learning sites](https://wp.nyu.edu/musedlab/2017/05/30/learning-music-from-ableton/)
- [ABLETON-LEARNING-MUSIC-ANALYSIS.md](./ABLETON-LEARNING-MUSIC-ANALYSIS.md) (companion doc)
