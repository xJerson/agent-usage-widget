import { describe, expect, it } from 'vitest';
import { sanitizeLayout } from './layoutStore';

describe('sanitizeLayout', () => {
  it('accepts a valid persisted layout', () => {
    expect(sanitizeLayout({ anchor: { x: 100, y: 200 }, scale: 1.25, orientation: 'horizontal' })).toEqual({
      anchor: { x: 100, y: 200 },
      scale: 1.25,
      orientation: 'horizontal',
    });
  });
  it('clamps scale and tolerates a missing anchor or orientation', () => {
    expect(sanitizeLayout({ scale: 9 })).toEqual({ anchor: null, scale: 2, orientation: 'vertical' });
  });
  it('falls back to defaults for garbage', () => {
    expect(sanitizeLayout(null)).toEqual({ anchor: null, scale: 1, orientation: 'vertical' });
    expect(sanitizeLayout('x')).toEqual({ anchor: null, scale: 1, orientation: 'vertical' });
    expect(sanitizeLayout({ anchor: { x: 'a', y: 1 }, scale: 'big', orientation: 'diagonal' })).toEqual({
      anchor: null,
      scale: 1,
      orientation: 'vertical',
    });
  });
});
