#!/usr/bin/env npx tsx

import * as envelopeContract from '../src/shared/envelope-contract-v2';
import * as envelopeOracle from '../src/shared/envelope-oracle-v2';
import * as envelopeNotation from '../src/shared/session-notation-v24';
import { ENVELOPE_NOTATION_EXAMPLE_SESSIONS } from '../src/shared/__fixtures__/envelope-notation-examples';

interface ExampleSummary {
  id: string;
  tracks: number;
  authoredEnvelopes: number;
  capabilityWarnings: string[];
  canonicalNotation: string;
}

const summaries: ExampleSummary[] = ENVELOPE_NOTATION_EXAMPLE_SESSIONS.map((example) => {
  const parsed = envelopeNotation.parseEnvelopeSessionNotation(example.notation);
  if (parsed.diagnostics.length > 0) {
    throw new Error(`${example.id} has notation errors: ${JSON.stringify(parsed.diagnostics)}`);
  }

  const capabilityWarnings = parsed.tracks.flatMap((track) => (
    envelopeNotation.validateEnvelopeNotationCapability(track, example.capabilities[track.label])
      .map((entry) => entry.code)
  ));
  if (JSON.stringify(capabilityWarnings) !== JSON.stringify(example.expectedCapabilityDiagnosticCodes ?? [])) {
    throw new Error(
      `${example.id} capability warnings changed: ${JSON.stringify(capabilityWarnings)}`,
    );
  }

  const authored = parsed.tracks.filter((track) => track.envelope);
  for (const track of authored) {
    const timeline = envelopeOracle.buildEnvelopeOracleTimelineV2({
      envelope: track.envelope!,
      bpm: example.tempo,
      onsetSeconds: 0,
      gatePercent: track.gate,
    });
    const onsetAmplitude = envelopeOracle.amplitudeAtEnvelopeTimeV2(timeline, 0);
    if (!Number.isFinite(timeline.stopSeconds) || !Number.isFinite(onsetAmplitude)) {
      throw new Error(`${example.id}/${track.label} produced a non-finite oracle result`);
    }
  }

  return {
    id: example.id,
    tracks: parsed.tracks.length,
    authoredEnvelopes: authored.length,
    capabilityWarnings,
    canonicalNotation: envelopeNotation.serializeEnvelopeSessionNotation(parsed),
  };
});

// These public-surface counts make this script the explicit tooling owner of
// the pre-production contract. The dead-export gate can distinguish deliberate
// build-only API from runtime code that happens to have tests but no caller.
const publicSurface = {
  contract: Object.keys(envelopeContract).sort(),
  notation: Object.keys(envelopeNotation).sort(),
  oracle: Object.keys(envelopeOracle).sort(),
};

console.log(JSON.stringify({
  sessions: summaries,
  totals: {
    sessions: summaries.length,
    tracks: summaries.reduce((sum, session) => sum + session.tracks, 0),
    authoredEnvelopes: summaries.reduce((sum, session) => sum + session.authoredEnvelopes, 0),
  },
  publicSurface,
}, null, 2));
