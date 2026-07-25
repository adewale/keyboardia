import { createMcpHandler, McpServer, type McpHttpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { MAX_STEPS, MAX_TEMPO, MIN_TEMPO } from '../shared/constants';
import type { Session } from '../shared/state';
import { MAX_TRACK_NAME_LENGTH } from '../shared/validation';
import type { Env } from './types';
import {
  MCP_SAMPLE_IDS,
  McpSessionEditError,
  TRACK_ID_PATTERN,
  compactMcpSession,
  type CompactMcpSession,
  type McpSessionEdit,
} from './mcp-edits';

interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

export interface McpSessionAdapter {
  getSession(sessionId: string): Promise<Session>;
  editSession(sessionId: string, edit: McpSessionEdit): Promise<Session>;
}

class McpSessionAdapterError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'McpSessionAdapterError';
  }
}

function getDurableObjectStub(env: Env, sessionId: string): DurableObjectStubLike {
  const namespace = env.LIVE_SESSIONS as unknown as DurableObjectNamespaceLike;
  return namespace.get(namespace.idFromName(sessionId));
}

async function parseSessionResponse(response: Response): Promise<Session> {
  // A Durable Object that fails before its own handlers run can answer with a
  // non-JSON body. Turn that into a described adapter error rather than letting
  // a raw JSON parse message escape to the agent through the internal branch of
  // toolError().
  let body: Session & { error?: string; code?: string };
  try {
    body = await response.json() as Session & { error?: string; code?: string };
  } catch {
    throw new McpSessionAdapterError(
      `Keyboardia returned an unreadable response (HTTP ${response.status}).`,
      'SESSION_REQUEST_FAILED',
      response.status
    );
  }

  if (!response.ok) {
    throw new McpSessionAdapterError(
      body.error ?? `Keyboardia returned HTTP ${response.status}.`,
      body.code ?? 'SESSION_REQUEST_FAILED',
      response.status
    );
  }
  return body;
}

export function createDurableObjectSessionAdapter(env: Env): McpSessionAdapter {
  return {
    async getSession(sessionId) {
      const stub = getDurableObjectStub(env, sessionId);
      const response = await stub.fetch(new Request(
        `https://keyboardia.internal/api/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'GET' }
      ));
      return parseSessionResponse(response);
    },

    async editSession(sessionId, edit) {
      const stub = getDurableObjectStub(env, sessionId);
      const response = await stub.fetch(new Request(
        `https://keyboardia.internal/api/sessions/${encodeURIComponent(sessionId)}/mcp-edit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(edit),
        }
      ));
      return parseSessionResponse(response);
    },
  };
}

const sampleIds = MCP_SAMPLE_IDS as [string, ...string[]];
const sessionIdSchema = z.uuid().describe('The UUID in a Keyboardia /s/{session_id} URL.');
const trackIdSchema = z.string()
  .regex(TRACK_ID_PATTERN)
  .describe('A caller-chosen stable ID. Reuse it when retrying add_track.');

const editSchema = z.object({
  session_id: sessionIdSchema,
  edit: z.discriminatedUnion('operation', [
    z.object({
      operation: z.literal('add_track'),
      track_id: trackIdSchema,
      sample_id: z.enum(sampleIds),
      name: z.string().trim().min(1).max(MAX_TRACK_NAME_LENGTH).optional(),
    }).strict(),
    z.object({
      operation: z.literal('set_steps'),
      track_id: trackIdSchema,
      changes: z.array(z.object({
        step: z.number().int().min(0).max(MAX_STEPS - 1),
        value: z.boolean(),
      }).strict()).min(1).max(MAX_STEPS).superRefine((changes, context) => {
        const seen = new Set<number>();
        for (const change of changes) {
          if (seen.has(change.step)) {
            context.addIssue({
              code: 'custom',
              message: `step ${change.step} appears more than once`,
            });
          }
          seen.add(change.step);
        }
      }),
    }).strict(),
    z.object({
      operation: z.literal('set_tempo'),
      tempo: z.number().min(MIN_TEMPO).max(MAX_TEMPO),
    }).strict(),
  ]),
}).strict();

function toolSuccess(session: CompactMcpSession) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(session) }],
    structuredContent: { ...session },
  };
}

/**
 * Only Keyboardia's own described failures reach the agent. An unexpected error
 * is logged for operators and reported as a fixed message, because its text can
 * carry runtime, storage, or parser internals that an agent must not receive.
 */
function toolError(error: unknown) {
  if (error instanceof McpSessionEditError || error instanceof McpSessionAdapterError) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ error: error.message, code: error.code }),
      }],
    };
  }

  console.error('[MCP] Unexpected tool failure:', error);
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        error: 'Keyboardia could not complete this request.',
        code: 'INTERNAL_ERROR',
      }),
    }],
  };
}

function createKeyboardiaMcpServer(sessions: McpSessionAdapter): McpServer {
  const server = new McpServer({
    name: 'keyboardia',
    version: '1.0.0',
  });

  server.registerTool(
    'get_session',
    {
      title: 'Get Keyboardia session',
      description: 'Read the current tempo and compact track patterns from an existing Keyboardia session.',
      inputSchema: z.object({ session_id: sessionIdSchema }).strict(),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ session_id }) => {
      try {
        return toolSuccess(compactMcpSession(await sessions.getSession(session_id)));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'edit_session',
    {
      title: 'Edit Keyboardia session',
      description: [
        'Make one narrow, retry-safe edit to an existing collaborative session.',
        'Supported operations: add_track, set_steps, and set_tempo.',
        'set_steps changes only the named steps; it never replaces a track or session.',
      ].join(' '),
      inputSchema: editSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ session_id, edit }) => {
      try {
        return toolSuccess(compactMcpSession(await sessions.editSession(session_id, edit)));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}

export function createKeyboardiaMcpHandler(sessions: McpSessionAdapter): McpHttpHandler {
  return createMcpHandler(
    () => createKeyboardiaMcpServer(sessions),
    {
      legacy: 'stateless',
      onerror: (error) => console.error('[MCP]', error),
    }
  );
}

export function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  // The handler and its server factory are deliberately recreated for every
  // Worker request. Durable Objects hold music state; the MCP transport does not.
  return createKeyboardiaMcpHandler(createDurableObjectSessionAdapter(env)).fetch(request);
}
