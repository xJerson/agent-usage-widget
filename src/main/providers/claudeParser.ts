import type { UsageSnapshot, UsageWindow } from '../../shared/types';

export const CLAUDE_ID = 'claude';

const SOURCES = [
  { key: 'five_hour', minutes: 300 },
  { key: 'seven_day', minutes: 10080 },
] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Epoch seconds are ~1.8e9; anything above 1e11 is clearly milliseconds. */
export function normalizeEpochSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value >= 1e11 ? Math.round(value / 1000) : value;
}

export const clampPercent = (n: number): number => Math.min(100, Math.max(0, n));

/**
 * Parses the JSON Claude Code passes to a statusLine command.
 * Returns null for unreadable input (e.g. a partially written file) so callers can keep the last good value;
 * returns a snapshot with no windows when the payload is valid but has no rate limits.
 */
export function parseClaudeStatusline(raw: string, updatedAt: number): UsageSnapshot | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  const windows: UsageWindow[] = [];
  const limits = data['rate_limits'];
  if (isRecord(limits)) {
    for (const { key, minutes } of SOURCES) {
      const w = limits[key];
      if (!isRecord(w)) continue;
      const used = w['used_percentage'];
      if (typeof used !== 'number' || !Number.isFinite(used)) continue;
      windows.push({ minutes, usedPercent: clampPercent(used), resetsAt: normalizeEpochSeconds(w['resets_at']) });
    }
  }
  return { agentId: CLAUDE_ID, windows, updatedAt };
}

/**
 * Claude Code drops a window from the statusLine JSON once its resets_at has passed, so a missing window means
 * "0%, starts at the next prompt", not "does not exist". Guarantee both standard windows (5h first, weekly second).
 * Expired windows are kept as they are: the renderer applies the time-based reset.
 */
export function ensureClaudeWindows(windows: readonly UsageWindow[]): UsageWindow[] {
  return SOURCES.map(({ minutes }) => windows.find((w) => w.minutes === minutes) ?? { minutes, usedPercent: 0, resetsAt: null });
}
