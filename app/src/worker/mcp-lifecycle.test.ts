import { describe, expect, it } from 'vitest';
import { exportToMidi } from '../audio/midiExport';
import type { Session, SessionTrack } from '../shared/state';
import { createDefaultTrack, createInitialState } from '../shared/state-mutations';
import { sessionTracksToTracks } from '../types';
import { McpSessionEditError } from './mcp-edits';
import {
  createIdempotencyKeyName,
  describeUnsupportedMidiFeatures,
  exportSessionToMidi,
  sessionRef,
  sessionUrl,
  toBase64,
} from './mcp-lifecycle';

const SESSION_ID = '00000000-0000-4000-8000-000000000001';

function track(
  id: string,
  sampleId: string,
  activeSteps: number[],
  overrides: Partial<SessionTrack> = {}
): SessionTrack {
  const base = createDefaultTrack(id, sampleId, id);
  const steps = [...base.steps];
  for (const step of activeSteps) steps[step] = true;
  return { ...base, steps, ...overrides };
}

function session(tracks: SessionTrack[], overrides: Partial<Session> = {}): Session {
  return {
    id: SESSION_ID,
    name: 'MCP test',
    createdAt: 1,
    updatedAt: 1,
    lastAccessedAt: 1,
    remixedFrom: null,
    remixedFromName: null,
    remixCount: 0,
    immutable: false,
    state: { ...createInitialState(), tracks },
    ...overrides,
  };
}

describe('sessionUrl', () => {
  it('builds the canonical session link', () => {
    expect(sessionUrl('https://keyboardia.dev', SESSION_ID))
      .toBe(`https://keyboardia.dev/s/${SESSION_ID}`);
  });

  it('does not double the separator when the origin has a trailing slash', () => {
    expect(sessionUrl('https://keyboardia.dev/', SESSION_ID))
      .toBe(`https://keyboardia.dev/s/${SESSION_ID}`);
  });
});

describe('sessionRef', () => {
  it('carries the handle, link, and lineage an agent needs to report back', () => {
    expect(sessionRef('https://keyboardia.dev', session([], { remixedFrom: 'source-id' }))).toEqual({
      session_id: SESSION_ID,
      url: `https://keyboardia.dev/s/${SESSION_ID}`,
      immutable: false,
      name: 'MCP test',
      remixed_from: 'source-id',
    });
  });
});

describe('createIdempotencyKeyName', () => {
  it('cannot collide with a stored session', () => {
    const key = createIdempotencyKeyName(SESSION_ID);

    expect(key).not.toBe(`session:${SESSION_ID}`);
    expect(key.startsWith('mcp-idempotency:create:')).toBe(true);
  });
});

describe('toBase64', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array(1024).map((_, index) => index % 256);

    expect(new Uint8Array(Buffer.from(toBase64(bytes), 'base64'))).toEqual(bytes);
  });

  it('handles an empty buffer', () => {
    expect(toBase64(new Uint8Array(0))).toBe('');
  });
});

describe('exportSessionToMidi', () => {
  it('produces the same bytes as the browser export for the same music', () => {
    const source = session([track('kick', 'kick', [0, 4, 8, 12])]);

    const exported = exportSessionToMidi(source);
    const browser = exportToMidi(
      {
        tracks: sessionTracksToTracks(source.state.tracks),
        tempo: source.state.tempo,
        swing: source.state.swing,
      },
      { sessionName: source.name }
    );

    expect(Buffer.from(exported.data, 'base64')).toEqual(Buffer.from(browser._midiData));
    expect(exported.filename).toBe(browser.filename);
    expect(exported.byte_length).toBe(browser._midiData.byteLength);
  });

  it('returns a Standard MIDI File header', () => {
    const exported = exportSessionToMidi(session([track('kick', 'kick', [0])]));

    expect(Buffer.from(exported.data, 'base64').subarray(0, 4).toString('ascii')).toBe('MThd');
  });

  it('refuses a session with nothing audible instead of returning an empty file', () => {
    expect(() => exportSessionToMidi(session([]))).toThrow(McpSessionEditError);
    expect(() => exportSessionToMidi(session([track('kick', 'kick', [])])))
      .toThrow(/no audible notes/);
  });

  it('reports muted and empty tracks as omitted', () => {
    const exported = exportSessionToMidi(session([
      track('kick', 'kick', [0, 4]),
      track('snare', 'snare', [4], { muted: true }),
      track('hats', 'hihat', []),
    ]));

    expect(exported.exported_track_ids).toEqual(['kick']);
    expect(exported.omitted_tracks).toEqual([
      { track_id: 'snare', name: 'snare', reason: 'muted' },
      { track_id: 'hats', name: 'hats', reason: 'empty' },
    ]);
  });

  it('follows the scheduler rule that solo wins over mute', () => {
    const exported = exportSessionToMidi(session([
      track('kick', 'kick', [0], { soloed: true }),
      // Unmuted, but silenced by the other track's solo.
      track('snare', 'snare', [4]),
    ]));

    expect(exported.exported_track_ids).toEqual(['kick']);
    expect(exported.omitted_tracks).toEqual([
      { track_id: 'snare', name: 'snare', reason: 'not_soloed' },
    ]);
  });

  it('carries the session tempo and swing', () => {
    const source = session([track('kick', 'kick', [0])]);
    source.state.tempo = 124;
    source.state.swing = 30;

    const exported = exportSessionToMidi(source);

    expect(exported.tempo).toBe(124);
    expect(exported.swing).toBe(30);
  });
});

describe('describeUnsupportedMidiFeatures', () => {
  function features(source: Session): Record<string, string[] | undefined> {
    return Object.fromEntries(
      describeUnsupportedMidiFeatures(source, source.state.tracks)
        .map(({ feature, track_ids }) => [feature, track_ids])
    );
  }

  it('finds nothing to report for music a MIDI file can carry', () => {
    expect(describeUnsupportedMidiFeatures(
      session([track('kick', 'kick', [0])]),
      [track('kick', 'kick', [0])]
    )).toEqual([]);
  });

  it('reports per-track swing, which the exporter cannot represent', () => {
    expect(features(session([track('kick', 'kick', [0], { swing: 40 })])))
      .toMatchObject({ per_track_swing: ['kick'] });
  });

  it('reports track mix levels, which never become velocity', () => {
    expect(features(session([track('kick', 'kick', [0], { volume: 0.4 })])))
      .toMatchObject({ track_volume: ['kick'] });
  });

  it('reports microphone recordings written as a placeholder note', () => {
    expect(features(session([track('vox', 'mic:recording-1', [0])])))
      .toMatchObject({ custom_recordings: ['vox'] });
  });

  it('reports instruments with no General MIDI program', () => {
    const reported = features(session([
      track('saw', 'advanced:supersaw', [0]),
      track('keys', 'tone:fm-epiano', [0]),
    ]));

    // fm-epiano maps to Electric Piano 1; supersaw has no GM equivalent.
    expect(reported.instrument_program).toEqual(['saw']);
  });

  it('does not treat a drum track as an unmapped instrument', () => {
    expect(features(session([track('kick', 'kick', [0])])).instrument_program).toBeUndefined();
  });

  it('reports effects and the loop region as session-level omissions', () => {
    const source = session([track('kick', 'kick', [0])]);
    source.state.effects = { reverb: 0.3 } as never;
    source.state.loopRegion = { start: 0, end: 8 };

    const reported = describeUnsupportedMidiFeatures(source, source.state.tracks)
      .map(({ feature }) => feature);

    expect(reported).toContain('effects');
    expect(reported).toContain('loop_region');
  });
});
