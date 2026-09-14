import {
  createCounterbalancedTrials,
  type ListeningManifest as Manifest,
  type ListeningTrial as Trial,
  type SourceId,
} from './generated-quality-listening-protocol';

type BlindChoice = 'A' | 'B' | 'tie';

interface Vote {
  sectionId: string;
  blindChoice: BlindChoice;
  preference: SourceId | 'tie';
  confidence: number;
}

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
};

const audioContext = new AudioContext();
const buffers = new Map<SourceId, AudioBuffer>();
const gains = new Map<string, Record<SourceId, number>>();
const votes: Vote[] = [];
let activeSource: AudioBufferSourceNode | null = null;
let trialIndex = 0;
let trials: Trial[] = [];

function seedNumber(seed: string): number {
  return Number.parseInt(seed.slice(0, 8), 16) || 1;
}

function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ state >>> 15, 1 | state);
    value ^= value + Math.imul(value ^ value >>> 7, 61 | value);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function activeRms(buffer: AudioBuffer, start: number, duration: number): number {
  const startFrame = Math.round(start * buffer.sampleRate);
  const endFrame = Math.min(buffer.length, Math.round((start + duration) * buffer.sampleRate));
  const windowFrames = Math.max(1, Math.round(buffer.sampleRate * 0.02));
  let activeEnergy = 0;
  let activeCount = 0;
  for (let windowStart = startFrame; windowStart < endFrame; windowStart += windowFrames) {
    const windowEnd = Math.min(endFrame, windowStart + windowFrames);
    let energy = 0;
    let count = 0;
    for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex++) {
      const channel = buffer.getChannelData(channelIndex);
      for (let frame = windowStart; frame < windowEnd; frame++) {
        energy += channel[frame] ** 2;
        count++;
      }
    }
    const windowRms = Math.sqrt(energy / Math.max(1, count));
    if (windowRms >= 0.003) {
      activeEnergy += energy;
      activeCount += count;
    }
  }
  return Math.sqrt(activeEnergy / Math.max(1, activeCount));
}

function regionPeak(buffer: AudioBuffer, start: number, duration: number): number {
  const startFrame = Math.round(start * buffer.sampleRate);
  const endFrame = Math.min(buffer.length, Math.round((start + duration) * buffer.sampleRate));
  let peak = 0;
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex++) {
    const channel = buffer.getChannelData(channelIndex);
    for (let frame = startFrame; frame < endFrame; frame++) peak = Math.max(peak, Math.abs(channel[frame]));
  }
  return peak;
}

function calculateGains(manifest: Manifest): void {
  for (const section of manifest.sections) {
    const baseline = buffers.get('baseline')!;
    const candidate = buffers.get('candidate')!;
    const rms = {
      baseline: activeRms(baseline, section.start, section.duration),
      candidate: activeRms(candidate, section.start, section.duration),
    };
    const target = Math.min(rms.baseline, rms.candidate);
    const matched = {
      baseline: target / Math.max(rms.baseline, 1e-9),
      candidate: target / Math.max(rms.candidate, 1e-9),
    };
    for (const source of ['baseline', 'candidate'] as const) {
      const peak = regionPeak(buffers.get(source)!, section.start, section.duration);
      matched[source] = Math.min(matched[source], 0.98 / Math.max(peak, 1e-9));
    }
    gains.set(section.id, matched);
  }
}

function stop(): void {
  if (!activeSource) return;
  try { activeSource.stop(); } catch { /* already ended */ }
  activeSource.disconnect();
  activeSource = null;
}

async function play(label: 'A' | 'B'): Promise<void> {
  const trial = trials[trialIndex];
  const sourceId = label === 'A' ? trial.a : trial.b;
  const buffer = buffers.get(sourceId)!;
  await audioContext.resume();
  stop();
  const source = audioContext.createBufferSource();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime + 0.02;
  const fade = Math.min(0.008, trial.section.duration / 8);
  source.buffer = buffer;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(gains.get(trial.section.id)![sourceId], now + fade);
  gain.gain.setValueAtTime(gains.get(trial.section.id)![sourceId], now + trial.section.duration - fade);
  gain.gain.linearRampToValueAtTime(0, now + trial.section.duration);
  source.connect(gain).connect(audioContext.destination);
  source.start(now, trial.section.start, trial.section.duration);
  activeSource = source;
  element<HTMLOutputElement>('status').value = `Playing ${label}`;
  source.onended = () => {
    if (activeSource === source) activeSource = null;
  };
}

