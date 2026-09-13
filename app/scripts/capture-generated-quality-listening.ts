/** Capture baseline/candidate session output for the generated-voice blind trial. */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const SAMPLE_RATE_FALLBACK = 48_000;
const TEMPO = 72;
const LOOP_SECONDS = 64 * 60 / (TEMPO * 4);
const CAPTURE_SECONDS = LOOP_SECONDS + 1.25;
// Keep proof-only audio under src/debug so Vite serves it during local
// development without copying several megabytes of generated WAVs into every
// production or staging build via public/.
const OUTPUT_DIR = resolve(process.cwd(), 'src/debug/__generated-quality-listening');

interface SerializedCapture {
  sampleRate: number;
  channels: string[];
  maxRenderFrameDrift: number;
}

interface AlignedPcm {
  sampleRate: number;
  channels: Float32Array[];
  onsetFrame: number;
  peak: number;
  rms: number;
}

function decodeChannel(base64: string): Float32Array {
  const bytes = Buffer.from(base64, 'base64');
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function monoAt(channels: readonly Float32Array[], frame: number): number {
  let sum = 0;
  for (const channel of channels) sum += channel[frame] ?? 0;
  return sum / Math.max(1, channels.length);
}

function findOnset(channels: readonly Float32Array[], sampleRate: number): number {
  const windowFrames = Math.max(16, Math.round(sampleRate * 0.005));
  const threshold = 0.002;
  let energy = 0;
  for (let frame = 0; frame < channels[0].length; frame++) {
    const value = monoAt(channels, frame);
    energy += value * value;
    if (frame >= windowFrames) {
      const expired = monoAt(channels, frame - windowFrames);
      energy -= expired * expired;
    }
    if (frame >= windowFrames && Math.sqrt(Math.max(0, energy) / windowFrames) >= threshold) {
      return Math.max(0, frame - windowFrames);
    }
  }
  throw new Error('Captured session never crossed the onset threshold');
}

function alignCapture(capture: SerializedCapture): AlignedPcm {
  const decoded = capture.channels.map(decodeChannel);
  const onsetFrame = findOnset(decoded, capture.sampleRate);
  const loopFrames = Math.round(LOOP_SECONDS * capture.sampleRate);
  if (onsetFrame + loopFrames > decoded[0].length) {
    throw new Error(`Capture is too short after onset: ${decoded[0].length - onsetFrame}/${loopFrames}`);
  }
  const channels = decoded.map(channel => channel.slice(onsetFrame, onsetFrame + loopFrames));
  let peak = 0;
  let energy = 0;
  let count = 0;
  for (const channel of channels) {
    for (const value of channel) {
      peak = Math.max(peak, Math.abs(value));
      energy += value * value;
      count++;
    }
  }
  return {
    sampleRate: capture.sampleRate,
    channels,
    onsetFrame,
    peak,
    rms: Math.sqrt(energy / Math.max(1, count)),
  };
}

function wav16(pcm: AlignedPcm): Buffer {
  const channelCount = pcm.channels.length;
  const frameCount = pcm.channels[0].length;
  const bytesPerSample = 2;
  const dataBytes = frameCount * channelCount * bytesPerSample;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channelCount, 22);
  wav.writeUInt32LE(pcm.sampleRate, 24);
  wav.writeUInt32LE(pcm.sampleRate * channelCount * bytesPerSample, 28);
  wav.writeUInt16LE(channelCount * bytesPerSample, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let frame = 0; frame < frameCount; frame++) {
    for (const channel of pcm.channels) {
      const value = Math.max(-1, Math.min(1, channel[frame]));
      wav.writeInt16LE(Math.round(value < 0 ? value * 32768 : value * 32767), offset);
      offset += bytesPerSample;
    }
  }
  return wav;
}

