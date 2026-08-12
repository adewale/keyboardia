type Mode = 'a' | 'b' | 'x' | 'n';

const audioContext = new AudioContext();
const files: Partial<Record<'a' | 'b', AudioBuffer>> = {};
const status = requiredElement<HTMLOutputElement>('status');
const loopStart = requiredElement<HTMLInputElement>('loop-start');
const loopEnd = requiredElement<HTMLInputElement>('loop-end');
let activeSources: AudioBufferSourceNode[] = [];
let activeMode: Mode | null = null;
let blindAnswer: 'a' | 'b' = 'a';

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing audition control #${id}`);
  return element as T;
}

async function loadFile(key: 'a' | 'b', file: File): Promise<void> {
  files[key] = await audioContext.decodeAudioData(await file.arrayBuffer());
  status.value = files.a && files.b
    ? 'Ready. Press A/B for level-matched comparison, X for blind, or N for raw null.'
    : `Loaded ${key.toUpperCase()}; load the other file.`;
}

function onsetFrame(buffer: AudioBuffer, threshold = 0.01): number {
  const channel = buffer.getChannelData(0);
  let frame = 0;
  while (frame < channel.length && Math.abs(channel[frame]) < threshold) frame++;
  return frame;
}

function rms(buffer: AudioBuffer, offsetFrames: number, length: number): number {
  let energy = 0;
  let count = 0;
  for (let channelIndex = 0; channelIndex < buffer.numberOfChannels; channelIndex++) {
    const channel = buffer.getChannelData(channelIndex);
    const end = Math.min(channel.length, offsetFrames + length);
    for (let frame = offsetFrames; frame < end; frame++) {
      energy += channel[frame] ** 2;
      count++;
    }
  }
  return count > 0 ? Math.sqrt(energy / count) : 0;
}

function stopSources(): void {
  for (const source of activeSources) {
    try { source.stop(); } catch { /* already stopped */ }
    source.disconnect();
  }
  activeSources = [];
}

async function selectMode(mode: Mode): Promise<void> {
  if (!files.a || !files.b) {
    status.value = 'Load both files first.';
    return;
  }
  const bufferA = files.a;
  const bufferB = files.b;
  await audioContext.resume();
  stopSources();
  activeMode = mode;
  if (mode === 'x') blindAnswer = Math.random() < 0.5 ? 'a' : 'b';

  const offsetA = onsetFrame(bufferA);
  const offsetB = onsetFrame(bufferB);
  const alignedLength = Math.min(bufferA.length - offsetA, bufferB.length - offsetB);
  const regionStart = Math.floor(alignedLength * Number(loopStart.value) / 100);
  const selectedEnd = Math.floor(alignedLength * Number(loopEnd.value) / 100);
  const regionLength = Math.max(128, selectedEnd - regionStart);
  const rmsA = rms(bufferA, offsetA + regionStart, regionLength);
  const rmsB = rms(bufferB, offsetB + regionStart, regionLength);
  const comparisonScaleB = rmsB > 0 ? rmsA / rmsB : 1;
  const gains = mode === 'n'
    ? { a: 1, b: -1 }
    : { a: mode === 'a' || (mode === 'x' && blindAnswer === 'a') ? 1 : 0,
        b: mode === 'b' || (mode === 'x' && blindAnswer === 'b') ? comparisonScaleB : 0 };

  const startAt = audioContext.currentTime + 0.03;
  for (const key of ['a', 'b'] as const) {
    const buffer = key === 'a' ? bufferA : bufferB;
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = (key === 'a' ? offsetA : offsetB) / buffer.sampleRate + regionStart / buffer.sampleRate;
    source.loopEnd = source.loopStart + regionLength / buffer.sampleRate;
    gain.gain.value = gains[key];
    source.connect(gain).connect(audioContext.destination);
    source.start(startAt, source.loopStart);
    activeSources.push(source);
  }

  for (const candidate of ['a', 'b', 'x', 'n'] as const) {
    requiredElement<HTMLButtonElement>(`mode-${candidate}`).ariaPressed = String(candidate === mode);
  }
  const alignedMs = Math.abs(offsetA / bufferA.sampleRate - offsetB / bufferB.sampleRate) * 1_000;
  status.value = mode === 'x'
    ? `Playing blind X · onset-aligned by ${alignedMs.toFixed(2)} ms.`
    : mode === 'n'
      ? `Raw null (no level scaling) · onset-aligned by ${alignedMs.toFixed(2)} ms.`
      : `Playing ${mode.toUpperCase()} · B comparison gain ${comparisonScaleB.toFixed(3)}.`;
}

for (const key of ['a', 'b'] as const) {
  requiredElement<HTMLInputElement>(`file-${key}`).addEventListener('change', event => {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file) void loadFile(key, file);
  });
}
for (const mode of ['a', 'b', 'x', 'n'] as const) {
  requiredElement<HTMLButtonElement>(`mode-${mode}`).addEventListener('click', () => void selectMode(mode));
}
document.addEventListener('keydown', event => {
  const mode = event.key.toLowerCase();
  if (mode === 'a' || mode === 'b' || mode === 'x' || mode === 'n') void selectMode(mode);
});
for (const slider of [loopStart, loopEnd]) {
  slider.addEventListener('change', () => {
    if (activeMode) void selectMode(activeMode);
  });
}
