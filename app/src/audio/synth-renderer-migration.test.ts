import { describe, expect, it } from 'vitest';
import { SYNTH_PRESETS } from './synth';
import {
  PUBLISHED_NATIVE_SYNTH_PRESETS,
  SYNTH_RENDERER_MIGRATION_MANIFEST,
  isSynthRendererApproved,
  isSynthRendererMigrationRecordApproved,
  type SynthRendererMigrationRecord,
} from './synth-renderer-migration';

describe('per-preset synth renderer migration manifest', () => {
  it('covers the entire published native preset registry', () => {
    expect([...PUBLISHED_NATIVE_SYNTH_PRESETS].sort()).toEqual(Object.keys(SYNTH_PRESETS).sort());
    expect(Object.keys(SYNTH_RENDERER_MIGRATION_MANIFEST).sort()).toEqual(Object.keys(SYNTH_PRESETS).sort());
  });

  it('fails closed while any T3 evidence is absent', () => {
    for (const preset of Object.keys(SYNTH_PRESETS)) {
      expect(isSynthRendererApproved(preset)).toBe(false);
    }
    expect(isSynthRendererApproved('unknown')).toBe(false);
  });

  it('requires commit-bound artifacts and two distinct listening reviewers', () => {
    const artifact = {
      path: 'artifacts/renderer/pad.json',
      sha256: 'a'.repeat(64),
      subjectCommit: 'b'.repeat(40),
    };
    const candidate: SynthRendererMigrationRecord = {
      renderer: 'advanced', cohort: 'canary-1', pcm: 'approved',
      pcmReport: artifact, approvalRevision: 'b'.repeat(40),
      listeningApprovals: [
        { reviewer: 'reviewer-a', decision: 'approved', evidence: artifact },
        { reviewer: 'reviewer-a', decision: 'approved', evidence: artifact },
      ],
      canaryTelemetry: artifact,
      rollbackVerified: true,
    };
    expect(isSynthRendererMigrationRecordApproved(candidate)).toBe(false);
    expect(isSynthRendererMigrationRecordApproved({
      ...candidate,
      listeningApprovals: [
        candidate.listeningApprovals[0]!,
        { reviewer: 'reviewer-b', decision: 'approved', evidence: artifact },
      ],
    })).toBe(true);
  });
});
