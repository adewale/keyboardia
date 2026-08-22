/**
 * Sampled Instrument Engine - Phase 22/23
 *
 * Handles loading and playback of multi-sampled instruments (piano, strings, etc.)
 * stored in R2. Uses pitch-shifting to fill gaps between sampled notes.
 *
 * Key design decisions:
 * - Progressive loading: C4 loads first for fast initial playback, rest load in background
 * - LRU cache integration (Phase 23): Samples cached with memory-bounded eviction
 * - Lazy loading: Instruments load on-demand, not at startup
 * - Pitch mapping: finds nearest sample and pitch-shifts to target note
 * - Memory efficient: one sample per octave (C2, C3, C4, C5) covers full range
 * - NO synth fallback: sampled instruments never fall back to synth (would confuse users)
 */

import { logger } from '../utils/logger';
import { sampleCache } from './lru-sample-cache';
import { SCHEDULER_BASE_MIDI_NOTE } from './constants';
import {
  nearestSampleNote,
  selectRoundRobinVariant,
  selectVelocityGroupBlend,
  validatedLoop,
  dbToGain,
  type LoopSpec,
} from './sample-selection';
import { isEnvelopeModelCompatibleWithPlayback } from '../shared/envelope-capabilities';
import {
  sampledInstrumentChokeRegistry,
  type ChokeGroupRegistry,
} from './choke-groups';
import { DEFAULT_MIDI_VELOCITY } from './velocity';
import { isDrumInstrument } from '../shared/instrument-classification';
import {
  compensatedSampleStartOffset,
  measureDecodedLeadingSilenceSeconds,
} from './sample-onset';
import type { TrackEnvelope } from '../shared/sync-types';
import {
  isTrackEnvelopeV2,
  resolveEnvelopeV2,
  type ResolvedEnvelopeV2,
  type SamplePlaybackMode,
  type TrackEnvelopeV2,
} from '../shared/envelope-contract-v2';
import {
  ManagedSampleVoice,
  type SampleVoiceComponent,
  type SampleVoiceEnvelope,
  type SampleVoiceHandle,
} from './sample-voice';

/** Bound aggregate request/decode pressure across every deep sample library. */
const MAX_CONCURRENT_SAMPLE_LOADS = 6;
let activeSampleLoads = 0;
const pendingSampleLoadSlots: Array<() => void> = [];

/**
 * Engine-owned drum balance. Keeping these trims outside content manifests
 * preserves the exact hashes used to pin prior human sample decisions.
 */
export const SAMPLED_INSTRUMENT_OUTPUT_GAIN_DB: Readonly<Record<string, number>> = Object.freeze({
  '808-kick': 0,
  '808-snare': -3,
  '808-hihat-closed': -9,
  '808-hihat-open': -8,
  '808-clap': -4,
  'acoustic-kick': 0,
  'acoustic-snare': -3,
  'acoustic-hihat-closed': -9,
  'acoustic-hihat-open': -8,
  'acoustic-ride': -7,
  'brushes-snare': -4,
});

export function sampledInstrumentOutputGainDb(
  instrumentId: string,
  manifestGainDb = 0,
): number {
  return manifestGainDb + (SAMPLED_INSTRUMENT_OUTPUT_GAIN_DB[instrumentId] ?? 0);
}

async function withSampleLoadSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (activeSampleLoads >= MAX_CONCURRENT_SAMPLE_LOADS) {
    await new Promise<void>(resolve => pendingSampleLoadSlots.push(resolve));
  }
  activeSampleLoads++;
  try {
    return await operation();
  } finally {
    activeSampleLoads--;
    pendingSampleLoadSlots.shift()?.();
  }
}

/**
 * Manifest file format for sampled instruments.
 * Stored alongside samples in R2 or local assets.
 *
 * Supports two modes:
 * - Individual files: Each sample is a separate file (file: 'C4.mp3')
 * - Audio sprite: All samples in one file with timing offsets (offset/duration)
 */
export interface InstrumentManifest {
  id: string;              // e.g., 'piano'
  name: string;            // e.g., 'Grand Piano'
  type: 'sampled';
  sprite?: string;         // If using audio sprite: the sprite filename (e.g., 'mf.mp3')
  samples: SampleMapping[];
  releaseTime: number;     // Seconds for note release
  credits?: {              // Attribution for samples
    source: string;        // Source name
    url: string;           // Source URL
    license: string;       // License type
    attribution?: string;  // Required creator/derivative credit text
    licenseUrl?: string;   // Canonical license/deed URL
    changes?: string;      // Delivery adaptation/change notice
  };
  /**
   * Optional playable range limits.
   * Notes outside this range will be skipped to prevent extreme pitch-shift artifacts.
   * Recommended for single-sample instruments (drums, percussion).
   */
  playableRange?: {
    min: number;           // Minimum MIDI note (inclusive)
    max: number;           // Maximum MIDI note (inclusive)
  };
  /**
   * Optional playback note override.
   *
   * By default, the scheduler plays all instruments at SCHEDULER_BASE_MIDI_NOTE (60/C4).
   * For drum instruments where samples are at their natural pitch (e.g., snare at MIDI 38),
   * this causes massive pitch-shifting making them sound unnatural.
   *
   * When set, the instrument will play at this MIDI note when the user's pitch offset is 0.
   * User pitch adjustments (pitchSemitones) are applied relative to this note.
   *
   * Example: brushes-snare has sample at note 38, playbackNote: 38
   * - User plays with pitchSemitones=0 → plays at note 38 (natural)
   * - User plays with pitchSemitones=+2 → plays at note 40
   */
  playbackNote?: number;
  /**
   * Marks atonal/noise samples that should be excluded from pitch-quality
   * validators even though they do not need a playbackNote override.
   */
  unpitched?: boolean;
  /**
   * Optional choke group name. Starting a note in a group silences every
   * ringing note in the same group across ALL sampled instruments — e.g.
   * closed and open hi-hats both declare "acoustic-hihat" so a closed hit
   * chokes a ringing open hat, like the physical cymbals would.
   */
  chokeGroup?: string;
  /**
   * Optional loudness trim in decibels applied to every note (clamped to
   * ±24). Lets us match perceived levels across instruments without
   * re-encoding sample files (re-normalizing files destroyed velocity
   * dynamics once already — see commit 747c90f).
   */
  gainDb?: number;
  /** Shared non-destructive decode-onset trim (for codec encoder delay). */
  startOffset?: number;
  /** Width in MIDI velocity units for equal-power-free linear layer blending. */
  velocityCrossfade?: number;
  /** Notes whose complete layer/RR sets must decode before playback is ready. */
  priorityNotes?: number[];
  /** Sample rate of the pinned decoded assets used to author frame metadata. */
  decodedSampleRate?: number;
  /** Evidence note required when zero-frame legacy loops are retained. */
  loopApproval?: {
    status: string;
    crossfadeFrames: number;
    note: string;
  };
  /** Optional separately recorded note-off regions, grouped by `releaseGroup`. */
  releaseRegions?: ReleaseRegion[];
}

export interface ReleaseRegion {
  file: string;
  rootMidi: number;
  velocityMin: number;
  velocityMax: number;
  roundRobin: number;
  heldDecayDbPerSecond: number;
  gainDb: number;
  releaseGroup: string;
}

