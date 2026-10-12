import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UsageWindow } from '../../shared/types';

/**
 * Detects Claude Code's "limit reached" messages in its transcripts (~/.claude/projects/<project>/<session>.jsonl).
 * Read-only. Only entries flagged "isApiErrorMessage" are looked at, and only three things are extracted from them:
 * the entry timestamp, which window the message is about, and the reset text. Everything else is discarded at once
 * and nothing is stored, logged or displayed from the conversation.
 */
export interface LimitEvent {
  window: 'session' | 'weekly';
  timestampMs: number;
  /** e.g. "1:30pm (America/Lima)" */
  resetText: string;
}

const LIMIT_RE = /you['’]ve hit your (session|weekly)\b[^·\n]*?\blimit\b/i;
const RESET_RE = /resets\s+(.+?)\s*$/i;
const SPAN_MS = { session: 5 * 3_600_000, weekly: 7 * 24 * 3_600_000 } as const;
const MINUTES = { session: 300, weekly: 10080 } as const;

/** Pure: scans transcript lines for limit-reached entries. Cheap substring pre-filter before JSON.parse. */
export function detectLimitHit(lines: readonly string[], nowMs: number): LimitEvent[] {
  const out: LimitEvent[] = [];
  for (const line of lines) {
    if (!line || !line.includes('isApiErrorMessage')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // partial line
    }
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as { isApiErrorMessage?: unknown; timestamp?: unknown; message?: { content?: unknown } };
    if (e.isApiErrorMessage !== true) continue;
    const ts = typeof e.timestamp === 'string' ? Date.parse(e.timestamp) : Number.NaN;
    if (!Number.isFinite(ts) || ts > nowMs + 60_000) continue;
    const content = e.message?.content;
    const first: unknown = Array.isArray(content) ? content[0] : undefined;
    const text = typeof first === 'object' && first !== null ? (first as { text?: unknown }).text : undefined;
    if (typeof text !== 'string') continue;
    const m = LIMIT_RE.exec(text);
    if (!m) continue;
    const kind = (m[1] ?? '').toLowerCase() === 'weekly' ? 'weekly' : 'session';
    out.push({ window: kind, timestampMs: ts, resetText: RESET_RE.exec(text)?.[1] ?? '' });
  }
  return out;
}

// ---- reset time from the message text -------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const TEXT_RE = /^(?:([a-z]{3,9})\.?\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*(?:\(([^)]+)\))?/i;

function zoneOffsetMs(utcMs: number, zone: string | undefined): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(utcMs);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Epoch ms of the given wall-clock time in a zone (undefined = the system zone). */
function wallToUtc(y: number, mo: number, d: number, h: number, mi: number, zone: string | undefined): number {
  const wall = Date.UTC(y, mo, d, h, mi);
  let guess = wall - zoneOffsetMs(wall, zone);
  guess = wall - zoneOffsetMs(guess, zone);
  return guess;
}

/**
 * "1:30pm (America/Lima)" -> the next occurrence of that time after the event, in that zone.
 * "Oct 14, 9am (America/Lima)" -> that date. Returns null when the text or the zone cannot be understood.
 */
export function resetFromText(text: string, eventMs: number): number | null {
  const m = TEXT_RE.exec(text.trim());
  if (!m) return null;
  const hour12 = Number(m[3]);
  if (hour12 < 1 || hour12 > 12) return null;
  const hour = (hour12 % 12) + (m[5]?.toLowerCase() === 'pm' ? 12 : 0);
  const minute = m[4] ? Number(m[4]) : 0;
  const zone = m[6]?.trim() || undefined;
  try {
    const off = zoneOffsetMs(eventMs, zone);
    const local = new Date(eventMs + off); // wall-clock fields of the event in that zone (read via UTC getters)
    const y = local.getUTCFullYear();
    if (m[1] && m[2]) {
      const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      if (mo < 0) return null;
      let t = wallToUtc(y, mo, Number(m[2]), hour, minute, zone);
      if (t <= eventMs) t = wallToUtc(y + 1, mo, Number(m[2]), hour, minute, zone);
      return t;
    }
    let t = wallToUtc(y, local.getUTCMonth(), local.getUTCDate(), hour, minute, zone);
    if (t <= eventMs) t = wallToUtc(y, local.getUTCMonth(), local.getUTCDate() + 1, hour, minute, zone);
    return t;
  } catch {
    return null; // unknown time zone
  }
}

// ---- overlay on the statusLine data -----------------------------------------------------------------------------

/**
 * Applies limit events to the (already completed) Claude windows. Never writes anything.
 *  - claude.json has a live window: the event applies if it happened inside that window and the window is still running;
 *  - otherwise the reset time is derived from the message text and the event applies until then.
 * Windows whose data already says >= 100% are flagged too.
 */
export function applyLimitOverlay(windows: readonly UsageWindow[], events: readonly LimitEvent[], nowMs: number): UsageWindow[] {
  return windows.map((w) => {
    const kind = (Object.keys(MINUTES) as Array<keyof typeof MINUTES>).find((k) => MINUTES[k] === w.minutes);
    let out: UsageWindow = { ...w };
    const latest = kind ? [...events].filter((e) => e.window === kind).sort((a, b) => b.timestampMs - a.timestampMs)[0] : undefined;
    if (kind && latest) {
      const live = w.resetsAt !== null && w.resetsAt * 1000 > nowMs;
      if (live) {
        if (latest.timestampMs >= w.resetsAt! * 1000 - SPAN_MS[kind]) out = { ...w, usedPercent: 100, limitReached: true };
      } else {
        const resetMs = resetFromText(latest.resetText, latest.timestampMs);
        if (resetMs !== null && nowMs < resetMs) out = { minutes: w.minutes, usedPercent: 100, resetsAt: resetMs / 1000, limitReached: true };
      }
    }
    if (out.usedPercent >= 100) out.limitReached = true;
    return out;
  });
}

// ---- bounded file scanning ------------------------------------------------------------------------------------

const TAIL_BYTES = 256 * 1024;
const RECENT_MS = 6 * 3_600_000;
const MAX_STATS = 400;
const MAX_READS = 12;

export interface LimitScannerOptions {
  now?: () => number;
  /** Test hook to count reads. */
  readTail?: (file: string, size: number) => Promise<string>;
}

async function readTailText(file: string, size: number): Promise<string> {
  const start = Math.max(0, size - TAIL_BYTES);
  const handle = await open(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    if (buf.length > 0) await handle.read(buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text; // drop the partial first line of a tail
  } finally {
    await handle.close();
  }
}

/**
 * Looks only at transcripts under ~/.claude/projects modified in the last 6 hours (newest first, bounded), reads only
 * the last 256 KB of each, and caches by mtime + size. Never throws.
 */
export class ClaudeLimitScanner {
  private readonly root: string;
  private readonly now: () => number;
  private readonly readTail: (file: string, size: number) => Promise<string>;
  private readonly cache = new Map<string, { key: string; events: LimitEvent[] }>();

  constructor(home: string = homedir(), options: LimitScannerOptions = {}) {
    this.root = join(home, '.claude', 'projects');
    this.now = options.now ?? Date.now;
    this.readTail = options.readTail ?? readTailText;
  }

  async scan(): Promise<LimitEvent[]> {
    const now = this.now();
    const files: Array<{ file: string; mtimeMs: number; size: number }> = [];
    try {
      let stats = 0;
      for (const dir of await readdir(this.root, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue;
        let names: string[] = [];
        try {
          names = (await readdir(join(this.root, dir.name))).filter((n) => n.endsWith('.jsonl'));
        } catch {
          continue;
        }
        for (const n of names) {
          if (++stats > MAX_STATS) break;
          const file = join(this.root, dir.name, n);
          try {
            const info = await stat(file);
            if (info.isFile() && now - info.mtimeMs <= RECENT_MS) files.push({ file, mtimeMs: info.mtimeMs, size: info.size });
          } catch {
            /* vanished */
          }
        }
      }
    } catch {
      return []; // no projects dir
    }
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const events: LimitEvent[] = [];
    const seen = new Set<string>();
    for (const f of files.slice(0, MAX_READS)) {
      seen.add(f.file);
      const key = `${f.mtimeMs}:${f.size}`;
      const cached = this.cache.get(f.file);
      if (cached?.key === key) {
        events.push(...cached.events);
        continue;
      }
      try {
        const text = await this.readTail(f.file, f.size);
        const found = detectLimitHit(text.split(/\r?\n/), now);
        this.cache.set(f.file, { key, events: found });
        events.push(...found);
      } catch {
        /* unreadable: skip */
      }
    }
    for (const k of [...this.cache.keys()]) if (!seen.has(k)) this.cache.delete(k);
    return events;
  }
}
