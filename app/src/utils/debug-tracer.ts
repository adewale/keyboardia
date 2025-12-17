/**
 * Debug Tracer - Structured Observability for Local Development
 *
 * This module provides a comprehensive tracing system for debugging audio
 * and playback issues. It offers:
 *
 * 1. Correlation IDs - Track operations across module boundaries
 * 2. Spans - Measure duration of operations
 * 3. Structured Events - Rich context for each event
 * 4. Event Correlation - Group related events together
 * 5. Export/Analysis - Dump traces for offline analysis
 *
 * Usage:
 *   // Enable tracing
 *   window.__DEBUG_TRACE__ = true
 *
 *   // In code
 *   const span = tracer.startSpan('scheduler.scheduleStep', { step: 5 });
 *   // ... do work
 *   span.end({ notesScheduled: 3 });
 *
 *   // View traces
 *   window.__getTraces__()
 *   window.__exportTraces__()
 *   window.__clearTraces__()
 *
 *   // Filter traces
 *   window.__filterTraces__('scheduler')
 *   window.__getSpanStats__()
 */

// Global type declarations
declare global {
  interface Window {
    __DEBUG_TRACE__: boolean;
    __TRACE_FILTER__: string | null;
    __getTraces__: () => TraceEvent[];
    __exportTraces__: () => string;
    __clearTraces__: () => void;
    __filterTraces__: (filter: string) => TraceEvent[];
    __getSpanStats__: () => SpanStats[];
    __getCorrelation__: (id: string) => TraceEvent[];
    __tracer__: DebugTracer;
  }
}

/**
 * Trace event types for categorization
 */
export type TraceEventType =
  | 'span_start'
  | 'span_end'
  | 'event'
  | 'error'
  | 'warning'
  | 'state_change'
  | 'assertion';

/**
 * Trace event structure
 */
export interface TraceEvent {
  id: string;
  correlationId: string;
  parentSpanId?: string;
  type: TraceEventType;
  category: string;
  name: string;
  timestamp: number;
  audioTime?: number;
  duration?: number;
  data: Record<string, unknown>;
  stack?: string;
}

/**
 * Span statistics for performance analysis
 */
export interface SpanStats {
  name: string;
  count: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
}

/**
 * Active span for tracking operation duration
 */
export interface Span {
  id: string;
  correlationId: string;
  name: string;
  startTime: number;
  audioStartTime?: number;
  data: Record<string, unknown>;
  end: (additionalData?: Record<string, unknown>) => void;
  addEvent: (name: string, data?: Record<string, unknown>) => void;
}

// Internal storage
const traces: TraceEvent[] = [];
const activeSpans: Map<string, Span> = new Map();
const MAX_TRACES = 10000;

// ID generation
let eventIdCounter = 0;
let correlationIdCounter = 0;

function generateEventId(): string {
  return `evt_${++eventIdCounter}`;
}

function generateCorrelationId(): string {
  return `cor_${++correlationIdCounter}_${Date.now().toString(36)}`;
}

/**
 * Check if tracing is enabled
 */
function isTracingEnabled(): boolean {
  return typeof window !== 'undefined' && window.__DEBUG_TRACE__ === true;
}

/**
 * Get current audio context time if available
 */
function getAudioTime(): number | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const engine = (window as any).__audioEngine__;
    if (engine?.audioContext) {
      return engine.audioContext.currentTime;
    }
  } catch {
    // Ignore
  }
  return undefined;
}

/**
 * Add a trace event
 */
function addTrace(event: TraceEvent): void {
  if (!isTracingEnabled()) return;

  // Apply filter if set
  const filter = window.__TRACE_FILTER__;
  if (filter && !event.category.includes(filter) && !event.name.includes(filter)) {
    return;
  }

  traces.push(event);

  // Keep bounded
  if (traces.length > MAX_TRACES) {
    traces.shift();
  }

  // Console output for immediate visibility
  const prefix = event.type === 'error' ? '❌' :
                 event.type === 'warning' ? '⚠️' :
                 event.type === 'span_start' ? '▶️' :
                 event.type === 'span_end' ? '⏹️' :
                 event.type === 'assertion' ? '🔍' :
                 '📍';

  const duration = event.duration !== undefined ? ` (${event.duration.toFixed(2)}ms)` : '';
  const audioTime = event.audioTime !== undefined ? ` @${event.audioTime.toFixed(3)}s` : '';

  console.log(
    `${prefix} [${event.category}] ${event.name}${duration}${audioTime}`,
    event.data
  );

  // Persist to log store if enabled (async, non-blocking)
  persistTraceEvent(event);
}