export interface SampleMapping {
  note: number;            // MIDI note number (C4 = 60)
  file?: string;           // Filename for individual file mode (e.g., 'C4.mp3')
  offset?: number;         // Sprite mode: start time in seconds
  duration?: number;       // Sprite mode: duration in seconds
  velocityMin?: number;    // Minimum MIDI velocity (0-127), default 0
  velocityMax?: number;    // Maximum MIDI velocity (0-127), default 127
  loop?: boolean;          // Sustain loop: repeat [loopStart, loopEnd) while held
  loopStart?: number;      // Loop start in seconds (default 0)
  loopEnd?: number;        // Loop end in seconds (default: buffer end)
  sustainLoop?: import('./sample-selection').SustainLoopFrames;
  releaseGroup?: string;
  gainDb?: number;         // Non-destructive sample-specific loudness trim
  tuneCents?: number;      // Signed playback correction in cents
  startOffset?: number;    // Non-destructive start trim for individual files
  endOffset?: number;      // Non-destructive end bound for individual files
  roundRobinGroup?: string;
  roundRobinIndex?: number;
  articulation?: string;
}

/**
 * Loaded sample with its audio buffer and optional timing.
 */
interface LoadedSample {
  note: number;
  file?: string;
  cacheKey?: string;
  buffer: AudioBuffer;
  offset?: number;
  duration?: number;
  velocityMin: number;
  velocityMax: number;
  loop: LoopSpec | null;
  gainDb: number;
  tuneCents: number;
  roundRobinGroup?: string;
  roundRobinIndex?: number;
  articulation: string;
  releaseGroup?: string;
}

interface LoadedReleaseRegion extends ReleaseRegion {
  buffer: AudioBuffer;
  cacheKey: string;
}

export type SampleEnvelopeInput = TrackEnvelope | TrackEnvelopeV2 | ResolvedEnvelopeV2;

export interface PlaySampleVoiceOptions {
  id: string;
  midiNote: number;
  time: number;
  /** Scheduler note-off duration. Ignored by trigger playback. */
  duration?: number;
  mode: SamplePlaybackMode;
  volume?: number;
  velocity?: number;
  destination?: AudioNode;
  articulation?: string;
  envelope?: SampleEnvelopeInput;
  tempoBpm?: number;
}

function isResolvedEnvelopeV2(value: SampleEnvelopeInput | undefined): value is ResolvedEnvelopeV2 {
  return !!value
    && typeof value === 'object'
    && 'model' in value
    && 'attackSeconds' in value
    && typeof value.attackSeconds === 'number';
}

export type SampleLoadState = 'idle' | 'loading' | 'priority-ready' | 'complete' | 'degraded';

export interface SampleLoadFailure {
  file: string;
  message: string;
  priority: boolean;
  mappingIdentity?: {
    note: number;
    velocityMin: number;
    velocityMax: number;
    articulation: string;
    roundRobinGroup?: string;
    roundRobinIndex?: number;
  };
}

/**
 * SampledInstrument handles loading and playback for a single instrument.
 * Supports velocity layers: multiple samples per note for different dynamics.
 */
export class SampledInstrument {
  private audioContext: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private manifest: InstrumentManifest | null = null;
  // Map from MIDI note -> array of samples (velocity layers)
  private samples: Map<number, LoadedSample[]> = new Map();
  private spriteBuffer: AudioBuffer | null = null;  // For sprite mode
  private loadingPromise: Promise<void> | null = null;
  private backgroundLoadingPromise: Promise<void> | null = null;
  private inFlightBuffers = new Map<string, Promise<AudioBuffer>>();
  private isLoaded = false;
  private loadState: SampleLoadState = 'idle';
  private loadFailures: SampleLoadFailure[] = [];
  private roundRobinCursors = new Map<string, number>();
  private releaseRegions: LoadedReleaseRegion[] = [];
  private activeVoices = new Map<string, { voice: ManagedSampleVoice; ordinal: number }>();
  private voiceOrdinal = 0;
  private readonly maxVoices: number;
  private cacheReferenceOwners = 0;
  private lifecycleGeneration = 0;
  private baseUrl: string;
  private instrumentId: string;  // For cache key generation
  private chokeRegistry: ChokeGroupRegistry;

  constructor(
    instrumentId: string,
    baseUrl: string = '/instruments',
    deps: { chokeRegistry?: ChokeGroupRegistry; maxVoices?: number } = {}
  ) {
    this.instrumentId = instrumentId;
    this.baseUrl = `${baseUrl}/${instrumentId}`;
    this.chokeRegistry = deps.chokeRegistry ?? sampledInstrumentChokeRegistry;
    this.maxVoices = Number.isInteger(deps.maxVoices) && (deps.maxVoices ?? 0) > 0
      ? deps.maxVoices!
      : 32;
  }

  /**
   * Initialize with audio context and destination node.
   * Must be called before loading or playing.
   */
  initialize(audioContext: AudioContext, destination: AudioNode): void {
    this.audioContext = audioContext;
    this.destination = destination;

    // DIAGNOSTIC: Log destination details for debugging
    logger.audio.log(`SampledInstrument initialized with destination:`, {
      type: destination.constructor.name,
      numberOfInputs: destination.numberOfInputs,
      numberOfOutputs: destination.numberOfOutputs,
      channelCount: destination.channelCount,
      contextState: audioContext.state,
    });
  }

  /**
   * Ensure the instrument is loaded.
   * Returns immediately if already loaded.
   * Safe to call multiple times (deduplicates concurrent loads).
   */
  async ensureLoaded(): Promise<boolean> {
    if (this.isLoaded && this.loadState !== 'degraded') return true;
    if (this.isLoaded && this.loadState === 'degraded') return this.retryFailedSamples();
    if (this.loadingPromise) {
      await this.loadingPromise;
      return this.isLoaded;
    }

    this.loadState = 'loading';
    this.loadFailures = [];
    if (!this.isLoaded) this.samples.clear();
    const generation = ++this.lifecycleGeneration;
    this.loadingPromise = this.loadInstrument(generation);

    try {
      await this.loadingPromise;
      return this.isLoaded;
    } catch (error) {
      if (generation !== this.lifecycleGeneration) return false;
      const message = error instanceof Error ? error.message : String(error);
      this.loadFailures.push({ file: 'manifest.json', message, priority: true });
      // A failure after priority samples decode (for example invalid loop or
      // release metadata) must not leave the instrument playable through a
      // stale `isLoaded=true` set by the primary loading phase.
      this.isLoaded = false;
      this.loadState = 'degraded';
      logger.audio.error('Failed to load sampled instrument:', error);
      return false;
    } finally {
      this.loadingPromise = null;
    }
  }

  /**
   * Load the instrument manifest and all samples.
   * Supports both individual file mode and audio sprite mode.
   */
  private async loadInstrument(generation: number): Promise<void> {
    if (!this.audioContext) {
      throw new Error('SampledInstrument not initialized');
    }

    // Load manifest
    const manifestUrl = `${this.baseUrl}/manifest.json`;
    logger.audio.log(`Loading instrument manifest from ${manifestUrl}`);

    const manifestResponse = await fetch(manifestUrl);
    if (!manifestResponse.ok) {
      throw new Error(`Failed to load manifest: ${manifestResponse.status}`);
    }

    const loadedManifest = await manifestResponse.json() as InstrumentManifest;
    if (generation !== this.lifecycleGeneration) return;
    this.manifest = loadedManifest;
    logger.audio.log(`Loaded manifest for ${this.manifest.name}: ${this.manifest.samples.length} samples`);

    // Check if using sprite mode or individual files.
    if (this.manifest.sprite) {
      await this.loadSprite(generation);
      if (generation !== this.lifecycleGeneration) return;
      this.isLoaded = true;
      this.loadState = 'complete';
    } else {
      await this.loadIndividualFiles(generation);
      if (generation !== this.lifecycleGeneration) return;
    }

    await this.loadReleaseRegions(generation);
    if (generation !== this.lifecycleGeneration) return;

    logger.audio.log(`Instrument ${this.manifest?.name} load state: ${this.loadState}`);
  }

