import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeProvider } from './claude';
import { CodexProvider } from './codex';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'usage-widget-test-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe('ClaudeProvider', () => {
  it('is not detected without ~/.claude and detected once it exists, even without data', async () => {
    const p = new ClaudeProvider(home);
    expect(await p.detect()).toBe(false);
    mkdirSync(join(home, '.claude'));
    expect(await p.detect()).toBe(true);
    expect(await p.read()).toBeNull();
  });

  it('reads the statusline dump and uses the file mtime as updatedAt', async () => {
    const dir = join(home, '.claude', 'usage-widget');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'claude.json');
    writeFileSync(file, JSON.stringify({ rate_limits: { five_hour: { used_percentage: 12, resets_at: 1_800_000_000 } } }));
    utimesSync(file, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    const snap = await new ClaudeProvider(home).read();
    expect(snap?.windows).toEqual([
      { minutes: 300, usedPercent: 12, resetsAt: 1_800_000_000 },
      { minutes: 10080, usedPercent: 0, resetsAt: null }, // always present, even when Claude Code did not send it
    ]);
    expect(snap?.updatedAt).toBe(1_700_000_000_000);
  });

  it('returns null for a half-written file instead of throwing', async () => {
    const dir = join(home, '.claude', 'usage-widget');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'claude.json'), '{"rate_limits":{"five_h');
    const p = new ClaudeProvider(home, { retryDelayMs: 1 });
    expect(await p.read()).toBeNull();
  });

  it('watches the data dir when it exists, otherwise ~/.claude', () => {
    const p = new ClaudeProvider(home);
    mkdirSync(join(home, '.claude'));
    expect(p.watchTargets()).toEqual([join(home, '.claude')]);
    mkdirSync(join(home, '.claude', 'usage-widget'));
    expect(p.watchTargets()).toEqual([join(home, '.claude', 'usage-widget')]);
  });
});

