# Sample Pipeline v2: correctness-by-construction plan

**Branch:** `claude/sample-pipeline-v2-tdd-2026-07-10`
**Status:** implementation plan; execute stages 1–10 in order
**Primary command:** replace, do not retire, `samples full`

## Goal

Improve Keyboardia's production sampled instruments through a reproducible, lossless-first pipeline that cannot silently collapse velocity layers, overwrite mappings, downmix stereo, add lossy generations, or promote unverified audio.

The pipeline must produce two kinds of evidence:

1. **Numerical evidence:** coverage, decoded-audio, mapping, loading, and payload metrics compared with the current production instrument.
2. **Listening evidence:** deterministic, pitch-matched, loudness-matched, blinded A/B material covering low/mid/high pitch, dynamics, repetition, loops, and stereo behavior.

Numerical gates reject defects; they do not invent a subjective quality score. Musical identity and timbre remain listening decisions.

## Safety and branch strategy

- PR #51's canonical quality validator and browser-decode gate are the objective-audit foundation.
- PR #52's Sample Lab is the listening and decision-evidence foundation.
- Generated PCM, candidate delivery files, reports, and listening pages remain ignored until an explicit promotion.
- Production directories are never build directories. A successful build writes to a fresh candidate directory and promotion is an atomic, separately authorized step.
- Existing MP3/M4A files are not transcoded to claim higher quality. A rendered rebuild requires verified lossless masters. Delivery-only manifest migrations use the existing bytes unchanged.

## Correctness-by-construction model

Untyped JSON, SFZ text, paths, and tool output are parsed once at trust boundaries. The typed interior uses smart constructors and discriminated unions so illegal states are not representable.

Planned domain types:

- `InstrumentId`, `MidiNote`, `MidiVelocity`, `FiniteDb`, `PositiveSeconds`
- `RelativeSourcePath` and `RelativeOutputPath`: normalized, non-empty, no traversal
- `Sha256`: exactly 64 hexadecimal characters
- `LosslessSource`: only WAV, FLAC, or AIFF, with immutable digest
- `ChannelPolicy`: `{ mode: "preserve" } | { mode: "mono", method: ... }`
- `DeliveryPolicy`: explicit codec, container, bitrate/quality, and sample rate
- `MappingSource`: `{ mode: "explicit", samples: NonEmpty<...> } | { mode: "sfz", path: ... }`
- `VelocityPolicy`: preserve source relationships or apply declared group-relative offsets; never independently normalize layers
- `PipelineState`: `ParsedRecipe → VerifiedSources → PlannedBuild → RenderedCandidate → ObjectivelyVerified → BrowserVerified → ListeningBundle`

Functions for later states accept only the preceding state type. A raw recipe cannot be rendered, unverified output cannot be promoted, and a listening decision cannot bypass hard defects.

Every parser returns a discriminated result with all actionable errors. There are no silent C4 defaults, filename-note guesses, catch-all fallbacks, or best-effort collisions.

## Red–green–refactor protocol

Every implementation stage follows this loop:

1. **Red:** add a focused behavior/property/contract test and record the command plus failing assertion.
2. **Green:** implement the smallest public-contract change that passes.
3. **Refactor:** improve names/types/structure while the focused and adjacent suites remain green.
4. Run the stage's mutation/gap review before moving to the next stage.

Tests use real parsers, temp directories, and tiny committed PCM fixtures. Process execution is behind a small interface: pure planning tests use a recording fake, while contract tests invoke real `ffmpeg`/`ffprobe` when available. Browser behavior is checked in Playwright rather than mocked.

Minimum stage test layers:

- parser property tests: arbitrary input never crashes; success implies every invariant;
- model-gap tests: attempt every invalid state still expressible at the JSON boundary;
- golden plan tests: human-reviewable source → command/manifest plans;
- filesystem integration tests: collisions, immutability, atomic output, interrupted build cleanup;
- tool contract tests: real lossless fixture → one delivery encode → decoded metric assertions;
- browser contract tests: every promoted delivery file decodes and produces non-zero PCM;
- runtime render tests: real sample selection, velocity, round robin, loops, and loading failures.

## Ordered implementation

### 1. Immutable masters and machine-readable recipes

