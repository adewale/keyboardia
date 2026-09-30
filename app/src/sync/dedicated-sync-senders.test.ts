// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParameterLock, Track } from '../types';
import {
  multiplayer,
  sendAddTrack,
  sendBatchClearSteps,
  sendBatchSetParameterLocks,
  sendReorderTracks,
} from './multiplayer';

const track: Track = {
  id: 'track-1',
  name: 'Kick',
  sampleId: 'kick',
  steps: [true, false],
  parameterLocks: [null, null],
  volume: 1,
  pan: 0,
  muted: false,
  soloed: false,
  transpose: 0,
  stepCount: 2,
  swing: 0,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dedicated multiplayer senders', () => {
  it('send the exact payloads required by their nonstandard UI routes', () => {
    const send = vi.spyOn(multiplayer, 'send').mockImplementation(() => {});
    const lock: ParameterLock = { volume: 0.75 };

    sendAddTrack(track);
    sendReorderTracks('track-1', 3);
    sendBatchClearSteps('track-1', [1, 4]);
    sendBatchSetParameterLocks('track-1', [{ step: 4, lock }]);

    expect(send.mock.calls.map(([message]) => message)).toEqual([
      { type: 'add_track', track },
      { type: 'reorder_tracks', trackId: 'track-1', toIndex: 3 },
      { type: 'batch_clear_steps', trackId: 'track-1', steps: [1, 4] },
      {
        type: 'batch_set_parameter_locks',
        trackId: 'track-1',
        locks: [{ step: 4, lock }],
      },
    ]);
  });

  it('does not send empty batch operations', () => {
    const send = vi.spyOn(multiplayer, 'send').mockImplementation(() => {});

    sendBatchClearSteps('track-1', []);
    sendBatchSetParameterLocks('track-1', []);

    expect(send).not.toHaveBeenCalled();
  });
});
