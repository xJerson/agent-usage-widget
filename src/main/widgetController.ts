import { BrowserWindow, screen } from 'electron';
import { clampAnchor, clampScale, defaultAnchor, windowBoundsFor } from '../shared/geometry';
import { IPC, WINDOW_PADDING } from '../shared/ipc';
import type { Point, Size } from '../shared/types';
import { loadLayout, saveLayout, type PersistedLayout } from './layoutStore';

/**
 * Owns the widget window: position, scale, size-to-content, drag and edit mode.
 *
 * The position is the "anchor": the bottom-right point of the widget content in screen coordinates.
 * The window is always content + transparent padding, pinned to that anchor, so when the content grows
 * (an open panel, the edit bar) it grows upward and leftward, exactly like the prototype.
 */
export class WidgetController {
  private layout: PersistedLayout;
  private content: Size = { width: 140, height: 140 };
  private dragOrigin: Point | null = null;
  private editBackup: { anchor: Point; scale: number } | null = null;
  private lastBounds = '';

  constructor(
    readonly window: BrowserWindow,
    private readonly layoutFile: string,
    /** Called after the window moved or resized, so floating windows can follow. */
    private readonly onBoundsChanged: () => void = () => undefined,
  ) {
    this.layout = loadLayout(layoutFile);
    const refit = () => this.apply();
    screen.on('display-metrics-changed', refit);
    screen.on('display-added', refit);
    screen.on('display-removed', refit);
    window.on('closed', () => {
      screen.off('display-metrics-changed', refit);
      screen.off('display-added', refit);
      screen.off('display-removed', refit);
    });
    this.apply();
  }

  get scale(): number {
    return this.layout.scale;
  }

  /** Where the content's bottom-right corner is right now, clamped to the work area of its display. */
  private effectiveAnchor(): Point {
    const home = this.layout.anchor ?? defaultAnchor(screen.getPrimaryDisplay().workArea);
    const probe = { x: Math.round(home.x) - 1, y: Math.round(home.y) - 1 };
    const workArea = screen.getDisplayNearestPoint(probe).workArea;
    return clampAnchor(home, this.content, workArea);
  }

  private apply(): void {
    if (this.window.isDestroyed()) return;
    const bounds = windowBoundsFor(this.effectiveAnchor(), this.content, WINDOW_PADDING);
    const key = `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`;
    if (key === this.lastBounds) return;
    this.lastBounds = key;
    this.window.setBounds(bounds, false);
    this.onBoundsChanged();
  }

  private persist(): void {
    saveLayout(this.layoutFile, { anchor: this.effectiveAnchor(), scale: this.layout.scale });
  }

  private pushLayout(): void {
    if (!this.window.isDestroyed()) this.window.webContents.send(IPC.layoutChanged, { scale: this.layout.scale });
  }

  reportSize(size: Size): void {
    if (size.width < 1 || size.height < 1) return;
    this.content = { width: Math.ceil(size.width), height: Math.ceil(size.height) };
    this.apply();
  }

  dragStart(): void {
    this.dragOrigin = this.effectiveAnchor();
  }

  dragMove(dx: number, dy: number): void {
    if (!this.dragOrigin) return;
    const target = { x: this.dragOrigin.x + dx, y: this.dragOrigin.y + dy };
    const probe = { x: Math.round(target.x) - 1, y: Math.round(target.y) - 1 };
    const workArea = screen.getDisplayNearestPoint(probe).workArea;
    this.layout.anchor = clampAnchor(target, this.content, workArea);
    this.apply();
  }

  dragEnd(): void {
    if (!this.dragOrigin) return;
    this.dragOrigin = null;
    this.layout.anchor = this.effectiveAnchor();
    if (!this.editBackup) this.persist();
  }

  setScale(scale: number): void {
    this.layout.scale = clampScale(scale);
  }

  editBegin(): void {
    if (this.editBackup) return;
    this.editBackup = { anchor: this.effectiveAnchor(), scale: this.layout.scale };
  }

  editEnd(confirm: boolean): void {
    const backup = this.editBackup;
    if (!backup) return;
    this.editBackup = null;
    if (confirm) {
      this.layout.anchor = this.effectiveAnchor();
      this.persist();
    } else {
      this.layout = { anchor: backup.anchor, scale: backup.scale };
      this.pushLayout();
    }
    this.apply();
  }

  resetPosition(): void {
    this.layout.anchor = null;
    this.persist();
    this.apply();
  }

  requestEdit(): void {
    if (!this.window.isDestroyed()) this.window.webContents.send(IPC.requestEdit);
  }
}
