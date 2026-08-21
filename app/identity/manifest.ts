export type StackAAction =
  | { type: 'click' | 'focus' | 'hover'; selector: string; index?: number }
  | { type: 'press'; key: string };

export interface StackAExpectation {
  selector: string;
  count?: number;
  visible?: boolean;
  attribute?: { name: string; value: string };
  focused?: boolean;
  text?: string;
}

export interface StackAState {
  id: string;
  story: string;
  variant?: string;
  viewport: { width: number; height: number };
  reducedMotion?: 'reduce' | 'no-preference';
  actions?: StackAAction[];
  expectations: StackAExpectation[];
}

export const stackAStates: StackAState[] = [
  {
    id: 'dropdowns-default-collision-canary',
    story: 'dropdowns',
    viewport: { width: 1280, height: 800 },
    expectations: [
      { selector: '.step-count-trigger', visible: true, attribute: { name: 'aria-expanded', value: 'false' } },
      { selector: '.transpose-trigger', visible: true, attribute: { name: 'aria-expanded', value: 'false' } },
      { selector: '.sample-picker', visible: true },
    ],
  },
  {
    id: 'dropdowns-selected',
    story: 'dropdowns',
    variant: 'selected',
    viewport: { width: 1280, height: 800 },
    expectations: [
      { selector: '.step-count-value', text: '24' },
      { selector: '.transpose-value', text: '+7' },
    ],
  },
  {
    id: 'dropdowns-disabled',
    story: 'dropdowns',
    variant: 'disabled',
    viewport: { width: 1280, height: 800 },
    expectations: [
      { selector: '.step-count-trigger', attribute: { name: 'disabled', value: '' } },
      { selector: '.transpose-trigger', attribute: { name: 'disabled', value: '' } },
      { selector: '.dropdown-menu', count: 0 },
    ],
  },
  {
    id: 'step-count-open',
    story: 'dropdowns',
    viewport: { width: 1280, height: 800 },
    actions: [{ type: 'click', selector: '.step-count-trigger' }],
    expectations: [
      { selector: '.step-count-trigger', attribute: { name: 'aria-expanded', value: 'true' } },
      { selector: '.step-count-menu', visible: true },
      { selector: '.step-count-menu [role="option"]', count: 26 },
    ],
  },
  {
    id: 'step-count-focused',
    story: 'dropdowns',
    viewport: { width: 1280, height: 800 },
    actions: [{ type: 'focus', selector: '.step-count-trigger' }],
    expectations: [{ selector: '.step-count-trigger', focused: true }],
  },
  {
    id: 'step-count-trigger-hover',
    story: 'dropdowns',
    viewport: { width: 1280, height: 800 },
    actions: [{ type: 'hover', selector: '.step-count-trigger' }],
    expectations: [{ selector: '.step-count-trigger', visible: true }],
  },
  {
    id: 'transpose-active-trigger-hover',
    story: 'dropdowns',
    variant: 'selected',
    viewport: { width: 1280, height: 800 },
    actions: [{ type: 'hover', selector: '.transpose-trigger.active' }],
    expectations: [{ selector: '.transpose-trigger.active', visible: true }],
  },
  {
    id: 'step-count-selection',
    story: 'dropdowns',
    viewport: { width: 1280, height: 800 },
    actions: [
      { type: 'click', selector: '.step-count-trigger' },
      { type: 'click', selector: '.step-option', index: 0 },
    ],
    expectations: [
      { selector: '.step-count-menu', count: 0 },
      { selector: '[data-event-log]', text: 'step:4' },
    ],
  },
  {
    id: 'transpose-open',
    story: 'dropdowns',
    viewport: { width: 1280, height: 800 },
    actions: [{ type: 'click', selector: '.transpose-trigger' }],
    expectations: [
      { selector: '.transpose-trigger', attribute: { name: 'aria-expanded', value: 'true' } },
      { selector: '.transpose-menu', visible: true },
      { selector: '.transpose-menu [role="option"]', count: 17 },
    ],
  },
  {
    id: 'transpose-escape',
    story: 'dropdowns',
    viewport: { width: 1280, height: 800 },
    actions: [
      { type: 'click', selector: '.transpose-trigger' },
      { type: 'focus', selector: '.transpose-option', index: 0 },
      { type: 'press', key: 'Escape' },
    ],
    expectations: [
      { selector: '.transpose-trigger', attribute: { name: 'aria-expanded', value: 'false' } },
      { selector: '.transpose-menu', count: 0 },
    ],
  },
  {
    id: 'transpose-option-hover',
    story: 'dropdowns',
    viewport: { width: 1280, height: 800 },
    actions: [
      { type: 'click', selector: '.transpose-trigger' },
      { type: 'hover', selector: '.transpose-option', index: 0 },
    ],
    expectations: [{ selector: '.transpose-option', visible: true }],
  },
  {
    id: 'transpose-option-focused',
    story: 'dropdowns',
    viewport: { width: 1280, height: 800 },
    actions: [
      { type: 'click', selector: '.transpose-trigger' },
      { type: 'focus', selector: '.transpose-option', index: 0 },
      { type: 'press', key: 'Tab' },
    ],
    expectations: [{ selector: '.transpose-option:focus', focused: true }],
  },
  {
    id: 'transpose-selection',
    story: 'dropdowns',
    viewport: { width: 1280, height: 800 },
    actions: [
      { type: 'click', selector: '.transpose-trigger' },
      { type: 'click', selector: '.transpose-option', index: 0 },
    ],
    expectations: [
      { selector: '.transpose-menu', count: 0 },
      { selector: '[data-event-log]', text: 'transpose:' },
    ],
  },
  {
    id: 'step-count-open-reduced-motion',
    story: 'dropdowns',
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    actions: [{ type: 'click', selector: '.step-count-trigger' }],
    expectations: [{ selector: '.step-count-menu', visible: true }],
  },
  {
    id: 'step-count-open-mobile-portrait',
    story: 'dropdowns',
    viewport: { width: 375, height: 812 },
    actions: [{ type: 'click', selector: '.step-count-trigger' }],
    expectations: [
      { selector: '.step-count-menu', visible: true },
      { selector: '.step-count-menu [role="option"]', count: 26 },
    ],
  },
  {
    id: 'step-count-header-hover-mobile-portrait',
    story: 'dropdowns',
    viewport: { width: 375, height: 812 },
    actions: [
      { type: 'click', selector: '.step-count-trigger' },
      { type: 'hover', selector: '.step-count-menu .category-header' },
    ],
    expectations: [{ selector: '.step-count-menu .category-header', visible: true }],
  },
  {
    id: 'transpose-open-mobile-portrait',
    story: 'dropdowns',
    viewport: { width: 375, height: 812 },
    actions: [{ type: 'click', selector: '.transpose-trigger' }],
    expectations: [
      { selector: '.transpose-menu', visible: true },
      { selector: '.transpose-menu [role="option"]', count: 17 },
    ],
  },
  {
    id: 'step-count-open-mobile-landscape-compact',
    story: 'dropdowns',
    viewport: { width: 480, height: 320 },
    actions: [{ type: 'click', selector: '.step-count-trigger' }],
    expectations: [{ selector: '.step-count-menu', visible: true }],
  },
  {
    id: 'transpose-open-mobile-landscape-wide',
    story: 'dropdowns',
    viewport: { width: 844, height: 390 },
    actions: [{ type: 'click', selector: '.transpose-trigger' }],
    expectations: [{ selector: '.transpose-menu', visible: true }],
  },
  {
    id: 'step-count-open-width-768',
    story: 'dropdowns',
    viewport: { width: 768, height: 1024 },
    actions: [{ type: 'click', selector: '.step-count-trigger' }],
    expectations: [{ selector: '.step-count-menu', visible: true }],
  },
  {
    id: 'step-count-open-width-769',
    story: 'dropdowns',
    viewport: { width: 769, height: 1024 },
    actions: [{ type: 'click', selector: '.step-count-trigger' }],
    expectations: [{ selector: '.step-count-menu', visible: true }],
  },
  {
    id: 'picker-add-desktop-expanded',
    story: 'picker',
    viewport: { width: 1280, height: 800 },
    expectations: [
      { selector: '.sample-picker', visible: true },
      { selector: '.picker-category.expanded', count: 6 },
      { selector: '.instrument-btn', count: 99 },
    ],
  },
  {
    id: 'picker-add-mobile-collapsed',
    story: 'picker',
    viewport: { width: 375, height: 812 },
    expectations: [
      { selector: '.picker-category.expanded', count: 1 },
      { selector: '.instrument-btn', count: 30 },
    ],
  },
  {
    id: 'picker-add-mobile-expanded',
    story: 'picker',
    viewport: { width: 375, height: 812 },
    actions: [{ type: 'click', selector: '.picker-category .category-header', index: 1 }],
    expectations: [
      { selector: '.picker-category.expanded', count: 2 },
      { selector: '.picker-category .category-header', visible: true },
    ],
  },
  {
    id: 'picker-change-current',
    story: 'picker',
    variant: 'change',
    viewport: { width: 1280, height: 800 },
    expectations: [
      { selector: '.sample-picker.variant-change', visible: true },
      { selector: '.instrument-btn.current', count: 1, attribute: { name: 'aria-current', value: 'true' } },
    ],
  },
  {
    id: 'picker-selection',
    story: 'picker',
    viewport: { width: 1280, height: 800 },
    actions: [{ type: 'click', selector: '.instrument-btn', index: 0 }],
    expectations: [{ selector: '[data-event-log]', text: 'sample:' }],
  },
  {
    id: 'picker-add-mobile-landscape-narrow',
    story: 'picker',
    viewport: { width: 667, height: 375 },
    expectations: [
      { selector: '.picker-category.expanded', count: 1 },
      { selector: '.instrument-btn', count: 30 },
    ],
  },
  {
    id: 'picker-add-mobile-landscape-wide',
    story: 'picker',
    viewport: { width: 844, height: 390 },
    expectations: [
      { selector: '.picker-category.expanded', count: 6 },
      { selector: '.instrument-btn', count: 99 },
    ],
  },
  {
    id: 'standalone-fx-closed',
    story: 'effects',
    viewport: { width: 844, height: 390 },
    expectations: [
      { selector: '.effects-toggle', visible: true, attribute: { name: 'aria-expanded', value: 'false' } },
      { selector: '.effects-container', count: 0 },
    ],
  },
  {
    id: 'standalone-fx-open-active',
    story: 'effects',
    variant: 'active',
    viewport: { width: 844, height: 390 },
    actions: [{ type: 'click', selector: '.effects-toggle' }],
    expectations: [
      { selector: '.effects-toggle', attribute: { name: 'aria-expanded', value: 'true' } },
      { selector: '.effects-container', visible: true },
      { selector: '.effects-bypass-btn', attribute: { name: 'aria-pressed', value: 'true' } },
    ],
  },
  {
    id: 'standalone-fx-open-bypassed',
    story: 'effects',
    variant: 'bypassed',
    viewport: { width: 844, height: 390 },
    actions: [{ type: 'click', selector: '.effects-toggle' }],
    expectations: [
      { selector: '.effects-bypass-btn', text: 'Bypassed', attribute: { name: 'aria-pressed', value: 'false' } },
    ],
  },
  {
    id: 'standalone-fx-disabled',
    story: 'effects',
    variant: 'disabled',
    viewport: { width: 844, height: 390 },
    expectations: [
      { selector: '.effects-panel.disabled', visible: true },
      { selector: '.effects-toggle', attribute: { name: 'disabled', value: '' } },
    ],
  },
  {
    id: 'desktop-integrated-fx-open',
    story: 'transport-fx',
    viewport: { width: 1280, height: 800 },
    actions: [{ type: 'click', selector: '.fx-btn' }],
    expectations: [
      { selector: '.fx-btn', attribute: { name: 'aria-expanded', value: 'true' } },
      { selector: '.transport-fx-panel', visible: true, attribute: { name: 'aria-hidden', value: 'false' } },
    ],
  },
  {
    id: 'desktop-integrated-fx-active-hover',
    story: 'transport-fx',
    viewport: { width: 1280, height: 800 },
    actions: [
      { type: 'click', selector: '.fx-btn' },
      { type: 'hover', selector: '.fx-master-toggle' },
    ],
    expectations: [
      { selector: '.fx-master-toggle', visible: true, text: 'Active' },
    ],
  },
  {
    id: 'desktop-integrated-fx-bypassed-hover',
    story: 'transport-fx',
    variant: 'bypassed',
    viewport: { width: 1280, height: 800 },
    actions: [
      { type: 'click', selector: '.fx-btn' },
      { type: 'hover', selector: '.fx-master-toggle' },
    ],
    expectations: [
      { selector: '.fx-master-toggle', visible: true, text: 'Bypassed' },
    ],
  },
  {
    id: 'landscape-drawer-closed',
    story: 'drawer',
    variant: 'closed',
    viewport: { width: 667, height: 375 },
    expectations: [{ selector: '.track-drawer', count: 0 }],
  },
  {
    id: 'landscape-drawer-open',
    story: 'drawer',
    viewport: { width: 667, height: 375 },
    expectations: [
      { selector: '.track-drawer', visible: true },
      { selector: '.drawer-action-btn-compact.destructive', visible: true, text: 'Delete' },
    ],
  },
  {
    id: 'landscape-drawer-keyboard-focus',
    story: 'drawer',
    viewport: { width: 667, height: 375 },
    actions: [{ type: 'focus', selector: '.drawer-action-btn-compact.destructive' }],
    expectations: [{ selector: '.drawer-action-btn-compact.destructive', focused: true }],
  },
  {
    id: 'landscape-drawer-delete-action',
    story: 'drawer',
    viewport: { width: 667, height: 375 },
    actions: [{ type: 'click', selector: '.drawer-action-btn-compact.destructive' }],
    expectations: [{ selector: '[data-event-log]', text: 'delete' }],
  },
  {
    id: 'landscape-drawer-reduced-motion',
    story: 'drawer',
    viewport: { width: 667, height: 375 },
    reducedMotion: 'reduce',
    expectations: [{ selector: '.track-drawer', visible: true }],
  },
];
