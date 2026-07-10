import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import type {
  InstrumentManifestPlan,
  PlannedSampleBuild,
  RelativeOutputPath,
  Sha256,
} from './sample-pipeline-core';

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface AudioStreamInfo {
  codec: string;
  sampleRate: number;
  channels: number;
  durationSec: number;
}

export interface ProcessRunner {
  run(command: string, args: string[]): Promise<ProcessResult>;
  fingerprint?(command: string): Promise<string>;
  probeAudio?(filename: string): Promise<AudioStreamInfo>;
}

export class SpawnProcessRunner implements ProcessRunner {
  async probeAudio(filename: string): Promise<AudioStreamInfo> {
    const result = await this.run('ffprobe', [
      '-v', 'error', '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,sample_rate,channels,duration',
      '-of', 'json', filename,
    ]);
    if (result.exitCode !== 0) throw new Error(`ffprobe failed for ${filename}: ${result.stderr.trim()}`);
    const parsed = JSON.parse(result.stdout) as { streams?: Array<Record<string, unknown>> };
    const stream = parsed.streams?.[0];
    const sampleRate = Number(stream?.sample_rate);
    const channels = Number(stream?.channels);
    const durationSec = Number(stream?.duration);
    if (!stream || typeof stream.codec_name !== 'string' || !Number.isFinite(sampleRate) || !Number.isFinite(channels)) {
      throw new Error(`ffprobe returned no valid audio stream for ${filename}`);
    }
    return {
      codec: stream.codec_name,
      sampleRate,
      channels,
      durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    };
  }

  async fingerprint(command: string): Promise<string> {
    const result = await this.run(command, ['-version']);
    if (result.exitCode !== 0) throw new Error(`could not fingerprint ${command}: ${result.stderr.trim()}`);
    return result.stdout.split('\n')[0]?.trim() || `${command}:unknown-version`;
  }

  run(command: string, args: string[]): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', code => resolve({ exitCode: code ?? 1, stdout, stderr }));
    });
  }
}

export interface RenderedOutput {
  file: RelativeOutputPath;
  sha256: Sha256;
  sizeBytes: number;
}

export interface SampleBuildReport {
  version: 1;
  buildId: string;
  generatedAt: string;
  recipeSha256: Sha256;
  sourceRevision: string;
  sources: Array<{ id: string; path: string; sha256: Sha256; sizeBytes: number }>;
  outputs: RenderedOutput[];
  delivery: PlannedSampleBuild['verified']['recipe']['delivery'];
  toolchain: { encoder: string; fingerprint: string; node: string };
  measurements?: Array<{ file: string; source: AudioStreamInfo; delivery: AudioStreamInfo }>;
  manifestSha256: Sha256;
}

export interface RenderedSampleBuild {
  readonly state: 'rendered';
  readonly plan: PlannedSampleBuild;
  readonly manifest: InstrumentManifestPlan;
  readonly outputs: RenderedOutput[];
  readonly report: SampleBuildReport;
}

export interface ExecuteBuildOptions {
  buildId?: string;
  now?: () => Date;
}

function sha256Bytes(bytes: Buffer | string): Sha256 {
  return createHash('sha256').update(bytes).digest('hex') as Sha256;
}

function sha256File(filename: string): Sha256 {
  return sha256Bytes(fs.readFileSync(filename));
}

function stableRecipeJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableRecipeJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableRecipeJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function stagingRootFor(outputRoot: string, buildId: string): string {
  return path.join(path.dirname(outputRoot), `.${path.basename(outputRoot)}.${buildId}.tmp`);
}

function replaceRenderPaths(args: string[], inputPath: string, outputPath: string): string[] {
  if (args.length === 0) throw new Error('render command has no output argument');
  const inputIndex = args.indexOf('-i');
  if (inputIndex < 0 || inputIndex + 1 >= args.length) throw new Error('render command has no input argument');
  const replaced = [...args];
  replaced[inputIndex + 1] = inputPath;
  replaced[replaced.length - 1] = outputPath;
  return replaced;
}

function writeJson(filename: string, value: unknown): string {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, content, { flag: 'wx' });
  return content;
}

