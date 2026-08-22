import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ENVELOPE_NOTATION_EXAMPLE_SESSIONS,
  PLANNED_ENVELOPE_NOTATION_FEATURES,
} from './__fixtures__/envelope-notation-examples';
import {
  parseEnvelopeSessionNotation,
  serializeEnvelopeNotationStateV24,
  serializeEnvelopeSessionNotation,
  validateEnvelopeNotationCapability,
  type ParsedNotationTrackV24,
} from './session-notation-v24';
import {
  amplitudeAtEnvelopeTimeV2,
  buildEnvelopeOracleTimelineV2,
} from './envelope-oracle-v2';
import { VALID_SAMPLE_IDS } from './instrument-catalog';

function semanticTrack(track: ParsedNotationTrackV24) {
  const stageOrder = { attack: 0, hold: 1, decay: 2, release: 3 } as const;
  return {
    label: track.label,
    pattern: track.pattern,
    stepCount: track.stepCount,
    envelope: track.envelope,
    playbackMode: track.playbackMode,
    gate: track.gate,
    locks: track.locks.slice().sort((left, right) => (
      left.step - right.step || stageOrder[left.stage] - stageOrder[right.stage]
    )),
  };
}

function firstTiedRunLength(pattern: string): number {
  const onset = [...pattern].findIndex((symbol) => symbol === 'x' || symbol === 'X' || symbol === 'o');
  if (onset === -1) return 1;
  let length = 1;
  while (length < pattern.length && pattern[(onset + length) % pattern.length] === '~') {
    length += 1;
  }
  return length;
}

