import { app, Menu, nativeImage, Tray } from 'electron';
import type { ConnectorStatus } from '../shared/types';

/** Draws a small usage ring (coral arc over a dim track) as a raw BGRA bitmap, so no image asset is needed. */
function drawIcon(size: number): Electron.NativeImage {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const rOuter = size * 0.46;
  const rInner = size * 0.3;
  const fill = 0.72; // portion of the ring that is "used"
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      const cov = Math.max(0, Math.min(1, Math.min(rOuter - d, d - rInner) + 0.5));
      const dot = Math.max(0, Math.min(1, size * 0.1 - d + 0.5));
      const ang = (Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
      const used = ang / (2 * Math.PI) <= fill;
      const [r, g, b] = used ? [242, 176, 140] : [200, 196, 190];
      const a = Math.max(cov * (used ? 1 : 0.4), dot);
      const i = (y * size + x) * 4;
      buf[i] = b;
      buf[i + 1] = g;
      buf[i + 2] = r;
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: size / 16 });
}

export interface TrayActions {
  editLayout(): void;
  resetPosition(): void;
  connectClaude(): void;
  disconnectClaude(): void;
  connectorStatus(): ConnectorStatus;
}

function setOpenAtLogin(enabled: boolean): void {
  // Unpackaged runs register electron.exe together with the app path, otherwise login would not start the widget.
  app.setLoginItemSettings(
    app.isPackaged ? { openAtLogin: enabled } : { openAtLogin: enabled, path: process.execPath, args: [app.getAppPath()] },
  );
}

export function createTray(actions: TrayActions): { tray: Tray; refresh(): void } {
  const tray = new Tray(drawIcon(32));
  tray.setToolTip('Agent usage widget');
  const connectItems = (): Electron.MenuItemConstructorOptions[] => {
    const status = actions.connectorStatus();
    if (status === 'not_connected') return [{ label: 'Connect Claude Code…', click: actions.connectClaude }];
    if (status === 'connected') return [{ label: 'Disconnect Claude Code', click: actions.disconnectClaude }];
    return [];
  };
  const build = (): Electron.Menu =>
    Menu.buildFromTemplate([
      ...connectItems(),
      { label: 'Edit size and position', click: actions.editLayout },
      { label: 'Reset position', click: actions.resetPosition },
      {
        label: 'Start with Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          setOpenAtLogin(item.checked);
          tray.setContextMenu(build());
        },
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]);
  tray.setContextMenu(build());
  return { tray, refresh: () => tray.setContextMenu(build()) };
}
