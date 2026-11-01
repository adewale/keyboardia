import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { BrowserType } from '@playwright/test';

import type { DeliveryPolicy, InstrumentManifestPlan, LevelingPolicy } from './sample-pipeline-core';
import {
  analyzeDecodedSample,
  classifySampleIssues,
  type DecodedAudioLike,
  type QualityIssue,
  type SampleQualityMetrics,
} from './sample-quality-core';

export type PipelineDecode = (filename: string) => Promise<DecodedAudioLike>;

export interface PipelineAuditEntry {
  file: string;
  metrics: SampleQualityMetrics;
  issues: QualityIssue[];
}

export interface PipelineAuditPolicy {
  delivery: DeliveryPolicy;
  leveling?: LevelingPolicy;
  expectedSourceChannels?: Readonly<Record<string, number>>;
}

export interface PipelineAuditReport {
  version: 1;
  instrumentId: string;
  hardErrors: number;
  reviewFlags: number;
  issues: QualityIssue[];
  entries: PipelineAuditEntry[];
}

interface DecodeAudioContextLike {
  decodeAudioData(buffer: ArrayBuffer): Promise<DecodedAudioLike>;
  close?: () => Promise<void>;
}

async function createNodeDecoder(): Promise<{ decode: PipelineDecode; close: () => Promise<void> }> {
  const webAudio = await import('node-web-audio-api') as {
    OfflineAudioContext: new (channels: number, length: number, sampleRate: number) => DecodeAudioContextLike;
  };
  const context = new webAudio.OfflineAudioContext(1, 1, 44100);
  return {
    decode: async filename => {
      const bytes = fs.readFileSync(filename);
      return context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    },
    close: async () => { await context.close?.(); },
  };
}

