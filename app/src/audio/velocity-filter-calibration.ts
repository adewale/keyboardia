import anchors44100 from './velocity-filter-anchors.json';
import anchors48000 from './velocity-filter-anchors-48000.json';

type Calibration = Record<string, Record<string, number>>;

export function velocityFilterAnchorHz(
  instrumentId: string,
  midiNote: number,
  sampleRate: number,
): number | undefined {
  if (!Number.isFinite(midiNote) || !Number.isFinite(sampleRate)) return undefined;
  // These acoustic calibrations are sample-rate-specific. Treating 88.2/96 kHz
  // hardware as "close enough" to 48 kHz reintroduces both the v40 target miss
  // and the v89→v90 cutoff cliff. Unsupported rates deliberately use the
  // historical gain-only path until a table is measured for that exact rate.
  const table: Calibration | undefined = sampleRate === 44_100
    ? anchors44100
    : sampleRate === 48_000
      ? anchors48000
      : undefined;
  if (!table) return undefined;
  return table[instrumentId]?.[String(Math.round(midiNote))];
}
