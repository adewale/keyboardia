import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const WORKFLOW = readFileSync(
  new URL('../../.github/workflows/publish-mcp-registry.yml', import.meta.url),
  'utf8'
);
const VALIDATE_JOB = WORKFLOW.split('\n  validate:\n', 2)[1]?.split('\n  publish:\n', 1)[0] ?? '';
const PUBLISH_JOB = WORKFLOW.split('\n  publish:\n', 2)[1] ?? '';

describe('MCP Registry publication workflow', () => {
  it('keeps validation unprivileged and passes only its validated manifest to the OIDC job', () => {
    expect(VALIDATE_JOB).not.toContain('id-token: write');
    expect(VALIDATE_JOB).toContain(
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'
    );
    expect(VALIDATE_JOB).toContain(
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'
    );

    expect(PUBLISH_JOB).toContain('id-token: write');
    expect(PUBLISH_JOB).not.toContain('actions/checkout@');
    expect(PUBLISH_JOB).toContain(
      'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'
    );
    expect(WORKFLOW).not.toMatch(/^\s*uses:\s+[^\s#]+@v\d+/m);
  });

  it('uses the current discovery protocol before accepting the production version', () => {
    expect(PUBLISH_JOB).toContain('https://keyboardia.dev/mcp');
    expect(PUBLISH_JOB).toContain("'MCP-Protocol-Version: 2026-07-28'");
    expect(PUBLISH_JOB).toContain("'Mcp-Method: server/discover'");
    expect(PUBLISH_JOB).toContain('"method":"server/discover"');
    expect(PUBLISH_JOB).toContain('"io.modelcontextprotocol/protocolVersion":"2026-07-28"');
    expect(PUBLISH_JOB).toContain('"io.modelcontextprotocol/clientInfo"');
    expect(PUBLISH_JOB).toContain('"io.modelcontextprotocol/clientCapabilities"');
    expect(PUBLISH_JOB).not.toContain('"method":"initialize"');
    expect(PUBLISH_JOB).not.toContain('2025-06-18');
    expect(PUBLISH_JOB).toContain(
      '.result._meta["io.modelcontextprotocol/serverInfo"].name'
    );
    expect(PUBLISH_JOB).toContain(
      '.result._meta["io.modelcontextprotocol/serverInfo"].version'
    );
    expect(PUBLISH_JOB).toContain('.result.supportedVersions | index("2026-07-28")');
    expect(PUBLISH_JOB).not.toContain('.result.serverInfo.name');
    expect(PUBLISH_JOB).toContain("manifest_version=\"$(jq -er '.version' server.json)\"");
    expect(PUBLISH_JOB).toContain('if [ "$live_version" != "$manifest_version" ]');
  });

  it('recovers retries only when the immutable Registry record is an exact active match', () => {
    expect(PUBLISH_JOB).toContain('.server.name == $name');
    expect(PUBLISH_JOB).toContain('.server.version == $version');
    expect(PUBLISH_JOB).toContain(
      '._meta["io.modelcontextprotocol.registry/official"].status == "active"'
    );
    expect(PUBLISH_JOB).toContain("--slurpfile expected server.json '.server == $expected[0]'");
    expect(PUBLISH_JOB).toContain('already contains different metadata');
  });
});