/** Canonical per-file objective audit, deliberately without baseline waivers. */
export async function auditDecodedMappings(
  manifest: InstrumentManifestPlan,
  root: string,
  suppliedDecode?: PipelineDecode,
  policy?: PipelineAuditPolicy,
): Promise<PipelineAuditReport> {
  const decoder = suppliedDecode ? null : await createNodeDecoder();
  const decode = suppliedDecode ?? decoder!.decode;
  const entries: PipelineAuditEntry[] = [];
  try {
    const uniqueSamples = [...new Map(manifest.samples.map(sample => [sample.file, sample])).values()];
    for (const sample of uniqueSamples) {
      const filename = path.join(root, ...sample.file.split('/'));
      if (!fs.existsSync(filename) && !suppliedDecode) {
        const issue: QualityIssue = {
          severity: 'error',
          code: 'MISSING_FILE',
          instrumentId: manifest.id,
          file: sample.file,
          message: `Candidate file is missing: ${sample.file}`,
        };
        entries.push({
          file: sample.file,
          metrics: emptyMetrics(manifest, sample),
          issues: [issue],
        });
        continue;
      }
      try {
        const decoded = await decode(filename);
        const metrics = analyzeDecodedSample({
          instrumentId: manifest.id,
          instrumentName: manifest.name,
          file: sample.file,
          note: sample.note,
          velocityMin: sample.velocityMin,
          velocityMax: sample.velocityMax,
          loop: (sample as { loop?: boolean }).loop,
          loopStart: (sample as { loopStart?: number }).loopStart,
          loopEnd: (sample as { loopEnd?: number }).loopEnd,
          pitched: (manifest as { unpitched?: boolean }).unpitched !== true,
        }, decoded);
        const issues = classifySampleIssues(metrics);
        const addBoundsError = (code: string, message: string): void => {
          issues.push({ severity: 'error', code, instrumentId: manifest.id, file: sample.file, message });
        };
        if (sample.startOffset !== undefined && sample.startOffset >= metrics.durationSec) {
          addBoundsError('START_OFFSET_OUT_OF_BOUNDS', `startOffset ${sample.startOffset}s is outside decoded duration ${metrics.durationSec}s`);
        }
        if (sample.endOffset !== undefined && sample.endOffset > metrics.durationSec) {
          addBoundsError('END_OFFSET_OUT_OF_BOUNDS', `endOffset ${sample.endOffset}s exceeds decoded duration ${metrics.durationSec}s`);
        }
        if (sample.loop === true) {
          const loopStart = sample.loopStart ?? 0;
          const loopEnd = sample.loopEnd ?? metrics.durationSec;
          if (loopStart >= metrics.durationSec || loopEnd > metrics.durationSec || loopEnd <= loopStart) {
            addBoundsError('LOOP_OUT_OF_BOUNDS', `loop ${loopStart}-${loopEnd}s is invalid for decoded duration ${metrics.durationSec}s`);
          }
        }
        if (policy?.leveling?.mode === 'group-relative' && metrics.peakDb > policy.leveling.deliveryCeilingDb + 0.1) {
          addBoundsError(
            'GROUP_CEILING_EXCEEDED',
            `decoded peak ${metrics.peakDb.toFixed(2)} dB exceeds delivery ceiling ${policy.leveling.deliveryCeilingDb.toFixed(2)} dB`,
          );
        }
        if (policy && metrics.sampleRate !== policy.delivery.sampleRate) {
          issues.push({
            severity: 'error',
            code: 'DELIVERY_SAMPLE_RATE_MISMATCH',
            instrumentId: manifest.id,
            file: sample.file,
            message: `Decoded sample rate ${metrics.sampleRate} does not match declared ${policy.delivery.sampleRate}`,
          });
        }
        const expectedChannels = policy?.delivery.channels.mode === 'mono'
          ? 1
          : policy?.expectedSourceChannels?.[sample.file];
        if (expectedChannels !== undefined && metrics.channels !== expectedChannels) {
          issues.push({
            severity: 'error',
            code: 'DELIVERY_CHANNEL_MISMATCH',
            instrumentId: manifest.id,
            file: sample.file,
            message: `Decoded channel count ${metrics.channels} does not match declared policy (${expectedChannels})`,
          });
        }
        entries.push({ file: sample.file, metrics, issues });
      } catch (error) {
        const issue: QualityIssue = {
          severity: 'error',
          code: 'DECODE_FAILED',
          instrumentId: manifest.id,
          file: sample.file,
          message: error instanceof Error ? error.message : String(error),
        };
        entries.push({ file: sample.file, metrics: emptyMetrics(manifest, sample), issues: [issue] });
      }
    }
  } finally {
    await decoder?.close();
  }
  const byContent = new Map<string, string[]>();
  for (const file of new Set(manifest.samples.map(sample => sample.file))) {
    const filename = path.join(root, ...file.split('/'));
    if (!fs.existsSync(filename)) continue;
    const digest = createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    const files = byContent.get(digest) ?? [];
    files.push(file);
    byContent.set(digest, files);
  }
  for (const duplicateFiles of byContent.values()) {
    if (duplicateFiles.length < 2) continue;
    for (const file of duplicateFiles) {
      const entry = entries.find(candidate => candidate.file === file);
      entry?.issues.push({
        severity: 'error',
        code: 'DUPLICATE_CONTENT',
        instrumentId: manifest.id,
        file,
        message: `Audio bytes duplicate another mapped output: ${duplicateFiles.filter(candidate => candidate !== file).join(', ')}`,
      });
    }
  }
  const entriesByFile = new Map(entries.map(entry => [entry.file, entry]));
  const velocityGroups = new Map<string, InstrumentManifestPlan['samples']>();
  for (const sample of manifest.samples) {
    const key = `${sample.note}:${sample.articulation ?? 'default'}`;
    const group = velocityGroups.get(key) ?? [];
    group.push(sample);
    velocityGroups.set(key, group);
  }
  for (const [key, samples] of velocityGroups) {
    const ranges = new Map<string, typeof samples>();
    for (const sample of samples) {
      const range = `${sample.velocityMin ?? 0}-${sample.velocityMax ?? 127}`;
      const variants = ranges.get(range) ?? [];
      variants.push(sample);
      ranges.set(range, variants);
    }
    const ordered = [...ranges.entries()].map(([range, variants]) => ({
      range,
      min: variants[0].velocityMin ?? 0,
      files: variants.map(variant => variant.file),
      activeRmsDb: variants.reduce((sum, variant) => sum + (entriesByFile.get(variant.file)?.metrics.activeRmsDb ?? -120), 0) / variants.length,
    })).sort((left, right) => left.min - right.min);
    for (let index = 1; index < ordered.length; index++) {
      const lower = ordered[index - 1];
      const upper = ordered[index];
      const inversionDb = lower.activeRmsDb - upper.activeRmsDb;
      if (inversionDb <= 0) continue;
      const entry = entriesByFile.get(upper.files[0]);
      entry?.issues.push({
        severity: 'review',
        code: 'VELOCITY_ENERGY_INVERSION',
        instrumentId: manifest.id,
        file: upper.files[0],
        message: `${key} higher velocity ${upper.range} is ${inversionDb.toFixed(2)} dB quieter than ${lower.range}`,
      });
    }
  }
  const issues = entries.flatMap(entry => entry.issues);
  return {
    version: 1,
    instrumentId: manifest.id,
    hardErrors: issues.filter(issue => issue.severity === 'error').length,
    reviewFlags: issues.filter(issue => issue.severity === 'review').length,
    issues,
    entries,
  };
}

