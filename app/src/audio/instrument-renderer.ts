import type { AudioEngine } from './engine';
import { SCHEDULER_BASE_MIDI_NOTE } from './constants';
import type { InstrumentType } from './instrument-types';
import type { ResolvedNoteEvent } from './resolved-note-event';

export type { ResolvedNoteEvent } from './resolved-note-event';

export type AudioEngineRendererPort = Pick<
  AudioEngine,
  | 'playSynthNote'
  | 'playSample'
  | 'playSampledInstrument'
  | 'playToneSynth'
  | 'playAdvancedSynth'
  | 'isSampledInstrumentReady'
  | 'isToneSynthReady'
>;

export interface InstrumentRenderer {
  schedule(event: ResolvedNoteEvent): RendererScheduleResult;
}

export interface InstrumentRendererRegistry {
  schedule(event: ResolvedNoteEvent): RendererScheduleResult;
}

export type RendererScheduleResult =
  | { readonly kind: 'scheduled' }
  | {
      readonly kind: 'renderer-unavailable';
      readonly instrumentType: InstrumentType;
      readonly presetId: string;
    };

const SCHEDULED: RendererScheduleResult = Object.freeze({ kind: 'scheduled' });

function unavailable(event: ResolvedNoteEvent): RendererScheduleResult {
  return {
    kind: 'renderer-unavailable',
    instrumentType: event.instrumentType,
    presetId: event.presetId,
  };
}

export function createInstrumentRendererRegistry(
  engine: AudioEngineRendererPort,
): InstrumentRendererRegistry {
  const renderers: Record<InstrumentType, InstrumentRenderer> = {
    synth: {
      schedule: (event) => {
        engine.playSynthNote(
          event.noteId,
          event.presetId,
          event.pitchSemitones,
          event.when,
          event.duration,
          event.noteGain,
          event.trackId,
          event.midiVelocity,
        );
        return SCHEDULED;
      },
    },
    sampled: {
      schedule: (event) => {
        if (!engine.isSampledInstrumentReady(event.presetId)) return unavailable(event);
        engine.playSampledInstrument(
          event.presetId,
          event.noteId,
          SCHEDULER_BASE_MIDI_NOTE + event.pitchSemitones,
          event.when,
          event.duration,
          event.noteGain,
          event.trackId,
          event.midiVelocity,
        );
        return SCHEDULED;
      },
    },
    tone: {
      schedule: (event) => {
        if (!engine.isToneSynthReady('tone', event.trackId)) return unavailable(event);
        engine.playToneSynth(
          event.presetId as Parameters<AudioEngine['playToneSynth']>[0],
          event.pitchSemitones,
          event.when,
          event.duration,
          event.noteGain,
          event.trackId,
          event.midiVelocity,
        );
        return SCHEDULED;
      },
    },
    advanced: {
      schedule: (event) => {
        if (!engine.isToneSynthReady('advanced', event.trackId)) return unavailable(event);
        engine.playAdvancedSynth(
          event.presetId,
          event.pitchSemitones,
          event.when,
          event.duration,
          event.noteGain,
          event.trackId,
          event.midiVelocity,
        );
        return SCHEDULED;
      },
    },
    sample: {
      schedule: (event) => {
        const baseArguments = [
          event.sampleId,
          event.trackId,
          event.when,
          event.duration,
          event.pitchSemitones,
          event.noteGain,
          event.midiVelocity,
        ] as const;
        if (event.hasExplicitLock) {
          engine.playSample(...baseArguments);
        } else {
          engine.playSample(
            ...baseArguments,
            `${event.noteId}-loop-${event.loopIteration}`,
          );
        }
        return SCHEDULED;
      },
    },
  };

  return {
    schedule(event): RendererScheduleResult {
      return renderers[event.instrumentType].schedule(event);
    },
  };
}
