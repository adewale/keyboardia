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
- direct download URL plus verified SHA-256 when the source is a release archive;
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

The committed catalog captures six candidate sets, 21 listening anchors, 43
full-set audit files, and 20 permissive-license discovery sources.

- The local `acoustic-guitar`, `alto-sax`, and `french-horn` rebuilds are **decision-ready for human review**: they have zero hard defects, full-set browser decode evidence, and low/mid/high A/B anchors. Their 70 review flags remain visible and must be dispositioned rather than silently waived.
- Growlybass, Green Gretsch, and FreePats Classical remain **reviewable smoke
  previews**, not promotion-ready, because they have only one or two distinct
  pitch anchors. Meatbass and Greg Sullivan are discovery sources without a
  committed candidate set yet.

This intentionally corrects the earlier page, which made representative files look more conclusive than they were.

## ADSR-capability TODO

These are research and vertical-slice opportunities, not pre-approved sample
promotions. Every item must satisfy
[`docs/SAMPLE-INTAKE-REQUIREMENTS.md`](../../docs/SAMPLE-INTAKE-REQUIREMENTS.md)
and keep a new instrument/articulation ID when its musical identity differs.

- [ ] Prove looped sampled ADSR against the 13 already-shipped Hammond regions;
  this should add manifest/runtime evidence, not more Hammond audio.
- [ ] Curate a narrow Black & Green clean-guitar release-trigger slice covering
  representative low/mid/high pitches, velocities, held durations, and RRs.
- [ ] Compare Greg Sullivan Pianet T as the keyboard release-trigger vertical
  slice; keep CP80/Wurlitzer natural-decay material classified as AHD.
- [ ] Build a separately named Meatbass upright-arco loop experiment from the
  source's authored sustain loops; do not replace `finger-bass`.
- [ ] Evaluate a separately named sustained Growlybass/Swagbass variant with
  real release layers; do not replace the current short `slap-bass` identity.
- [ ] Add FreePats VCSL tenor sax to source discovery and test its published
  infinite-sustain loops through the real Web Audio loop path.
- [ ] Split VSCO horn/string and Weresax articulation candidates before any
  loop authoring; “sustain” filenames alone are not loop evidence.
- [ ] Run a web-budget feasibility spike for a curated Salamander subset with
  hammer/key release, resonance, and pedal noise; include CC-BY attribution,
  encoded payload, decoded memory, polyphony, and iOS cache results.
- [ ] Evaluate bowed VCSL vibraphone as a separate articulation while keeping
  struck mallets on natural AHD playback.
- [ ] Enrich drum and mallet sources through velocity, RR, choke, and mute
  behavior without presenting those improvements as full ADSR.
