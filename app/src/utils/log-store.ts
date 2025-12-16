/**
 * Persistent Log Store
 *
 * Stores logs in IndexedDB for post-mortem debugging. Logs survive page refresh
 * and can be queried, filtered, and exported for analysis.
 *
 * Usage:
 *   // Logs are automatically captured when enabled
 *   window.__LOG_PERSIST__ = true
 *
 *   // Query logs
 *   await window.__queryLogs__({ category: 'audio', level: 'error' })
 *
 *   // Export to file
 *   await window.__exportLogsToFile__()
 *
 *   // Get recent logs
 *   await window.__getRecentLogs__(100)
 *
 *   // Clear all logs
 *   await window.__clearAllLogs__()
 */

const DB_NAME = 'keyboardia-logs';
const DB_VERSION = 1;
const STORE_NAME = 'logs';

// Size limits based on community best practices research:
// - 10,000 logs is recommended for dev logging (sufficient for debugging)
// - Time-based expiration: 24h for debug/info, 7 days for errors
// - Cleanup threshold slightly above max to batch deletions
const MAX_LOGS = 10000;
const CLEANUP_THRESHOLD = 12000;
// Target max 20MB for log database (enforced via MAX_LOGS and TTL limits)

// Time-to-live by log level (milliseconds)
const TTL_BY_LEVEL: Record<LogLevel, number> = {
  debug: 24 * 60 * 60 * 1000,      // 24 hours
  log: 24 * 60 * 60 * 1000,        // 24 hours
  warn: 3 * 24 * 60 * 60 * 1000,   // 3 days
  error: 7 * 24 * 60 * 60 * 1000,  // 7 days
};

export type LogLevel = 'debug' | 'log' | 'warn' | 'error';

export interface StoredLog {
  id?: number; // Auto-incremented by IndexedDB
  timestamp: number;
  level: LogLevel;
  category: string;
  message: string;
  data?: Record<string, unknown>;
  sessionId: string;
  url: string;
  stack?: string;
}

export interface LogQuery {
  level?: LogLevel | LogLevel[];
  category?: string | string[];
  search?: string;
  startTime?: number;
  endTime?: number;
  sessionId?: string;
  limit?: number;
  offset?: number;
}

export interface LogStats {
  totalLogs: number;
  byLevel: Record<LogLevel, number>;
  byCategory: Record<string, number>;
  oldestLog: number | null;
  newestLog: number | null;
  sessions: string[];
}

// Generate a session ID for this page load
const SESSION_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// IndexedDB instance
let db: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open the IndexedDB database
 */
function openDatabase(): Promise<IDBDatabase> {
  if (db) return Promise.resolve(db);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('Failed to open log database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      // Create logs object store with indexes
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, {
          keyPath: 'id',
          autoIncrement: true,
        });

        // Indexes for efficient querying
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('level', 'level', { unique: false });
        store.createIndex('category', 'category', { unique: false });
        store.createIndex('sessionId', 'sessionId', { unique: false });
        store.createIndex('level_timestamp', ['level', 'timestamp'], { unique: false });
        store.createIndex('category_timestamp', ['category', 'timestamp'], { unique: false });
      }
    };
  });

  return dbPromise;
}

/**
 * Store a log entry
 */
export async function storeLog(
  level: LogLevel,
  category: string,
  message: string,
  data?: Record<string, unknown>,
  stack?: string
): Promise<void> {
  try {
    const database = await openDatabase();

    const log: StoredLog = {
      timestamp: Date.now(),
      level,
      category,
      message,
      data,
      sessionId: SESSION_ID,
      url: typeof window !== 'undefined' ? window.location.href : '',
      stack,
    };

    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    store.add(log);

    // Trigger cleanup if needed (async, don't wait)
    cleanupOldLogs().catch(() => {});
  } catch (error) {
    // Don't throw - logging should never break the app
    console.error('Failed to store log:', error);
  }
}

/**
 * Query logs with filters
 */
