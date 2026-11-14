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
| Authentication | No account or MCP OAuth; editable session UUIDs are bearer capabilities |
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

Inventory assembled **2026-10-16** against the eight destinations in the
[original checklist](https://x.com/soraiadev/status/2082500548134056063), with
selected evidence rechecked **2026-11-13**. Each row retains its own evidence
date; the later review does not imply every directory was checked again.
“Listed” requires a public entry; submission and account ownership are separate
states. Search-index evidence is labelled below because it cannot establish
live endpoint health. A failed lookup does not establish that a listing is absent.

| Directory / evidence | Status and date | Next action |
|---|---|---|
| [Official MCP Registry: immutable `1.1.0` record](https://registry.modelcontextprotocol.io/v0.1/servers/io.github.adewale%2Fkeyboardia/versions/1.1.0) | **Active, latest**, confirmed from the live API on 2026-11-13. Published 2026-07-31 by [publication run](https://github.com/adewale/keyboardia/actions/runs/30621106531). | Maintain root [`server.json`](../server.json) with the [OIDC publication workflow](../.github/workflows/publish-mcp-registry.yml); publication is complete, not awaiting merge. |
| [OpenAI Plugins](https://platform.openai.com/plugins) | **Desired; no submission receipt recorded.** Current [submission instructions](https://developers.openai.com/plugins/deploy/submission) checked 2026-10-16. | Prepare the required package and review materials below, then complete the verified developer/account flow. |
| [Claude directory](https://claude.com/resources/articles/build-plugins-for-claude) | **Desired; no submission receipt recorded.** New portal announced 2026-09-25; accepts a single remote connector or a plugin bundle from developers on paid Claude plans. The old Team/Enterprise-only note is obsolete. | Submit the hosted URL through the portal linked from the announcement; optionally bundle the existing Keyboardia Agent Skill. |
| [Cursor Directory](https://cursor.directory/) | **Desired; current listing unconfirmed.** On 2026-10-16 the former `/mcp` route redirects to a plugin directory. The July search found no listing. | Search the current catalog while signed in and use its current plugin submission flow; record its receipt. |
| [MCPServers.org listing](https://mcpservers.org/servers/adewale/keyboardia) | **Listed in the public search index**, checked 2026-10-16. The 2026-07-30 submission is no longer merely “review pending.” Direct retrieval returned 403, so live-page health was not verified. | Inspect the listing in a browser and request an update only if the endpoint/copy is wrong. |
| [PulseMCP](https://www.pulsemcp.com/servers) | **Current entry unconfirmed.** July's record only expected ingestion; no listing URL or receipt was retained. The directory still announces a pause on new submissions and listing changes, rechecked 2026-11-13. | Search for an existing entry separately from the submission pause. Do not equate Official Registry publication with a confirmed PulseMCP listing. |
| [Smithery service transition](https://smithery.ai/future) | **No verified entry or receipt recorded.** The notice checked 2026-11-13 says proxy services, accounts, API keys, CLI and SDKs shut down on **2026-10-31**. A curated public directory with direct MCP URLs remains. | Confirm the continuing directory's intake process and use `https://keyboardia.dev/mcp` for any entry. The former account/proxy publishing flow is no longer a valid next step. |
| [Glama connector](https://glama.ai/mcp/connectors/io.github.adewale/keyboardia) and [repository listing](https://glama.ai/mcp/servers/adewale/keyboardia) | **Listed.** The page retrieved again on 2026-11-13 still reports “Healthy” with a 2026-10-16 test timestamp; that is not a fresh health check. Ownership remains unconfirmed. | Use the listing's ownership flow to verify the domain or GitHub account. Do not submit a duplicate of the automatically indexed entry. |

### Evidence maintenance

On 2026-11-13 the Registry's
`servers?search=io.github.adewale%2Fkeyboardia&version=latest` API reported the
active `1.1.0` record. Root `server.json` also carries `1.1.0`. Registry
publication does not by itself verify the current hosted deployment or any
downstream directory's ingestion.

The July MCPServers.org submission has no retained receipt ID. Its public
listing above is the available evidence. For every future submission, add the
timestamp, resulting listing or receipt URL/ID, submitted version, review status,
ownership status, and exact remaining action here. Never put credentials,
private session data, or editable session URLs/UUIDs in public submission
receipts: those UUIDs are bearer capabilities.

### Remaining OpenAI submission materials

The current [official submission guide](https://developers.openai.com/plugins/deploy/submission)
requires a plugin ZIP containing the remote MCP configuration, developer identity
verification, domain challenge, automated scan, five positive and three negative
review cases, and an accessible video walkthrough. It also requires HTTPS
website, support, privacy-policy, and terms-of-service URLs. The email above is
the support contact, not a substitute for the support-page URL. This document
and the three prompts above are preparation, not a completed review package.
Approved terms, a walkthrough URL, the package, completed review cases, and the
portal's exact challenge token are not recorded here yet. Use disposable,
clearly named review sessions; retain their private editable IDs outside this
public document. Do not invent a token or claim review approval.

## Additional opportunities checked on 2026-10-16

These are researched candidates, not submitted entries or claims that the
services first launched after July.

| Opportunity / primary source | Fit and remaining work |
|---|---|
| [AllMCPs existing listing](https://allmcps.com/mcp/keyboardia) | **Listed; installation guidance corrected**, rechecked 2026-11-13. It now identifies Streamable HTTP (Remote), gives `https://keyboardia.dev/mcp`, and reports a 2026-11-10 health check. The October `npx -y https://keyboardia.dev/mcp` defect is historical; no correction request was sent by this task. Ownership remains unconfirmed. |
| [SyncDev existing listing](https://www.syncdev.com/mcp-servers/keyboardia) | **Already indexed**, page retrieved 2026-10-16. Retain the URL as another discovery surface; ownership/endorsement is not implied. |
| [MCP.Directory](https://mcp.directory/submit) | Accepts a public GitHub URL and also discovers Official Registry entries. First search for an existing entry, then claim it or submit `adewale/keyboardia`; leave npm blank because this is a hosted service. No receipt recorded. |
| [Cline MCP Marketplace](https://github.com/cline/mcp-marketplace) | Instructions checked 2026-11-13 require a repository URL, 400×400 PNG logo, reason for inclusion, and an observed successful Cline installation using the README or `llms-install.md`. Check for an existing listing and verify the hosted setup before submitting. No submission made; do not claim the Cline setup test has run. |
| [Microsoft MCP Server Registry](https://github.com/microsoft/mcp-server-registry) | **Not eligible as of 2026-11-13:** its README still restricts V1 onboarding to Microsoft first-party servers. Watch for community eligibility; do not open an ineligible manifest PR. |

Glama's domain/GitHub claim and Claude's newer portal are the most direct
follow-ups to the prepared listing. OpenAI's newer ZIP submission flow can also
distribute the existing agent skill with the MCP connection. Smithery needs a
new intake check after its service transition. A Docker catalog
entry would require a separate deployment design: the current service depends
on Cloudflare Durable Objects and is not a standalone local stdio package.

Prioritize ownership of existing entries and completion of the original eight
destinations before additional catalogs. Keep MCP.Directory and Cline as
candidates until an existing-entry search and transport check are complete;
Microsoft is parked until eligibility changes. Recheck account-dependent
submission requirements at action time. The absence of a browser connection in
the October session was an execution limitation, not a permanent service blocker.

### Outreach

The [reply to the original checklist](https://x.com/e_stradella/status/2082502989625872764)
suggests `r/mcp` with the Showcase tag. Record it as **desired outreach, not
registered or posted**. Prepare a demo using a deliberately public immutable
snapshot, check the community's current rules, and never expose an editable
session capability. No Reddit post or outreach message has been sent as part
of this refresh.

## Publication checks

- Production `tools/list` exposes all seven documented tools and their current
  titles, schemas, and annotations.
- `publish_session` advertises `openWorldHint: true` because it creates a
  shareable immutable page.
- The hosted endpoint returns a successful MCP initialization and tool list.
- The privacy and support links are public.
- Unit tests bind the root Registry manifest version to the source server
  identity, and the publication workflow verifies that version against the live
  hosted server before requesting Registry credentials.
- The review prompts are run against production before publication; test
  sessions are durable and should be clearly named.
