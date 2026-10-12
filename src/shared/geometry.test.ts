import { describe, expect, it } from 'vitest';
import { clampAnchor, clampScale, defaultAnchor, floatContentSize, floatWindowBounds, placeAbove, placePanel, resizeFromCorner, windowBoundsFor } from './geometry';
import { FLOAT_PADDING } from './ipc';

const wa = { x: 0, y: 0, width: 1920, height: 1040 };

describe('clampScale', () => {
  it('clamps to 0.5..2', () => {
    expect(clampScale(0.1)).toBe(0.5);
    expect(clampScale(3)).toBe(2);
    expect(clampScale(1.25)).toBe(1.25);
  });
  it('falls back to 1 for non-finite input', () => {
    expect(clampScale(Number.NaN)).toBe(1);
  });
});

describe('clampAnchor', () => {
  const size = { width: 200, height: 100 };
  it('keeps an in-bounds anchor untouched', () => {
    expect(clampAnchor({ x: 800, y: 600 }, size, wa)).toEqual({ x: 800, y: 600 });
  });
  it('pulls the content back inside every edge', () => {
    expect(clampAnchor({ x: 50, y: 20 }, size, wa)).toEqual({ x: 200, y: 100 }); // left/top
    expect(clampAnchor({ x: 5000, y: 5000 }, size, wa)).toEqual({ x: 1920, y: 1040 }); // right/bottom
  });
  it('respects a work area that does not start at the origin (secondary monitor)', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    expect(clampAnchor({ x: 10, y: 500 }, size, left)).toEqual({ x: 0, y: 500 });
    expect(clampAnchor({ x: -5000, y: 500 }, size, left)).toEqual({ x: -1720, y: 500 });
  });
  it('pins to the top-left when content is bigger than the work area', () => {
    expect(clampAnchor({ x: 100, y: 100 }, { width: 3000, height: 2000 }, wa)).toEqual({ x: 3000, y: 2000 });
  });
});

describe('defaultAnchor', () => {
  it('sits 28px from the bottom-right of the work area', () => {
    expect(defaultAnchor({ x: 0, y: 0, width: 1920, height: 1040 })).toEqual({ x: 1892, y: 1012 });
    expect(defaultAnchor({ x: 100, y: 50, width: 800, height: 600 })).toEqual({ x: 872, y: 622 });
  });
});

describe('windowBoundsFor', () => {
  it('anchors the content bottom-right and adds the transparent padding', () => {
    expect(windowBoundsFor({ x: 1000, y: 800 }, { width: 100, height: 60 }, 10)).toEqual({
      x: 1000 + 10 - 120,
      y: 800 + 10 - 80,
      width: 120,
      height: 80,
    });
  });
});

describe('resizeFromCorner', () => {
  const base = { width: 200, height: 100, scale: 1 };

  it('growing from the bottom-right handle keeps the top-left corner fixed', () => {
    const r = resizeFromCorner('br', base, { dx: 200, dy: 100 });
    expect(r.scale).toBeCloseTo(2);
    // top-left fixed => the bottom-right anchor moves by the size delta
    expect(r.anchorDx).toBeCloseTo(200);
    expect(r.anchorDy).toBeCloseTo(100);
  });

  it('growing from the top-left handle keeps the bottom-right anchor fixed', () => {
    const r = resizeFromCorner('tl', base, { dx: -100, dy: -50 });
    expect(r.scale).toBeCloseTo(1.5);
    expect(r.anchorDx).toBe(0);
    expect(r.anchorDy).toBe(0);
  });

  it('top-right handle moves only the anchor x', () => {
    const r = resizeFromCorner('tr', base, { dx: 100, dy: -50 });
    expect(r.scale).toBeCloseTo(1.5);
    expect(r.anchorDx).toBeCloseTo(100);
    expect(r.anchorDy).toBe(0);
  });

  it('bottom-left handle moves only the anchor y', () => {
    const r = resizeFromCorner('bl', base, { dx: -100, dy: 50 });
    expect(r.scale).toBeCloseTo(1.5);
    expect(r.anchorDx).toBe(0);
    expect(r.anchorDy).toBeCloseTo(50);
  });

  it('shrinks and clamps at 0.5', () => {
    const r = resizeFromCorner('br', base, { dx: -190, dy: -95 });
    expect(r.scale).toBe(0.5);
    expect(r.anchorDx).toBeCloseTo(-100); // 200 * (0.5 - 1)
    expect(r.anchorDy).toBeCloseTo(-50);
  });

  it('clamps at 2', () => {
    expect(resizeFromCorner('tl', base, { dx: -2000, dy: -1000 }).scale).toBe(2);
  });

  it('is relative to the starting scale', () => {
    const r = resizeFromCorner('br', { width: 300, height: 150, scale: 1.5 }, { dx: 300, dy: 150 });
    expect(r.scale).toBe(2); // 1.5 * 2 = 3, capped
    expect(r.anchorDx).toBeCloseTo((300 * 2) / 1.5 - 300); // size grows from 300 to 400
  });

  it('only the diagonal component counts (perpendicular drag does nothing)', () => {
    const r = resizeFromCorner('br', { width: 100, height: 100, scale: 1 }, { dx: 50, dy: -50 });
    expect(r.scale).toBeCloseTo(1);
  });
});

