import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import fc from 'fast-check';
import { afterEach, describe, expect, it } from 'vitest';

import { fixtureWavBytes } from './sample-pipeline-test-fixtures';

import {
  importSfzMappings,
  parseSampleRecipe,
  planSampleBuild,
  verifyRecipeSources,
  type ParsedSampleRecipe,
} from '../scripts/sample-pipeline-core';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function validRecipe(): unknown {
  return {
    version: 1,
    instrument: {
      id: 'test-piano',
      name: 'Test Piano',
      releaseTime: 0.5,
      playableRange: { min: 48, max: 72 },
      velocityCrossfade: 8,
      credits: {
        source: 'Test fixture',
        url: 'https://example.com/test-fixture',
        license: 'Test-only fixture',
      },
    },
    sourceRevision: 'fixture-v1',
    sources: [
      {
        id: 'c4-soft',
        path: 'piano/C4-soft.wav',
        sha256: 'a'.repeat(64),
      },
      {
        id: 'c4-loud',
        path: 'piano/C4-loud.wav',
        sha256: 'b'.repeat(64),
      },
    ],
    mapping: {
      mode: 'explicit',
      samples: [
        {
          sourceId: 'c4-soft',
          output: 'C4-soft.m4a',
          rootMidi: 60,
          velocity: { min: 0, max: 63 },
          processing: { trimStartSec: 0.01, fadeOutSec: 0.1 },
          playback: { gainDb: -2, tuneCents: -4 },
        },
        {
          sourceId: 'c4-loud',
          output: 'C4-loud.m4a',
          rootMidi: 60,
          velocity: { min: 64, max: 127 },
        },
      ],
    },
    delivery: {
      codec: 'aac',
      container: 'm4a',
      sampleRate: 44100,
      channels: { mode: 'preserve' },
      bitrateKbps: 160,
    },
    leveling: { mode: 'preserve-source' },
    evidence: {
      sampleLabSourceId: 'vcsl',
      currentInstrumentDir: 'public/instruments/piano',
      anchors: [
        {
          id: 'low',
          targetMidi: 48,
          currentFile: 'C3-ff.mp3',
          currentRootMidi: 48,
          candidateOutput: 'C4-loud.m4a',
          candidateRootMidi: 60,
          velocity: 110,
        },
        {
          id: 'middle',
          targetMidi: 60,
          currentFile: 'C4-ff.mp3',
          currentRootMidi: 60,
          candidateOutput: 'C4-loud.m4a',
          candidateRootMidi: 60,
          velocity: 110,
        },
        {
          id: 'high',
          targetMidi: 72,
          currentFile: 'C5-ff.mp3',
          currentRootMidi: 72,
          candidateOutput: 'C4-loud.m4a',
          candidateRootMidi: 60,
          velocity: 110,
        },
      ],
    },
  };
}

function parseValidRecipe(): ParsedSampleRecipe {
  const parsed = parseSampleRecipe(validRecipe());
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  return parsed.value;
}

