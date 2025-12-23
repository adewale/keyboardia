/**
 * Shared Constants
 *
 * Constants used by both client and server code.
 * Import from here to ensure consistency across the codebase.
 */

// Maximum WebSocket/HTTP message size (64KB)
// Server rejects messages exceeding this limit.
// Client should validate before sending to fail fast with a clear error.
export const MAX_MESSAGE_SIZE = 64 * 1024;
