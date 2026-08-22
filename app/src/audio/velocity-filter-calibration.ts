import anchors44100 from './velocity-filter-anchors.json';
import anchors48000 from './velocity-filter-anchors-48000.json';

type Calibration = Record<string, Record<string, number>>;

export function velocityFilterAnchorHz(
  instrumentId: string,
  midiNote: number,
  sampleRate: number,
): number | undefined {
  if (!Number.isFinite(midiNote) || !Number.isFinite(sampleRate)) return undefined;
  const table: Calibration = Math.abs(sampleRate - 44_100) <= Math.abs(sampleRate - 48_000)
    ? anchors44100
    : anchors48000;
  return table[instrumentId]?.[String(Math.round(midiNote))];
}
