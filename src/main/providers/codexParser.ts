import type { UsageSnapshot, UsageWindow } from '../../shared/types';
import { clampPercent, normalizeEpochSeconds } from './claudeParser';

export const CODEX_ID = 'codex';

export interface CodexParseOptions {
  /** True when `tail` is a slice from the middle of a file: the first (partial) line is discarded. */
  truncatedStart?: boolean;
  /** updatedAt used when the event line has no usable timestamp. */
  fallbackUpdatedAt?: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function toWindow(raw: unknown): UsageWindow | null {
  if (!isRecord(raw)) return null;
  const used = raw['used_percent'];
  const minutes = raw['window_minutes'];
  if (typeof used !== 'number' || !Number.isFinite(used)) return null;
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
  return { minutes, usedPercent: clampPercent(used), resetsAt: normalizeEpochSeconds(raw['resets_at']) };
}

export interface Candidate {
  snapshot: UsageSnapshot;
  preferred: boolean;
}

function fromLine(line: string, fallbackUpdatedAt: number): Candidate | null {
  // Cheap pre-filter before JSON.parse on large lines.
  if (!line.includes('token_count') || !line.includes('rate_limits')) return null;
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    return null; // partially written line
  }
  if (!isRecord(event)) return null;
  const payload = event['payload'];
  if (!isRecord(payload) || payload['type'] !== 'token_count') return null;
  const limits = payload['rate_limits'];
  if (!isRecord(limits)) return null;

  const windows = [toWindow(limits['primary']), toWindow(limits['secondary'])]
    .filter((w): w is UsageWindow => w !== null)
    .sort((a, b) => a.minutes - b.minutes);
  if (windows.length === 0) return null;

  const ts = typeof event['timestamp'] === 'string' ? Date.parse(event['timestamp']) : Number.NaN;
  const plan = typeof limits['plan_type'] === 'string' && limits['plan_type'] ? limits['plan_type'] : undefined;
  const limitId = limits['limit_id'];
  const snapshot: UsageSnapshot = {
    agentId: CODEX_ID,
    ...(plan ? { plan } : {}),
    windows,
    updatedAt: Number.isFinite(ts) ? ts : fallbackUpdatedAt,
  };
  return { snapshot, preferred: limitId === undefined || limitId === null || limitId === CODEX_ID };
}

/**
 * Scans the tail of a Codex rollout JSONL from the end and returns the newest token_count event
 * that carries rate limits. Only the rate-limit fields are read; no conversation content is touched.
 */
export function parseCodexRolloutTail(tail: string, options: CodexParseOptions = {}): UsageSnapshot | null {
  return parseCodexRolloutTailDetailed(tail, options)?.snapshot ?? null;
}

/** Same as parseCodexRolloutTail, also telling whether the event belongs to the primary "codex" limit. */
export function parseCodexRolloutTailDetailed(tail: string, options: CodexParseOptions = {}): Candidate | null {
  const lines = tail.split(/\r?\n/);
  if (options.truncatedStart) lines.shift();
  const fallback = options.fallbackUpdatedAt ?? 0;

  let other: Candidate | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    const c = fromLine(line, fallback);
    if (!c) continue;
    if (c.preferred) return c;
    other ??= c;
  }
  return other;
}
