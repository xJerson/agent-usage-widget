import { describe, expect, it } from 'vitest';
import { parseCodexRolloutTail } from './codexParser';

/** Synthetic fixtures only: no real session content. */
const tokenCount = (
  timestamp: string,
  rateLimits: unknown,
  extra: Record<string, unknown> = {},
): string =>
  JSON.stringify({
    timestamp,
    type: 'event_msg',
    payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1 } }, rate_limits: rateLimits, ...extra },
  });

const other = (n: number): string =>
  JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type: 'event_msg', payload: { type: 'agent_message', n } });

const limits = (primary: number, secondary: number, plan = 'plus') => ({
  limit_id: 'codex',
  primary: { used_percent: primary, window_minutes: 300, resets_at: 1_800_000_000 },
  secondary: { used_percent: secondary, window_minutes: 10080, resets_at: 1_800_500_000 },
  plan_type: plan,
});

describe('parseCodexRolloutTail', () => {
  it('maps primary and secondary to windows by window_minutes', () => {
    const tail = [other(1), tokenCount('2026-10-12T14:35:23.686Z', limits(23, 4))].join('\n');
    const snap = parseCodexRolloutTail(tail, { fallbackUpdatedAt: 7 });
    expect(snap).toEqual({
      agentId: 'codex',
      plan: 'plus',
      windows: [
        { minutes: 300, usedPercent: 23, resetsAt: 1_800_000_000 },
        { minutes: 10080, usedPercent: 4, resetsAt: 1_800_500_000 },
      ],
      updatedAt: Date.parse('2026-10-12T14:35:23.686Z'),
    });
  });

  it('latest token_count wins when there are several', () => {
    const tail = [
      tokenCount('2026-10-12T10:00:00.000Z', limits(10, 1)),
      other(1),
      tokenCount('2026-10-12T11:00:00.000Z', limits(55, 9)),
      other(2),
    ].join('\n');
    const snap = parseCodexRolloutTail(tail);
    expect(snap?.windows[0]?.usedPercent).toBe(55);
    expect(snap?.windows[1]?.usedPercent).toBe(9);
  });

  it('ignores a partially written last line', () => {
    const good = tokenCount('2026-10-12T11:00:00.000Z', limits(30, 3));
    const partial = tokenCount('2026-10-12T12:00:00.000Z', limits(99, 99)).slice(0, 120);
    const snap = parseCodexRolloutTail([good, partial].join('\n'));
    expect(snap?.windows[0]?.usedPercent).toBe(30);
  });

  it('drops the first line when the tail started mid-file', () => {
    const cutOff = tokenCount('2026-10-12T09:00:00.000Z', limits(77, 7)).slice(40); // broken head
    const tail = [cutOff, other(1)].join('\n');
    expect(parseCodexRolloutTail(tail, { truncatedStart: true })).toBeNull();
  });

  it('keeps the first line when the tail is the whole file', () => {
    const tail = tokenCount('2026-10-12T09:00:00.000Z', limits(12, 2));
    expect(parseCodexRolloutTail(tail, { truncatedStart: false })?.windows[0]?.usedPercent).toBe(12);
  });

  it('skips token_count events whose rate_limits is null and uses an earlier one', () => {
    const tail = [
      tokenCount('2026-10-12T10:00:00.000Z', limits(21, 2)),
      tokenCount('2026-10-12T11:00:00.000Z', null),
    ].join('\n');
    expect(parseCodexRolloutTail(tail)?.windows[0]?.usedPercent).toBe(21);
  });

  it('handles a missing secondary window', () => {
    const tail = tokenCount('2026-10-12T10:00:00.000Z', {
      primary: { used_percent: 40, window_minutes: 300, resets_at: 1_800_000_000 },
      secondary: null,
    });
    expect(parseCodexRolloutTail(tail)?.windows).toEqual([{ minutes: 300, usedPercent: 40, resetsAt: 1_800_000_000 }]);
  });

  it('orders windows by length even if the source swaps them', () => {
    const tail = tokenCount('2026-10-12T10:00:00.000Z', {
      primary: { used_percent: 5, window_minutes: 10080, resets_at: 1_800_500_000 },
      secondary: { used_percent: 50, window_minutes: 300, resets_at: 1_800_000_000 },
    });
    expect(parseCodexRolloutTail(tail)?.windows.map((w) => w.minutes)).toEqual([300, 10080]);
  });

  it('returns null when no event carries rate limits', () => {
    expect(parseCodexRolloutTail([other(1), other(2)].join('\n'))).toBeNull();
    expect(parseCodexRolloutTail('')).toBeNull();
  });

  it('ignores non token_count events that happen to carry rate_limits', () => {
    const line = JSON.stringify({ type: 'event_msg', payload: { type: 'other', rate_limits: limits(88, 8) } });
    expect(parseCodexRolloutTail(line)).toBeNull();
  });

  it('uses the fallback timestamp when the line has none', () => {
    const line = JSON.stringify({ payload: { type: 'token_count', rate_limits: limits(1, 1) } });
    expect(parseCodexRolloutTail(line, { fallbackUpdatedAt: 4242 })?.updatedAt).toBe(4242);
  });

  it('prefers the codex limit over other metered limits', () => {
    const tail = [
      tokenCount('2026-10-12T10:00:00.000Z', limits(20, 2)),
      tokenCount('2026-10-12T11:00:00.000Z', { ...limits(90, 90), limit_id: 'codex_other' }),
    ].join('\n');
    expect(parseCodexRolloutTail(tail)?.windows[0]?.usedPercent).toBe(20);
  });

  it('copes with CRLF line endings', () => {
    const tail = [other(1), tokenCount('2026-10-12T10:00:00.000Z', limits(33, 3))].join('\r\n');
    expect(parseCodexRolloutTail(tail)?.windows[0]?.usedPercent).toBe(33);
  });
});
