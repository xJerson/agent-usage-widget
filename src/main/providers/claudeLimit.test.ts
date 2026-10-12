import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeProvider } from './claude';
import { applyLimitOverlay, ClaudeLimitScanner, detectLimitHit, resetFromText, type LimitEvent } from './claudeLimit';

/** Synthetic transcript lines only: no real conversation content. */
const errLine = (text: string, ts: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    isApiErrorMessage: true,
    cwd: '/private/project/path',
    sessionId: 'synthetic-session',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    ...extra,
  });
const normal = (ts: string) =>
  JSON.stringify({ type: 'user', timestamp: ts, message: { role: 'user', content: 'some private prompt about isApiErrorMessage' } });

const SESSION = "You've hit your session limit · resets 1:30pm (America/Lima)";
const WEEKLY = "You've hit your weekly limit · resets 9am (America/Lima)";
const NOW = Date.parse('2026-10-12T18:10:00.000Z'); // 13:10 in Lima

describe('detectLimitHit', () => {
  it('extracts a session-limit entry: window, timestamp and reset text only', () => {
    const hits = detectLimitHit([normal('2026-10-12T17:00:00.000Z'), errLine(SESSION, '2026-10-12T18:05:00.000Z')], NOW);
    expect(hits).toEqual([{ window: 'session', timestampMs: Date.parse('2026-10-12T18:05:00.000Z'), resetText: '1:30pm (America/Lima)' }]);
  });
  it('recognises the weekly wording', () => {
    const hits = detectLimitHit([errLine(WEEKLY, '2026-10-12T18:05:00.000Z')], NOW);
    expect(hits[0]).toMatchObject({ window: 'weekly', resetText: '9am (America/Lima)' });
  });
  it('accepts a typographic apostrophe and extra words before "limit"', () => {
    const hits = detectLimitHit([errLine('You’ve hit your weekly Opus limit · resets 9am', '2026-10-12T18:05:00.000Z')], NOW);
    expect(hits[0]?.window).toBe('weekly');
  });
  it('ignores unrelated API errors, other wording and non-error entries', () => {
    const lines = [
      errLine('API Error: 529 overloaded', '2026-10-12T18:05:00.000Z'),
      errLine("You've hit your usage limit", '2026-10-12T18:05:00.000Z'),
      errLine("You've hit your daily limit · resets 1pm", '2026-10-12T18:05:00.000Z'),
      JSON.stringify({ timestamp: '2026-10-12T18:05:00.000Z', isApiErrorMessage: false, message: { content: [{ text: SESSION }] } }),
      normal('2026-10-12T18:05:00.000Z'),
    ];
    expect(detectLimitHit(lines, NOW)).toEqual([]);
  });
  it('skips partial, invalid and timestamp-less lines, and future-dated ones', () => {
    const full = errLine(SESSION, '2026-10-12T18:05:00.000Z');
    expect(detectLimitHit([full.slice(0, 80), 'isApiErrorMessage garbage', errLine(SESSION, 'not a date'), errLine(SESSION, '2027-01-01T00:00:00.000Z')], NOW)).toEqual([]);
  });
  it('exposes only the documented fields (privacy)', () => {
    const hits = detectLimitHit([errLine(SESSION, '2026-10-12T18:05:00.000Z', { gitBranch: 'secret-branch', userType: 'external' })], NOW);
    expect(Object.keys(hits[0] ?? {}).sort()).toEqual(['resetText', 'timestampMs', 'window']);
    const text = JSON.stringify(hits);
    for (const secret of ['/private/project/path', 'synthetic-session', 'secret-branch', 'assistant']) expect(text).not.toContain(secret);
  });
});

describe('resetFromText', () => {
  it('chooses the next occurrence of the time after the event, in the named zone', () => {
    // Lima is UTC-5 all year: 1:30pm = 18:30Z
    expect(resetFromText('1:30pm (America/Lima)', Date.parse('2026-10-12T18:05:00Z'))).toBe(Date.parse('2026-10-12T18:30:00Z'));
    expect(resetFromText('1:30pm (America/Lima)', Date.parse('2026-10-12T19:00:00Z'))).toBe(Date.parse('2026-10-13T18:30:00Z'));
  });
  it('handles am / pm / noon / midnight and minutes', () => {
    const ev = Date.parse('2026-10-12T00:00:00Z');
    expect(resetFromText('12am (America/Lima)', ev)).toBe(Date.parse('2026-10-12T05:00:00Z'));
    expect(resetFromText('12pm (America/Lima)', ev)).toBe(Date.parse('2026-10-12T17:00:00Z'));
    expect(resetFromText('9:45am (America/Lima)', ev)).toBe(Date.parse('2026-10-12T14:45:00Z'));
  });
  it('uses the zone offset in force on that date (daylight saving)', () => {
    // New York is UTC-4 in October (EDT) and UTC-5 in January (EST)
    expect(resetFromText('9am (America/New_York)', Date.parse('2026-10-12T10:00:00Z'))).toBe(Date.parse('2026-10-12T13:00:00Z'));
    expect(resetFromText('9am (America/New_York)', Date.parse('2026-01-12T10:00:00Z'))).toBe(Date.parse('2026-01-12T14:00:00Z'));
  });
  it('understands a date for the weekly wording', () => {
    expect(resetFromText('Oct 14, 9am (America/Lima)', Date.parse('2026-10-12T18:05:00Z'))).toBe(Date.parse('2026-10-14T14:00:00Z'));
  });
  it('returns null for text it cannot parse or an unknown zone', () => {
    expect(resetFromText('soon', 0)).toBeNull();
    expect(resetFromText('1pm (Not/AZone)', 0)).toBeNull();
    expect(resetFromText('', 0)).toBeNull();
  });
});