async function captureSession(page: Page, url: string): Promise<SerializedCapture> {
  // The procedural voices use randomness at construction time. Give both
  // builds the same generator so the blind test measures implementation, not
  // two unrelated noise realizations.
  await page.addInitScript(() => {
    let state = 0x6d2b79f5;
    Math.random = () => {
      state |= 0;
      state = state + 0x6d2b79f5 | 0;
      let value = Math.imul(state ^ state >>> 15, 1 | state);
      value = value + Math.imul(value ^ value >>> 7, 61 | value) ^ value;
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const play = page.getByTestId('play-button');
  await play.waitFor({ state: 'visible' });

  // One real click creates/resumes the browser audio graph and installs the
  // development capture hook. Stop before arming the actual trial capture.
  await play.click();
  await page.waitForFunction(() => Boolean(
    (window as unknown as { __captureMaster__?: unknown }).__captureMaster__,
  ));
  await page.waitForTimeout(350);
  await play.click();
  await page.waitForTimeout(250);
  await page.evaluate(async () => {
    await (window as unknown as {
      __captureMaster__: (seconds: number) => Promise<unknown>;
    }).__captureMaster__(0.08);
  });

  await page.evaluate(async (seconds) => {
    const target = window as unknown as {
      __captureMaster__: (duration: number) => Promise<unknown>;
      __generatedQualityCapture__?: Promise<unknown>;
    };
    target.__generatedQualityCapture__ = target.__captureMaster__(seconds);
    // Let the recorder arm before the UI schedules step zero.
    await new Promise(resolve => window.setTimeout(resolve, 20));
  }, CAPTURE_SECONDS);
  await play.click();

  const serialized = await page.evaluate(async () => {
    type Capture = {
      sampleRate: number;
      maxRenderFrameDrift: number;
      taps: { userOutput: { channels: Float32Array[] } };
    };
    const capture = await (window as unknown as {
      __generatedQualityCapture__: Promise<Capture>;
    }).__generatedQualityCapture__;
    const channels: string[] = [];
    for (const channel of capture.taps.userOutput.channels) {
      const bytes = new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength);
      let binary = '';
      const chunk = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += chunk) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
      }
      channels.push(btoa(binary));
    }
    return {
      sampleRate: capture.sampleRate,
      maxRenderFrameDrift: capture.maxRenderFrameDrift,
      channels,
    };
  });
  await play.click();
  return serialized;
}

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

const baselineUrl = process.argv[2];
const candidateUrl = process.argv[3];
if (!baselineUrl || !candidateUrl) {
  throw new Error('Usage: capture-generated-quality-listening.ts <baseline-session-url> <candidate-session-url>');
}

const browser = await chromium.launch({ headless: true });
try {
  const baselinePage = await browser.newPage();
  const baselineRaw = await captureSession(baselinePage, baselineUrl);
  await baselinePage.close();

  const candidatePage = await browser.newPage();
  const candidateRaw = await captureSession(candidatePage, candidateUrl);
  await candidatePage.close();

  const baseline = alignCapture(baselineRaw);
  const candidate = alignCapture(candidateRaw);
  if (baseline.sampleRate !== candidate.sampleRate) {
    throw new Error(`Sample-rate mismatch: ${baseline.sampleRate}/${candidate.sampleRate}`);
  }
  const baselineWav = wav16(baseline);
  const candidateWav = wav16(candidate);
  const baselineHash = sha256(baselineWav);
  const candidateHash = sha256(candidateWav);
  const baselineFile = `source-${baselineHash.slice(0, 12)}.wav`;
  const candidateFile = `source-${candidateHash.slice(0, 12)}.wav`;
  await mkdir(OUTPUT_DIR, { recursive: true });
  await Promise.all([
    writeFile(resolve(OUTPUT_DIR, baselineFile), baselineWav),
    writeFile(resolve(OUTPUT_DIR, candidateFile), candidateWav),
  ]);
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    seed: sha256(Buffer.from(`${baselineHash}:${candidateHash}`)),
    tempo: TEMPO,
    loopSeconds: LOOP_SECONDS,
    repeatsPerSection: 2,
    sources: {
      baseline: { file: baselineFile, sha256: baselineHash },
      candidate: { file: candidateFile, sha256: candidateHash },
    },
    sections: [
      { id: 'dynamics', label: 'Dynamics', start: 0, duration: LOOP_SECONDS / 4 },
      { id: 'tuning', label: 'Tuning', start: LOOP_SECONDS / 4, duration: LOOP_SECONDS / 4 },
      { id: 'endings', label: 'Endings', start: LOOP_SECONDS / 2, duration: LOOP_SECONDS / 4 },
      { id: 'balance', label: 'Balance', start: LOOP_SECONDS * 3 / 4, duration: LOOP_SECONDS / 4 },
    ],
    capture: {
      expectedSampleRate: SAMPLE_RATE_FALLBACK,
      actualSampleRate: baseline.sampleRate,
      baseline: {
        onsetFrame: baseline.onsetFrame,
        maxRenderFrameDrift: baselineRaw.maxRenderFrameDrift,
        peak: baseline.peak,
        rms: baseline.rms,
      },
      candidate: {
        onsetFrame: candidate.onsetFrame,
        maxRenderFrameDrift: candidateRaw.maxRenderFrameDrift,
        peak: candidate.peak,
        rms: candidate.rms,
      },
    },
  };
  await writeFile(resolve(OUTPUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ outputDir: OUTPUT_DIR, ...manifest }, null, 2));
} finally {
  await browser.close();
}
