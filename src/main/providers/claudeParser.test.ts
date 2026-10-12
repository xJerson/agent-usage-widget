import { describe, expect, it } from 'vitest';
import { parseClaudeStatusline } from './claudeParser';

const UPDATED = 1_700_000_000_000;

describe('parseClaudeStatusline', () => {
  it('maps five_hour and seven_day to 300 / 10080 minute windows', () => {
    const raw = JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 23.5, resets_at: 1_800_000_000 },
        seven_day: { used_percentage: 41.2, resets_at: 1_800_500_000 },
      },
    });
    expect(parseClaudeStatusline(raw, UPDATED)).toEqual({
      agentId: 'claude',
      windows: [
        { minutes: 300, usedPercent: 23.5, resetsAt: 1_800_000_000 },
        { minutes: 10080, usedPercent: 41.2, resetsAt: 1_800_500_000 },
      ],
      updatedAt: UPDATED,
    });
  });

  it('accepts a single window', () => {
    const raw = JSON.stringify({ rate_limits: { seven_day: { used_percentage: 5, resets_at: 1_800_000_000 } } });
    expect(parseClaudeStatusline(raw, UPDATED)?.windows).toEqual([
      { minutes: 10080, usedPercent: 5, resetsAt: 1_800_000_000 },
    ]);
  });

  it('returns an empty snapshot when rate_limits is absent', () => {
    expect(parseClaudeStatusline('{"model":{"id":"x"}}', UPDATED)).toEqual({
      agentId: 'claude',
      windows: [],
      updatedAt: UPDATED,
    });
  });

  it('keeps a window whose reset time is missing', () => {
    const raw = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 10 } } });
    expect(parseClaudeStatusline(raw, UPDATED)?.windows).toEqual([{ minutes: 300, usedPercent: 10, resetsAt: null }]);
  });

  it('skips windows with a non-numeric percentage', () => {
    const raw = JSON.stringify({
      rate_limits: { five_hour: { used_percentage: 'lots' }, seven_day: { used_percentage: 3, resets_at: 1_800_000_000 } },
    });
    expect(parseClaudeStatusline(raw, UPDATED)?.windows.map((w) => w.minutes)).toEqual([10080]);
  });

  it('clamps percentages into 0..100', () => {
    const raw = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 130 } } });
    expect(parseClaudeStatusline(raw, UPDATED)?.windows[0]?.usedPercent).toBe(100);
  });

  it('normalises millisecond reset timestamps to seconds', () => {
    const raw = JSON.stringify({ rate_limits: { five_hour: { used_percentage: 1, resets_at: 1_800_000_000_000 } } });
    expect(parseClaudeStatusline(raw, UPDATED)?.windows[0]?.resetsAt).toBe(1_800_000_000);
  });

  it('returns null for partially written or invalid JSON', () => {
    expect(parseClaudeStatusline('{"rate_limits":{"five_hour":{"used_perc', UPDATED)).toBeNull();
    expect(parseClaudeStatusline('', UPDATED)).toBeNull();
    expect(parseClaudeStatusline('[1,2]', UPDATED)).toBeNull();
    expect(parseClaudeStatusline('null', UPDATED)).toBeNull();
  });
});