describe('sample recipe trust boundary (stage 1)', () => {
  it('parses a complete recipe into a typed parsed state', () => {
    const parsed = parseSampleRecipe(validRecipe());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.state).toBe('parsed');
    expect(parsed.value.recipe.instrument.id).toBe('test-piano');
    expect(parsed.value.recipe.delivery.channels).toEqual({ mode: 'preserve' });
    expect(parsed.value.recipe.mapping.samples).toHaveLength(2);
  });

  it('reports all malformed boundary fields instead of silently defaulting', () => {
    const input = validRecipe() as Record<string, unknown>;
    const sources = input.sources as Array<Record<string, unknown>>;
    sources[0].path = '../escape.wav';
    sources[0].sha256 = 'not-a-hash';
    sources[1].id = sources[0].id;
    const mapping = input.mapping as { samples: Array<Record<string, unknown>> };
    mapping.samples[0].rootMidi = 128;
    mapping.samples[1].output = mapping.samples[0].output;
    delete input.delivery;

    const parsed = parseSampleRecipe(input);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join('\n')).toContain('sources[0].path');
    expect(parsed.errors.join('\n')).toContain('sources[0].sha256');
    expect(parsed.errors.join('\n')).toContain('duplicate source id');
    expect(parsed.errors.join('\n')).toContain('rootMidi');
    expect(parsed.errors.join('\n')).toContain('output path collision');
    expect(parsed.errors.join('\n')).toContain('delivery must be an object');
  });

  it('rejects lossy masters and velocity gaps at construction time', () => {
    const input = validRecipe() as Record<string, unknown>;
    const sources = input.sources as Array<Record<string, unknown>>;
    sources[0].path = 'piano/C4-soft.mp3';
    const mapping = input.mapping as { samples: Array<Record<string, unknown>> };
    mapping.samples[0].velocity = { min: 0, max: 40 };

    const parsed = parseSampleRecipe(input);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors.join('\n')).toContain('lossless WAV, FLAC, or AIFF');
    expect(parsed.errors.join('\n')).toContain('velocity coverage');
  });

  it('requires complete attribution and change metadata for CC BY delivery recipes', () => {
    const input = validRecipe() as { instrument: { credits: Record<string, unknown> } };
    input.instrument.credits.license = 'CC BY 4.0';
    const missing = parseSampleRecipe(input);
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.errors.join('\n')).toContain('credits.attribution is required');
      expect(missing.errors.join('\n')).toContain('credits.licenseUrl is required');
      expect(missing.errors.join('\n')).toContain('credits.changes is required');
    }

    input.instrument.credits.attribution = 'Samples by Test Creator.';
    input.instrument.credits.licenseUrl = 'https://creativecommons.org/licenses/by/4.0/';
    input.instrument.credits.changes = 'Mapped and encoded once.';
    expect(parseSampleRecipe(input).ok).toBe(true);
  });

  it('rejects unknown fields at every recipe trust boundary', () => {
    const input = validRecipe() as Record<string, unknown>;
    input.typo = true;
    (input.instrument as Record<string, unknown>).releaseSeconds = 1;
    ((input.sources as Array<Record<string, unknown>>)[0]).digest = 'ignored';
    const parsed = parseSampleRecipe(input);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toEqual(expect.arrayContaining([
      'recipe.typo is not a recognized field',
      'instrument.releaseSeconds is not a recognized field',
      'sources[0].digest is not a recognized field',
    ]));
  });

  it('never throws for arbitrary JSON-like input', () => {
    fc.assert(fc.property(fc.jsonValue(), input => {
      expect(() => parseSampleRecipe(input)).not.toThrow();
      const parsed = parseSampleRecipe(input);
      if (parsed.ok) {
        for (const source of parsed.value.recipe.sources) {
          expect(path.isAbsolute(source.path)).toBe(false);
          expect(source.path.split('/')).not.toContain('..');
          expect(source.sha256).toMatch(/^[a-f0-9]{64}$/);
        }
        for (const sample of parsed.value.recipe.mapping.samples) {
          expect(sample.rootMidi).toBeGreaterThanOrEqual(0);
          expect(sample.rootMidi).toBeLessThanOrEqual(127);
          expect(sample.velocity.min).toBeGreaterThanOrEqual(0);
          expect(sample.velocity.max).toBeLessThanOrEqual(127);
        }
      }
    }), { numRuns: 300 });
  });
});

