/**
 * Route Pattern Matching for Observability
 *
 * Maps API paths to route patterns and actions for the http_request event.
 * Patterns use :param notation for dynamic segments.
 */

export interface RouteMatch {
  pattern: string;
  action?: string;
}

/**
 * Route definitions with their patterns and actions
 */
interface RouteDefinition {
  pathRegex: RegExp;
  pattern: string;
  getAction: (method: string) => string | undefined;
}

const ROUTE_DEFINITIONS: RouteDefinition[] = [
  // Session create
  {
    pathRegex: /^\/api\/sessions\/?$/,
    pattern: '/api/sessions',
    getAction: (method) => method === 'POST' ? 'create' : undefined,
  },

  // Session CRUD
  {
    pathRegex: /^\/api\/sessions\/([^/]+)\/?$/,
    pattern: '/api/sessions/:id',
    getAction: (method) => {
      switch (method) {
        case 'GET': return 'access';
        case 'PUT':
        case 'PATCH': return 'update';
        case 'DELETE': return 'delete';
        default: return undefined;
      }
    },
  },

  // Session remix
  {
    pathRegex: /^\/api\/sessions\/([^/]+)\/remix\/?$/,
    pattern: '/api/sessions/:id/remix',
    getAction: () => 'remix',
  },

  // Session publish
  {
    pathRegex: /^\/api\/sessions\/([^/]+)\/publish\/?$/,
    pattern: '/api/sessions/:id/publish',
    getAction: () => 'publish',
  },

  // Session WebSocket
  {
    pathRegex: /^\/api\/sessions\/([^/]+)\/ws\/?$/,
    pattern: '/api/sessions/:id/ws',
    getAction: () => 'websocket',
  },

  // Debug endpoints
  {
    pathRegex: /^\/api\/debug\/logs\/?$/,
    pattern: '/api/debug/logs',
    getAction: () => 'debug_logs',
  },
  {
    pathRegex: /^\/api\/debug\/logs\/session\/([^/]+)\/?$/,
    pattern: '/api/debug/logs/session/:id',
    getAction: () => 'debug_session_logs',
  },
  {
    pathRegex: /^\/api\/debug\/metrics\/?$/,
    pattern: '/api/debug/metrics',
    getAction: () => 'debug_metrics',
  },
  {
    pathRegex: /^\/api\/debug\/session\/([^/]+)\/?$/,
    pattern: '/api/debug/session/:id',
    getAction: () => 'debug_session',
  },
  {
    pathRegex: /^\/api\/debug\/session\/([^/]+)\/live\/?$/,
    pattern: '/api/debug/session/:id/live',
    getAction: () => 'debug_live',
  },

  // Health check
  {
    pathRegex: /^\/api\/health\/?$/,
    pattern: '/api/health',
    getAction: () => 'health',
  },

  // Samples endpoint
  {
    pathRegex: /^\/api\/samples\/([^/]+)\/?$/,
    pattern: '/api/samples/:id',
    getAction: (method) => method === 'GET' ? 'sample_access' : undefined,
  },
];

/**
 * Match a path and method to a route pattern and action
 */
export function matchRoute(path: string, method: string): RouteMatch {
  for (const route of ROUTE_DEFINITIONS) {
    if (route.pathRegex.test(path)) {
      return {
        pattern: route.pattern,
        action: route.getAction(method),
      };
    }
  }

  // Unknown route
  return {
    pattern: path, // Use actual path as pattern for unknown routes
    action: undefined,
  };
}

/**
 * Extract session ID from a path if present
 */
export function extractSessionId(path: string): string | undefined {
  // Match /api/sessions/:id and /api/sessions/:id/*
  const match = path.match(/^\/api\/sessions\/([^/]+)/);
  return match ? match[1] : undefined;
}
