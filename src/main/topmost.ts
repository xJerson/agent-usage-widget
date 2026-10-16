/** The slice of BrowserWindow needed to keep a window above everything else. */
export interface TopmostWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  setAlwaysOnTop(flag: boolean, level: 'screen-saver'): void;
  moveTop(): void;
}

export interface TopmostWatchOptions {
  /** Read on every pass, so windows created later (panel, toast, edit bar) are included. */
  windows(): TopmostWindow[];
  /** Registers a handler for system events that can drop the topmost state; returns an unsubscribe function. */
  subscribe(handler: () => void): () => void;
  intervalMs: number;
}

/** Puts a visible window back on the topmost layer and raises it within that layer. */
export function keepOnTop(win: TopmostWindow): void {
  if (win.isDestroyed() || !win.isVisible()) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.moveTop();
}

/**
 * Windows can silently drop a window's topmost state (sleep/resume, display changes, fullscreen apps, other
 * topmost windows, Explorer restarts), after which the widget stays behind other apps until restarted. Setting
 * it once at creation is not enough, so it is re-asserted on those events and periodically as a safety net.
 */
export function watchTopmost(opts: TopmostWatchOptions): () => void {
  const reassert = (): void => {
    for (const win of opts.windows()) keepOnTop(win);
  };
  const unsubscribe = opts.subscribe(reassert);
  const timer = setInterval(reassert, opts.intervalMs);
  return () => {
    clearInterval(timer);
    unsubscribe();
  };
}
