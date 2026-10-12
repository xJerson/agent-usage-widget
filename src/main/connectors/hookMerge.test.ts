import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import hookSource from './hook.js?raw';

interface Merge {
  text: string;
  accepted: boolean;
}
const { mergeStatusPayload } = createRequire(import.meta.url)('./hook.js') as {
  mergeStatusPayload(stored: string | null, incoming: string, nowSec: number): Merge;
};

const NOW = 1_800_000_000;
const H = 3600;
const win = (pct: number, resets: number) => ({ used_percentage: pct, resets_at: resets });
const payload = (limits: Record<string, unknown> | undefined, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ ...extra, ...(limits ? { rate_limits: limits } : {}) });
const limitsOf = (m: Merge) => (JSON.parse(m.text) as { rate_limits?: Record<string, { used_percentage: number; resets_at: number }> }).rate_limits;

describe('mergeStatusPayload', () => {
  const R5 = NOW + 2 * H;
  const R7 = NOW + 3 * 24 * H;

  it('without a stored file the incoming payload is written as is', () => {
    const incoming = payload({ five_hour: win(10, R5) });
    expect(mergeStatusPayload(null, incoming, NOW)).toEqual({ text: incoming, accepted: true });
  });

  it('same resets_at: the higher used_percentage wins (an older session cannot lower it)', () => {
    const stored = payload({ five_hour: win(30, R5), seven_day: win(21, R7) });
    const m = mergeStatusPayload(stored, payload({ five_hour: win(25, R5), seven_day: win(18, R7) }), NOW);
    expect(limitsOf(m)).toEqual({ five_hour: win(30, R5), seven_day: win(21, R7) });
    expect(m.accepted).toBe(false); // nothing new came from the incoming payload
  });

  it('same resets_at with a higher incoming percentage takes the incoming', () => {
    const m = mergeStatusPayload(payload({ five_hour: win(30, R5) }), payload({ five_hour: win(41, R5) }), NOW);
    expect(limitsOf(m)?.['five_hour']?.used_percentage).toBe(41);
    expect(m.accepted).toBe(true);
  });

  it('an equal percentage still counts as a fresh confirmation', () => {
    const m = mergeStatusPayload(payload({ five_hour: win(30, R5) }), payload({ five_hour: win(30, R5) }), NOW);
    expect(m.accepted).toBe(true);
  });

  it('a newer window (later resets_at) wins even with a lower percentage', () => {
    const m = mergeStatusPayload(payload({ five_hour: win(90, R5) }), payload({ five_hour: win(2, R5 + 5 * H) }), NOW);
    expect(limitsOf(m)?.['five_hour']).toEqual(win(2, R5 + 5 * H));
    expect(m.accepted).toBe(true);
  });

  it('an older window (earlier resets_at) is ignored', () => {
    const m = mergeStatusPayload(payload({ five_hour: win(5, R5 + 5 * H) }), payload({ five_hour: win(80, R5) }), NOW);
    expect(limitsOf(m)?.['five_hour']).toEqual(win(5, R5 + 5 * H));
    expect(m.accepted).toBe(false);
  });

  it('an absent incoming window keeps the stored one while its reset is in the future', () => {
    const m = mergeStatusPayload(payload({ five_hour: win(30, R5), seven_day: win(21, R7) }), payload({ seven_day: win(22, R7) }), NOW);
    expect(limitsOf(m)).toEqual({ seven_day: win(22, R7), five_hour: win(30, R5) });
  });

  it('a payload with no rate_limits at all keeps the stored limits', () => {
    const m = mergeStatusPayload(payload({ five_hour: win(30, R5) }), payload(undefined, { model: { id: 'x' } }), NOW);
    expect(limitsOf(m)).toEqual({ five_hour: win(30, R5) });
    expect(m.accepted).toBe(false);
  });

  it('drops windows whose resets_at has passed, stored or incoming', () => {
    const past = NOW - 60;
    const m = mergeStatusPayload(payload({ five_hour: win(30, past), seven_day: win(21, R7) }), payload({ five_hour: win(99, past) }), NOW);
    expect(limitsOf(m)).toEqual({ seven_day: win(21, R7) });
  });

  it('removes rate_limits entirely when nothing live is left', () => {
    const past = NOW - 60;
    const m = mergeStatusPayload(payload({ five_hour: win(30, past) }), payload({ five_hour: win(31, past) }), NOW);
    expect(JSON.parse(m.text).rate_limits).toBeUndefined();
  });

  it('keeps every other top-level field from the incoming payload (freshest session metadata)', () => {
    const m = mergeStatusPayload(
      payload({ five_hour: win(30, R5) }, { session_id: 'old', model: { id: 'a' } }),
      payload({ five_hour: win(10, R5) }, { session_id: 'new', model: { id: 'b' }, cwd: '/x' }),
      NOW,
    );
    const out = JSON.parse(m.text);
    expect(out.session_id).toBe('new');
    expect(out.model).toEqual({ id: 'b' });
    expect(out.cwd).toBe('/x');
    expect(out.rate_limits.five_hour.used_percentage).toBe(30); // merged, not overwritten
  });

  it('invalid, partial or non-object stored content is ignored', () => {
    const incoming = payload({ five_hour: win(10, R5) });
    for (const bad of ['', '{"rate_limits":{"five_h', 'nope', '[1]', 'null']) {
      expect(mergeStatusPayload(bad, incoming, NOW)).toEqual({ text: incoming, accepted: true });
    }
  });

  it('tolerates a BOM on the stored file', () => {
    const m = mergeStatusPayload('﻿' + payload({ five_hour: win(30, R5) }), payload({ five_hour: win(20, R5) }), NOW);
    expect(limitsOf(m)?.['five_hour']?.used_percentage).toBe(30);
  });

  it('non-JSON incoming text is passed through untouched', () => {
    expect(mergeStatusPayload(payload({ five_hour: win(30, R5) }), 'plain text', NOW)).toEqual({ text: 'plain text', accepted: true });
  });

  it('two sessions alternating never lower the values and the newest window always wins', () => {
    let file: string | null = null;
    const feed = (p: Record<string, unknown>, expect5: number, expect7: number) => {
      const m = mergeStatusPayload(file, payload(p), NOW);
      if (m.accepted) file = m.text;
      const l = limitsOf({ text: file ?? '{}', accepted: true });
      expect([l?.['five_hour']?.used_percentage, l?.['seven_day']?.used_percentage]).toEqual([expect5, expect7]);
    };
    feed({ five_hour: win(10, R5), seven_day: win(18, R7) }, 10, 18); // session A (idle, old cache)
    feed({ five_hour: win(40, R5), seven_day: win(21, R7) }, 40, 21); // session B (active)
    feed({ five_hour: win(10, R5), seven_day: win(18, R7) }, 40, 21); // A again with stale numbers
    feed({ five_hour: win(44, R5), seven_day: win(21, R7) }, 44, 21); // B
    feed({ seven_day: win(18, R7) }, 44, 21); // A, five_hour dropped
    feed({ five_hour: win(1, R5 + 5 * H), seven_day: win(21, R7) }, 1, 21); // 5h window rolled over
    feed({ five_hour: win(44, R5), seven_day: win(21, R7) }, 1, 21); // A still on the old 5h window
  });
});

