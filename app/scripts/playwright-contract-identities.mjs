import { createHash } from 'node:crypto';
import { basename } from 'node:path';

export function parsePlaywrightListIdentities(output) {
  return output.split(/\r?\n/).flatMap((line) => {
    const match = line.match(
      /^\s+\[([^\]]+)]\s+›\s+([^:]+\.spec\.[cm]?[jt]sx?):\d+:\d+\s+›\s+(.+)$/,
    );
    return match ? [`${match[1]}\0${basename(match[2])} › ${match[3]}`] : [];
  });
}

export function collectPlaywrightReportIdentities(report) {
  const observed = [];
  const walk = (suites, ancestors = []) => {
    for (const suite of suites ?? []) {
      const isFileSuite = suite.title === basename(suite.file ?? '');
      const nextAncestors = isFileSuite ? ancestors : [...ancestors, suite.title];
      for (const spec of suite.specs ?? []) {
        const identity = `${basename(spec.file)} › ${[...nextAncestors, spec.title].join(' › ')}`;
        for (const test of spec.tests ?? []) observed.push(`${test.projectName}\0${identity}`);
      }
      walk(suite.suites, nextAncestors);
    }
  };
  walk(report.suites);
  return observed;
}

export function hashPlaywrightIdentities(identities) {
  return createHash('sha256').update([...identities].sort().join('\n')).digest('hex');
}