/**
 * Persist trace event to log store for post-mortem analysis
 */
function persistTraceEvent(event: TraceEvent): void {
  // Check if persistence is enabled (lazy import to avoid circular deps)
  if (typeof window === 'undefined' || !window.__LOG_PERSIST__) return;

  // Map trace type to log level
  const level = event.type === 'error' ? 'error' :
                event.type === 'warning' ? 'warn' :
                'debug';

  // Dynamically import to avoid circular dependency
  import('./log-store').then(({ storeLog }) => {
    storeLog(
      level,
      `trace:${event.category}`,
      event.name,
      {
        traceId: event.id,
        correlationId: event.correlationId,
        parentSpanId: event.parentSpanId,
        eventType: event.type,
        duration: event.duration,
        audioTime: event.audioTime,
        ...event.data,
      },
      event.stack
    ).catch(() => {
      // Silently ignore - logging should never break the app
    });
  }).catch(() => {
    // Module not loaded yet, skip persistence
  });
}

/**
 * Debug Tracer API
 */
export const tracer = {
  /**
   * Start a new span for measuring operation duration
   */
  startSpan(
    name: string,
    data: Record<string, unknown> = {},
    options: { correlationId?: string; parentSpanId?: string; category?: string } = {}
  ): Span {
    const id = generateEventId();
    const correlationId = options.correlationId || generateCorrelationId();
    const category = options.category || name.split('.')[0] || 'general';
    const startTime = performance.now();
    const audioStartTime = getAudioTime();

    const span: Span = {
      id,
      correlationId,
      name,
      startTime,
      audioStartTime,
      data,

      end(additionalData?: Record<string, unknown>): void {
        const endTime = performance.now();
        const duration = endTime - startTime;
        const audioEndTime = getAudioTime();

        addTrace({
          id: generateEventId(),
          correlationId,
          parentSpanId: options.parentSpanId,
          type: 'span_end',
          category,
          name,
          timestamp: Date.now(),
          audioTime: audioEndTime,
          duration,
          data: { ...data, ...additionalData },
        });

        activeSpans.delete(id);
      },

      addEvent(eventName: string, eventData?: Record<string, unknown>): void {
        addTrace({
          id: generateEventId(),
          correlationId,
          parentSpanId: id,
          type: 'event',
          category,
          name: `${name}.${eventName}`,
          timestamp: Date.now(),
          audioTime: getAudioTime(),
          data: eventData || {},
        });
      },
    };

    // Record span start
    addTrace({
      id,
      correlationId,
      parentSpanId: options.parentSpanId,
      type: 'span_start',
      category,
      name,
      timestamp: Date.now(),
      audioTime: audioStartTime,
      data,
    });

    activeSpans.set(id, span);
    return span;
  },

  /**
   * Record a simple event (no duration)
   */
  event(
    category: string,
    name: string,
    data: Record<string, unknown> = {},
    correlationId?: string
  ): void {
    addTrace({
      id: generateEventId(),
      correlationId: correlationId || generateCorrelationId(),
      type: 'event',
      category,
      name,
      timestamp: Date.now(),
      audioTime: getAudioTime(),
      data,
    });
  },

  /**
   * Record an error
   */
  error(
    category: string,
    name: string,
    error: Error | string,
    data: Record<string, unknown> = {},
    correlationId?: string
  ): void {
    addTrace({
      id: generateEventId(),
      correlationId: correlationId || generateCorrelationId(),
      type: 'error',
      category,
      name,
      timestamp: Date.now(),
      audioTime: getAudioTime(),
      data: {
        ...data,
        error: error instanceof Error ? error.message : error,
      },
      stack: error instanceof Error ? error.stack : new Error().stack,
    });
  },

  /**
   * Record a warning
   */
  warning(
    category: string,
    name: string,
    message: string,
    data: Record<string, unknown> = {},
    correlationId?: string
  ): void {
    addTrace({
      id: generateEventId(),
      correlationId: correlationId || generateCorrelationId(),
      type: 'warning',
      category,
      name,
      timestamp: Date.now(),
      audioTime: getAudioTime(),
      data: { ...data, message },
    });
  },

  /**
   * Record a state change
   */
  stateChange(
    category: string,
    name: string,
    before: unknown,
    after: unknown,
    correlationId?: string
  ): void {
    addTrace({
      id: generateEventId(),
      correlationId: correlationId || generateCorrelationId(),
      type: 'state_change',
      category,
      name,
      timestamp: Date.now(),
      audioTime: getAudioTime(),
      data: { before, after },
    });
  },

  /**
   * Record an assertion check
   */
  assertion(
    category: string,
    name: string,
    condition: boolean,
    data: Record<string, unknown> = {},
    correlationId?: string
  ): boolean {
    if (!condition) {
      addTrace({
        id: generateEventId(),
        correlationId: correlationId || generateCorrelationId(),
        type: 'assertion',
        category,
        name: `ASSERTION FAILED: ${name}`,
        timestamp: Date.now(),
        audioTime: getAudioTime(),
        data,
        stack: new Error().stack,
      });
    }
    return condition;
  },

  /**
   * Create a correlation context for grouping related events
   */
  createCorrelation(name: string): string {
    const id = generateCorrelationId();
    tracer.event('correlation', `created: ${name}`, { name }, id);
    return id;
  },

  /**
   * Get all active spans
   */
  getActiveSpans(): Map<string, Span> {
    return new Map(activeSpans);
  },
};

