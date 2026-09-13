export type SourceId = 'baseline' | 'candidate';

export interface ListeningSection {
  id: string;
  label: string;
  start: number;
  duration: number;
}

export interface ListeningManifest {
  schemaVersion: 2;
  seed: string;
  repeatsPerSection: number;
  sources: Record<SourceId, {
    file: string;
    sha256: string;
    provenance: {
      requestedUrl: string;
      finalUrl: string;
      userAgent: string;
      assets: Array<{ url: string; sha256: string }>;
    };
  }>;
  sections: ListeningSection[];
}

export interface ListeningTrial {
  section: ListeningSection;
  a: SourceId;
  b: SourceId;
}

export function createCounterbalancedTrials(
  manifest: ListeningManifest,
  random: () => number,
): ListeningTrial[] {
  if (manifest.repeatsPerSection < 2 || manifest.repeatsPerSection % 2 !== 0) {
    throw new Error('repeatsPerSection must be a positive even number for A/B counterbalancing');
  }
  const trials = manifest.sections.flatMap(section => {
    const first: SourceId = random() < 0.5 ? 'baseline' : 'candidate';
    const assignments: SourceId[] = [];
    for (let index = 0; index < manifest.repeatsPerSection / 2; index++) {
      assignments.push(first, first === 'baseline' ? 'candidate' : 'baseline');
    }
    return assignments.map(a => ({
      section,
      a,
      b: a === 'baseline' ? 'candidate' as const : 'baseline' as const,
    }));
  });
  for (let index = trials.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [trials[index], trials[other]] = [trials[other], trials[index]];
  }
  return trials;
}
