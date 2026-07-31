/**
 * Model-free Agent Skills discovery-to-MCP protocol contract.
 *
 * Deterministic host code downloads and verifies the indexed skill, extracts
 * its published edit_session operation shapes, and executes them through the
 * official MCP client against the real Worker/session stack. This proves the
 * advertised bytes and protocol compose; it does not prove an agent discovers
 * them on its own.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it } from 'vitest';

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

interface ToolResult {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content: Array<{ type: string; text?: string }>;
}

const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function extractEditShape(skill: string, operation: string): Record<string, unknown> {
  const escaped = operation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const documented = skill.match(new RegExp(
    '`(\\{\\s*"operation"\\s*:\\s*"' + escaped + '"[\\s\\S]*?\\})`'
  ));
  expect(documented, 'missing published MCP operation: ' + operation).not.toBeNull();
  return JSON.parse(documented![1]) as Record<string, unknown>;
}

function extractMcpEndpoint(skill: string, discoveryUrl: string): URL {
  const match = skill.match(/`(\/mcp)`/);
  expect(match, 'skill must publish its MCP endpoint').not.toBeNull();
  return new URL(match![1], discoveryUrl);
}

function extractToolNames(skill: string): string[] {
  const surface = skill.split('## Use the live edit surface')[1]
    ?.split(/^## /m)[0];
  expect(surface, 'skill must document its MCP tool surface').toBeTypeOf('string');
  return Array.from(
    surface!.matchAll(/\b(?:Call|Use) `([a-z][a-z0-9_]*)`/g),
    ([, name]) => name
  );
}

function materializeExample(
  skill: string,
  name: string,
  sessionId: string,
  trackId: string
): Record<string, unknown> {
  const operation = name.replaceAll('-', '_');
  const edit = extractEditShape(skill, operation);
  if ('track_id' in edit) edit.track_id = trackId;
  if (operation === 'set_steps') {
    edit.changes = [0, 4, 8, 12].map((step) => ({ step, value: true }));
  }
  return { session_id: sessionId, edit };
}

async function createSession(): Promise<string> {
  const response = await SELF.fetch('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Discovered skill journey',
      state: { tracks: [], tempo: 120, swing: 0, version: 1 },
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function connectAgent(endpoint: URL, discoveryUrl: string): Promise<Client> {
  const localEndpoint = new URL(endpoint.pathname, discoveryUrl);
  const transport = new StreamableHTTPClientTransport(
    localEndpoint,
    { fetch: async (input, init) => SELF.fetch(input, init) }
  );
  const client = new Client(
    { name: 'discovered-skill-test', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } }
  );
  await client.connect(transport);
  clients.push(client);
  return client;
}

function expectToolSuccess(result: ToolResult): void {
  expect(result.isError).not.toBe(true);
}

describe('Agent Skills host protocol journey', () => {
  it('fetches a digest-verified skill and executes its exact MCP examples', async () => {
    const indexUrl = 'http://localhost/.well-known/agent-skills/index.json';
    const indexResponse = await SELF.fetch(indexUrl);

    expect(indexResponse.status).toBe(200);
    expect(indexResponse.headers.get('Content-Type')).toBe(
      'application/json; charset=utf-8'
    );
    expect(indexResponse.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(indexResponse.headers.get('Cache-Control')).toBe('no-cache');

    const index = await indexResponse.json() as DiscoveryIndex;
    expect(index.$schema).toBe(
      'https://schemas.agentskills.io/discovery/0.2.0/schema.json'
    );
    expect(index.skills).toHaveLength(1);

    const entry = index.skills[0]!;
    expect(entry).toMatchObject({
      name: 'collaborate-in-keyboardia',
      type: 'skill-md',
    });

    const skillResponse = await SELF.fetch(new URL(entry.url, indexUrl));
    expect(skillResponse.status).toBe(200);
    expect(skillResponse.headers.get('Content-Type')).toBe(
      'text/markdown; charset=utf-8'
    );
    expect(skillResponse.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(skillResponse.headers.get('Cache-Control')).toBe('no-cache');

    const skillBytes = await skillResponse.arrayBuffer();
    expect(entry.digest).toBe('sha256:' + await sha256(skillBytes));
    const skill = new TextDecoder().decode(skillBytes);
    const mcpEndpoint = extractMcpEndpoint(skill, indexUrl);
    const toolNames = extractToolNames(skill);
    expect(mcpEndpoint.href).toBe('http://localhost/mcp');
    expect(toolNames.length).toBeGreaterThan(0);

    const head = await SELF.fetch(indexUrl, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect((await SELF.fetch(
      'http://localhost/.well-known/agent-skills/not-a-skill/SKILL.md'
    )).status).toBe(404);

    const sessionId = await createSession();
    const generatedTrackId = 'agent-kick-' + crypto.randomUUID()
      .replaceAll('-', '')
      .slice(0, 12);
    const client = await connectAgent(mcpEndpoint, indexUrl);
    const listed = await client.listTools();
    // Every tool the skill gives payloads for must exist on the server. This is
    // deliberately a subset check, not an equality one: the server may grow
    // tools the skill does not walk through, and pinning the full surface here
    // only guarantees this test breaks every time the product ships something.
    const live = new Set(listed.tools.map(({ name }) => name));
    for (const name of toolNames) {
      expect(live.has(name), `skill documents a tool the server does not expose: ${name}`).toBe(true);
    }

    const [readToolName, editToolName] = toolNames;

    const schemaText = JSON.stringify(
      listed.tools.find(({ name }) => name === editToolName)?.inputSchema
    );
    expect(schemaText).toContain('"edit"');
    expect(schemaText).toContain('"changes"');
    expect(schemaText).toContain('"cowbell"');
    const expectedSampleId = extractEditShape(
      skill,
      'set_track_instrument'
    ).sample_id;
    expect(expectedSampleId).toBeTypeOf('string');

    for (const exampleName of [
      'add-track',
      'set-track-instrument',
      'set-steps',
      'set-tempo',
    ]) {
      const argumentsFromSkill = materializeExample(
        skill,
        exampleName,
        sessionId,
        generatedTrackId
      );
      const result = await client.callTool({
        name: editToolName!,
        arguments: argumentsFromSkill,
      }) as ToolResult;
      expectToolSuccess(result);

      expect(result.structuredContent).toMatchObject({
        session_id: sessionId,
        applied: true,
        verification_required: true,
        next_tool: 'get_session',
      });

      // The skill's continuous trace contract is deliberately stronger than
      // merely reaching the right final state: every write is immediately
      // followed by the authoritative read before another write can occur.
      const verified = await client.callTool({
        name: readToolName!,
        arguments: { session_id: sessionId },
      }) as ToolResult;
      expectToolSuccess(verified);
      if (exampleName === 'add-track') {
        expect(verified.structuredContent).toMatchObject({
          tracks: [{ track_id: generatedTrackId }],
        });
      } else if (exampleName === 'set-track-instrument') {
        expect(verified.structuredContent).toMatchObject({
          tracks: [{ track_id: generatedTrackId, sample_id: expectedSampleId }],
        });
      } else if (exampleName === 'set-steps') {
        expect(verified.structuredContent).toMatchObject({
          tracks: [{ track_id: generatedTrackId, active_steps: [0, 4, 8, 12] }],
        });
      } else if (exampleName === 'set-tempo') {
        expect(verified.structuredContent).toMatchObject({ tempo: 124 });
      }
    }

    const final = await client.callTool({
      name: readToolName!,
      arguments: { session_id: sessionId },
    }) as ToolResult;
    expectToolSuccess(final);
    expect(final.structuredContent).toEqual({
      session_id: sessionId,
      immutable: false,
      tempo: 124,
      tracks: [{
        track_id: generatedTrackId,
        name: 'Kick',
        sample_id: expectedSampleId,
        step_count: 16,
        active_steps: [0, 4, 8, 12],
      }],
    });
  });
});
