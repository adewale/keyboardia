/**
 * Reversible, per-preset renderer cutover ledger.
 *
 * A preset is routed to the translated advanced renderer only when every T3
 * field is present.  Structural translation is intentionally insufficient:
 * PCM metrics, two independent listening approvals and a rollback drill are
 * all product evidence, not code-review guesses.
 */
export type SynthRenderer = 'native' | 'advanced';
export type MigrationEvidenceState = 'pending' | 'approved' | 'rejected';

export interface SynthRendererMigrationRecord {
  renderer: SynthRenderer;
  cohort: string;
  pcm: MigrationEvidenceState;
  pcmReport: string | null;
  approvalRevision: string | null;
  listeningApprovals: readonly string[];
  canaryTelemetry: string | null;
  rollbackVerified: boolean;
}

export const PUBLISHED_NATIVE_SYNTH_PRESETS = [
  'bass', 'lead', 'pad', 'pluck', 'acid', 'funkbass', 'clavinet', 'rhodes',
  'organ', 'wurlitzer', 'discobass', 'strings', 'brass', 'stab', 'sub',
  'shimmer', 'jangle', 'dreampop', 'bell', 'supersaw', 'hypersaw', 'wobble',
  'growl', 'evolving', 'sweep', 'warmpad', 'glass', 'epiano', 'vibes',
  'organphase', 'reese', 'hoover',
] as const;

export type PublishedNativeSynthPreset = typeof PUBLISHED_NATIVE_SYNTH_PRESETS[number];

const pending = (cohort: string): SynthRendererMigrationRecord => Object.freeze({
  renderer: 'native',
  cohort,
  pcm: 'pending',
  pcmReport: null,
  approvalRevision: null,
  listeningApprovals: [],
  canaryTelemetry: null,
  rollbackVerified: false,
});

/**
 * Records are deliberately per preset even while all routes remain native.
 * Updating `renderer` alone cannot enable a route; `isSynthRendererApproved`
 * enforces the complete evidence packet.
 */
export const SYNTH_RENDERER_MIGRATION_MANIFEST: Readonly<
  Record<PublishedNativeSynthPreset, SynthRendererMigrationRecord>
> = Object.freeze(Object.fromEntries(PUBLISHED_NATIVE_SYNTH_PRESETS.map((id, index) => [
  id,
  pending(`cohort-${Math.floor(index / 4) + 1}`),
])) as Record<PublishedNativeSynthPreset, SynthRendererMigrationRecord>);

export function isSynthRendererApproved(preset: string): boolean {
  const record = SYNTH_RENDERER_MIGRATION_MANIFEST[preset as PublishedNativeSynthPreset];
  return Boolean(record
    && record.renderer === 'advanced'
    && record.pcm === 'approved'
    && record.pcmReport
    && record.approvalRevision
    && record.listeningApprovals.length >= 2
    && record.canaryTelemetry
    && record.rollbackVerified);
}

