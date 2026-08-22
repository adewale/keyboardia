/**
 * The single write gate for every operation that allocates a permanent session.
 *
 * All callers address one named Durable Object, so allocation limits and MCP
 * create idempotency are serialized across Worker isolates and colos. For an
 * idempotent create, the UUID reservation is persisted before KV is touched;
 * concurrent calls and retries therefore converge on one session identity even
 * if the first KV write has an uncertain outcome.
 */

import type { Session } from '../shared/state';
import { MCP_CREATE_IDEMPOTENCY_TTL_SECONDS } from './mcp-lifecycle';
import { resolveRateLimit } from './rate-limit';
import {
  createSession,
  getSession,
  publishSessionFromState,
  remixSessionFromState,
  type CreateSessionOptions,
  type SessionResult,
} from './sessions';
import type { Env } from './types';

const ALLOCATOR_NAME = 'global-session-allocator';
const RATE_WINDOW_MS = 60_000;

interface DurableObjectStorageLike {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
}

interface DurableObjectStateLike {
  storage: DurableObjectStorageLike;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}

interface DurableObjectStubLike {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStubLike;
}

interface AllocationBase {
  clientIp?: string | null;
}

export type SessionAllocationRequest =
  | (AllocationBase & {
      operation: 'create';
      options: Omit<CreateSessionOptions, 'id'>;
      idempotencyKey?: string;
    })
  | (AllocationBase & {
      operation: 'remix';
      sourceId: string;
      source: Session;
    })
  | (AllocationBase & {
      operation: 'publish';
      sourceId: string;
      source: Session;
    });

export type SessionAllocationResponse =
  | { success: true; session: Session }
  | {
      success: false;
      code: 'RATE_LIMITED' | 'QUOTA_EXCEEDED' | 'SESSION_WRITE_FAILED' | 'ALREADY_PUBLISHED';
      status: number;
      message: string;
      retryAfter?: number;
    };

interface RateWindow {
  count: number;
  windowStart: number;
}

interface IdempotencyReservation {
  sessionId: string;
  expiresAt: number;
  options: Omit<CreateSessionOptions, 'id'>;
}

function publicWriteFailure<T>(result: Extract<SessionResult<T>, { success: false }>): SessionAllocationResponse {
  if (result.quotaExceeded) {
    return {
      success: false,
      code: 'QUOTA_EXCEEDED',
      status: 503,
      message: 'Keyboardia has reached its daily storage quota. Try again after it resets at midnight UTC.',
    };
  }
  return {
    success: false,
    code: 'SESSION_WRITE_FAILED',
    status: 500,
    message: 'Keyboardia could not save the session. Please try again.',
  };
}

export class SessionAllocatorDurableObject {
  private readonly state: DurableObjectStateLike;
  private readonly env: Env;

  constructor(
    state: DurableObjectStateLike,
    env: Env
  ) {
    this.state = state;
    this.env = env;
  }

  fetch(request: Request): Promise<Response> {
    return this.state.blockConcurrencyWhile(async () => {
      if (request.method !== 'POST') return new Response('Not found', { status: 404 });

      let allocation: SessionAllocationRequest;
      try {
        allocation = await request.json() as SessionAllocationRequest;
      } catch {
        return Response.json({
          success: false,
          code: 'SESSION_WRITE_FAILED',
          status: 500,
          message: 'Keyboardia could not save the session. Please try again.',
        } satisfies SessionAllocationResponse, { status: 500 });
      }

      const result = await this.allocate(allocation);
      return Response.json(result, { status: result.success ? 200 : result.status });
    });
  }

  /** Durable Object storage has no per-key TTL, so one alarm owns expiry. */
  alarm(): Promise<void> {
    return this.state.blockConcurrencyWhile(async () => {
      const now = Date.now();
      let nextExpiry: number | null = null;

      const rateWindows = await this.state.storage.list<RateWindow>({ prefix: 'rate:' });
      for (const [key, window] of rateWindows) {
        const expiresAt = window.windowStart + RATE_WINDOW_MS;
        if (expiresAt <= now) await this.state.storage.delete(key);
        else nextExpiry = nextExpiry === null ? expiresAt : Math.min(nextExpiry, expiresAt);
      }

      const reservations = await this.state.storage.list<IdempotencyReservation>({
        prefix: 'idempotency:create:',
      });
      for (const [key, reservation] of reservations) {
        if (reservation.expiresAt <= now) await this.state.storage.delete(key);
        else {
          nextExpiry = nextExpiry === null
            ? reservation.expiresAt
            : Math.min(nextExpiry, reservation.expiresAt);
        }
      }

      if (nextExpiry !== null) await this.state.storage.setAlarm(nextExpiry);
    });
  }

  private async scheduleCleanup(expiresAt: number): Promise<void> {
    const scheduled = await this.state.storage.getAlarm();
    if (scheduled === null || expiresAt < scheduled) {
      await this.state.storage.setAlarm(expiresAt);
    }
  }

