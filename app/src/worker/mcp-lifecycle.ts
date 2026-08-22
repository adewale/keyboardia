/**
 * Transport-neutral logic behind the MCP session-lifecycle and export tools.
 *
 * Nothing here talks to KV, a Durable Object, or the MCP SDK, so each rule can
 * be tested directly. The adapter in mcp.ts supplies the storage.
 */

import {
  SYNTH_PROGRAM_MAP,
  encodeMidi,
  isDrumTrack,
} from '../shared/midi-core';
import { instrumentPresetId } from '../shared/instrument-classification';
import type { Session, SessionTrack } from '../shared/state';
import { hasActiveSteps } from '../shared/pattern-expansion';
import { McpSessionEditError } from './mcp-edits';

/**
 * How long a create key keeps resolving to the same session. An agent's retry
 * happens within seconds; a day is generous and bounds the stored keys.
 */
export const MCP_CREATE_IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/**
 * The canonical URL an agent hands back to a person.
 *
 * Session UUIDs are the only access control Keyboardia has, so this is also why
 * `idempotency_key` is required to be a UUID rather than a caller-chosen label:
 * a memorable key like "house-beat" would let one agent's create silently
 * resolve to a different agent's session.
 */
export function sessionUrl(baseUrl: string, sessionId: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/s/${sessionId}`;
}

export interface McpSessionRef {
  session_id: string;
  url: string;
  immutable: boolean;
  name: string | null;
  remixed_from: string | null;
}

export function sessionRef(baseUrl: string, session: Session): McpSessionRef {
  return {
    session_id: session.id,
    url: sessionUrl(baseUrl, session.id),
    immutable: session.immutable,
    name: session.name,
    remixed_from: session.remixedFrom,
  };
}

// ============================================================================
// MIDI export
// ============================================================================

export type McpMidiOmissionReason = 'muted' | 'not_soloed' | 'empty';

export interface McpMidiOmittedTrack {
  track_id: string;
  name: string;
  reason: McpMidiOmissionReason;
}

export interface McpMidiUnsupportedFeature {
  feature: string;
  detail: string;
  track_ids?: string[];
}

export interface McpMidiExport {
  session_id: string;
  filename: string;
  mime_type: 'audio/midi';
  encoding: 'base64';
  data: string;
  byte_length: number;
  tempo: number;
  swing: number;
  exported_track_ids: string[];
  omitted_tracks: McpMidiOmittedTrack[];
  /**
   * Session state the Standard MIDI File cannot carry. Reported rather than
   * approximated silently, so an agent can tell someone what will not survive
   * the trip into their DAW.
   */
  unsupported: McpMidiUnsupportedFeature[];
}

/**
 * Mirrors the track selection in exportToMidi(), which in turn mirrors the
 * audio scheduler: solo wins over mute, and silent tracks are skipped.
 */
function classifyTracks(tracks: SessionTrack[]): {
  exported: SessionTrack[];
  omitted: McpMidiOmittedTrack[];
} {
  const anySoloed = tracks.some((track) => track.soloed);
  const exported: SessionTrack[] = [];
  const omitted: McpMidiOmittedTrack[] = [];

  for (const track of tracks) {
    const shouldExport = anySoloed ? Boolean(track.soloed) : !track.muted;
    if (!shouldExport) {
      omitted.push({
        track_id: track.id,
        name: track.name,
        reason: anySoloed ? 'not_soloed' : 'muted',
      });
      continue;
    }
    if (!hasActiveSteps(track)) {
      omitted.push({ track_id: track.id, name: track.name, reason: 'empty' });
      continue;
    }
    exported.push(track);
  }

  return { exported, omitted };
}

/**
 * Everything the exporter drops or approximates, derived from the same session
 * the file was built from.
 */
export function describeUnsupportedMidiFeatures(
  session: Session,
  exportedTracks: SessionTrack[]
): McpMidiUnsupportedFeature[] {
  const unsupported: McpMidiUnsupportedFeature[] = [];

  const envelopeTracks = exportedTracks.filter((track) =>
    track.envelope !== undefined
    || track.envelopeTimeUnit === 'steps'
    || track.gate !== undefined
    || track.parameterLocks.some((lock) => lock?.attack !== undefined
      || lock?.decay !== undefined
      || lock?.release !== undefined),
  );
  if (envelopeTracks.length > 0) {
    unsupported.push({
      feature: 'amplitude_envelope',
      detail: 'Track ADSR, tempo-relative envelope times, gate percentage, and per-step envelope locks have no portable Standard MIDI File representation.',
      track_ids: envelopeTracks.map((track) => track.id),
    });
  }

  const perTrackSwing = exportedTracks.filter((track) => (track.swing ?? 0) > 0);
  if (perTrackSwing.length > 0) {
    unsupported.push({
      feature: 'per_track_swing',
      detail: 'Only the session-wide swing is applied to note timing; per-track swing is not represented.',
      track_ids: perTrackSwing.map((track) => track.id),
    });
  }

  const mixedTracks = exportedTracks.filter((track) => track.volume !== 1);
  if (mixedTracks.length > 0) {
    unsupported.push({
      feature: 'track_volume',
      detail: 'Note velocity comes from per-step parameter locks only; track mix levels are not exported.',
      track_ids: mixedTracks.map((track) => track.id),
    });
  }

  const recordings = exportedTracks.filter((track) => track.sampleId.toLowerCase().startsWith('mic:'));
  if (recordings.length > 0) {
    unsupported.push({
      feature: 'custom_recordings',
      detail: 'A microphone recording has no General MIDI equivalent; these tracks are written as Middle C on the drum channel.',
      track_ids: recordings.map((track) => track.id),
    });
  }

  const unmappedInstruments = exportedTracks.filter((track) => {
    if (isDrumTrack(track)) return false;
    const presetId = instrumentPresetId(track.sampleId);
    return !(presetId in SYNTH_PROGRAM_MAP);
  });
  if (unmappedInstruments.length > 0) {
    unsupported.push({
      feature: 'instrument_program',
      detail: 'These instruments have no General MIDI program mapping and fall back to Acoustic Grand Piano.',
      track_ids: unmappedInstruments.map((track) => track.id),
    });
  }

  if (session.state.effects) {
    unsupported.push({
      feature: 'effects',
      detail: 'Reverb, delay, and filter settings are audio processing with no Standard MIDI File representation.',
    });
  }

  if (session.state.loopRegion) {
    unsupported.push({
      feature: 'loop_region',
      detail: 'The export always covers the full pattern; the editor loop region is not applied.',
    });
  }

  return unsupported;
}

/**
 * Workers have btoa but no Buffer. Chunked so a large file cannot blow the
 * argument limit on String.fromCharCode.
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/**
 * Runs Keyboardia's authoritative exporter over a session. The same
 * encodeMidi() the browser's Export MIDI button uses, so the bytes match for
 * identical state.
 */
export function exportSessionToMidi(session: Session): McpMidiExport {
  const { exported, omitted } = classifyTracks(session.state.tracks);

  if (exported.length === 0) {
    throw new McpSessionEditError(
      'This session has no audible notes to export.',
      'NOTHING_TO_EXPORT',
      409
    );
  }

  const { filename, midiData } = encodeMidi(
    {
      tracks: session.state.tracks,
      tempo: session.state.tempo,
      swing: session.state.swing,
    },
    { sessionName: session.name }
  );

  return {
    session_id: session.id,
    filename,
    mime_type: 'audio/midi',
    encoding: 'base64',
    data: toBase64(midiData),
    byte_length: midiData.byteLength,
    tempo: session.state.tempo,
    swing: session.state.swing,
    exported_track_ids: exported.map((track) => track.id),
    omitted_tracks: omitted,
    unsupported: describeUnsupportedMidiFeatures(session, exported),
  };
}