describe('explicit and SFZ mapping identity (stage 4)', () => {
  it('imports root, velocity, and deterministic sequence opcodes without filename inference', () => {
    const recipe = parseValidRecipe().recipe;
    const imported = importSfzMappings({
      regions: [
        { sample: 'piano/C4-soft.wav', rootMidi: 60, loKey: 54, hiKey: 60, loVel: 0, hiVel: 63, sequencePosition: 1, sequenceLength: 1 },
        { sample: 'piano/C4-loud.wav', rootMidi: 60, loKey: 61, hiKey: 66, loVel: 64, hiVel: 127 },
      ],
      sources: recipe.sources,
      container: 'm4a',
      articulation: 'sustain',
    });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.mappings).toEqual([
      expect.objectContaining({ sourceId: 'c4-soft', output: 'c4-soft.m4a', rootMidi: 60, velocity: { min: 0, max: 63 }, roundRobin: { group: 'sustain-60-0-63', index: 0, count: 1 } }),
      expect.objectContaining({ sourceId: 'c4-loud', output: 'c4-loud.m4a', rootMidi: 60, velocity: { min: 64, max: 127 } }),
    ]);
    expect(imported.warnings).toHaveLength(2);
  });

  it('fails closed on incomplete deterministic sequence groups', () => {
    const recipe = parseValidRecipe().recipe;
    const imported = importSfzMappings({
      regions: [
        { sample: 'piano/C4-soft.wav', rootMidi: 60, loVel: 0, hiVel: 63, sequencePosition: 1, sequenceLength: 2 },
        { sample: 'piano/C4-loud.wav', rootMidi: 60, loVel: 64, hiVel: 127 },
      ],
      sources: recipe.sources,
      container: 'm4a',
      articulation: 'sustain',
    });
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.errors.join('\n')).toContain('must contain each seq_position 1..2 exactly once');
  });

  it('fails closed on SFZ random ranges and samples absent from the hashed source list', () => {
    const imported = importSfzMappings({
      regions: [
        { sample: 'unknown.wav', rootMidi: 60, loVel: 0, hiVel: 127 },
        { sample: 'piano/C4-soft.wav', rootMidi: 60, loVel: 0, hiVel: 127, randomLow: 0, randomHigh: 0.5 },
      ],
      sources: parseValidRecipe().recipe.sources,
      container: 'm4a',
      articulation: 'sustain',
    });
    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.errors.join('\n')).toContain('not in the immutable source list');
    expect(imported.errors.join('\n')).toContain('random ranges');
  });
});

