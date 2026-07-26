import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const discoveryRoot = resolve('public/.well-known/agent-skills');
const skillName = 'collaborate-in-keyboardia';
const skillPath = resolve(discoveryRoot, skillName, 'SKILL.md');

interface DiscoveryIndex {
  $schema: string;
  skills: Array<{
    name: string;
    type: string;
    description: string;
    url: string;
    digest: string;
  }>;
}

describe('Cloudflare Agent Skills discovery', () => {
  it('publishes a v0.2.0 single-file skill with synchronized metadata', () => {
    const index = JSON.parse(
      readFileSync(resolve(discoveryRoot, 'index.json'), 'utf8'),
    ) as DiscoveryIndex;
    const skill = readFileSync(skillPath, 'utf8');
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);

    expect(index.$schema).toBe(
      'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
    );
    expect(index.skills).toHaveLength(1);
    expect(frontmatter).not.toBeNull();

    const metadata = Object.fromEntries(
      frontmatter![1].split('\n').map((line) => {
        const separator = line.indexOf(':');
        return [line.slice(0, separator), line.slice(separator + 1).trim()];
      }),
    );
    const entry = index.skills[0];

    expect(Object.keys(metadata)).toEqual(['name', 'description']);
    expect(entry.name).toBe(skillName);
    expect(entry.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(entry.name.length).toBeLessThanOrEqual(64);
    expect(entry.type).toBe('skill-md');
    expect(entry.description).toBe(metadata.description);
    expect(entry.description.length).toBeLessThanOrEqual(1024);
    expect(entry.url).toBe(
      `/.well-known/agent-skills/${skillName}/SKILL.md`,
    );
    expect(
      readdirSync(resolve(discoveryRoot, skillName), { withFileTypes: true })
        .filter((item) => item.isFile())
        .map((item) => item.name),
    ).toEqual(['SKILL.md']);
  });

  it('indexes the SHA-256 digest of the raw SKILL.md bytes', () => {
    const index = JSON.parse(
      readFileSync(resolve(discoveryRoot, 'index.json'), 'utf8'),
    ) as DiscoveryIndex;
    const digest = createHash('sha256')
      .update(readFileSync(skillPath))
      .digest('hex');

    expect(index.skills[0].digest).toBe(`sha256:${digest}`);
  });

  it('declares the required MIME types and cross-origin discovery headers', () => {
    const headers = readFileSync(resolve('public/_headers'), 'utf8');

    expect(headers).toContain('/.well-known/agent-skills/*');
    expect(headers).toContain('Access-Control-Allow-Origin: *');
    expect(headers).toContain('Cache-Control: no-cache');
    expect(headers).toContain('Content-Type: application/json; charset=utf-8');
    expect(headers).toContain('Content-Type: text/markdown; charset=utf-8');
  });
});