Replace ad hoc command options with a versioned recipe under `app/sample-pipeline/recipes/<instrument>.json`. A recipe records:

- exact source-relative paths and SHA-256 digests;
- mapping source and articulation;
- explicit delivery and channel policy;
- sample-specific processing declarations;
- expected instrument ID and candidate output directory;
- provenance/build metadata needed to reproduce the bytes.

`full` verifies every digest before any processing and rejects source paths inside production output directories.

**Red tests**

- malformed/unknown recipe fields fail with paths to every error;
- traversal, absolute paths, malformed hashes, duplicate IDs, and empty sample sets fail;
- changing one source byte fails digest verification;
- property: every successfully parsed recipe has only normalized relative paths, bounded MIDI/velocity values, and explicit policies.

### 2. Lossless decode and one delivery encode

A render plan permits only lossless masters. Each selected source has exactly one delivery-encoding command and no lossy intermediate. Analysis may inspect decoded PCM, but render inputs remain the immutable master and only one lossy generation is written.

Output is written to a fresh temporary candidate directory, fsynced/closed, audited, and atomically renamed. Failure leaves production untouched.

**Red tests**

- MP3/M4A source recipes are rejected for rendered rebuilds;
- every planned output has exactly one encoder invocation from its declared master;
- interrupted/failed encodes cannot create a promotable candidate;
- rerunning the same recipe and toolchain fingerprint produces identical plan and manifest metadata.

### 3. Explicit channel, codec, bitrate, and sample-rate policy

Remove unconditional `-ac 1`, 44.1 kHz, and 128 kbps MP3 behavior. Every recipe must declare its policy. Preserve stereo by default only when the recipe explicitly says `preserve`; mono requires a named downmix method.

Record source and delivery channel count/rate in the build report. Compare decoded stereo correlation, balance, and mono-loss metrics before promotion.

**Red tests**

- missing policy cannot parse;
- preserve policy never emits a downmix flag;
- mono policy emits exactly the declared downmix;
- decoded output must match declared channel count and sample rate.

### 4. Explicit/SFZ mappings with fatal collisions

No production mapping is inferred from filenames. Explicit mappings declare root MIDI, velocity range, articulation, round-robin group/index, and output path. SFZ import uses the existing parser, then requires all unresolved warnings to be dispositioned before rendering.

Output paths and mapping identities are unique. Flat names, velocity suffixes, microphone names, and articulations cannot overwrite each other because the recipe—not a filename regex—defines identity.

**Red tests**

- two sources targeting one output path fail;
- duplicate note/velocity/round-robin identity fails;
- gaps/overlaps in declared velocity ranges fail unless explicitly crossfaded;
- incomplete SFZ regions produce structured blockers, never C4 fallbacks.

### 5. Preserve velocity relationships and add sample gain

Add sample-level `gainDb` to manifests/runtime. The recipe supports:

- `preserve-source`: no layer-relative normalization;
- `group-relative`: declared or measured offsets relative to one anchor per note/group;
- a decoded true-peak ceiling that can only attenuate the whole group uniformly.

The production sequencer's velocity-to-amplitude behavior is included when evaluating boundary jumps. Shipping gain and listening loudness matching remain separate concepts.

**Red tests**

- independently equalizing velocity layers is unrepresentable;
- group gain changes preserve every pairwise layer delta;
- sample gain is finite/bounded and applied exactly once by runtime;
- a 0→127 velocity sweep is monotonic in intended output energy unless a recipe explicitly records an instrument-specific exception.

### 6. Sample-specific trim, fade, tuning, and loop declarations

Recipes support bounded onset trim with pre-roll, end trim, fade-in/out, tuning cents, and loop regions. The processing plan combines them into the same master-to-delivery render. Runtime manifests carry non-destructive sample gain/tuning and any playback offsets that should remain adjustable.

**Red tests**

- trim/fade/loop times must be finite, ordered, and within decoded duration;
- pre-roll prevents attack truncation;
- tuning correction changes playback ratio without remapping the root;
- loop points are validated against decoded delivery duration, not pre-encode timing.

### 7. Velocity crossfades and round robins

Extend mapping/runtime types with explicit round-robin groups and deterministic selection state. Velocity boundaries may declare a crossfade width; selection returns one weighted layer outside a boundary or two weights summing to one inside it.

