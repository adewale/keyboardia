/**
 * React Profiler instrumentation for performance analysis.
 *
 * Usage:
 *   1. Import and wrap components: <RenderProfiler id="StepSequencer"><StepSequencer /></RenderProfiler>
 *   2. Enable with ?profile=1 in URL
 *   3. View metrics in console or call window.__PROFILER_METRICS__ in DevTools
 *
 * Metrics collected:
 *   - Render count per component
 *   - Average/max/min render duration
 *   - Render frequency (renders per second)
 *   - Wasted renders (when actualDuration > 0 but baseDuration unchanged)
 */

import { Profiler, type ProfilerOnRenderCallback, type ReactNode } from 'react';
import { validateBudgets, printBudgetTable, PERFORMANCE_BUDGETS } from './performance-budgets';

// Check if profiling is enabled via URL param
const PROFILING_ENABLED = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('profile') === '1';

// Storage for metrics
interface ComponentMetrics {
  id: string;
  renderCount: number;
  totalDuration: number;
  maxDuration: number;
  minDuration: number;
  lastRenderTime: number;
  renderTimestamps: number[]; // Last 100 timestamps for frequency calculation
  baseDurations: number[]; // Last 10 base durations to detect wasted renders
  wastedRenders: number; // Renders where actualDuration > 0.1ms but nothing changed
}

const metricsStore = new Map<string, ComponentMetrics>();

// Expose metrics globally for DevTools access
if (PROFILING_ENABLED && typeof window !== 'undefined') {
  (window as Window & { __PROFILER_METRICS__?: () => Record<string, unknown> }).__PROFILER_METRICS__ = () => {
    const result: Record<string, unknown> = {};
    metricsStore.forEach((metrics, id) => {
      const now = Date.now();
      const recentRenders = metrics.renderTimestamps.filter(t => now - t < 1000);
      result[id] = {
        renderCount: metrics.renderCount,
        avgDuration: metrics.renderCount > 0 ? (metrics.totalDuration / metrics.renderCount).toFixed(3) : 0,
        maxDuration: metrics.maxDuration.toFixed(3),
        minDuration: metrics.minDuration === Infinity ? 0 : metrics.minDuration.toFixed(3),
        rendersPerSecond: recentRenders.length,
        wastedRenders: metrics.wastedRenders,
        wastedPercentage: metrics.renderCount > 0
          ? ((metrics.wastedRenders / metrics.renderCount) * 100).toFixed(1) + '%'
          : '0%',
      };
    });
    return result;
  };

  console.log('%c[RenderProfiler] Profiling ENABLED. Access metrics with window.__PROFILER_METRICS__()', 'color: #4CAF50; font-weight: bold');
}

const onRenderCallback: ProfilerOnRenderCallback = (
  id,
  phase,
  actualDuration,
  baseDuration,
  _startTime,
  _commitTime
) => {
  if (!PROFILING_ENABLED) return;

  const now = Date.now();

  let metrics = metricsStore.get(id);
  if (!metrics) {
    metrics = {
      id,
      renderCount: 0,
      totalDuration: 0,
      maxDuration: 0,
      minDuration: Infinity,
      lastRenderTime: now,
      renderTimestamps: [],
      baseDurations: [],
      wastedRenders: 0,
    };
    metricsStore.set(id, metrics);
  }

  // Update metrics
  metrics.renderCount++;
  metrics.totalDuration += actualDuration;
  metrics.maxDuration = Math.max(metrics.maxDuration, actualDuration);
  metrics.minDuration = Math.min(metrics.minDuration, actualDuration);
  metrics.lastRenderTime = now;

  // Track timestamps for frequency calculation (keep last 100)
  metrics.renderTimestamps.push(now);
  if (metrics.renderTimestamps.length > 100) {
    metrics.renderTimestamps.shift();
  }

  // Detect wasted renders (actualDuration > threshold but baseDuration stable)
  // A "wasted" render is one where React did work but nothing visual changed
  metrics.baseDurations.push(baseDuration);
  if (metrics.baseDurations.length > 10) {
    metrics.baseDurations.shift();
  }

  // If actualDuration is significant (>0.1ms) and baseDuration hasn't changed much,
  // this might be a wasted render due to unstable props
  if (actualDuration > 0.1 && metrics.baseDurations.length > 1) {
    const prevBaseDuration = metrics.baseDurations[metrics.baseDurations.length - 2];
    if (Math.abs(baseDuration - prevBaseDuration) < 0.01) {
      metrics.wastedRenders++;
    }
  }

  // Log significant renders (>1ms) or frequent renders
  const recentRenders = metrics.renderTimestamps.filter(t => now - t < 1000);
  if (actualDuration > 1 || recentRenders.length > 10) {
    const color = actualDuration > 5 ? '#f44336' : actualDuration > 1 ? '#ff9800' : '#4CAF50';
    console.log(
      `%c[Profiler] ${id} | ${phase} | ${actualDuration.toFixed(2)}ms | ${recentRenders.length}/sec`,
      `color: ${color}`
    );
  }
};

