# Keyboardia MCP privacy notice

Last updated: 2026-07-30

This notice covers the public Keyboardia MCP endpoint at
`https://keyboardia.dev/mcp` and the shared Keyboardia session pages that MCP
clients read or change.

## Data the endpoint processes

The endpoint processes the MCP request body that a client sends. Depending on
the selected tool, that can include a Keyboardia session UUID, session name,
tempo, tracks, step patterns, instrument choices, structured edits, and a
caller-generated idempotency key.

Keyboardia does not require an account or an MCP-specific login. A session UUID
is a bearer capability: anyone who has an editable session URL can exercise the
same read and write access through the Keyboardia interface or MCP endpoint.
Treat editable session URLs as secrets. Published session URLs are public,
read-only capabilities for immutable snapshots.

The hosting platform also processes ordinary connection and operational data,
including an IP address, request timing, response status, and error information.
Keyboardia uses network information for abuse prevention and rate limiting.
When a browser first connects to a session, Keyboardia also stores the
connection's IP address and the first 16 hexadecimal characters of a SHA-256
hash of its User-Agent as the session's creator identity. This supports
creator-versus-collaborator observability across browser refreshes; it is not
returned as musical session content or by MCP tools.

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

The stored creator IP address and truncated User-Agent hash remain in the
session's Durable Object for the session's lifetime. Keyboardia currently has
no automatic expiry or self-service deletion operation for that identity data.

An idempotency reservation used by `create_session` is retained for 24 hours so
a retried request returns the same session instead of creating duplicates.
Operational records are retained only as needed to run, protect, and
troubleshoot the service.

Session URLs are bearer capabilities, not account-based credentials. Do not
place personal, confidential, or sensitive information in a session name or
musical content, and do not share an editable session URL with someone who
should not be able to change it.

## Your choices

You can use read-only tools without changing a session. Creating, editing,
remixing, and publishing are explicit tool calls, and MCP clients should ask for
confirmation before consequential writes. To ask a privacy question or request
help concerning stored session data, email
[adewale+mcp@gmail.com](mailto:adewale+mcp@gmail.com).

This notice may be updated when Keyboardia or its data handling changes.
