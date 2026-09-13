import { GENERATED_INSTRUMENT_QUALITY_PROFILES } from './generated-instrument-quality-profiles';
import type {
  GeneratedAuditCondition,
  GeneratedCatalogueAudit,
} from './generated-instrument-quality-browser';

const CONDITIONS: readonly GeneratedAuditCondition[] = [
  'canonical',
  'soft',
  'hard',
  'low',
  'high',
  'short',
];

const REQUIRED_VELOCITY_TIMBRE = [
  'hihat',
  'lead',
  'pluck',
  'tone:fm-epiano',
  'tone:duo-lead',
  'tone:am-bell',
] as const;

/**
 * Absolute, current-runtime gates for the generated-voice catalogue.
 *
 * Frozen before/after receipts remain useful evidence, but they are not the
 * release authority: this evaluator runs against PCM rendered from the checked
 * out implementation in Chromium.
 */
export function generatedQualityGateViolations(
  report: GeneratedCatalogueAudit,
): string[] {
  const failures: string[] = [];
  const profilesById = new Map(
    GENERATED_INSTRUMENT_QUALITY_PROFILES.map(profile => [profile.id, profile]),
  );

  if (report.schemaVersion !== 2) failures.push(`schemaVersion=${report.schemaVersion}, expected 2`);
  if (report.implementation !== 'current') {
    failures.push(`implementation=${String(report.implementation)}, expected current`);
  }
  if (report.voiceCount !== profilesById.size) {
    failures.push(`voiceCount=${report.voiceCount}, expected ${profilesById.size}`);
  }
  if (report.conditionRenderCount !== profilesById.size * CONDITIONS.length) {
    failures.push(
      `conditionRenderCount=${report.conditionRenderCount}, expected ${profilesById.size * CONDITIONS.length}`,
    );
  }

  for (const [id, profile] of profilesById) {
    const voice = report.voices[id];
    if (!voice) {
      failures.push(`${id}: missing voice audit`);
      continue;
    }

    if (!voice.conditions) {
      failures.push(`${id}: missing per-condition safety measurements`);
    } else {
      for (const condition of CONDITIONS) {
        const safety = voice.conditions[condition];
        if (!safety) {
          failures.push(`${id}/${condition}: missing safety measurement`);
          continue;
        }
        if (safety.nonFiniteSamples !== 0) {
          failures.push(`${id}/${condition}: ${safety.nonFiniteSamples} non-finite samples`);
        }
        if (safety.truePeakDbfs > 0.1) {
          failures.push(`${id}/${condition}: true peak ${safety.truePeakDbfs} dBFS exceeds 0.1 dBFS`);
        }
        if (Math.abs(safety.dcOffset) >= 0.005) {
          failures.push(`${id}/${condition}: DC offset ${safety.dcOffset} exceeds 0.005`);
        }
        if (
          profile.engine === 'synth'
          && safety.boundaryDiscontinuityExcessDb !== null
          && safety.boundaryDiscontinuityExcessDb > 24
        ) {
          failures.push(
            `${id}/${condition}: boundary discontinuity excess `
            + `${safety.boundaryDiscontinuityExcessDb} dB exceeds 24 dB`,
          );
        }
      }
    }

    if (!Number.isFinite(voice.canonical.logAttackTime)) {
      failures.push(`${id}: non-finite log attack time`);
    }
    if (voice.canonical.loudnessKMax < profile.minimumLoudnessLkfs) {
      failures.push(
        `${id}: loudness ${voice.canonical.loudnessKMax} LKFS is below `
        + `${profile.minimumLoudnessLkfs} LKFS`,
      );
    }
    if (voice.pitch && voice.pitch.minimumConfidence >= 0.8) {
      if (Math.abs(voice.pitch.middleCents) > 10) {
        failures.push(`${id}: centre pitch error ${voice.pitch.middleCents} cents exceeds 10 cents`);
      }
      if (Math.abs(voice.pitch.lowCents) > 25 || Math.abs(voice.pitch.highCents) > 25) {
        failures.push(
          `${id}: range pitch error ${voice.pitch.lowCents}/${voice.pitch.highCents} cents exceeds 25 cents`,
        );
      }
    }

    if (profile.motion === 'darken' && voice.canonical.earlyToLateCentroidRatio <= 1.1) {
      failures.push(`${id}: darkening ratio ${voice.canonical.earlyToLateCentroidRatio} is not above 1.1`);
    }
    if (profile.motion === 'brighten' && voice.canonical.earlyToLateCentroidRatio >= 0.9) {
      failures.push(`${id}: brightening ratio ${voice.canonical.earlyToLateCentroidRatio} is not below 0.9`);
    }
    if (
      profile.motion === 'vary'
      && voice.canonical.spectralFlux <= 0.01
      && voice.canonical.amplitudeModulationDepthDb <= 0.25
    ) {
      failures.push(`${id}: varying voice has neither spectral nor amplitude motion`);
    }
  }

  for (const id of REQUIRED_VELOCITY_TIMBRE) {
    const ratio = report.voices[id]?.velocity.softToCanonicalRatio;
    if (ratio === undefined || ratio >= 0.95) {
      failures.push(`${id}: soft/canonical spectral-centroid ratio ${String(ratio)} is not below 0.95`);
    }
  }

  for (const [name, stress] of Object.entries(report.polyphony)) {
    if (stress.nonFiniteSamples !== 0) {
      failures.push(`${name}: ${stress.nonFiniteSamples} non-finite stress samples`);
    }
    if (stress.realtimeFactor <= 2) {
      failures.push(`${name}: ${stress.realtimeFactor}x real-time is not above the 2x floor`);
    }
  }

  return failures;
}
