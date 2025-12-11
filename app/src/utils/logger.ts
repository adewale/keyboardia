/**
 * Production-safe logger that only logs in development mode.
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
 */

const isDev = import.meta.env.DEV;

function createLogger(prefix?: string) {
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
      if (isDev) console.log(...formatMessage(args));
    },
    warn: (...args: unknown[]) => {
      if (isDev) console.warn(...formatMessage(args));
    },
    error: (...args: unknown[]) => {
      // Always log errors, even in production
      console.error(...formatMessage(args));
    },
    debug: (...args: unknown[]) => {
      if (isDev) console.debug(...formatMessage(args));
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
