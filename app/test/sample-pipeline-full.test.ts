import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { captureCandidateBaseline } from '../scripts/sample-pipeline-baseline';
import { runFullPipeline, type FullPipelineDependencies } from '../scripts/sample-pipeline-cli';
import type { ProcessResult, ProcessRunner } from '../scripts/sample-pipeline-runner';

const outputRoot = path.resolve('public/__sample-pipeline/sample-pipeline-fixture/candidate');

class LosslessFixtureEncoder implements ProcessRunner {
  readonly calls: Array<{ command: string; args: string[] }> = [];

  async run(command: string, args: string[]): Promise<ProcessResult> {
    this.calls.push({ command, args });
    const source = args[args.indexOf('-i') + 1];
    const output = args.at(-1)!;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(source, output);
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

afterEach(() => {
  fs.rmSync(path.resolve('public/__sample-pipeline/sample-pipeline-fixture'), { recursive: true, force: true });
  fs.rmSync(path.resolve('public/__sample-pipeline-fixtures'), { recursive: true, force: true });
  fs.rmSync(path.resolve('sample-pipeline/decisions/sample-pipeline-fixture.json'), { force: true });
  fs.rmSync(path.resolve('sample-pipeline/recipes/sample-pipeline-fixture.json'), { force: true });
});

describe('replacement full command end-to-end fixture', () => {
  it('verifies, renders, audits, compares, and builds blinded audio evidence without touching production', async () => {
    const encoder = new LosslessFixtureEncoder();
    const currentRoot = path.resolve('public/__sample-pipeline-fixtures/current');
    fs.mkdirSync(currentRoot, { recursive: true });
    fs.copyFileSync('test/fixtures/sample-pipeline/current/C4.wav', path.join(currentRoot, 'C4.wav'));
    fs.copyFileSync('test/fixtures/sample-pipeline/current/manifest.json', path.join(currentRoot, 'manifest.json'));
    const browserDecode: FullPipelineDependencies['browserDecode'] = async manifest => ({
      version: 1,
      chromium: true,
      webkit: true,
      entries: manifest.samples.flatMap(sample => [
        { browser: 'chromium' as const, file: sample.file, ok: true, durationSec: 0.25, channels: 1, sampleRate: 44100, peak: 0.25, energy: 0.1 },
        { browser: 'webkit' as const, file: sample.file, ok: true, durationSec: 0.25, channels: 1, sampleRate: 44100, peak: 0.25, energy: 0.1 },
      ]),
    });

    const result = await runFullPipeline({
      command: 'full',
      recipePath: 'test/fixtures/sample-pipeline/recipe.json',
      sourceRoot: 'test/fixtures/sample-pipeline',
      output: 'public/__sample-pipeline/sample-pipeline-fixture/candidate',
      dryRun: false,
      promote: false,
    }, {
      processRunner: encoder,
      browserDecode,
      now: () => new Date('2026-07-10T10:00:00.000Z'),
      log: () => undefined,
    });

    expect(result.state).toBe('decision-ready');
    expect(encoder.calls).toHaveLength(1);
    expect(fs.existsSync(path.join(outputRoot, 'C4.wav'))).toBe(true);
    expect(fs.existsSync(path.join(outputRoot, 'manifest.json'))).toBe(true);
    const pipelineRoot = path.dirname(outputRoot);
    expect(fs.existsSync(path.join(pipelineRoot, 'reports/before-after.json'))).toBe(true);
    expect(fs.existsSync(path.join(pipelineRoot, 'reports/objective-audit.json'))).toBe(true);
    expect(fs.existsSync(path.join(pipelineRoot, 'reports/browser-decode.json'))).toBe(true);
    expect(fs.existsSync(path.join(pipelineRoot, 'reports/runtime-contract.json'))).toBe(true);
    expect(fs.existsSync(path.join(pipelineRoot, 'lab/catalog.json'))).toBe(true);
    expect(fs.existsSync(path.join(pipelineRoot, 'sample-lab.html'))).toBe(true);
    expect(fs.existsSync(path.join(pipelineRoot, 'runtime-listening.html'))).toBe(true);
    const template = JSON.parse(fs.readFileSync(path.join(pipelineRoot, 'listening-decision.template.json'), 'utf8'));
    expect(template).toMatchObject({
      candidateId: 'sample-pipeline-fixture',
      anchorsReviewed: ['low', 'mid', 'high'],
      pitchSpanSemitones: 24,
    });
    expect(template.outputHashes).toHaveLength(1);
    expect(fs.existsSync('public/instruments/sample-pipeline-fixture')).toBe(false);

    fs.copyFileSync('test/fixtures/sample-pipeline/recipe.json', 'sample-pipeline/recipes/sample-pipeline-fixture.json');
    expect(captureCandidateBaseline('sample-pipeline-fixture')).toMatchObject({ status: 'decision-ready' });
    const browserPath = path.join(pipelineRoot, 'reports/browser-decode.json');
    const browserReport = JSON.parse(fs.readFileSync(browserPath, 'utf8'));
    browserReport.webkit = false;
    fs.writeFileSync(browserPath, JSON.stringify(browserReport));
    expect(() => captureCandidateBaseline('sample-pipeline-fixture')).toThrow('Chromium and WebKit summary gates must both pass');
    browserReport.webkit = true;
    fs.writeFileSync(browserPath, `${JSON.stringify(browserReport, null, 2)}\n`);

    const dispositions = template.reviewDispositions as Record<string, string>;
    for (const finding of Object.keys(dispositions)) dispositions[finding] = 'Reviewed against the exact candidate; acceptable fixture behavior.';
    Object.assign(template, {
      decision: 'accepted',
      reviewer: 'Pipeline Contract Reviewer',
      reviewedAt: '2026-07-10T11:00:00.000Z',
      notes: 'Exact-hash fixture comparison accepted for the promotion transaction contract.',
    });
    const decisionPath = path.join(pipelineRoot, 'accepted-decision.json');
    fs.writeFileSync(decisionPath, JSON.stringify(template));
    const promoted = await runFullPipeline({
      command: 'full',
      recipePath: 'test/fixtures/sample-pipeline/recipe.json',
      sourceRoot: 'test/fixtures/sample-pipeline',
      output: 'public/__sample-pipeline/sample-pipeline-fixture/candidate',
      dryRun: false,
      promote: true,
      decisionPath,
    }, {
      processRunner: encoder,
      browserDecode,
      now: () => new Date('2026-07-10T11:00:00.000Z'),
      log: () => undefined,
    });
    expect(promoted.state).toBe('promoted');
    expect(encoder.calls).toHaveLength(1);
    expect(fs.existsSync(path.join(currentRoot, 'build-report.json'))).toBe(true);
    expect(fs.existsSync('sample-pipeline/decisions/sample-pipeline-fixture.json')).toBe(true);
  });
});
