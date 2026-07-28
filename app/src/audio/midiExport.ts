/**
 * Browser adapter for Keyboardia's runtime-neutral MIDI encoder.
 *
 * Blob creation, Web Worker orchestration, and downloads belong here; the
 * encoder in shared/midi-core.ts is safe to call from both browser and Worker.
 */

import type { GridState } from '../types';
import { encodeMidi } from '../shared/midi-core';
import type { MidiExportOptions } from '../shared/midi-core';

export type { MidiExportOptions } from '../shared/midi-core';

export interface MidiExportResult {
  blob: Blob;
  filename: string;
  /** Raw MIDI data for testing */
  _midiData: Uint8Array;
}

export function exportToMidi(
  state: Pick<GridState, 'tracks' | 'tempo' | 'swing'>,
  options: MidiExportOptions = {}
): MidiExportResult {
  const { filename, midiData } = encodeMidi(state, options);

  return {
    blob: new Blob([midiData], { type: 'audio/midi' }),
    filename,
    _midiData: midiData,
  };
}

// ============================================================================
// Web Worker for off-thread MIDI encoding
// ============================================================================

import type { MidiWorkerResponse, MidiWorkerError } from './midiExport.types';

/**
 * Run MIDI export in a Web Worker to avoid blocking the main thread.
 * Falls back to main-thread export if Worker creation fails.
 *
 * @see docs/LESSONS-LEARNED.md - Lesson 20
 */
function exportToMidiAsync(
  state: Pick<GridState, 'tracks' | 'tempo' | 'swing'>,
  options: MidiExportOptions = {}
): Promise<{ blob: Blob; filename: string }> {
  return new Promise((resolve, reject) => {
    try {
      const worker = new Worker(
        new URL('./midiExport.worker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (e: MessageEvent<MidiWorkerResponse | MidiWorkerError>) => {
        worker.terminate();
        if ('error' in e.data) {
          reject(new Error(e.data.error));
        } else {
          resolve({ blob: e.data.blob, filename: e.data.filename });
        }
      };

      worker.onerror = (err) => {
        worker.terminate();
        reject(err);
      };

      worker.postMessage({ state, options });
    } catch {
      // Worker creation failed (e.g., CSP restrictions, unsupported env).
      // Fall back to synchronous main-thread export.
      const result = exportToMidi(state, options);
      resolve({ blob: result.blob, filename: result.filename });
    }
  });
}

// ============================================================================
// Download Function
// ============================================================================

/**
 * Check if the File System Access API is available.
 * This API allows users to choose save location (Chrome/Edge only).
 */
function hasFileSystemAccess(): boolean {
  return 'showSaveFilePicker' in window;
}

/**
 * Downloads a Keyboardia session as a MIDI file.
 *
 * MIDI encoding runs in a Web Worker to prevent UI freezing on large
 * sessions. Falls back to main-thread export if Workers are unavailable.
 *
 * Uses the File System Access API when available (Chrome/Edge) to let users
 * choose the save location and filename. Falls back to auto-download for
 * browsers that don't support it (Firefox/Safari).
 *
 * @param state - Grid state containing tracks, tempo, and swing
 * @param sessionName - Optional session name for default filename
 */
export async function downloadMidi(
  state: Pick<GridState, 'tracks' | 'tempo' | 'swing'>,
  sessionName?: string | null
): Promise<void> {
  const { blob, filename } = await exportToMidiAsync(state, { sessionName });

  // Try File System Access API for save dialog (Chrome/Edge)
  if (hasFileSystemAccess() && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: 'MIDI File',
            accept: {
              'audio/midi': ['.mid', '.midi'],
            },
          },
        ],
      });

      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      // User cancelled the save dialog - this is expected behavior
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      // For other errors, fall back to auto-download
      console.warn('File System Access API failed, falling back to download:', err);
    }
  }

  // Fallback: Auto-download for Firefox/Safari or if save dialog failed
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;

  // Append to DOM for Safari compatibility
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Release object URL to prevent memory leak
  URL.revokeObjectURL(url);
}