function renderTrial(): void {
  const trial = trials[trialIndex];
  element('counter').textContent = `Trial ${trialIndex + 1} of ${trials.length}`;
  element('section').textContent = trial.section.label;
  element<HTMLElement>('progress').style.width = `${100 * trialIndex / trials.length}%`;
  element<HTMLOutputElement>('status').value = '';
  for (const id of ['play-a', 'play-b', 'vote-a', 'vote-b', 'vote-tie']) {
    element<HTMLButtonElement>(id).disabled = false;
  }
}

function wilson(successes: number, trialsCount: number): [number, number] | null {
  if (trialsCount === 0) return null;
  const z = 1.96;
  const p = successes / trialsCount;
  const denominator = 1 + z ** 2 / trialsCount;
  const centre = (p + z ** 2 / (2 * trialsCount)) / denominator;
  const margin = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * trialsCount)) / trialsCount) / denominator;
  return [centre - margin, centre + margin];
}

function complete(manifest: Manifest, manifestSha256: string): void {
  stop();
  element('trial').classList.add('hidden');
  element('complete').classList.remove('hidden');
  element<HTMLElement>('progress').style.width = '100%';
  const candidate = votes.filter(vote => vote.preference === 'candidate').length;
  const baseline = votes.filter(vote => vote.preference === 'baseline').length;
  const ties = votes.length - candidate - baseline;
  const interval = wilson(candidate, candidate + baseline);
  element('summary').textContent = `Candidate preferred ${candidate}; baseline preferred ${baseline}; no preference ${ties}.`;
  const result = {
    schemaVersion: 2,
    seed: manifest.seed,
    manifestSha256,
    sourceHashes: {
      baseline: manifest.sources.baseline.sha256,
      candidate: manifest.sources.candidate.sha256,
    },
    sourceProvenance: {
      baseline: manifest.sources.baseline.provenance,
      candidate: manifest.sources.candidate.provenance,
    },
    counterbalanced: true,
    votes,
    totals: { candidate, baseline, ties },
    candidatePreferenceRateExcludingTies: candidate + baseline > 0
      ? candidate / (candidate + baseline)
      : null,
    wilson95: interval,
    completedAt: new Date().toISOString(),
  };
  element('result').textContent = JSON.stringify(result, null, 2);
}

function vote(choice: BlindChoice, manifest: Manifest, manifestSha256: string): void {
  const trial = trials[trialIndex];
  const preference = choice === 'tie' ? 'tie' : choice === 'A' ? trial.a : trial.b;
  votes.push({
    sectionId: trial.section.id,
    blindChoice: choice,
    preference,
    confidence: Number(element<HTMLInputElement>('confidence').value),
  });
  trialIndex++;
  if (trialIndex >= trials.length) complete(manifest, manifestSha256);
  else renderTrial();
}

async function initialize(): Promise<void> {
  const assetRoot = new URL('./__generated-quality-listening/', window.location.href);
  const response = await fetch(new URL('manifest.json', assetRoot), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Listening manifest unavailable (${response.status})`);
  const manifestBytes = await response.arrayBuffer();
  const manifestSha256 = await sha256Hex(manifestBytes);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as Manifest;
  if (manifest.schemaVersion !== 2) throw new Error('Unsupported listening manifest');
  await Promise.all((['baseline', 'candidate'] as const).map(async source => {
    const audioResponse = await fetch(new URL(manifest.sources[source].file, assetRoot));
    if (!audioResponse.ok) throw new Error(`Capture unavailable (${audioResponse.status})`);
    const bytes = await audioResponse.arrayBuffer();
    const actualSha256 = await sha256Hex(bytes);
    if (actualSha256 !== manifest.sources[source].sha256) {
      throw new Error(`${source} capture digest mismatch`);
    }
    buffers.set(source, await audioContext.decodeAudioData(bytes.slice(0)));
  }));
  calculateGains(manifest);
  const random = prng(seedNumber(manifest.seed));
  trials = createCounterbalancedTrials(manifest, random);
  element('play-a').addEventListener('click', () => void play('A'));
  element('play-b').addEventListener('click', () => void play('B'));
  element('vote-a').addEventListener('click', () => vote('A', manifest, manifestSha256));
  element('vote-b').addEventListener('click', () => vote('B', manifest, manifestSha256));
  element('vote-tie').addEventListener('click', () => vote('tie', manifest, manifestSha256));
  element<HTMLInputElement>('confidence').addEventListener('input', event => {
    element('confidence-value').textContent = (event.currentTarget as HTMLInputElement).value;
  });
  renderTrial();
}

void initialize().catch(error => {
  element('counter').textContent = 'Unable to load listening material';
  element('section').textContent = error instanceof Error ? error.message : String(error);
});
