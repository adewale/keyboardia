// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import * as icons from './index';

const expectedNames = [
  'Add',
  'AudioWarning',
  'Check',
  'ChevronDown',
  'ChevronLeft',
  'ChevronRight',
  'ChevronUp',
  'Close',
  'CopyLink',
  'FxActive',
  'FxBypass',
  'Minus',
  'Play',
  'PlayerJoin',
  'PlayerLeave',
  'Qr',
  'RotateDevice',
  'ScaleLock',
  'ScaleUnlock',
  'Scissors',
  'Share',
  'Stop',
  'Warning',
] as const;

afterEach(cleanup);

describe('semantic icon exports', () => {
  it('exposes only the production vocabulary', () => {
    expect(Object.keys(icons).sort()).toEqual([...expectedNames].sort());
  });

  it.each(Object.entries(icons))(
    'renders %s as a currentColor SVG at the requested size',
    (_name, Icon) => {
      render(<Icon data-testid="icon" size={18} aria-hidden="true" />);
      const svg = screen.getByTestId('icon');

      expect(svg.tagName.toLowerCase()).toBe('svg');
      expect(svg.getAttribute('width')).toBe('18');
      expect(svg.getAttribute('height')).toBe('18');
      expect(svg.getAttribute('stroke')).toBe('currentColor');
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    },
  );

  it.each([
    ['Close', icons.Close, 'lucide-x'],
    ['Play', icons.Play, 'lucide-play'],
    ['Stop', icons.Stop, 'lucide-square'],
    ['QR code', icons.Qr, 'lucide-qr-code'],
    ['Scale lock', icons.ScaleLock, 'lucide-lock'],
  ])('maps %s to the intended Lucide glyph', (_name, Icon, className) => {
    render(<Icon data-testid="icon" aria-hidden="true" />);
    expect(screen.getByTestId('icon').classList.contains(className)).toBe(true);
  });
});
