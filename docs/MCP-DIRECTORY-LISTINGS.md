# MCP directory listings

This file is the canonical, copy-ready registration record for Keyboardia's
hosted MCP server. Update it whenever the endpoint, tool surface, version,
support contact, or directory status changes.

## Canonical listing

| Field | Value |
|---|---|
| Name | Keyboardia |
| Registry name | `io.github.adewale/keyboardia` |
| Tagline | Create and co-edit collaborative step sequences |
| Short description | Create, co-edit, analyze, publish, and export collaborative step-sequencer sessions through MCP. |
| Endpoint | `https://keyboardia.dev/mcp` |
| Transport | Streamable HTTP |
| Authentication | None; unlisted session UUIDs act as capabilities |
| Website | `https://keyboardia.dev/` |
| Repository | `https://github.com/adewale/keyboardia` |
| Documentation | `https://github.com/adewale/keyboardia/blob/main/specs/STATELESS-MCP.md` |
| Privacy notice | `https://github.com/adewale/keyboardia/blob/main/docs/MCP-PRIVACY.md` |
| Support | `adewale+mcp@gmail.com` |
| Icon | `https://keyboardia.dev/keyboardia.svg` |
| Suggested categories | Music, Productivity, Collaboration |

Long description:

> Keyboardia is a multiplayer polyrhythmic step sequencer that agents can join
> through MCP. Agents can create a session, read its current musical state,
> make narrow retry-safe edits, remix published work, publish an immutable
> snapshot when explicitly asked, analyze rhythm and harmony, and export MIDI.
> Browser collaborators and agents work on the same live session, while
> unlisted session URLs remain the explicit collaboration capability.

## Review prompts

1. `Create a Keyboardia session named Directory review at 124 BPM. Use a fresh UUID as the idempotency key and return the session URL.`
2. `Read the Keyboardia session at <session URL>, add a kick track with steps 0, 4, 8, and 12, then read it again to verify only that requested edit.`
3. `Analyze the rhythm, key, and harmony of <session URL> without changing it.`

Expected behavior: the first prompt uses `create_session`, the second uses
`get_session`, one `edit_session` operation, and `get_session` again, and the
third uses `analyze_session`. Reviewers should not invoke `publish_session`
unless a prompt explicitly asks for publication.

## Directory record

| Directory | Registration input | Recorded status on 2026-07-30 |
|---|---|---|
| Official MCP Registry | Root [`server.json`](../server.json) | Manifest validated; [GitHub OIDC workflow](../.github/workflows/publish-mcp-registry.yml) publishes it after merge |
| OpenAI Plugins | Endpoint plus canonical fields above | Account-gated submission; production deployment and privacy notice required |
| Claude Connectors Directory | Endpoint plus canonical fields above | Account-gated Team/Enterprise submission; production deployment and privacy notice required |
| Cursor Directory | Repository and endpoint | Not found; account-gated submission remains |
| MCPServers.org | Name, short description, repository, category `Productivity`, support email | Submitted on 2026-07-30; review pending |
| PulseMCP | Official Registry ingestion | Expected to ingest after Registry publication |
| Smithery | Endpoint | Not found; account-gated submission remains |
| Glama | Repository or Official Registry entry | Not found; account-gated submission remains |

## Publication checks

- Production `tools/list` exposes all seven documented tools and their current
  titles, schemas, and annotations.
- `publish_session` advertises `openWorldHint: true` because it creates a
  shareable immutable page.
- The hosted endpoint returns a successful MCP initialization and tool list.
- The privacy and support links are public.
- The root Registry manifest version matches the hosted server identity.
- The review prompts are run against production before publication; test
  sessions are durable and should be clearly named.