Round robin is deterministic per instrument/note/group, resets predictably, and never selects across velocity or articulation groups.

**Red tests**

- exhaustive velocities 0–127 always select valid layers and normalized weights;
- property: crossfade weights are non-negative, sum to one, and are continuous at boundaries;
- repeated hits traverse every round robin before repeating;
- fixed event sequences produce identical selections in main-thread and worklet scheduling paths.

### 8. Correct readiness and resilient loading

Replace “one arbitrary C4 mapping means ready” with an explicit readiness set: all velocity layers/round robins for the priority root plus declared neighboring roots. Background samples install independently; one failure does not discard successful decodes.

Expose `loading`, `priority-ready`, `complete`, and `degraded` states. A degraded instrument reports missing mappings and cannot masquerade as complete.

**Red tests**

- layered C4 is not ready after only one layer;
- one failed background file preserves every successful file and marks degraded;
- default-velocity playback never falls back to a soft layer solely because loading is incomplete;
- readiness state transitions are exhaustive and monotonic.

### 9. Promotion gates

`full` runs or consumes all objective gates before producing a decision-ready candidate:

- recipe/source digest verification;
- manifest schema, referenced-file, orphan, duplicate-content, and velocity coverage;
- root coverage, worst/mean shift, edge extension, and articulation-specific mapping;
- decoded peak/clipping, DC, onset, tail, pitch, stereo, and loop metrics;
- Chromium and WebKit decode with non-zero output energy;
- deterministic runtime render across playable ranges;
- stale-baseline rejection and explicit waiver checks.

Hard errors block. Review findings require human disposition. No command can promote around either without a committed decision record.

**Red tests**

- each sabotaged fixture trips its intended gate;
- removing/weakening one assertion causes a focused mutation test to fail;
- stale reports and reports for different bytes cannot authorize promotion.

### 10. Numerical and listening proof

`full` finishes by building a comparison bundle, not by declaring the candidate better. The bundle contains current/candidate metrics, audio, randomized labels, seed, toolchain fingerprint, and a decision template.

The replacement CLI contract is:

```bash
npm run samples -- full \
  --recipe sample-pipeline/recipes/french-horn.json \
  --source-root /path/to/immutable-masters
```

Default behavior builds/audits in ignored candidate storage and emits a decision-ready bundle. A separate explicit promotion flag/command requires a passing report bound to exact output hashes and an accepted listening decision. It then atomically updates production files/manifest. `full` remains the orchestrator; it no longer means “convert, normalize, and overwrite production.”

## Numerical before/after evidence

Each report records per file, per note/layer, and per instrument aggregates.

### Mapping and expressiveness

- referenced files and orphan files;
- unique roots, largest root gap, worst/mean pitch-shift distance, edge extension;
- velocity layers per root and percentage of roots with complete velocity coverage;
- round robins per note/layer and articulation coverage;
- playable-range audible-note count.

### Decoded audio

- decoded peak/true-peak proxy, clipping samples, flat-top runs;
- active RMS, crest factor, adjacent-root level step;
- velocity-boundary energy jump and monotonic sweep result;
- DC offset, active onset, attack, active tail and truncation level;
- pitch deviation/confidence;
- channel count/rate, stereo correlation, balance, and mono loss;
- loop seam correlation and window-difference ratio.

### Runtime and delivery

- payload bytes and decoded-memory estimate;
- priority-ready and complete-load latency under recorded local conditions;
- missing/failed mapping count and degraded-state behavior;
- Chromium/WebKit decode duration, channels, rate, peak, and non-zero energy;
- deterministic rendered energy per pitch/velocity/round-robin test case.

Reports show absolute before/after values and deltas. There is no weighted “quality score.” A candidate passes when it has zero hard regressions, meets instrument-specific coverage targets, and every review delta is dispositioned.

## Audio demonstration protocol

Every promotion comparison includes at least:

1. low, middle, and high pitch-matched anchors spanning at least one octave;
2. low/mid/high velocity renders and a slow 0–127 boundary sweep;
3. repeated-note sequences long enough to expose round robin or machine-gun behavior;
4. held-note/release examples and loop-boundary examples where applicable;
5. stereo and mono-fold checks for stereo material;
6. one representative musical phrase rendered through the actual Keyboardia runtime.

