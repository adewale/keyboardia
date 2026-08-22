# Sample Intake and Envelope-Capability Requirements

**Status:** Normative for new or replacement sampled instruments  
**Last reviewed:** 2026-08-03  
**Related:** `app/sample-lab/README.md`, `app/sample-pipeline/README.md`,
`specs/ADSR-OVERHAUL-v2.md`

This document defines what Keyboardia must know before a sample can be added,
replaced, or promoted to a richer envelope capability. A source containing more
files is not automatically more expressive: velocities, round robins,
articulations, sustain loops, and note-off release recordings solve different
problems and must remain distinct in manifests, UI, runtime behavior, and
review evidence.

## Current baseline and lessons

The production library currently has 26 sampled instruments, 223 delivery
files/regions, 914 seconds of encoded audio, and 13.12 MiB of encoded audio.
Decoded as Web Audio `Float32` PCM, the whole catalogue would occupy about
275.8 MiB. Only Hammond Organ's 13 regions currently carry loop metadata.

The runtime does not fetch the whole catalogue at startup. It fetches a chosen
instrument's manifest and priority set, then loads the rest of that instrument
in the background. The shared decoded-buffer cache is bounded to 64 MiB on
desktop and 32 MiB on iOS, with hard limits of 96 MiB and 48 MiB respectively.
New audio therefore normally leaves the initial JavaScript bundle unchanged,
but it still increases deployment bytes, cache storage, first-use network and
decode work, and the chance of eviction or hard-limit failure.

The source audit established these rules:

- A filename or articulation called “sustain” does not prove that a sample can
  sustain indefinitely. Only validated loop points or a source explicitly
  designed to continue while held can support looped ADSR.
- A release-time control is not a release-trigger sample. The former fades the
  primary voice; the latter starts new recorded audio at note-off.
- Articulation depth is valuable without changing the envelope model. Staccato,
  mute, pizzicato, bow, scrape, noise, mic, dynamic, and round-robin layers must
  not be relabelled as ADSR features.
- A materially different playing technique gets a new instrument/articulation
  identity. Meatbass arco is not an upgrade that may silently replace Finger
  Bass; feedback guitar is not the ordinary clean-guitar articulation.
- The smallest source set that wins a blind comparison is preferable to a
  larger library that listeners cannot distinguish in representative phrases.

## Required intake packet

Every candidate MUST provide one committed, reviewable packet containing:

### Rights and provenance

- upstream project and creator;
- immutable commit, release, or archive revision;
- sample/archive-scoped redistribution and modification rights;
- pinned licence evidence and required attribution/change notice;
- exact selected source files and SHA-256 hashes;
- disclosure of any resampling, editing, denoising, looping, gain, format, or
  channel transformation;
- a new stable Keyboardia ID when source or articulation identity changes.

NC, ND, SA, proprietary/freeware, unknown, and source-code-only licences fail
closed. CC-BY material requires attribution and delivery-change records; it is
not treated as equivalent to the current CC0 posture.

### Musical mapping

- playable pitch range and every root MIDI note;
- velocity ranges with no gaps or ambiguous overlaps;
- deterministic round-robin group, index, and count;
- articulation and choke/exclusive group;
- priority roots needed for first sound and for the representative session;
- maximum downward/upward pitch shift and its listening disposition;
- intended default playback behavior: `trigger`, `gate`, or `loop`;
- intended amplitude model: AD, AHD, AR, or ADSR;
- low/mid/high and soft/loud/repeated-note listening anchors.

The mapping importer MUST resolve SFZ includes and macros. It MUST NOT infer
pitch, velocity, loop, or articulation semantics from filenames alone.

### Natural trigger and finite-gate material

An unlooped strike, pluck, drum, key, or phrase MAY declare:

- `trigger` with AD/AHD, where note-off intentionally does nothing; or
- `gate` with AR, where note-off can shorten the voice but the buffer may end
  before the authored release.

It MUST NOT declare meaningful sustained ADSR. Tests must cover early note-off,
buffer exhaustion, choke, polyphony, pitch shift, and the natural recorded
decay.

### Sustain-loop material

Every looped region MUST record:

- start and exclusive end in decoded PCM frames at a pinned decoded sample
  rate—not approximate MP3 timestamps;
- loop direction and crossfade length;
- the stable-period evidence used to choose the loop;
- low/high served-pitch auditions and every velocity/articulation layer;
- click, periodicity, phasing, noise-floor, and long-hold dispositions.

