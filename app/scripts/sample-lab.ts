#!/usr/bin/env npx tsx
/** License-first discovery, SFZ inspection, and blind listening workspace. */
import fs from 'node:fs';
import path from 'node:path';
import {
  evaluateCandidateReadiness,
  parseSampleLabCatalog,
  parseSfz,
  summarizeSfz,
  type SampleLabCatalog,
} from './sample-lab-core';
import {
  analyzeDecodedSample,
  classifySampleIssues,
  type DecodedAudioLike,
} from './sample-quality-core';

const DEFAULT_CATALOG = 'sample-lab/catalog.json';
const DEFAULT_OUTPUT = 'public/__sample-lab';
const TEMPLATE = 'sample-lab/index.html';

interface Options {
  command: string;
  positional: string[];
  catalog: string;
  output: string;
  target?: string;
  json?: string;
  checkAudio: boolean;
  verify: boolean;
}

function usage(): void {
  console.log(`
Keyboardia Sample Lab

Usage:
  npm run samples:lab:check
  npm run samples:sources -- --target guitar [--verify]
  npm run samples:inspect-sfz -- <file-or-directory>... [--json report.json]
  npm run samples:lab:build

Commands:
  check          Validate license evidence, candidate metadata, and comparisons
  sources        Search the curated permissive-license source registry
  readiness      Show hard gates and remaining listening work
  inspect-sfz    Inventory notes, velocity layers, and round robins in SFZ maps
  audit          Decode candidate previews and apply the canonical quality gates
  browser-check  Confirm candidate previews decode in Chromium
  build          Generate public/__sample-lab/ for blind browser listening

Options:
  --catalog PATH   Catalog JSON (default: ${DEFAULT_CATALOG})
  --output PATH    Generated browser directory (default: ${DEFAULT_OUTPUT})
  --target TEXT    Filter source targets
  --json PATH      Write inspect-sfz JSON
  --check-audio    Also require every root-relative comparison URL on disk
  --verify         Fetch license-evidence URLs (advisory, never used in CI)
`);
}

function parseArgs(argv: string[]): Options {
  const command = argv[0] ?? 'help';
  const positional: string[] = [];
  let catalog = DEFAULT_CATALOG;
  let output = DEFAULT_OUTPUT;
  let target: string | undefined;
  let json: string | undefined;
  let checkAudio = false;
  let verify = false;
  const value = (flag: string, index: number): string => {
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`${flag} requires a value`);
    return next;
  };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--catalog') catalog = value(arg, i++);
    else if (arg.startsWith('--catalog=')) catalog = arg.slice(10);
    else if (arg === '--output') output = value(arg, i++);
    else if (arg.startsWith('--output=')) output = arg.slice(9);
    else if (arg === '--target') target = value(arg, i++);
    else if (arg.startsWith('--target=')) target = arg.slice(9);
    else if (arg === '--json') json = value(arg, i++);
    else if (arg.startsWith('--json=')) json = arg.slice(7);
    else if (arg === '--check-audio') checkAudio = true;
    else if (arg === '--verify') verify = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else positional.push(arg);
  }
  return { command, positional, catalog, output, target, json, checkAudio, verify };
}

function readCatalog(filename: string): SampleLabCatalog {
  if (!fs.existsSync(filename)) throw new Error(`Catalog not found: ${filename}`);
  const parsed = parseSampleLabCatalog(JSON.parse(fs.readFileSync(filename, 'utf8')));
  if (!parsed.ok) throw new Error(`Invalid sample-lab catalog:\n- ${parsed.errors.join('\n- ')}`);
  return parsed.value;
}

function comparisonFiles(catalog: SampleLabCatalog): string[] {
  return [...new Set(catalog.candidates.flatMap(candidate => [
    ...candidate.comparisons.flatMap(anchor => [anchor.candidate.url, anchor.current.url]),
    ...(candidate.auditFiles ?? []).map(audio => audio.url),
  ]))];
}