export async function queryLogs(query: LogQuery = {}): Promise<StoredLog[]> {
  const database = await openDatabase();
  const results: StoredLog[] = [];

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    // Use appropriate index based on query
    let request: IDBRequest;

    if (query.level && !Array.isArray(query.level) && !query.category) {
      // Query by level
      const index = store.index('level_timestamp');
      const range = query.startTime || query.endTime
        ? IDBKeyRange.bound(
            [query.level, query.startTime || 0],
            [query.level, query.endTime || Date.now()]
          )
        : IDBKeyRange.only(query.level);
      request = index.openCursor(range, 'prev');
    } else if (query.category && !Array.isArray(query.category) && !query.level) {
      // Query by category
      const index = store.index('category_timestamp');
      const range = query.startTime || query.endTime
        ? IDBKeyRange.bound(
            [query.category, query.startTime || 0],
            [query.category, query.endTime || Date.now()]
          )
        : null;
      request = index.openCursor(range, 'prev');
    } else {
      // Full scan with timestamp range
      const index = store.index('timestamp');
      const range = query.startTime || query.endTime
        ? IDBKeyRange.bound(query.startTime || 0, query.endTime || Date.now())
        : null;
      request = index.openCursor(range, 'prev');
    }

    const limit = query.limit || 1000;
    const offset = query.offset || 0;
    let skipped = 0;

    request.onsuccess = () => {
      const cursor = request.result;

      if (cursor && results.length < limit) {
        const log = cursor.value as StoredLog;

        // Apply filters
        let matches = true;

        if (query.level) {
          const levels = Array.isArray(query.level) ? query.level : [query.level];
          matches = matches && levels.includes(log.level);
        }

        if (query.category) {
          const categories = Array.isArray(query.category) ? query.category : [query.category];
          matches = matches && categories.some(c => log.category.includes(c));
        }

        if (query.search) {
          const searchLower = query.search.toLowerCase();
          matches = matches && (
            log.message.toLowerCase().includes(searchLower) ||
            log.category.toLowerCase().includes(searchLower) ||
            JSON.stringify(log.data || {}).toLowerCase().includes(searchLower)
          );
        }

        if (query.sessionId) {
          matches = matches && log.sessionId === query.sessionId;
        }

        if (matches) {
          if (skipped < offset) {
            skipped++;
          } else {
            results.push(log);
          }
        }

        cursor.continue();
      } else {
        resolve(results);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Get recent logs (most recent first)
 */
export async function getRecentLogs(count: number = 100): Promise<StoredLog[]> {
  return queryLogs({ limit: count });
}

/**
 * Get logs from current session
 */
export async function getCurrentSessionLogs(): Promise<StoredLog[]> {
  return queryLogs({ sessionId: SESSION_ID, limit: 10000 });
}

/**
 * Get log statistics
 */
export async function getLogStats(): Promise<LogStats> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const stats: LogStats = {
      totalLogs: 0,
      byLevel: { debug: 0, log: 0, warn: 0, error: 0 },
      byCategory: {},
      oldestLog: null,
      newestLog: null,
      sessions: [],
    };

    const sessionsSet = new Set<string>();

    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;

      if (cursor) {
        const log = cursor.value as StoredLog;
        stats.totalLogs++;
        stats.byLevel[log.level]++;
        stats.byCategory[log.category] = (stats.byCategory[log.category] || 0) + 1;
        sessionsSet.add(log.sessionId);

        if (stats.oldestLog === null || log.timestamp < stats.oldestLog) {
          stats.oldestLog = log.timestamp;
        }
        if (stats.newestLog === null || log.timestamp > stats.newestLog) {
          stats.newestLog = log.timestamp;
        }

        cursor.continue();
      } else {
        stats.sessions = Array.from(sessionsSet);
        resolve(stats);
      }
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Cleanup old logs using TTL-based expiration and count limits.
 * Uses requestIdleCallback when available for non-blocking cleanup.
 */
async function cleanupOldLogs(): Promise<void> {
  // Use requestIdleCallback if available to avoid blocking main thread
  if (typeof requestIdleCallback !== 'undefined') {
    return new Promise((resolve) => {
      requestIdleCallback(async () => {
        await performCleanup();
        resolve();
      }, { timeout: 5000 }); // Max 5s delay
    });
  } else {
    return performCleanup();
  }
}

/**
 * Perform the actual cleanup operation
 */
async function performCleanup(): Promise<void> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // Count total logs
    const countRequest = store.count();

    countRequest.onsuccess = () => {
      const count = countRequest.result;
      const now = Date.now();
      let deleted = 0;

      // First pass: Delete expired logs by TTL
      const index = store.index('timestamp');
      const expiredRequest = index.openCursor();

      expiredRequest.onsuccess = () => {
        const cursor = expiredRequest.result;

        if (cursor) {
          const log = cursor.value as StoredLog;
          const ttl = TTL_BY_LEVEL[log.level] || TTL_BY_LEVEL.log;
          const age = now - log.timestamp;

          if (age > ttl) {
            store.delete(cursor.primaryKey);
            deleted++;
          }

          // Continue until we've checked enough or deleted enough
          if (deleted < 1000) {
            cursor.continue();
          } else {
            finishCleanup();
          }
        } else {
          finishCleanup();
        }
      };

      function finishCleanup() {
        // Second pass: If still over threshold, delete oldest
        if (count - deleted > CLEANUP_THRESHOLD) {
          const toDelete = Math.min(count - deleted - MAX_LOGS, 500); // Batch of 500
          const oldestRequest = index.openCursor();
          let countDeleted = 0;

          oldestRequest.onsuccess = () => {
            const cursor = oldestRequest.result;
            if (cursor && countDeleted < toDelete) {
              store.delete(cursor.primaryKey);
              countDeleted++;
              deleted++;
              cursor.continue();
            } else {
              if (deleted > 0) {
                console.log(`[Log Store] Cleanup: deleted ${deleted} logs (TTL + overflow)`);
              }
              resolve();
            }
          };

          oldestRequest.onerror = () => reject(oldestRequest.error);
        } else {
          if (deleted > 0) {
            console.log(`[Log Store] Cleanup: deleted ${deleted} expired logs`);
          }
          resolve();
        }
      }

      expiredRequest.onerror = () => reject(expiredRequest.error);
    };

    countRequest.onerror = () => reject(countRequest.error);
  });
}

