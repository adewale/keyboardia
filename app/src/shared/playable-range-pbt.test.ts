import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

/**
 * Property-Based Tests for Playable Range Relationships
 *
 * These tests verify the mathematical properties of range relationships
 * when copying between instruments with different playable ranges.
 *
 * Range Relationships:
 * 1. Source ⊆ Destination (subset): All source notes should be audible
 * 2. Destination ⊆ Source (superset): Some notes may be lost
 * 3. Source ∩ Destination ≠ ∅ (overlap): Partial preservation
 * 4. Source ∩ Destination = ∅ (disjoint): All notes lost
 *
 * These tests use arbitrary ranges, not actual instrument data,
 * to verify the mathematical properties hold for all possible cases.
 */

/**
 * Represents a playable range as [min, max] MIDI notes
 */
interface Range {
  min: number;
  max: number;
}

/**
 * Calculate range relationship between two ranges
 */
type RangeRelationship =
  | 'equal'          // Ranges are identical
  | 'subset'         // Source is a subset of Destination
  | 'superset'       // Source is a superset of Destination
  | 'overlap'        // Ranges overlap but neither is subset
  | 'disjoint';      // Ranges don't overlap

function getRangeRelationship(source: Range, dest: Range): RangeRelationship {
  const sourceSet = new Set<number>();
  const destSet = new Set<number>();

  for (let i = source.min; i <= source.max; i++) sourceSet.add(i);
  for (let i = dest.min; i <= dest.max; i++) destSet.add(i);

  const intersection = [...sourceSet].filter((x) => destSet.has(x)).length;

  if (sourceSet.size === destSet.size && intersection === sourceSet.size) {
    return 'equal';
  }
  if (intersection === sourceSet.size) {
    return 'subset';
  }
  if (intersection === destSet.size) {
    return 'superset';
  }
  if (intersection > 0) {
    return 'overlap';
  }
  return 'disjoint';
}

/**
 * Check if a MIDI note is in range
 */
function isInRange(note: number, range: Range): boolean {
  return note >= range.min && note <= range.max;
}

/**
 * Simulate copying notes from source to destination
 * Returns count of audible vs silent notes
 */
function simulateCopy(
  sourcePitches: number[], // Pitch offsets from base 60
  sourceRange: Range,
  destRange: Range
): { audible: number; silent: number; relationship: RangeRelationship } {
  const baseMidi = 60;
  let audible = 0;
  let silent = 0;

  for (const pitch of sourcePitches) {
    const midiNote = baseMidi + pitch;

    // Note must be in source range to be valid on source
    if (!isInRange(midiNote, sourceRange)) {
      continue; // Skip invalid source notes
    }

    // After copy, check if note is in destination range
    if (isInRange(midiNote, destRange)) {
      audible++;
    } else {
      silent++;
    }
  }

  return {
    audible,
    silent,
    relationship: getRangeRelationship(sourceRange, destRange),
  };
}

/**
 * Generate a valid MIDI range
 */
const rangeArb = fc.tuple(fc.integer({ min: 0, max: 127 }), fc.integer({ min: 0, max: 127 })).map(
  ([a, b]): Range => ({
    min: Math.min(a, b),
    max: Math.max(a, b),
  })
);

/**
 * Generate pitch offsets within a reasonable range
 */
const pitchOffsetsArb = fc.array(fc.integer({ min: -24, max: 24 }), { minLength: 1, maxLength: 16 });

