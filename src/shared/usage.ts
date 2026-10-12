import type { UsageWindow } from './types';

export type Level = 'ok' | 'warn' | 'bad';

const MIN_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export const windowLabel = (minutes: number): string =>
  minutes === 300 ? 'Current session · 5h' : minutes === 10080 ? 'Weekly · 7 days' : `${Math.round(minutes / 60)}h window`;

export const levelOf = (percent: number): Level => (percent >= 90 ? 'bad' : percent >= 70 ? 'warn' : 'ok');

export interface ResolvedWindow {
  usedPercent: number;
  /** Reset time in epoch MILLISECONDS (converted from the source seconds), null when unknown or expired. */
  resetsAtMs: number | null;
  /** True when the reset time has passed: the window is shown as 0% until the next prompt. */
  expired: boolean;
  /** At or above 100% (or flagged) and not yet reset. */
  limitReached: boolean;
}

/** Applies the time-based reset: once now >= resetsAt the window reads 0% and has no reset time. */
export function resolveWindow(w: UsageWindow, nowMs: number): ResolvedWindow {
  const percent = Math.min(100, Math.max(0, w.usedPercent));
  const reached = percent >= 100 || w.limitReached === true;
  if (w.resetsAt === null) return { usedPercent: percent, resetsAtMs: null, expired: false, limitReached: reached };
  const resetsAtMs = w.resetsAt * 1000;
  if (nowMs >= resetsAtMs) return { usedPercent: 0, resetsAtMs: null, expired: true, limitReached: false };
  return { usedPercent: percent, resetsAtMs, expired: false, limitReached: reached };
}

/** The bubble ring follows the shortest window. */
export function headWindow(windows: readonly UsageWindow[]): UsageWindow | null {
  let best: UsageWindow | null = null;
  for (const w of windows) if (best === null || w.minutes < best.minutes) best = w;
  return best;
}

export function formatRemaining(ms: number): string {
  if (ms <= 0) return '0m';
  const d = Math.floor(ms / DAY_MS);
  const h = Math.floor((ms % DAY_MS) / HOUR_MS);
  const m = Math.floor((ms % HOUR_MS) / MIN_MS);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function formatAgo(elapsedMs: number): string {
  const secs = Math.floor(Math.max(0, elapsedMs) / 1000);
  if (secs < 5) return 'Updated just now';
  if (secs < 60) return `Updated ${secs}s ago`;
  if (secs < 3600) return `Updated ${Math.floor(secs / 60)}m ago`;
  return `Updated ${Math.floor(secs / 3600)}h ago`;
}