/**
 * Clear all logs
 */
export async function clearAllLogs(): Promise<void> {
  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      console.log('All logs cleared');
      resolve();
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Export logs to a downloadable JSON file
 */
export async function exportLogsToFile(query?: LogQuery): Promise<void> {
  const logs = await queryLogs({ ...query, limit: 100000 });
  const stats = await getLogStats();

  const exportData = {
    exportedAt: new Date().toISOString(),
    currentSessionId: SESSION_ID,
    stats,
    logs,
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json',
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `keyboardia-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(`Exported ${logs.length} logs to file`);
}

/**
 * Get logs from last N minutes
 */
export async function getLogsFromLastMinutes(minutes: number): Promise<StoredLog[]> {
  const startTime = Date.now() - minutes * 60 * 1000;
  return queryLogs({ startTime, limit: 10000 });
}

/**
 * Search logs by text
 */
export async function searchLogs(searchText: string, limit: number = 100): Promise<StoredLog[]> {
  return queryLogs({ search: searchText, limit });
}

// Global interface declarations
declare global {
  interface Window {
    __LOG_PERSIST__: boolean;
    __queryLogs__: typeof queryLogs;
    __getRecentLogs__: typeof getRecentLogs;
    __getCurrentSessionLogs__: typeof getCurrentSessionLogs;
    __getLogStats__: typeof getLogStats;
    __clearAllLogs__: typeof clearAllLogs;
    __exportLogsToFile__: typeof exportLogsToFile;
    __getLogsFromLastMinutes__: typeof getLogsFromLastMinutes;
    __searchLogs__: typeof searchLogs;
    __LOG_SESSION_ID__: string;
  }
}

/**
 * Initialize the log store and global interface
 */
export function initLogStore(): void {
  if (typeof window === 'undefined') return;

  // Enable persistence by default in dev mode
  window.__LOG_PERSIST__ = true;
  window.__LOG_SESSION_ID__ = SESSION_ID;

  // Expose query functions
  window.__queryLogs__ = queryLogs;
  window.__getRecentLogs__ = getRecentLogs;
  window.__getCurrentSessionLogs__ = getCurrentSessionLogs;
  window.__getLogStats__ = getLogStats;
  window.__clearAllLogs__ = clearAllLogs;
  window.__exportLogsToFile__ = exportLogsToFile;
  window.__getLogsFromLastMinutes__ = getLogsFromLastMinutes;
  window.__searchLogs__ = searchLogs;

  // Pre-open the database
  openDatabase().then(() => {
    console.log(`
📁 Log Store Initialized (Session: ${SESSION_ID})
   Query:     await __queryLogs__({ level: 'error', category: 'audio' })
   Recent:    await __getRecentLogs__(100)
   Session:   await __getCurrentSessionLogs__()
   Stats:     await __getLogStats__()
   Search:    await __searchLogs__('AudioContext')
   Last 5min: await __getLogsFromLastMinutes__(5)
   Export:    await __exportLogsToFile__()
   Clear:     await __clearAllLogs__()
    `);
  }).catch(err => {
    console.error('Failed to initialize log store:', err);
  });
}

/**
 * Check if persistence is enabled
 */
export function isPersistenceEnabled(): boolean {
  return typeof window !== 'undefined' && window.__LOG_PERSIST__ === true;
}

/**
 * Get current session ID
 */
export function getSessionId(): string {
  return SESSION_ID;
}
