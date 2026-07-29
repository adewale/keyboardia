# Keyboardia MCP privacy notice

Last updated: 2026-07-30

This notice covers the public Keyboardia MCP endpoint at
`https://keyboardia.dev/mcp`.

## Data the endpoint processes

The endpoint processes the MCP request body that a client sends. Depending on
the selected tool, that can include a Keyboardia session UUID, session name,
tempo, tracks, step patterns, instrument choices, structured edits, and a
caller-generated idempotency key.

Keyboardia does not require an account or an MCP-specific login. A session UUID
is a capability: anyone who has the unlisted session URL has the same access the
Keyboardia interface and MCP endpoint grant for that session. Published sessions
are readable and immutable.

The hosting platform also processes ordinary connection and operational data,
including an IP address, request timing, response status, and error information.
Keyboardia uses network information for abuse prevention and rate limiting.

## How data is used

Request data is used to read, create, edit, remix, publish, analyze, or export a
Keyboardia session as requested. Browser collaborators and MCP clients operate
on the same session state.

The `publish_session` tool creates a new immutable session with a shareable URL.
It is used only when a caller explicitly invokes it; editing and exporting do
not publish automatically.

## Storage, sharing, and retention

Keyboardia stores session data in Cloudflare Durable Objects and KV so sessions
and collaboration can continue across requests. Sessions are persistent, and
the current public API does not provide a session deletion operation.

An idempotency reservation used by `create_session` is retained for 24 hours so
a retried request returns the same session instead of creating duplicates.
Operational records are retained only as needed to run, protect, and
troubleshoot the service.

Session URLs are not authentication credentials. Do not place personal,
confidential, or sensitive information in a session name or musical content,
and do not share an editable session URL with someone who should not be able to
change it.

## Your choices

You can use read-only tools without changing a session. Creating, editing,
remixing, and publishing are explicit tool calls, and MCP clients should ask for
confirmation before consequential writes. To ask a privacy question or request
help concerning stored session data, email
[adewale+mcp@gmail.com](mailto:adewale+mcp@gmail.com).

This notice may be updated when Keyboardia or its data handling changes.