describe('applyLimitOverlay', () => {
  const hit = (window: 'session' | 'weekly', iso: string, text = '1:30pm (America/Lima)'): LimitEvent => ({ window, timestampMs: Date.parse(iso), resetText: text });
  const sec = (iso: string) => Date.parse(iso) / 1000;
  const empty = [
    { minutes: 300, usedPercent: 0, resetsAt: null },
    { minutes: 10080, usedPercent: 21, resetsAt: sec('2026-10-15T00:00:00Z') },
  ];

  it('a session-limit event inside the current 5h window forces 100% and limitReached', () => {
    const resets = sec('2026-10-12T18:30:00Z');
    const out = applyLimitOverlay([{ minutes: 300, usedPercent: 99, resetsAt: resets }, empty[1]!], [hit('session', '2026-10-12T18:05:00Z')], NOW);
    expect(out[0]).toEqual({ minutes: 300, usedPercent: 100, resetsAt: resets, limitReached: true });
    expect(out[1]).toEqual(empty[1]);
  });

  it('an event before the start of the current window is ignored', () => {
    const resets = sec('2026-10-12T22:00:00Z'); // window started 17:00Z
    const out = applyLimitOverlay([{ minutes: 300, usedPercent: 3, resetsAt: resets }, empty[1]!], [hit('session', '2026-10-12T16:00:00Z')], NOW);
    expect(out[0]).toEqual({ minutes: 300, usedPercent: 3, resetsAt: resets });
  });

  it('an expired event (reset already passed) is ignored', () => {
    const out = applyLimitOverlay(empty, [hit('session', '2026-10-12T10:00:00Z')], NOW); // reset 18:30Z... event 05:00 Lima -> next 1:30pm = 18:30Z same day? no: 10:00Z -> 18:30Z, still future
    // use an event from long ago so that the derived reset is in the past
    const old = applyLimitOverlay(empty, [hit('session', '2026-10-10T10:00:00Z')], NOW);
    expect(old[0]).toEqual(empty[0]);
    expect(out[0]?.limitReached).toBe(true);
  });

  it('with no valid 5h window in claude.json, the reset is derived from the message text', () => {
    const out = applyLimitOverlay(empty, [hit('session', '2026-10-12T18:05:00Z')], NOW);
    expect(out[0]).toEqual({ minutes: 300, usedPercent: 100, resetsAt: sec('2026-10-12T18:30:00Z'), limitReached: true });
  });

  it('an expired claude.json window counts as "no valid window" and falls back to the text', () => {
    const out = applyLimitOverlay(
      [{ minutes: 300, usedPercent: 44, resetsAt: sec('2026-10-12T12:00:00Z') }, empty[1]!],
      [hit('session', '2026-10-12T18:05:00Z')],
      NOW,
    );
    expect(out[0]).toMatchObject({ usedPercent: 100, limitReached: true, resetsAt: sec('2026-10-12T18:30:00Z') });
  });

  it('a weekly event applies to the weekly window only', () => {
    const resets = sec('2026-10-14T14:00:00Z');
    const out = applyLimitOverlay([empty[0]!, { minutes: 10080, usedPercent: 97, resetsAt: resets }], [hit('weekly', '2026-10-12T18:05:00Z', '9am (America/Lima)')], NOW);
    expect(out[1]).toEqual({ minutes: 10080, usedPercent: 100, resetsAt: resets, limitReached: true });
    expect(out[0]).toEqual(empty[0]);
  });

  it('data that already says 100 or more is marked limitReached too', () => {
    const out = applyLimitOverlay([{ minutes: 300, usedPercent: 100, resetsAt: sec('2026-10-12T20:00:00Z') }, empty[1]!], [], NOW);
    expect(out[0]).toMatchObject({ usedPercent: 100, limitReached: true });
  });

  it('uses the latest event of each kind and never mutates its input', () => {
    const input = structuredClone(empty);
    const out = applyLimitOverlay(input, [hit('session', '2026-10-12T18:00:00Z'), hit('session', '2026-10-12T18:08:00Z')], NOW);
    expect(out[0]?.limitReached).toBe(true);
    expect(input).toEqual(empty);
  });
});

