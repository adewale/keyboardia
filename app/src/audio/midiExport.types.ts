/**
 * Shared types for MIDI export main thread and worker.
 *
 * Extracted to break the circular dependency:
 *   midiExport.ts → midiExport.worker.ts → midiExport.ts
 */

import type { GridState } from '../types';
import type { MidiExportOptions } from '../shared/midi-core';
export type { MidiExportOptions } from '../shared/midi-core';

export interface MidiWorkerRequest {
  state: Pick<GridState, 'tracks' | 'tempo' | 'swing'>;
  options: MidiExportOptions;
}

export interface MidiWorkerResponse {
  blob: Blob;
  filename: string;
}

export interface MidiWorkerError {
  error: string;
}
