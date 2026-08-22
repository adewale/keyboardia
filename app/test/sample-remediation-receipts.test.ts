import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { requireOfflineAudio } from '../src/test/session-render';

interface ReceiptFile {
  rootMidi: number;
  sourcePath: string;
  deliveryPath: string;
  deliverySha256: string;
  sourceSha256: string;
  exactByteCopy?: boolean;
  loopStartFrame?: number;
  loopEndFrame?: number;
  webAudioLoopEndExclusiveFrame?: number;
  webAudioLoopEndSec?: number;
}

interface RemediationReceipt {
  version: number;
  instrumentId: string;
  source: Record<string, unknown>;
  transform: Record<string, unknown>;
  files: ReceiptFile[];
}

interface SampleMapping {
  note: number;
  file: string;
  loopStart?: number;
  loopEnd?: number;
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readFileSync(path.resolve(relativePath), 'utf8')) as T;
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function wavData(bytes: Buffer): { channels: number; sampleRate: number; bits: number; pcm: Buffer } {
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF');
  expect(bytes.toString('ascii', 8, 12)).toBe('WAVE');
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bits = 0;
  let pcm: Buffer | undefined;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    if (id === 'fmt ') {
      expect(bytes.readUInt16LE(dataStart)).toBe(1);
      channels = bytes.readUInt16LE(dataStart + 2);
      sampleRate = bytes.readUInt32LE(dataStart + 4);
      bits = bytes.readUInt16LE(dataStart + 14);
    } else if (id === 'data') {
      pcm = bytes.subarray(dataStart, dataStart + size);
    }
    offset = dataStart + size + (size % 2);
  }
  if (!pcm) throw new Error('WAV data chunk missing');
  return { channels, sampleRate, bits, pcm };
}

