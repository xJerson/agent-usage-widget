import { describe, expect, it } from 'vitest';
import { ANTIGRAVITY_ID, ensureAntigravityWindows, mapAntigravityPlan, parseAntigravityStatusline } from './antigravityParser';

const bucket = (remaining: unknown, reset: unknown) => ({ remaining_fraction: remaining, reset_time: reset });

// Shape of what Antigravity passes to a statusLine command (only the parts the widget reads).
const REAL = {
  product: 'antigravity',
  plan_tier: 'Google AI Pro',
  quota: {
    '3p-5h': bucket(1, '2026-11-04T01:36:02Z'),
    '3p-weekly': bucket(0.4124776, '2026-11-06T20:33:35Z'),
    'gemini-5h': bucket(0.9187089, '2026-11-04T00:43:20Z'),
    'gemini-argon-wtu-weekly': bucket(0.24494547, '2026-11-06T16:58:12Z'),
    'gemini-weekly': bucket(0.7386237, '2026-11-06T16:58:18Z'),
  },
};
const parse = (v: unknown, at = 1234) => parseAntigravityStatusline(JSON.stringify(v), at);

describe('parseAntigravityStatusline', () => {
  it('maps all five quota buckets, inverting remaining into used percent', () => {
    const s = parse(REAL, 99)!;
    expect(s.agentId).toBe(ANTIGRAVITY_ID);
    expect(s.updatedAt).toBe(99);
    expect(s.windows).toHaveLength(5);

    expect(s.windows[0]!.id).toBe('gemini-5h');
    expect(s.windows[0]!.label).toBe('Gemini · 5h');
    expect(s.windows[0]!.minutes).toBe(300);
    expect(s.windows[0]!.usedPercent).toBeCloseTo(8.12913, 4);
    expect(s.windows[0]!.resetsAt).toBe(Date.parse('2026-11-04T00:43:20Z') / 1000);

    expect(s.windows[1]!.id).toBe('gemini-weekly');
    expect(s.windows[1]!.label).toBe('Gemini · Weekly (7d)');
    expect(s.windows[1]!.minutes).toBe(10080);
    expect(s.windows[1]!.usedPercent).toBeCloseTo(26.13763, 4);
    expect(s.windows[1]!.resetsAt).toBe(Date.parse('2026-11-06T16:58:18Z') / 1000);

    expect(s.windows[2]!.id).toBe('gemini-argon-wtu-weekly');
    expect(s.windows[2]!.label).toBe('Gemini Argon · WTU Weekly');
    expect(s.windows[2]!.minutes).toBe(10080);
    expect(s.windows[2]!.usedPercent).toBeCloseTo(75.50545, 4);
    expect(s.windows[2]!.resetsAt).toBe(Date.parse('2026-11-06T16:58:12Z') / 1000);

    expect(s.windows[3]!.id).toBe('3p-5h');
    expect(s.windows[3]!.label).toBe('Third-party (3P) · 5h');
    expect(s.windows[3]!.minutes).toBe(300);
    expect(s.windows[3]!.usedPercent).toBe(0);
    expect(s.windows[3]!.resetsAt).toBe(Date.parse('2026-11-04T01:36:02Z') / 1000);

    expect(s.windows[4]!.id).toBe('3p-weekly');
    expect(s.windows[4]!.label).toBe('Third-party (3P) · Weekly (7d)');
    expect(s.windows[4]!.minutes).toBe(10080);
    expect(s.windows[4]!.usedPercent).toBeCloseTo(58.75224, 4);
    expect(s.windows[4]!.resetsAt).toBe(Date.parse('2026-11-06T20:33:35Z') / 1000);
  });

  it('handles partial quota payloads gracefully', () => {
    const only = { quota: { '3p-5h': bucket(0.5, '2026-11-04T01:00:00Z'), 'gemini-argon-wtu-weekly': bucket(0.1, '2026-11-06T01:00:00Z') } };
    const s = parse(only)!;
    expect(s.windows).toHaveLength(2);
    expect(s.windows.map((w) => w.id)).toEqual(['gemini-argon-wtu-weekly', '3p-5h']);
  });

  it('uses the plan tier as the plan, shortened for the badge', () => {
    expect(parse(REAL)!.plan).toBe('Pro');
    expect(parse({ ...REAL, plan_tier: undefined })!.plan).toBeUndefined();
  });

  it('prefers updated_at stored by the hook over the fallback', () => {
    expect(parse({ ...REAL, updated_at: 5555 }, 1)!.updatedAt).toBe(5555);
  });

  it('clamps out-of-range fractions', () => {
    const s = parse({ quota: { 'gemini-5h': bucket(-0.2, '2026-11-04T00:43:20Z'), 'gemini-weekly': bucket(1.7, '2026-11-04T00:43:20Z') } })!;
    expect(s.windows.map((w) => w.usedPercent)).toEqual([100, 0]);
  });

  it('degrades: skips malformed buckets, keeps the good one', () => {
    const s = parse({ quota: { 'gemini-5h': bucket('x', '2026-11-04T00:43:20Z'), 'gemini-weekly': bucket(0.5, '2026-11-06T00:00:00Z') } })!;
    expect(s.windows.map((w) => w.minutes)).toEqual([10080]);
  });

  it('keeps a bucket with an unparseable reset time but no resetsAt', () => {
    const s = parse({ quota: { 'gemini-5h': bucket(0.5, 'soon') } })!;
    expect(s.windows).toEqual([
      { id: 'gemini-5h', label: 'Gemini · 5h', order: 1, minutes: 300, usedPercent: 50, resetsAt: null },
    ]);
  });

  it('accepts epoch seconds or milliseconds as reset_time numbers', () => {
    const s = parse({ quota: { 'gemini-5h': bucket(0.5, 1_800_000_000), 'gemini-weekly': bucket(0.5, 1_800_000_000_000) } })!;
    expect(s.windows.map((w) => w.resetsAt)).toEqual([1_800_000_000, 1_800_000_000]);
  });

  it('returns null for unreadable input and an empty snapshot when quota is missing', () => {
    expect(parseAntigravityStatusline('{"quota":{"gemini-5', 1)).toBeNull();
    expect(parseAntigravityStatusline('[]', 1)).toBeNull();
    expect(parse({ product: 'antigravity' })!.windows).toEqual([]);
    expect(parse({ quota: 'nope' })!.windows).toEqual([]);
  });

  it('never exposes the email even if it is present in the input', () => {
    const s = parse({ ...REAL, email: 'someone@example.com' })!;
    expect(JSON.stringify(s)).not.toContain('someone');
  });
});

