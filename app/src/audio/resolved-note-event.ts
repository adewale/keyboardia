import type { AudioTime, Seconds } from './audio-time';
import type { InstrumentType } from './instrument-types';

/**
 * Renderer-neutral note contract. All musical decisions are complete before
 * this crosses the dispatch boundary; renderers may not reinterpret `when`.
 */
export interface ResolvedNoteEvent {
  type: 'note';
  trackId: string;
  noteId: string;
  sampleId: string;
  instrumentType: InstrumentType;
  presetId: string;
  pitchSemitones: number;
  when: AudioTime;
  duration: Seconds;
  midiVelocity: number;
  noteGain: number;
  hasExplicitLock: boolean;
  loopIteration: number;
}
