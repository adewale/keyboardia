import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { validateChecklist } from '../../scripts/validate-sync-checklist';

const liveSession = readFileSync(resolve('src/worker/live-session.ts'), 'utf-8');
const multiplayer = readFileSync(resolve('src/sync/multiplayer.ts'), 'utf-8');
const useMultiplayer = readFileSync(resolve('src/hooks/useMultiplayer.ts'), 'utf-8');

describe('validate-sync-checklist', () => {
  it('accepts every mutation in the production message map', () => {
    expect(validateChecklist(liveSession, multiplayer, useMultiplayer).errors).toEqual([]);
  });

  it.each([
    {
      name: 'Worker dispatch case',
      liveSession: liveSession.replace("case 'set_tempo':", "case 'removed_set_tempo':"),
      multiplayer,
      expected: "[live-session.ts] Missing switch case: case 'set_tempo':",
    },
    {
      name: 'Worker handler',
      liveSession: liveSession.replaceAll('handleSetTempo', 'removedHandleSetTempo'),
      multiplayer,
      expected: '[live-session.ts] Missing handler method: handleSetTempo',
    },
    {
      name: 'browser dispatch case',
      liveSession,
      multiplayer: multiplayer.replace("case 'tempo_changed':", "case 'removed_tempo_changed':"),
      expected: "[multiplayer.ts] Missing switch case: case 'tempo_changed':",
    },
    {
      name: 'browser handler',
      liveSession,
      multiplayer: multiplayer.replaceAll('handleTempoChanged', 'removedHandleTempoChanged'),
      expected: '[multiplayer.ts] Missing handler method: handleTempoChanged',
    },
    {
      name: 'action conversion',
      liveSession,
      multiplayer: multiplayer.replace("case 'SET_TEMPO':", "case 'REMOVED_SET_TEMPO':"),
      expected: "[multiplayer.ts] Missing actionToMessage case: case 'SET_TEMPO':",
    },
  ])('rejects a missing $name', ({ liveSession: worker, multiplayer: client, expected }) => {
    expect(validateChecklist(worker, client, useMultiplayer).errors).toContain(expected);
  });

  it('rejects a dedicated sender that stops emitting its mapped message', () => {
    const broken = multiplayer.replace(
      "multiplayer.send({ type: 'add_track', track });",
      "multiplayer.send({ type: 'removed_add_track', track });",
    );
    expect(validateChecklist(liveSession, broken, useMultiplayer).errors).toContain(
      "[multiplayer.ts] sendAddTrack does not send type: 'add_track'",
    );
  });

  it('rejects a dedicated sender disconnected from its hook', () => {
    const broken = useMultiplayer.replace(
      'sendReorderTracks(trackId, toIndex);',
      'removedSendReorderTracks(trackId, toIndex);',
    );
    expect(validateChecklist(liveSession, multiplayer, broken).errors).toContain(
      '[useMultiplayer.ts] handleTrackReorder does not call sendReorderTracks',
    );
  });

  it('rejects a dedicated sender moved into the wrong hook', () => {
    const broken = useMultiplayer
      .replace('sendReorderTracks(trackId, toIndex);', 'removedSendReorderTracks(trackId, toIndex);')
      .replace(
        'sendBatchClearSteps(trackId, steps);',
        'sendBatchClearSteps(trackId, steps);\n        sendReorderTracks(trackId, 0);',
      );
    expect(validateChecklist(liveSession, multiplayer, broken).errors).toContain(
      '[useMultiplayer.ts] handleTrackReorder does not call sendReorderTracks',
    );
  });

  it('rejects a dedicated hook omitted from the returned API', () => {
    const broken = useMultiplayer.replace(
      '    handleTrackReorder,',
      '    removedHandleTrackReorder,',
    );
    expect(validateChecklist(liveSession, multiplayer, broken).errors).toContain(
      '[useMultiplayer.ts] Dedicated hook is not returned: handleTrackReorder',
    );
  });
});
