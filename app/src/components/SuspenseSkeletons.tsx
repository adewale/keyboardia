/**
 * SuspenseSkeletons - Loading placeholders for lazy-loaded components
 * Phase 34: Prevents CLS during Suspense loading by matching component dimensions
 */

import './SuspenseSkeletons.css';

/**
 * SamplePickerSkeleton - Matches SamplePicker dimensions
 * Shows header + category placeholders to reserve vertical space
 */
export function SamplePickerSkeleton() {
  return (
    <div className="sample-picker-skeleton" aria-hidden="true">
      <div className="skeleton-header">
        <div className="skeleton-label" />
      </div>
      <div className="skeleton-categories">
        {/* 6 category placeholders to match CATEGORY_ORDER */}
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-category" />
        ))}
      </div>
    </div>
  );
}

/**
 * EffectsPanelSkeleton - Matches EffectsPanel toggle button
 * The panel is only a button in collapsed state
 */
export function EffectsPanelSkeleton() {
  return (
    <div className="effects-panel-skeleton" aria-hidden="true">
      <div className="skeleton-fx-toggle" />
    </div>
  );
}