The loop must be in bounds, contain at least two stable periods at the lowest
served pitch, and use a crossfade no longer than half the loop. A click-free
zero crossfade requires explicit listening approval. Lossy delivery files must
be decoded in Chromium and WebKit and their delivered frame positions verified;
source-master loop points cannot simply be copied after transcoding.

### Release-trigger material

Every release group MUST provide:

- pitch, velocity, articulation, and deterministic round-robin coverage;
- gain calibration against the primary voice at note-off;
- a documented held-duration-to-release-gain policy;
- pedal, choke, key-up, string-resonance, and noise state where applicable;
- independent tail duration and voice-cost accounting.

The primary voice's R stage and the recorded release layer remain separate.
The release is a natural-decay one-shot; it is not time-stretched to match R.
A missing release region must have an explicit fallback and must not select an
unrelated recording.

## Objective, browser, and listening gates

The existing Sample Lab and pipeline gates remain mandatory. In addition, an
envelope-capability promotion MUST demonstrate:

- immutable lossless masters and deterministic delivery transforms;
- correct codec, sample rate, channels, offsets, roots, velocity, RR, and
  articulation mapping;
- no hard decode, clipping, DC, silence, offset, or loop defects;
- Chromium and WebKit decode parity;
- the real `SampledInstrument` path, not only an isolated audition page;
- held-note, early-release, repeated-note, voice-steal, choke, and mobile-cache
  scenarios;
- a blind A/B decision by two listeners for loops/releases and three anchors
  for an instrument replacement;
- a written disposition for periodicity, release mismatch, source-identity,
  and every review warning.

Machine checks can reject defects but cannot prove that a loop breathes
naturally or that a release belongs to the outgoing note. Human listening is a
release gate, not an optional polish pass.

## Web payload and runtime budget

Each intake packet MUST report:

| Dimension | Required measurement |
|---|---|
| Deployment | encoded delivery bytes and file/request count |
| First use | manifest, priority-set bytes, requests, and priority-ready time |
| Background | remaining selected-instrument bytes and completion time |
| Decode | priority and full-instrument `Float32` PCM bytes |
| Runtime | ordinary and worst-case voices, including loop crossfade and release layers |
| Cache | desktop/iOS peak, eviction count, and hard-limit outcome |
| Tail | maximum primary and release-layer lifetime after note-off |

At the catalogue's current mean bitrate, one additional minute of audio is
roughly 0.91 MiB encoded. At 44.1 kHz, the same minute is about 10.1 MiB of
decoded mono `Float32` PCM or 20.2 MiB stereo. These are planning estimates;
promotion uses measured delivery and decoded values.

Sample audio MUST remain a static, instrument-lazy asset and MUST NOT enter the
initial JavaScript module graph. A sample manifest may grow only with metadata
required for runtime selection. UI work uses repository-native SVG/CSS and may
not add a charting dependency merely to draw an envelope.

There is no universal “use the remaining cache” allowance: referenced buffers
may be temporarily non-evictable, loop crossfades can double active sources,
and release layers add voices. A candidate fails if the supported iOS cache
cannot play the representative worst-case session without a hard-limit refusal
or audible glitch.

## Promotion record

Promotion requires exact source, recipe, manifest, output, test, listening,
payload, and decoded-memory hashes/metrics. The decision must say one of:

- promote under the existing identity;
- promote under a new instrument/articulation identity;
- retain current and archive the candidate;
- defer behind an explicitly named missing engine or asset prerequisite.

“More samples” and “mechanical tests pass” are not promotion decisions.

## Audited opportunity map

- Hammond Organ: first current-asset looped ADSR conformance target.
- Black & Green guitar: first same-source release-trigger experiment; feedback
  remains a separate articulation.
- Greg Sullivan Pianet T: best proposed keyboard release-trigger experiment.
- Meatbass arco: first new-ID looped multisample experiment.
- Growlybass/Swagbass: later sustained-bass and release-layer experiments,
  separate from the current slap identity.
- FreePats VCSL tenor sax: separately sourced looped-sax experiment.
- VSCO horn/strings and Weresax derivatives: articulation-first research;
  loops require new authored metadata and listening proof.
- Salamander Grand Piano: release/resonance/pedal research only after a curated
  web-sized subset, CC-BY review, and strict memory budget exist.
- Drum, mallet, and steel-drum sources: prioritize velocities, round robins,
  articulation, and choke over cosmetic ADSR.

The executable order and pinned source revisions live in
`specs/ADSR-OVERHAUL-v2.md`; the actionable queue lives in
`app/sample-lab/README.md`.
