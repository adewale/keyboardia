/**
 * Performance Budgets Configuration
 *
 * Central place to define and track performance budgets.
 * Used by both the RenderProfiler and performance tests.
 *
 * To update budgets:
 * 1. Run profiling: npm run dev, then visit /?profile=1
 * 2. Interact with the app and check window.__PROFILER_METRICS__()
 * 3. Update budgets here with justification in comments
 * 4. Run tests: npm run test:perf
 */

export interface RenderBudget {
  /** Maximum renders per second during playback */
  maxRendersPerSecond: number;
  /** Maximum acceptable wasted render percentage */
  maxWastedRenderPercent: number;
  /** Brief description of why this component renders */
  renderReason: string;
}

/**
 * Performance budgets per component.
 *
 * These are enforced during profiling and CI.
 * Exceeding these budgets indicates a performance regression.
 */
export const PERFORMANCE_BUDGETS: Record<string, RenderBudget> = {
  StepSequencer: {
    maxRendersPerSecond: 10,
    maxWastedRenderPercent: 20,
    renderReason: 'Re-renders on state changes, currentStep updates (8×/sec at 120 BPM)',
  },

  TrackRow: {
    maxRendersPerSecond: 2,
    maxWastedRenderPercent: 10,
    renderReason: 'Only re-renders when its specific track changes (memoized)',
  },

  StepCell: {
    maxRendersPerSecond: 2,
    maxWastedRenderPercent: 5,
    renderReason: 'Only re-renders when step active/playing state changes (memoized)',
  },

  ChromaticGrid: {
    maxRendersPerSecond: 2,
    maxWastedRenderPercent: 10,
    renderReason: 'Only visible when synth track expanded (memoized)',
  },

  Transport: {
    maxRendersPerSecond: 10,
    maxWastedRenderPercent: 30,
    renderReason: 'Updates on play/pause, tempo, swing changes',
  },

  CursorOverlay: {
    maxRendersPerSecond: 20,
    maxWastedRenderPercent: 50,
    renderReason: 'Intentionally re-renders for cursor fade animation (500ms tick)',
  },
};

/**
 * Validate profiler metrics against budgets.
 * Returns array of violations for CI/testing.
 */
export function validateBudgets(
  metrics: Record<string, {
    rendersPerSecond: number;
    wastedPercentage: string;
  }>
): { component: string; violation: string }[] {
  const violations: { component: string; violation: string }[] = [];

  for (const [componentId, data] of Object.entries(metrics)) {
    // Extract base component name (e.g., "TrackRow-track-1" -> "TrackRow")
    const baseName = componentId.split('-')[0];
    const budget = PERFORMANCE_BUDGETS[baseName];

    if (!budget) continue; // No budget defined for this component

    if (data.rendersPerSecond > budget.maxRendersPerSecond) {
      violations.push({
        component: componentId,
        violation: `Renders/sec ${data.rendersPerSecond} exceeds budget ${budget.maxRendersPerSecond}`,
      });
    }

    const wastedPercent = parseFloat(data.wastedPercentage);
    if (wastedPercent > budget.maxWastedRenderPercent) {
      violations.push({
        component: componentId,
        violation: `Wasted renders ${wastedPercent}% exceeds budget ${budget.maxWastedRenderPercent}%`,
      });
    }
  }

  return violations;
}

/**
 * Print budgets as a formatted table for documentation.
 */
export function printBudgetTable(): void {
  console.log('\n📊 Performance Budgets\n');
  console.log('| Component | Max Renders/sec | Max Wasted % | Reason |');
  console.log('|-----------|-----------------|--------------|--------|');

  for (const [name, budget] of Object.entries(PERFORMANCE_BUDGETS)) {
    console.log(
      `| ${name.padEnd(11)} | ${String(budget.maxRendersPerSecond).padEnd(15)} | ${String(budget.maxWastedRenderPercent + '%').padEnd(12)} | ${budget.renderReason} |`
    );
  }
  console.log('');
}
