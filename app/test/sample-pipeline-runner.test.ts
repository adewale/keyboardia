import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseSampleRecipe, planSampleBuild, verifyRecipeSources } from '../scripts/sample-pipeline-core';
import { fixtureWavBytes } from './sample-pipeline-test-fixtures';
import {
  executePlannedBuild,
  loadRenderedBuild,
  type ProcessResult,
  type ProcessRunner,
} from '../scripts/sample-pipeline-runner';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

class RecordingEncoder implements ProcessRunner {
  readonly calls: Array<{ command: string; args: string[] }> = [];
  failOnCall: number | null = null;

  async run(command: string, args: string[]): Promise<ProcessResult> {
    this.calls.push({ command, args });
    if (this.failOnCall === this.calls.length) {
      return { exitCode: 1, stdout: '', stderr: 'injected encode failure' };
    }
    const output = args.at(-1)!;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `encoded:${path.basename(output)}`);
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

async function plannedBuild(outputRoot: string) {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-pipeline-source-'));
  temporaryDirectories.push(sourceRoot);
  fs.mkdirSync(path.join(sourceRoot, 'piano'));
  const soft = fixtureWavBytes();
  const loud = Buffer.from(soft);
  loud[loud.length - 1] ^= 0x01;
  fs.writeFileSync(path.join(sourceRoot, 'piano/C4-soft.wav'), soft);
  fs.writeFileSync(path.join(sourceRoot, 'piano/C4-loud.wav'), loud);
  const raw = {
    version: 1,
    instrument: {
      id: 'test-piano',
      name: 'Test Piano',
      releaseTime: 0.5,
      playableRange: { min: 48, max: 72 },
      credits: { source: 'Fixture', url: 'https://example.com', license: 'Fixture' },
    },
    sourceRevision: 'fixture-v1',
    sources: [
      { id: 'soft', path: 'piano/C4-soft.wav', sha256: createHash('sha256').update(soft).digest('hex') },
      { id: 'loud', path: 'piano/C4-loud.wav', sha256: createHash('sha256').update(loud).digest('hex') },
    ],
    mapping: {
      mode: 'explicit',
      samples: [
        { sourceId: 'soft', output: 'C4-soft.m4a', rootMidi: 60, velocity: { min: 0, max: 63 } },
        { sourceId: 'loud', output: 'C4-loud.m4a', rootMidi: 60, velocity: { min: 64, max: 127 } },
      ],
    },
    delivery: { codec: 'aac', container: 'm4a', sampleRate: 44100, channels: { mode: 'preserve' }, bitrateKbps: 160 },
    leveling: { mode: 'preserve-source' },
    evidence: {
      sampleLabSourceId: 'vcsl',
      currentInstrumentDir: 'public/instruments/piano',
      anchors: [
        { id: 'low', targetMidi: 48, currentFile: 'C3-ff.mp3', currentRootMidi: 48, candidateOutput: 'C4-loud.m4a', candidateRootMidi: 60 },
        { id: 'mid', targetMidi: 60, currentFile: 'C4-ff.mp3', currentRootMidi: 60, candidateOutput: 'C4-loud.m4a', candidateRootMidi: 60 },
        { id: 'high', targetMidi: 72, currentFile: 'C5-ff.mp3', currentRootMidi: 72, candidateOutput: 'C4-loud.m4a', candidateRootMidi: 60 },
      ],
    },
  };
  const parsed = parseSampleRecipe(raw);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  const verified = await verifyRecipeSources(parsed.value, sourceRoot);
  if (!verified.ok) throw new Error(verified.errors.join('\n'));
  return planSampleBuild(verified.value, outputRoot);
}

describe('atomic one-generation rendering (stage 2)', () => {
  it('encodes each declared master exactly once and writes a hash-bound report', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-pipeline-output-'));
    temporaryDirectories.push(parent);
    const outputRoot = path.join(parent, 'candidate');
    const plan = await plannedBuild(outputRoot);
    const runner = new RecordingEncoder();

    const rendered = await executePlannedBuild(plan, runner, { buildId: 'deterministic-build' });

    expect(rendered.state).toBe('rendered');
    expect(runner.calls).toHaveLength(2);
    expect(runner.calls.every(call => call.command === 'ffmpeg')).toBe(true);
    expect(runner.calls.every(call => call.args.filter(arg => arg === '-i').length === 1)).toBe(true);
    expect(fs.existsSync(path.join(outputRoot, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(outputRoot, 'build-report.json'))).toBe(true);
    expect(rendered.outputs).toHaveLength(2);
    expect(rendered.outputs.every(output => /^[a-f0-9]{64}$/.test(output.sha256))).toBe(true);
    expect(rendered.report.sourceRevision).toBe('fixture-v1');
    expect(rendered.report.outputs.map(output => output.file)).toEqual(['C4-soft.m4a', 'C4-loud.m4a']);
  });

  it('rehashes masters immediately before encoding to close verification/render TOCTOU', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-pipeline-output-'));
    temporaryDirectories.push(parent);
    const outputRoot = path.join(parent, 'candidate');
    const plan = await plannedBuild(outputRoot);
    const source = plan.verified.sources[0].absolutePath;
    const changed = fs.readFileSync(source);
    changed[changed.length - 1] ^= 0x01;
    fs.writeFileSync(source, changed);
    const runner = new RecordingEncoder();

    await expect(executePlannedBuild(plan, runner, { buildId: 'toctou-build' }))
      .rejects.toThrow('source changed after verification');
    expect(runner.calls).toHaveLength(0);
    expect(fs.existsSync(outputRoot)).toBe(false);
  });

  it('removes staging output and leaves no candidate when any encode fails', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-pipeline-output-'));
    temporaryDirectories.push(parent);
    const outputRoot = path.join(parent, 'candidate');
    const plan = await plannedBuild(outputRoot);
    const runner = new RecordingEncoder();
    runner.failOnCall = 2;

    await expect(executePlannedBuild(plan, runner, { buildId: 'failed-build' }))
      .rejects.toThrow('injected encode failure');

    expect(fs.existsSync(outputRoot)).toBe(false);
    expect(fs.readdirSync(parent).filter(name => name.includes('failed-build'))).toEqual([]);
  });

  it('refuses to reopen a candidate whose exact output bytes changed after audit', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-pipeline-output-'));
    temporaryDirectories.push(parent);
    const outputRoot = path.join(parent, 'candidate');
    const plan = await plannedBuild(outputRoot);
    await executePlannedBuild(plan, new RecordingEncoder(), { buildId: 'tamper-build' });
    fs.appendFileSync(path.join(outputRoot, 'C4-soft.m4a'), 'tampered');
    expect(() => loadRenderedBuild(plan)).toThrow('output hash mismatch');
  });

  it('refuses to overwrite an existing candidate directory', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-pipeline-output-'));
    temporaryDirectories.push(parent);
    const outputRoot = path.join(parent, 'candidate');
    fs.mkdirSync(outputRoot);
    fs.writeFileSync(path.join(outputRoot, 'keep.txt'), 'must survive');
    const plan = await plannedBuild(outputRoot);

    await expect(executePlannedBuild(plan, new RecordingEncoder(), { buildId: 'collision' }))
      .rejects.toThrow('already exists');
    expect(fs.readFileSync(path.join(outputRoot, 'keep.txt'), 'utf8')).toBe('must survive');
  });
});
