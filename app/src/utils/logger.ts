/**
 * Production-safe logger that only logs in development mode.
 * Logs are also persisted to IndexedDB for post-mortem debugging.
 *
 * Usage:
 *   import { logger } from '../utils/logger';
 *   logger.log('message');           // Only in dev
 *   logger.warn('warning');          // Only in dev
 *   logger.error('error');           // Always logs (errors are important)
 *   logger.debug('debug info');      // Only in dev
 *
 * For WebSocket-specific logging:
 *   logger.ws('Connected');          // [WS] prefix, only in dev
 *
 * For audio-specific logging:
 *   logger.audio('Playing sample');  // [Audio] prefix, only in dev
 *
 * Logs are automatically persisted when window.__LOG_PERSIST__ = true
 * Query persisted logs with:
 *   await __getRecentLogs__(100)
 *   await __queryLogs__({ level: 'error', category: 'Audio' })
 *   await __searchLogs__('AudioContext')
 */

import { storeLog, isPersistenceEnabled, type LogLevel } from './log-store';

const isDev = import.meta.env.DEV;

/**
 * Persist a log entry to IndexedDB (async, non-blocking)
 */
function persistLog(
  level: LogLevel,
  category: string,
  args: unknown[]
): void {
  if (!isPersistenceEnabled()) return;

  try {
    // Extract message and data from args
    const message = args.map(arg =>
      typeof arg === 'string' ? arg :
      typeof arg === 'object' ? JSON.stringify(arg) :
      String(arg)
    ).join(' ');

    // Extract structured data if present
    const data = args.length > 1 && typeof args[args.length - 1] === 'object'
      ? args[args.length - 1] as Record<string, unknown>
      : undefined;

    // Capture stack for errors
    const stack = level === 'error' ? new Error().stack : undefined;

    // Store asynchronously (fire and forget)
    storeLog(level, category, message, data, stack).catch(() => {
      // Silently ignore storage errors - logging should never break the app
    });
  } catch {
    // Never throw from logging
  }
}

function createLogger(prefix?: string) {
  const category = prefix?.replace(/[[\]]/g, '') || 'General';

  const formatMessage = (args: unknown[]): unknown[] => {
    if (prefix) {
      const first = args[0];
      if (typeof first === 'string') {
        return [`${prefix} ${first}`, ...args.slice(1)];
      }
      return [prefix, ...args];
    }
    return args;
  };

  return {
    log: (...args: unknown[]) => {
      if (isDev) {
        console.log(...formatMessage(args));
        persistLog('log', category, args);
      }
    },
    warn: (...args: unknown[]) => {
      if (isDev) {
        console.warn(...formatMessage(args));
        persistLog('warn', category, args);
      }
    },
    error: (...args: unknown[]) => {
      // Always log errors, even in production
      console.error(...formatMessage(args));
      persistLog('error', category, args);
    },
    debug: (...args: unknown[]) => {
      if (isDev) {
        console.debug(...formatMessage(args));
        persistLog('debug', category, args);
      }
    },
  };
}

// Main logger (no prefix)
export const logger = {
  ...createLogger(),

  // Prefixed loggers for specific subsystems
  ws: createLogger('[WS]'),
  audio: createLogger('[Audio]'),
  multiplayer: createLogger('[Multiplayer]'),
  session: createLogger('[Session]'),
};

// Also export isDev for conditional blocks
export { isDev };
