import { stackAStates } from './manifest';

/**
 * One-time visual-migration authority. If the merge base moves, the migration
 * and its evidence must be regenerated and this SHA deliberately updated.
 * Once the PR lands, later dropdown changes compare from a different base and
 * return to exact Stack A identity.
 */
export const STACK_B_MIGRATION_BASE_SHA = '58264dd5ae274f63b1cd80b72aa823b76b21f28b';

export const stackBStateIds = [
  'dropdowns-default-collision-canary',
  'dropdowns-selected',
  'dropdowns-disabled',
  'step-count-open',
  'step-count-focused',
  'step-count-trigger-hover',
  'transpose-active-trigger-hover',
  'step-count-selection',
  'transpose-open',
  'transpose-escape',
  'transpose-option-hover',
  'transpose-option-focused',
  'transpose-selection',
  'step-count-open-reduced-motion',
  'step-count-open-mobile-portrait',
  'step-count-header-hover-mobile-portrait',
  'transpose-open-mobile-portrait',
  'step-count-open-mobile-landscape-compact',
  'transpose-open-mobile-landscape-wide',
  'step-count-open-width-768',
  'step-count-open-width-769',
] as const;

export const stackBStateIdSet = new Set<string>(stackBStateIds);

export const stackBStates = stackAStates.filter((state) => stackBStateIdSet.has(state.id));

if (stackBStates.length !== stackBStateIds.length) {
  throw new Error('Stack B manifest contains an unknown or duplicate catalogue state');
}

export const stackBDecorativeProperties = new Set([
  'backgroundColor',
  'backgroundImage',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRadius',
  'boxShadow',
  'color',
  'opacity',
  'outlineColor',
  'outlineOffset',
  'outlineStyle',
  'outlineWidth',
]);
