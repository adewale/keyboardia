import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  evaluateCandidateReadiness,
  parseSampleLabCatalog,
  parseSfz,
  playbackRateForTarget,
  summarizeSfz,
  type SampleLabCatalog,
} from '../scripts/sample-lab-core';

const catalog: SampleLabCatalog = {
  version: 1,
  sources: [
    {
      id: 'clear-source',
      name: 'Clear Source',
      homepage: 'https://example.com/source',
      revision: '0123456789abcdef',
      license: {
        spdx: 'CC0-1.0',
        scope: 'samples',
        evidenceUrl: 'https://example.com/source/LICENSE',
        evidenceRevision: '0123456789abcdef',
        attribution: 'Clear Source by Example Author, CC0 1.0',
      },
      targets: ['finger-bass'],
      formats: ['sfz', 'wav'],
    },
  ],
  candidates: [
    {
      id: 'candidate-a',
      label: 'Candidate A',
      targetInstrument: 'finger-bass',
      sourceId: 'clear-source',
      status: 'listening',
      objective: { hardErrors: 0, reviewFlags: 2, browserDecode: true },
      comparisons: [
        {
          id: 'low',
          targetMidi: 36,
          candidate: { url: '/candidate/C2.m4a', rootMidi: 36 },
          current: { url: '/instruments/finger-bass/C2.mp3', rootMidi: 36 },
        },
        {
          id: 'mid',
          targetMidi: 48,
          candidate: { url: '/candidate/C3.m4a', rootMidi: 48 },
          current: { url: '/instruments/finger-bass/C3.mp3', rootMidi: 48 },
        },
        {
          id: 'high',
          targetMidi: 60,
          candidate: { url: '/candidate/C4.m4a', rootMidi: 60 },
          current: { url: '/instruments/finger-bass/C4.mp3', rootMidi: 60 },
        },
      ],
    },
  ],
};

describe('parseSampleLabCatalog', () => {
  it('parses a complete license-evidence and comparison catalog', () => {
    const parsed = parseSampleLabCatalog(catalog);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.sources[0].license.scope).toBe('samples');
    expect(parsed.value.candidates[0].comparisons).toHaveLength(3);
  });

  it('fails closed for ambiguous, non-commercial, or source-code-only licenses', () => {
    for (const [spdx, scope] of [
      ['NOASSERTION', 'samples'],
      ['CC-BY-NC-4.0', 'samples'],
      ['CC-BY-SA-4.0', 'samples'],
      ['CC0-1.0', 'source-code'],
    ]) {
      const invalid = structuredClone(catalog) as unknown as Record<string, unknown>;
      const sources = invalid.sources as Array<Record<string, unknown>>;
      const license = sources[0].license as Record<string, unknown>;
      license.spdx = spdx;
      license.scope = scope;
      const parsed = parseSampleLabCatalog(invalid);
      expect(parsed.ok, `${spdx}/${scope}`).toBe(false);
      if (!parsed.ok) expect(parsed.errors.join('\n')).toMatch(/license/i);
    }
  });

  it('rejects duplicate ids and comparison URLs without a declared root pitch', () => {
    const invalid = structuredClone(catalog);
    invalid.sources.push(structuredClone(invalid.sources[0]));
    delete (invalid.candidates[0].comparisons[0].candidate as { rootMidi?: number }).rootMidi;
    const parsed = parseSampleLabCatalog(invalid);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toContain('duplicate source id');
      expect(parsed.errors.join('\n')).toContain('rootMidi');
    }
  });

  it('rejects traversal, remote, and non-audio comparison URLs at the catalog boundary', () => {
    for (const url of ['/../secret.wav', '//example.com/file.wav', 'https://example.com/file.wav', '/notes.txt']) {
      const invalid = structuredClone(catalog);
      invalid.candidates[0].comparisons[0].candidate.url = url;
      const parsed = parseSampleLabCatalog(invalid);
      expect(parsed.ok, url).toBe(false);
      if (!parsed.ok) expect(parsed.errors.join('\n')).toContain('root-relative local audio URL');
    }
  });
});

