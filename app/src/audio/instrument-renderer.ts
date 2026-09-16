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
  schedule(event: ResolvedNoteEvent): void;
}

export interface InstrumentRendererRegistry {
  schedule(event: ResolvedNoteEvent): void;
}

export function createInstrumentRendererRegistry(
  engine: AudioEngineRendererPort,
): InstrumentRendererRegistry {
  const renderers: Record<InstrumentType, InstrumentRenderer> = {
    synth: {
      schedule: (event) => engine.playSynthNote(
        event.noteId,
        event.presetId,
        event.pitchSemitones,
        event.when,
        event.duration,
        event.noteGain,
        event.trackId,
        event.midiVelocity,
      ),
    },
    sampled: {
      schedule: (event) => {
        if (!engine.isSampledInstrumentReady(event.presetId)) return;
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
      },
    },
    tone: {
      schedule: (event) => {
        if (!engine.isToneSynthReady('tone')) return;
        engine.playToneSynth(
          event.presetId as Parameters<AudioEngine['playToneSynth']>[0],
          event.pitchSemitones,
          event.when,
          event.duration,
          event.noteGain,
          event.trackId,
          event.midiVelocity,
        );
      },
    },
    advanced: {
      schedule: (event) => {
        if (!engine.isToneSynthReady('advanced')) return;
        engine.playAdvancedSynth(
          event.presetId,
          event.pitchSemitones,
          event.when,
          event.duration,
          event.noteGain,
          event.trackId,
          event.midiVelocity,
        );
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
      },
    },
  };

  return {
    schedule(event): void {
      renderers[event.instrumentType].schedule(event);
    },
  };
}
