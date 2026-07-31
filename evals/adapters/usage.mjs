/**
 * skill-eval-harness accepts numeric usage telemetry (including nested numeric
 * counters), while provider CLIs may mix labels such as `service_tier` into
 * the same object. Drop non-numeric leaves at the adapter boundary so one
 * provider-specific label cannot abort an otherwise valid benchmark run.
 */
export function numericUsage(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const entries = Object.entries(value)
    .map(([key, child]) => [key, numericUsage(child)])
    .filter(([, child]) => child !== undefined);
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}
