import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepOnTop, watchTopmost, type TopmostWindow } from './topmost';

function fakeWindow(state: { destroyed?: boolean; visible?: boolean } = {}): TopmostWindow & {
  setAlwaysOnTop: ReturnType<typeof vi.fn>;
  moveTop: ReturnType<typeof vi.fn>;
} {
  return {
    isDestroyed: () => state.destroyed ?? false,
    isVisible: () => state.visible ?? true,
    setAlwaysOnTop: vi.fn(),
    moveTop: vi.fn(),
  };
}

describe('keepOnTop', () => {
  it('re-asserts the topmost level and raises a visible window', () => {
    const win = fakeWindow();
    keepOnTop(win);
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver');
    expect(win.moveTop).toHaveBeenCalledOnce();
  });

  it('leaves a destroyed window alone', () => {
    const win = fakeWindow({ destroyed: true });
    keepOnTop(win);
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(win.moveTop).not.toHaveBeenCalled();
  });

  it('does not raise a hidden window', () => {
    const win = fakeWindow({ visible: false });
    keepOnTop(win);
    expect(win.setAlwaysOnTop).not.toHaveBeenCalled();
    expect(win.moveTop).not.toHaveBeenCalled();
  });
});

describe('watchTopmost', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('re-asserts every window when a subscribed event fires', () => {
    const a = fakeWindow();
    const b = fakeWindow();
    let fire = (): void => {};
    watchTopmost({ windows: () => [a, b], subscribe: (h) => ((fire = h), () => {}), intervalMs: 30_000 });
    fire();
    expect(a.moveTop).toHaveBeenCalledOnce();
    expect(b.moveTop).toHaveBeenCalledOnce();
  });

  it('re-asserts periodically as a safety net', () => {
    const win = fakeWindow();
    watchTopmost({ windows: () => [win], subscribe: () => () => {}, intervalMs: 30_000 });
    vi.advanceTimersByTime(30_000);
    expect(win.moveTop).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(30_000);
    expect(win.moveTop).toHaveBeenCalledTimes(2);
  });

  it('reads the window list on every pass so lazily created windows are included', () => {
    const late = fakeWindow();
    const list: TopmostWindow[] = [];
    watchTopmost({ windows: () => list, subscribe: () => () => {}, intervalMs: 1000 });
    list.push(late);
    vi.advanceTimersByTime(1000);
    expect(late.moveTop).toHaveBeenCalledOnce();
  });

  it('stops the timer and unsubscribes when stopped', () => {
    const win = fakeWindow();
    const unsubscribe = vi.fn();
    const stop = watchTopmost({ windows: () => [win], subscribe: () => unsubscribe, intervalMs: 1000 });
    stop();
    vi.advanceTimersByTime(5000);
    expect(win.moveTop).not.toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
