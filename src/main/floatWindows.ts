import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import { floatContentSize, floatWindowBounds, placeAbove, placePanel } from '../shared/geometry';
import { FLOAT_PADDING, IPC } from '../shared/ipc';
import type { FloatBarState, FloatLayout, FloatPanelData, FloatRole, Rect, Size, ToastMessage } from '../shared/types';

const PANEL_GAP = 16;
const TOAST_GAP = 10;
const BAR_GAP = 28;
const HIDE_FALLBACK_MS = 700;

interface Slot {
  role: FloatRole;
  win: BrowserWindow | null;
  ready: Promise<void> | null;
  shown: boolean;
  /** Reported size of the rendered content INCLUDING the transparent padding. */
  size: Size | null;
  content: unknown;
  hideTimer: NodeJS.Timeout | null;
}

export interface FloatOptions {
  preload: string;
  /** Loads the renderer for a role into a window. */
  load(win: BrowserWindow, role: FloatRole): Promise<void>;
  /** The bubble window; floating windows are positioned relative to it. */
  main(): BrowserWindow;
  /** Called when the edit bar asks to confirm / cancel. */
  onBarAnswer(confirm: boolean): void;
}

/**
 * The detail panel, the toast and the edit bar live in their OWN transparent windows instead of enlarging the
 * bubble window. Resizing a transparent window shows one stale frame (measured), which made the bubbles blink
 * whenever a panel opened; with separate windows the bubble window never resizes for them, and the floating
 * windows are resized while nothing in them is visible (content fades in only after the new size is applied).
 */
export class FloatWindows {
  private readonly slots: Record<FloatRole, Slot> = {
    panel: this.slot('panel'),
    toast: this.slot('toast'),
    bar: this.slot('bar'),
  };
  private layout: FloatLayout | null = null;
  private layoutWaiters: Array<() => void> = [];

  constructor(private readonly opts: FloatOptions) {
    ipcMain.handle(IPC.floatSize, (e, size: unknown) => this.onSize(e, size));
    ipcMain.on(IPC.floatHidden, (e) => this.onHidden(e));
    ipcMain.on(IPC.barAnswer, (e: IpcMainEvent, confirm: unknown) => {
      if (e.sender === this.slots.bar.win?.webContents) opts.onBarAnswer(confirm === true);
    });
  }

  private slot(role: FloatRole): Slot {
    return { role, win: null, ready: null, shown: false, size: null, content: null, hideTimer: null };
  }

  // ---- public state setters (called from the bubble window's IPC) -------------------------------------------