function syncFile(filename: string): void {
  const fd = fs.openSync(filename, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function syncDirectory(directory: string): void {
  const fd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Render a verified plan into a fresh candidate directory.
 *
 * The candidate is built under a sibling staging path and atomically renamed
 * only after every declared output, manifest, and hash-bound report exists.
 * Production overwrite is intentionally not an option on this API.
 */
export function loadRenderedBuild(plan: PlannedSampleBuild): RenderedSampleBuild {
  const outputRoot = plan.outputRoot;
  const manifestPath = path.join(outputRoot, 'manifest.json');
  const reportPath = path.join(outputRoot, 'build-report.json');
  if (!fs.statSync(outputRoot).isDirectory()) throw new Error(`candidate output is not a directory: ${outputRoot}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as InstrumentManifestPlan;
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8')) as SampleBuildReport;
  const expectedRecipeHash = sha256Bytes(stableRecipeJson(plan.verified.recipe));
  if (report.version !== 1 || report.recipeSha256 !== expectedRecipeHash) {
    throw new Error('existing candidate build report does not match the parsed recipe');
  }
  if (report.sourceRevision !== plan.verified.recipe.sourceRevision
      || stableRecipeJson(report.delivery) !== stableRecipeJson(plan.verified.recipe.delivery)) {
    throw new Error('existing candidate build policy does not match the parsed recipe');
  }
  const expectedSources = plan.verified.sources.map(source => ({
    id: source.id,
    path: source.path,
    sha256: source.actualSha256,
    sizeBytes: source.sizeBytes,
  }));
  if (stableRecipeJson(report.sources) !== stableRecipeJson(expectedSources)) {
    throw new Error('existing candidate source evidence is stale');
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  if (sha256Bytes(manifestBytes) !== report.manifestSha256
      || stableRecipeJson(manifest) !== stableRecipeJson(plan.manifest)) {
    throw new Error('existing candidate manifest does not match its build report or recipe');
  }
  const expectedFiles = plan.renders.map(render => render.outputFile).sort();
  const reportedFiles = report.outputs.map(output => output.file).sort();
  if (stableRecipeJson(expectedFiles) !== stableRecipeJson(reportedFiles)) {
    throw new Error('existing candidate output set does not match the render plan');
  }
  for (const output of report.outputs) {
    const filename = path.join(outputRoot, ...output.file.split('/'));
    const stat = fs.statSync(filename);
    if (!stat.isFile() || stat.size !== output.sizeBytes || sha256File(filename) !== output.sha256) {
      throw new Error(`existing candidate output hash mismatch: ${output.file}`);
    }
  }
  return { state: 'rendered', plan, manifest, outputs: report.outputs, report };
}

export async function executePlannedBuild(
  plan: PlannedSampleBuild,
  runner: ProcessRunner = new SpawnProcessRunner(),
  options: ExecuteBuildOptions = {}
): Promise<RenderedSampleBuild> {
  const outputRoot = plan.outputRoot;
  if (fs.existsSync(outputRoot)) throw new Error(`candidate output already exists: ${outputRoot}`);
  const buildId = options.buildId ?? randomUUID();
  if (!/^[a-zA-Z0-9._-]+$/.test(buildId)) throw new Error('buildId contains unsafe path characters');
  const stagingRoot = stagingRootFor(outputRoot, buildId);
  if (fs.existsSync(stagingRoot)) throw new Error(`staging output already exists: ${stagingRoot}`);
  fs.mkdirSync(path.dirname(stagingRoot), { recursive: true });
  fs.mkdirSync(stagingRoot, { recursive: false });

  try {
    const outputs: RenderedOutput[] = [];
    const measurements: NonNullable<SampleBuildReport['measurements']> = [];
    const encoder = plan.renders[0]?.command ?? 'ffmpeg';
    const encoderFingerprint = runner.fingerprint
      ? await runner.fingerprint(encoder)
      : `${encoder}:custom-process-runner`;
    for (const render of plan.renders) {
      const source = plan.verified.sources.find(candidate => candidate.absolutePath === render.sourcePath);
      if (!source) throw new Error(`render source is not verified: ${render.sourcePath}`);
      const currentSourceHash = sha256File(render.sourcePath);
      if (currentSourceHash !== source.actualSha256) {
        throw new Error(`source changed after verification: ${source.path}`);
      }
      const sourceExtension = path.extname(render.sourcePath);
      const stagedSource = path.join(stagingRoot, '.verified-sources', `${source.id}${sourceExtension}`);
      fs.mkdirSync(path.dirname(stagedSource), { recursive: true });
      fs.copyFileSync(render.sourcePath, stagedSource, fs.constants.COPYFILE_EXCL);
      if (sha256File(stagedSource) !== source.actualSha256) {
        throw new Error(`source changed while creating immutable render snapshot: ${source.path}`);
      }
      syncFile(stagedSource);
      const sourceMeasurement = runner.probeAudio ? await runner.probeAudio(stagedSource) : undefined;
      if (sourceMeasurement && !/^(?:pcm_|flac$)/.test(sourceMeasurement.codec)) {
        throw new Error(`source is not decoded as a lossless codec: ${source.path} (${sourceMeasurement.codec})`);
      }
      const stagedOutput = path.join(stagingRoot, ...render.outputFile.split('/'));
      fs.mkdirSync(path.dirname(stagedOutput), { recursive: true });
      const result = await runner.run(render.command, replaceRenderPaths(render.args, stagedSource, stagedOutput));
      if (result.exitCode !== 0) {
        throw new Error(`encode failed for ${render.outputFile}: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
      }
      if (!fs.existsSync(stagedOutput)) throw new Error(`encoder did not create ${render.outputFile}`);
      const stat = fs.statSync(stagedOutput);
      if (!stat.isFile() || stat.size === 0) throw new Error(`encoder created an empty/non-file output: ${render.outputFile}`);
      syncFile(stagedOutput);
      const deliveryMeasurement = runner.probeAudio ? await runner.probeAudio(stagedOutput) : undefined;
      if (sha256File(stagedSource) !== source.actualSha256) {
        throw new Error(`immutable render snapshot changed during encode: ${source.path}`);
      }
      if (sourceMeasurement && deliveryMeasurement) {
        const expectedChannels = plan.verified.recipe.delivery.channels.mode === 'mono' ? 1 : sourceMeasurement.channels;
        const expectedCodec = plan.verified.recipe.delivery.codec;
        const codecMatches = expectedCodec === 'wav'
          ? deliveryMeasurement.codec.startsWith('pcm_')
          : deliveryMeasurement.codec === expectedCodec;
        if (!codecMatches
            || deliveryMeasurement.sampleRate !== plan.verified.recipe.delivery.sampleRate
            || deliveryMeasurement.channels !== expectedChannels) {
          throw new Error(`delivery policy mismatch for ${render.outputFile}: got ${deliveryMeasurement.codec}/${deliveryMeasurement.sampleRate}Hz/${deliveryMeasurement.channels}ch, expected ${expectedCodec}/${plan.verified.recipe.delivery.sampleRate}Hz/${expectedChannels}ch`);
        }
        measurements.push({ file: render.outputFile, source: sourceMeasurement, delivery: deliveryMeasurement });
      }
      outputs.push({ file: render.outputFile, sha256: sha256File(stagedOutput), sizeBytes: stat.size });
    }

    fs.rmSync(path.join(stagingRoot, '.verified-sources'), { recursive: true, force: true });
    const manifestContent = writeJson(path.join(stagingRoot, 'manifest.json'), plan.manifest);
    const report: SampleBuildReport = {
      version: 1,
      buildId,
      generatedAt: (options.now ?? (() => new Date()))().toISOString(),
      recipeSha256: sha256Bytes(stableRecipeJson(plan.verified.recipe)),
      sourceRevision: plan.verified.recipe.sourceRevision,
      sources: plan.verified.sources.map(source => ({
        id: source.id,
        path: source.path,
        sha256: source.actualSha256,
        sizeBytes: source.sizeBytes,
      })),
      outputs,
      delivery: plan.verified.recipe.delivery,
      toolchain: { encoder, fingerprint: encoderFingerprint, node: process.version },
      ...(measurements.length > 0 ? { measurements } : {}),
      manifestSha256: sha256Bytes(manifestContent),
    };
    const manifestPath = path.join(stagingRoot, 'manifest.json');
    const reportPath = path.join(stagingRoot, 'build-report.json');
    writeJson(reportPath, report);
    syncFile(manifestPath);
    syncFile(reportPath);
    syncDirectory(stagingRoot);
    fs.renameSync(stagingRoot, outputRoot);
    syncDirectory(path.dirname(outputRoot));
    return { state: 'rendered', plan, manifest: plan.manifest, outputs, report };
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}
