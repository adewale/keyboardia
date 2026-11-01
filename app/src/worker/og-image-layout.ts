/**
 * Pure layout maths for the OG preview image.
 *
 * Split out of og-image.tsx because that module imports `workers-og`, which
 * loads a WASM binary at module scope and cannot be imported from a test. That
 * import barrier is why og-image.test.tsx previously carried its own copy of
 * condenseSteps, which had drifted from the original.
 */
export function condenseSteps(steps: boolean[], targetColumns: number): boolean[] {
  if (steps.length <= targetColumns) {
    return [...steps, ...Array(targetColumns - steps.length).fill(false)];
  }

  const ratio = steps.length / targetColumns;
  return Array.from({ length: targetColumns }, (_, i) => {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    return steps.slice(start, end).some(Boolean);
  });
}