describe('lossless sample-remediation receipts', () => {
  for (const instrumentId of ['acoustic-guitar', 'hammond-organ']) {
    it(`${instrumentId} binds every mapped delivery byte to provenance`, () => {
      const receipt = readJson<RemediationReceipt>(
        `sample-pipeline/remediation-receipts/${instrumentId}.json`,
      );
      const manifest = readJson<{ samples: SampleMapping[] }>(
        `public/instruments/${instrumentId}/manifest.json`,
      );
      expect(receipt.version).toBe(1);
      expect(receipt.instrumentId).toBe(instrumentId);
      expect(receipt.transform.lossyTranscode).toBe(false);
      expect(receipt.files).toHaveLength(manifest.samples.length);

      const mappings = new Map(manifest.samples.map(sample => [sample.file, sample]));
      const sourcePaths = receipt.files.map(file => file.sourcePath);
      const deliveryNames = receipt.files.map(file => path.basename(file.deliveryPath));
      expect(new Set(sourcePaths).size).toBe(sourcePaths.length);
      expect(new Set(deliveryNames).size).toBe(deliveryNames.length);
      expect([...deliveryNames].sort()).toEqual(
        manifest.samples.map(sample => sample.file).sort(),
      );
      for (const file of receipt.files) {
        expect(path.isAbsolute(file.sourcePath)).toBe(false);
        expect(file.sourcePath.split('/')).not.toContain('..');
        expect(file.deliveryPath).toBe(
          `public/instruments/${instrumentId}/${path.basename(file.deliveryPath)}`,
        );
        expect(file.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(file.deliverySha256).toMatch(/^[0-9a-f]{64}$/);
        const delivery = readFileSync(path.resolve(file.deliveryPath));
        expect(sha256(delivery)).toBe(file.deliverySha256);
        const mapping = mappings.get(path.basename(file.deliveryPath));
        expect(mapping?.note).toBe(file.rootMidi);
      }
    });
  }

  it('acoustic-guitar delivery reaches a real zero boundary after its source-domain fade', () => {
    const receipt = readJson<RemediationReceipt>(
      'sample-pipeline/remediation-receipts/acoustic-guitar.json',
    );
    expect(receipt.source).toMatchObject({
      url: 'https://github.com/sfzinstruments/Discord-SFZ-GM-Bank',
      revision: '7a9c478fe331f94f246d33332f0adedb25bbbe27',
      mappingPath: 'Discord GM/Melodic/026-Acoustic Guitar (steel)/_MartinGM2-loop-sw.sfz',
    });
    expect(receipt.transform).toMatchObject({
      tool: 'ffmpeg 8.1.2',
      commandTemplate: 'ffmpeg -i {sourcePath} -af areverse,afade=t=in:st=0:d=0.01,areverse,apad=pad_dur=0.006 -ar 44100 -ac 1 -c:a pcm_s16le {deliveryPath}',
    });
    expect(receipt.transform.ffmpegAudioFilter).toBe(
      'areverse,afade=t=in:st=0:d=0.01,areverse,apad=pad_dur=0.006',
    );
    for (const file of receipt.files) {
      const decoded = wavData(readFileSync(path.resolve(file.deliveryPath)));
      expect(decoded).toMatchObject({ channels: 1, sampleRate: 44_100, bits: 16 });
      expect(decoded.pcm.subarray(-400).every(byte => byte === 0)).toBe(true);
    }
  });

  it('hammond-organ retains authoritative PCM bytes and SFZ frame loops', () => {
    const receipt = readJson<RemediationReceipt>(
      'sample-pipeline/remediation-receipts/hammond-organ.json',
    );
    expect(receipt.source).toMatchObject({
      archive: 'DrawbarOrganEmulation-SFZ-20190712.tar.xz',
      archiveSha256: 'e2da18b0a4d13be7020037e18e4a719387433357e7603d0773990e794dcf5d0f',
      mappingSha256: 'd3fbbf3d96833cfd3a706204a1bc8a31c81b9fe253812a74ea8b9574b5cfc184',
    });
    const manifest = readJson<{ samples: SampleMapping[] }>(
      'public/instruments/hammond-organ/manifest.json',
    );
    const mappings = new Map(manifest.samples.map(sample => [sample.note, sample]));
    expect(receipt.transform).toMatchObject({
      exactByteCopy: true,
      tool: 'exact byte copy; no audio processor',
      ffmpegAudioFilter: null,
      sourceGainDb: 0,
      manifestGainDb: -3,
      sourceLoopEndConvention: 'SFZ inclusive frame',
      deliveryLoopEndConvention: 'Web Audio exclusive boundary at the source loop_end frame',
    });
    for (const file of receipt.files) {
      expect(file.exactByteCopy).toBe(true);
      expect(file.deliverySha256).toBe(file.sourceSha256);
      expect(mappings.get(file.rootMidi)?.loopStart).toBeCloseTo(file.loopStartFrame! / 44_100, 8);
      expect(file.webAudioLoopEndExclusiveFrame).toBe(file.loopEndFrame);
      expect(file.webAudioLoopEndSec).toBeCloseTo(file.webAudioLoopEndExclusiveFrame! / 44_100, 12);
      expect(mappings.get(file.rootMidi)?.loopEnd).toBeCloseTo(file.webAudioLoopEndSec!, 8);
    }
  });

  it('hammond-organ Web Audio loop boundary avoids replaying the duplicate SFZ endpoint', async () => {
    const receipt = readJson<RemediationReceipt>(
      'sample-pipeline/remediation-receipts/hammond-organ.json',
    );
    const file = receipt.files.find(candidate => candidate.rootMidi === 84)!;
    const decoded = wavData(readFileSync(path.resolve(file.deliveryPath)));
    const samples = new Float32Array(decoded.pcm.length / 2);
    for (let frame = 0; frame < samples.length; frame++) {
      samples[frame] = decoded.pcm.readInt16LE(frame * 2) / 32_768;
    }
    const { OfflineAudioContext } = await requireOfflineAudio();
    const render = async (exclusiveEndFrame: number): Promise<Float32Array> => {
      const seamFrame = 16;
      const context = new OfflineAudioContext(1, 48, decoded.sampleRate);
      const buffer = context.createBuffer(1, samples.length, decoded.sampleRate);
      buffer.getChannelData(0).set(samples);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = file.loopStartFrame! / decoded.sampleRate;
      source.loopEnd = exclusiveEndFrame / decoded.sampleRate;
      source.connect(context.destination);
      source.start(0, (exclusiveEndFrame - seamFrame) / decoded.sampleRate);
      const rendered = await context.startRendering();
      return rendered.getChannelData(0);
    };
    const maximumLocalCurvature = (pcm: Float32Array): number => {
      let maximum = 0;
      for (let frame = 10; frame < 23; frame++) {
        maximum = Math.max(
          maximum,
          Math.abs(pcm[frame] - 2 * pcm[frame - 1] + pcm[frame - 2]),
        );
      }
      return maximum;
    };

    const adaptedExclusive = await render(file.loopEndFrame!);
    const duplicatedInclusive = await render(file.loopEndFrame! + 1);

    expect(maximumLocalCurvature(adaptedExclusive))
      .toBeLessThan(maximumLocalCurvature(duplicatedInclusive));
  });
});
