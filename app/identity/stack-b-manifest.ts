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

export interface StackBFullAppState {
  id: string;
  viewport: { width: number; height: number };
  action: 'hidden-portrait' | 'hidden-landscape' | 'desktop-step';
  intendedResult: string;
}

export const stackBFullAppStates: StackBFullAppState[] = [
  {
    id: 'full-app-desktop-step-open',
    viewport: { width: 1280, height: 800 },
    action: 'desktop-step',
    intendedResult: 'Desktop row triggers and the open step menu receive the pilot skin.',
  },
  {
    id: 'full-app-mobile-portrait-hidden',
    viewport: { width: 375, height: 812 },
    action: 'hidden-portrait',
    intendedResult: 'Portrait consumption remains pixel-identical because editing dropdowns stay hidden.',
  },
  {
    id: 'full-app-landscape-compact-unaffected',
    viewport: { width: 480, height: 320 },
    action: 'hidden-landscape',
    intendedResult: 'Compact landscape remains pixel-identical because TrackDrawer uses a native select and transpose buttons.',
  },
  {
    id: 'full-app-landscape-narrow-unaffected',
    viewport: { width: 667, height: 375 },
    action: 'hidden-landscape',
    intendedResult: 'Narrow landscape remains pixel-identical because TrackDrawer uses other controls.',
  },
  {
    id: 'full-app-landscape-wide-unaffected',
    viewport: { width: 844, height: 390 },
    action: 'hidden-landscape',
    intendedResult: 'Wide landscape remains pixel-identical because TrackDrawer uses a native select and transpose buttons.',
  },
  {
    id: 'full-app-tablet-landscape-step-open',
    viewport: { width: 1024, height: 768 },
    action: 'desktop-step',
    intendedResult: 'Tablet landscape keeps the desktop editor and receives the pilot skin.',
  },
  {
    id: 'full-app-width-768-step-open',
    viewport: { width: 768, height: 1024 },
    action: 'desktop-step',
    intendedResult: 'The inclusive 768px boundary preserves product mode and receives the pilot skin.',
  },
  {
    id: 'full-app-width-769-step-open',
    viewport: { width: 769, height: 1024 },
    action: 'desktop-step',
    intendedResult: 'The 769px neighbour preserves product mode and receives the pilot skin.',
  },
];

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
