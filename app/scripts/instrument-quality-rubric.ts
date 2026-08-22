/**
 * Deterministic scoring primitives for the all-instrument audio audit.
 *
 * The score is technical improvement priority, not listener preference. A
 * larger score means that the repository has more measurable repair work for
 * an instrument. Evidence coverage is reported separately and never converted
 * into pretend quality points.
 */

export type IssueSeverity = 'error' | 'review';

export interface AuditIssue {
  severity: IssueSeverity;
  code: string;
}

export interface ScoreComponent {
  id: string;
  points: number;
  detail: string;
}

export interface InstrumentScoreInput {
  calibrationPresent: boolean;
  liveMeasured: boolean;
  liveSilent: boolean;
  livePeakDbfs: number | null;
  categoryRmsDeltaDb: number | null;
  sampleFileCount: number;
  sampleIssues: readonly AuditIssue[];
  maxRootDistanceSemitones: number | null;
  medianVelocityLayers: number | null;
  targetVelocityLayers: number;
  medianRoundRobins: number | null;
  targetRoundRobins: number;
  /** Fatal delivered-PCM gates from a complete dry matrix, when present. */
  dryPcmFatalCount?: number;
}

export interface InstrumentScore {
  score: number;
  band: 'critical' | 'high' | 'medium' | 'low' | 'baseline';
  components: ScoreComponent[];
}

export const REVIEW_ISSUE_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  HOT_PEAK: 1,
  CLIPPING_SAMPLES: 3,
  DC_OFFSET: 3,
  LEADING_SILENCE: 1,
  TAIL_TRUNCATION: 2,
  PITCH_DEVIATION: 2,
  LOOP_SEAM_UNCHECKED: 2,
  LOOP_VALUE_DISCONTINUITY: 3,
  LOOP_DERIVATIVE_DISCONTINUITY: 3,
  NEGATIVE_PHASE_CORRELATION: 3,
  MONO_LOSS: 3,
  VELOCITY_RMS_INVERSION: 3,
  NOTE_LEVEL_STEP: 3,
  RANGE_OVEREXTENSION: 3,
});

const round = (value: number): number => Number(value.toFixed(1));
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(maximum, value));

function add(components: ScoreComponent[], id: string, points: number, detail: string): void {
  const rounded = round(points);
  if (rounded <= 0) return;
  components.push({ id, points: rounded, detail });
}

export function reviewIssueBurden(
  issues: readonly AuditIssue[],
  fileCount: number,
): { weightedFindings: number; points: number } {
  if (fileCount <= 0) return { weightedFindings: 0, points: 0 };
  const weightedFindings = issues
    .filter(issue => issue.severity === 'review')
    .reduce((total, issue) => total + (REVIEW_ISSUE_WEIGHTS[issue.code] ?? 2), 0);
  return {
    weightedFindings,
    // Five points per weighted finding per source file, capped so a large
    // sample map cannot dominate the entire cross-engine score.
    points: round(Math.min(30, 5 * weightedFindings / fileCount)),
  };
}

/** Render every measured issue class; reporting must not silently hide debt. */
export function formatIssueActions(
  counts: Readonly<Record<string, number>>,
  actions: Readonly<Record<string, string>>,
): string[] {
  return Object.entries(counts).map(([code, count]) =>
    `${actions[code] ?? `investigate ${code.toLowerCase()}`} (${count})`
  );
}

export function scoreInstrument(input: InstrumentScoreInput): InstrumentScore {
  const components: ScoreComponent[] = [];

  if (!input.calibrationPresent) {
    add(components, 'missing-calibration', 20, 'No explicit source-calibration contract');
  }

  if (input.liveMeasured && input.liveSilent) {
    add(components, 'live-silence', 40, 'Canonical live sequencer note was silent');
  }

  if ((input.dryPcmFatalCount ?? 0) > 0) {
    add(
      components,
      'dry-pcm-fatal',
      40,
      `${input.dryPcmFatalCount} fatal delivered-PCM matrix finding${input.dryPcmFatalCount === 1 ? '' : 's'}`,
    );
  }

  if (input.livePeakDbfs !== null && Number.isFinite(input.livePeakDbfs)) {
    add(
      components,
      'source-headroom',
      clamp(input.livePeakDbfs * 1.5, 0, 12),
      `Per-track live peak was ${input.livePeakDbfs.toFixed(1)} dBFS`,
    );
  }

  if (input.categoryRmsDeltaDb !== null && Number.isFinite(input.categoryRmsDeltaDb)) {
    add(
      components,
      'level-outlier',
      clamp((Math.abs(input.categoryRmsDeltaDb) - 18) / 2, 0, 6),
      `Canonical live RMS was ${input.categoryRmsDeltaDb >= 0 ? '+' : ''}${input.categoryRmsDeltaDb.toFixed(1)} dB versus its catalogue category median`,
    );
  }

  const errors = input.sampleIssues.filter(issue => issue.severity === 'error');
  if (errors.length > 0) {
    add(
      components,
      'sample-errors',
      Math.min(40, errors.length * 20),
      `${errors.length} unwaived decoded-sample error${errors.length === 1 ? '' : 's'}`,
    );
  }

  const burden = reviewIssueBurden(input.sampleIssues, input.sampleFileCount);
  add(
    components,
    'sample-review-burden',
    burden.points,
    `${burden.weightedFindings} weighted, hash-bound review findings across ${input.sampleFileCount} decoded source file${input.sampleFileCount === 1 ? '' : 's'}`,
  );

  if (input.maxRootDistanceSemitones !== null) {
    add(
      components,
      'root-distance',
      clamp(input.maxRootDistanceSemitones - 4, 0, 8),
      `Worst playable note is ${input.maxRootDistanceSemitones} semitone${input.maxRootDistanceSemitones === 1 ? '' : 's'} from a sampled root`,
    );
  }

  if (input.medianVelocityLayers !== null && input.targetVelocityLayers > 0) {
    add(
      components,
      'velocity-coverage',
      clamp((input.targetVelocityLayers - input.medianVelocityLayers) * 4, 0, 8),
      `Median velocity coverage is ${input.medianVelocityLayers} layer${input.medianVelocityLayers === 1 ? '' : 's'}; role target is ${input.targetVelocityLayers}`,
    );
  }

  if (input.medianRoundRobins !== null && input.targetRoundRobins > 0) {
    add(
      components,
      'round-robin-coverage',
      clamp((input.targetRoundRobins - input.medianRoundRobins) * 3, 0, 6),
      `Median same-layer variation is ${input.medianRoundRobins} take${input.medianRoundRobins === 1 ? '' : 's'}; role target is ${input.targetRoundRobins}`,
    );
  }

  const score = round(Math.min(100, components.reduce((total, component) => total + component.points, 0)));
  const band: InstrumentScore['band'] = score >= 40
    ? 'critical'
    : score >= 25
      ? 'high'
      : score >= 12
        ? 'medium'
        : score > 0
          ? 'low'
          : 'baseline';
  return { score, band, components };
}