/**
 * Calculate span statistics
 */
function calculateSpanStats(): SpanStats[] {
  const spanMap = new Map<string, { durations: number[] }>();

  for (const event of traces) {
    if (event.type === 'span_end' && event.duration !== undefined) {
      const stats = spanMap.get(event.name) || { durations: [] };
      stats.durations.push(event.duration);
      spanMap.set(event.name, stats);
    }
  }

  return Array.from(spanMap.entries()).map(([name, { durations }]) => ({
    name,
    count: durations.length,
    totalDuration: durations.reduce((a, b) => a + b, 0),
    avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
    minDuration: Math.min(...durations),
    maxDuration: Math.max(...durations),
  })).sort((a, b) => b.totalDuration - a.totalDuration);
}

/**
 * Initialize global debug interface
 */
export function initDebugTracer(): void {
  if (typeof window === 'undefined') return;

  window.__DEBUG_TRACE__ = false;
  window.__TRACE_FILTER__ = null;
  window.__tracer__ = tracer as unknown as DebugTracer;

  window.__getTraces__ = () => [...traces];

  window.__exportTraces__ = () => {
    const exportData = {
      exportedAt: new Date().toISOString(),
      traceCount: traces.length,
      traces: traces,
      spanStats: calculateSpanStats(),
    };
    return JSON.stringify(exportData, null, 2);
  };

  window.__clearTraces__ = () => {
    traces.length = 0;
    console.log('Traces cleared');
  };

  window.__filterTraces__ = (filter: string) => {
    return traces.filter(
      t => t.category.includes(filter) || t.name.includes(filter)
    );
  };

  window.__getSpanStats__ = calculateSpanStats;

  window.__getCorrelation__ = (id: string) => {
    return traces.filter(t => t.correlationId === id);
  };

  console.log(`
🔍 Debug Tracer Initialized
   Enable:  window.__DEBUG_TRACE__ = true
   Filter:  window.__TRACE_FILTER__ = 'scheduler'
   View:    window.__getTraces__()
   Export:  window.__exportTraces__()
   Clear:   window.__clearTraces__()
   Stats:   window.__getSpanStats__()
  `);
}

// Type for window exposure
type DebugTracer = typeof tracer;
