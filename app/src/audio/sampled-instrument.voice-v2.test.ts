import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SampledInstrument, type InstrumentManifest } from './sampled-instrument';
import { ManagedSampleVoice } from './sample-voice';
import { sampleCache } from './lru-sample-cache';
import {
  FakeAudioContext,
  FakeGainNode,
  makeSampleFetchStub,
} from './__fakes__/FakeWebAudio';
import { RELEASE_TAIL_GUARD_SEC } from './note-schedule';

let instrumentOrdinal = 0;

async function loadedInstrument(
  partial: Partial<InstrumentManifest> & Pick<InstrumentManifest, 'samples'>,
  maxVoices = 32,
  contextSampleRate = 44_100,
) {
  const id = partial.id ?? `voice-v2-${++instrumentOrdinal}`;
  const manifest: InstrumentManifest = {
    id,
    name: 'Voice v2 fixture',
    type: 'sampled',
    releaseTime: 0.2,
    ...partial,
  };
  vi.stubGlobal('fetch', makeSampleFetchStub(manifest));
  const context = new FakeAudioContext(contextSampleRate);
  const destination = new FakeGainNode();
  const instrument = new SampledInstrument(id, '/instruments', { maxVoices });
  instrument.initialize(context.asAudioContext(), destination as unknown as AudioNode);
  expect(await instrument.ensureLoaded()).toBe(true);
  await instrument.waitForBackgroundLoad();
  return { context, instrument };
}

beforeEach(() => sampleCache.clear());
afterEach(() => vi.unstubAllGlobals());