describe('v2.4 envelope notation example corpus', () => {
  it('exports live mixed-unit state, inline ties, and typed locks through the shipped parser', () => {
    const notation = serializeEnvelopeNotationStateV24({
      tempo: 123,
      swing: 57,
      tracks: [{
        name: 'Loop: Organ',
        sampleId: 'sampled:hammond-organ',
        steps: [true, true, false, false],
        parameterLocks: [
          { attackDuration: { value: 5, unit: 'steps' } },
          { tie: true, releaseDuration: { value: 0.25, unit: 'seconds' } },
          null,
          null,
        ],
        transpose: 0,
        volume: 1,
        muted: false,
        stepCount: 4,
        envelopeV2: {
          model: 'adsr',
          attack: { value: 0.01, unit: 'seconds' },
          decay: { value: 2, unit: 'steps' },
          sustain: 0.7,
          release: { value: 0.5, unit: 'seconds' },
        },
        samplePlaybackMode: 'loop',
        gate: 90,
      }],
    });

    expect(notation).toBe(
      'Loop Organ: x~-- [sampled:hammond-organ] [bpm:123] [swing:57] [stepCount:4] '
      + '[play:loop] [amp:adsr,10ms,2st,0.7,500ms] [gate:90%] '
      + '[lock:1,attack,5st] [lock:2,release,250ms]',
    );
    const parsed = parseEnvelopeSessionNotation(notation);
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.tracks[0]).toMatchObject({ pattern: 'x~--', playbackMode: 'loop', gate: 90 });
  });

  it('names only instruments that the shipped catalogue can load', () => {
    const instrumentToken = /\[((?:sampled|synth|tone|advanced):[^\]]+)\]/g;
    const ids = ENVELOPE_NOTATION_EXAMPLE_SESSIONS.flatMap((session) => (
      Array.from(session.notation.matchAll(instrumentToken), (match) => match[1])
    ));
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => !VALID_SAMPLE_IDS.has(id))).toEqual([]);
  });

  it('covers every planned notation and compatibility feature', () => {
    const covered = new Set(ENVELOPE_NOTATION_EXAMPLE_SESSIONS.flatMap((session) => session.features));
    expect([...covered].sort()).toEqual([...PLANNED_ENVELOPE_NOTATION_FEATURES].sort());
  });

  it.each(ENVELOPE_NOTATION_EXAMPLE_SESSIONS)(
    'parses $id without syntax or range errors',
    (example) => {
      const parsed = parseEnvelopeSessionNotation(example.notation);
      expect(parsed.tracks.length).toBeGreaterThan(0);
      expect(parsed.diagnostics).toEqual([]);
      expect(new Set(parsed.tracks.map((track) => track.label))).toEqual(
        new Set(Object.keys(example.capabilities)),
      );
    },
  );

  it.each(ENVELOPE_NOTATION_EXAMPLE_SESSIONS)(
    'round-trips the authored semantics in $id',
    (example) => {
      const first = parseEnvelopeSessionNotation(example.notation);
      const canonical = serializeEnvelopeSessionNotation(first);
      const second = parseEnvelopeSessionNotation(canonical);
      expect(second.diagnostics).toEqual([]);
      expect(second.tracks.map(semanticTrack)).toEqual(first.tracks.map(semanticTrack));
    },
  );

  it.each(ENVELOPE_NOTATION_EXAMPLE_SESSIONS)(
    'reports the expected capability results for $id',
    (example) => {
      const parsed = parseEnvelopeSessionNotation(example.notation);
      const codes = parsed.tracks.flatMap((track) => (
        validateEnvelopeNotationCapability(track, example.capabilities[track.label])
          .map((entry) => entry.code)
      ));
      expect(codes).toEqual(example.expectedCapabilityDiagnosticCodes ?? []);
    },
  );

  it.each(ENVELOPE_NOTATION_EXAMPLE_SESSIONS)(
    'executes every authored envelope in $id through the independent oracle',
    (example) => {
      const parsed = parseEnvelopeSessionNotation(example.notation);
      const timelines = parsed.tracks.flatMap((track) => {
        if (!track.envelope) return [];
        return [buildEnvelopeOracleTimelineV2({
          envelope: track.envelope,
          bpm: example.tempo,
          onsetSeconds: 1,
          tiedSteps: firstTiedRunLength(track.pattern),
          gatePercent: track.gate,
        })];
      });
      expect(timelines.length).toBeGreaterThan(0);
      for (const timeline of timelines) {
        expect(Number.isFinite(timeline.stopSeconds)).toBe(true);
        expect(timeline.stopSeconds).toBeGreaterThanOrEqual(timeline.onsetSeconds);
        expect(Number.isFinite(amplitudeAtEnvelopeTimeV2(timeline, timeline.onsetSeconds))).toBe(true);
      }
    },
  );

  it('normalizes v2.3 fields and dense vectors to canonical v2.4 output', () => {
    const legacy = ENVELOPE_NOTATION_EXAMPLE_SESSIONS.find(
      (session) => session.id === 'legacy-v23-migration',
    );
    expect(legacy).toBeDefined();
    const canonical = serializeEnvelopeSessionNotation(
      parseEnvelopeSessionNotation(legacy?.notation ?? ''),
    );

    expect(canonical).toContain('[amp:adsr,10ms,200ms,0.7,500ms]');
    expect(canonical).toContain('[amp:adsr,0.25st,1st,0.4,2st]');
    expect(canonical).toContain('[gate:75%]');
    expect(canonical).toContain('[lock:1,attack,20ms]');
    expect(canonical.indexOf('[lock:1,attack,20ms]')).toBeLessThan(
      canonical.indexOf('[lock:1,release,700ms]'),
    );
    expect(canonical.indexOf('[lock:1,release,700ms]')).toBeLessThan(
      canonical.indexOf('[lock:5,attack,30ms]'),
    );
    expect(canonical).not.toMatch(/\[(?:env|envUnit|attacks|decays|releases):/);
  });

  it('preserves unknown annotations while canonicalizing envelope annotations', () => {
    const parsed = parseEnvelopeSessionNotation(
      'Future: x--- [futureAmpCurve:exponential] [amp:ad,2ms,400ms]',
    );
    expect(serializeEnvelopeSessionNotation(parsed)).toBe(
      'Future: x--- [futureAmpCurve:exponential] [amp:ad,2ms,400ms]',
    );
  });

  it('accepts a tie at wrap only when the cyclic predecessor is active', () => {
    expect(parseEnvelopeSessionNotation('Valid: ~-------x~~~~~~~').diagnostics).toEqual([]);
    expect(parseEnvelopeSessionNotation('Invalid: ~-------x------').diagnostics).toMatchObject([
      { code: 'orphan-tie', trackLabel: 'Invalid' },
    ]);
  });

  it('reports model arity, stage range, sustain range, and lock range separately', () => {
    const parsed = parseEnvelopeSessionNotation(
      `Bad-Arity: x--- [amp:ar,5ms]
Bad-Ranges: x--- [amp:adsr,-1ms,9s,1.2,97st] [lock:1,attack,49st]`,
    );
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual([
      'invalid-envelope-arity',
      'duration-out-of-range',
      'duration-out-of-range',
      'duration-out-of-range',
      'sustain-out-of-range',
      'duration-out-of-range',
    ]);
  });

  it('applies v2.4 ranges to legacy envelopes and dense locks before normalization', () => {
    const parsed = parseEnvelopeSessionNotation(
      'Legacy-Bad: x--- [env:-1,9,1.2,97] [envUnit:seconds] [attacks:5,-,-,-]',
    );
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual([
      'duration-out-of-range',
      'duration-out-of-range',
      'duration-out-of-range',
      'sustain-out-of-range',
      'duration-out-of-range',
    ]);
  });

  it('rejects duplicate singleton fields, duplicate locks, and mixed legacy/canonical syntax', () => {
    const parsed = parseEnvelopeSessionNotation(
      `Duplicates: x--- [amp:ad,1ms,2ms] [amp:ar,1ms,2ms] [play:gate] [play:loop] [gate:50%] [gate:60%] [lock:1,attack,1ms] [lock:1,attack,2ms]
Mixed: x--- [amp:adsr,1ms,2ms,0.5,3ms] [env:0.1,0.2,0.5,0.3] [attacks:0.1,-,-,-] [lock:1,attack,1ms]`,
    );
    expect(parsed.diagnostics.map((entry) => entry.code)).toEqual([
      'duplicate-annotation',
      'duplicate-amp',
      'duplicate-annotation',
      'duplicate-lock',
      'conflicting-envelope-syntax',
      'conflicting-lock-syntax',
      'duplicate-lock',
    ]);
  });

  it('rejects pattern lengths outside the shared supported step-count set', () => {
    expect(parseEnvelopeSessionNotation('Too-Short: xx').diagnostics).toMatchObject([
      { code: 'unsupported-step-count', trackLabel: 'Too-Short' },
    ]);
  });

  it('keeps the public notation specification aligned with shipped v2.4 syntax', () => {
    const documentation = readFileSync(
      new URL('../../../specs/SESSION-NOTATION.md', import.meta.url),
      'utf8',
    );
    expect(documentation).toContain('**Version:** 2.4.0');
    expect(documentation).toContain('[amp:adsr,10ms,200ms,0.7,2st]');
    expect(documentation).toContain('[lock:9,release,2st]');
    expect(documentation).toContain('`trigger`, `gate`, or `loop`');
    expect(documentation).toContain('Legacy v2.3 input');
    expect(documentation).not.toContain('Text → JSON** | Not implemented');
    expect(documentation).not.toContain('Planned successor');
  });
});
