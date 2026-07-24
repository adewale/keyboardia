import { createMcpHandler, McpServer, type McpHttpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { MAX_STEPS, MAX_TEMPO, MIN_TEMPO } from '../shared/constants';
import type { Session } from '../shared/state';
import { MAX_TRACK_NAME_LENGTH } from '../shared/validation';
import type { Env } from './types';
import {
  MCP_SAMPLE_IDS,
  McpRhythmEditError,
  compactMcpSession,
  type CompactMcpSession,
  type McpRhythmEdit,
} from './mcp-domain';

interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

export interface McpSessionStore {
  getSession(sessionId: string): Promise<Session>;
  editSession(sessionId: string, edit: McpRhythmEdit): Promise<Session>;
}

class McpSessionStoreError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'McpSessionStoreError';
  }
}

function getDurableObjectStub(env: Env, sessionId: string): DurableObjectStubLike {
  const namespace = env.LIVE_SESSIONS as unknown as DurableObjectNamespaceLike;
  return namespace.get(namespace.idFromName(sessionId));
}

async function parseSessionResponse(response: Response): Promise<Session> {
  const body = await response.json() as Session & { error?: string; code?: string };
  if (!response.ok) {
    throw new McpSessionStoreError(
      body.error ?? `Keyboardia returned HTTP ${response.status}.`,
      body.code ?? 'SESSION_REQUEST_FAILED',
      response.status
    );
  }
  return body;
}

export function createDurableObjectMcpStore(env: Env): McpSessionStore {
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
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/)
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

function toolError(error: unknown) {
  const known = error instanceof McpRhythmEditError || error instanceof McpSessionStoreError;
  const message = error instanceof Error ? error.message : 'Unexpected Keyboardia error.';
  const code = known ? error.code : 'INTERNAL_ERROR';
  return {
    isError: true,
    content: [{
      type: 'text' as const,
      text: JSON.stringify({ error: message, code }),
    }],
  };
}

export function createKeyboardiaMcpServer(store: McpSessionStore): McpServer {
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
        return toolSuccess(compactMcpSession(await store.getSession(session_id)));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'edit_session',
    {
      title: 'Edit Keyboardia rhythm',
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
        return toolSuccess(compactMcpSession(await store.editSession(session_id, edit)));
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}

export function createKeyboardiaMcpHandler(store: McpSessionStore): McpHttpHandler {
  return createMcpHandler(
    () => createKeyboardiaMcpServer(store),
    {
      legacy: 'stateless',
      onerror: (error) => console.error('[MCP]', error),
    }
  );
}

export function handleMcpRequest(request: Request, env: Env): Promise<Response> {
  // The handler and its server factory are deliberately recreated for every
  // Worker request. Durable Objects hold music state; the MCP transport does not.
  return createKeyboardiaMcpHandler(createDurableObjectMcpStore(env)).fetch(request);
}
