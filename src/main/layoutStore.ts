import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { clampScale } from '../shared/geometry';
import type { Point } from '../shared/types';

export interface PersistedLayout {
  /** Bottom-right point of the widget content in screen coordinates; null = use the default position. */
  anchor: Point | null;
  scale: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function sanitizeLayout(raw: unknown): PersistedLayout {
  if (!isRecord(raw)) return { anchor: null, scale: 1 };
  const a = raw['anchor'];
  const anchor =
    isRecord(a) && typeof a['x'] === 'number' && typeof a['y'] === 'number' && Number.isFinite(a['x']) && Number.isFinite(a['y'])
      ? { x: a['x'], y: a['y'] }
      : null;
  const scale = typeof raw['scale'] === 'number' ? clampScale(raw['scale']) : 1;
  return { anchor, scale };
}

export function loadLayout(file: string): PersistedLayout {
  try {
    return sanitizeLayout(JSON.parse(readFileSync(file, 'utf8')));
  } catch {
    return { anchor: null, scale: 1 };
  }
}

export function saveLayout(file: string, layout: PersistedLayout): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(layout), 'utf8');
  } catch {
    /* persistence is best-effort */
  }
}