describe('resizeFromCorner with a tall column (vertical stack)', () => {
  const column = { width: 104, height: 260, scale: 1 };
  it('keeps the proportions: bottom-right handle grows the anchor by the size delta', () => {
    const r = resizeFromCorner('br', column, { dx: 52, dy: 130 });
    expect(r.scale).toBeCloseTo(1.5);
    expect(r.anchorDx).toBeCloseTo(52);
    expect(r.anchorDy).toBeCloseTo(130);
  });
  it('top-left handle leaves the anchor fixed', () => {
    const r = resizeFromCorner('tl', column, { dx: -52, dy: -130 });
    expect(r.scale).toBeCloseTo(1.5);
    expect(r.anchorDx).toBe(0);
    expect(r.anchorDy).toBe(0);
  });
  it('clamps like any other shape', () => {
    expect(resizeFromCorner('br', column, { dx: -500, dy: -900 }).scale).toBe(0.5);
  });
});

describe('placePanel (fixed-size panel next to the scaled column)', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = { width: 320, height: 300 };
  const base = { size, workArea: wa, gap: 16 };

  it('goes to the LEFT of the column, bottom-aligned with its bubble', () => {
    const p = placePanel({ ...base, columnLeft: 1800, columnRight: 1892, bubbleBottom: 900 });
    expect(p).toEqual({ x: 1800 - 16 - 320, y: 600, side: 'left' });
  });

  it('the gap is measured from the SCALED column edge, so the size never depends on the scale', () => {
    for (const [left, right] of [[1860, 1892], [1800, 1892], [1700, 1892]] as Array<[number, number]>) {
      const p = placePanel({ ...base, columnLeft: left, columnRight: right, bubbleBottom: 900 });
      expect(p.x + size.width + 16).toBe(left);
      expect(p.y + size.height).toBe(900);
    }
  });

  it('flips to the right of the column when there is no room on the left', () => {
    const p = placePanel({ ...base, columnLeft: 100, columnRight: 192, bubbleBottom: 500 });
    expect(p.side).toBe('right');
    expect(p.x).toBe(192 + 16);
  });

  it('stays on the left (clamped) when neither side has room', () => {
    const narrow = { x: 0, y: 0, width: 400, height: 1040 };
    const p = placePanel({ ...base, workArea: narrow, columnLeft: 200, columnRight: 292, bubbleBottom: 500 });
    expect(p.side).toBe('left');
    expect(p.x).toBe(0);
  });

  it('is kept inside the work area vertically', () => {
    expect(placePanel({ ...base, columnLeft: 1800, columnRight: 1892, bubbleBottom: 120 }).y).toBe(0); // too high
    expect(placePanel({ ...base, columnLeft: 1800, columnRight: 1892, bubbleBottom: 5000 }).y).toBe(1040 - 300);
  });

  it('works on a secondary monitor with a negative origin', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1080 };
    const p = placePanel({ ...base, workArea: left, columnLeft: -100, columnRight: -8, bubbleBottom: 700 });
    expect(p).toEqual({ x: -100 - 16 - 320, y: 400, side: 'left' });
  });
});

describe('placeAbove (toast / edit bar above the scaled stack)', () => {
  const wa = { x: 0, y: 0, width: 1920, height: 1040 };
  it('right-aligns with the stack and sits above it', () => {
    expect(placeAbove({ stageRight: 1892, stageTop: 700, size: { width: 360, height: 50 }, gap: 8, workArea: wa })).toEqual({ x: 1532, y: 642 });
  });
  it('is clamped into the work area', () => {
    expect(placeAbove({ stageRight: 200, stageTop: 20, size: { width: 360, height: 50 }, gap: 8, workArea: wa })).toEqual({ x: 0, y: 0 });
  });
});

describe('floating window padding (room for the soft shadow)', () => {
  it('window bounds wrap the card with the padding on every side', () => {
    expect(floatWindowBounds({ x: 500, y: 300 }, { width: 448, height: 428 }, 64)).toEqual({ x: 436, y: 236, width: 448, height: 428 });
    expect(floatContentSize({ width: 448, height: 428 }, 64)).toEqual({ width: 320, height: 300 });
  });

  it('the card keeps the same 16px gap to the column whatever the padding', () => {
    const wa = { x: 0, y: 0, width: 1920, height: 1040 };
    for (const pad of [32, 64, 96]) {
      const windowSize = { width: 320 + pad * 2, height: 300 + pad * 2 };
      const content = floatContentSize(windowSize, pad);
      const pos = placePanel({ columnLeft: 1788, columnRight: 1892, bubbleBottom: 900, size: content, workArea: wa, gap: 16 });
      const win = floatWindowBounds(pos, windowSize, pad);
      expect(win.x + win.width - pad + 16).toBe(1788); // card right edge + gap = column left
      expect(win.y + win.height - pad).toBe(900); // card bottom = bubble bottom
    }
  });

  it('every floating window has more padding than its shadow can reach (blur + offset)', () => {
    // CSS shadows in styles.css: panel 0 16px 40px, bar 0 10px 24px, toast 0 8px 20px
    expect(FLOAT_PADDING.panel).toBeGreaterThanOrEqual(16 + 40);
    expect(FLOAT_PADDING.bar).toBeGreaterThanOrEqual(10 + 24);
    expect(FLOAT_PADDING.toast).toBeGreaterThanOrEqual(8 + 20);
  });
});