  /**
   * Load audio sprite mode: single file with multiple samples at offsets.
   */
  private async loadSprite(generation: number): Promise<void> {
    const context = this.audioContext;
    if (!context) throw new Error('SampledInstrument not initialized');
    const spriteUrl = `${this.baseUrl}/${this.manifest!.sprite}`;
    logger.audio.log(`Loading audio sprite from ${spriteUrl}`);

    const response = await fetch(spriteUrl);
    if (!response.ok) {
      throw new Error(`Failed to load sprite: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (generation !== this.lifecycleGeneration) return;
    const spriteBuffer = await context.decodeAudioData(arrayBuffer);
    if (generation !== this.lifecycleGeneration) return;
    this.spriteBuffer = spriteBuffer;
    logger.audio.log(`Sprite loaded: ${this.spriteBuffer.duration.toFixed(1)}s`);

    // Store sample mappings with offset/duration from manifest
    for (const mapping of this.manifest!.samples) {
      const loadedSample: LoadedSample = {
        note: mapping.note,
        file: mapping.file,
        buffer: this.spriteBuffer,
        offset: mapping.offset,
        duration: mapping.duration,
        velocityMin: mapping.velocityMin ?? 0,
        velocityMax: mapping.velocityMax ?? 127,
        loop: validatedLoop(
          mapping,
          this.spriteBuffer,
          this.manifest?.decodedSampleRate,
          this.manifest?.loopApproval,
        ),
        gainDb: Number.isFinite(mapping.gainDb) ? mapping.gainDb ?? 0 : 0,
        tuneCents: Number.isFinite(mapping.tuneCents) ? mapping.tuneCents ?? 0 : 0,
        roundRobinGroup: mapping.roundRobinGroup,
        roundRobinIndex: mapping.roundRobinIndex,
        articulation: mapping.articulation ?? 'default',
        releaseGroup: mapping.releaseGroup,
      };
      // Add to velocity layer array for this note
      const existing = this.samples.get(mapping.note) || [];
      existing.push(loadedSample);
      this.samples.set(mapping.note, existing);
    }
  }

  /**
   * Load a complete priority set before enabling playback. Every velocity and
   * round-robin variant at each priority note is part of that set.
   */
  private async loadIndividualFiles(generation: number): Promise<void> {
    const manifest = this.manifest!;
    if (manifest.samples.length === 0) throw new Error('Instrument manifest has no samples');
    const availableNotes = [...new Set(manifest.samples.map(mapping => mapping.note))];
    const defaultPriority = nearestSampleNote(availableNotes, SCHEDULER_BASE_MIDI_NOTE);
    const priorityNotes = new Set(
      manifest.priorityNotes && manifest.priorityNotes.length > 0
        ? manifest.priorityNotes
        : defaultPriority === undefined ? [] : [defaultPriority]
    );
    const priorityMappings = manifest.samples.filter(mapping => priorityNotes.has(mapping.note));
    const backgroundMappings = manifest.samples.filter(mapping => !priorityNotes.has(mapping.note));
    if (priorityMappings.length === 0) throw new Error('No mappings exist for the declared priority notes');

    const priorityResults = await this.settleSampleLoads(priorityMappings, generation, (result, mapping) => {
      if (generation !== this.lifecycleGeneration) return;
      if (result.status === 'fulfilled') this.installLoadedSample(result.value);
      else this.recordLoadFailure(mapping, result.reason, true);
    });
    if (generation !== this.lifecycleGeneration) return;

    const priorityFailed = priorityResults.some(result => result.status === 'rejected');
    this.isLoaded = !priorityFailed;
    if (priorityFailed) this.loadState = 'degraded';
    else this.loadState = backgroundMappings.length === 0 ? 'complete' : 'priority-ready';

    if (backgroundMappings.length > 0) {
      this.backgroundLoadingPromise = this.loadRemainingSamples(backgroundMappings, generation);
    }
  }

  private installLoadedSample(sample: LoadedSample): void {
    const existing = this.samples.get(sample.note) ?? [];
    const duplicate = existing.some(candidate =>
      candidate.file === sample.file
      && candidate.velocityMin === sample.velocityMin
      && candidate.velocityMax === sample.velocityMax
      && candidate.roundRobinGroup === sample.roundRobinGroup
      && candidate.roundRobinIndex === sample.roundRobinIndex
      && candidate.articulation === sample.articulation
    );
    if (duplicate) return;
    existing.push(sample);
    this.samples.set(sample.note, existing);
    if (sample.cacheKey) {
      for (let owner = 0; owner < this.cacheReferenceOwners; owner++) sampleCache.acquire(sample.cacheKey);
    }
  }

  private recordLoadFailure(mapping: SampleMapping, reason: unknown, priority: boolean): void {
    const message = reason instanceof Error ? reason.message : String(reason);
    this.loadFailures.push({
      file: mapping.file ?? '(sprite)',
      message,
      priority,
      mappingIdentity: {
        note: mapping.note,
        velocityMin: mapping.velocityMin ?? 0,
        velocityMax: mapping.velocityMax ?? 127,
        articulation: mapping.articulation ?? 'default',
        roundRobinGroup: mapping.roundRobinGroup,
        roundRobinIndex: mapping.roundRobinIndex,
      },
    });
    logger.audio.error(`[PROGRESSIVE] Failed to load ${mapping.file}:`, reason);
  }

  /** Settle sample work in stable result order without retaining decoded buffers. */
  private async settleSampleLoads(
    mappings: readonly SampleMapping[],
    generation: number,
    onSettled: (result: PromiseSettledResult<LoadedSample>, mapping: SampleMapping) => void,
  ): Promise<Array<{ status: 'fulfilled' } | { status: 'rejected'; reason: unknown }>> {
    const results = new Array<{ status: 'fulfilled' } | { status: 'rejected'; reason: unknown }>(mappings.length);
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < mappings.length) {
        const index = cursor++;
        const mapping = mappings[index];
        try {
          const value = await this.loadSingleSample(mapping, generation);
          onSettled({ status: 'fulfilled', value }, mapping);
          results[index] = { status: 'fulfilled' };
        } catch (reason) {
          onSettled({ status: 'rejected', reason }, mapping);
          results[index] = { status: 'rejected', reason };
        }
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(MAX_CONCURRENT_SAMPLE_LOADS, mappings.length) },
      () => worker(),
    ));
    return results;
  }

  /** Successful background decodes install as each request settles. */
  private async loadRemainingSamples(mappings: SampleMapping[], generation: number): Promise<void> {
    await this.settleSampleLoads(mappings, generation, (result, mapping) => {
      if (generation !== this.lifecycleGeneration) return;
      if (result.status === 'fulfilled') this.installLoadedSample(result.value);
      else this.recordLoadFailure(mapping, result.reason, false);
    });
    if (generation !== this.lifecycleGeneration) return;
    this.loadState = this.loadFailures.length > 0 ? 'degraded' : 'complete';
    logger.audio.log(`[PROGRESSIVE] ${this.samples.size} note roots loaded; state=${this.loadState}`);
    this.backgroundLoadingPromise = null;
  }

  private cacheKeyFor(mapping: SampleMapping): string {
    if (!mapping.file) throw new Error(`Individual sample mapping at note ${mapping.note} is missing file`);
    return `${this.instrumentId}:${mapping.file}`;
  }

  private loadedSampleFromMapping(mapping: SampleMapping, buffer: AudioBuffer, cacheKey: string): LoadedSample {
    const configuredStart = mapping.startOffset ?? this.manifest?.startOffset;
    const adaptCodecDelay = isDrumInstrument(`sampled:${this.instrumentId}`)
      || mapping.file?.toLowerCase().endsWith('.m4a') === true;
    const start = compensatedSampleStartOffset(
      configuredStart,
      adaptCodecDelay ? measureDecodedLeadingSilenceSeconds(buffer) : 0,
      adaptCodecDelay,
    );
    const end = Number.isFinite(mapping.endOffset) && (mapping.endOffset ?? 0) > (start ?? 0) && (mapping.endOffset ?? Infinity) <= buffer.duration
      ? mapping.endOffset
      : undefined;
    return {
      note: mapping.note,
      file: mapping.file,
      cacheKey,
      buffer,
      offset: start,
      duration: end !== undefined ? end - (start ?? 0) : undefined,
      velocityMin: mapping.velocityMin ?? 0,
      velocityMax: mapping.velocityMax ?? 127,
      loop: validatedLoop(
        mapping,
        buffer,
        this.manifest?.decodedSampleRate,
        this.manifest?.loopApproval,
      ),
      gainDb: Number.isFinite(mapping.gainDb) ? mapping.gainDb ?? 0 : 0,
      tuneCents: Number.isFinite(mapping.tuneCents) ? mapping.tuneCents ?? 0 : 0,
      roundRobinGroup: mapping.roundRobinGroup,
      roundRobinIndex: mapping.roundRobinIndex,
      articulation: mapping.articulation ?? 'default',
      releaseGroup: mapping.releaseGroup,
    };
  }

  /** Load one unique delivery file through the memory-bounded cache. */
  private async loadSingleSample(mapping: SampleMapping, generation: number): Promise<LoadedSample> {
    const cacheKey = this.cacheKeyFor(mapping);
    const cachedBuffer = sampleCache.get(cacheKey);
    if (cachedBuffer) {
      logger.audio.log(`[CACHE HIT] ${cacheKey}`);
      return this.loadedSampleFromMapping(mapping, cachedBuffer, cacheKey);
    }

    let bufferPromise = this.inFlightBuffers.get(cacheKey);
    if (!bufferPromise) {
      bufferPromise = withSampleLoadSlot(async () => {
        const sampleUrl = `${this.baseUrl}/${mapping.file}`;
        logger.audio.log(`[CACHE MISS] Loading sample ${mapping.file} (note ${mapping.note})`);
        const response = await fetch(sampleUrl);
        if (!response.ok) throw new Error(`Failed to load sample ${mapping.file}: ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const context = this.audioContext;
        if (!context) throw new Error('SampledInstrument was disposed during loading');
        const audioBuffer = await context.decodeAudioData(arrayBuffer);
        if (generation !== this.lifecycleGeneration) throw new Error('Sample load superseded by a newer lifecycle');
        sampleCache.set(cacheKey, audioBuffer);
        logger.audio.log(`[CACHED] ${cacheKey}`);
        return audioBuffer;
      });
      this.inFlightBuffers.set(cacheKey, bufferPromise);
      const clear = (): void => {
        if (this.inFlightBuffers.get(cacheKey) === bufferPromise) this.inFlightBuffers.delete(cacheKey);
      };
      void bufferPromise.then(clear, clear);
    }
    return this.loadedSampleFromMapping(mapping, await bufferPromise, cacheKey);
  }

  private async loadReleaseRegions(generation: number): Promise<void> {
    const declared = this.manifest?.releaseRegions ?? [];
    this.releaseRegions = [];
    if (declared.length === 0) return;

    for (let index = 0; index < declared.length; index++) {
      const region = declared[index]!;
      if (!region.file
        || !region.releaseGroup
        || !Number.isInteger(region.rootMidi)
        || region.rootMidi < 0
        || region.rootMidi > 127
        || !Number.isInteger(region.velocityMin)
        || !Number.isInteger(region.velocityMax)
        || region.velocityMin < 0
        || region.velocityMax > 127
        || region.velocityMax < region.velocityMin
        || !Number.isInteger(region.roundRobin)
        || region.roundRobin < 0
        || !Number.isFinite(region.heldDecayDbPerSecond)
        || region.heldDecayDbPerSecond < 0
        || !Number.isFinite(region.gainDb)) {
        throw new Error(`Invalid release region metadata for ${region.file || '(missing file)'}`);
      }
      const overlaps = declared.slice(0, index).some(previous =>
        previous.releaseGroup === region.releaseGroup
        && previous.rootMidi === region.rootMidi
        && previous.roundRobin === region.roundRobin
        && previous.velocityMin <= region.velocityMax
        && region.velocityMin <= previous.velocityMax
      );
      if (overlaps) {
        throw new Error(
          `Ambiguous release region ${region.releaseGroup}:${region.rootMidi}:rr${region.roundRobin}`,
        );
      }
    }

    const loaded = await Promise.all(declared.map(async region => {
      const cacheKey = `${this.instrumentId}:release:${region.file}`;
      let buffer = sampleCache.get(cacheKey);
      if (!buffer) {
        let bufferPromise = this.inFlightBuffers.get(cacheKey);
        if (!bufferPromise) {
          bufferPromise = withSampleLoadSlot(async () => {
            const response = await fetch(`${this.baseUrl}/${region.file}`);
            if (!response.ok) throw new Error(`Failed to load release region ${region.file}: ${response.status}`);
            const context = this.audioContext;
            if (!context) throw new Error('SampledInstrument was disposed during release-region loading');
            const decoded = await context.decodeAudioData(await response.arrayBuffer());
            if (generation !== this.lifecycleGeneration) throw new Error('Release-region load superseded by a newer lifecycle');
            sampleCache.set(cacheKey, decoded);
            return decoded;
          });
          this.inFlightBuffers.set(cacheKey, bufferPromise);
          const clear = (): void => {
            if (this.inFlightBuffers.get(cacheKey) === bufferPromise) this.inFlightBuffers.delete(cacheKey);
          };
          void bufferPromise.then(clear, clear);
        }
        buffer = await bufferPromise;
      }
      if (generation !== this.lifecycleGeneration) throw new Error('Release-region load superseded by a newer lifecycle');
      for (let owner = 0; owner < this.cacheReferenceOwners; owner++) sampleCache.acquire(cacheKey);
      return { ...region, buffer, cacheKey } satisfies LoadedReleaseRegion;
    }));
    this.releaseRegions = loaded.sort((a, b) =>
      a.releaseGroup.localeCompare(b.releaseGroup)
      || a.rootMidi - b.rootMidi
      || a.velocityMin - b.velocityMin
      || a.roundRobin - b.roundRobin
    );
  }

  private resolvedVoiceEnvelope(
    mode: SamplePlaybackMode,
    envelope: SampleEnvelopeInput | undefined,
    tempoBpm: number,
  ): SampleVoiceEnvelope {
    const fallbackAttack = 0.003;
    const fallbackRelease = Math.max(0, this.manifest?.releaseTime ?? 0.1);
    const resolved = isResolvedEnvelopeV2(envelope)
      ? envelope
      : isTrackEnvelopeV2(envelope)
        ? resolveEnvelopeV2(envelope, tempoBpm)
        : null;
    if (resolved) {
      if (mode === 'trigger') {
        if (resolved.model === 'ad' || resolved.model === 'ahd') return resolved;
        return { model: 'ahd', attackSeconds: resolved.attackSeconds };
      }
      if (mode === 'gate') {
        return {
          model: 'ar',
          attackSeconds: resolved.attackSeconds,
          releaseSeconds: resolved.releaseSeconds ?? fallbackRelease,
        };
      }
      return resolved.model === 'adsr'
        ? resolved
        : {
            model: 'adsr',
            attackSeconds: resolved.attackSeconds,
            decaySeconds: resolved.decaySeconds ?? 0,
            sustain: 1,
            releaseSeconds: resolved.releaseSeconds ?? fallbackRelease,
          };
    }

    const legacyEnvelope = envelope as TrackEnvelope | undefined;

    if (mode === 'trigger') {
      return legacyEnvelope
        ? {
            model: 'ahd',
            attackSeconds: Math.max(0, legacyEnvelope.attack),
            holdSeconds: 0,
            decaySeconds: Math.max(0, legacyEnvelope.decay),
          }
        : { model: 'ahd', attackSeconds: fallbackAttack };
    }
    if (mode === 'gate') {
      return {
        model: 'ar',
        attackSeconds: Math.max(0, legacyEnvelope?.attack ?? fallbackAttack),
        releaseSeconds: Math.max(0, legacyEnvelope?.release ?? fallbackRelease),
      };
    }
    return {
      model: 'adsr',
      attackSeconds: Math.max(0, legacyEnvelope?.attack ?? fallbackAttack),
      decaySeconds: Math.max(0, legacyEnvelope?.decay ?? 0),
      sustain: Math.min(1, Math.max(0, legacyEnvelope?.sustain ?? 1)),
      releaseSeconds: Math.max(0, legacyEnvelope?.release ?? fallbackRelease),
    };
  }

  private selectReleaseRegion(
    releaseGroup: string,
    midiNote: number,
    velocity: number,
  ): LoadedReleaseRegion | null {
    const velocityMatches = this.releaseRegions.filter(region =>
      region.releaseGroup === releaseGroup
      && velocity >= region.velocityMin
      && velocity <= region.velocityMax
    );
    if (velocityMatches.length === 0) return null;
    const root = nearestSampleNote(velocityMatches.map(region => region.rootMidi), midiNote);
    if (root === undefined) return null;
    const variants = velocityMatches
      .filter(region => region.rootMidi === root)
      .sort((a, b) => a.roundRobin - b.roundRobin);
    const key = `release:${releaseGroup}:${root}:${variants[0]?.velocityMin}-${variants[0]?.velocityMax}`;
    const cursor = this.roundRobinCursors.get(key) ?? 0;
    const selected = variants[cursor % variants.length] ?? null;
    if (variants.length > 1) this.roundRobinCursors.set(key, cursor + 1);
    return selected;
  }

  private createReleaseComponents(
    groups: readonly string[],
    midiNote: number,
    velocity: number,
    volume: number,
    instrumentGain: number,
    destination: AudioNode,
    when: number,
    heldSeconds: number,
  ): SampleVoiceComponent[] {
    const context = this.audioContext;
    if (!context) return [];
    return groups.flatMap(group => {
      const region = this.selectReleaseRegion(group, midiNote, velocity);
      if (!region) return [];
      const source = context.createBufferSource();
      source.buffer = region.buffer;
      source.playbackRate.value = 2 ** ((midiNote - region.rootMidi) / 12);
      const gain = context.createGain();
      const heldTrimDb = region.gainDb - region.heldDecayDbPerSecond * heldSeconds;
      const peak = volume * instrumentGain * dbToGain(heldTrimDb);
      source.connect(gain);
      gain.connect(destination);
      const naturalEndSeconds = when + region.buffer.duration / source.playbackRate.value;
      return [{ source, gain, peak, naturalEndSeconds, start: () => source.start(when) }];
    });
  }

  private reapCompletedVoices(now: number): void {
    for (const [voiceId, entry] of this.activeVoices) {
      if (entry.voice.state === 'complete'
        || (entry.voice.completionSeconds !== null && entry.voice.completionSeconds <= now)) {
        this.activeVoices.delete(voiceId);
      }
    }
  }

  private prepareVoiceSlot(id: string, when: number): void {
    this.reapCompletedVoices(this.audioContext?.currentTime ?? when);
    const duplicate = this.activeVoices.get(id);
    if (duplicate) {
      duplicate.voice.stop(when);
      this.activeVoices.delete(id);
    }
    while (this.activeVoices.size >= this.maxVoices) {
      const oldest = [...this.activeVoices.entries()].sort((a, b) =>
        a[1].voice.startedAtSeconds - b[1].voice.startedAtSeconds
        || a[1].ordinal - b[1].ordinal
        || a[0].localeCompare(b[0])
      )[0];
      if (!oldest) break;
      oldest[1].voice.stop(when);
      this.activeVoices.delete(oldest[0]);
    }
  }

  /** Create a managed v2 sample voice with explicit playback semantics. */
  playVoice(options: PlaySampleVoiceOptions): SampleVoiceHandle | null {
    const dest = options.destination ?? this.destination;
    if (!this.audioContext || !dest || !this.isLoaded || !this.manifest) {
      return null;
    }

    // Apply playbackNote translation for drum/percussion instruments
    // The scheduler sends midiNote = SCHEDULER_BASE_MIDI_NOTE + pitchSemitones (60 + offset)
    // For drums with playbackNote set, we translate to: playbackNote + pitchSemitones
    let adjustedMidiNote = options.midiNote;
    if (this.manifest.playbackNote !== undefined) {
      const pitchOffset = options.midiNote - SCHEDULER_BASE_MIDI_NOTE;
      adjustedMidiNote = this.manifest.playbackNote + pitchOffset;
      logger.audio.log(
        `[PLAYBACK_NOTE] ${this.instrumentId}: scheduler note ${options.midiNote} → adjusted note ${adjustedMidiNote} (playbackNote=${this.manifest.playbackNote}, offset=${pitchOffset})`
      );
    }

    // Check playable range limits (prevents extreme pitch-shift artifacts)
    if (this.manifest.playableRange) {
      const { min, max } = this.manifest.playableRange;
      if (adjustedMidiNote < min || adjustedMidiNote > max) {
        logger.audio.log(
          `[RANGE] Skipping note ${adjustedMidiNote} for ${this.instrumentId} (outside range [${min}, ${max}])`
        );
        return null;
      }
    }

    // Ensure a live AudioContext is running (required for iOS/mobile).
    // OfflineAudioContext is intentionally suspended until startRendering();
    // calling resume() on it either throws or creates an unhandled rejection.
    const isOfflineContext = 'startRendering' in this.audioContext;
    if (!isOfflineContext && this.audioContext.state !== 'running') {
      void this.audioContext.resume().catch(() => {});
    }

    const velocity = options.velocity ?? DEFAULT_MIDI_VELOCITY;
    const sampleInfos = this.findNearestSamples(
      adjustedMidiNote,
      velocity,
      options.articulation ?? 'default',
    );
    if (sampleInfos.length === 0) return null;
    const loopCapable = sampleInfos.every(info =>
      info.sample.loop !== null
      && (info.sample.loop.crossfadeFrames ?? 0) === 0
    );
    const actualMode: SamplePlaybackMode = options.mode === 'loop' && !loopCapable
      ? 'gate'
      : options.mode;
    const startTime = Math.max(options.time, this.audioContext.currentTime);
    const authoredResolvedEnvelope = isResolvedEnvelopeV2(options.envelope)
      ? options.envelope
      : isTrackEnvelopeV2(options.envelope)
        ? resolveEnvelopeV2(options.envelope, options.tempoBpm ?? 120)
        : null;
    if (authoredResolvedEnvelope
        && !isEnvelopeModelCompatibleWithPlayback(authoredResolvedEnvelope.model, actualMode)) {
      logger.audio.warn(
        `Skipping ${this.instrumentId} voice ${options.id}: ${authoredResolvedEnvelope.model.toUpperCase()} is incompatible with ${actualMode} playback`,
      );
      return null;
    }
    const envelope = this.resolvedVoiceEnvelope(
      actualMode,
      options.envelope,
      options.tempoBpm ?? 120,
    );
    const instrumentGain = dbToGain(sampledInstrumentOutputGainDb(
      this.instrumentId,
      this.manifest.gainDb ?? 0,
    ));
    const volume = Math.min(1, Math.max(0, options.volume ?? 1));
    const releaseGroups = [...new Set(
      sampleInfos.map(info => info.sample.releaseGroup).filter((group): group is string => !!group),
    )];

    this.prepareVoiceSlot(options.id, startTime);
    const chokeGroup = this.manifest.chokeGroup;
    const voice = new ManagedSampleVoice({
      id: options.id,
      mode: actualMode,
      startedAtSeconds: startTime,
      envelope,
      onRelease: (when, heldSeconds) => this.createReleaseComponents(
        releaseGroups,
        adjustedMidiNote,
        velocity,
        volume,
        instrumentGain,
        dest,
        when,
        heldSeconds,
      ),
      onComplete: () => {
        if (this.activeVoices.get(options.id)?.voice === voice) this.activeVoices.delete(options.id);
        if (chokeGroup !== undefined) this.chokeRegistry.remove(chokeGroup, voice);
      },
    });

    for (const sampleInfo of sampleInfos) {
      const source = this.audioContext.createBufferSource();
      source.buffer = sampleInfo.sample.buffer;
      source.playbackRate.value = sampleInfo.pitchRatio;
      if (actualMode === 'loop' && sampleInfo.sample.loop) {
        source.loop = true;
        source.loopStart = sampleInfo.sample.loop.start;
        if (sampleInfo.sample.loop.end !== undefined) source.loopEnd = sampleInfo.sample.loop.end;
      }

      const gainNode = this.audioContext.createGain();
      const effectiveVolume = volume
        * instrumentGain
        * dbToGain(sampleInfo.sample.gainDb)
        * sampleInfo.weight;
      source.connect(gainNode);
      gainNode.connect(dest);
      const playableDuration = (sampleInfo.sample.duration
        ?? Math.max(0, sampleInfo.sample.buffer.duration - (sampleInfo.sample.offset ?? 0)))
        / Math.max(0.0001, sampleInfo.pitchRatio);
      voice.addPrimaryComponent({
        source,
        gain: gainNode,
        peak: effectiveVolume,
        ...(actualMode === 'loop' ? {} : { naturalEndSeconds: startTime + playableDuration }),
        start: () => {
          if (sampleInfo.sample.offset !== undefined && sampleInfo.sample.duration !== undefined) {
            source.start(startTime, sampleInfo.sample.offset, sampleInfo.sample.duration);
          } else if (sampleInfo.sample.offset !== undefined) {
            source.start(startTime, sampleInfo.sample.offset);
          } else {
            source.start(startTime);
          }
        },
      });
    }

    if (chokeGroup !== undefined) {
      this.chokeRegistry.cutAndRegister(chokeGroup, voice, startTime);
    }
    this.activeVoices.set(options.id, { voice, ordinal: this.voiceOrdinal++ });
    if (actualMode !== 'trigger' && options.duration !== undefined) {
      voice.gate(startTime + Math.max(0, options.duration));
    }
    return voice;
  }

  /**
   * Legacy positional compatibility wrapper. Its historical behavior is gated
   * AR playback; v2 callers should use `playVoice` with an explicit mode.
   */
  playNote(
    noteId: string,
    midiNote: number,
    time: number,
    duration?: number,
    volume: number = 1,
    velocity: number = DEFAULT_MIDI_VELOCITY,
    destinationOverride?: AudioNode,
    articulation: string = 'default',
    envelope?: TrackEnvelope,
  ): AudioBufferSourceNode | null {
    const voice = this.playVoice({
      id: noteId,
      midiNote,
      time,
      duration,
      volume,
      velocity,
      destination: destinationOverride,
      articulation,
      envelope,
      // Historical playNote enabled a validated loop only for finite notes.
      // Requesting loop here preserves that behavior; playVoice truthfully
      // degrades non-loop mappings back to gate.
      mode: duration === undefined ? 'gate' : 'loop',
    });
    return voice instanceof ManagedSampleVoice ? voice.primarySource : null;
  }

  /** Select velocity groups, then one deterministic RR variant per group. */
  private findNearestSamples(
    midiNote: number,
    velocity: number = DEFAULT_MIDI_VELOCITY,
    requestedArticulation: string = 'default',
  ): Array<{
    sample: LoadedSample;
    pitchRatio: number;
    weight: number;
  }> {
    const notesWithArticulation = [...this.samples.entries()]
      .filter(([, layers]) => layers.some(layer => layer.articulation === requestedArticulation))
      .map(([note]) => note);
    const availableNotes = notesWithArticulation.length > 0 ? notesWithArticulation : [...this.samples.keys()];
    const nearestNote = nearestSampleNote(availableNotes, midiNote);
    if (nearestNote === undefined) return [];
    const allLayers = this.samples.get(nearestNote) ?? [];
    const articulation = allLayers.some(layer => layer.articulation === requestedArticulation)
      ? requestedArticulation
      : allLayers[0]?.articulation;
    const layers = articulation === undefined
      ? allLayers
      : allLayers.filter(layer => layer.articulation === articulation);
    const blend = selectVelocityGroupBlend(layers, velocity, this.manifest?.velocityCrossfade ?? 0);
    return blend.flatMap(group => {
      const rrGroup = group.layers[0]?.roundRobinGroup;
      const variants = rrGroup === undefined
        ? group.layers
        : group.layers.filter(layer => layer.roundRobinGroup === rrGroup);
      if (variants.length === 0) return [];
      const key = `${nearestNote}:${variants[0].velocityMin}-${variants[0].velocityMax}:${articulation ?? 'default'}:${rrGroup ?? 'single'}`;
      const cursor = this.roundRobinCursors.get(key) ?? 0;
      const sample = selectRoundRobinVariant(variants, cursor);
      if (!sample) return [];
      if (variants.length > 1) this.roundRobinCursors.set(key, cursor + 1);
      const semitoneOffset = midiNote - nearestNote;
      const pitchRatio = Math.pow(2, semitoneOffset / 12 + sample.tuneCents / 1200);
      return [{ sample, pitchRatio, weight: group.weight }];
    });
  }

  /**
   * Check if the instrument is loaded and ready.
   */
  isReady(): boolean {
    return this.isLoaded;
  }

  getActiveVoiceCount(): number {
    this.reapCompletedVoices(this.audioContext?.currentTime ?? 0);
    return this.activeVoices.size;
  }

  getVoice(id: string): SampleVoiceHandle | null {
    return this.activeVoices.get(id)?.voice ?? null;
  }

  releaseVoice(id: string, when: number): boolean {
    return this.activeVoices.get(id)?.voice.release(when) ?? false;
  }

  stopVoice(id: string, when: number): void {
    this.activeVoices.get(id)?.voice.stop(when);
  }

  getLoadState(): SampleLoadState {
    return this.loadState;
  }

  getLoadFailures(): readonly SampleLoadFailure[] {
    return this.loadFailures;
  }

  async waitForBackgroundLoad(): Promise<SampleLoadState> {
    await this.backgroundLoadingPromise;
    return this.loadState;
  }

  async retryFailedSamples(): Promise<boolean> {
    if (!this.manifest || !this.audioContext) return false;
    const failedFiles = new Set(this.loadFailures.map(failure => failure.file));
    const mappings = this.manifest.samples.filter(mapping => mapping.file && failedFiles.has(mapping.file));
    if (mappings.length === 0) return this.isLoaded;
    const generation = ++this.lifecycleGeneration;
    this.loadState = 'loading';
    this.loadFailures = this.loadFailures.filter(failure => !failedFiles.has(failure.file));
    await this.settleSampleLoads(mappings, generation, (result, mapping) => {
      if (generation !== this.lifecycleGeneration) return;
      if (result.status === 'fulfilled') this.installLoadedSample(result.value);
      else this.recordLoadFailure(mapping, result.reason, false);
    });
    if (generation !== this.lifecycleGeneration) return false;
    this.loadState = this.loadFailures.length > 0 ? 'degraded' : 'complete';
    this.isLoaded = this.samples.size > 0;
    return this.isLoaded && this.loadState !== 'degraded';
  }

  /**
   * Get the instrument name (for display).
   */
  getName(): string {
    return this.manifest?.name || 'Unknown';
  }

  /**
   * Get the instrument ID.
   */
  getId(): string {
    return this.instrumentId;
  }

  /**
   * Get the playable range for this instrument.
   * Returns undefined if no range is set (all notes allowed).
   */
  getPlayableRange(): { min: number; max: number } | undefined {
    return this.manifest?.playableRange;
  }

  /**
   * Check if a note is within the playable range.
   * Returns true if no range is set or note is within range.
   */
  isNoteInRange(midiNote: number): boolean {
    if (!this.manifest?.playableRange) return true;
    const { min, max } = this.manifest.playableRange;
    return midiNote >= min && midiNote <= max;
  }

  /**
   * Get pitch-shift quality for a given note.
   * Returns the number of semitones the note would be shifted from the nearest sample.
   */
  getPitchShiftAmount(midiNote: number): number {
    if (this.samples.size === 0) return 0;

    let minDistance = Infinity;
    for (const sampleNote of this.samples.keys()) {
      const distance = Math.abs(midiNote - sampleNote);
      minDistance = Math.min(minDistance, distance);
    }
    return minDistance;
  }

  /**
   * Get all loaded sample notes (for reference counting).
   * Returns MIDI note numbers.
   */
  getSampleNotes(): number[] {
    return Array.from(this.samples.keys());
  }

  /**
   * Get the number of velocity layers for a given note.
   * Returns 0 if note is not sampled, 1+ for velocity layer count.
   */
  getVelocityLayerCount(midiNote: number): number {
    const layers = this.samples.get(midiNote);
    return layers?.length ?? 0;
  }

  /**
   * Check if this instrument has velocity layers.
   * Returns true if any note has more than one velocity layer.
   */
  hasVelocityLayers(): boolean {
    for (const layers of this.samples.values()) {
      if (layers.length > 1) return true;
    }
    return false;
  }

  /**
   * Acquire references to all samples in the cache.
   * Call when a track starts using this instrument.
   */
  acquireCacheReferences(): void {
    this.cacheReferenceOwners++;
    let sampleCount = 0;
    for (const layers of this.samples.values()) {
      for (const layer of layers) {
        if (layer.cacheKey) sampleCache.acquire(layer.cacheKey);
        sampleCount++;
      }
    }
    for (const region of this.releaseRegions) {
      sampleCache.acquire(region.cacheKey);
      sampleCount++;
    }
    logger.audio.log(`[CACHE] Acquired owner ${this.cacheReferenceOwners} for ${this.instrumentId}: ${sampleCount} samples`);
  }

  /**
   * Release references to all samples in the cache.
   * Call when a track stops using this instrument.
   */
  releaseCacheReferences(): void {
    if (this.cacheReferenceOwners === 0) return;
    this.cacheReferenceOwners--;
    let sampleCount = 0;
    for (const layers of this.samples.values()) {
      for (const layer of layers) {
        if (layer.cacheKey) sampleCache.release(layer.cacheKey);
        sampleCount++;
      }
    }
    for (const region of this.releaseRegions) {
      sampleCache.release(region.cacheKey);
      sampleCount++;
    }
    logger.audio.log(`[CACHE] Released owner for ${this.instrumentId}: ${sampleCount} samples; owners=${this.cacheReferenceOwners}`);
  }

  /**
   * Dispose all resources.
   * Called during cleanup to prevent memory leaks.
   */
  dispose(): void {
    // Invalidate every in-flight fetch/decode before releasing owned cache entries.
    this.lifecycleGeneration++;
    const stopAt = this.audioContext?.currentTime ?? 0;
    for (const { voice } of this.activeVoices.values()) voice.stop(stopAt);
    this.activeVoices.clear();
    while (this.cacheReferenceOwners > 0) this.releaseCacheReferences();

    // Clear all loaded samples
    this.samples.clear();
    this.spriteBuffer = null;
    this.manifest = null;
    this.isLoaded = false;
    this.loadState = 'idle';
    this.loadFailures = [];
    this.roundRobinCursors.clear();
    this.releaseRegions = [];
    this.voiceOrdinal = 0;
    this.cacheReferenceOwners = 0;
    this.loadingPromise = null;
    this.backgroundLoadingPromise = null;
    this.inFlightBuffers.clear();
    this.audioContext = null;
    this.destination = null;
  }
}