describe('evaluateCandidateReadiness', () => {
  it('separates hard gates from human listening instead of producing a fake quality score', () => {
    const readiness = evaluateCandidateReadiness(catalog.candidates[0], catalog.sources);
    expect(readiness.level).toBe('decision-ready');
    expect(readiness.blockers).toEqual([]);
    expect(readiness).not.toHaveProperty('score');
  });

  it('keeps one-note smoke previews reviewable but not decision-ready', () => {
    const candidate = structuredClone(catalog.candidates[0]);
    candidate.comparisons = candidate.comparisons.slice(0, 1);
    const readiness = evaluateCandidateReadiness(candidate, catalog.sources);
    expect(readiness.level).toBe('reviewable');
    expect(readiness.blockers).toContain('Need at least 3 pitch-matched anchors for a promotion decision');
  });

  it('requires decision anchors to span at least one octave', () => {
    const candidate = structuredClone(catalog.candidates[0]);
    candidate.comparisons.forEach((anchor, index) => { anchor.targetMidi = 48 + index; });
    const readiness = evaluateCandidateReadiness(candidate, catalog.sources);
    expect(readiness.level).toBe('reviewable');
    expect(readiness.blockers).toContain('Pitch anchors must span at least one octave');
  });

  it('blocks hard audio defects and missing browser decode evidence', () => {
    const candidate = structuredClone(catalog.candidates[0]);
    candidate.objective = { hardErrors: 1, reviewFlags: 0, browserDecode: false };
    const readiness = evaluateCandidateReadiness(candidate, catalog.sources);
    expect(readiness.level).toBe('blocked');
    expect(readiness.blockers).toContain('Objective audit has 1 hard error');
    expect(readiness.blockers).toContain('Browser decode has not passed');
  });
});

describe('pitch-matched comparison playback', () => {
  it('plays each source at the same target pitch even when roots differ', () => {
    expect(playbackRateForTarget(60, 60)).toBe(1);
    expect(playbackRateForTarget(60, 61)).toBeCloseTo(2 ** (-1 / 12), 10);
    expect(playbackRateForTarget(60, 62)).toBeCloseTo(2 ** (-2 / 12), 10);
  });
});

describe('SFZ inspection', () => {
  const sfz = `
    <control> default_path=Samples/
    <global> ampeg_release=0.4
    <group> lovel=0 hivel=63 seq_length=2
    <region> sample=C2 soft rr1.wav key=36 seq_position=1
    <region> sample=C2 soft rr2.wav key=C2 seq_position=2
    <group> lovel=64 hivel=127 seq_length=2
    <region> sample=C2 loud rr1.wav pitch_keycenter=36 lokey=34 hikey=41 seq_position=1
    <region> sample=C2 loud rr2.wav pitch_keycenter=C2 lokey=34 hikey=41 seq_position=2
    <region> sample=F#2 loud.wav key=F#2
  `;

  it('inherits group opcodes and preserves sample paths containing spaces', () => {
    const regions = parseSfz(sfz);
    expect(regions).toHaveLength(5);
    expect(regions[0]).toMatchObject({
      sample: 'Samples/C2 soft rr1.wav',
      rootMidi: 36,
      loVel: 0,
      hiVel: 63,
      sequencePosition: 1,
      sequenceLength: 2,
    });
    expect(regions[3]).toMatchObject({ rootMidi: 36, loKey: 34, hiKey: 41, loVel: 64, hiVel: 127 });
    expect(regions[4].rootMidi).toBe(42);
  });

  it('summarizes note coverage, real velocity layers, and round robins', () => {
    const summary = summarizeSfz(parseSfz(sfz));
    expect(summary).toMatchObject({
      regions: 5,
      uniqueSamples: 5,
      uniqueRootNotes: 2,
      minRootMidi: 36,
      maxRootMidi: 42,
      maxVelocityLayers: 2,
      maxRoundRobins: 2,
    });
  });

  it('recognizes random-range and filename round-robin mappings', () => {
    const randomSfz = `
      <group> key=48 lovel=0 hivel=127
      <region> sample=c3_rr1.wav hirand=0.25
      <region> sample=c3_rr2.wav lorand=0.25 hirand=0.5
      <region> sample=c3_rr3.wav lorand=0.5 hirand=0.75
      <region> sample=c3_rr4.wav lorand=0.75
    `;
    const summary = summarizeSfz(parseSfz(randomSfz));
    expect(summary.maxRoundRobins).toBe(4);
    expect(summary.uniqueRootNotes).toBe(1);
  });

  it('returns structured warnings rather than crashing on incomplete regions', () => {
    const summary = summarizeSfz(parseSfz('<region> sample=orphan.wav\n<region> key=60'));
    expect(summary.regions).toBe(2);
    expect(summary.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('root pitch'),
      expect.stringContaining('sample'),
    ]));
  });

  it('never crashes on arbitrary text and always returns bounded MIDI/velocity data', () => {
    fc.assert(fc.property(fc.string(), input => {
      const regions = parseSfz(input);
      for (const region of regions) {
        for (const midi of [region.rootMidi, region.loKey, region.hiKey]) {
          if (midi !== undefined) expect(midi).toBeGreaterThanOrEqual(0);
          if (midi !== undefined) expect(midi).toBeLessThanOrEqual(127);
        }
        expect(region.loVel).toBeGreaterThanOrEqual(0);
        expect(region.hiVel).toBeLessThanOrEqual(127);
      }
    }), { numRuns: 300 });
  });
});