describe('hook.js end to end', () => {
  let dir: string;
  let hook: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'usage widget merge-'));
    mkdirSync(dir, { recursive: true });
    hook = join(dir, 'hook.js');
    writeFileSync(hook, hookSource);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const run = (input: string, args: string[] = []) => spawnSync(process.execPath, [hook, ...args], { input, encoding: 'utf8' });
  const stored = () => JSON.parse(readFileSync(join(dir, 'claude.json'), 'utf8')) as { rate_limits?: Record<string, { used_percentage: number }> };
  const future = Math.floor(Date.now() / 1000) + 3 * H;

  it('an older payload fed after a newer one does not lower the stored values', () => {
    run(payload({ five_hour: win(44, future), seven_day: win(21, future + 86400) }));
    const second = run(payload({ five_hour: win(41, future), seven_day: win(18, future + 86400) }), ['--then', "node -e 'process.stdout.write(\"ok\")'"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toBe('ok'); // the wrapped command still runs and gets the original input
    expect(stored().rate_limits?.['five_hour']?.used_percentage).toBe(44);
    expect(stored().rate_limits?.['seven_day']?.used_percentage).toBe(21);
  });

  it('a rejected stale payload does not touch the file (its mtime keeps meaning "last accepted data")', () => {
    run(payload({ five_hour: win(44, future) }));
    const before = readFileSync(join(dir, 'claude.json'), 'utf8');
    run(payload({ five_hour: win(10, future) }));
    expect(readFileSync(join(dir, 'claude.json'), 'utf8')).toBe(before);
    expect(existsSync(join(dir, 'claude.json'))).toBe(true);
  });

  it('survives an invalid stored file', () => {
    writeFileSync(join(dir, 'claude.json'), '{"rate_limits":{"five_');
    const r = run(payload({ five_hour: win(7, future) }));
    expect(r.status).toBe(0);
    expect(stored().rate_limits?.['five_hour']?.used_percentage).toBe(7);
  });
});
