import {
  activeEnvelopeStages,
  ENVELOPE_DURATION_RANGES_V2,
  type EnvelopeCapabilityV2,
  type EnvelopeDuration,
  type EnvelopeDurationUnit,
  type EnvelopeLockV2,
  type EnvelopeModel,
  type EnvelopeStageName,
  type SamplePlaybackMode,
  type TrackEnvelopeV2,
} from './envelope-contract-v2';
import { VALID_STEP_COUNTS_SET } from './sync-types';

export interface NotationAnnotation {
  key: string;
  value: string | null;
  raw: string;
}

export interface NotationDiagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  line: number;
  trackLabel?: string;
}

export interface ParsedNotationTrackV24 {
  label: string;
  pattern: string;
  stepCount: number;
  annotations: NotationAnnotation[];
  envelope?: TrackEnvelopeV2;
  playbackMode?: SamplePlaybackMode;
  gate?: number;
  locks: EnvelopeLockV2[];
  diagnostics: NotationDiagnostic[];
}

export interface ParsedNotationSessionV24 {
  tracks: ParsedNotationTrackV24[];
  diagnostics: NotationDiagnostic[];
}

/**
 * Minimal live-session shape accepted by the public notation exporter.
 * Keeping this structural avoids coupling the runtime-neutral notation module
 * to either the browser or Worker state containers.
 */
export interface EnvelopeNotationStateV24 {
  tempo: number;
  swing: number;
  tracks: Array<{
    name: string;
    sampleId: string;
    steps: boolean[];
    parameterLocks: Array<{
      pitch?: number;
      volume?: number;
      tie?: boolean;
      attack?: number;
      decay?: number;
      release?: number;
      attackDuration?: EnvelopeDuration;
      holdDuration?: EnvelopeDuration;
      decayDuration?: EnvelopeDuration;
      releaseDuration?: EnvelopeDuration;
    } | null>;
    transpose: number;
    volume: number;
    muted: boolean;
    soloed?: boolean;
    stepCount?: number;
    envelope?: { attack: number; decay: number; sustain: number; release: number };
    envelopeTimeUnit?: EnvelopeDurationUnit;
    envelopeV2?: TrackEnvelopeV2;
    samplePlaybackMode?: SamplePlaybackMode;
    gate?: number;
  }>;
}

const PATTERN_RE = /^[xXo~-]+$/;
const ANNOTATION_RE = /\[([^\]]+)\]/g;
const DURATION_RE = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(ms|s|st)$/;
const ENVELOPE_KEYS = new Set([
  'play', 'amp', 'gate', 'lock', 'env', 'envUnit',
  'attacks', 'decays', 'releases',
]);
const STAGE_ORDER: Record<EnvelopeStageName, number> = {
  attack: 0,
  hold: 1,
  decay: 2,
  release: 3,
};

function diagnostic(
  code: string,
  message: string,
  line: number,
  trackLabel?: string,
  severity: NotationDiagnostic['severity'] = 'error',
): NotationDiagnostic {
  return { code, severity, message, line, trackLabel };
}

function parseFiniteNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function parseEnvelopeDurationToken(raw: string): EnvelopeDuration | null {
  const match = DURATION_RE.exec(raw.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  if (match[2] === 'ms') return { value: value / 1000, unit: 'seconds' };
  return { value, unit: match[2] === 'st' ? 'steps' : 'seconds' };
}

function durationFromLegacy(raw: string, unit: EnvelopeDurationUnit): EnvelopeDuration | null {
  const value = parseFiniteNumber(raw);
  return value === null ? null : { value, unit };
}

function validateLegacyDuration(
  stage: EnvelopeStageName,
  duration: EnvelopeDuration,
  raw: string,
  line: number,
  label: string,
  diagnostics: NotationDiagnostic[],
): void {
  const range = ENVELOPE_DURATION_RANGES_V2[stage][duration.unit];
  if (duration.value < range.min || duration.value > range.max) {
    diagnostics.push(diagnostic(
      'duration-out-of-range',
      `${stage} duration ${raw} is outside ${range.min}–${range.max} ${duration.unit}`,
      line,
      label,
    ));
  }
}

function splitAnnotation(content: string): NotationAnnotation {
  const separator = content.indexOf(':');
  if (separator === -1) {
    return { key: content.trim(), value: null, raw: `[${content}]` };
  }
  return {
    key: content.slice(0, separator).trim(),
    value: content.slice(separator + 1).trim(),
    raw: `[${content}]`,
  };
}

function parseAmp(
  annotation: NotationAnnotation,
  line: number,
  label: string,
  diagnostics: NotationDiagnostic[],
): TrackEnvelopeV2 | undefined {
  const parts = annotation.value?.split(',').map((part) => part.trim()) ?? [];
  const model = parts[0] as EnvelopeModel | undefined;
  if (!model || !['ad', 'ahd', 'ar', 'adsr'].includes(model)) {
    diagnostics.push(diagnostic('invalid-envelope-model', `Invalid amp model in ${annotation.raw}`, line, label));
    return undefined;
  }
  const expected = { ad: 3, ahd: 4, ar: 3, adsr: 5 }[model];
  if (parts.length !== expected) {
    diagnostics.push(diagnostic(
      'invalid-envelope-arity',
      `${model} expects ${expected - 1} values; received ${parts.length - 1}`,
      line,
      label,
    ));
    return undefined;
  }
  const duration = (index: number, stage: EnvelopeStageName): EnvelopeDuration | undefined => {
    const parsed = parseEnvelopeDurationToken(parts[index]);
    if (!parsed) {
      diagnostics.push(diagnostic('invalid-duration', `Invalid duration token ${parts[index]}`, line, label));
      return undefined;
    }
    const range = ENVELOPE_DURATION_RANGES_V2[stage][parsed.unit];
    if (parsed.value < range.min || parsed.value > range.max) {
      diagnostics.push(diagnostic(
        'duration-out-of-range',
        `${stage} duration ${parts[index]} is outside ${range.min}–${range.max} ${parsed.unit}`,
        line,
        label,
      ));
    }
    return parsed;
  };

  const attack = duration(1, 'attack');
  if (!attack) return undefined;
  if (model === 'ad') {
    const decay = duration(2, 'decay');
    return decay ? { model, attack, decay } : undefined;
  }
  if (model === 'ahd') {
    const hold = duration(2, 'hold');
    const decay = duration(3, 'decay');
    return hold && decay ? { model, attack, hold, decay } : undefined;
  }
  if (model === 'ar') {
    const release = duration(2, 'release');
    return release ? { model, attack, release } : undefined;
  }
  const decay = duration(2, 'decay');
  const sustain = parseFiniteNumber(parts[3]);
  const release = duration(4, 'release');
  if (!decay || sustain === null || !release) {
    if (sustain === null) {
      diagnostics.push(diagnostic('invalid-sustain', `Invalid sustain ${parts[3]}`, line, label));
    }
    return undefined;
  }
  if (sustain < 0 || sustain > 1) {
    diagnostics.push(diagnostic(
      'sustain-out-of-range',
      `Sustain ${parts[3]} is outside 0–1`,
      line,
      label,
    ));
  }
  return { model, attack, decay, sustain, release };
}

function parseLegacyEnvelope(
  annotations: NotationAnnotation[],
  line: number,
  label: string,
  diagnostics: NotationDiagnostic[],
): TrackEnvelopeV2 | undefined {
  const env = annotations.find((entry) => entry.key === 'env');
  if (!env) return undefined;
  const unitRaw = annotations.find((entry) => entry.key === 'envUnit')?.value ?? 'seconds';
  const unit: EnvelopeDurationUnit | null = unitRaw === 'seconds' || unitRaw === 'steps'
    ? unitRaw
    : null;
  if (!unit) {
    diagnostics.push(diagnostic('invalid-legacy-unit', `Invalid envUnit ${unitRaw}`, line, label));
    return undefined;
  }
  const parts = env.value?.split(',').map((part) => part.trim()) ?? [];
  if (parts.length !== 4) {
    diagnostics.push(diagnostic('invalid-legacy-envelope', 'Legacy env expects A,D,S,R', line, label));
    return undefined;
  }
  const attack = durationFromLegacy(parts[0], unit);
  const decay = durationFromLegacy(parts[1], unit);
  const sustain = parseFiniteNumber(parts[2]);
  const release = durationFromLegacy(parts[3], unit);
  if (!attack || !decay || sustain === null || !release) {
    diagnostics.push(diagnostic('invalid-legacy-envelope', 'Legacy env contains a non-finite value', line, label));
    return undefined;
  }
  validateLegacyDuration('attack', attack, parts[0], line, label, diagnostics);
  validateLegacyDuration('decay', decay, parts[1], line, label, diagnostics);
  validateLegacyDuration('release', release, parts[3], line, label, diagnostics);
  if (sustain < 0 || sustain > 1) {
    diagnostics.push(diagnostic(
      'sustain-out-of-range',
      `Sustain ${parts[2]} is outside 0–1`,
      line,
      label,
    ));
  }
  return { model: 'adsr', attack, decay, sustain, release };
}

function parseSparseLock(
  annotation: NotationAnnotation,
  stepCount: number,
  line: number,
  label: string,
  diagnostics: NotationDiagnostic[],
): EnvelopeLockV2 | undefined {
  const parts = annotation.value?.split(',').map((part) => part.trim()) ?? [];
  const step = Number(parts[0]);
  const stage = parts[1] as EnvelopeStageName | undefined;
  const duration = parts[2] ? parseEnvelopeDurationToken(parts[2]) : null;
  if (
    parts.length !== 3
    || !Number.isInteger(step)
    || step < 1
    || step > stepCount
    || !stage
    || !['attack', 'hold', 'decay', 'release'].includes(stage)
    || !duration
  ) {
    diagnostics.push(diagnostic('invalid-lock', `Invalid lock ${annotation.raw}`, line, label));
    return undefined;
  }
  const range = ENVELOPE_DURATION_RANGES_V2[stage][duration.unit];
  if (duration.value < range.min || duration.value > range.max) {
    diagnostics.push(diagnostic(
      'duration-out-of-range',
      `${stage} lock duration ${parts[2]} is outside ${range.min}–${range.max} ${duration.unit}`,
      line,
      label,
    ));
  }
  return { step, stage, duration };
}

function parseLegacyLocks(
  annotations: NotationAnnotation[],
  unit: EnvelopeDurationUnit,
  stepCount: number,
  line: number,
  label: string,
  diagnostics: NotationDiagnostic[],
): EnvelopeLockV2[] {
  const result: EnvelopeLockV2[] = [];
  const keys: Array<[string, EnvelopeStageName]> = [
    ['attacks', 'attack'],
    ['decays', 'decay'],
    ['releases', 'release'],
  ];
  for (const [key, stage] of keys) {
    const annotation = annotations.find((entry) => entry.key === key);
    if (!annotation) continue;
    const values = annotation.value?.split(',').map((part) => part.trim()) ?? [];
    if (values.length !== stepCount) {
      diagnostics.push(diagnostic(
        'legacy-lock-length',
        `${key} has ${values.length} values for ${stepCount} steps`,
        line,
        label,
      ));
    }
    values.slice(0, stepCount).forEach((value, index) => {
      if (value === '-' || value === '') return;
      const duration = durationFromLegacy(value, unit);
      if (!duration) {
        diagnostics.push(diagnostic('invalid-legacy-lock', `Invalid ${key} value ${value}`, line, label));
        return;
      }
      validateLegacyDuration(stage, duration, value, line, label, diagnostics);
      result.push({ step: index + 1, stage, duration });
    });
  }
  return result;
}

function validateTies(
  pattern: string,
  line: number,
  label: string,
): NotationDiagnostic[] {
  const result: NotationDiagnostic[] = [];
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern[index] !== '~') continue;
    const previous = pattern[(index - 1 + pattern.length) % pattern.length];
    if (previous !== 'x' && previous !== 'X' && previous !== 'o' && previous !== '~') {
      result.push(diagnostic(
        'orphan-tie',
        `Tie at step ${index + 1} has no active onset/continuation before it`,
        line,
        label,
      ));
    }
  }
  return result;
}