function checkAudioFiles(catalog: SampleLabCatalog): string[] {
  return comparisonFiles(catalog).filter(url => !fs.existsSync(path.join('public', url.replace(/^\//, ''))));
}

function checkCommand(options: Options): void {
  const catalog = readCatalog(options.catalog);
  const missing = options.checkAudio ? checkAudioFiles(catalog) : [];
  console.log(`✓ Catalog schema: v${catalog.version}`);
  console.log(`✓ Allowlisted license-evidence source records: ${catalog.sources.length}`);
  console.log(`✓ Candidate records: ${catalog.candidates.length}`);
  console.log(`✓ Pitch-matched comparison anchors: ${catalog.candidates.reduce((sum, candidate) => sum + candidate.comparisons.length, 0)}`);
  if (!options.checkAudio) console.log('ℹ Audio existence not checked (pass --check-audio for a populated local preview workspace)');
  if (missing.length > 0) throw new Error(`Missing comparison audio:\n- ${missing.join('\n- ')}`);
  if (options.checkAudio) console.log(`✓ Local comparison audio: ${comparisonFiles(catalog).length} files`);
}

async function sourcesCommand(options: Options): Promise<void> {
  const catalog = readCatalog(options.catalog);
  const query = options.target?.toLowerCase();
  const sources = catalog.sources.filter(source => !query || JSON.stringify(source.targets).toLowerCase().includes(query));
  if (sources.length === 0) {
    console.log(`No allowlisted source matches ${JSON.stringify(options.target)}`);
    return;
  }
  for (const source of sources) {
    let verification = '';
    if (options.verify) {
      try {
        const response = await fetch(source.license.evidenceUrl, { redirect: 'follow' });
        verification = ` · evidence HTTP ${response.status}`;
      } catch (error) {
        verification = ` · evidence fetch failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    console.log(`\n${source.name} [${source.license.spdx}]${verification}`);
    console.log(`  targets:  ${source.targets.join(', ')}`);
    console.log(`  formats:  ${source.formats.join(', ')}`);
    console.log(`  source:   ${source.homepage}`);
    console.log(`  revision: ${source.revision}`);
    if (source.downloadUrl) console.log(`  download: ${source.downloadUrl}`);
    if (source.archiveSha256) console.log(`  sha256:   ${source.archiveSha256}`);
    console.log(`  evidence: ${source.license.evidenceUrl}`);
    for (const note of [...(source.license.caveats ?? []), ...(source.notes ?? [])]) console.log(`  note:     ${note}`);
  }
  console.log(`\n${sources.length} source(s). License strings are intake gates, not legal advice; preserve the pinned evidence with every final import.`);
}

function readinessCommand(options: Options): void {
  const catalog = readCatalog(options.catalog);
  for (const candidate of catalog.candidates) {
    const readiness = evaluateCandidateReadiness(candidate, catalog.sources);
    console.log(`\n${candidate.id}: ${readiness.level}`);
    for (const blocker of readiness.blockers) console.log(`  BLOCK: ${blocker}`);
    for (const note of readiness.reviewNotes) console.log(`  REVIEW: ${note}`);
  }
  const ready = catalog.candidates.filter(candidate => evaluateCandidateReadiness(candidate, catalog.sources).level === 'decision-ready').length;
  console.log(`\nDecision-ready: ${ready}/${catalog.candidates.length}. A representative one-note smoke preview is intentionally not promotion evidence.`);
}

function findSfzFiles(inputPaths: string[]): string[] {
  const files: string[] = [];
  const visit = (pathname: string): void => {
    if (!fs.existsSync(pathname)) throw new Error(`Path not found: ${pathname}`);
    const stat = fs.statSync(pathname);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(pathname)) visit(path.join(pathname, child));
    } else if (pathname.toLowerCase().endsWith('.sfz')) files.push(pathname);
  };
  inputPaths.forEach(visit);
  return files.sort();
}

function readSfzWithIncludes(filename: string, stack: string[] = []): string {
  const absolute = path.resolve(filename);
  if (stack.includes(absolute)) throw new Error(`Circular SFZ include: ${[...stack, absolute].join(' -> ')}`);
  const source = fs.readFileSync(absolute, 'utf8');
  return source.replace(/^\s*#include\s+"([^"]+)"\s*$/gm, (_line, includePath: string) => {
    const included = path.resolve(path.dirname(absolute), includePath.replace(/\\/g, path.sep));
    if (!fs.existsSync(included)) return `// Missing include: ${includePath}`;
    return readSfzWithIncludes(included, [...stack, absolute]);
  });
}

function inspectSfzCommand(options: Options): void {
  if (options.positional.length === 0) throw new Error('inspect-sfz needs at least one file or directory');
  const files = findSfzFiles(options.positional);
  if (files.length === 0) throw new Error('No .sfz files found');
  const reports = files.map(filename => ({
    file: filename,
    ...summarizeSfz(parseSfz(readSfzWithIncludes(filename))),
  }));
  for (const report of reports) {
    const range = report.minRootMidi === null ? 'unknown' : `${report.minRootMidi}..${report.maxRootMidi}`;
    console.log(`${report.file}\n  ${report.uniqueSamples} samples · ${report.uniqueRootNotes} roots (${range}) · up to ${report.maxVelocityLayers} velocity layer(s) · ${report.maxRoundRobins} RR`);
    report.warnings.forEach(warning => console.log(`  WARN: ${warning}`));
  }
  if (options.json) {
    fs.mkdirSync(path.dirname(options.json), { recursive: true });
    fs.writeFileSync(options.json, `${JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2)}\n`);
    console.log(`\nWrote ${options.json}`);
  }
}

interface DecodeAudioContextLike {
  decodeAudioData(buffer: ArrayBuffer): Promise<DecodedAudioLike>;
  close?: () => Promise<void>;
}

async function createAudioContext(): Promise<DecodeAudioContextLike> {
  const webAudio = await import('node-web-audio-api') as {
    OfflineAudioContext: new (channels: number, length: number, sampleRate: number) => DecodeAudioContextLike;
  };
  return new webAudio.OfflineAudioContext(1, 1, 44100);
}

async function auditCommand(options: Options): Promise<void> {
  const catalog = readCatalog(options.catalog);
  const context = await createAudioContext();
  const entries = [];
  for (const candidate of catalog.candidates) {
    const candidateAudio = candidate.auditFiles ?? candidate.comparisons.map(anchor => anchor.candidate);
    const refs = new Map(candidateAudio.map(audio => [audio.url, audio]));
    for (const ref of refs.values()) {
      const filename = path.join('public', ref.url.replace(/^\//, ''));
      if (!fs.existsSync(filename)) {
        entries.push({ candidateId: candidate.id, url: ref.url, decodeError: 'file not found', issues: [{ severity: 'error', code: 'MISSING_FILE' }] });
        continue;
      }
      try {
        const bytes = fs.readFileSync(filename);
        const decoded = await context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        const metrics = analyzeDecodedSample({ instrumentId: candidate.id, instrumentName: candidate.label, file: path.basename(filename), note: ref.rootMidi, pitched: true }, decoded);
        entries.push({ candidateId: candidate.id, url: ref.url, metrics, issues: classifySampleIssues(metrics) });
      } catch (error) {
        entries.push({ candidateId: candidate.id, url: ref.url, decodeError: error instanceof Error ? error.message : String(error), issues: [{ severity: 'error', code: 'DECODE_FAILED' }] });
      }
    }
  }
  await context.close?.();
  const staleObjective: string[] = [];
  for (const candidate of catalog.candidates) {
    const candidateIssues = entries.filter(entry => entry.candidateId === candidate.id).flatMap(entry => entry.issues);
    const actualErrors = candidateIssues.filter(issue => issue.severity === 'error').length;
    const actualReviews = candidateIssues.filter(issue => issue.severity === 'review').length;
    if (!candidate.objective) staleObjective.push(`${candidate.id}: catalog has no objective evidence`);
    else if (candidate.objective.hardErrors !== actualErrors || candidate.objective.reviewFlags !== actualReviews) {
      staleObjective.push(`${candidate.id}: catalog says ${candidate.objective.hardErrors} error(s)/${candidate.objective.reviewFlags} review flag(s), audit found ${actualErrors}/${actualReviews}`);
    }
  }
  const report = { generatedAt: new Date().toISOString(), staleObjective, entries };
  const output = options.json ?? 'test-results/sample-lab/audio-audit.json';
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  const errors = entries.flatMap(entry => entry.issues).filter(issue => issue.severity === 'error').length;
  const reviews = entries.flatMap(entry => entry.issues).filter(issue => issue.severity === 'review').length;
  console.log(`Candidate audio audit: ${entries.length} file(s) · ${errors} hard error(s) · ${reviews} review flag(s)`);
  staleObjective.forEach(item => console.log(`STALE_OBJECTIVE: ${item}`));
  console.log(`Wrote ${output}`);
  if (errors > 0 || staleObjective.length > 0) process.exitCode = 1;
}

async function browserCheckCommand(options: Options): Promise<void> {
  const catalog = readCatalog(options.catalog);
  const refs = [...new Set(catalog.candidates.flatMap(candidate =>
    (candidate.auditFiles ?? candidate.comparisons.map(anchor => anchor.candidate)).map(audio => audio.url)
  ))];
  const missing = refs.filter(url => !fs.existsSync(path.join('public', url.replace(/^\//, ''))));
  if (missing.length > 0) throw new Error(`Missing candidate audio:\n- ${missing.join('\n- ')}`);
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('http://sample-lab.local/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>decode</title>' });
    const filename = path.join('public', pathname.replace(/^\//, ''));
    return route.fulfill({ body: fs.readFileSync(filename), contentType: 'audio/mp4' });
  });
  await page.goto('http://sample-lab.local/');
  const results = [];
  for (const url of refs) {
    try {
      const decoded = await page.evaluate(async sampleUrl => {
        const response = await fetch(sampleUrl);
        const buffer = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(await response.arrayBuffer());
        const mono = new Float32Array(buffer.length);
        let peak = 0;
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const samples = buffer.getChannelData(channel);
          for (let i = 0; i < samples.length; i++) {
            mono[i] += samples[i] / buffer.numberOfChannels;
            peak = Math.max(peak, Math.abs(samples[i]));
          }
        }
        const threshold = Math.max(10 ** (-70 / 20), peak * 10 ** (-50 / 20));
        let activeStart = 0;
        while (activeStart < mono.length && Math.abs(mono[activeStart]) <= threshold) activeStart++;
        return {
          durationSec: buffer.duration,
          channels: buffer.numberOfChannels,
          sampleRate: buffer.sampleRate,
          peakDb: peak > 0 ? 20 * Math.log10(peak) : -120,
          leadingSilenceMs: activeStart / buffer.sampleRate * 1000,
        };
      }, `http://sample-lab.local${url}`);
      results.push({ url, ok: true, ...decoded });
    } catch (error) {
      results.push({ url, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  await browser.close();
  const output = options.json ?? 'test-results/sample-lab/browser-decode.json';
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2)}\n`);
  const failures = results.filter(result => !result.ok);
  console.log(`Chromium candidate decode: ${results.length - failures.length}/${results.length} passed`);
  console.log(`Wrote ${output}`);
  if (failures.length > 0) process.exitCode = 1;
}

function renderMarkdown(catalog: SampleLabCatalog): string {
  const lines = [
    '# Sample Lab candidate readiness',
    '',
    '> Generated by `npm run samples:lab:build`. Hard gates and subjective listening are intentionally separate.',
    '',
    '| Candidate | Target | License | Anchors | Readiness | Blockers / review |',
    '|---|---|---|---:|---|---|',
  ];
  for (const candidate of catalog.candidates) {
    const source = catalog.sources.find(item => item.id === candidate.sourceId)!;
    const readiness = evaluateCandidateReadiness(candidate, catalog.sources);
    const notes = [...readiness.blockers, ...readiness.reviewNotes].join('; ') || 'None';
    lines.push(`| ${candidate.label} | \`${candidate.targetInstrument}\` | ${source.license.spdx} | ${candidate.comparisons.length} | ${readiness.level} | ${notes} |`);
  }
  lines.push('', '## Decision rule', '', '- Reject incompatible/ambiguous licensing and objective hard defects before listening.', '- Use browser-confirmed, pitch-matched, fair-level A/B for timbre judgments.', '- Require at least three low/mid/high anchors before promotion.', '- Keep ties and identity mismatches; do not collapse evidence into a weighted score.', '');
  return lines.join('\n');
}

function buildCommand(options: Options): void {
  const catalog = readCatalog(options.catalog);
  const enriched = {
    ...catalog,
    candidates: catalog.candidates.map(candidate => ({
      ...candidate,
      readiness: evaluateCandidateReadiness(candidate, catalog.sources),
    })),
  };
  fs.mkdirSync(options.output, { recursive: true });
  const htmlOutput = path.join(path.dirname(options.output), 'sample-lab.html');
  const template = fs.readFileSync(TEMPLATE, 'utf8').replace(
    './__sample-lab/catalog.json',
    `./${path.basename(options.output)}/catalog.json`
  );
  fs.writeFileSync(htmlOutput, template);
  fs.writeFileSync(path.join(options.output, 'catalog.json'), `${JSON.stringify(enriched, null, 2)}\n`);
  fs.writeFileSync(path.join(options.output, 'README.md'), renderMarkdown(catalog));
  console.log(`Built Sample Lab: ${htmlOutput}`);
  console.log('Run npm run dev and open /sample-lab.html');
  const reviewable = catalog.candidates.filter(candidate => evaluateCandidateReadiness(candidate, catalog.sources).level === 'reviewable').length;
  const ready = catalog.candidates.filter(candidate => evaluateCandidateReadiness(candidate, catalog.sources).level === 'decision-ready').length;
  console.log(`Queue: ${catalog.candidates.length} candidates · ${reviewable} smoke-reviewable · ${ready} decision-ready`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help' || options.command === '--help' || options.command === '-h') return usage();
  if (options.command === 'check') return checkCommand(options);
  if (options.command === 'sources') return sourcesCommand(options);
  if (options.command === 'readiness') return readinessCommand(options);
  if (options.command === 'inspect-sfz') return inspectSfzCommand(options);
  if (options.command === 'audit') return auditCommand(options);
  if (options.command === 'browser-check') return browserCheckCommand(options);
  if (options.command === 'build') return buildCommand(options);
  throw new Error(`Unknown command: ${options.command}`);
}

main().catch(error => {
  console.error(`Sample Lab failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