/**
 * Loading state for observable state pattern.
 */
export type InstrumentState = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Callback for state change notifications.
 */
export type StateChangeCallback = (
  instrumentId: string,
  state: InstrumentState,
  error?: Error
) => void;

/**
 * Registry of all sampled instruments.
 * Handles lazy loading and provides a unified interface.
 *
 * Implements Observable State Pattern (Phase 22 refactoring):
 * - getState(id) - Get current loading state
 * - getError(id) - Get error if in error state
 * - onStateChange(callback) - Subscribe to state changes
 * - retry(id) - Retry loading after error
 */
export class SampledInstrumentRegistry {
  private instruments: Map<string, SampledInstrument> = new Map();
  private audioContext: AudioContext | null = null;
  private destination: AudioNode | null = null;

  // Observable state
  private states: Map<string, InstrumentState> = new Map();
  private errors: Map<string, Error> = new Map();
  private listeners: Set<StateChangeCallback> = new Set();

  /**
   * Initialize the registry with audio context.
   */
  initialize(audioContext: AudioContext, destination: AudioNode): void {
    this.audioContext = audioContext;
    this.destination = destination;

    // Initialize any already-registered instruments
    for (const instrument of this.instruments.values()) {
      instrument.initialize(audioContext, destination);
    }
  }

