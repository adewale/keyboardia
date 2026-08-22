#!/usr/bin/env node

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const evidenceRoot = resolve(repoRoot, 'audit/css-consistency/stack-b-evidence');

const sheets = [
  {
    id: '01-trigger-and-interaction-states',
    title: 'Trigger and interaction states',
    rows: [
      ['catalogue--dropdowns-default-collision-canary', '1. Closed triggers — flat shared surface, accessible edge, orange chevrons'],
      ['catalogue--dropdowns-selected', '2. Selected values — same treatment with representative non-default values'],
      ['catalogue--dropdowns-disabled', '3. Disabled — shared flat surface under the unchanged 0.5 opacity'],
      ['catalogue--step-count-focused', '4. Keyboard focus — explicit 2px information-blue outline'],
      ['catalogue--step-count-trigger-hover', '5. Trigger hover — shared flat hover surface and orange edge'],
      ['catalogue--transpose-active-trigger-hover', '6. Active transpose hover — lighter feature blue remains legible on the flat hover surface'],
      ['catalogue--step-count-selection', '7. Step selection — same event payload; focus ownership returns to trigger'],
      ['catalogue--transpose-escape', '8. Escape — same dismissal; keyboard focus returns visibly to trigger'],
      ['catalogue--transpose-selection', '9. Transpose selection — same event payload; focus ownership returns to trigger'],
    ],
  },
  {
    id: '02-menu-states',
    title: 'Open menu states',
    frameHeight: 500,
    rows: [
      ['catalogue--step-count-open', '10. Step menu — flat shared surface, selected row + orange check'],
      ['catalogue--transpose-open', '11. Transpose menu — the same flat shared visual hierarchy'],
      ['catalogue--transpose-option-hover', '12. Option hover — shared flat hover surface'],
      ['catalogue--transpose-option-focused', '13. Option focus — information-blue inset outline without an orange halo'],
      ['catalogue--step-count-open-reduced-motion', '14. Reduced motion — same settled pixels, entrance animation still removed'],
    ],
  },
  {
    id: '03-responsive-component-states',
    title: 'Responsive component states',
    rows: [
      ['catalogue--step-count-open-mobile-portrait', '15. Component portrait — open step menu'],
      ['catalogue--step-count-header-hover-mobile-portrait', '16. Component portrait — category-header hover'],
      ['catalogue--transpose-open-mobile-portrait', '17. Component portrait — open transpose menu'],
      ['catalogue--step-count-open-mobile-landscape-compact', '18. Compact landscape fixture — open step menu'],
      ['catalogue--transpose-open-mobile-landscape-wide', '19. Wide landscape fixture — open transpose menu'],
      ['catalogue--step-count-open-width-768', '20. Inclusive 768px component boundary'],
      ['catalogue--step-count-open-width-769', '21. 769px component boundary neighbour'],
    ],
  },
  {
    id: '04-production-build-canaries',
    title: 'Production-build canaries',
    rows: [
      ['full-app--full-app-desktop-step-open', '22. Desktop product — every visible trigger plus an open step menu'],
      ['full-app--full-app-mobile-portrait-hidden', '23. Portrait product — exact identity; editing dropdowns remain absent'],
      ['full-app--full-app-landscape-compact-unaffected', '24. Compact landscape product — exact identity; TrackDrawer uses other controls'],
      ['full-app--full-app-landscape-narrow-unaffected', '25. Narrow landscape product — exact identity; TrackDrawer uses other controls'],
      ['full-app--full-app-landscape-wide-unaffected', '26. Wide landscape product — exact identity; TrackDrawer uses other controls'],
      ['full-app--full-app-tablet-landscape-step-open', '27. Tablet landscape product — desktop editor with open step menu'],
      ['full-app--full-app-width-768-step-open', '28. Production boundary at 768px'],
      ['full-app--full-app-width-769-step-open', '29. Production boundary at 769px'],
    ],
  },
  {
    id: '05-selected-option-approval-focus',
    title: 'Selected option approval focus',
    frameHeight: 520,
    rows: [
      ['catalogue--step-count-open', '10. Focused approval view — neutral tonal row plus orange check; no rail or tinted banner'],
    ],
  },
];

function dataUrl(path) {
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  for (const sheet of sheets) {
    const rows = sheet.rows.map(([id, label]) => {
      const before = dataUrl(resolve(evidenceRoot, 'review/before', `${id}.png`));
      const after = dataUrl(resolve(evidenceRoot, 'review/after', `${id}.png`));
      return `
        <section class="row">
          <h2>${escapeHtml(label)}</h2>
          <div class="pair">
            <figure><figcaption>Before</figcaption><div class="frame"><img src="${before}" alt=""></div></figure>
            <figure><figcaption>After</figcaption><div class="frame"><img src="${after}" alt=""></div></figure>
          </div>
        </section>`;
    }).join('');
    await page.setContent(`<!doctype html><html><head><style>
      * { box-sizing: border-box; }
      body { margin: 0; padding: 32px; background: #0b0b0d; color: #eee; font: 15px system-ui, sans-serif; }
      header { margin: 0 0 28px; }
      h1 { margin: 0 0 8px; color: #f07048; font-size: 28px; }
      header p { margin: 0; color: #aaa; }
      .row { margin: 0 0 30px; padding: 20px; background: #17171a; border: 1px solid #3a3a42; border-radius: 12px; }
      h2 { margin: 0 0 14px; font-size: 16px; font-weight: 600; }
      .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
      figure { margin: 0; min-width: 0; }
      figcaption { margin: 0 0 8px; color: #bbb; font: 700 12px ui-monospace, monospace; text-transform: uppercase; letter-spacing: .12em; }
      .frame { display: grid; place-items: center; width: 100%; height: ${sheet.frameHeight ?? 360}px; padding: 12px; overflow: hidden; background: #101012; border: 1px solid #303038; border-radius: 8px; }
      img { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: auto; }
    </style></head><body>
      <header><h1>${escapeHtml(sheet.title)}</h1><p>Stack B dropdown pilot — left is merge base, right is candidate head</p></header>
      ${rows}
    </body></html>`, { waitUntil: 'load' });
    const output = resolve(evidenceRoot, 'contact-sheets', `${sheet.id}.png`);
    mkdirSync(dirname(output), { recursive: true });
    await page.screenshot({ path: output, fullPage: true, animations: 'disabled' });
  }

  const comparisonOutput = resolve(evidenceRoot, 'qa', 'option-1-source-vs-implementation.png');
  mkdirSync(dirname(comparisonOutput), { recursive: true });
  await page.setViewportSize({ width: 634, height: 454 });
  await page.setContent(`<!doctype html><html><head><style>
    * { box-sizing: border-box; }
    html, body { width: 634px; height: 454px; margin: 0; overflow: hidden; background: #0b0b0d; }
    body { display: grid; grid-template-columns: 305px 305px; gap: 24px; }
    img { display: block; width: 305px; height: 454px; object-fit: fill; }
  </style></head><body>
    <img src="${dataUrl(resolve(evidenceRoot, 'reference', 'option-1-tonal-selection.png'))}" alt="Approved Option 1 reference">
    <img src="${dataUrl(resolve(evidenceRoot, 'review', 'after', 'catalogue--step-count-open.png'))}" alt="Candidate implementation">
  </body></html>`, { waitUntil: 'load' });
  await page.screenshot({ path: comparisonOutput, animations: 'disabled' });
} finally {
  await browser.close();
}
