# Keyboardia Sample Pipeline v2

`npm run samples -- full` is the only supported full-library build path. It replaces the legacy destructive processor with a fail-closed state machine:

```text
untrusted JSON
  → ParsedRecipe
  → VerifiedSources
  → PlannedBuild
  → RenderedCandidate
  → Objective/Browser/Runtime Evidence
  → Blinded Listening Bundle
  → separately authorized Promotion
```

Production is never a build directory. Normal runs write to ignored `public/__sample-pipeline/<instrument>/candidate`; promotion reopens that exact candidate and rehashes every byte instead of rebuilding it.

## Requirements

- Node dependencies from `npm ci`
- `ffmpeg` and `ffprobe` on `PATH`
- Playwright Chromium and WebKit (`npx playwright install chromium webkit`)
- Immutable WAV, FLAC, AIFF, or AIFC masters outside `public/instruments`
- A curated Sample Lab source record whose file-level rights permit raw redistribution

## Commands

```bash
# Parse, hash-check, and print the render plan only
npm run samples -- full \
  --recipe sample-pipeline/recipes/<instrument>.json \
  --source-root /path/to/immutable-masters \
  --dry-run

# Render one delivery generation, audit it, and build blinded evidence
npm run samples -- full \
  --recipe sample-pipeline/recipes/<instrument>.json \
  --source-root /path/to/immutable-masters

# After a human completes the generated decision template, promote the SAME bytes
npm run samples -- full \
  --recipe sample-pipeline/recipes/<instrument>.json \
  --source-root /path/to/immutable-masters \
  --promote \
  --decision public/__sample-pipeline/<instrument>/listening-decision.accepted.json

# Deterministically resolve/includes/macros, hash masters, and emit explicit SFZ mappings
npm run samples:import-sfz -- \
  --sfz /path/to/map.sfz --source-root /path/to/immutable-source \
  --articulation sustain --container m4a --json /tmp/import.json

# Refresh compact exact-report baselines and the batched human-review dashboard
npm run samples:pipeline:baselines
npm run samples:pipeline:review

# Real committed-fixture contract: ffmpeg → objective decode → Chromium + WebKit
npm run samples:pipeline:contract
```

A second ordinary build refuses to overwrite an existing candidate. Delete an explicitly rejected candidate before rebuilding. A promotion invocation does **not** rebuild: it loads the existing `build-report.json`, verifies recipe/source/manifest/output hashes, repeats objective and browser gates, then evaluates the accepted decision.

## Version 1 recipe

All objects reject unknown fields. Every path is normalized, relative, traversal-free, and symlink-free at verification. Every selected master must have one SHA-256 digest and exactly one delivery output. The following is an abridged field reference, not a complete valid recipe; use `test/fixtures/sample-pipeline/recipe.json` as the executable example.

```json
{
  "version": 1,
  "instrument": {
    "id": "instrument-id",
    "name": "Instrument Name",
    "releaseTime": 0.5,
    "playableRange": { "min": 36, "max": 84 },
    "playbackNote": 60,
    "chokeGroup": "optional-group",
    "unpitched": false,
    "gainDb": 0,
    "velocityCrossfade": 8,
    "priorityNotes": [60],
    "credits": {
      "source": "Source/performer",
      "url": "https://primary-source.example/evidence",
      "license": "CC BY 4.0"
    }
  },
  "sourceRevision": "immutable-upstream-revision",
  "sources": [
    {
      "id": "c4-soft-rr0",
      "path": "Samples/C4-soft-rr0.flac",
      "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    }
  ],
  "mapping": {
    "mode": "explicit",
    "samples": [
      {
        "sourceId": "c4-soft-rr0",
        "output": "C4-soft-rr0.m4a",
        "rootMidi": 60,
        "velocity": { "min": 0, "max": 63 },
        "articulation": "sustain",
        "roundRobin": { "group": "c4-soft", "index": 0, "count": 1 },
        "processing": {
          "trimStartSec": 0.01,
          "trimEndSec": 2.5,
          "fadeInSec": 0.003,
          "fadeOutSec": 0.02
        },
        "playback": {
          "gainDb": -1.5,
          "tuneCents": -4,
          "startOffsetSec": 0,
          "endOffsetSec": 2.45,
          "loopStartSec": 0.8,
          "loopEndSec": 2.2
        }
      }
    ]
  },
  "delivery": {
    "codec": "aac",
    "container": "m4a",
    "bitrateKbps": 160,
    "sampleRate": 44100,
    "channels": { "mode": "preserve" }
  },
  "leveling": { "mode": "preserve-source" },
  "evidence": {
    "sampleLabSourceId": "curated-source-id",
    "currentInstrumentDir": "public/instruments/instrument-id",
    "anchors": [
      {
        "id": "low-soft",
        "targetMidi": 48,
        "velocity": 32,
        "currentFile": "C3-soft.mp3",
        "currentRootMidi": 48,
        "candidateOutput": "C4-soft-rr0.m4a",
        "candidateRootMidi": 60
      }
    ]
  }
}
```

