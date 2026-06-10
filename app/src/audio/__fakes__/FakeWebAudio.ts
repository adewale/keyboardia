/**
 * Purpose-built fakes for the Web Audio nodes that SampledInstrument
 * touches. Unlike the ad-hoc `vi.fn()` mocks in older tests, these
 * record *typed* automation events so tests can assert on scheduling
 * behaviour (start times, envelope anchors, choke fades) rather than
 * just "was called".
 *
 * See README.md in this directory for the fakes-over-mocks rationale.
 */

export interface AutomationEvent {
  type:
    | 'setValueAtTime'
    | 'linearRampToValueAtTime'
    | 'exponentialRampToValueAtTime'
    | 'setTargetAtTime'
    | 'cancelScheduledValues';
  value: number;
  time: number;
  /** Only for setTargetAtTime */
  timeConstant?: number;
}

export class FakeAudioParam {
  value = 1;
  readonly events: AutomationEvent[] = [];

  setValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'setValueAtTime', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'linearRampToValueAtTime', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ type: 'exponentialRampToValueAtTime', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    this.events.push({ type: 'setTargetAtTime', value, time, timeConstant });
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.events.push({ type: 'cancelScheduledValues', value: 0, time });
    return this;
  }

  eventsOfType(type: AutomationEvent['type']): AutomationEvent[] {
    return this.events.filter(e => e.type === type);
  }
}

export class FakeAudioBuffer {
  /** Test-visible identity: which fetched payload produced this buffer. */
  readonly label: string;
  readonly duration: number;
  readonly numberOfChannels = 2;
  readonly sampleRate = 44100;
  readonly length: number;

  constructor(label: string, duration = 5) {
    this.label = label;
    this.duration = duration;
    this.length = Math.round(duration * this.sampleRate);
  }
  getChannelData(): Float32Array {
    return new Float32Array(this.length);
  }
}

export class FakeGainNode {
  readonly gain = new FakeAudioParam();
  readonly connectedTo: unknown[] = [];
  disconnected = false;

  connect(node: unknown): unknown {
    this.connectedTo.push(node);
    return node;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

export interface StartCall {
  when?: number;
  offset?: number;
  duration?: number;
}

export class FakeBufferSourceNode {
  buffer: FakeAudioBuffer | null = null;
  readonly playbackRate = new FakeAudioParam();
  loop = false;
  loopStart = 0;
  loopEnd = 0;
  onended: (() => void) | null = null;

  readonly startCalls: StartCall[] = [];
  readonly stopCalls: number[] = [];
  readonly connectedTo: unknown[] = [];
  disconnected = false;

  start(when?: number, offset?: number, duration?: number): void {
    this.startCalls.push({ when, offset, duration });
  }
  stop(when: number): void {
    this.stopCalls.push(when);
  }
  connect(node: unknown): unknown {
    this.connectedTo.push(node);
    return node;
  }
  disconnect(): void {
    this.disconnected = true;
  }
  /** Simulate natural end of playback (fires cleanup). */
  fireEnded(): void {
    this.onended?.();
  }
}

/**
 * Fake AudioContext covering exactly the surface SampledInstrument uses:
 * state / currentTime / createBufferSource / createGain / decodeAudioData / resume.
 *
 * decodeAudioData labels each buffer with the UTF-8 contents of the
 * ArrayBuffer it was given, so a test's fetch stub can encode the
 * *filename* into the payload and later assert which file a played
 * buffer came from (see makeSampleFetchStub below).
 */
export class FakeAudioContext {
  state: AudioContextState = 'running';
  currentTime = 0;
  readonly createdSources: FakeBufferSourceNode[] = [];
  readonly createdGains: FakeGainNode[] = [];
  resumeCalls = 0;
  /** Duration assigned to decoded buffers (override per test if needed). */
  decodedDuration = 5;

  createBufferSource(): FakeBufferSourceNode {
    const node = new FakeBufferSourceNode();
    this.createdSources.push(node);
    return node;
  }
  createGain(): FakeGainNode {
    const node = new FakeGainNode();
    this.createdGains.push(node);
    return node;
  }
  decodeAudioData(data: ArrayBuffer): Promise<FakeAudioBuffer> {
    const label = new TextDecoder().decode(data);
    return Promise.resolve(new FakeAudioBuffer(label, this.decodedDuration));
  }
  resume(): Promise<void> {
    this.resumeCalls += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  /** Cast helper for injecting into code typed against the real AudioContext. */
  asAudioContext(): AudioContext {
    return this as unknown as AudioContext;
  }

  get lastSource(): FakeBufferSourceNode {
    if (this.createdSources.length === 0) throw new Error('no source created');
    return this.createdSources[this.createdSources.length - 1];
  }
  get lastGain(): FakeGainNode {
    if (this.createdGains.length === 0) throw new Error('no gain created');
    return this.createdGains[this.createdGains.length - 1];
  }
}

// Compile-time fidelity guard: if the real AudioContext renames any of the
// methods/properties SampledInstrument uses, this stops compiling.
type UsedAudioContextSurface = Pick<
  AudioContext,
  'state' | 'currentTime' | 'createBufferSource' | 'createGain' | 'decodeAudioData' | 'resume'
>;
const _surfaceCheck: Record<keyof UsedAudioContextSurface, unknown> = new FakeAudioContext();
void _surfaceCheck;

/**
 * fetch stub for instrument loading: serves `manifest` for manifest.json
 * and, for any other URL, an ArrayBuffer containing the requested
 * filename — which FakeAudioContext.decodeAudioData turns into a
 * buffer labelled with that filename.
 */
export function makeSampleFetchStub(manifest: unknown): typeof fetch {
  return ((url: string | URL | Request) => {
    const urlString = url.toString();
    if (urlString.endsWith('manifest.json')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(manifest),
      } as Response);
    }
    const filename = urlString.split('/').slice(-1)[0];
    const payload = new TextEncoder().encode(filename);
    const body = payload.buffer.slice(
      payload.byteOffset,
      payload.byteOffset + payload.byteLength
    ) as ArrayBuffer;
    return Promise.resolve({
      ok: true,
      arrayBuffer: () => Promise.resolve(body),
    } as Response);
  }) as typeof fetch;
}
