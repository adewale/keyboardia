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
    expect(recipe.sources).toHaveLength(367);
    expect(recipe.mapping.samples).toHaveLength(401);
    expect(new Set(recipe.mapping.samples.map(mapping => mapping.rootMidi)).size).toBe(24);
    expect(recipe.leveling).toMatchObject({
      mode: 'group-relative',
      measuredPeakDb: 0,
      groupGainDb: -8,
      deliveryCeilingDb: -1,
    });
    expect(recipe.evidence.anchors).toHaveLength(3);
  });
});