describe('CodexProvider', () => {
  const NOW = Date.parse('2026-10-12T12:00:00.000Z');
  const mk = () => new CodexProvider(home, { now: () => NOW });
  const day = (y: string, m: string, d: string) => {
    const dir = join(home, '.codex', 'sessions', y, m, d);
    mkdirSync(dir, { recursive: true });
    return dir;
  };
  /** Writes a rollout and sets its mtime to `hoursAgo` before NOW. */
  const rollout = (dir: string, name: string, lines: string[], hoursAgo: number) => {
    const file = join(dir, name);
    writeFileSync(file, lines.join('\n') + '\n');
    const t = new Date(NOW - hoursAgo * 3_600_000);
    utimesSync(file, t, t);
    return file;
  };
  const ev = (pct: number, ts: string, extra: { resets?: number; limitId?: string } = {}) =>
    JSON.stringify({
      timestamp: ts,
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          limit_id: extra.limitId ?? 'codex',
          primary: { used_percent: pct, window_minutes: 300, resets_at: extra.resets ?? 1_800_000_000 },
          secondary: { used_percent: 7, window_minutes: 10080, resets_at: 1_800_500_000 },
          plan_type: 'plus',
        },
      },
    });

  it('detects on ~/.codex/sessions only', async () => {
    const p = mk();
    expect(await p.detect()).toBe(false);
    mkdirSync(join(home, '.codex'));
    expect(await p.detect()).toBe(false);
    mkdirSync(join(home, '.codex', 'sessions'));
    expect(await p.detect()).toBe(true);
    expect(await p.read()).toBeNull();
  });

  it('an older-named rollout with newer events beats a newer-named one with stale events', async () => {
    const d = day('2026', '10', '12');
    rollout(d, 'rollout-2026-10-12T08-00-00-old.jsonl', [ev(44, '2026-10-12T11:30:00.000Z')], 0.5);
    rollout(d, 'rollout-2026-10-12T09-00-00-new.jsonl', [ev(41, '2026-10-12T10:00:00.000Z')], 1.5);
    expect((await mk().read())?.windows[0]?.usedPercent).toBe(44);
  });

  it('a newer-named rollout with older events loses, and mtime alone does not decide either', async () => {
    const d = day('2026', '10', '12');
    rollout(d, 'rollout-2026-10-12T08-00-00-a.jsonl', [ev(41, '2026-10-12T09:00:00.000Z')], 0.1); // touched last, events older
    rollout(d, 'rollout-2026-10-12T09-00-00-b.jsonl', [ev(44, '2026-10-12T11:00:00.000Z')], 2);
    expect((await mk().read())?.windows[0]?.usedPercent).toBe(44);
  });

  it('breaks timestamp ties by file mtime', async () => {
    const d = day('2026', '10', '12');
    const ts = '2026-10-12T10:00:00.000Z';
    rollout(d, 'rollout-2026-10-12T08-00-00-a.jsonl', [ev(10, ts)], 3);
    rollout(d, 'rollout-2026-10-12T09-00-00-b.jsonl', [ev(25, ts)], 1);
    rollout(d, 'rollout-2026-10-12T07-00-00-c.jsonl', [ev(5, ts)], 5);
    expect((await mk().read())?.windows[0]?.usedPercent).toBe(25);
  });

  it('uses the last complete event when the newest line is partially written', async () => {
    const d = day('2026', '10', '12');
    const partial = ev(99, '2026-10-12T11:59:00.000Z').slice(0, 90);
    rollout(d, 'rollout-2026-10-12T09-00-00-a.jsonl', [ev(30, '2026-10-12T11:00:00.000Z'), partial], 0.1);
    rollout(d, 'rollout-2026-10-12T08-00-00-b.jsonl', [ev(20, '2026-10-12T10:00:00.000Z')], 1);
    expect((await mk().read())?.windows[0]?.usedPercent).toBe(30);
  });

  it('compares files across date folders, including an older folder that is still being written', async () => {
    rollout(day('2026', '10', '12'), 'rollout-2026-10-12T09-00-00-a.jsonl', [ev(41, '2026-10-12T10:00:00.000Z')], 2);
    rollout(day('2026', '10', '09'), 'rollout-2026-10-09T09-00-00-b.jsonl', [ev(44, '2026-10-12T11:30:00.000Z')], 0.5);
    expect((await mk().read())?.windows[0]?.usedPercent).toBe(44);
  });

  it('an expired snapshot from an old session never beats a fresher one for the same window', async () => {
    const d = day('2026', '10', '12');
    const past = Math.floor(NOW / 1000) - 3600;
    rollout(d, 'rollout-2026-10-12T09-00-00-a.jsonl', [ev(88, '2026-10-12T05:00:00.000Z', { resets: past })], 0.2);
    rollout(d, 'rollout-2026-10-12T08-00-00-b.jsonl', [ev(3, '2026-10-12T11:00:00.000Z')], 1);
    expect((await mk().read())?.windows[0]?.usedPercent).toBe(3);
  });

  it('ignores rollouts not modified within the last 7 days', async () => {
    rollout(day('2026', '10', '01'), 'rollout-2026-10-01T09-00-00-a.jsonl', [ev(99, '2026-10-12T11:59:00.000Z')], 24 * 9);
    expect(await mk().read()).toBeNull();
  });

  it('prefers the codex limit across files even when another limit is newer', async () => {
    const d = day('2026', '10', '12');
    rollout(d, 'rollout-2026-10-12T08-00-00-a.jsonl', [ev(20, '2026-10-12T10:00:00.000Z')], 2);
    rollout(d, 'rollout-2026-10-12T09-00-00-b.jsonl', [ev(90, '2026-10-12T11:00:00.000Z', { limitId: 'codex_other' })], 1);
    expect((await mk().read())?.windows[0]?.usedPercent).toBe(20);
  });

  it('only looks at the 8 most recently modified rollouts', async () => {
    const d = day('2026', '10', '12');
    for (let i = 0; i < 9; i++) {
      // file 0 is the least recently modified but carries the newest event: it falls outside the window
      const ts = i === 0 ? '2026-10-12T11:59:00.000Z' : '2026-10-12T10:00:00.000Z';
      rollout(d, `rollout-2026-10-12T0${i}-00-00-f${i}.jsonl`, [ev(i === 0 ? 99 : 10 + i, ts)], 10 - i);
    }
    expect((await mk().read())?.windows[0]?.usedPercent).not.toBe(99);
  });

  it('skips files without rate limits and returns null when there are none anywhere', async () => {
    const d = day('2026', '10', '12');
    rollout(d, 'rollout-2026-10-12T09-00-00-a.jsonl', ['{"type":"session_meta"}'], 0.1);
    expect(await mk().read()).toBeNull();
    rollout(d, 'rollout-2026-10-12T08-00-00-b.jsonl', [ev(41, '2026-10-12T10:00:00.000Z')], 1);
    expect((await mk().read())?.windows[0]?.usedPercent).toBe(41);
  });

  it('only reads the tail of large files', async () => {
    const d = day('2026', '10', '12');
    const filler = JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', text: 'x'.repeat(2000) } });
    rollout(d, 'rollout-2026-10-12T09-00-00-c.jsonl', [...Array.from({ length: 300 }, () => filler), ev(66, '2026-10-12T11:00:00.000Z')], 0.1);
    expect((await mk().read())?.windows[0]?.usedPercent).toBe(66);
  });

  it('watches the whole sessions tree recursively so a write in any date folder refreshes', () => {
    const p = mk();
    expect(p.watchTargets()).toEqual([join(home, '.codex', 'sessions')]);
    expect(p.watchRecursive).toBe(true);
  });
});
