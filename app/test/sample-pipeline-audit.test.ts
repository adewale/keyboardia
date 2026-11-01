import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  auditDecodedMappings,
  type PipelineDecode,
} from '../scripts/sample-pipeline-audit';
import type { InstrumentManifestPlan } from '../scripts/sample-pipeline-core';
import type { DecodedAudioLike } from '../scripts/sample-quality-core';

function decoded(data: Float32Array, sampleRate = 1000): DecodedAudioLike {
  return {
    numberOfChannels: 1,
    sampleRate,
    length: data.length,
    duration: data.length / sampleRate,
    getChannelData: () => data,
  };
}

const manifest: InstrumentManifestPlan = {
  id: 'audit-fixture',
  name: 'Audit Fixture',
  type: 'sampled',
  releaseTime: 0.5,
  playableRange: { min: 60, max: 60 },
  credits: { source: 'Fixture', url: 'https://example.com', license: 'Fixture' },
  samples: [{ note: 60, file: 'C4.wav', velocityMin: 0, velocityMax: 127 }],
};

describe('candidate objective audit service (stage 9)', () => {
  it('uses canonical decoded metrics and blocks a sabotaged flat-top file', async () => {
    const samples = new Float32Array(1000);
    samples.fill(0.25, 10, 100);
    for (const start of [200, 300, 400, 500]) samples.fill(1, start, start + 10);
    const decode: PipelineDecode = async () => decoded(samples);

    const report = await auditDecodedMappings(manifest, '/candidate', decode);

    expect(report.entries).toHaveLength(1);
    expect(report.hardErrors).toBeGreaterThan(0);
    expect(report.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', code: 'FLAT_TOP_CLIPPING', file: 'C4.wav' }),
    ]));
  });

  it('blocks decoded sample-rate and explicit mono-policy mismatches', async () => {
    const stereo: DecodedAudioLike = {
      ...decoded(new Float32Array(1000), 48000),
      numberOfChannels: 2,
      getChannelData: () => new Float32Array(1000).fill(0.1),
    };
    const report = await auditDecodedMappings(manifest, '/candidate', async () => stereo, {
      delivery: { codec: 'wav', container: 'wav', sampleRate: 44100, channels: { mode: 'mono', method: 'average' } },
    });
    expect(report.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'DELIVERY_SAMPLE_RATE_MISMATCH',
      'DELIVERY_CHANNEL_MISMATCH',
    ]));
  });

  it('blocks duplicate bytes across separately mapped delivery files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-audit-'));
    try {
      fs.writeFileSync(path.join(root, 'A.wav'), 'same');
      fs.writeFileSync(path.join(root, 'B.wav'), 'same');
      const duplicateManifest: InstrumentManifestPlan = {
        ...manifest,
        samples: [
          { note: 60, file: 'A.wav', velocityMin: 0, velocityMax: 63 },
          { note: 60, file: 'B.wav', velocityMin: 64, velocityMax: 127 },
        ],
      };
      const report = await auditDecodedMappings(
        duplicateManifest,
        root,
        async () => decoded(new Float32Array(1000).fill(0.1)),
      );
      expect(report.issues.filter(issue => issue.code === 'DUPLICATE_CONTENT')).toHaveLength(2);
      expect(report.hardErrors).toBeGreaterThanOrEqual(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns exact per-file metrics and review counts without waivers', async () => {
    const samples = new Float32Array(1000);
    for (let index = 20; index < 800; index++) {
      samples[index] = 0.2 * Math.sin(2 * Math.PI * 50 * index / 1000);
    }
    const report = await auditDecodedMappings(manifest, '/candidate', async () => decoded(samples));

    expect(report.entries[0].metrics.instrumentId).toBe('audit-fixture');
    expect(report.entries[0].metrics.file).toBe('C4.wav');
    expect(report.hardErrors).toBe(0);
    expect(report.reviewFlags).toBe(report.issues.filter(issue => issue.severity === 'review').length);
  });
});
