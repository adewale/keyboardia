import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateSfzImport, preprocessSfzFile } from '../scripts/sample-pipeline-sfz';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function makeSourceTree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-sfz-import-'));
  temporaryDirectories.push(root);
  fs.mkdirSync(path.join(root, 'Data'));
  fs.mkdirSync(path.join(root, 'Samples'));
  fs.writeFileSync(path.join(root, 'Samples', 'soft one.flac'), Buffer.from('lossless-soft'));
  fs.writeFileSync(path.join(root, 'Samples', 'soft two.flac'), Buffer.from('lossless-soft-two'));
  fs.writeFileSync(path.join(root, 'Samples', 'zz-loud.flac'), Buffer.from('lossless-loud'));
  fs.writeFileSync(path.join(root, 'main.sfz'), [
    '#define $LOW 1',
    '#define $HIGH 63',
    '<control> default_path=Samples/',
    '<group> pitch_keycenter=60 lokey=58 hikey=62 lovel=$LOW hivel=$HIGH group_volume=6.5',
    '#include "Data/regions.sfzinc"',
    '<group> pitch_keycenter=60 lokey=58 hikey=62 lovel=64 hivel=127',
    '<region> sample=zz-loud.flac',
  ].join('\n'));
  fs.writeFileSync(path.join(root, 'Data', 'regions.sfzinc'), [
    '<region> lorand=0 hirand=0.5 sample=soft one.flac',
    '<region> lorand=0.5 hirand=1 sample=soft two.flac',
  ].join('\n'));
  return root;
}

describe('operational SFZ-to-Pipeline-v2 import', () => {
  it('resolves includes and macros, hashes selected lossless files, and explicitly converts random regions to deterministic round robin', async () => {
    const root = makeSourceTree();
    const imported = await generateSfzImport({
      sfzFile: path.join(root, 'main.sfz'),
      sourceRoot: root,
      articulation: 'sustain',
      container: 'm4a',
      randomPolicy: 'deterministic-round-robin',
      velocityZeroPolicy: 'extend-lowest-layer',
    });

    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.sources).toEqual([
      expect.objectContaining({ id: 'source-0001', path: 'Samples/soft one.flac', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ id: 'source-0002', path: 'Samples/soft two.flac', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ id: 'source-0003', path: 'Samples/zz-loud.flac', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]);
    expect(imported.value.mappings).toEqual([
      expect.objectContaining({
        sourceId: 'source-0001',
        output: 'source-0001.m4a',
        rootMidi: 60,
        velocity: { min: 0, max: 63 },
        roundRobin: { group: 'sustain-60-0-63', index: 0, count: 2 },
        playback: { gainDb: 6.5 },
      }),
      expect.objectContaining({
        sourceId: 'source-0002',
        output: 'source-0002.m4a',
        rootMidi: 60,
        velocity: { min: 0, max: 63 },
        roundRobin: { group: 'sustain-60-0-63', index: 1, count: 2 },
        playback: { gainDb: 6.5 },
      }),
      expect.objectContaining({
        sourceId: 'source-0003',
        output: 'source-0003.m4a',
        rootMidi: 60,
        velocity: { min: 64, max: 127 },
      }),
    ]);
    expect(imported.value.warnings.join('\n')).toContain('extended the lowest SFZ velocity layer from 1 down to 0');
    expect(imported.value.warnings.join('\n')).toContain('explicitly converted 2 contiguous SFZ random ranges');
    expect(imported.value.preprocessedSfzSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed on random regions without an explicit conversion policy', async () => {
    const root = makeSourceTree();
    const imported = await generateSfzImport({
      sfzFile: path.join(root, 'main.sfz'),
      sourceRoot: root,
      articulation: 'sustain',
      container: 'm4a',
      randomPolicy: 'reject',
    });

    expect(imported).toEqual(expect.objectContaining({ ok: false }));
    if (imported.ok) return;
    expect(imported.errors.join('\n')).toContain('uses random ranges');
  });

  it('supports inline Headroom-style define/include directives in deterministic expansion order', () => {
    const root = makeSourceTree();
    fs.writeFileSync(path.join(root, 'Data', 'sample.inc'), 'pitch_keycenter=$KEY sample=soft one.flac');
    fs.writeFileSync(path.join(root, 'inline.sfz'), [
      '<control> default_path=Samples/',
      '<group> lovel=1 hivel=127',
      '<region> #define $KEY 60 lokey=59 hikey=61 #include "Data/sample.inc"',
      '<region> #define $KEY 63 lokey=62 hikey=64 #include "Data/sample.inc"',
    ].join('\n'));

    const expanded = preprocessSfzFile(path.join(root, 'inline.sfz'));
    expect(expanded.ok).toBe(true);
    if (!expanded.ok) return;
    expect(expanded.value).toContain('<region>  lokey=59 hikey=61 pitch_keycenter=60 sample=soft one.flac');
    expect(expanded.value).toContain('<region>  lokey=62 hikey=64 pitch_keycenter=63 sample=soft one.flac');
    expect(expanded.value).not.toContain('$KEY');
  });

  it('rejects include and master escapes through symlinked ancestors', async () => {
    const root = makeSourceTree();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboardia-sfz-outside-'));
    temporaryDirectories.push(outside);
    fs.writeFileSync(path.join(outside, 'outside.inc'), '<region> key=60 sample=outside.flac');
    fs.writeFileSync(path.join(outside, 'outside.flac'), Buffer.from('outside-lossless'));
    fs.symlinkSync(outside, path.join(root, 'linked'));
    fs.writeFileSync(path.join(root, 'linked-include.sfz'), '#include "linked/outside.inc"');
    fs.writeFileSync(path.join(root, 'linked-master.sfz'), '<region> key=60 sample=linked/outside.flac');

    const expanded = preprocessSfzFile(path.join(root, 'linked-include.sfz'));
    expect(expanded.ok).toBe(false);
    if (!expanded.ok) expect(expanded.errors.join('\n')).toContain('must not traverse symbolic links');

    const imported = await generateSfzImport({
      sfzFile: path.join(root, 'linked-master.sfz'),
      sourceRoot: root,
      articulation: 'sustain',
      container: 'm4a',
      randomPolicy: 'reject',
    });
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.errors.join('\n')).toContain('must not traverse symbolic links');
  });

  it('rejects missing masters, traversal, malformed mapping opcodes, and non-contiguous random ranges', async () => {
    const root = makeSourceTree();
    fs.writeFileSync(path.join(root, 'bad.sfz'), [
      '<region> key=60 lovel=nope hivel=127 sample=missing.flac',
      '<region> key=61 lovel=0 hivel=127 lorand=0 hirand=0.4 sample=../outside.flac',
      '<region> key=61 lovel=0 hivel=127 lorand=0.5 hirand=1 sample=soft two.flac',
    ].join('\n'));

    const imported = await generateSfzImport({
      sfzFile: path.join(root, 'bad.sfz'),
      sourceRoot: root,
      articulation: 'sustain',
      container: 'm4a',
      randomPolicy: 'deterministic-round-robin',
    });

    expect(imported.ok).toBe(false);
    if (imported.ok) return;
    expect(imported.errors.join('\n')).toEqual(expect.stringContaining('lovel has invalid MIDI velocity'));
    expect(imported.errors.join('\n')).toEqual(expect.stringContaining('normalized relative path'));
    expect(imported.errors.join('\n')).toEqual(expect.stringContaining('do not form contiguous 0..1 coverage'));
    expect(imported.errors.join('\n')).toEqual(expect.stringContaining('master does not exist'));
  });
});
