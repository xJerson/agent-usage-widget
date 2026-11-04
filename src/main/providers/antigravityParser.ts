import type { UsageSnapshot, UsageWindow } from '../../shared/types';
import { clampPercent, normalizeEpochSeconds } from './claudeParser';

export const ANTIGRAVITY_ID = 'antigravity';

/** Individual quota buckets reported by Antigravity CLI. */
export const ANTIGRAVITY_SOURCES = [
  { key: 'gemini-5h', minutes: 300, label: 'Gemini · 5h', order: 1 },
  { key: 'gemini-weekly', minutes: 10080, label: 'Gemini · Weekly (7d)', order: 2 },
  { key: 'gemini-argon-wtu-weekly', minutes: 10080, label: 'Gemini Argon · WTU Weekly', order: 3 },
  { key: '3p-5h', minutes: 300, label: 'Third-party (3P) · 5h', order: 4 },
  { key: '3p-weekly', minutes: 10080, label: 'Third-party (3P) · Weekly (7d)', order: 5 },
] as const;

export type AntigravitySourceKey = (typeof ANTIGRAVITY_SOURCES)[number]['key'];

const MAX_PLAN_LENGTH = 24;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `reset_time` is an ISO string; epoch numbers are tolerated too. Anything else means "unknown". */
function resetSeconds(value: unknown): number | null {
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
  }
  return normalizeEpochSeconds(value);
}

/**
 * "Google AI Pro" -> "Pro". The prefix is the same for every tier, so dropping it keeps the badge short.
 * Empty, non-string or overlong values give no badge.
 */
export function mapAntigravityPlan(planTier: unknown): string | undefined {
  if (typeof planTier !== 'string') return undefined;
  const t = planTier.trim().replace(/^google\s+ai\s*/i, '').trim();
  return t && t.length <= MAX_PLAN_LENGTH ? t : undefined;
}

/**
 * Parses the file the hook writes (or, equally, the status-line JSON Antigravity itself passes: only `quota` and
 * `plan_tier` are read, and `updated_at` when the hook stored it). `remaining_fraction` is what is LEFT, the widget
 * shows what is USED. Returns null for unreadable input so callers can keep the last good value.
 */
export function parseAntigravityStatusline(raw: string, fallbackUpdatedAt: number): UsageSnapshot | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  const windows: UsageWindow[] = [];
  const quota = data['quota'];
  if (isRecord(quota)) {
    for (const { key, minutes, label, order } of ANTIGRAVITY_SOURCES) {
      const bucket = quota[key];
      if (!isRecord(bucket)) continue;
      const remaining = bucket['remaining_fraction'];
      if (typeof remaining !== 'number' || !Number.isFinite(remaining)) continue;
      windows.push({
        id: key,
        label,
        order,
        minutes,
        usedPercent: clampPercent((1 - remaining) * 100),
        resetsAt: resetSeconds(bucket['reset_time']),
      });
    }
  }
  const plan = mapAntigravityPlan(data['plan_tier']);
  const stamp = data['updated_at'];
  return {
    agentId: ANTIGRAVITY_ID,
    ...(plan ? { plan } : {}),
    windows,
    updatedAt: typeof stamp === 'number' && Number.isFinite(stamp) ? stamp : fallbackUpdatedAt,
  };
}

/**
 * The hook drops a window once its reset time has passed, so a missing window next to a present one means
 * "0%, starts at the next prompt". With no window at all there is nothing to show yet, so none are invented.
 */
export function ensureAntigravityWindows(windows: readonly UsageWindow[]): UsageWindow[] {
  if (windows.length === 0) return [];
  return ANTIGRAVITY_SOURCES.map(
    ({ key, minutes, label, order }) =>
      windows.find((w) => w.id === key || (!w.id && w.minutes === minutes)) ?? {
        id: key,
        label,
        order,
        minutes,
        usedPercent: 0,
        resetsAt: null,
      },
  );
}
