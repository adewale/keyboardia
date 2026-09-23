import { basename } from 'node:path';

const IDENTITY_SEPARATOR = '\0';
const MANIFEST_SEPARATOR = ' :: ';

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

export function playwrightIdentityManifestLines(identities) {
  return [...identities].sort().map((identity) => {
    const separator = identity.indexOf(IDENTITY_SEPARATOR);
    if (separator < 1 || separator === identity.length - 1) {
      throw new Error(`Invalid Playwright identity: ${JSON.stringify(identity)}`);
    }
    return `${identity.slice(0, separator)}${MANIFEST_SEPARATOR}${identity.slice(separator + 1)}`;
  });
}

export function playwrightIdentitiesFromManifestLines(lines) {
  if (!Array.isArray(lines)) throw new Error('Playwright identity manifest must contain an array');
  const identities = lines.map((line) => {
    if (typeof line !== 'string') {
      throw new Error(`Invalid Playwright identity line: ${JSON.stringify(line)}`);
    }
    const separator = line.indexOf(MANIFEST_SEPARATOR);
    if (separator < 1 || separator === line.length - MANIFEST_SEPARATOR.length) {
      throw new Error(`Invalid Playwright identity line: ${JSON.stringify(line)}`);
    }
    return `${line.slice(0, separator)}${IDENTITY_SEPARATOR}${line.slice(separator + MANIFEST_SEPARATOR.length)}`;
  });
  const canonical = [...identities].sort();
  if (new Set(canonical).size !== canonical.length) {
    throw new Error('Playwright identity manifest contains duplicates');
  }
  if (JSON.stringify(identities) !== JSON.stringify(canonical)) {
    throw new Error('Playwright identity manifest must be sorted');
  }
  return identities;
}

export function diffPlaywrightIdentities(expected, actual) {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return {
    missing: [...expectedSet].filter(identity => !actualSet.has(identity)).sort(),
    unexpected: [...actualSet].filter(identity => !expectedSet.has(identity)).sort(),
  };
}

export function formatPlaywrightIdentity(identity) {
  return identity.replace(IDENTITY_SEPARATOR, MANIFEST_SEPARATOR);
}

export function formatPlaywrightIdentityDiff(diff) {
  const lines = [];
  if (diff.missing.length > 0) {
    lines.push('Missing expected identities:');
    lines.push(...diff.missing.map(identity => `  - ${formatPlaywrightIdentity(identity)}`));
  }
  if (diff.unexpected.length > 0) {
    lines.push('Unexpected identities:');
    lines.push(...diff.unexpected.map(identity => `  + ${formatPlaywrightIdentity(identity)}`));
  }
  return lines.join('\n');
}