Comparison rules:

- current and candidate are independently pitch-matched to the same target MIDI note;
- fair-listening copies are active-RMS matched without changing shipping assets;
- labels are randomized from a recorded seed;
- autoplay order is randomized and hidden until the reviewer commits a decision;
- the exported decision records preference, confidence, defect notes, identity match, and exact file hashes;
- three-anchor review is the minimum; all changed files receive full-set review before promotion.

Machine-readable audio and metric artifacts live in ignored output directories. The compact report, hashes, waivers, and accepted decision are committed with a promotion.

## Initial production migration order

After stages 1–10 are implemented, migrate instruments in risk/value batches:

1. `french-horn`: close the C4–D5 root gap and complete high-register dynamics.
2. `slap-bass`, `clean-guitar`, `finger-bass`: reduce extreme shifts; add articulation-appropriate dynamics/round robins.
3. `piano`: denser roots, coherent layers, release/tail behavior.
4. Acoustic drum IDs: coherent kit mappings plus round robins and velocity crossfades.
5. `marimba`, `vibraphone`, `steel-drums`: edge coverage and repeated-strike variation.
6. `alto-sax`, `acoustic-guitar`: disposition current onset/DC/pitch/tail review findings.
7. `rhodes-ep`: complete root/layer consistency and remove orphan mappings when an appropriate verified master set exists.
8. `string-section` and remaining instruments based on baseline deltas.

Each instrument migration gets its own baseline, candidate bundle, accepted decision, and reviewable asset commit. Tooling and production audio remain separate commits even when developed on this integration branch.

## Implementation status (2026-07-10)

Pipeline v2 is implemented in `app/scripts/sample-pipeline-{core,runner,audit,evidence,cli}.ts`; runtime changes are in `app/src/audio/sample-selection.ts` and `sampled-instrument.ts`. The complete operational and recipe contract is documented in `app/sample-pipeline/README.md`.

1. Strict versioned parsing, unknown-field rejection, branded IDs/paths/hashes, lossless signatures, source SHA-256, and symlink/production-source rejection.
2. One render per selected master, pre-render rehash, fresh sibling staging, fsync, cleanup, no overwrite, and a hash-bound report.
3. Explicit delivery/channel policy, ffprobe source/delivery measurements, and decoded/browser policy gates.
4. Explicit mappings and fail-closed SFZ opcode import; collisions, velocity gaps/overlaps, and incomplete RR sequences are rejected.
5. Native dynamics, sample runtime gain, measured-anchor group attenuation, decoded group ceiling, and velocity-energy checks.
6. Bounded trim/fade/tuning/offset/loop declarations, one render chain, decoded bounds, and runtime release/loop use.
7. Normalized crossfades, deterministic declared-index RRs, articulation selection, and property/behavior tests.
8. Complete priority sets, observable states, independent background success, mapping-identity failures, retry, lifecycle cancellation, and progressive cache ownership.
9. Manifest/file/duplicate/coverage/decoded defect/delivery/browser/runtime/hash/review-disposition gates. Promotion reopens and rehashes an existing candidate instead of rebuilding it.
10. Absolute before/after metrics, toolchain fingerprint, seeded blinded bundles, exact-hash decisions, and an actual-runtime listening page for anchors, dynamics, repetition, held releases/loops, stereo/mono, and phrases.

`app/test/sample-pipeline-real-contract.test.ts` is the committed real ffmpeg → objective decode → Chromium/WebKit contract. Production asset migrations remain separate reviews: the pipeline never treats current lossy delivery bytes as masters and tooling cannot fabricate the human blind decision required for an asset promotion.

## Definition of done

- `samples full` is replaced by the typed recipe orchestrator and the destructive legacy implementation is gone.
- All ten stages have red–green–refactor evidence and focused tests.
- One tiny committed fixture proves the end-to-end lossless-master → delivery → manifest → objective audit → browser decode → listening-bundle path.
- No production asset is writable before objective and browser gates pass.
- At least one production instrument has a committed numerical baseline, blinded audio decision, and demonstrably improved coverage/defect metrics without a hard regression.