  /**
   * Register a sampled instrument.
   * Call this at startup to make instruments available.
   */
  register(instrumentId: string, baseUrl?: string): void {
    if (this.instruments.has(instrumentId)) return;

    const instrument = new SampledInstrument(instrumentId, baseUrl);
    if (this.audioContext && this.destination) {
      instrument.initialize(this.audioContext, this.destination);
    }
    this.instruments.set(instrumentId, instrument);
    this.states.set(instrumentId, 'idle');
  }

  /**
   * Get an instrument by ID.
   * Returns undefined if not registered.
   */
  get(instrumentId: string): SampledInstrument | undefined {
    return this.instruments.get(instrumentId);
  }

  /**
   * Check if an instrument is registered.
   */
  has(instrumentId: string): boolean {
    return this.instruments.has(instrumentId);
  }

  /**
   * Load an instrument (lazy load on demand).
   * Updates state: idle -> loading -> ready/error
   */
  async load(instrumentId: string): Promise<boolean> {
    const instrument = this.instruments.get(instrumentId);
    if (!instrument) return false;

    // Transition to loading state
    this.setState(instrumentId, 'loading');

    try {
      const success = await instrument.ensureLoaded();
      if (success) {
        this.setState(instrumentId, 'ready');
        void instrument.waitForBackgroundLoad().then(loadState => {
          if (loadState === 'degraded') {
            const details = instrument.getLoadFailures().map(failure => `${failure.file}: ${failure.message}`).join('; ');
            this.setState(instrumentId, 'error', new Error(`Instrument degraded after background loading: ${details}`));
          }
        });
      } else {
        this.setState(instrumentId, 'error', new Error('Failed to load instrument'));
      }
      return success;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.setState(instrumentId, 'error', err);
      return false;
    }
  }