function emptyMetrics(
  manifest: InstrumentManifestPlan,
  sample: InstrumentManifestPlan['samples'][number]
): SampleQualityMetrics {
  return {
    instrumentId: manifest.id,
    instrumentName: manifest.name,
    file: sample.file,
    note: sample.note,
    velocityMin: sample.velocityMin,
    velocityMax: sample.velocityMax,
    durationSec: 0,
    sampleRate: 0,
    channels: 0,
    peak: 0,
    peakDb: -120,
    rmsDb: -120,
    activeRmsDb: -120,
    loudnessKMax: null,
    playbackGainDb: 0,
    dcOffset: 0,
    dcOffsetDb: -120,
    crestFactorDb: null,
    leadingSilenceMs: 0,
    effectiveLeadingSilenceMs: 0,
    trailingSilenceMs: 0,
    attackMs: null,
    tailLevelDbRelPeak: null,
    clippingSamples: 0,
    flatTopRuns: 0,
    activeStartMs: null,
    activeEndMs: null,
    spectral: { centroidHz: null, highFrequencyRatio: null },
    pitch: { midi: null, frequencyHz: null, rawCents: null, foldedCents: null, confidence: 0 },
    loop: null,
    stereo: null,
  };
}

export interface BrowserDecodeEntry {
  browser: 'chromium' | 'webkit';
  file: string;
  ok: boolean;
  durationSec?: number;
  channels?: number;
  sampleRate?: number;
  peak?: number;
  energy?: number;
  error?: string;
}

export interface BrowserDecodeReport {
  version: 1;
  chromium: boolean;
  webkit: boolean;
  entries: BrowserDecodeEntry[];
}

function mimeType(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  if (extension === '.mp3') return 'audio/mpeg';
  if (extension === '.wav') return 'audio/wav';
  if (extension === '.flac') return 'audio/flac';
  if (extension === '.ogg') return 'audio/ogg';
  return 'audio/mp4';
}

async function checkBrowser(
  name: 'chromium' | 'webkit',
  browserType: BrowserType,
  manifest: InstrumentManifestPlan,
  root: string,
  delivery?: DeliveryPolicy,
): Promise<BrowserDecodeEntry[]> {
  const browser = await browserType.launch({ headless: true });
  const page = await browser.newPage();
  const files = new Map([...new Set(manifest.samples.map(sample => sample.file))].map((file, index) => [String(index), file]));
  try {
    await page.route('http://sample-pipeline.local/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>sample pipeline</title>' });
      const key = pathname.split('/').at(-1)!;
      const file = files.get(key);
      if (!file) return route.fulfill({ status: 404, body: 'missing' });
      return route.fulfill({ body: fs.readFileSync(path.join(root, ...file.split('/'))), contentType: mimeType(file) });
    });
    await page.goto('http://sample-pipeline.local/');
    const entries: BrowserDecodeEntry[] = [];
    for (const [key, file] of files) {
      try {
        const metrics = await page.evaluate(async url => {
          const response = await fetch(url);
          const bytes = await response.arrayBuffer();
          const context = new AudioContext({ sampleRate: 44100 });
          const buffer = await context.decodeAudioData(bytes);
          await context.close();
          let peak = 0;
          let sumSquares = 0;
          let count = 0;
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel);
            for (const value of data) {
              peak = Math.max(peak, Math.abs(value));
              sumSquares += value * value;
              count++;
            }
          }
          return {
            durationSec: buffer.duration,
            channels: buffer.numberOfChannels,
            sampleRate: buffer.sampleRate,
            peak,
            energy: count === 0 ? 0 : Math.sqrt(sumSquares / count),
          };
        }, `http://sample-pipeline.local/audio/${key}`);
        const formatOk = !delivery
          || (metrics.sampleRate === delivery.sampleRate
            && (delivery.channels.mode !== 'mono' || metrics.channels === 1));
        const ok = metrics.durationSec > 0 && metrics.channels > 0 && metrics.energy > 1e-8 && formatOk;
        entries.push({
          browser: name,
          file,
          ok,
          ...metrics,
          ...(!ok ? { error: formatOk ? 'decoded PCM has zero duration/channels/energy' : 'decoded PCM violates delivery sample-rate/channel policy' } : {}),
        });
      } catch (error) {
        entries.push({ browser: name, file, ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return entries;
  } finally {
    await browser.close();
  }
}

/** Independent browser contract: every candidate must decode to non-zero PCM. */
export async function browserDecodeMappings(
  manifest: InstrumentManifestPlan,
  root: string,
  delivery?: DeliveryPolicy,
): Promise<BrowserDecodeReport> {
  const playwright = await import('@playwright/test');
  const entries = [
    ...await checkBrowser('chromium', playwright.chromium, manifest, root, delivery),
    ...await checkBrowser('webkit', playwright.webkit, manifest, root, delivery),
  ];
  return {
    version: 1,
    chromium: entries.filter(entry => entry.browser === 'chromium').every(entry => entry.ok),
    webkit: entries.filter(entry => entry.browser === 'webkit').every(entry => entry.ok),
    entries,
  };
}
