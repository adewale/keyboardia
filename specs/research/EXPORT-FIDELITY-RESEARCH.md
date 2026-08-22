# Export Fidelity Research and Decision

**Status:** DEFERRED RESEARCH — NOT IN `ADSR-OVERHAUL-v2.md`  
**Date:** 2026-08-03

Keyboardia v2 keeps the existing simple one-click SMF export. This document is
retained as research for a separately scoped future export project; its package,
audio, DAWproject, plug-in, UI, security, and verification requirements are not
part of the ADSR implementation plan.

## Deferred recommendation

If richer export is reopened, Keyboardia should not try to make Standard MIDI
File (SMF) a lossless session format. No portable MIDI encoding can preserve Keyboardia's instrument
implementation, sample identity, AHD/AR/ADSR model, mixed time units, sustain
loops, release layers, per-step envelope locks, effects, or renderer state.

The deferred research proposes a fidelity ladder with deliberately different
promises:

| Product | Promise | Editable? | Sounds the same? | Portable? |
|---|---|---:|---:|---:|
| Keyboardia Project (`.keyboardia`) | exact Keyboardia state | fully, in Keyboardia | yes, subject to declared engine/version compatibility | Keyboardia only |
| MIDI Performance (`.mid`) | notes and timing | broadly | no | broadest |
| Audio Mix/Stems (`.wav` or `.flac`) | rendered sound | audio editing only | yes, to render tolerance | broad |
| DAWproject (`.dawproject`, experimental) | richer DAW handoff | partly | only for represented/shared features | selected DAWs |

This is the solution to the fidelity problem: preserve state, performance, and
sound as separate artifacts instead of making one artifact make three false
promises.

## What comparable tools do

The consistent industry pattern is a native project plus one or more lossy
interchange/render formats:

| Tool or format | Exact state | Performance exchange | Audible exchange | Lesson for Keyboardia |
|---|---|---|---|---|
| Ableton Live | A Live Set saves clips/settings; Live Projects collect related assets | exported SMF is explicitly different from a Live Clip | main mix or aligned individual tracks, with optional effects/tail handling | keep project, MIDI, and audio distinct |
| Logic Pro | project package/folder can copy audio, impulse responses, sampler instruments, and samples | separate MIDI import/export | separate bounce/export paths | a movable project must account for assets, not just JSON |
| FL Studio | `.flp`/zipped project workflows retain production state | MIDI retains sequencer/note material, not audio production | split Mixer tracks and tail policies produce audio handoffs | show render length/tail and size before exporting |
| teenage engineering OP–XY | project/version storage duplicates patterns, scenes, tracks, and project state | MIDI settings address external sequencing | not a project replacement | hardware also treats MIDI as control, not backup |
| teenage engineering OP-1 | device state/tape is distinct from MIDI | external control/sequencing | tape backup is four AIFF tracks; final album mix is separate because track export omits master processing | offer both isolated tracks and a wet mix, and label the difference |
| Elektron Model:Samples | projects and samples are backed up through Transfer | MIDI controls/sequences the device | USB audio records the result | project metadata and sample assets both matter; content hashes make sample references more durable |
| DAWproject 1.0 | intentionally not a native DAW format | higher-level notes and note expression | embedded/referenced audio plus automation and supported plug-in state | useful interchange layer, but only common features survive |

Primary sources:

