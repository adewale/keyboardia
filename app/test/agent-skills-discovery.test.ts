import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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

  it('never tells an agent the surface cannot do something it can', () => {
    // The published skill once said "The MCP server does not create sessions"
    // and "MCP cannot create a remix". Both were true when written and false a
    // week later, and an agent reading them would decline work the product
    // supports. Prose that enumerates missing capabilities rots; this fails the
    // build when it does.
    //
    // The claim shape that matters names the server, a capability, and a
    // negation in one sentence. "Never call edit_session for a read-only task"
    // has no server noun and is guidance, not a denial, so it is not flagged.
    const skill = readFileSync(skillPath, 'utf8');
    const fixture = JSON.parse(
      readFileSync(resolve('../evals/fixtures/keyboardia-mcp-schema.json'), 'utf8'),
    ) as { tools: Array<{ name: string }> };

    const negation = /\b(cannot|can't|can not|does not|doesn't|do not|don't|unable to|no support for|lacks|never)\b/i;
    const serverNoun = /\b(MCP|server|surface|endpoint|this API|the API)\b/i;
    const sentences = skill.split(/(?<=[.!?])\s+|\n\n/);

    const denials: string[] = [];
    for (const tool of fixture.tools.map((entry) => entry.name)) {
      const verb = tool.replace(/_session$|_midi$/, '');
      const mentions = new RegExp(`\\b${verb}`, 'i');
      for (const sentence of sentences) {
        if (mentions.test(sentence) && negation.test(sentence) && serverNoun.test(sentence)) {
          denials.push(`${tool}: ${sentence.trim().slice(0, 90)}`);
        }
      }
    }

    expect(denials, 'SKILL.md denies a capability the live surface provides').toEqual([]);
  });

  it('only names tools the server actually exposes', () => {
    const skill = readFileSync(skillPath, 'utf8');
    const fixture = JSON.parse(
      readFileSync(resolve('../evals/fixtures/keyboardia-mcp-schema.json'), 'utf8'),
    ) as { tools: Array<{ name: string }> };
    const live = new Set(fixture.tools.map((tool) => tool.name));

    // Backticked snake_case identifiers in the skill that look like tool names.
    const named = new Set(
      Array.from(skill.matchAll(/`([a-z][a-z0-9]*_[a-z0-9_]+)`/g), ([, name]) => name)
        .filter((name) => name.endsWith('_session') || name.endsWith('_midi')),
    );

    for (const name of named) {
      expect(live.has(name), `skill references a tool that does not exist: ${name}`).toBe(true);
    }
  });

  it('documents every edit operation the server exposes', () => {
    const skill = readFileSync(skillPath, 'utf8');
    const fixture = JSON.parse(
      readFileSync(resolve('../evals/fixtures/keyboardia-mcp-schema.json'), 'utf8'),
    ) as {
      tools: Array<{
        name: string;
        inputSchema?: { properties?: { edit?: { oneOf?: Array<{ properties?: { operation?: { const?: string } } }> } } };
      }>;
    };
    const editTool = fixture.tools.find(({ name }) => name === 'edit_session');
    const operations = editTool?.inputSchema?.properties?.edit?.oneOf
      ?.map((branch) => branch.properties?.operation?.const)
      .filter((operation): operation is string => typeof operation === 'string') ?? [];

    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) {
      expect(
        skill.includes('`' + operation + '`') || skill.includes('"operation": "' + operation + '"'),
        `SKILL.md omits a live edit operation: ${operation}`,
      ).toBe(true);
    }
    expect(skill).not.toMatch(/instrument changes[^.]*UI work/i);
    expect(skill).toContain('the only allowed next Keyboardia action');
    expect(skill).toContain('before the final answer');
  });

  it('keeps both artifacts on the asset-router path those headers need', () => {
    // Cloudflare applies _headers only to assets served straight from the asset
    // router, never to a response this Worker builds around env.ASSETS.fetch.
    // Production takes the router path because every discovery file exists in
    // dist and run_worker_first is unset. The integration journey reaches these
    // files through the binding instead, so it cannot catch either regression.
    const wrangler = readFileSync(resolve('wrangler.jsonc'), 'utf8');
    const ignoreFile = resolve('public/.assetsignore');

    expect(wrangler).not.toMatch(/run_worker_first/);
    expect(
      existsSync(ignoreFile) &&
        readFileSync(ignoreFile, 'utf8').split('\n').some((line) => {
          const pattern = line.trim();
          return pattern !== '' && !pattern.startsWith('#') &&
            '/.well-known/agent-skills/index.json'.includes(pattern.replace(/^[!/]+/, ''));
        }),
      '.assetsignore must not exclude the discovery artifacts',
    ).toBe(false);
  });
});