interface RenderProfilerProps {
  id: string;
  children: ReactNode;
}

/**
 * Wrapper component that profiles render performance.
 * Only active when ?profile=1 is in URL.
 */
export function RenderProfiler({ id, children }: RenderProfilerProps) {
  if (!PROFILING_ENABLED) {
    return <>{children}</>;
  }

  return (
    <Profiler id={id} onRender={onRenderCallback}>
      {children}
    </Profiler>
  );
}

/**
 * Get current metrics summary for all profiled components.
 */
export function getProfilerSummary(): string {
  if (!PROFILING_ENABLED) {
    return 'Profiling disabled. Enable with ?profile=1 in URL.';
  }

  const lines: string[] = ['=== React Render Profiler Summary ===', ''];

  metricsStore.forEach((metrics) => {
    const now = Date.now();
    const recentRenders = metrics.renderTimestamps.filter(t => now - t < 1000);
    const avgDuration = metrics.renderCount > 0 ? metrics.totalDuration / metrics.renderCount : 0;

    lines.push(`📊 ${metrics.id}`);
    lines.push(`   Renders: ${metrics.renderCount}`);
    lines.push(`   Avg Duration: ${avgDuration.toFixed(2)}ms`);
    lines.push(`   Max Duration: ${metrics.maxDuration.toFixed(2)}ms`);
    lines.push(`   Renders/sec: ${recentRenders.length}`);
    lines.push(`   Wasted Renders: ${metrics.wastedRenders} (${metrics.renderCount > 0 ? ((metrics.wastedRenders / metrics.renderCount) * 100).toFixed(1) : 0}%)`);
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Reset all profiler metrics.
 */
export function resetProfilerMetrics(): void {
  metricsStore.clear();
  console.log('%c[RenderProfiler] Metrics reset', 'color: #2196F3');
}

/**
 * Validate current metrics against performance budgets.
 * Returns violations array - empty if all budgets pass.
 */
export function validatePerformanceBudgets(): { component: string; violation: string }[] {
  if (!PROFILING_ENABLED) {
    return [{ component: 'Profiler', violation: 'Profiling disabled. Enable with ?profile=1' }];
  }

  const metrics: Record<string, { rendersPerSecond: number; wastedPercentage: string }> = {};
  const now = Date.now();

  metricsStore.forEach((m, id) => {
    const recentRenders = m.renderTimestamps.filter(t => now - t < 1000);
    metrics[id] = {
      rendersPerSecond: recentRenders.length,
      wastedPercentage: m.renderCount > 0
        ? ((m.wastedRenders / m.renderCount) * 100).toFixed(1) + '%'
        : '0%',
    };
  });

  return validateBudgets(metrics);
}

// Export for use in DevTools
if (PROFILING_ENABLED && typeof window !== 'undefined') {
  (window as Window & {
    __PROFILER_SUMMARY__?: () => void;
    __PROFILER_RESET__?: () => void;
    __PROFILER_VALIDATE__?: () => void;
    __PROFILER_BUDGETS__?: () => void;
    PERFORMANCE_BUDGETS?: typeof PERFORMANCE_BUDGETS;
  }).__PROFILER_SUMMARY__ = () => console.log(getProfilerSummary());
  (window as Window & { __PROFILER_RESET__?: () => void }).__PROFILER_RESET__ = resetProfilerMetrics;

  // Budget validation
  (window as Window & { __PROFILER_VALIDATE__?: () => void }).__PROFILER_VALIDATE__ = () => {
    const violations = validatePerformanceBudgets();
    if (violations.length === 0) {
      console.log('%c✅ All performance budgets PASS', 'color: #4CAF50; font-weight: bold');
    } else {
      console.log('%c❌ Performance budget violations:', 'color: #f44336; font-weight: bold');
      violations.forEach(v => {
        console.log(`   ${v.component}: ${v.violation}`);
      });
    }
  };

  // Show budgets
  (window as Window & { __PROFILER_BUDGETS__?: () => void }).__PROFILER_BUDGETS__ = printBudgetTable;

  // Expose budgets for programmatic access
  (window as Window & { PERFORMANCE_BUDGETS?: typeof PERFORMANCE_BUDGETS }).PERFORMANCE_BUDGETS = PERFORMANCE_BUDGETS;

  console.log('%c[RenderProfiler] Additional commands: __PROFILER_VALIDATE__(), __PROFILER_BUDGETS__()', 'color: #9E9E9E');
}
