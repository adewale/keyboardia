import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSampleRecipe } from '../scripts/sample-pipeline-core';

const recipesRoot = path.resolve('sample-pipeline/recipes');
const recipeFiles = fs.readdirSync(recipesRoot)
  .filter(filename => filename.endsWith('.json') && !filename.endsWith('.dispositions.json'))
  .sort();

describe('committed production pipeline recipes', () => {
  it('all cross the strict v1 trust boundary without defaults or ignored fields', () => {
    expect(recipeFiles.length).toBeGreaterThan(0);
    for (const filename of recipeFiles) {
      const parsed = parseSampleRecipe(JSON.parse(fs.readFileSync(path.join(recipesRoot, filename), 'utf8')));
      expect(parsed, filename).toMatchObject({ ok: true });
    }
  });

  it('steel-drums preserves native dynamics while materially expanding explicit mappings', () => {
    const parsed = parseSampleRecipe(JSON.parse(fs.readFileSync(path.join(recipesRoot, 'steel-drums.json'), 'utf8')));
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const recipe = parsed.value.recipe;
    expect(recipe.sourceRevision).toBe('e429428dd65dc645e4c9b1f134da4d2e40c400c6');
    expect(recipe.sources).toHaveLength(131);
    expect(recipe.mapping.samples).toHaveLength(143);
    expect(new Set(recipe.mapping.samples.map(mapping => mapping.rootMidi)).size).toBe(24);
    expect(recipe.leveling).toMatchObject({
      mode: 'group-relative',
      measuredPeakDb: 0,
      groupGainDb: -9,
      deliveryCeilingDb: -1,
    });
    expect(recipe.evidence.anchors).toHaveLength(3);
  });

  it.each([
    ['clean-guitar', '0eeda4a30deb443520ac40828909b61842903259', 57, 57, 18, 2, 2],
    ['piano', '2a7df3f7252227a3484202c1d61bc1bfe352a971', 45, 45, 9, 5, 1],
    ['finger-bass', 'FingerBassYR-SFZ+FLAC-20190930@sha256:36f87ec9eb086ef25050312522aacf71213c582f46989e0c5a12681304596587', 12, 12, 12, 1, 1],
    ['alto-sax', 'a4d756b21d2a573aca0d840cce7e71ba5effd4c6', 68, 68, 17, 2, 2],
    ['acoustic-kick', '719fe72bc6693b94f1229674e202881145ab44ed', 16, 59, 1, 14, 5],
    ['acoustic-snare', '719fe72bc6693b94f1229674e202881145ab44ed', 16, 59, 1, 14, 5],
    ['acoustic-hihat-closed', '719fe72bc6693b94f1229674e202881145ab44ed', 16, 59, 1, 14, 5],
    ['acoustic-hihat-open', '719fe72bc6693b94f1229674e202881145ab44ed', 16, 59, 1, 14, 5],
    ['acoustic-ride', '719fe72bc6693b94f1229674e202881145ab44ed', 10, 25, 1, 8, 4],
    ['acoustic-crash', '719fe72bc6693b94f1229674e202881145ab44ed', 12, 34, 1, 11, 4],
  ])('%s is a pinned exact-ID candidate with complete explicit mappings', (
    instrumentId,
    revision,
    sourceCount,
    mappingCount,
    rootCount,
    maximumLayers,
    maximumRoundRobins,
  ) => {
    const parsed = parseSampleRecipe(JSON.parse(fs.readFileSync(path.join(recipesRoot, `${instrumentId}.json`), 'utf8')));
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const recipe = parsed.value.recipe;
    const layers = new Map<number, Set<string>>();
    for (const mapping of recipe.mapping.samples) {
      const rootLayers = layers.get(mapping.rootMidi) ?? new Set<string>();
      rootLayers.add(`${mapping.velocity.min}-${mapping.velocity.max}`);
      layers.set(mapping.rootMidi, rootLayers);
    }
    expect(recipe.instrument.id).toBe(instrumentId);
    expect(recipe.sourceRevision).toBe(revision);
    expect(recipe.sources).toHaveLength(sourceCount);
    expect(recipe.mapping.samples).toHaveLength(mappingCount);
    expect(layers.size).toBe(rootCount);
    expect(Math.max(...[...layers.values()].map(rootLayers => rootLayers.size))).toBe(maximumLayers);
    expect(Math.max(...recipe.mapping.samples.map(mapping => mapping.roundRobin?.count ?? 1))).toBe(maximumRoundRobins);
    expect(recipe.evidence.anchors).toHaveLength(3);
    expect(Math.max(...recipe.evidence.anchors.map(anchor => anchor.targetMidi))
      - Math.min(...recipe.evidence.anchors.map(anchor => anchor.targetMidi))).toBeGreaterThanOrEqual(12);
  });

  it('preserves complete CC BY attribution and pinned creator-authority packets', () => {
    const ccByIds = ['piano', 'acoustic-kick', 'acoustic-snare', 'acoustic-hihat-closed', 'acoustic-hihat-open', 'acoustic-ride', 'acoustic-crash'];
    for (const instrumentId of ccByIds) {
      const parsed = parseSampleRecipe(JSON.parse(fs.readFileSync(path.join(recipesRoot, `${instrumentId}.json`), 'utf8')));
      if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
      expect(parsed.value.recipe.instrument.credits).toMatchObject({
        license: 'CC BY 4.0',
        attribution: expect.any(String),
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        changes: expect.any(String),
      });
      const disposition = JSON.parse(fs.readFileSync(path.join(recipesRoot, `${instrumentId}.dispositions.json`), 'utf8'));
      expect(disposition.authorityEvidence.url).toContain(parsed.value.recipe.sourceRevision.split('@')[0]);
      expect(disposition.authorityEvidence.sha256).toMatch(/^[a-f0-9]{64}$/);
      const authorityPacket = path.resolve(disposition.authorityEvidence.localPath);
      expect(fs.existsSync(authorityPacket)).toBe(true);
      expect(createHash('sha256').update(fs.readFileSync(authorityPacket)).digest('hex'))
        .toBe(disposition.authorityEvidence.sha256);
      expect(disposition.authorityEvidence.finding.length).toBeGreaterThan(40);
    }
    const altoDisposition = JSON.parse(fs.readFileSync(path.join(recipesRoot, 'alto-sax.dispositions.json'), 'utf8'));
    const altoPacket = path.resolve(altoDisposition.authorityEvidence.localPath);
    expect(createHash('sha256').update(fs.readFileSync(altoPacket)).digest('hex'))
      .toBe('2ad0ce0863187b1aca7b3b8487f8d04f0d0bb80f876ac8036ec7a5e794f0bfbe');
  });
});