  /**
   * Retry loading an instrument after error.
   */
  async retry(instrumentId: string): Promise<boolean> {
    // Clear error state and retry
    this.errors.delete(instrumentId);
    this.states.set(instrumentId, 'idle');
    return this.load(instrumentId);
  }

  /**
   * Get the current loading state for an instrument.
   */
  getState(instrumentId: string): InstrumentState {
    return this.states.get(instrumentId) ?? 'idle';
  }

  /**
   * Get the error for an instrument (if in error state).
   */
  getError(instrumentId: string): Error | null {
    return this.errors.get(instrumentId) ?? null;
  }

  /**
   * Subscribe to state changes.
   * Returns an unsubscribe function.
   */
  onStateChange(callback: StateChangeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Update state and notify listeners.
   */
  private setState(instrumentId: string, state: InstrumentState, error?: Error): void {
    this.states.set(instrumentId, state);
    if (error) {
      this.errors.set(instrumentId, error);
    } else {
      this.errors.delete(instrumentId);
    }
    // Notify all listeners
    for (const listener of this.listeners) {
      listener(instrumentId, state, error);
    }
  }

  /**
   * Get all registered instrument IDs.
   */
  getInstrumentIds(): string[] {
    return Array.from(this.instruments.keys());
  }

  /**
   * Acquire cache references for an instrument's samples.
   * Call when a track starts using this instrument.
   * Only acquires if instrument is loaded.
   */
  acquireInstrumentSamples(instrumentId: string): void {
    const instrument = this.instruments.get(instrumentId);
    if (instrument?.isReady()) {
      instrument.acquireCacheReferences();
    }
  }

  /**
   * Release cache references for an instrument's samples.
   * Call when a track stops using this instrument.
   */
  releaseInstrumentSamples(instrumentId: string): void {
    const instrument = this.instruments.get(instrumentId);
    if (instrument) {
      instrument.releaseCacheReferences();
    }
  }

  /**
   * Dispose all instruments and clear registry.
   * Called during AudioEngine.dispose() to prevent memory leaks.
   */
  dispose(): void {
    // Dispose all instruments
    for (const instrument of this.instruments.values()) {
      instrument.dispose();
    }

    // Clear all state
    this.instruments.clear();
    this.states.clear();
    this.errors.clear();
    this.listeners.clear();
    this.audioContext = null;
    this.destination = null;
  }
}

// Singleton registry
export const sampledInstrumentRegistry = new SampledInstrumentRegistry();

/**
 * List of available sampled instruments.
 * These will be registered at startup.
 */
export const SAMPLED_INSTRUMENTS = [
  // Phase 22: First sampled instrument
  'piano',
  // Phase 29A: Essential Samples
  '808-kick',
  '808-snare',
  '808-hihat-closed',
  '808-hihat-open',
  '808-clap',
  'acoustic-kick',
  'acoustic-snare',
  'acoustic-hihat-closed',
  'acoustic-hihat-open',
  'acoustic-ride',
  'acoustic-crash',
  'brushes-snare',
  'finger-bass',
  'vinyl-crackle',
  // Phase 29C: Expressive Samples
  'vibraphone',
  'string-section',
  'french-horn',
  'alto-sax',
  // Phase 29D: Complete Collection
  'clean-guitar',
  'acoustic-guitar',
  'marimba',
  // Phase 29E: New instruments
  'kalimba',
  'slap-bass',
  'steel-drums',
  'hammond-organ',
] as const;

export type SampledInstrumentId = typeof SAMPLED_INSTRUMENTS[number];

export interface SampledInstrumentQuarantine {
  reason: string;
  replacement: string;
}

/** Legacy IDs whose raw sample redistribution is not authorized. */
export const QUARANTINED_SAMPLED_INSTRUMENTS = {
  'rhodes-ep': {
    reason: 'Removed because the source terms do not authorize raw redistribution in Keyboardia',
    replacement: 'synth:rhodes',
  },
} as const satisfies Readonly<Record<string, SampledInstrumentQuarantine>>;

export type QuarantinedSampledInstrumentId = keyof typeof QUARANTINED_SAMPLED_INSTRUMENTS;

export function getSampledInstrumentQuarantine(sampleId: string): SampledInstrumentQuarantine | undefined {
  if (!Object.hasOwn(QUARANTINED_SAMPLED_INSTRUMENTS, sampleId)) return undefined;
  return QUARANTINED_SAMPLED_INSTRUMENTS[sampleId as QuarantinedSampledInstrumentId];
}

export function isQuarantinedSampledInstrument(sampleId: string): sampleId is QuarantinedSampledInstrumentId {
  return Object.hasOwn(QUARANTINED_SAMPLED_INSTRUMENTS, sampleId);
}

/**
 * Check if a sample ID is an active sampled instrument (vs synth preset or a
 * quarantined legacy identifier).
 */
export function isSampledInstrument(sampleId: string): sampleId is SampledInstrumentId {
  return SAMPLED_INSTRUMENTS.includes(sampleId as SampledInstrumentId);
}
