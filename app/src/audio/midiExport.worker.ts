/**
 * MIDI Export Web Worker
 *
 * Moves MIDI file encoding off the main thread to prevent UI freezing
 * during export of large sessions. Uses the same exportToMidi() function
 * as the main thread — the worker just provides isolation.
 *
 * Communication protocol:
 *   Main → Worker: { state, options }
 *   Worker → Main: { blob, filename } (success) or { error } (failure)
 *
 * @see docs/LESSONS-LEARNED.md - Lesson 20
 */

import { exportToMidi } from './midiExport';
import type {
  MidiWorkerRequest,
  MidiWorkerResponse,
  MidiWorkerError,
} from './midiExport.types';

self.onmessage = (e: MessageEvent<MidiWorkerRequest>) => {
  try {
    const { state, options } = e.data;
    const { blob, filename } = exportToMidi(state, options);
    (self as unknown as Worker).postMessage({ blob, filename } satisfies MidiWorkerResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown MIDI export error';
    (self as unknown as Worker).postMessage({ error: message } satisfies MidiWorkerError);
  }
};
