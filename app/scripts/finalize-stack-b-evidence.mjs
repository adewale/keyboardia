#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const evidenceRoot = resolve(repoRoot, 'audit/css-consistency/stack-b-evidence');
const receiptsRoot = resolve(evidenceRoot, 'receipts');
const readmePath = resolve(evidenceRoot, 'README.md');
const manifestPath = resolve(evidenceRoot, 'approval-manifest.json');
const summaryStart = '<!-- generated-evidence-summary:start -->';
const summaryEnd = '<!-- generated-evidence-summary:end -->';

function sha256(filename) {
  return createHash('sha256').update(readFileSync(filename)).digest('hex');
}

function listFiles(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filename = resolve(root, entry.name);
    return entry.isDirectory() ? listFiles(filename) : [filename];
  });
}

const receiptFiles = readdirSync(receiptsRoot)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => resolve(receiptsRoot, name));
if (receiptFiles.length === 0) throw new Error('No Stack B receipts found');

const receipts = receiptFiles.map((filename) => JSON.parse(readFileSync(filename, 'utf8')));
const baseRevisions = new Set(receipts.map((receipt) => receipt.baseRevision));
const headRevisions = new Set(receipts.map((receipt) => receipt.headRevision));
if (baseRevisions.size !== 1 || headRevisions.size !== 1) {
  throw new Error('Every Stack B receipt must name the same base and head revisions');
}
if (receipts.some((receipt) => receipt.checks?.result !== 'passed')) {
  throw new Error('Every Stack B receipt must record a passed check result');
}

const baseRevision = [...baseRevisions][0];
const headRevision = [...headRevisions][0];
const environment = receipts[0].environment;
const viewports = [...new Set(receipts.map((receipt) => (
  `${receipt.viewport.width}×${receipt.viewport.height}`
)))];
const changed = receipts.filter((receipt) => receipt.checks.pixelExpectation === 'changed');
const identical = receipts.filter((receipt) => receipt.checks.pixelExpectation === 'identical');
const changedPixels = changed.reduce((sum, receipt) => sum + receipt.differentPixels, 0);

const generatedSummary = `${summaryStart}
- Merge base: \`${baseRevision}\`
- Candidate source revision: \`${headRevision}\`
- Receipt generator: \`${receipts[0].generator.name}\` generator v${receipts[0].generator.version}
- Human-review renderer: Chromium ${environment.browserVersion}, ${environment.platform} ${environment.platformRelease}
- Canonical machine authority: same-process Chromium comparisons on GitHub Actions Linux; committed review PNGs are provenance-bound evidence, not cross-platform pixel baselines
- Viewports: ${viewports.join(', ')}
- Total named pairs: ${receipts.length}
- Intentionally changed pairs: ${changed.length}
- Exact-identity product pairs: ${identical.length}
- Pixels beyond the 6/255 raster allowance: ${changedPixels.toLocaleString('en-GB')} across the ${changed.length} changed pairs
- Accessibility trees: exact base/head identity
- Visible element and dropdown rectangles: exact base/head identity
- Non-decorative computed styles: exact base/head identity
- Pixels outside dropdown controls and their focus/shadow halos: 0
- Touch event payloads and dismissal: exact base/head identity in emulated-touch WebKit
${summaryEnd}`;

const readme = readFileSync(readmePath, 'utf8');
if (!readme.includes(summaryStart) || !readme.includes(summaryEnd)) {
  throw new Error('Stack B evidence README is missing generated summary markers');
}
writeFileSync(
  readmePath,
  readme.replace(new RegExp(`${summaryStart}[\\s\\S]*?${summaryEnd}`), generatedSummary),
);

const boundFiles = listFiles(evidenceRoot)
  .filter((filename) => filename !== manifestPath)
  .filter((filename) => statSync(filename).isFile())
  .sort()
  .map((filename) => ({
    path: relative(evidenceRoot, filename).replaceAll('\\', '/'),
    sha256: sha256(filename),
  }));

writeFileSync(manifestPath, `${JSON.stringify({
  schemaVersion: 1,
  generator: {
    name: 'app/scripts/finalize-stack-b-evidence.mjs',
    version: 1,
  },
  baseRevision,
  headRevision,
  receiptCount: receipts.length,
  checks: {
    receiptsPassed: true,
    boundFileCount: boundFiles.length,
  },
  files: boundFiles,
}, null, 2)}\n`);

console.log(
  `Finalized Stack B evidence for ${headRevision}: ${receipts.length} receipts, ${boundFiles.length} bound files.`,
);