describe('immutable source verification and planning (stages 1-4)', () => {
  it('binds a parsed recipe to exact source bytes before planning', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-pipeline-'));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, 'piano'));
    const soft = fixtureWavBytes();
    const loud = Buffer.from(soft);
    loud[loud.length - 1] ^= 0x01;
    fs.writeFileSync(path.join(root, 'piano/C4-soft.wav'), soft);
    fs.writeFileSync(path.join(root, 'piano/C4-loud.wav'), loud);

    const raw = validRecipe() as Record<string, unknown>;
    const sources = raw.sources as Array<Record<string, unknown>>;
    sources[0].sha256 = createHash('sha256').update(soft).digest('hex');
    sources[1].sha256 = createHash('sha256').update(loud).digest('hex');
    const parsed = parseSampleRecipe(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const verified = await verifyRecipeSources(parsed.value, root);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    expect(verified.value.state).toBe('verified');
    expect(verified.value.sources.map(source => source.actualSha256)).toEqual([
      sources[0].sha256,
      sources[1].sha256,
    ]);

    const plan = planSampleBuild(verified.value, '/tmp/candidate-output');
    expect(plan.state).toBe('planned');
    expect(plan.renders).toHaveLength(2);
    expect(plan.renders.every(render => render.command === 'ffmpeg')).toBe(true);
    expect(plan.renders.map(render => render.outputPath)).toEqual([
      '/tmp/candidate-output/C4-soft.m4a',
      '/tmp/candidate-output/C4-loud.m4a',
    ]);
    expect(plan.manifest.samples[0]).toMatchObject({
      note: 60,
      file: 'C4-soft.m4a',
      velocityMin: 0,
      velocityMax: 63,
      gainDb: -2,
      tuneCents: -4,
    });
  });

  it('rejects symlinked masters even when their target is inside the source root', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-pipeline-'));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, 'piano'));
    const bytes = fixtureWavBytes();
    fs.writeFileSync(path.join(root, 'actual.wav'), bytes);
    fs.symlinkSync(path.join(root, 'actual.wav'), path.join(root, 'piano/C4-soft.wav'));
    fs.writeFileSync(path.join(root, 'piano/C4-loud.wav'), bytes);
    const raw = validRecipe() as Record<string, unknown>;
    const sources = raw.sources as Array<Record<string, unknown>>;
    const sha = createHash('sha256').update(bytes).digest('hex');
    sources[0].sha256 = sha;
    sources[1].sha256 = sha;
    const parsed = parseSampleRecipe(raw);
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));

    const verified = await verifyRecipeSources(parsed.value, root);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors.join('\n')).toContain('symbolic-link masters are not allowed');
  });

  it('fails verification after any source byte changes', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-pipeline-'));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, 'piano'));
    const changed = fixtureWavBytes();
    changed[changed.length - 1] ^= 0x01;
    fs.writeFileSync(path.join(root, 'piano/C4-soft.wav'), changed);
    fs.writeFileSync(path.join(root, 'piano/C4-loud.wav'), changed);

    const verified = await verifyRecipeSources(parseValidRecipe(), root);
    expect(verified.ok).toBe(false);
    if (verified.ok) return;
    expect(verified.errors).toHaveLength(2);
    expect(verified.errors.every(error => error.includes('SHA-256 mismatch'))).toBe(true);
  });

  it('applies one uniform render gain to a group instead of normalizing layers independently', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-pipeline-'));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, 'piano'));
    const bytes = fixtureWavBytes();
    for (const name of ['C4-soft.wav', 'C4-loud.wav']) fs.writeFileSync(path.join(root, 'piano', name), bytes);
    const raw = validRecipe() as Record<string, unknown>;
    raw.leveling = {
      mode: 'group-relative',
      anchorSourceId: 'c4-loud',
      measuredPeakDb: -1,
      ceilingDb: -4,
      deliveryCeilingDb: -1,
      groupGainDb: -3,
    };
    const sources = raw.sources as Array<Record<string, unknown>>;
    const sha = createHash('sha256').update(bytes).digest('hex');
    for (const source of sources) source.sha256 = sha;
    const parsed = parseSampleRecipe(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const verified = await verifyRecipeSources(parsed.value, root);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const plan = planSampleBuild(verified.value, '/tmp/candidate-output');
    expect(plan.renders).toHaveLength(2);
    for (const render of plan.renders) {
      expect(render.args.join(' ')).toContain('volume=-3dB');
    }
  });

  it('requires an explicit render policy for objective DC-offset remediation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-pipeline-'));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, 'piano'));
    const bytes = fixtureWavBytes();
    for (const name of ['C4-soft.wav', 'C4-loud.wav']) fs.writeFileSync(path.join(root, 'piano', name), bytes);
    const raw = validRecipe() as Record<string, unknown>;
    const sources = raw.sources as Array<Record<string, unknown>>;
    const sha = createHash('sha256').update(bytes).digest('hex');
    for (const source of sources) source.sha256 = sha;
    const mappings = (raw.mapping as { samples: Array<Record<string, unknown>> }).samples;
    for (const mapping of mappings) mapping.processing = { removeDc: true };

    const parsed = parseSampleRecipe(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const verified = await verifyRecipeSources(parsed.value, root);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;
    const plan = planSampleBuild(verified.value, '/tmp/candidate-output');
    expect(plan.renders.every(render => render.args.join(' ').includes('highpass=f=10'))).toBe(true);
  });

  it('emits explicit channel and delivery policy without an accidental downmix', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-pipeline-'));
    temporaryDirectories.push(root);
    fs.mkdirSync(path.join(root, 'piano'));
    const bytes = fixtureWavBytes();
    for (const name of ['C4-soft.wav', 'C4-loud.wav']) {
      fs.writeFileSync(path.join(root, 'piano', name), bytes);
    }
    const raw = validRecipe() as Record<string, unknown>;
    const sources = raw.sources as Array<Record<string, unknown>>;
    const sha = createHash('sha256').update(bytes).digest('hex');
    for (const source of sources) source.sha256 = sha;
    const parsed = parseSampleRecipe(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const verified = await verifyRecipeSources(parsed.value, root);
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const plan = planSampleBuild(verified.value, '/tmp/candidate-output');
    for (const render of plan.renders) {
      expect(render.args).not.toContain('-ac');
      expect(render.args).toEqual(expect.arrayContaining(['-ar', '44100', '-c:a', 'aac', '-b:a', '160k']));
      expect(render.args.filter(arg => arg === '-i')).toHaveLength(1);
      expect(render.args.join(' ')).not.toContain('atrim:');
    }
    expect(plan.renders.some(render => render.args.join(' ').includes('atrim=start=0.01'))).toBe(true);
  });
});