  setLayout(layout: FloatLayout): void {
    this.layout = layout;
    for (const w of this.layoutWaiters.splice(0)) w();
    this.reposition();
  }
  setPanel(data: FloatPanelData | null): void {
    void this.setContent('panel', data);
  }
  private toastTimer: NodeJS.Timeout | null = null;
  showToast(toast: ToastMessage): void {
    void this.setContent('toast', toast);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => void this.setContent('toast', null), toast.kind === 'error' ? 7000 : 2200);
  }
  setBar(state: FloatBarState | null): void {
    void this.setContent('bar', state);
    if (state) this.slots.bar.win?.focus();
  }

  /** Re-places every visible floating window (the bubble window moved, resized or changed layout). */
  reposition(): void {
    for (const role of ['panel', 'toast', 'bar'] as const) this.place(this.slots[role]);
  }

  // ---- internals --------------------------------------------------------------------------------------------

  private async ensureWindow(s: Slot): Promise<BrowserWindow> {
    if (s.win && !s.win.isDestroyed()) {
      await s.ready;
      return s.win;
    }
    const interactive = s.role === 'bar';
    const win = new BrowserWindow({
      width: 100,
      height: 100,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      hasShadow: false,
      skipTaskbar: true,
      focusable: interactive,
      alwaysOnTop: true,
      backgroundColor: '#00000000',
      webPreferences: { preload: this.opts.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    if (!interactive) win.setIgnoreMouseEvents(true); // nothing in the panel / toast is clickable
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    s.win = win;
    s.ready = this.opts.load(win, s.role);
    await s.ready;
    return win;
  }

  private async setContent(role: FloatRole, content: unknown): Promise<void> {
    const s = this.slots[role];
    s.content = content;
    if (content === null) {
      if (!s.shown && !s.win) return;
      const win = await this.ensureWindow(s);
      win.webContents.send(IPC.floatContent, null);
      // Safety net: the renderer normally confirms the fade-out; never leave a window stuck on screen.
      if (s.hideTimer) clearTimeout(s.hideTimer);
      s.hideTimer = setTimeout(() => this.hide(s), HIDE_FALLBACK_MS);
      return;
    }
    if (s.hideTimer) {
      clearTimeout(s.hideTimer);
      s.hideTimer = null;
    }
    const win = await this.ensureWindow(s);
    if (s.content !== content) return; // superseded while the window was loading
    win.webContents.send(IPC.floatContent, content);
  }

  private hide(s: Slot): void {
    if (s.hideTimer) clearTimeout(s.hideTimer);
    s.hideTimer = null;
    if (s.content !== null) return; // shown again in the meantime
    s.shown = false;
    if (s.win && !s.win.isDestroyed()) s.win.hide();
  }

  private slotFor(e: IpcMainEvent | IpcMainInvokeEvent): Slot | null {
    for (const role of ['panel', 'toast', 'bar'] as const) {
      const s = this.slots[role];
      if (s.win && !s.win.isDestroyed() && s.win.webContents === e.sender) return s;
    }
    return null;
  }

  private async onSize(e: IpcMainInvokeEvent, raw: unknown): Promise<void> {
    const s = this.slotFor(e);
    if (!s || typeof raw !== 'object' || raw === null) return;
    const { width, height } = raw as { width?: unknown; height?: unknown };
    if (typeof width !== 'number' || typeof height !== 'number' || !(width > 0) || !(height > 0)) return;
    s.size = { width: Math.ceil(width), height: Math.ceil(height) };
    if (!this.layout) await new Promise<void>((r) => this.layoutWaiters.push(r)); // cannot be placed before the bubbles report where they are
    this.place(s, true);
    if (s.content !== null && s.win && !s.win.isDestroyed() && !s.shown) {
      s.shown = true;
      s.win.showInactive(); // content is still invisible (opacity 0) until the renderer sees this reply
    }
    if (s.role !== 'toast') this.place(this.slots.toast); // the toast stacks above the edit bar when both are visible
  }

  private onHidden(e: IpcMainEvent): void {
    const s = this.slotFor(e);
    if (s) this.hide(s);
  }

  private workArea(main: Rect): Rect {
    return screen.getDisplayNearestPoint({ x: Math.round(main.x + main.width / 2), y: Math.round(main.y + main.height / 2) }).workArea;
  }

  private place(s: Slot, force = false): void {
    if (!s.win || s.win.isDestroyed() || !s.size || !this.layout || (!s.shown && !force)) return;
    const main = this.opts.main();
    if (main.isDestroyed()) return;
    const mb = main.getContentBounds();
    const wa = this.workArea(mb);
    const stage = { x: mb.x + this.layout.stage.x, y: mb.y + this.layout.stage.y, width: this.layout.stage.width, height: this.layout.stage.height };
    const pad = FLOAT_PADDING[s.role];
    const content: Size = floatContentSize(s.size, pad);
    let pos = { x: 0, y: 0 };
    if (s.role === 'panel') {
      const b = this.layout.bubble;
      const bubbleBottom = b ? mb.y + b.y + b.height : stage.y + stage.height;
      pos = placePanel({ columnLeft: stage.x, columnRight: stage.x + stage.width, bubbleBottom, size: content, workArea: wa, gap: PANEL_GAP });
    } else if (s.role === 'bar') {
      pos = placeAbove({ stageRight: stage.x + stage.width, stageTop: stage.y, size: content, gap: BAR_GAP, workArea: wa });
    } else {
      const bar = this.slots.bar;
      const barTop = bar.shown && bar.win && !bar.win.isDestroyed() ? bar.win.getBounds().y + FLOAT_PADDING.bar : null;
      pos = placeAbove({ stageRight: stage.x + stage.width, stageTop: barTop ?? stage.y - TOAST_GAP, size: content, gap: barTop !== null ? TOAST_GAP : 0, workArea: wa });
    }
    s.win.setBounds(floatWindowBounds(pos, s.size, pad), false);
  }

  /** The floating windows created so far (they are created lazily). */
  windows(): BrowserWindow[] {
    const out: BrowserWindow[] = [];
    for (const role of ['panel', 'toast', 'bar'] as const) {
      const w = this.slots[role].win;
      if (w && !w.isDestroyed()) out.push(w);
    }
    return out;
  }

  destroy(): void {
    for (const role of ['panel', 'toast', 'bar'] as const) {
      const w = this.slots[role].win;
      if (w && !w.isDestroyed()) w.destroy();
    }
  }
}
