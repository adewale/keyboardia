#!/usr/bin/env npx tsx
/**
 * Keyboardia Sample Pipeline v2 entry point.
 *
 * The legacy convert→normalize→re-encode implementation was intentionally
 * replaced. `full` now consumes a versioned recipe, verifies immutable
 * lossless masters, renders one delivery generation into candidate storage,
 * runs objective and browser gates, and builds a blinded listening bundle.
 */
import {
  parseSamplePipelineArgs,
  runFullPipeline,
  samplePipelineUsage,
} from './sample-pipeline-cli';

async function main(): Promise<void> {
  const options = parseSamplePipelineArgs(process.argv.slice(2));
  if (options.command === 'help') {
    console.log(samplePipelineUsage());
    return;
  }
  const result = await runFullPipeline(options);
  if (result.state === 'planned') {
    console.log(`\nDry-run plan complete: ${result.plan.renders.length} one-generation render(s)`);
    return;
  }
  console.log(`\nSample pipeline ${result.state}: ${result.outputRoot}`);
  if (result.listeningPage) console.log(`Listening page: ${result.listeningPage}`);
  if (result.state === 'decision-ready') {
    console.log('Promotion is blocked until the blinded review export is accepted and passed back with --promote --decision.');
  }
}

main().catch(error => {
  console.error(`Sample pipeline failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