export function parseEnvelopeSessionNotation(input: string): ParsedNotationSessionV24 {
  const tracks: ParsedNotationTrackV24[] = [];
  const diagnostics: NotationDiagnostic[] = [];
  const lines = input.split(/\r?\n/);

  lines.forEach((sourceLine, zeroBasedLine) => {
    const line = zeroBasedLine + 1;
    const trimmed = sourceLine.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const match = /^([^:]+):\s*([^\s]+)(.*)$/.exec(trimmed);
    if (!match) {
      diagnostics.push(diagnostic('invalid-track-line', 'Expected Label: pattern [annotations]', line));
      return;
    }
    const label = match[1].trim();
    const pattern = match[2].trim();
    const annotationSource = match[3];
    const trackDiagnostics: NotationDiagnostic[] = [];
    if (!PATTERN_RE.test(pattern)) {
      trackDiagnostics.push(diagnostic('invalid-pattern', `Invalid pattern ${pattern}`, line, label));
    }

    const annotations = Array.from(annotationSource.matchAll(ANNOTATION_RE), (entry) => splitAnnotation(entry[1]));
    const remainder = annotationSource.replace(ANNOTATION_RE, '').trim();
    if (remainder) {
      trackDiagnostics.push(diagnostic('annotation-junk', `Unexpected text ${remainder}`, line, label));
    }

    const singletonKeys = [
      'stepCount', 'play', 'amp', 'gate', 'env', 'envUnit', 'attacks', 'decays', 'releases',
    ] as const;
    for (const key of singletonKeys) {
      const count = annotations.filter((entry) => entry.key === key).length;
      if (count > 1) {
        trackDiagnostics.push(diagnostic(
          key === 'amp' ? 'duplicate-amp' : 'duplicate-annotation',
          `Only one ${key} annotation is allowed; received ${count}`,
          line,
          label,
        ));
      }
    }
    const hasAmp = annotations.some((entry) => entry.key === 'amp');
    const hasLegacyEnvelope = annotations.some((entry) => entry.key === 'env');
    if (hasAmp && hasLegacyEnvelope) {
      trackDiagnostics.push(diagnostic(
        'conflicting-envelope-syntax',
        'Use amp or legacy env/envUnit, not both',
        line,
        label,
      ));
    }
    const hasSparseLocks = annotations.some((entry) => entry.key === 'lock');
    const hasLegacyLocks = annotations.some((entry) => (
      entry.key === 'attacks' || entry.key === 'decays' || entry.key === 'releases'
    ));
    if (hasSparseLocks && hasLegacyLocks) {
      trackDiagnostics.push(diagnostic(
        'conflicting-lock-syntax',
        'Use sparse lock annotations or legacy dense lock vectors, not both',
        line,
        label,
      ));
    }

    const stepCountRaw = annotations.find((entry) => entry.key === 'stepCount')?.value;
    const stepCount = stepCountRaw === undefined ? pattern.length : Number(stepCountRaw);
    if (!Number.isInteger(stepCount) || stepCount <= 0 || stepCount !== pattern.length) {
      trackDiagnostics.push(diagnostic(
        'step-count-mismatch',
        `Pattern has ${pattern.length} cells but stepCount is ${stepCountRaw ?? pattern.length}`,
        line,
        label,
      ));
    } else if (!(VALID_STEP_COUNTS_SET as ReadonlySet<number>).has(stepCount)) {
      trackDiagnostics.push(diagnostic(
        'unsupported-step-count',
        `Step count ${stepCount} is not supported`,
        line,
        label,
      ));
    }
    trackDiagnostics.push(...validateTies(pattern, line, label));

    const ampAnnotations = annotations.filter((entry) => entry.key === 'amp');
    const envelope = ampAnnotations[0]
      ? parseAmp(ampAnnotations[0], line, label, trackDiagnostics)
      : parseLegacyEnvelope(annotations, line, label, trackDiagnostics);

    const play = annotations.find((entry) => entry.key === 'play');
    let playbackMode: SamplePlaybackMode | undefined;
    if (play) {
      if (play.value === 'trigger' || play.value === 'gate' || play.value === 'loop') {
        playbackMode = play.value;
      } else {
        trackDiagnostics.push(diagnostic('invalid-play-mode', `Invalid play mode ${play.value}`, line, label));
      }
    }

    const gateAnnotation = annotations.find((entry) => entry.key === 'gate');
    let gate: number | undefined;
    if (gateAnnotation?.value !== undefined && gateAnnotation.value !== null) {
      const parsedGate = parseFiniteNumber(gateAnnotation.value.replace(/%$/, ''));
      if (parsedGate === null || parsedGate < 0 || parsedGate > 100) {
        trackDiagnostics.push(diagnostic('invalid-gate', `Invalid gate ${gateAnnotation.value}`, line, label));
      } else {
        gate = parsedGate;
      }
    }

    const locks = annotations
      .filter((entry) => entry.key === 'lock')
      .map((entry) => parseSparseLock(entry, pattern.length, line, label, trackDiagnostics))
      .filter((entry): entry is EnvelopeLockV2 => Boolean(entry));
    const legacyUnitRaw = annotations.find((entry) => entry.key === 'envUnit')?.value ?? 'seconds';
    const legacyUnit: EnvelopeDurationUnit = legacyUnitRaw === 'steps' ? 'steps' : 'seconds';
    locks.push(...parseLegacyLocks(
      annotations,
      legacyUnit,
      pattern.length,
      line,
      label,
      trackDiagnostics,
    ));
    const lockKeys = new Set<string>();
    for (const lock of locks) {
      const key = `${lock.step}:${lock.stage}`;
      if (lockKeys.has(key)) {
        trackDiagnostics.push(diagnostic(
          'duplicate-lock',
          `Only one ${lock.stage} lock is allowed at step ${lock.step}`,
          line,
          label,
        ));
      }
      lockKeys.add(key);
    }

    const track: ParsedNotationTrackV24 = {
      label,
      pattern,
      stepCount: Number.isInteger(stepCount) && stepCount > 0 ? stepCount : pattern.length,
      annotations,
      ...(envelope ? { envelope } : {}),
      ...(playbackMode ? { playbackMode } : {}),
      ...(gate !== undefined ? { gate } : {}),
      locks,
      diagnostics: trackDiagnostics,
    };
    tracks.push(track);
    diagnostics.push(...trackDiagnostics);
  });

  return { tracks, diagnostics };
}