describe('managed SampledInstrument v2 voices', () => {
  it('rejects overlapping release-region velocity declarations deterministically', async () => {
    const manifest: InstrumentManifest = {
      id: 'ambiguous-release-regions',
      name: 'Ambiguous release regions',
      type: 'sampled',
      releaseTime: 0.1,
      samples: [{ note: 60, file: 'body.mp3', releaseGroup: 'keys' }],
      releaseRegions: [
        {
          file: 'release-a.mp3', rootMidi: 60, velocityMin: 0, velocityMax: 80,
          roundRobin: 0, heldDecayDbPerSecond: 0, gainDb: 0, releaseGroup: 'keys',
        },
        {
          file: 'release-b.mp3', rootMidi: 60, velocityMin: 64, velocityMax: 127,
          roundRobin: 0, heldDecayDbPerSecond: 0, gainDb: 0, releaseGroup: 'keys',
        },
      ],
    };
    vi.stubGlobal('fetch', makeSampleFetchStub(manifest));
    const context = new FakeAudioContext();
    const instrument = new SampledInstrument(manifest.id, '/instruments');
    instrument.initialize(
      context.asAudioContext(),
      new FakeGainNode() as unknown as AudioNode,
    );
    expect(await instrument.ensureLoaded()).toBe(false);
    expect(instrument.isReady()).toBe(false);
  });

  it('runs finite trigger AHD independently of gate/note-off', async () => {
    const { context, instrument } = await loadedInstrument({
      samples: [{ note: 60, file: 'finite.mp3' }],
    });
    const voice = instrument.playVoice({
      id: 'trigger-1',
      midiNote: 60,
      time: 1,
      duration: 0.05,
      mode: 'trigger',
      envelope: {
        model: 'ahd',
        attack: { value: 0.01, unit: 'seconds' },
        hold: { value: 0.02, unit: 'seconds' },
        decay: { value: 0.03, unit: 'seconds' },
      },
    });

    expect(voice?.mode).toBe('trigger');
    expect(voice?.gate(1.02)).toBe(false);
    expect(context.lastSource.stopCalls[0]).toBeCloseTo(1.06 + RELEASE_TAIL_GUARD_SEC, 8);
    expect(context.lastGain.gain.eventsOfType('linearRampToValueAtTime')
      .find(event => event.time === 1.06))
      .toMatchObject({ value: 0.0001, time: 1.06 });
  });

  it('runs gated AR and preserves an authored zero release', async () => {
    const { context, instrument } = await loadedInstrument({
      samples: [{ note: 60, file: 'gate.mp3' }],
    });
    const voice = instrument.playVoice({
      id: 'gate-1',
      midiNote: 60,
      time: 2,
      duration: 0.25,
      mode: 'gate',
      envelope: {
        model: 'ar',
        attack: { value: 0, unit: 'seconds' },
        release: { value: 0, unit: 'seconds' },
      },
    });

    expect(voice?.mode).toBe('gate');
    expect(voice?.state).toBe('released');
    expect(voice?.completionSeconds).toBeCloseTo(2.25 + RELEASE_TAIL_GUARD_SEC, 8);
    expect(context.lastSource.stopCalls[0]).toBeCloseTo(2.25 + RELEASE_TAIL_GUARD_SEC, 8);
    expect(context.lastGain.gain.eventsOfType('exponentialRampToValueAtTime')).toHaveLength(0);
  });

  it('ends an authored 300ms sampled release at the same canonical landmark', async () => {
    const { context, instrument } = await loadedInstrument({
      samples: [{ note: 60, file: 'gate-300ms.mp3' }],
    });
    const voice = instrument.playVoice({
      id: 'gate-300ms',
      midiNote: 60,
      time: 2,
      duration: 0.25,
      mode: 'gate',
      envelope: {
        model: 'ar',
        attack: { value: 0.1, unit: 'seconds' },
        release: { value: 0.3, unit: 'seconds' },
      },
    });

    expect(context.lastGain.gain.eventsOfType('exponentialRampToValueAtTime').at(-1))
      .toMatchObject({ value: 0.0001, time: 2.55 });
    expect(voice?.completionSeconds).toBeCloseTo(2.55 + RELEASE_TAIL_GUARD_SEC, 8);
    expect(context.lastSource.stopCalls[0])
      .toBeCloseTo(2.55 + RELEASE_TAIL_GUARD_SEC, 8);
  });

  it('converts validated frame loops to seconds and runs loop ADSR', async () => {
    const { context, instrument } = await loadedInstrument({
      loopApproval: { status: 'test-approved', crossfadeFrames: 0, note: 'Fixture loop.' },
      samples: [{
        note: 60,
        file: 'hammond.mp3',
        loop: true,
        sustainLoop: {
          startFrame: 44_100,
          endFrame: 176_400,
          crossfadeFrames: 0,
          direction: 'forward',
        },
      }],
    });
    const voice = instrument.playVoice({
      id: 'hammond-1',
      midiNote: 60,
      time: 0,
      duration: 1,
      mode: 'loop',
      envelope: {
        model: 'adsr',
        attack: { value: 0.01, unit: 'seconds' },
        decay: { value: 0.1, unit: 'seconds' },
        sustain: 0.6,
        release: { value: 0.2, unit: 'seconds' },
      },
    });

    expect(voice?.mode).toBe('loop');
    expect(context.lastSource.loop).toBe(true);
    expect(context.lastSource.loopStart).toBe(1);
    expect(context.lastSource.loopEnd).toBe(4);
    expect(context.lastGain.gain.eventsOfType('linearRampToValueAtTime'))
      .toContainEqual(expect.objectContaining({ value: 0.6, time: 0.11 }));
    expect(context.lastGain.gain.eventsOfType('exponentialRampToValueAtTime')[0]?.time)
      .toBeCloseTo(1.2, 8);
  });

  it('preserves 44.1k-authored loop times after decoding into a 48k AudioContext', async () => {
    const { context, instrument } = await loadedInstrument({
      decodedSampleRate: 44_100,
      loopApproval: { status: 'test-approved', crossfadeFrames: 0, note: 'Fixture loop.' },
      samples: [{
        note: 60,
        file: 'resampled-hammond.mp3',
        loop: true,
        sustainLoop: {
          startFrame: 44_100,
          endFrame: 176_400,
          crossfadeFrames: 0,
          direction: 'forward',
        },
      }],
    }, 32, 48_000);
    instrument.playVoice({ id: 'resampled-loop', midiNote: 60, time: 0, duration: 1, mode: 'loop' });
    expect(context.lastSource.loopStart).toBe(1);
    expect(context.lastSource.loopEnd).toBe(4);
  });

  it('truthfully degrades unsupported loop crossfades to gate playback', async () => {
    const { context, instrument } = await loadedInstrument({
      samples: [{
        note: 60,
        file: 'crossfade.mp3',
        loop: true,
        sustainLoop: {
          startFrame: 1_000,
          endFrame: 10_000,
          crossfadeFrames: 256,
          direction: 'forward',
        },
      }],
    });
    const voice = instrument.playVoice({
      id: 'unsupported-loop',
      midiNote: 60,
      time: 0,
      duration: 1,
      mode: 'loop',
    });
    expect(voice?.mode).toBe('gate');
    expect(context.lastSource.loop).toBe(false);
  });

  it('rejects v2 model/playback mismatches instead of silently rewriting them', async () => {
    const { context, instrument } = await loadedInstrument({
      samples: [{ note: 60, file: 'finite.mp3' }],
    });
    const voice = instrument.playVoice({
      id: 'invalid-ar-trigger',
      midiNote: 60,
      time: 0,
      mode: 'trigger',
      envelope: {
        model: 'ar',
        attack: { value: 0, unit: 'seconds' },
        release: { value: 1, unit: 'seconds' },
      },
    });
    expect(voice).toBeNull();
    expect(context.createdSources).toHaveLength(0);
  });

  it('owns and starts a mapped release region at note-off with held-time gain', async () => {
    const { context, instrument } = await loadedInstrument({
      samples: [{ note: 60, file: 'sustain.mp3', releaseGroup: 'pianet' }],
      releaseRegions: [{
        file: 'release.mp3',
        rootMidi: 60,
        velocityMin: 0,
        velocityMax: 127,
        roundRobin: 0,
        heldDecayDbPerSecond: 6,
        gainDb: 0,
        releaseGroup: 'pianet',
      }],
    });
    const sourceStart = context.createdSources.length;
    const gainStart = context.createdGains.length;
    const voice = instrument.playVoice({
      id: 'release-trigger',
      midiNote: 60,
      time: 0,
      duration: 1,
      mode: 'gate',
      volume: 1,
    });
    const sources = context.createdSources.slice(sourceStart);
    const gains = context.createdGains.slice(gainStart);

    expect(voice?.sourceCount).toBe(2);
    expect(voice?.gainCount).toBe(2);
    expect(sources.map(source => source.buffer?.label)).toEqual(['sustain.mp3', 'release.mp3']);
    expect(sources[1]?.startCalls[0]?.when).toBe(1);
    expect(gains[1]?.gain.eventsOfType('setValueAtTime')[0]?.value)
      .toBeCloseTo(10 ** (-6 / 20), 8);
    expect(voice?.completionSeconds).toBeCloseTo(6, 8);
  });

  it('steals the oldest voice deterministically at the configured voice cap', async () => {
    const { context, instrument } = await loadedInstrument({
      samples: [{ note: 60, file: 'voice.mp3' }],
    }, 2);
    const first = instrument.playVoice({ id: 'one', midiNote: 60, time: 0, mode: 'trigger' });
    instrument.playVoice({ id: 'two', midiNote: 60, time: 0.1, mode: 'trigger' });
    instrument.playVoice({ id: 'three', midiNote: 60, time: 0.2, mode: 'trigger' });

    expect(first?.state).toBe('stopped');
    expect(context.createdSources.at(-3)?.stopCalls).toContain(0.2);
    expect(instrument.getVoice('one')).toBeNull();
    expect(instrument.getActiveVoiceCount()).toBe(2);
  });

  it('waits for every blended source before completing and disconnects all nodes', async () => {
    const { context, instrument } = await loadedInstrument({
      velocityCrossfade: 8,
      samples: [
        { note: 60, file: 'soft.mp3', velocityMin: 0, velocityMax: 63 },
        { note: 60, file: 'loud.mp3', velocityMin: 64, velocityMax: 127 },
      ],
    });
    const sourceStart = context.createdSources.length;
    const gainStart = context.createdGains.length;
    const voice = instrument.playVoice({
      id: 'blend',
      midiNote: 60,
      time: 0,
      mode: 'trigger',
      velocity: 64,
    });
    const sources = context.createdSources.slice(sourceStart);
    const gains = context.createdGains.slice(gainStart);
    expect(voice?.sourceCount).toBe(2);
    sources[0]?.fireEnded();
    expect(voice?.state).not.toBe('complete');
    sources[1]?.fireEnded();
    await voice?.completion;
    expect(voice?.state).toBe('complete');
    expect(gains.every(gain => gain.disconnected)).toBe(true);
    expect(instrument.getVoice('blend')).toBeNull();
  });

  it('never uses wall-clock timers for release, stop, or completion', async () => {
    const timer = vi.spyOn(globalThis, 'setTimeout');
    const { instrument } = await loadedInstrument({
      samples: [{ note: 60, file: 'clock.mp3' }],
    });
    timer.mockClear();
    const voice = instrument.playVoice({ id: 'clock', midiNote: 60, time: 0, mode: 'gate' });
    voice?.release(0.5);
    voice?.stop(0.6);
    expect(timer).not.toHaveBeenCalled();
    timer.mockRestore();
  });
});

