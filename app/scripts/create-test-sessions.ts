#!/usr/bin/env npx tsx
/**
 * Script to create test sessions for each synth preset.
 * Each session has a single track with a simple pattern to verify the sound works.
 *
 * Usage: npx tsx scripts/create-test-sessions.ts
 *
 * This creates sessions at the deployed URL that can be used for manual testing.
 */

const BASE_URL = 'https://keyboardia.adewale-883.workers.dev';

// All synth presets organized by category
const SYNTH_PRESETS = {
  core: ['bass', 'lead', 'pad', 'pluck', 'acid'],
  keys: ['rhodes', 'organ', 'wurlitzer', 'clavinet'],
  genre: ['funkbass', 'discobass', 'strings', 'brass', 'stab', 'sub'],
  ambient: ['shimmer', 'jangle', 'dreampop', 'bell'],
};

// Simple 4-on-the-floor pattern for testing
function createTestPattern(): boolean[] {
  const steps = Array(64).fill(false);
  // Beat on every 4th step (quarter notes)
  [0, 4, 8, 12].forEach(i => { steps[i] = true; });
  return steps;
}

// Create a session with a single synth track
async function createTestSession(presetName: string, _category: string): Promise<string | null> {
  const sampleId = `synth:${presetName}`;
  const displayName = presetName.charAt(0).toUpperCase() + presetName.slice(1);

  const sessionData = {
    tracks: [
      {
        id: `track-0`,
        name: displayName,
        sampleId,
        steps: createTestPattern(),
        parameterLocks: Array(64).fill(null),
        volume: 1,
        muted: false,
        playbackMode: 'oneshot',
        transpose: 0,
        stepCount: 16,
      },
    ],
    tempo: 120,
    swing: 0,
    version: 1,
  };

  try {
    const response = await fetch(`${BASE_URL}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sessionData),
    });

    if (!response.ok) {
      console.error(`Failed to create session for ${presetName}: ${response.status}`);
      return null;
    }

    const result = await response.json() as { id: string; url: string };
    return result.url;
  } catch (error) {
    console.error(`Error creating session for ${presetName}:`, error);
    return null;
  }
}

async function main() {
  console.log('Creating test sessions for all synth presets...\n');

  const sessions: Record<string, Record<string, string>> = {};

  for (const [category, presets] of Object.entries(SYNTH_PRESETS)) {
    console.log(`\n=== ${category.toUpperCase()} ===`);
    sessions[category] = {};

    for (const preset of presets) {
      const url = await createTestSession(preset, category);
      if (url) {
        sessions[category][preset] = url;
        console.log(`  ✓ ${preset}: ${url}`);
      } else {
        console.log(`  ✗ ${preset}: FAILED`);
      }
    }
  }

  // Output summary as markdown
  console.log('\n\n## Test Sessions\n');
  console.log('Use these URLs to test each synth preset in isolation:\n');

  for (const [category, presets] of Object.entries(sessions)) {
    console.log(`### ${category.charAt(0).toUpperCase() + category.slice(1)}\n`);
    console.log('| Preset | URL |');
    console.log('|--------|-----|');
    for (const [preset, url] of Object.entries(presets)) {
      console.log(`| ${preset} | [Open](${url}) |`);
    }
    console.log('');
  }
}

main().catch(console.error);