export function validateEnvelopeNotationCapability(
  track: ParsedNotationTrackV24,
  capability: EnvelopeCapabilityV2,
  line = 0,
): NotationDiagnostic[] {
  const diagnostics: NotationDiagnostic[] = [];
  if (track.envelope && !capability.models.includes(track.envelope.model)) {
    diagnostics.push(diagnostic(
      'unsupported-envelope-model',
      `${track.envelope.model} is not active for ${track.label}`,
      line,
      track.label,
      'warning',
    ));
  }
  if (track.playbackMode && !capability.playbackModes?.includes(track.playbackMode)) {
    diagnostics.push(diagnostic(
      capability.playbackModes ? 'unsupported-playback-mode' : 'playback-on-nonsample',
      `${track.playbackMode} playback is not active for ${track.label}`,
      line,
      track.label,
      'warning',
    ));
  }
  if (track.gate !== undefined && track.playbackMode === 'trigger') {
    diagnostics.push(diagnostic(
      'inactive-gate',
      `Gate is inactive during trigger playback on ${track.label}`,
      line,
      track.label,
      'warning',
    ));
  }
  const activeStages = track.envelope
    ? new Set(activeEnvelopeStages(track.envelope.model))
    : null;
  for (const lock of track.locks) {
    if (activeStages && !activeStages.has(lock.stage)) {
      diagnostics.push(diagnostic(
        'inactive-lock-stage',
        `${lock.stage} lock at step ${lock.step} is inactive for ${track.envelope?.model}`,
        line,
        track.label,
        'warning',
      ));
    }
    const symbol = track.pattern[lock.step - 1];
    if (symbol === '~') {
      diagnostics.push(diagnostic(
        'lock-on-tie-continuation',
        `${lock.stage} lock at step ${lock.step} is retained but inactive on a tie continuation`,
        line,
        track.label,
        'warning',
      ));
    } else if (symbol === '-') {
      diagnostics.push(diagnostic(
        'lock-on-silent-step',
        `${lock.stage} lock at step ${lock.step} is retained but inactive on a silent step`,
        line,
        track.label,
        'warning',
      ));
    }
  }
  return diagnostics;
}