const webAudio = await import('node-web-audio-api').catch(() => null);

describe.skipIf(!webAudio)('ManagedSampleVoice real Web Audio contract', () => {
  it('renders a 300ms AR release and completes from the audio clock', async () => {
    const { OfflineAudioContext } = webAudio!;
    const sampleRate = 48_000;
    const context = new OfflineAudioContext(1, sampleRate * 0.7, sampleRate);
    const source = context.createBufferSource();
    const buffer = context.createBuffer(1, sampleRate * 0.7, sampleRate);
    buffer.getChannelData(0).fill(1);
    source.buffer = buffer;
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);
    const voice = new ManagedSampleVoice({
      id: 'real-audio',
      mode: 'gate',
      startedAtSeconds: 0.01,
      envelope: { model: 'ar', attackSeconds: 0.01, releaseSeconds: 0.3 },
    });
    voice.addPrimaryComponent({ source, gain, peak: 1, naturalEndSeconds: 0.7 });
    source.start(0.01);
    voice.gate(0.1);

    const rendered = await context.startRendering();
    const pcm = rendered.getChannelData(0);
    const peak = Math.max(...pcm.slice(Math.floor(0.025 * sampleRate), Math.floor(0.045 * sampleRate)));
    const tail = Math.max(...pcm.slice(Math.floor(0.25 * sampleRate), Math.floor(0.30 * sampleRate)));
    const afterStop = Math.max(...pcm.slice(Math.floor(0.44 * sampleRate), Math.floor(0.50 * sampleRate)));
    expect(peak).toBeGreaterThan(0.9);
    expect(tail).toBeGreaterThan(0.001);
    expect(tail).toBeLessThan(0.1);
    expect(afterStop).toBeLessThan(1e-7);
    await voice.completion;
    expect(voice.state).toBe('complete');
  });
});
