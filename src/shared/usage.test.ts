import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatRemaining,
  headWindow,
  levelOf,
  resolveWindow,
  windowLabel,
} from './usage';

describe('windowLabel', () => {
  it('maps the known windows', () => {
    expect(windowLabel(300)).toBe('Current session · 5h');
    expect(windowLabel(10080)).toBe('Weekly · 7 days');
  });
  it('falls back to an hour count', () => {
    expect(windowLabel(60)).toBe('1h window');
    expect(windowLabel(1440)).toBe('24h window');
    expect(windowLabel(90)).toBe('2h window');
  });
});

describe('levelOf', () => {
  it('uses 70 and 90 as inclusive thresholds', () => {
    expect(levelOf(0)).toBe('ok');
    expect(levelOf(69.9)).toBe('ok');
    expect(levelOf(70)).toBe('warn');
    expect(levelOf(89.9)).toBe('warn');
    expect(levelOf(90)).toBe('bad');
    expect(levelOf(100)).toBe('bad');
  });
});

describe('resolveWindow', () => {
  const w = { minutes: 300, usedPercent: 62, resetsAt: 1_000 }; // epoch seconds

  it('keeps the window before the reset', () => {
    expect(resolveWindow(w, 999_999)).toEqual({ usedPercent: 62, resetsAtMs: 1_000_000, expired: false });
  });
  it('shows 0% and drops the reset once now >= resetsAt', () => {
    expect(resolveWindow(w, 1_000_000)).toEqual({ usedPercent: 0, resetsAtMs: null, expired: true });
    expect(resolveWindow(w, 5_000_000).usedPercent).toBe(0);
  });
  it('never expires a window without a reset time', () => {
    const r = resolveWindow({ ...w, resetsAt: null }, 9e15);
    expect(r).toEqual({ usedPercent: 62, resetsAtMs: null, expired: false });
  });
  it('clamps out-of-range percentages', () => {
    expect(resolveWindow({ ...w, usedPercent: 140 }, 0).usedPercent).toBe(100);
    expect(resolveWindow({ ...w, usedPercent: -3 }, 0).usedPercent).toBe(0);
  });
});

describe('headWindow', () => {
  it('follows the shortest window regardless of order', () => {
    const weekly = { minutes: 10080, usedPercent: 10, resetsAt: null };
    const session = { minutes: 300, usedPercent: 50, resetsAt: null };
    expect(headWindow([weekly, session])).toBe(session);
  });
  it('returns null for no windows', () => {
    expect(headWindow([])).toBeNull();
  });
});

describe('formatRemaining', () => {
  const H = 3_600_000;
  it('formats days, hours and minutes', () => {
    expect(formatRemaining(0)).toBe('0m');
    expect(formatRemaining(-5)).toBe('0m');
    expect(formatRemaining(12 * 60_000)).toBe('12m');
    expect(formatRemaining(2 * H + 5 * 60_000)).toBe('2h 5m');
    expect(formatRemaining(3 * 24 * H + 4 * H + 59 * 60_000)).toBe('3d 4h');
  });
});

describe('formatAgo', () => {
  it('reads naturally', () => {
    expect(formatAgo(0)).toBe('Updated just now');
    expect(formatAgo(4_999)).toBe('Updated just now');
    expect(formatAgo(5_000)).toBe('Updated 5s ago');
    expect(formatAgo(125_000)).toBe('Updated 2m ago');
    expect(formatAgo(3 * 3_600_000)).toBe('Updated 3h ago');
    expect(formatAgo(-1000)).toBe('Updated just now');
  });
});
