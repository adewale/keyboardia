// @vitest-environment jsdom
/**
 * The two-line control block (specs/PIANO-ROLL-DOCK.md, phase 3).
 *
 * jsdom computes no layout, so these tests pin the contracts the layout
 * depends on: the three placed children of .track-left (lesson 61), the
 * stylesheet's placement and width rules, the order of the two control
 * groups, the badge slot shared by editable and published rows (lesson 62
 * coda), the transpose readout, and the drop target accepting a drag on
 * dragenter (lesson 62).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, createEvent, fireEvent, render } from '@testing-library/react';
import type { Track } from '../types';
import { TrackRow } from './TrackRow';
import { getInstrumentCategoryColor } from './sample-constants';

vi.mock('../audio/prepare-instrument', () => ({
  prepareInstrument: vi.fn(),
}));

afterEach(cleanup);

const trackRowCss = readFileSync(resolve(__dirname, 'TrackRow.css'), 'utf8');
const indexCss = readFileSync(resolve(__dirname, '../index.css'), 'utf8');

function makeTrack(overrides: Partial<Track> = {}): Track {
  return {
    id: 'lead',
    name: 'Lead',
    sampleId: 'tone:fm-bass',
    steps: Array(128).fill(false),
    parameterLocks: Array(128).fill(null),
    volume: 1,
    muted: false,
    soloed: false,
    transpose: 0,
    stepCount: 16,
    ...overrides,
  };
}

function renderRow(overrides: Partial<React.ComponentProps<typeof TrackRow>> = {}) {
  return render(
    <TrackRow
      track={makeTrack()}
      trackIndex={0}
      currentStep={-1}
      swing={0}
      anySoloed={false}
      isCopySource={false}
      isCopyTarget={false}
      orientationMode="desktop"
      onToggleStep={vi.fn()}
      onToggleMute={vi.fn()}
      onToggleSolo={vi.fn()}
      {...overrides}
    />
  );
}

/** The declarations of the first rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`No rule for ${selector}`);
  return match[1];
}

describe('two-line control block', () => {
  it('has exactly three children of .track-left, each placed by the stylesheet', () => {
    const { container } = renderRow({ onSetInstrument: vi.fn() });
    const left = container.querySelector('.track-left')!;

    expect(Array.from(left.children).map((child) => child.className)).toEqual([
      'track-drag-handle',
      'track-identity',
      'track-controls',
    ]);
    expect(ruleBody(trackRowCss, '.track-drag-handle')).toMatch(/grid-column:\s*drag;\s*grid-row:\s*identity \/ span 2;/);
    expect(ruleBody(trackRowCss, '.track-identity')).toMatch(/grid-column:\s*body;\s*grid-row:\s*identity;/);
    expect(ruleBody(trackRowCss, '.track-controls')).toMatch(/grid-column:\s*body;\s*grid-row:\s*controls;/);
  });

  it('declares the 134px template, shared through --track-left-width', () => {
    const block = ruleBody(trackRowCss, '.track-left');
    expect(block).toMatch(/grid-template-columns:\s*\[drag\] 16px \[body\] 110px;/);
    expect(block).toMatch(/grid-template-rows:\s*\[identity\] var\(--ctl-identity-h\) \[controls\] var\(--ctl-h\);/);
    expect(block).toMatch(/--ctl-h:\s*18px;/);
    expect(block).toMatch(/height:\s*44px;/);
    expect(block).toMatch(/width:\s*var\(--track-left-width\);/);
    expect(indexCss).toMatch(/--track-left-width:\s*134px;/);
    // The editable variant must not carry a template of its own: the
    // instrument toggle takes the badge slot, so both rows are one width.
    expect(trackRowCss).not.toMatch(/\.track-left\.has-instrument-toggle\s*\{/);

    const landscape = ruleBody(trackRowCss, '.step-sequencer[data-orientation="landscape"] .track-left');
    expect(landscape).toMatch(/--ctl-h:\s*28px;/);
    expect(landscape).toMatch(/height:\s*48px;/);
    expect(landscape).not.toMatch(/grid-template-columns|width:/);
  });

  it('puts identity on line one: category tick, name, transpose readout', () => {
    const { container } = renderRow({ track: makeTrack({ transpose: 7 }) });
    const identity = container.querySelector('.track-identity')!;

    expect(Array.from(identity.children).map((child) => child.className)).toEqual([
      'track-category-tick',
      'track-name',
      'track-transpose-readout',
    ]);
    const tick = identity.querySelector<HTMLElement>('.track-category-tick')!;
    expect(tick.style.getPropertyValue('--track-category-color'))
      .toBe(getInstrumentCategoryColor('tone:fm-bass'));
    expect(tick.getAttribute('aria-hidden')).toBe('true');
    // The name keeps only the name, which the reorder specs read.
    expect(identity.querySelector('.track-name')?.textContent).toBe('Lead');
    expect(identity.querySelector('.track-transpose-readout')?.textContent).toBe('+7');
  });

  it('shows the transpose readout only when the track is transposed', () => {
    const { container, rerender } = renderRow();
    expect(container.querySelector('.track-transpose-readout')).toBeNull();

    rerender(
      <TrackRow
        track={makeTrack({ transpose: -12 })}
        trackIndex={0}
        currentStep={-1}
        swing={0}
        anySoloed={false}
        isCopySource={false}
        isCopyTarget={false}
        orientationMode="desktop"
        onToggleStep={vi.fn()}
        onToggleMute={vi.fn()}
        onToggleSolo={vi.fn()}
      />
    );
    expect(container.querySelector('.track-transpose-readout')?.textContent).toBe('-12');
  });

  it('orders line two as the state group, then the disclosure group', () => {
    const { container } = renderRow({ onSetInstrument: vi.fn() });
    const groups = container.querySelectorAll('.track-controls > .track-control-group');

    expect(groups).toHaveLength(2);
    expect(groups[0].classList.contains('track-state-group')).toBe(true);
    expect(Array.from(groups[0].children).map((el) => el.getAttribute('aria-label')))
      .toEqual(['Mute', 'Solo']);
    expect(groups[1].classList.contains('track-disclosure-group')).toBe(true);
    expect(Array.from(groups[1].children).map((el) => el.getAttribute('aria-label')))
      .toEqual(['Change instrument', 'Open pitch editor', 'Velocity lane']);
    expect(groups[1].querySelector('.expand-toggle')?.textContent).toBe('♪');
    expect(groups[1].querySelector('.velocity-toggle')?.textContent).toBe('V');
  });

  it('gives editable and published rows the same badge slot', () => {
    const editable = renderRow({ onSetInstrument: vi.fn() });
    const editableSlot = editable.container.querySelector('.track-disclosure-group')!.firstElementChild!;
    expect(editableSlot.tagName).toBe('BUTTON');
    expect(editableSlot.className).toContain('track-instrument-badge');
    expect(editableSlot.textContent).toBe('FM');
    expect(editable.container.querySelector('.track-left')?.classList.contains('has-instrument-toggle')).toBe(true);
    cleanup();

    const published = renderRow();
    const publishedSlot = published.container.querySelector('.track-disclosure-group')!.firstElementChild!;
    expect(publishedSlot.tagName).toBe('SPAN');
    expect(publishedSlot.className).toBe('track-instrument-badge');
    expect(publishedSlot.textContent).toBe('FM');
    expect(published.container.querySelector('.track-left')?.classList.contains('has-instrument-toggle')).toBe(false);
  });

  it('keeps a drum row\'s pitch slot so the lane toggle lines up', () => {
    const { container } = renderRow({ track: makeTrack({ id: 'kick', name: 'Kick', sampleId: 'sampled:808-kick' }) });
    const group = container.querySelector('.track-disclosure-group')!;

    expect(Array.from(group.children).map((el) => el.classList[0])).toEqual([
      'track-instrument-badge',
      'track-control-slot',
      'velocity-toggle',
    ]);
    expect(group.firstElementChild?.classList.contains('unpitched')).toBe(true);
    expect(group.querySelector('.track-control-slot')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('no longer renders the transpose, step-count or pattern-tools controls in the row', () => {
    const { container } = renderRow();
    const left = container.querySelector('.track-left')!;

    expect(left.querySelector('.track-pitch-step-group')).toBeNull();
    expect(left.querySelector('.transpose-dropdown, .transpose-trigger')).toBeNull();
    expect(left.querySelector('.step-count-dropdown, .step-count-trigger')).toBeNull();
    expect(left.querySelector('.pattern-tools-toggle')).toBeNull();
  });

  it('accepts a drag on dragenter so a re-targeted release still drops (lesson 62)', () => {
    const { container } = renderRow();
    const wrapper = container.querySelector('.track-row-wrapper')!;
    const dataTransfer = { dropEffect: 'none', effectAllowed: 'move' };

    const enter = createEvent.dragEnter(wrapper, { dataTransfer });
    fireEvent(wrapper, enter);

    expect(enter.defaultPrevented).toBe(true);
    expect(dataTransfer.dropEffect).toBe('move');
  });
});
