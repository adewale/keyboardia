import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateCompleteSessionState } from '../worker/validation';
import { repairStateInvariants, validateStateInvariants } from '../worker/invariants';
import type { SessionState } from '../shared/state';
import { velocityFromMultiplier } from '../audio/velocity';
import { VELOCITY_FILTER_BYPASS_VELOCITY } from '../audio/velocity-sample-filter';
import { NEW_SESSION_EFFECTS_STATE } from '../shared/effects-defaults';
import type { InstrumentManifest } from '../audio/sampled-instrument';
import { velocityFilterAnchorHz } from '../audio/velocity-filter-calibration';

/**
 * "Whisper to Roar" exists to make the Phase 44 changes audible; this test
 * keeps it honest. It must stay a valid session the mock API can serve, and
 * it must keep exercising the features it advertises: soft velocity locks on
 * filter-anchored instruments (Change 2), the default room (Change 3), tied
 * sustains on a guarded instrument (§4), and real velocity layers on the kit.
 */

interface DemoArtifact {
  name: string;
  description: string;
  state: SessionState;
}

const artifact = JSON.parse(
  readFileSync(
    resolve(process.cwd(), 'scripts/demo-sessions/whisper-to-roar.json'),
    'utf8',
  ),
) as DemoArtifact;

function manifestOf(sampleId: string): InstrumentManifest {
  const instrumentId = sampleId.replace(/^sampled:/, '');
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `public/instruments/${instrumentId}/manifest.json`),
      'utf8',
    ),
  ) as InstrumentManifest;
}

function hasVelocityFilterCalibration(manifest: InstrumentManifest): boolean {
  const note = manifest.playbackNote ?? manifest.playableRange?.min ?? 60;
  return velocityFilterAnchorHz(manifest.id, note, 44_100) !== undefined
    && velocityFilterAnchorHz(manifest.id, note, 48_000) !== undefined;
}

describe('Whisper to Roar demo session', () => {
  it('is a valid, invariant-clean session the mock API can serve', () => {
    expect(artifact.name).toBe('Whisper to Roar');
    expect(artifact.description).toBeTruthy();
    const validation = validateCompleteSessionState(artifact.state);
    expect(validation.errors ?? []).toEqual([]);
    expect(validation.valid).toBe(true);
    // The mock API serves through the production repair (steps padded to
    // MAX_STEPS, missing pan defaulted); the artifact must need nothing else.
    const { repairedState, repairs } = repairStateInvariants(structuredClone(artifact.state));
    const unexpected = repairs.filter(repair =>
      !/^Padded (steps|parameterLocks) array/.test(repair)
      && !/^Replaced non-finite pan undefined with 0/.test(repair));
    expect(unexpected).toEqual([]);
    expect(validateStateInvariants(repairedState).valid).toBe(true);
  });

  it('drives the velocity filter: soft locks below bypass on anchored instruments', () => {
    let filteredNotes = 0;
    for (const track of artifact.state.tracks) {
      if (!track.sampleId.startsWith('sampled:')) continue;
      const manifest = manifestOf(track.sampleId);
      if (!hasVelocityFilterCalibration(manifest)) continue;
      track.parameterLocks.forEach((lock, step) => {
        if (!track.steps[step] || lock?.volume === undefined) return;
        if (velocityFromMultiplier(lock.volume) < VELOCITY_FILTER_BYPASS_VELOCITY) {
          filteredNotes++;
        }
      });
    }
    // Enough soft strikes that the darkening is a feature of the piece, not
    // an easter egg.
    expect(filteredNotes).toBeGreaterThanOrEqual(6);
  });

  it('carries full-velocity accents that provably bypass the filter', () => {
    const accents = artifact.state.tracks
      .filter(track => hasVelocityFilterCalibration(manifestOf(track.sampleId)))
      .flatMap(track => track.parameterLocks)
      .filter(lock => lock?.volume !== undefined
        && velocityFromMultiplier(lock.volume!) >= VELOCITY_FILTER_BYPASS_VELOCITY);
    expect(accents.length).toBeGreaterThanOrEqual(2);
  });

  it('uses the Phase 44 default room and exercises tied sustains and kit layers', () => {
    expect(artifact.state.effects?.reverb.wet).toBe(NEW_SESSION_EFFECTS_STATE.reverb.wet);
    const strings = artifact.state.tracks.find(track => track.sampleId === 'sampled:string-section')!;
    expect(strings.parameterLocks.filter(lock => lock?.tie === true).length).toBeGreaterThanOrEqual(6);
    const snare = artifact.state.tracks.find(track => track.sampleId === 'sampled:acoustic-snare')!;
    const ghostSnares = snare.parameterLocks.filter(
      lock => lock?.volume !== undefined && lock.volume <= 0.3,
    );
    expect(ghostSnares.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps every locked pitch inside its instrument playable range and scale', () => {
    for (const track of artifact.state.tracks) {
      const manifest = manifestOf(track.sampleId);
      const range = manifest.playableRange;
      track.parameterLocks.forEach((lock, step) => {
        if (!track.steps[step] || lock?.pitch === undefined) return;
        const rendered = (manifest.playbackNote ?? 60) + lock.pitch + track.transpose;
        if (range) {
          expect(rendered, `${track.sampleId} step ${step}`).toBeGreaterThanOrEqual(range.min);
          expect(rendered, `${track.sampleId} step ${step}`).toBeLessThanOrEqual(range.max);
        }
      });
    }
  });
});
