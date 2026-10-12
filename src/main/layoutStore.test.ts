import { describe, expect, it } from 'vitest';
import { sanitizeLayout } from './layoutStore';

describe('sanitizeLayout', () => {
  it('accepts a valid persisted layout', () => {
    expect(sanitizeLayout({ anchor: { x: 100, y: 200 }, scale: 1.25 })).toEqual({ anchor: { x: 100, y: 200 }, scale: 1.25 });
  });
  it('clamps scale and tolerates a missing anchor', () => {
    expect(sanitizeLayout({ scale: 9 })).toEqual({ anchor: null, scale: 2 });
  });
  it('falls back to defaults for garbage', () => {
    expect(sanitizeLayout(null)).toEqual({ anchor: null, scale: 1 });
    expect(sanitizeLayout('x')).toEqual({ anchor: null, scale: 1 });
    expect(sanitizeLayout({ anchor: { x: 'a', y: 1 }, scale: 'big' })).toEqual({ anchor: null, scale: 1 });
  });
});