function shortestNumber(value: number): string {
  return Object.is(value, -0) ? '0' : String(value);
}

export function formatEnvelopeDurationToken(duration: EnvelopeDuration): string {
  if (duration.unit === 'steps') return `${shortestNumber(duration.value)}st`;
  if (duration.value !== 0 && Math.abs(duration.value) < 1) {
    return `${shortestNumber(duration.value * 1000)}ms`;
  }
  return `${shortestNumber(duration.value)}s`;
}

function formatEnvelope(envelope: TrackEnvelopeV2): string {
  const attack = formatEnvelopeDurationToken(envelope.attack);
  switch (envelope.model) {
    case 'ad':
      return `[amp:ad,${attack},${formatEnvelopeDurationToken(envelope.decay)}]`;
    case 'ahd':
      return `[amp:ahd,${attack},${formatEnvelopeDurationToken(envelope.hold)},${formatEnvelopeDurationToken(envelope.decay)}]`;
    case 'ar':
      return `[amp:ar,${attack},${formatEnvelopeDurationToken(envelope.release)}]`;
    case 'adsr':
      return `[amp:adsr,${attack},${formatEnvelopeDurationToken(envelope.decay)},${shortestNumber(envelope.sustain)},${formatEnvelopeDurationToken(envelope.release)}]`;
  }
}

