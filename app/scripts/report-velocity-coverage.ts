#!/usr/bin/env npx tsx

/**
 * Velocity Coverage Report
 *
 * Reports velocity layer coverage for all sampled instruments.
 * Identifies instruments that would benefit most from velocity layers.
 *
 * Run: npx tsx scripts/report-velocity-coverage.ts
 */

import fs from 'fs';
import path from 'path';

const INSTRUMENTS_DIR = 'public/instruments';

interface SampleMapping {
  note: number;
  file?: string;
  velocityMin?: number;
  velocityMax?: number;
}

interface Manifest {
  id: string;
  name: string;
  samples: SampleMapping[];
}

type Priority = 'critical' | 'high' | 'medium' | 'low';

interface VelocityReport {
  instrument: string;
  name: string;
  noteCount: number;
  velocityLayers: number;
  hasVelocityLayers: boolean;
  priority: Priority;
  recommendation: string;
}

// Instruments that benefit most from velocity layers
const VELOCITY_PRIORITY: Record<string, { priority: Priority; reason: string }> = {
  // Critical - dramatic timbre change with velocity
  'piano': { priority: 'critical', reason: 'Hammer mechanism creates vastly different timbres at different dynamics' },
  'rhodes-ep': { priority: 'critical', reason: 'Tine bark appears only at high velocity' },
  'acoustic-snare': { priority: 'critical', reason: 'Ghost notes vs. full hits are essential for groove' },

  // High - noticeable timbre change
  'finger-bass': { priority: 'high', reason: 'Pluck intensity affects string buzz and attack' },
  'acoustic-kick': { priority: 'high', reason: 'Light touches vs. full hits for dynamics' },
  'clean-guitar': { priority: 'high', reason: 'Pick attack varies significantly' },
  'acoustic-guitar': { priority: 'high', reason: 'Fingerpicked vs. strummed character' },
  'alto-sax': { priority: 'high', reason: 'Breath pressure affects tone' },
  'french-horn': { priority: 'high', reason: 'Embouchure tension changes timbre' },

  // Medium - some benefit
  'vibraphone': { priority: 'medium', reason: 'Mallet hardness equivalent' },
  'marimba': { priority: 'medium', reason: 'Mallet intensity affects tone' },
  'string-section': { priority: 'medium', reason: 'Bow pressure variation' },
  'acoustic-hihat-closed': { priority: 'medium', reason: 'Stick shoulder vs. tip' },
  'acoustic-hihat-open': { priority: 'medium', reason: 'Strike intensity' },
  'acoustic-ride': { priority: 'medium', reason: 'Bell vs. edge dynamics' },

  // Low - velocity layers less important
  '808-kick': { priority: 'low', reason: 'Electronic - consistent by design' },
  '808-snare': { priority: 'low', reason: 'Electronic - consistent by design' },
  '808-hihat-closed': { priority: 'low', reason: 'Electronic - consistent by design' },
  '808-hihat-open': { priority: 'low', reason: 'Electronic - consistent by design' },
  '808-clap': { priority: 'low', reason: 'Electronic - consistent by design' },
  'vinyl-crackle': { priority: 'low', reason: 'Texture - no velocity concept' },
};