Recipes need at least three uniquely named anchors spanning at least twelve semitones. In production, include low/mid/high pitch, dynamics, and changed layers. `leveling.mode: "group-relative"` additionally requires `anchorSourceId`, measured anchor peak, pre-encode group ceiling, decoded `deliveryCeilingDb`, and the exact single group attenuation derived from the anchor. Per-layer render normalization is not representable.

Channel policy is either `{ "mode": "preserve" }` or an explicit mono policy such as `{ "mode": "mono", "method": "equal-power" }`. No implicit downmix exists.

## SFZ intake

Use `npm run samples:inspect-sfz -- <map.sfz> --json <report.json>` to resolve includes/macros and inventory key/velocity/sequence regions. `samples:import-sfz` is the operational trust boundary: it resolves entry-relative and nested includes, hashes every selected lossless master, rebases safe source paths, carries inherited SFZ volume, and emits explicit mappings. It never infers pitch or velocity from filenames.

Random `lorand`/`hirand` regions fail unless `--random-as-round-robin` explicitly converts complete contiguous `0..1` ranges into deterministic indices. SFZ maps whose first note-on layer begins at velocity 1 fail unless `--extend-velocity-zero` explicitly extends that layer to Keyboardia's `0..127` event domain. Missing masters, traversal, malformed opcodes, incomplete sequences, velocity gaps, and unresolved macros fail closed. Key-range and conversion warnings remain in each committed `*.dispositions.json` packet.

## Generated evidence

A candidate run writes beside the candidate:

- `reports/source-master-audit.json` — decoded immutable-master metrics
- `reports/objective-audit.json` — exact delivery-file metrics and hard/review findings
- `reports/browser-decode.json` — Chromium and WebKit PCM evidence
- `reports/runtime-contract.json` — exhaustive playable-range × velocity mapping events
- `reports/before-after.json` — absolute current/candidate values and deltas, never a synthetic score
- `sample-lab.html` — seeded, pitch-matched, active-RMS-matched blinded A/B
- `runtime-listening.html` — actual `SampledInstrument` dynamics, repetition, held release/loops, stereo/mono fold, and phrase checks
- `listening-decision.template.json` — exact build/output hashes, exact anchors, and one required disposition per review finding

Fair level matching changes listening gain only; it never changes shipping bytes. The randomization seed is the exact build-report hash and is exported with every review.

## Promotion invariants

Promotion is blocked by any of the following:

- source, recipe, manifest, report, or output hash mismatch
- lossy/renamed source bytes, source symlink, production-as-source, or codec/channel/rate mismatch
- missing/duplicate/orphan/decode/clipping/DC/loop/offset/velocity-energy hard defects
- a silent deterministic runtime mapping event
- a Chromium or WebKit failure
- root-shift or velocity-coverage regression
- a rejected/stale/wrong-hash decision
- missing, extra, or stale review-finding dispositions
- wrong/missing required anchors or pitch span

Promotion stages and rehashes all files, keeps the old production directory until the new directory and decision record are installed, and restores the old directory on any caught failure. A successful decision record is stored in `sample-pipeline/decisions/<instrument>.json`. CC BY recipes must carry creator/derivative attribution, the canonical license URL, and a delivery-change notice; those fields flow into the promoted manifest and generated `public/instruments/LICENSE.md`. Revision-bound creator-authority packets are retained under `sample-pipeline/rights/` and their exact SHA-256 values are checked against each disposition.

## Existing-instrument upgrade program

`sample-pipeline/instrument-upgrades.json` accounts for every original exact ID as retained-audited, decision-ready, promoted-legacy-reviewed, or quarantined. Ten exact-hash decision-ready candidates currently cover piano, steel drums, clean guitar, alto sax, and the six main acoustic-kit IDs. A mechanically verified Finger Bass YR candidate is separately blocked because its MIDI 26–45 range would contract the current `finger-bass` 18–66 contract. Compact baselines enforce zero hard defects, Chromium/WebKit parity, zero silent runtime mappings, durable report hashes, and a per-instrument decoded-PCM budget no greater than 96 MiB.

Run `npm run samples:pipeline:review`, serve the app, and open `/__sample-pipeline/index.html`. The dashboard requires blinded anchors plus dynamics, repetition, held release/tails, stereo/mono, actual-runtime phrases, full-set review, reviewer identity, notes, and a rationale for every finding code before it can export an exact decision. It never writes production or preselects acceptance.

`rhodes-ep` is quarantined: the jRhodes3d terms do not authorize raw redistribution in Keyboardia. Its production bytes and new-track picker entry are removed. Legacy IDs fail explicitly and identify `synth:rhodes` as an opt-in replacement; CP80, Wurlitzer, Pianet, and FM sources are not silently relabeled as Rhodes.

## TDD and fixtures

The committed lossless fixture is `test/fixtures/sample-pipeline/`. Focused stage tests are `test/sample-pipeline-*.test.ts`; runtime behavior is covered by `src/audio/sample-selection*.test.ts`, `sampled-instrument-loading.test.ts`, and `sampled-instrument.playback.test.ts`. CI installs real ffmpeg plus Chromium/WebKit and runs the real encode/decode contract. The complete unit suite, build, lint, manifest validation, canonical quality audit, and browser validation remain required before merge.
