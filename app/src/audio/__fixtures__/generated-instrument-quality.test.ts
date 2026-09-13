import { describe, expect, it } from 'vitest';
import { GENERATED_INSTRUMENT_QUALITY_PROFILES } from '../../test/generated-instrument-quality-profiles';
import { generatedQualityGateViolations } from '../../test/generated-instrument-quality-gates';
import type { GeneratedCatalogueAudit } from '../../test/generated-instrument-quality-browser';
import after from './generated-instrument-quality-after.json';
import before from './generated-instrument-quality-before.json';
import bundle from './generated-instrument-quality-bundle.json';

type Voice = typeof before.voices[keyof typeof before.voices];
type Receipt = { voices: Record<string, Voice> };

function voices(receipt: Receipt): Voice[] {
  return Object.values(receipt.voices);
}

function voiceAt(receipt: Receipt, id: string): Voice {
  return receipt.voices[id];
}

function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

describe('generated instrument quality before/after receipt', () => {
  it('binds the candidate receipt to a clean revision, harness, and browser', () => {
    const provenance = (after as unknown as {
      provenance: {
        revision: string;
        sourceTreeDirty: boolean;
        harnessSha256: string;
        browserName: string;
        browserVersion: string;
      };
    }).provenance;
    expect(provenance.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.sourceTreeDirty).toBe(false);
    expect(provenance.harnessSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(provenance.browserName).toBe('chromium');
    expect(provenance.browserVersion).not.toBe('unknown');
  });

  it('passes the same absolute gates used by the live Chromium audit', () => {
    expect(generatedQualityGateViolations(after as unknown as GeneratedCatalogueAudit)).toEqual([]);
  });

  it('audits every generated picker voice across all declared conditions', () => {
    expect(before.voiceCount).toBe(73);
    expect(after.voiceCount).toBe(73);
    expect(before.conditionRenderCount).toBe(438);
    expect(after.conditionRenderCount).toBe(438);
    expect(Object.keys(after.voices).sort()).toEqual(
      GENERATED_INSTRUMENT_QUALITY_PROFILES.map(profile => profile.id).sort(),
    );
  });

  it('removes every source true-peak over and every native release discontinuity', () => {
    const beforeOver = voices(before).filter(voice => voice.canonical.truePeakDbfs > 0.1);
    const afterOver = voices(after).filter(voice => voice.canonical.truePeakDbfs > 0.1);
    expect(beforeOver.map(voice => voice.id).sort()).toEqual([
      'synth:growl',
      'tone:metal-cymbal',
      'tone:metal-hihat',
    ]);
    expect(afterOver).toEqual([]);

    const beforeNativeClicks = voices(before).filter(voice =>
      voice.engine === 'synth' && (voice.canonical.boundaryDiscontinuityExcessDb ?? -Infinity) > 24
    );
    const afterNativeClicks = voices(after).filter(voice =>
      voice.engine === 'synth' && (voice.canonical.boundaryDiscontinuityExcessDb ?? -Infinity) > 24
    );
    expect(beforeNativeClicks.map(voice => voice.id).sort()).toEqual([
      'synth:bell',
      'synth:pluck',
      'synth:vibes',
    ]);
    expect(afterNativeClicks).toEqual([]);
    for (const voice of voices(after)) {
      expect(voice.canonical.nonFiniteSamples, voice.id).toBe(0);
      expect(Math.abs(voice.canonical.dcOffset), voice.id).toBeLessThan(0.005);
    }
  });

  it('centres ensemble pitch without narrowing the authored detune spread', () => {
    for (const id of ['synth:supersaw', 'synth:hypersaw'] as const) {
      const previous = before.voices[id].pitch!;
      const current = after.voices[id].pitch!;
      expect(Math.abs(current.middleCents), id).toBeLessThan(2);
      expect(Math.abs(current.middleCents), id).toBeLessThan(Math.abs(previous.middleCents) - 10);
    }
    for (const voice of voices(after)) {
      if (!voice.pitch || voice.pitch.minimumConfidence < 0.8) continue;
      expect(Math.abs(voice.pitch.middleCents), voice.id).toBeLessThanOrEqual(10);
    }
  });

  it('adds deterministic soft-note timbre to materially harmonic sample and Tone paths', () => {
    const count = (receipt: Receipt) => voices(receipt)
      .filter(voice => voice.velocity.softToCanonicalRatio < 0.95).length;
    expect(count(before)).toBe(30);
    expect(count(after)).toBeGreaterThanOrEqual(53);
    for (const id of [
      'hihat',
      'lead',
      'pluck',
      'tone:fm-epiano',
      'tone:duo-lead',
      'tone:am-bell',
    ] as const) {
      expect(after.voices[id].velocity.softToCanonicalRatio, id).toBeLessThan(0.95);
    }
  });

  it('makes inaudibly quiet specialist voices usable while preserving safety', () => {
    const raised = [
      'synth:hoover',
      'tone:fm-epiano',
      'tone:pluck-string',
      'tone:fm-bell',
      'tone:am-bell',
      'tone:am-tremolo',
    ] as const;
    for (const id of raised) {
      expect(after.voices[id].canonical.loudnessKMax, id)
        .toBeGreaterThan(before.voices[id].canonical.loudnessKMax + 3.5);
      expect(after.voices[id].canonical.truePeakDbfs, id).toBeLessThanOrEqual(0.1);
    }
  });

  it('enforces preset-specific timbral motion rather than one generic trajectory', () => {
    for (const profile of GENERATED_INSTRUMENT_QUALITY_PROFILES) {
      const metrics = voiceAt(after, profile.id).canonical;
      if (profile.motion === 'darken') {
        expect(metrics.earlyToLateCentroidRatio, profile.id).toBeGreaterThan(1.1);
      } else if (profile.motion === 'brighten') {
        expect(metrics.earlyToLateCentroidRatio, profile.id).toBeLessThan(0.9);
      } else if (profile.motion === 'vary') {
        expect(
          metrics.spectralFlux > 0.01 || metrics.amplitudeModulationDepthDb > 0.25,
          profile.id,
        ).toBe(true);
      }
    }
  });

  it('keeps articulation finite and the high-rate alias comparison neutral', () => {
    for (const voice of voices(after)) {
      expect(Number.isFinite(voice.canonical.logAttackTime), voice.id).toBe(true);
      expect(voice.articulation.shortTemporalCentroidSeconds, voice.id).toBeGreaterThanOrEqual(0);
      expect(voice.articulation.sustainedTemporalCentroidSeconds, voice.id).toBeGreaterThanOrEqual(0);
    }
    const comparableIds = Object.keys(after.voices).filter(id =>
      voiceAt(after, id).aliasingLogSpectralDistanceDb !== null
      && voiceAt(before, id).aliasingLogSpectralDistanceDb !== null
    );
    const beforeMedian = median(comparableIds.map(id =>
      voiceAt(before, id).aliasingLogSpectralDistanceDb as number
    ));
    const afterMedian = median(comparableIds.map(id =>
      voiceAt(after, id).aliasingLogSpectralDistanceDb as number
    ));
    expect(afterMedian).toBeLessThanOrEqual(beforeMedian + 1);
  });

  it('retains real-time headroom under representative maximum polyphony', () => {
    for (const result of Object.values(after.polyphony)) {
      expect(result.nonFiniteSamples).toBe(0);
      expect(result.realtimeFactor).toBeGreaterThan(2);
    }
  });

  it('keeps the complete production JavaScript increase below one compressed kilobyte', () => {
    expect(bundle.candidateCommit).toBe(
      (after as unknown as { provenance: { revision: string } }).provenance.revision,
    );
    expect(bundle.combinedJavaScript.deltaGzipBytes).toBe(920);
    expect(bundle.combinedJavaScript.deltaGzipBytes).toBeLessThan(1024);
    expect(bundle.combinedJavaScript.deltaGzipPercent).toBeLessThan(0.5);
  });
});
