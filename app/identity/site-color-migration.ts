export const SITE_COLOR_MIGRATION_BASE_SHA = '96d9a29cc9532a2aca33e5c6f5223e12e9d8bdf8';

const approvedColorPairs = new Set([
  'rgb(230, 126, 34) → rgb(255, 183, 77)',
  'rgb(155, 89, 182) → rgb(197, 138, 214)',
  'rgb(52, 152, 219) → rgb(94, 179, 234)',
  'rgb(233, 30, 99) → rgb(255, 111, 159)',
  'rgb(231, 76, 60) → rgb(255, 123, 123)',
  'rgb(232, 90, 48) → rgb(255, 138, 101)',
  'rgb(240, 112, 72) → rgb(255, 138, 101)',
  'rgba(255, 255, 255, 0.38) → rgba(255, 255, 255, 0.6)',
  'rgb(255, 255, 255) → rgb(18, 18, 18)',
  'rgba(255, 255, 255, 0.87) → rgb(18, 18, 18)',
  'rgba(255, 255, 255, 0.87) → rgb(255, 255, 255)',
]);

interface StyleElement {
  className: string;
  values: Record<string, string>;
}

export function isApprovedSiteColorStyleDifference(
  before: StyleElement,
  after: StyleElement,
  property: string,
) {
  const pair = `${before.values[property]} → ${after.values[property]}`;
  if (property === 'color') return approvedColorPairs.has(pair);
  if (property === 'opacity') {
    return before.className.includes('instrument-btn')
      && (pair === '0.7 → 1' || pair === '0.7 → 0.4');
  }
  if (property === 'outlineColor') {
    return approvedColorPairs.has(`${before.values.color} → ${after.values.color}`)
      && (before.values.outlineWidth === '0px' || before.values.outlineStyle === 'none')
      && (after.values.outlineWidth === '0px' || after.values.outlineStyle === 'none');
  }
  if (!property.startsWith('border') || !property.endsWith('Color')) return false;
  const side = property.replace(/^border/, '').replace(/Color$/, '');
  const width = `border${side}Width`;
  const style = `border${side}Style`;
  return approvedColorPairs.has(`${before.values.color} → ${after.values.color}`)
    && (before.values[width] === '0px' || before.values[style] === 'none')
    && (after.values[width] === '0px' || after.values[style] === 'none');
}
