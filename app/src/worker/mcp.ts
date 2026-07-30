import { createMcpHandler, McpServer, type McpHttpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { analyzeSession } from '../music/session-analysis';
import { MAX_STEPS, MAX_TEMPO, MIN_TEMPO } from '../shared/constants';
import type { Session } from '../shared/state';
import { PatternExpansionError } from '../shared/pattern-expansion';
import { MAX_SESSION_NAME_LENGTH, MAX_TRACK_NAME_LENGTH } from '../shared/validation';
import type { Env } from './types';
import {
  MCP_SAMPLE_IDS,
  McpSessionEditError,
  TRACK_ID_PATTERN,
  compactMcpSession,
  type CompactMcpSession,
  type McpSessionEdit,
} from './mcp-edits';
import {
  exportSessionToMidi,
  sessionRef,
  sessionUrl,
} from './mcp-lifecycle';
import { purgeOGCache } from './og-cache';
import { requestSessionAllocation, type SessionAllocationRequest } from './session-allocator';
import { getSession as getStoredSession } from './sessions';

interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

export interface McpCreateSessionOptions {
  name?: string;
  tempo?: number;
  /** A caller-generated UUID. Replaying it returns the session it first made. */
  idempotencyKey: string;
}

export interface McpSessionAdapter {
  getSession(sessionId: string): Promise<Session>;
  editSession(sessionId: string, edit: McpSessionEdit): Promise<Session>;
  createSession(options: McpCreateSessionOptions): Promise<Session>;
  remixSession(sessionId: string): Promise<Session>;
  publishSession(sessionId: string): Promise<Session>;
}

/** Just the slice of ExecutionContext the publish path needs. */
export interface McpDeferralContext {
  waitUntil(promise: Promise<unknown>): void;
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

/**
 * Turns a failed create/remix/publish into the same described error shape the
 * edit path produces, so every tool reports failure identically.
 */
export function createDurableObjectSessionAdapter(
  env: Env,
  baseUrl: string,
  ctx?: McpDeferralContext,
  clientIp?: string | null
): McpSessionAdapter {
  async function getSession(sessionId: string): Promise<Session> {
    const stub = getDurableObjectStub(env, sessionId);
    const response = await stub.fetch(new Request(
      `https://keyboardia.internal/api/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'GET' }
    ));
    return parseSessionResponse(response);
  }

  /**
   * Remix and publish both snapshot the source. The Durable Object holds edits
   * that have not reached KV yet, so it is asked first and KV is the fallback —
   * the same order the REST handlers in index.ts use.
   */
  async function readSourceSession(sessionId: string): Promise<Session> {
    try {
      return await getSession(sessionId);
    } catch (error) {
      if (error instanceof McpSessionAdapterError && error.status === 404) {
        throw error;
      }
      console.error('[MCP] DO read failed, falling back to KV:', error);
      const stored = await getStoredSession(env, sessionId, false);
      if (!stored) {
        throw new McpSessionAdapterError('Session not found.', 'SESSION_NOT_FOUND', 404);
      }
      return stored;
    }
  }

  async function allocate(request: SessionAllocationRequest): Promise<Session> {
    const result = await requestSessionAllocation(env, request);
    if (!result.success) {
      throw new McpSessionAdapterError(result.message, result.code, result.status);
    }
    return result.session;
  }

  return {
    getSession,

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

    async createSession({ name, tempo, idempotencyKey }) {
      return allocate({
        operation: 'create',
        clientIp,
        idempotencyKey,
        options: {
          name: name ?? null,
          initialState: tempo === undefined ? undefined : { tempo },
        },
      });
    },

    async remixSession(sessionId) {
      const source = await readSourceSession(sessionId);
      return allocate({ operation: 'remix', clientIp, sourceId: sessionId, source });
    },

    async publishSession(sessionId) {
      const source = await readSourceSession(sessionId);
      if (source.immutable) {
        throw new McpSessionAdapterError(
          'This session is already published. Remix it first to get an editable copy.',
          'ALREADY_PUBLISHED',
          409
        );
      }

      const published = await allocate({
        operation: 'publish',
        clientIp,
        sourceId: sessionId,
        source,
      });

      // Same cache invalidation the REST publish route performs: the source's
      // cached preview predates publication, and the snapshot must not inherit
      // a stale entry. Never allowed to fail the publish it follows.
      const purge = Promise.all([
        purgeOGCache(sessionId, baseUrl),
        purgeOGCache(published.id, baseUrl),
      ])
        .then(() => undefined)
        .catch((error) => console.error('[OG] Cache purge failed:', error));
      ctx?.waitUntil(purge);

      return published;
    },
  };
}

const sampleIds = MCP_SAMPLE_IDS as [string, ...string[]];
const sessionIdSchema = z.uuid().describe(
  'The UUID after /s/ in a Keyboardia share URL. Pass only the UUID, not the full URL.'
);
const trackIdSchema = z.string()
  .regex(TRACK_ID_PATTERN)
  .describe(
    'For add_track, choose a stable unique ID and reuse it on retries. For set_steps or set_track_instrument, copy an existing track_id from get_session.'
  );
const sampleIdSchema = z.enum(sampleIds).describe(
  'The canonical Keyboardia instrument ID. Use one of the enumerated values exactly.'
);

const editSchema = z.object({
  session_id: sessionIdSchema,
  edit: z.discriminatedUnion('operation', [
    z.object({
      operation: z.literal('add_track'),
      track_id: trackIdSchema,
      sample_id: sampleIdSchema,
      name: z.string().trim().min(1).max(MAX_TRACK_NAME_LENGTH).optional()
        .describe('Optional display name. The instrument name is used when omitted.'),
    }).strict().describe(
      'Add one track. Retrying the same track_id and definition is a no-op; a conflicting reuse is rejected.'
    ),
    z.object({
      operation: z.literal('set_track_instrument'),
      track_id: trackIdSchema,
      sample_id: sampleIdSchema,
    }).strict().describe(
      'Replace only an existing track\'s sound source while preserving its name, pattern, mix, and timing.'
    ),
    z.object({
      operation: z.literal('set_steps'),
      track_id: trackIdSchema,
      changes: z.array(z.object({
        step: z.number().int().min(0).max(MAX_STEPS - 1)
          .describe('Zero-based step index. It must be within this track\'s current step_count.'),
        value: z.boolean().describe('true activates the step; false clears it.'),
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
      }).describe('Assignments for named steps only. Every unmentioned step is preserved.'),
    }).strict().describe(
      'Change only the listed steps on an existing track. Read get_session first to obtain its track_id and step_count.'
    ),
    z.object({
      operation: z.literal('set_tempo'),
      tempo: z.number().min(MIN_TEMPO).max(MAX_TEMPO)
        .describe(`Session tempo in beats per minute (${MIN_TEMPO}-${MAX_TEMPO}).`),
    }).strict().describe('Set the session-wide tempo without changing any track.'),
  ]).describe('Exactly one narrow session edit.'),
}).strict().describe('The target session and one retry-safe edit to apply.');

const idempotencyKeySchema = z.uuid().describe(
  'A UUID you generate for this creation attempt. Reusing it returns the session the first attempt created instead of making another one.'
);

const sessionNameSchema = z.string().trim().min(1).max(MAX_SESSION_NAME_LENGTH)
  .describe('Optional display name for the new session.');

const tempoSchema = z.number().min(MIN_TEMPO).max(MAX_TEMPO)
  .describe(`Tempo in beats per minute (${MIN_TEMPO}-${MAX_TEMPO}).`);

function toolSuccess(session: CompactMcpSession) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(session) }],
    structuredContent: { ...session },
  };
}

function toolPayload(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
    structuredContent: { ...payload },
  };
}

/**
 * Every session-lifecycle tool answers with the canonical /s/{session_id} URL
 * alongside the resulting music, so an agent always has something clickable to
 * hand back to a person.
 */
function lifecycleSuccess(
  baseUrl: string,
  session: Session,
  extra: Record<string, unknown> = {}
) {
  return toolPayload({
    ...sessionRef(baseUrl, session),
    ...compactMcpSession(session),
    ...extra,
  });
}

/**
 * Only Keyboardia's own described failures reach the agent. An unexpected error
 * is logged for operators and reported as a fixed message, because its text can
 * carry runtime, storage, or parser internals that an agent must not receive.
 */
function toolError(error: unknown) {
  if (error instanceof PatternExpansionError) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ error: error.message, code: error.code }),
      }],
    };
  }
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

function createKeyboardiaMcpServer(sessions: McpSessionAdapter, baseUrl: string): McpServer {
  const server = new McpServer({
    name: 'keyboardia',
    version: '1.1.0',
  }, {
    instructions: [
      'Read an existing session with get_session before editing it.',
      'Step indexes are zero-based; preserve every track and step the user did not ask to change.',
      'For add_track, choose a stable unique track_id and reuse it on retry. For set_steps and set_track_instrument, use a track_id returned by get_session.',
      'Only publish when the user explicitly asks. A session UUID grants the same access as its share URL, so do not expose it unnecessarily.',
    ].join(' '),
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
        'Supported operations: add_track, set_track_instrument, set_steps, and set_tempo.',
        'set_steps changes only the named steps; it never replaces a track or session.',
        'set_track_instrument replaces only a track\'s sound source, keeping its'
        + ' pattern, mix, timing, and custom name.',
      ].join(' '),
      inputSchema: editSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
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

  server.registerTool(
    'create_session',
    {
      title: 'Create Keyboardia session',
      description: [
        'Create a new editable Keyboardia session with the normal defaults and return its shareable URL.',
        'The session starts with no tracks; use edit_session to add them.',
        'Pass the same idempotency_key when retrying so an uncertain attempt cannot leave duplicate sessions behind.',
      ].join(' '),
      inputSchema: z.object({
        idempotency_key: idempotencyKeySchema,
        name: sessionNameSchema.optional(),
        tempo: tempoSchema.optional()
          .describe('Starting tempo in BPM. Defaults to Keyboardia\'s own default.'),
      }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ idempotency_key, name, tempo }) => {
      try {
        const session = await sessions.createSession({ idempotencyKey: idempotency_key, name, tempo });
        return lifecycleSuccess(baseUrl, session);
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'remix_session',
    {
      title: 'Remix Keyboardia session',
      description: [
        'Copy an existing session — published or editable — into a new editable session that records the original as its source.',
        'The source is never modified, so this is how to continue from published work.',
      ].join(' '),
      inputSchema: z.object({ session_id: sessionIdSchema }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        // Each call deliberately produces a separate remix.
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ session_id }) => {
      try {
        const remix = await sessions.remixSession(session_id);
        return lifecycleSuccess(baseUrl, remix, {
          source_session_id: session_id,
          source_url: sessionUrl(baseUrl, session_id),
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'publish_session',
    {
      title: 'Publish Keyboardia session',
      description: [
        'Freeze the current music into a new immutable session and return its URL.',
        'The source session stays editable at its own URL.',
        'Only call this when someone explicitly asks to publish; it is never a side effect of editing or exporting.',
      ].join(' '),
      inputSchema: z.object({ session_id: sessionIdSchema }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        // Each call snapshots the music as it stands, producing a new session.
        idempotentHint: false,
        // The immutable session URL can be shared outside Keyboardia and is
        // rendered as a public page, so reviewers must treat this as an
        // external publication even though the editable source stays intact.
        openWorldHint: true,
      },
    },
    async ({ session_id }) => {
      try {
        const published = await sessions.publishSession(session_id);
        return lifecycleSuccess(baseUrl, published, {
          source_session_id: session_id,
          source_url: sessionUrl(baseUrl, session_id),
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'export_midi',
    {
      title: 'Export Keyboardia session as MIDI',
      description: [
        'Export the session as a base64-encoded Standard MIDI File, matching what Keyboardia\'s own Export MIDI produces for the same music.',
        'The session is not modified.',
        'The result lists any session features a MIDI file cannot carry rather than approximating them silently.',
      ].join(' '),
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
        return toolPayload({
          ...exportSessionToMidi(await sessions.getSession(session_id)),
          url: sessionUrl(baseUrl, session_id),
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'analyze_session',
    {
      title: 'Analyze Keyboardia session',
      description: [
        'Describe what is happening musically in a session — rhythm, pitch content, inferred key, and chords — without changing anything.',
        'Use this to explain music rather than to edit it.',
        'Results come from the same music-theory module the browser\'s Key Assistant and Chromatic Grid use, and report where the analysis is uncertain instead of guessing.',
      ].join(' '),
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
        const session = await sessions.getSession(session_id);
        return toolPayload({
          session_id: session.id,
          url: sessionUrl(baseUrl, session_id),
          immutable: session.immutable,
          ...analyzeSession(session.state),
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}

export function createKeyboardiaMcpHandler(
  sessions: McpSessionAdapter,
  baseUrl = 'https://keyboardia.dev'
): McpHttpHandler {
  return createMcpHandler(
    () => createKeyboardiaMcpServer(sessions, baseUrl),
    {
      legacy: 'stateless',
      onerror: (error) => console.error('[MCP]', error),
    }
  );
}

export function handleMcpRequest(
  request: Request,
  env: Env,
  ctx?: McpDeferralContext
): Promise<Response> {
  // Session URLs are built from the origin this request arrived on, so staging
  // and production each hand back their own links. Cloudflare only routes hosts
  // configured for this Worker, so the origin cannot be an arbitrary one.
  const baseUrl = new URL(request.url).origin;

  // The handler and its server factory are deliberately recreated for every
  // Worker request. Durable Objects hold music state; the MCP transport does not.
  return createKeyboardiaMcpHandler(
    createDurableObjectSessionAdapter(env, baseUrl, ctx, request.headers.get('CF-Connecting-IP')),
    baseUrl
  ).fetch(request);
}
