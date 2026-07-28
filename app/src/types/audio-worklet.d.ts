/** AudioWorklet globals omitted from TypeScript's DOM library. */
interface AudioParamDescriptor {
  name: string;
  defaultValue?: number;
  minValue?: number;
  maxValue?: number;
  automationRate?: 'a-rate' | 'k-rate';
}

declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  abstract process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare const currentTime: number;
declare const sampleRate: number;

declare function registerProcessor(
  name: string,
  processorCtor: new (options: AudioWorkletNodeOptions) => AudioWorkletProcessor,
): void;