function analyzeVelocityCoverage(manifest: Manifest): VelocityReport {
  const notes = new Set(manifest.samples.map(s => s.note));
  const noteCount = notes.size;

  // Check if any sample has velocity ranges defined
  const hasVelocityLayers = manifest.samples.some(
    s => s.velocityMin !== undefined || s.velocityMax !== undefined
  );

  // Count max velocity layers per note
  const layersPerNote = new Map<number, number>();
  for (const sample of manifest.samples) {
    const current = layersPerNote.get(sample.note) || 0;
    layersPerNote.set(sample.note, current + 1);
  }
  const maxLayers = Math.max(...layersPerNote.values(), 1);

  const priorityInfo = VELOCITY_PRIORITY[manifest.id];
  const priority = priorityInfo?.priority || 'medium';

  let recommendation: string;
  if (hasVelocityLayers) {
    recommendation = `Has ${maxLayers} velocity layers - good!`;
  } else if (priority === 'critical') {
    recommendation = `NEEDS 3 velocity layers (pp/mf/ff) - ${priorityInfo?.reason}`;
  } else if (priority === 'high') {
    recommendation = `Should have 2 velocity layers - ${priorityInfo?.reason}`;
  } else if (priority === 'medium') {
    recommendation = `Would benefit from 2 velocity layers - ${priorityInfo?.reason}`;
  } else {
    recommendation = `Single velocity OK - ${priorityInfo?.reason || 'not expressive instrument'}`;
  }

  return {
    instrument: manifest.id,
    name: manifest.name,
    noteCount,
    velocityLayers: hasVelocityLayers ? maxLayers : 1,
    hasVelocityLayers,
    priority,
    recommendation,
  };
}

function main(): void {
  console.log('\n🎵 VELOCITY LAYER COVERAGE REPORT\n');
  console.log('─'.repeat(70) + '\n');

  const instruments = fs.readdirSync(INSTRUMENTS_DIR)
    .filter(f => fs.statSync(path.join(INSTRUMENTS_DIR, f)).isDirectory())
    .sort();

  const reports: VelocityReport[] = [];

  for (const instrument of instruments) {
    const manifestPath = path.join(INSTRUMENTS_DIR, instrument, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    const manifest: Manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    reports.push(analyzeVelocityCoverage(manifest));
  }

  // Group by priority
  const priorityOrder: Priority[] = ['critical', 'high', 'medium', 'low'];

  for (const priority of priorityOrder) {
    const group = reports.filter(r => r.priority === priority && !r.hasVelocityLayers);
    if (group.length === 0) continue;

    const icon = priority === 'critical' ? '🔴' :
                 priority === 'high' ? '🟠' :
                 priority === 'medium' ? '🟡' : '🟢';

    console.log(`${icon} ${priority.toUpperCase()} PRIORITY:\n`);

    for (const report of group) {
      console.log(`   ${report.instrument} (${report.name})`);
      console.log(`      Notes: ${report.noteCount}, Velocity layers: ${report.velocityLayers}`);
      console.log(`      ${report.recommendation}`);
      console.log();
    }
  }

  // Show instruments that already have velocity layers
  const withLayers = reports.filter(r => r.hasVelocityLayers);
  if (withLayers.length > 0) {
    console.log('✅ ALREADY HAS VELOCITY LAYERS:\n');
    for (const report of withLayers) {
      console.log(`   ${report.instrument}: ${report.velocityLayers} layers`);
    }
    console.log();
  }

  // Summary
  console.log('─'.repeat(70));

  const critical = reports.filter(r => r.priority === 'critical' && !r.hasVelocityLayers);
  const high = reports.filter(r => r.priority === 'high' && !r.hasVelocityLayers);
  const withLayersCount = reports.filter(r => r.hasVelocityLayers).length;

  console.log(`\nSUMMARY:`);
  console.log(`   Total instruments: ${reports.length}`);
  console.log(`   With velocity layers: ${withLayersCount}`);
  console.log(`   Critical priority (need 3 layers): ${critical.length}`);
  console.log(`   High priority (need 2 layers): ${high.length}`);

  // File size estimate
  const criticalSamples = critical.reduce((sum, r) => sum + r.noteCount * 2, 0); // 2 additional layers
  const highSamples = high.reduce((sum, r) => sum + r.noteCount, 0); // 1 additional layer
  const estimatedMB = ((criticalSamples + highSamples) * 50) / 1024; // ~50KB per sample

  console.log(`\n   Estimated additional file size: ~${estimatedMB.toFixed(1)}MB`);
  console.log(`   (${criticalSamples + highSamples} additional samples at ~50KB each)\n`);
}

main();