describe('ClaudeLimitScanner (files)', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'usage-widget-limit-'));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const proj = (name: string) => {
    const d = join(home, '.claude', 'projects', name);
    mkdirSync(d, { recursive: true });
    return d;
  };
  const write = (file: string, lines: string[], hoursAgo: number) => {
    writeFileSync(file, lines.join('\n') + '\n');
    const t = new Date(NOW - hoursAgo * 3_600_000);
    utimesSync(file, t, t);
  };
  const mk = (extra = {}) => new ClaudeLimitScanner(home, { now: () => NOW, ...extra });

  it('finds a limit entry in a recently modified transcript', async () => {
    write(join(proj('p1'), 'a.jsonl'), [normal('2026-10-12T17:00:00Z'), errLine(SESSION, '2026-10-12T18:05:00.000Z')], 0.1);
    expect(await mk().scan()).toEqual([{ window: 'session', timestampMs: Date.parse('2026-10-12T18:05:00.000Z'), resetText: '1:30pm (America/Lima)' }]);
  });

  it('ignores transcripts not modified in the last 6 hours', async () => {
    write(join(proj('p1'), 'old.jsonl'), [errLine(SESSION, '2026-10-12T18:05:00.000Z')], 7);
    expect(await mk().scan()).toEqual([]);
  });

  it('reads only the tail of a huge transcript and survives a cut first line', async () => {
    const filler = JSON.stringify({ type: 'assistant', timestamp: '2026-10-12T10:00:00Z', message: { content: [{ text: 'x'.repeat(3000) }] } });
    const cutHead = errLine(SESSION, '2026-10-12T09:00:00.000Z').slice(30); // partial line far from the end
    const lines = [cutHead, ...Array.from({ length: 200 }, () => filler), errLine(WEEKLY, '2026-10-12T18:06:00.000Z')];
    write(join(proj('p1'), 'big.jsonl'), lines, 0.1);
    const events = await mk().scan();
    expect(events.map((e) => e.window)).toEqual(['weekly']);
  });

  it('caches by mtime and size: an unchanged file is not read again', async () => {
    write(join(proj('p1'), 'a.jsonl'), [errLine(SESSION, '2026-10-12T18:05:00.000Z')], 0.1);
    let reads = 0;
    const s = mk({ readTail: async (f: string) => { reads++; return (await import('node:fs/promises')).readFile(f, 'utf8'); } });
    await s.scan();
    await s.scan();
    expect(reads).toBe(1);
    write(join(proj('p1'), 'a.jsonl'), [errLine(SESSION, '2026-10-12T18:05:00.000Z'), errLine(SESSION, '2026-10-12T18:07:00.000Z')], 0.05);
    await s.scan();
    expect(reads).toBe(2);
  });

  it('never throws: missing projects dir, unreadable entries', async () => {
    expect(await mk().scan()).toEqual([]);
    mkdirSync(join(home, '.claude', 'projects', 'p1', 'a.jsonl'), { recursive: true }); // a directory named like a transcript
    expect(await mk().scan()).toEqual([]);
  });
});

describe('ClaudeProvider limit overlay', () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'usage-widget-limit-prov-'));
    mkdirSync(join(home, '.claude', 'usage-widget'), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));
  const transcript = (lines: string[]) => {
    const d = join(home, '.claude', 'projects', 'p');
    mkdirSync(d, { recursive: true });
    const f = join(d, 's.jsonl');
    writeFileSync(f, lines.join('\n') + '\n');
    const t = new Date(NOW - 60_000);
    utimesSync(f, t, t);
  };

  it('shows 100% / limitReached on the 5h window from a transcript entry plus claude.json', async () => {
    const resets = Math.floor(Date.parse('2026-10-12T18:30:00Z') / 1000);
    writeFileSync(join(home, '.claude', 'usage-widget', 'claude.json'), JSON.stringify({ rate_limits: { five_hour: { used_percentage: 99, resets_at: resets } } }));
    transcript([errLine(SESSION, '2026-10-12T18:05:00.000Z')]);
    const snap = await new ClaudeProvider(home, { now: () => NOW }).read();
    expect(snap?.windows[0]).toEqual({ minutes: 300, usedPercent: 100, resetsAt: resets, limitReached: true });
    expect(snap?.windows[1]).toMatchObject({ minutes: 10080, usedPercent: 0 });
  });

  it('works without any claude.json window or file, deriving the reset from the text', async () => {
    transcript([errLine(SESSION, '2026-10-12T18:05:00.000Z')]);
    const snap = await new ClaudeProvider(home, { now: () => NOW }).read();
    expect(snap?.windows[0]).toMatchObject({ minutes: 300, usedPercent: 100, limitReached: true });
  });

  it('never writes anything under ~/.claude', async () => {
    transcript([errLine(SESSION, '2026-10-12T18:05:00.000Z')]);
    await new ClaudeProvider(home, { now: () => NOW }).read();
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(join(home, '.claude', 'usage-widget'))).toEqual([]);
  });
});