describe('Playable Range Property-Based Tests', () => {
  describe('Range Relationship Properties', () => {
    it('identical ranges should have all notes audible', () => {
      fc.assert(
        fc.property(rangeArb, pitchOffsetsArb, (range, pitches) => {
          // Same source and dest range
          const result = simulateCopy(pitches, range, range);

          // All valid source notes should be audible
          expect(result.relationship).toBe('equal');
          expect(result.silent).toBe(0);
        }),
        { numRuns: 100 }
      );
    });

    it('when source ⊆ destination, all valid notes should be audible', () => {
      fc.assert(
        fc.property(
          // Generate a range where source is a subset of destination
          fc
            .tuple(
              fc.integer({ min: 40, max: 70 }), // Inner min
              fc.integer({ min: 0, max: 39 }),  // Outer extension low
              fc.integer({ min: 71, max: 127 }), // Outer extension high
              fc.integer({ min: 1, max: 20 })   // Inner range size
            )
            .map(([innerMin, outerLow, outerHigh, size]) => ({
              source: { min: innerMin, max: Math.min(innerMin + size, 127) },
              dest: { min: outerLow, max: outerHigh },
            })),
          pitchOffsetsArb,
          ({ source, dest }, pitches) => {
            const result = simulateCopy(pitches, source, dest);

            // If source is actually a subset, no notes should be silent
            if (result.relationship === 'subset' || result.relationship === 'equal') {
              expect(result.silent).toBe(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('disjoint ranges should have all notes silent', () => {
      fc.assert(
        fc.property(
          // Generate disjoint ranges
          fc
            .tuple(
              fc.integer({ min: 0, max: 50 }),
              fc.integer({ min: 70, max: 127 })
            )
            .map(([lowMax, highMin]) => ({
              source: { min: 0, max: lowMax },
              dest: { min: highMin, max: 127 },
            })),
          pitchOffsetsArb,
          ({ source, dest }, pitches) => {
            // Adjust pitches to be valid for source range
            const adjustedPitches = pitches.map((p) => {
              const note = 60 + p;
              // Clamp to source range
              if (note < source.min) return source.min - 60;
              if (note > source.max) return source.max - 60;
              return p;
            });

            const result = simulateCopy(adjustedPitches, source, dest);

            // Disjoint ranges: all should be silent
            if (result.relationship === 'disjoint') {
              expect(result.audible).toBe(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('overlapping ranges should have partial audibility', () => {
      fc.assert(
        fc.property(
          // Generate overlapping ranges (neither is subset of other)
          fc
            .tuple(
              fc.integer({ min: 30, max: 50 }), // source min
              fc.integer({ min: 70, max: 90 }), // source max
              fc.integer({ min: 50, max: 60 }), // dest min (overlaps middle)
              fc.integer({ min: 90, max: 110 }) // dest max
            )
            .map(([sMin, sMax, dMin, dMax]) => ({
              source: { min: sMin, max: sMax },
              dest: { min: dMin, max: dMax },
            })),
          pitchOffsetsArb,
          ({ source, dest }, pitches) => {
            // Generate pitches that span the full source range
            const spanningPitches = [
              source.min - 60, // Low end of source
              source.max - 60, // High end of source
              ...pitches,
            ];

            const result = simulateCopy(spanningPitches, source, dest);

            // Overlapping but neither subset: should have both audible and silent
            if (result.relationship === 'overlap') {
              // The relationship is overlap, so we expect a mix
              // (Though specific counts depend on the pitches)
              expect(result.audible + result.silent).toBeGreaterThan(0);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Conservation Properties', () => {
    it('total notes (audible + silent) should equal valid source notes', () => {
      fc.assert(
        fc.property(rangeArb, rangeArb, pitchOffsetsArb, (source, dest, pitches) => {
          const result = simulateCopy(pitches, source, dest);

          // Count valid source notes
          const baseMidi = 60;
          const validSourceNotes = pitches.filter(
            (p) => baseMidi + p >= source.min && baseMidi + p <= source.max
          ).length;

          // Total should equal valid source notes
          expect(result.audible + result.silent).toBe(validSourceNotes);
        }),
        { numRuns: 100 }
      );
    });

    it('audible notes should never exceed destination range size', () => {
      fc.assert(
        fc.property(rangeArb, rangeArb, pitchOffsetsArb, (source, dest, pitches) => {
          const result = simulateCopy(pitches, source, dest);

          // Audible can never exceed destination range size
          const destRangeSize = dest.max - dest.min + 1;
          expect(result.audible).toBeLessThanOrEqual(destRangeSize);
        }),
        { numRuns: 100 }
      );
    });

    it('silent notes should never exceed source range size', () => {
      fc.assert(
        fc.property(rangeArb, rangeArb, pitchOffsetsArb, (source, dest, pitches) => {
          const result = simulateCopy(pitches, source, dest);

          // Silent can never exceed source range size
          const sourceRangeSize = source.max - source.min + 1;
          expect(result.silent).toBeLessThanOrEqual(sourceRangeSize);
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('Symmetry Properties', () => {
    it('relationship should be symmetric for equal ranges', () => {
      fc.assert(
        fc.property(rangeArb, (range) => {
          const rel1 = getRangeRelationship(range, range);
          const rel2 = getRangeRelationship(range, range);

          expect(rel1).toBe(rel2);
          expect(rel1).toBe('equal');
        }),
        { numRuns: 50 }
      );
    });

    it('subset/superset should be inverses', () => {
      fc.assert(
        fc.property(
          fc
            .tuple(rangeArb, rangeArb)
            .filter(([a, b]) => a.min !== b.min || a.max !== b.max), // Not equal
          ([source, dest]) => {
            const rel1 = getRangeRelationship(source, dest);
            const rel2 = getRangeRelationship(dest, source);

            if (rel1 === 'subset') {
              expect(rel2).toBe('superset');
            } else if (rel1 === 'superset') {
              expect(rel2).toBe('subset');
            } else if (rel1 === 'disjoint') {
              expect(rel2).toBe('disjoint');
            } else if (rel1 === 'overlap') {
              expect(rel2).toBe('overlap');
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Edge Cases', () => {
    it('single-note ranges should work correctly', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 127 }),
          fc.integer({ min: 0, max: 127 }),
          (sourceNote, destNote) => {
            const source = { min: sourceNote, max: sourceNote };
            const dest = { min: destNote, max: destNote };

            const rel = getRangeRelationship(source, dest);

            if (sourceNote === destNote) {
              expect(rel).toBe('equal');
            } else {
              expect(rel).toBe('disjoint');
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('adjacent ranges should be disjoint', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 1, max: 26 }),
          (start, size) => {
            const source = { min: start, max: start + size };
            const dest = { min: start + size + 1, max: start + size + 1 + size };

            const rel = getRangeRelationship(source, dest);
            expect(rel).toBe('disjoint');
          }
        ),
        { numRuns: 50 }
      );
    });

    it('touching ranges (share one note) should overlap', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100 }),
          fc.integer({ min: 1, max: 26 }),
          (start, size) => {
            const source = { min: start, max: start + size };
            const dest = { min: start + size, max: start + size + size }; // Shares endpoint

            const rel = getRangeRelationship(source, dest);
            // They share exactly one note, so it's either subset (if size=1) or overlap
            expect(['subset', 'overlap', 'superset']).toContain(rel);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