export function serializeEnvelopeNotationTrack(track: ParsedNotationTrackV24): string {
  const retained = track.annotations
    .filter((annotation) => !ENVELOPE_KEYS.has(annotation.key))
    .map((annotation) => annotation.raw);
  const authored: string[] = [];
  if (track.playbackMode) authored.push(`[play:${track.playbackMode}]`);
  if (track.envelope) authored.push(formatEnvelope(track.envelope));
  if (track.gate !== undefined) authored.push(`[gate:${shortestNumber(track.gate)}%]`);
  authored.push(...track.locks
    .slice()
    .sort((left, right) => left.step - right.step || STAGE_ORDER[left.stage] - STAGE_ORDER[right.stage])
    .map((lock) => `[lock:${lock.step},${lock.stage},${formatEnvelopeDurationToken(lock.duration)}]`));
  const suffix = [...retained, ...authored].join(' ');
  return `${track.label}: ${track.pattern}${suffix ? ` ${suffix}` : ''}`;
}

export function serializeEnvelopeSessionNotation(session: ParsedNotationSessionV24): string {
  return session.tracks.map(serializeEnvelopeNotationTrack).join('\n');
}

function safeTrackLabel(label: string, index: number): string {
  const normalized = label.replace(/[\r\n:]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized || `Track ${index + 1}`;
}

function instrumentAnnotation(sampleId: string): NotationAnnotation {
  const separator = sampleId.indexOf(':');
  if (separator > 0 && separator < sampleId.length - 1) {
    return {
      key: sampleId.slice(0, separator),
      value: sampleId.slice(separator + 1),
      raw: `[${sampleId}]`,
    };
  }
  return { key: 'instrument', value: sampleId, raw: `[instrument:${sampleId}]` };
}

function metadataAnnotation(key: string, value: string | null): NotationAnnotation {
  return { key, value, raw: value === null ? `[${key}]` : `[${key}:${value}]` };
}

function typedLockDurationFromState(
  lock: EnvelopeNotationStateV24['tracks'][number]['parameterLocks'][number],
  stage: EnvelopeStageName,
  legacyUnit: EnvelopeDurationUnit,
): EnvelopeDuration | undefined {
  if (!lock) return undefined;
  const typed = stage === 'attack' ? lock.attackDuration
    : stage === 'hold' ? lock.holdDuration
      : stage === 'decay' ? lock.decayDuration
        : lock.releaseDuration;
  if (typed) return typed;
  if (stage === 'hold') return undefined;
  const legacy = lock[stage];
  return legacy === undefined ? undefined : { value: legacy, unit: legacyUnit };
}

/**
 * Export the currently authored envelope state as canonical v2.4 notation.
 * The resulting text is parsed again before it leaves the product surface so
 * the public MCP representation cannot silently emit syntax our importer
 * rejects.
 */
export function serializeEnvelopeNotationStateV24(state: EnvelopeNotationStateV24): string {
  const session: ParsedNotationSessionV24 = {
    diagnostics: [],
    tracks: state.tracks.map((track, trackIndex) => {
      const stepCount = track.stepCount ?? track.steps.length;
      const pattern = Array.from({ length: stepCount }, (_, step) => {
        if (!track.steps[step]) return '-';
        return track.parameterLocks[step]?.tie ? '~' : 'x';
      }).join('');
      const annotations: NotationAnnotation[] = [instrumentAnnotation(track.sampleId)];
      if (trackIndex === 0) {
        annotations.push(metadataAnnotation('bpm', shortestNumber(state.tempo)));
        annotations.push(metadataAnnotation('swing', shortestNumber(state.swing)));
      }
      if (stepCount !== 16) annotations.push(metadataAnnotation('stepCount', String(stepCount)));
      if (track.transpose !== 0) annotations.push(metadataAnnotation('transpose', shortestNumber(track.transpose)));
      if (track.volume !== 1) annotations.push(metadataAnnotation('vol', shortestNumber(track.volume)));
      if (track.muted) annotations.push(metadataAnnotation('muted', null));
      if (track.soloed) annotations.push(metadataAnnotation('soloed', null));

      const legacyUnit = track.envelopeTimeUnit ?? 'seconds';
      const envelope = track.envelopeV2 ?? (track.envelope
        ? {
            model: 'adsr' as const,
            attack: { value: track.envelope.attack, unit: legacyUnit },
            decay: { value: track.envelope.decay, unit: legacyUnit },
            sustain: track.envelope.sustain,
            release: { value: track.envelope.release, unit: legacyUnit },
          }
        : undefined);
      const locks: EnvelopeLockV2[] = [];
      track.parameterLocks.slice(0, stepCount).forEach((lock, step) => {
        for (const stage of ['attack', 'hold', 'decay', 'release'] as const) {
          const duration = typedLockDurationFromState(lock, stage, legacyUnit);
          if (duration) locks.push({ step: step + 1, stage, duration });
        }
      });
      return {
        label: safeTrackLabel(track.name, trackIndex),
        pattern,
        stepCount,
        annotations,
        ...(envelope ? { envelope } : {}),
        ...(track.samplePlaybackMode ? { playbackMode: track.samplePlaybackMode } : {}),
        ...(track.gate !== undefined ? { gate: track.gate } : {}),
        locks,
        diagnostics: [],
      };
    }),
  };
  const notation = serializeEnvelopeSessionNotation(session);
  const parsed = parseEnvelopeSessionNotation(notation);
  const errors = parsed.diagnostics.filter((entry) => entry.severity === 'error');
  if (errors.length > 0) {
    throw new Error(`Generated invalid envelope notation: ${errors.map((entry) => entry.code).join(', ')}`);
  }
  return notation;
}