  private async charge(clientIp?: string | null): Promise<SessionAllocationResponse | null> {
    if (!clientIp) return null;

    const now = Date.now();
    const key = `rate:${clientIp}`;
    const limit = resolveRateLimit(this.env, 'sessionCreate');
    const current = await this.state.storage.get<RateWindow>(key);

    if (!current || now - current.windowStart >= RATE_WINDOW_MS) {
      await this.state.storage.put(key, { count: 1, windowStart: now });
      await this.scheduleCleanup(now + RATE_WINDOW_MS);
      return null;
    }
    if (current.count >= limit) {
      return {
        success: false,
        code: 'RATE_LIMITED',
        status: 429,
        message: 'Too many sessions created. Please wait before creating another.',
        retryAfter: Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - current.windowStart)) / 1000)),
      };
    }

    await this.state.storage.put(key, { ...current, count: current.count + 1 });
    await this.scheduleCleanup(current.windowStart + RATE_WINDOW_MS);
    return null;
  }

  private async writeCreated(options: CreateSessionOptions): Promise<SessionAllocationResponse> {
    const result = await createSession(this.env, options);
    if (!result.success) {
      console.error('[SessionAllocator] create failed:', result.error);
      return publicWriteFailure(result);
    }
    return { success: true, session: result.data };
  }

  private async createIdempotently(
    request: Extract<SessionAllocationRequest, { operation: 'create' }>
  ): Promise<SessionAllocationResponse> {
    const reservationKey = `idempotency:create:${request.idempotencyKey}`;
    const now = Date.now();
    let reservation = await this.state.storage.get<IdempotencyReservation>(reservationKey);

    if (reservation && reservation.expiresAt > now) {
      await this.scheduleCleanup(reservation.expiresAt);
      const existing = await getSession(this.env, reservation.sessionId, false);
      if (existing) return { success: true, session: existing };

      // The UUID was already committed as the outcome of this key. Retry the
      // same write with the original options; never mint a replacement UUID.
      return this.writeCreated({ ...reservation.options, id: reservation.sessionId });
    }

    if (reservation) await this.state.storage.delete(reservationKey);
    const limited = await this.charge(request.clientIp);
    if (limited) return limited;

    reservation = {
      sessionId: crypto.randomUUID(),
      expiresAt: now + MCP_CREATE_IDEMPOTENCY_TTL_SECONDS * 1000,
      options: request.options,
    };

    // Commit the identity before performing the non-transactional KV write.
    // If this fails, no session has been allocated and the caller gets a fixed
    // error. If KV fails later, a retry finds this reservation and reuses it.
    try {
      await this.state.storage.put(reservationKey, reservation);
      await this.scheduleCleanup(reservation.expiresAt);
    } catch (error) {
      console.error('[SessionAllocator] idempotency reservation failed:', error);
      return {
        success: false,
        code: 'SESSION_WRITE_FAILED',
        status: 500,
        message: 'Keyboardia could not save the session. Please try again.',
      };
    }

    return this.writeCreated({ ...reservation.options, id: reservation.sessionId });
  }

  private async allocate(request: SessionAllocationRequest): Promise<SessionAllocationResponse> {
    if (request.operation === 'create' && request.idempotencyKey) {
      return this.createIdempotently(request);
    }

    if (request.operation === 'publish' && request.source.immutable) {
      return {
        success: false,
        code: 'ALREADY_PUBLISHED',
        status: 409,
        message: 'Cannot publish from an already-published session. Remix it first to create an editable copy.',
      };
    }

    const limited = await this.charge(request.clientIp);
    if (limited) return limited;

    let result: SessionResult<Session>;
    if (request.operation === 'create') {
      result = await createSession(this.env, request.options);
    } else if (request.operation === 'remix') {
      result = await remixSessionFromState(this.env, request.sourceId, request.source);
    } else {
      result = await publishSessionFromState(this.env, request.sourceId, request.source);
    }

    if (!result.success) {
      console.error(`[SessionAllocator] ${request.operation} failed:`, result.error);
      return publicWriteFailure(result);
    }
    return { success: true, session: result.data };
  }
}

export async function requestSessionAllocation(
  env: Env,
  allocation: SessionAllocationRequest
): Promise<SessionAllocationResponse> {
  const namespace = env.SESSION_ALLOCATOR as unknown as DurableObjectNamespaceLike;
  const stub = namespace.get(namespace.idFromName(ALLOCATOR_NAME));
  let response: Response;
  try {
    response = await stub.fetch(new Request('https://keyboardia.internal/allocate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(allocation),
    }));
  } catch (error) {
    console.error('[SessionAllocator] request failed:', error);
    return {
      success: false,
      code: 'SESSION_WRITE_FAILED',
      status: 500,
      message: 'Keyboardia could not save the session. Please try again.',
    };
  }

  try {
    return await response.json() as SessionAllocationResponse;
  } catch (error) {
    console.error('[SessionAllocator] unreadable response:', error);
    return {
      success: false,
      code: 'SESSION_WRITE_FAILED',
      status: 500,
      message: 'Keyboardia could not save the session. Please try again.',
    };
  }
}
