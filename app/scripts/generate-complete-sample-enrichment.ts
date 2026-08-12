#!/usr/bin/env node
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface ImportedMapping {
  sourceId: string;
  output: string;
  rootMidi: number;
  velocity: { min: number; max: number };
  articulation: string;
  roundRobin?: { group: string; index: number; count: number };
  processing?: Record<string, unknown>;
  playback?: Record<string, unknown>;
}

interface ImportPacket {
  sfzFile: string;
  preprocessedSfzSha256: string;
  sources: Array<{ id: string; path: string; sha256: string }>;
  mappings: ImportedMapping[];
  warnings: string[];
}

interface Leveling {
  anchorSourceId: string;
  measuredPeakDb: number;
  groupGainDb: number;
  ceilingDb: number;
}

interface InstrumentSpec {
  id: string;
  importFile: string;
  sourceRevision: string;
  sampleLabSourceId: string;
  sourceRootLabel: string;
  instrument: Record<string, unknown>;
  leveling: Leveling;
  anchors: Array<{ id: string; targetMidi: number; velocity: number; currentFile: string; currentRootMidi: number }>;
}

function sha256(filename: string): string {
  return createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function readJson<T>(filename: string): T {
  return JSON.parse(fs.readFileSync(filename, 'utf8')) as T;
}

function writeJson(filename: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function sampleFor(packet: ImportPacket, midi: number, velocity: number): ImportedMapping {
  const candidates = packet.mappings.filter(mapping => mapping.rootMidi === midi
    && mapping.velocity.min <= velocity && mapping.velocity.max >= velocity);
  const selected = candidates.sort((left, right) => (left.roundRobin?.index ?? 0) - (right.roundRobin?.index ?? 0))[0];
  if (!selected) throw new Error(`No candidate mapping for MIDI ${midi} at velocity ${velocity}`);
  return selected;
}

function removeUnusableSteelMaster(packet: ImportPacket): ImportPacket {
  const excludedPath = 'jsdb_061_Db4_1-1.flac';
  const excluded = packet.sources.find(source => source.path === excludedPath);
  if (!excluded) throw new Error(`Expected unusable steel master is missing: ${excludedPath}`);
  const removedMappings = packet.mappings.filter(mapping => mapping.sourceId === excluded.id);
  if (removedMappings.length !== 1 || !removedMappings[0].roundRobin) {
    throw new Error('Unusable steel master must identify exactly one round-robin mapping');
  }
  const removed = removedMappings[0].roundRobin;
  return {
    ...packet,
    sources: packet.sources.filter(source => source.id !== excluded.id),
    mappings: packet.mappings
      .filter(mapping => mapping.sourceId !== excluded.id)
      .map(mapping => mapping.roundRobin?.group === removed.group
        ? {
            ...mapping,
            roundRobin: {
              ...mapping.roundRobin,
              index: mapping.roundRobin.index > removed.index ? mapping.roundRobin.index - 1 : mapping.roundRobin.index,
              count: mapping.roundRobin.count - 1,
            },
          }
        : mapping),
    warnings: [
      ...packet.warnings,
      `${excludedPath} excluded: canonical decoded source audit reports FLAT_TOP_CLIPPING (four flat-top runs)`,
    ],
  };
}

function makeRecipe(spec: InstrumentSpec, packet: ImportPacket): Record<string, unknown> {
  return {
    version: 1,
    instrument: spec.instrument,
    sourceRevision: spec.sourceRevision,
    sources: packet.sources,
    mapping: { mode: 'explicit', samples: packet.mappings },
    delivery: {
      codec: 'aac',
      container: 'm4a',
      bitrateKbps: 160,
      sampleRate: 44100,
      channels: { mode: 'preserve' },
    },
    leveling: {
      mode: 'group-relative',
      anchorSourceId: spec.leveling.anchorSourceId,
      measuredPeakDb: spec.leveling.measuredPeakDb,
      ceilingDb: spec.leveling.ceilingDb,
      deliveryCeilingDb: -1,
      groupGainDb: spec.leveling.groupGainDb,
    },
    evidence: {
      sampleLabSourceId: spec.sampleLabSourceId,
      currentInstrumentDir: `public/instruments/${spec.id}`,
      anchors: spec.anchors.map(anchor => {
        const mapping = sampleFor(packet, anchor.currentRootMidi, anchor.velocity);
        return {
          id: anchor.id,
          targetMidi: anchor.targetMidi,
          velocity: anchor.velocity,
          currentFile: anchor.currentFile,
          currentRootMidi: anchor.currentRootMidi,
          candidateOutput: mapping.output,
          candidateRootMidi: mapping.rootMidi,
        };
      }),
    },
  };
}

function drumSpec(
  id: string,
  label: string,
  importFile: string,
  playbackNote: number,
  releaseTime: number,
  leveling: Leveling,
  currentFiles: [string, string, string],
  extras: Record<string, unknown> = {},
): InstrumentSpec {
  return {
    id,
    importFile,
    sourceRevision: '9f04cf9a734527edfbb0a4eee1f674e45bbf71bc',
    sampleLabSourceId: 'virtuosity-drums',
    sourceRootLabel: 'virtuosity',
    instrument: {
      id,
      name: label,
      releaseTime,
      playbackNote,
      ...extras,
      credits: {
        source: 'Virtuosity Drums by Versilian Studios & Karoryfer Samples (mid mic)',
        url: 'https://github.com/sfzinstruments/virtuosity_drums',
        license: 'CC0 1.0 Universal (Public Domain)',
        licenseUrl: 'https://github.com/sfzinstruments/virtuosity_drums/blob/9f04cf9a734527edfbb0a4eee1f674e45bbf71bc/LICENSE',
        changes: 'Complete same-mic velocity/variation mapping; deterministic round-robin selection; AAC-LC delivery and uniform group leveling.',
      },
    },
    leveling,
    anchors: [
      { id: 'low-soft', targetMidi: playbackNote - 6, velocity: 24, currentFile: currentFiles[0], currentRootMidi: playbackNote },
      { id: 'mid-medium', targetMidi: playbackNote, velocity: 76, currentFile: currentFiles[1], currentRootMidi: playbackNote },
      { id: 'high-loud', targetMidi: playbackNote + 6, velocity: 116, currentFile: currentFiles[2], currentRootMidi: playbackNote },
    ],
  };
}

function main(): void {
  const importRoot = path.resolve(process.argv[2] ?? '');
  if (!process.argv[2] || !fs.statSync(importRoot).isDirectory()) {
    throw new Error('Usage: generate-complete-sample-enrichment.ts <directory-containing-import-json>');
  }
  const outputRoot = path.resolve('sample-pipeline', 'enrichment');
  const specs: InstrumentSpec[] = [
    drumSpec('acoustic-kick', 'Acoustic Kick', 'virtuosity-kick-import.json', 36, 0.2,
      { anchorSourceId: 'source-0015', measuredPeakDb: -12.660820039695189, groupGainDb: -3, ceilingDb: -15.660820039695189 },
      ['kick-vl1.mp3', 'kick-vl3.mp3', 'kick-vl4.mp3'], { playableRange: { min: 24, max: 73 }, gainDb: 12.660820039695189 }),
    drumSpec('acoustic-snare', 'Acoustic Snare', 'virtuosity-snare-import.json', 38, 0.25,
      { anchorSourceId: 'source-0029', measuredPeakDb: -0.23177054787046233, groupGainDb: -3, ceilingDb: -3.2317705478704624 },
      ['snare-vl1.mp3', 'snare-vl3.mp3', 'snare-vl4.mp3'], { playableRange: { min: 26, max: 73 }, gainDb: 0.23177054787046233 }),
    drumSpec('acoustic-hihat-closed', 'Acoustic Hi-Hat (Closed)', 'virtuosity-hihat-closed-import.json', 42, 0.15,
      { anchorSourceId: 'source-0014', measuredPeakDb: -15.36904319260509, groupGainDb: -3, ceilingDb: -18.36904319260509 },
      ['hihat-closed-vl1.mp3', 'hihat-closed-vl3.mp3', 'hihat-closed-vl4.mp3'], { playableRange: { min: 30, max: 73 }, chokeGroup: 'acoustic-hihat', gainDb: 16.36904319260509 }),
    drumSpec('acoustic-hihat-open', 'Acoustic Hi-Hat (Open)', 'virtuosity-hihat-open-import.json', 46, 0.3,
      { anchorSourceId: 'source-0012', measuredPeakDb: -9.891419141523805, groupGainDb: -3, ceilingDb: -12.891419141523805 },
      ['hihat-open-vl1.mp3', 'hihat-open-vl3.mp3', 'hihat-open-vl4.mp3'], { playableRange: { min: 34, max: 73 }, chokeGroup: 'acoustic-hihat', gainDb: 10.891419141523805 }),
    drumSpec('acoustic-ride', 'Ride Cymbal', 'virtuosity-ride-import.json', 51, 0.5,
      { anchorSourceId: 'source-0012', measuredPeakDb: -12.347468662006332, groupGainDb: -3, ceilingDb: -15.347468662006332 },
      ['ride-vl1.mp3', 'ride-vl2.mp3', 'ride-vl3.mp3'], { playableRange: { min: 39, max: 73 }, gainDb: 12.347468662006332 }),
    drumSpec('acoustic-crash', 'Crash Cymbal', 'virtuosity-crash-import.json', 49, 2,
      { anchorSourceId: 'source-0010', measuredPeakDb: -12.663475905545729, groupGainDb: -3, ceilingDb: -15.663475905545729 },
      ['crash-vl1.mp3', 'crash-vl2.mp3', 'crash-vl3.mp3'], { playableRange: { min: 37, max: 73 }, gainDb: 13.663475905545729 }),
    {
      id: 'finger-bass',
      importFile: 'meatbass-import.json',
      sourceRevision: 'ac9e859564bda286ab5ec672d00ff1aa2fef2895',
      sampleLabSourceId: 'karoryfer-meatbass',
      sourceRootLabel: 'meatbass',
      instrument: {
        id: 'finger-bass', name: 'Finger Bass', releaseTime: 0.3, gainDb: 9.806921938864457,
        playableRange: { min: 18, max: 66 }, velocityCrossfade: 4,
        credits: {
          source: 'Karoryfer Meatbass',
          url: 'https://github.com/sfzinstruments/karoryfer.meatbass',
          license: 'CC0 1.0 Universal (Public Domain)',
          licenseUrl: 'https://github.com/sfzinstruments/karoryfer.meatbass/blob/ac9e859564bda286ab5ec672d00ff1aa2fef2895/LICENSE',
          changes: 'Complete tonal pizzicato map: fourteen roots, four velocity layers, four deterministic round robins; AAC-LC delivery, uniform group leveling, and manifest trim calibrated to the canonical C4/MIDI-90 loudness contract.',
        },
      },
      leveling: { anchorSourceId: 'source-0160', measuredPeakDb: 0, groupGainDb: -3, ceilingDb: -3 },
      anchors: [
        { id: 'low-soft', targetMidi: 24, velocity: 24, currentFile: 'C1.mp3', currentRootMidi: 24 },
        { id: 'mid-medium', targetMidi: 42, velocity: 76, currentFile: 'Gb2.mp3', currentRootMidi: 42 },
        { id: 'high-loud', targetMidi: 60, velocity: 116, currentFile: 'C4.mp3', currentRootMidi: 60 },
      ],
    },
    {
      id: 'steel-drums',
      importFile: 'steel-complete-import.json',
      sourceRevision: 'e429428dd65dc645e4c9b1f134da4d2e40c400c6',
      sampleLabSourceId: 'jlearman-steel-drum',
      sourceRootLabel: 'steel/jSteelDrum-flac-sfz',
      instrument: {
        id: 'steel-drums', name: 'Steel Drums', releaseTime: 0.8, gainDb: 4.75,
        playableRange: { min: 54, max: 87 }, velocityCrossfade: 4,
        credits: {
          source: 'jSteelDrum v2 by Jack Learman (hand-made Trinidad steel pan)',
          url: 'https://github.com/sfzinstruments/jlearman.SteelDrum',
          license: 'The Unlicense (Public Domain)',
          licenseUrl: 'https://github.com/sfzinstruments/jlearman.SteelDrum/blob/e429428dd65dc645e4c9b1f134da4d2e40c400c6/LICENSE',
          changes: 'All usable SFZ mappings retained across 24 chromatic roots and five velocity zones; deterministic round-robin conversion; AAC-LC delivery and uniform group leveling.',
        },
      },
      leveling: { anchorSourceId: 'source-0177', measuredPeakDb: 0, groupGainDb: -9, ceilingDb: -9 },
      anchors: [
        { id: 'low-soft', targetMidi: 60, velocity: 24, currentFile: 'C4-pp.mp3', currentRootMidi: 60 },
        { id: 'mid-medium', targetMidi: 72, velocity: 76, currentFile: 'C5-mf.mp3', currentRootMidi: 72 },
        { id: 'high-loud', targetMidi: 83, velocity: 116, currentFile: 'A5-ff.mp3', currentRootMidi: 83 },
      ],
    },
  ];

  const lockInstruments: Record<string, unknown>[] = [];
  for (const spec of specs) {
    const importPath = path.join(importRoot, spec.importFile);
    const originalPacket = readJson<ImportPacket>(importPath);
    const packet = spec.id === 'steel-drums' ? removeUnusableSteelMaster(originalPacket) : originalPacket;
    const recipe = makeRecipe(spec, packet);
    writeJson(path.join(outputRoot, 'imports', spec.importFile), packet);
    writeJson(path.join(outputRoot, 'recipes', `${spec.id}.json`), recipe);
    lockInstruments.push({
      id: spec.id,
      sourceRoot: spec.sourceRootLabel,
      sourceRevision: spec.sourceRevision,
      sfzFile: packet.sfzFile,
      preprocessedSfzSha256: packet.preprocessedSfzSha256,
      importSha256: sha256(importPath),
      selectedLosslessMasters: packet.sources.length,
      explicitMappings: packet.mappings.length,
      velocityLayers: new Set(packet.mappings.map(mapping => `${mapping.velocity.min}-${mapping.velocity.max}`)).size,
      roots: new Set(packet.mappings.map(mapping => mapping.rootMidi)).size,
      maxRoundRobins: Math.max(...packet.mappings.map(mapping => mapping.roundRobin?.count ?? 1)),
    });
  }
  writeJson(path.join(outputRoot, 'lock.json'), {
    version: 1,
    generatedAt: '2026-08-12',
    acceptanceBasis: 'owner-directed automatic enrichment; perceptual preference is intentionally not claimed',
    delivery: 'AAC-LC 160 kbps, 44.1 kHz, source channel count preserved',
    licenseProfile: ['CC0-1.0', 'Unlicense'],
    exclusions: [{ instrumentId: 'steel-drums', source: 'jsdb_061_Db4_1-1.flac', reason: 'FLAT_TOP_CLIPPING: four flat-top runs' }],
    instruments: lockInstruments,
  });
  console.log(`Wrote ${specs.length} complete enrichment recipes and exact import packets to ${outputRoot}`);
}

main();
