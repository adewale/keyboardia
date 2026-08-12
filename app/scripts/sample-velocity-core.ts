export interface VelocityRmsSample {
  file: string;
  note: number;
  velocityMin?: number;
  velocityMax?: number;
  activeRmsDb: number;
}

export interface VelocityRmsLayer<T extends VelocityRmsSample> {
  note: number;
  velocityMin: number;
  velocityMax: number;
  meanActiveRmsDb: number;
  samples: T[];
}

export interface VelocityRmsInversion<T extends VelocityRmsSample> {
  lower: VelocityRmsLayer<T>;
  higher: VelocityRmsLayer<T>;
  deltaDb: number;
}

/**
 * Compare distinct velocity layers after averaging their round-robin takes.
 * Individual performances within one layer are expected to vary and must not
 * be sorted as if each file represented a separate velocity step.
 */
export function findVelocityRmsInversions<T extends VelocityRmsSample>(
  samples: readonly T[],
  toleranceDb: number,
): VelocityRmsInversion<T>[] {
  const grouped = new Map<string, VelocityRmsLayer<T>>();
  for (const sample of samples) {
    const velocityMin = sample.velocityMin ?? 0;
    const velocityMax = sample.velocityMax ?? 127;
    const key = `${sample.note}:${velocityMin}-${velocityMax}`;
    const layer = grouped.get(key) ?? {
      note: sample.note,
      velocityMin,
      velocityMax,
      meanActiveRmsDb: 0,
      samples: [],
    };
    layer.samples.push(sample);
    grouped.set(key, layer);
  }
  for (const layer of grouped.values()) {
    layer.meanActiveRmsDb = layer.samples.reduce((sum, sample) => sum + sample.activeRmsDb, 0) / layer.samples.length;
  }

  const byNote = new Map<number, VelocityRmsLayer<T>[]>();
  for (const layer of grouped.values()) {
    const layers = byNote.get(layer.note) ?? [];
    layers.push(layer);
    byNote.set(layer.note, layers);
  }

  const inversions: VelocityRmsInversion<T>[] = [];
  for (const layers of byNote.values()) {
    const sorted = layers.sort((left, right) => left.velocityMin - right.velocityMin || left.velocityMax - right.velocityMax);
    for (let index = 1; index < sorted.length; index++) {
      const lower = sorted[index - 1];
      const higher = sorted[index];
      const deltaDb = higher.meanActiveRmsDb - lower.meanActiveRmsDb;
      if (deltaDb < -toleranceDb) inversions.push({ lower, higher, deltaDb });
    }
  }
  return inversions;
}
