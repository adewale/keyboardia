# Keyboardia Sample Lab

The Sample Lab turns sample replacement into a reproducible evidence pipeline:

1. **Discover from a curated source registry.** Only sources with a sample/archive-scoped permissive license and a pinned evidence revision enter the queue.
2. **Inspect mappings before downloading everything.** SFZ inventory reports note roots, velocity layers, round robins, and malformed regions.
3. **Run hard objective gates.** Candidate files use the same decoder and defect classifier as `validate:sample-quality`, plus a real Chromium decode check.
4. **Listen blind and fairly.** A/B order is randomized; both sides are pitch-matched to the same target MIDI note and optionally active-RMS level-matched with peak protection.
5. **Export the decision record.** Votes, confidence, notes, assignment, level-match mode, and timestamps are exported as JSON.

There is deliberately no weighted “quality score.” Licensing and decode defects are gates. Coverage and payload are factual trade-offs. Timbre, articulation identity, attack, and sustain remain review criteria.

## Commands

Run from `app/`:

```bash
# Validate catalog schema and provenance (no network)
npm run samples:lab:check

# Discover known cleared sources by target
npm run samples:sources -- --target bass
npm run samples:sources -- --target guitar --verify  # optional advisory network check

# Inventory downloaded SFZ maps before curating audio
npm run samples:inspect-sfz -- /path/to/source --json /tmp/sfz-inventory.json

# Once candidate previews exist at the URLs in catalog.json
npm run samples:lab:check -- --check-audio
npm run samples:lab:audit
npm run samples:lab:browser-check
npm run samples:lab:readiness

# Build the local blind-listening page
npm run samples:lab:build
npm run dev
# open http://127.0.0.1:5173/sample-lab.html
```

Generated browser files and candidate audio are gitignored. `catalog.json`, this README, and `index.html` are committed because they define the process, evidence, and review interface.

## Candidate evidence model

Each source record must include:

- stable source/homepage URL;
- pinned commit, release, or archive revision;
- allowlisted SPDX license (`CC0-1.0`, `CC-BY-3.0`, `CC-BY-4.0`, or explicitly reviewed `Unlicense`);
- `samples` or whole-`archive` scope—not a source-code-only license;
- pinned license evidence URL/revision;
- README-ready attribution, even for CC0 sources;
- caveats such as mutable FreePats pages or required CC-BY change disclosure.

The allowlist is intentionally conservative. NC, ND, SA, proprietary/freeware, unknown, and source-code-only terms fail closed.

Each comparison anchor declares:

- one target MIDI note and optional velocity;
- candidate URL and its actual root MIDI pitch;
- current URL and its actual root MIDI pitch.

The browser applies `2^((targetMidi - rootMidi) / 12)` independently. This fixes the invalid earlier comparisons where candidate C4 was played against unshifted current Db4/D4 files.

## Promotion rule

A one-note preview can answer “is this worth more work?” It cannot answer “should this replace the instrument?”

A candidate becomes **decision-ready** only when:

- license provenance is complete;
- canonical audit has zero hard errors;
- Chromium decodes the files;
- at least three distinct, pitch-matched low/mid/high anchors exist.

Before shipping, also require:

- representative velocity/articulation coverage rather than one hand-picked file;
- payload and maximum pitch-shift comparison against current;
- every review flag disposition recorded;
- exported blind-review JSON reviewed by a human;
- final archive/source checksums and exact transform recipe retained;
- manifest credits updated and `npm run generate:license` committed;
- the shipped set passes all PR #51 sample-quality and browser-decode gates.

## Current queue

The committed catalog captures the six current candidate sets (eight preview anchors) and fourteen permissive-license discovery sources. All current candidates are **reviewable smoke previews**, not promotion-ready, because they have only one or two pitch anchors. That is an intentional correction to the earlier page, which made representative files look more conclusive than they were.