- [Ableton: Managing Files and Sets](https://www.ableton.com/en/manual/managing-files-and-sets/)
- [Apple: Save Logic Pro projects](https://support.apple.com/guide/logicpro/save-projects-lgcpce128e82/mac)
- [Image-Line: Exporting Audio and MIDI](https://cluster.image-line.com/fl-studio-learning/fl-studio-online-manual/html/fformats_save_export.htm)
- [Image-Line: Save/export file formats](https://www.image-line.com/fl-studio-learning/fl-studio-online-manual/html/fformats_save.htm)
- [teenage engineering: OP–XY projects](https://teenage.engineering/guides/op-xy/project)
- [teenage engineering: OP-1 tape backup](https://teenage.engineering/guides/op-1/original/tape-mode)
- [Elektron Model:Samples manual](https://www.elektron.se/wp-content/uploads/2024/10/Model-Samples-User-Manual_ENG_OS1.13_241030.pdf)
- [DAWproject specification and support matrix](https://github.com/bitwig/dawproject)
- [MIDI Association: Standard MIDI Files](https://midi.org/standard-midi-files)

The MIDI Association itself describes SMF as a compact interchange of
time-stamped MIDI data and says it is not intended to replace an application's
normal file format. DAWproject likewise says users commonly fall back to stems
and exists to carry more translatable audio, note, automation, and plug-in
state. Neither claim makes an application-specific Web Audio instrument
portable.

## Keyboardia project package contract

The lossless artifact is a ZIP container with extension `.keyboardia` and MIME
type `application/vnd.keyboardia.project+zip`. Version 1 contains:

```text
manifest.json                 format/schema versions, hashes, origin, compatibility
session.json                  canonical complete session state
session.txt                   canonical v2.4 human-readable notation
performance.mid               optional portable note rendition
loss-report.json              preserved/approximated/omitted features
assets/<sha256>-<name>        custom/user assets needed to reopen the project
audio/mix.wav                 optional wet reference render
audio/stems/<track>.wav       optional aligned wet or dry track renders
README.txt                    human import and compatibility summary
```

Normative rules:

- `session.json`, not `performance.mid`, is authoritative on import.
- Export offers two honest asset policies. **Compact** references built-in
  catalogue assets by immutable ID/hash and requires the versioned Keyboardia
  asset archive; **self-contained** embeds every used redistributable built-in
  and custom sample once by hash. The manifest states `assetPolicy`, unresolved
  external dependencies, and whether the package can reopen offline.
- Self-contained is the recommended handoff/archive option. Compact is the
  smaller collaboration option, not an offline-preservation claim. If a sample
  licence forbids redistribution, export reports the dependency and recommends
  audio stems; it does not silently include the file.
- The manifest declares whether optional MIDI/audio members are present, the
  render policy and engine build that made them, and the hash of every member.
- Export -> import -> export MUST produce the same canonical semantic hash;
  byte-identical ZIP output is not required.
- Unknown future session fields MUST survive a no-edit round trip when their
  declared schema is compatible. An unsupported required capability blocks
  import with a useful error; it is never silently deleted.
- Import limits entry count, expanded bytes, compression ratio, member paths,
  and per-asset media type before extraction. Absolute paths, `..`, symlinks,
  duplicate canonical names, and hash mismatches are rejected.
- Export warns that embedded microphone/custom recordings may contain private
  or unlicensed material. The user explicitly chooses whether to include them.
- Import creates a new session by default. It does not overwrite the currently
  shared session or silently publish uploaded assets.

## Standard MIDI export contract

SMF remains the lowest-friction handoff and MUST stay ordinary enough to open
widely:

- preserve tempo, time signature where supported, note pitch, onset, velocity,
  track names, and useful General MIDI program hints;
- bake gate and ties into note-off time only when the result is unambiguous;
- classify every relevant session feature as `preserved`, `approximated`, or
  `omitted`, with affected track/step identifiers;
- never invent CC72/73/75 automation and call it ADSR fidelity;
- never hide Keyboardia JSON in sequencer-specific meta events and claim it is
  portable—receivers may discard unknown events and cannot render the state;
- never use a MIDI import to update an existing canonical session; import makes
  a new explicitly lossy session;
- display a loss preflight before download and include the same JSON report in
  browser and MCP results.

The report schema contains `reportVersion`, `exportKind`, `exporterVersion`,
`sessionHash`, and ordered entries with `featurePath`, `disposition`, `reason`,
`affectedTrackIds`, optional `affectedSteps`, and `recoveryProduct`.
`disposition` is exactly `preserved`, `approximated`, or `omitted`. A generated
coverage test requires every export-relevant canonical session field and
capability to have a classifier; adding a field without a disposition fails CI.

Target-specific MIDI profiles MAY later emit CC/NRPN/automation for a named
receiver with a tested mapping. Such a profile is an adapter, not the default
export and not a round-trip guarantee.

## Audio render contract

Audio is the escape hatch for exact sound when editability is secondary:

- export a wet stereo mix and aligned per-track stems;
- offer `wet` stems (track plus audible sends/master policy) and `dry` stems
  only when the UI explains what each omits;
- default to one complete pattern cycle plus the longest bounded release/effect
  tail; offer `cut`, `leave remainder`, and `wrap as loop` only after each is
  specified and tested;
- render every stem from the same start frame, sample rate, length, and tempo;
- include `render.json` with sample rate, bit depth, frame count, pre-roll,
  tail policy, engine/build hash, and track-to-file mapping;
- pass the T3 PCM comparison against live playback before the stems option can
  make an "exact sound" claim.

Uncompressed stems are intentionally expensive. At 48 kHz/24-bit stereo, one
minute is about 17.3 MB per file before ZIP; sixteen stems plus a mix are about
294 MB per minute. The export UI MUST estimate bytes and render time up front,
render off the main UI thread where possible, bound concurrency, and avoid
holding every decoded stem in memory at once. FLAC MAY reduce transfer size,
but WAV remains the compatibility default.

## DAWproject decision

DAWproject 1.0 is a useful optional bridge after Keyboardia's own package and
audio renderer are proven. It is a stable ZIP/XML format currently listed by
its maintainers as supported in Bitwig Studio, Studio One, Cubase, Cubasis,
VST Live, and n-Track. It can represent more structure than SMF, including
audio, notes, automation, and supported plug-in state.

It does not make Keyboardia's internal Web Audio instruments available in a
DAW. The useful Keyboardia mapping is therefore hybrid:

- note tracks for continued composition;
- aligned rendered audio tracks for the actual sound;
- tempo, time signature, track names, volume, pan, and other genuinely common
  automation;
- a loss report for the Keyboardia-specific envelope/sample/render state.

DAWproject export remains `experimental` until files validate against the
official schema and import correctly in at least two independent supported
DAWs. It MUST NOT be a release blocker for the lossless `.keyboardia` package.
If offered, it is either a separate download or an optional member of the
Keyboardia package; unknown vendor files are not assumed to survive arbitrary
DAWproject round trips.

The current official DAWproject support list does not include Ableton Live or
Logic Pro. For those two inspirations, the dependable handoff remains MIDI plus
aligned audio; generating undocumented `.als` or Logic project internals would
be a brittle reverse-engineered integration, not a portable contract.

## If exact, editable sound in another DAW becomes required

There is only one general route to all three properties: the receiving DAW must
run a compatible Keyboardia renderer. That means shipping the shared engine as
a signed VST3/CLAP/AU instrument (or building and maintaining a target-specific
device/importer), then handing it notes plus versioned plug-in state. DAWproject
can carry supported plug-in state when the same plug-in exists at both ends;
MIDI still only triggers the renderer.

For sample-only instruments, an SFZ-plus-audio export could preserve useful key,
velocity, loop, and release-region mappings in compatible samplers, but it
would not preserve Keyboardia effects, synths, voice stealing, or identical
host behavior. It should be a named target adapter with its own loss report,
not the default MIDI export.

Neither adapter belongs in this ADSR release. A plug-in introduces a native
toolchain, signing/notarization, multi-OS and multi-host QA, duplicated audio
runtime risk, asset distribution/licensing, and long-term binary compatibility.
The v2 renderer consolidation and PCM corpus are useful prerequisites; Slice F
records a build/defer feasibility decision after they exist.

## Verification and cost gates

| Gate | Evidence | Cost control |
|---|---|---|
| Package semantic round trip | property tests across generated sessions, old schemas, unknown fields, compact/self-contained assets, missing archive entries | T0 pure tests on each PR; large asset cases nightly |
| Package security | malicious ZIP corpus: traversal, duplicates, bombs, MIME lies, bad hashes | compact deterministic corpus on PR; fuzzing nightly |
| MIDI contract | decoded event assertions plus exact loss-report completeness | T0 fixture set on PR; full catalogue nightly |
| Stem fidelity | live/offline frame alignment and PCM metrics, tail/loop fixtures, listening review | changed tracks on PR; complete T3 only for release |
| DAWproject | official XSD/schema validation and import smoke in two DAWs | manual/release lab; no paid DAW matrix on every PR |

Release telemetry records export time, peak memory, output bytes, failure rate,
and browser/device. Stems are withheld on devices that cannot finish within the
measured memory/time budget; project and MIDI export remain available.

## Rejected single-file shortcuts

- **Map ADSR to CC72/73/75:** values are relative/device-defined, omit sustain,
  units, model, locks, loops, and release assets, and are not interpreted
  consistently.
- **Embed JSON in SMF meta/SysEx:** opaque data may be stripped, is unusable to
  ordinary importers, creates size/security problems, and still cannot recreate
  a Keyboardia renderer.
- **Depend on MIDI 2.0 Property Exchange:** it is negotiated device/resource
  state, not a universally understood project file.
- **Export only stems:** sound survives but composition and instrument state do
  not; large projects become large downloads.
- **Export only DAWproject:** common DAW concepts transfer, but Keyboardia's
  renderer and application-specific state do not.
