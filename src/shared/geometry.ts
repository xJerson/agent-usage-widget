import { MAX_SCALE, MIN_SCALE } from './ipc';
import type { Point, Rect, Size } from './types';

export const DEFAULT_MARGIN = 28;

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

export const clampScale = (scale: number): number =>
  Number.isFinite(scale) ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)) : 1;

/**
 * The widget position is stored as the bottom-right point of its content ("anchor").
 * Clamp it so the whole content rectangle stays inside the work area.
 * If the content is larger than the work area it is pinned to the top-left.
 */
export function clampAnchor(anchor: Point, size: Size, workArea: Rect): Point {
  const loX = workArea.x + size.width;
  const hiX = workArea.x + workArea.width;
  const loY = workArea.y + size.height;
  const hiY = workArea.y + workArea.height;
  return {
    x: Math.max(loX, Math.min(hiX, anchor.x)),
    y: Math.max(loY, Math.min(hiY, anchor.y)),
  };
}

export const defaultAnchor = (workArea: Rect, margin = DEFAULT_MARGIN): Point => ({
  x: workArea.x + workArea.width - margin,
  y: workArea.y + workArea.height - margin,
});

/** Window bounds for content anchored at its bottom-right, with transparent padding on every side. */
export function windowBoundsFor(anchor: Point, content: Size, padding: number): Rect {
  const width = Math.ceil(content.width) + padding * 2;
  const height = Math.ceil(content.height) + padding * 2;
  return { x: Math.round(anchor.x + padding - width), y: Math.round(anchor.y + padding - height), width, height };
}

export interface ResizeStart {
  /** Scaled content size at the start of the drag (px). */
  width: number;
  height: number;
  /** Scale at the start of the drag. */
  scale: number;
}

export interface ResizeResult {
  scale: number;
  /** How far the bottom-right anchor must move (relative to the drag start) so the opposite corner stays put. */
  anchorDx: number;
  anchorDy: number;
}

/**
 * Proportional corner resize that keeps the opposite corner fixed, like resizing an image.
 * The pointer delta is projected onto the diagonal from the opposite corner through the handle.
 */
export function resizeFromCorner(corner: Corner, start: ResizeStart, delta: Point | { dx: number; dy: number }): ResizeResult {
  const { width: w0, height: h0, scale: s0 } = start;
  const dx = 'dx' in delta ? delta.dx : delta.x;
  const dy = 'dy' in delta ? delta.dy : delta.y;
  const left = corner === 'tl' || corner === 'bl';
  const top = corner === 'tl' || corner === 'tr';

  // Local frame: content spans [0,w0] x [0,h0]. Direction from the opposite corner to the handle:
  const ux = (left ? -1 : 1) * w0;
  const uy = (top ? -1 : 1) * h0;
  const n = Math.hypot(ux, uy);
  if (n === 0) return { scale: s0, anchorDx: 0, anchorDy: 0 };
  const hx = left ? 0 : w0;
  const hy = top ? 0 : h0;
  const ox = left ? w0 : 0;
  const oy = top ? h0 : 0;
  const proj = ((hx + dx - ox) * ux + (hy + dy - oy) * uy) / n;

  const scale = clampScale((s0 * proj) / n);
  const k = scale / s0;
  // Dragging a "right"/"bottom" handle moves the bottom-right anchor; left/top handles leave it fixed.
  return {
    scale,
    anchorDx: left ? 0 : w0 * (k - 1),
    anchorDy: top ? 0 : h0 * (k - 1),
  };
}

const clampTo = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface PanelPlacementInput {
  /** Horizontal extent of the SCALED column on screen. */
  columnLeft: number;
  columnRight: number;
  /** Screen Y of the bottom edge of the bubble the panel belongs to. */
  bubbleBottom: number;
  /** Fixed content size of the panel (never scaled). */
  size: Size;
  workArea: Rect;
  gap: number;
}

/**
 * Top-left of the (fixed-size) panel content on screen. It sits to the LEFT of the column, bottom-aligned with its
 * bubble, with the gap measured from the scaled column edge. If the left side has no room it flips to the right,
 * and it is always kept inside the work area.
 */
export function placePanel(i: PanelPlacementInput): Point & { side: 'left' | 'right' } {
  const wa = i.workArea;
  const leftX = i.columnLeft - i.gap - i.size.width;
  const rightX = i.columnRight + i.gap;
  const fitsLeft = leftX >= wa.x;
  const fitsRight = rightX + i.size.width <= wa.x + wa.width;
  const side = !fitsLeft && fitsRight ? 'right' : 'left';
  const x = clampTo(side === 'left' ? leftX : rightX, wa.x, Math.max(wa.x, wa.x + wa.width - i.size.width));
  const y = clampTo(i.bubbleBottom - i.size.height, wa.y, Math.max(wa.y, wa.y + wa.height - i.size.height));
  return { x, y, side };
}

/** Top-left of a small floating element (toast, edit bar) right-aligned above the scaled stack. */
export function placeAbove(i: { stageRight: number; stageTop: number; size: Size; gap: number; workArea: Rect }): Point {
  const wa = i.workArea;
  return {
    x: clampTo(i.stageRight - i.size.width, wa.x, Math.max(wa.x, wa.x + wa.width - i.size.width)),
    y: clampTo(i.stageTop - i.gap - i.size.height, wa.y, Math.max(wa.y, wa.y + wa.height - i.size.height)),
  };
}