describe('mapAntigravityPlan', () => {
  it('drops the "Google AI" prefix and passes other short names through', () => {
    expect(mapAntigravityPlan('Google AI Pro')).toBe('Pro');
    expect(mapAntigravityPlan('Google AI Ultra')).toBe('Ultra');
    expect(mapAntigravityPlan('  Free ')).toBe('Free');
  });
  it('gives no badge for empty, non-string or absurdly long values', () => {
    expect(mapAntigravityPlan('')).toBeUndefined();
    expect(mapAntigravityPlan('Google AI')).toBeUndefined();
    expect(mapAntigravityPlan(42)).toBeUndefined();
    expect(mapAntigravityPlan('x'.repeat(40))).toBeUndefined();
  });
});

describe('ensureAntigravityWindows', () => {
  it('fills missing windows with 0% when at least one exists', () => {
    const w = { id: 'gemini-5h', label: 'Gemini · 5h', order: 1, minutes: 300, usedPercent: 12, resetsAt: 1_800_000_000 };
    const res = ensureAntigravityWindows([w]);
    expect(res).toHaveLength(5);
    expect(res[0]).toEqual(w);
    expect(res[1]).toEqual({ id: 'gemini-weekly', label: 'Gemini · Weekly (7d)', order: 2, minutes: 10080, usedPercent: 0, resetsAt: null });
    expect(res[2]).toEqual({ id: 'gemini-argon-wtu-weekly', label: 'Gemini Argon · WTU Weekly', order: 3, minutes: 10080, usedPercent: 0, resetsAt: null });
    expect(res[3]).toEqual({ id: '3p-5h', label: 'Third-party (3P) · 5h', order: 4, minutes: 300, usedPercent: 0, resetsAt: null });
    expect(res[4]).toEqual({ id: '3p-weekly', label: 'Third-party (3P) · Weekly (7d)', order: 5, minutes: 10080, usedPercent: 0, resetsAt: null });
  });
  it('stays empty when there is no window at all (nothing to show yet)', () => {
    expect(ensureAntigravityWindows([])).toEqual([]);
  });
});
