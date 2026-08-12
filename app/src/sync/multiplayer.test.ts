import { describe, expect, it } from 'vitest';
import type { GridAction } from '../types';
import { actionToMessage } from './multiplayer';

describe('actionToMessage', () => {
  const synchronized: Array<[string, GridAction, unknown]> = [
    ['step toggles', { type: 'TOGGLE_STEP', trackId: 'track-1', step: 5 },
      { type: 'toggle_step', trackId: 'track-1', step: 5 }],
    ['tempo', { type: 'SET_TEMPO', tempo: 140 }, { type: 'set_tempo', tempo: 140 }],
    ['swing', { type: 'SET_SWING', swing: 25 }, { type: 'set_swing', swing: 25 }],
    ['parameter locks', {
      type: 'SET_PARAMETER_LOCK', trackId: 'track-2', step: 7,
      lock: { pitch: 3, volume: 0.8 },
    }, {
      type: 'set_parameter_lock', trackId: 'track-2', step: 7,
      lock: { pitch: 3, volume: 0.8 },
    }],
    ['track deletion', { type: 'DELETE_TRACK', trackId: 'track-3' },
      { type: 'delete_track', trackId: 'track-3' }],
    ['track clearing', { type: 'CLEAR_TRACK', trackId: 'track-4' },
      { type: 'clear_track', trackId: 'track-4' }],
    ['instrument changes', {
      type: 'SET_TRACK_INSTRUMENT',
      trackId: 'track-5',
      sampleId: 'sampled:808-kick',
      name: 'Ada Lead',
    }, {
      type: 'set_track_sample',
      trackId: 'track-5',
      sampleId: 'sampled:808-kick',
      name: 'Ada Lead',
    }],
    ['sample selection', {
      type: 'SET_TRACK_SAMPLE', trackId: 'track-5', sampleId: 'kick', name: 'Kick Drum',
    }, {
      type: 'set_track_sample', trackId: 'track-5', sampleId: 'kick', name: 'Kick Drum',
    }],
    ['track volume', { type: 'SET_TRACK_VOLUME', trackId: 'track-6', volume: 0.75 },
      { type: 'set_track_volume', trackId: 'track-6', volume: 0.75 }],
    ['track pan', { type: 'SET_TRACK_PAN', trackId: 'track-6', pan: -0.25 },
      { type: 'set_track_pan', trackId: 'track-6', pan: -0.25 }],
    ['track transpose', { type: 'SET_TRACK_TRANSPOSE', trackId: 'track-7', transpose: -5 },
      { type: 'set_track_transpose', trackId: 'track-7', transpose: -5 }],
    ['track length', { type: 'SET_TRACK_STEP_COUNT', trackId: 'track-8', stepCount: 32 },
      { type: 'set_track_step_count', trackId: 'track-8', stepCount: 32 }],
    ['playback start', { type: 'SET_PLAYING', isPlaying: true }, { type: 'play' }],
    ['playback stop', { type: 'SET_PLAYING', isPlaying: false }, { type: 'stop' }],
  ];

  it.each(synchronized)('serializes %s through the production mapper', (_name, action, expected) => {
    expect(actionToMessage(action)).toEqual(expected);
  });

  const localOnly: Array<[string, GridAction]> = [
    ['mute', { type: 'TOGGLE_MUTE', trackId: 'track-1' }],
    ['solo', { type: 'TOGGLE_SOLO', trackId: 'track-1' }],
    ['track creation', { type: 'ADD_TRACK', sampleId: 'snare', name: 'Snare' }],
    ['snapshot loading', { type: 'LOAD_STATE', tracks: [], tempo: 120, swing: 0 }],
    ['state reset', { type: 'RESET_STATE' }],
    ['playhead movement', { type: 'SET_CURRENT_STEP', step: 4 }],
  ];

  it.each(localOnly)('does not send local-only %s actions', (_name, action) => {
    expect(actionToMessage(action)).toBeNull();
  });

  it('does not echo a remote action back to the server', () => {
    expect(actionToMessage({ type: 'SET_TEMPO', tempo: 120, isRemote: true })).toBeNull();
  });
});
