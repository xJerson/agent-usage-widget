import { app, BrowserWindow, ipcMain, powerMonitor, screen, session, type IpcMainEvent } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IPC } from '../shared/ipc';
import { ConnectService, type ConnectAgent, type ConnectorLike } from './connectService';
import type { ConnectorStatus, ConnectorStatusEvent, ConnectPreview, ConnectPromptEvent } from '../shared/types';
import { AntigravityConnector } from './connectors/antigravityConnector';
import { ClaudeConnector } from './connectors/claudeConnector';
import { createDemoProviders } from './demo';
import { FloatWindows } from './floatWindows';
import { createProviders } from './providers';
import { watchTopmost } from './topmost';
import { createTray } from './tray';
import { UsageService } from './usageService';
import { WidgetController } from './widgetController';

const DEMO = process.env['USAGE_WIDGET_DEMO'] === '1';
// Test hook: point every ~/.claude / ~/.codex / ~/.gemini lookup at another directory (Electron itself does not start
// reliably with an overridden USERPROFILE on Windows).
const HOME_OVERRIDE = process.env['USAGE_WIDGET_HOME'] || undefined;
const SCREENSHOT = process.env['USAGE_WIDGET_SCREENSHOT'];
const DEBUG = DEMO || process.env['USAGE_WIDGET_DEBUG'] === '1' || Boolean(SCREENSHOT);

const log = (...args: unknown[]): void => {
  if (DEBUG) console.log('[usage-widget]', ...args);
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void main();
}

async function main(): Promise<void> {
  const userDataOverride = process.env['USAGE_WIDGET_USER_DATA'];
  if (userDataOverride) app.setPath('userData', userDataOverride);
  await app.whenReady();

  // Never grant any permission request; the widget needs none.
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  const win = new BrowserWindow({
    width: 200,
    height: 200,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  let floats: FloatWindows | null = null;
  const controller = new WidgetController(win, join(app.getPath('userData'), 'layout.json'), () => floats?.reposition());
  const service = new UsageService(DEMO ? createDemoProviders() : createProviders(HOME_OVERRIDE), {
    scanIntervalMs: DEMO ? 2000 : 5000,
    onError: (message, error) => log(message, error),
  });

  // Only accept IPC coming from our own window.
  const own = (e: IpcMainEvent): boolean => e.sender === win.webContents;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  floats = new FloatWindows({
    preload: join(__dirname, '../preload/index.js'),
    load: (w, role) => (rendererUrl ? w.loadURL(`${rendererUrl}?role=${role}`) : w.loadFile(join(__dirname, '../renderer/index.html'), { query: { role } })),
    main: () => win,
    onBarAnswer: (confirm) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.editAnswer, confirm);
    },
  });
  ipcMain.on(IPC.floatLayout, (e, layout: unknown) => own(e) && layout && floats?.setLayout(layout as never));
  ipcMain.on(IPC.floatPanel, (e, data: unknown) => own(e) && floats?.setPanel((data ?? null) as never));
  ipcMain.on(IPC.floatToast, (e, toast: unknown) => own(e) && toast && floats?.showToast(toast as never));
  ipcMain.on(IPC.floatBar, (e, state: unknown) => own(e) && floats?.setBar((state ?? null) as never));

  ipcMain.handle(IPC.usageGet, (e) => (e.sender === win.webContents ? service.current() : []));
  ipcMain.handle(IPC.layoutGet, (e) => ({ scale: e.sender === win.webContents ? controller.scale : 1 }));
  ipcMain.on(IPC.reportSize, (e, size: unknown) => {
    if (!own(e) || typeof size !== 'object' || size === null) return;
    const { width, height } = size as { width?: unknown; height?: unknown };
    if (num(width) && num(height)) controller.reportSize({ width, height });
  });
  ipcMain.on(IPC.dragStart, (e) => own(e) && controller.dragStart());
  ipcMain.on(IPC.dragMove, (e, dx: unknown, dy: unknown) => own(e) && num(dx) && num(dy) && controller.dragMove(dx, dy));
  ipcMain.on(IPC.dragEnd, (e) => own(e) && controller.dragEnd());
  ipcMain.on(IPC.setScale, (e, scale: unknown) => own(e) && num(scale) && controller.setScale(scale));
  ipcMain.on(IPC.editBegin, (e) => own(e) && controller.editBegin());
  ipcMain.on(IPC.editEnd, (e, confirm: unknown) => own(e) && controller.editEnd(confirm === true));

  // Agent connectors (disabled in demo mode so simulated runs never touch ~/.claude, ~/.gemini or persist consent state).
  const send = (channel: string, payload: unknown): void => {
    if (channel === IPC.toast) floats?.showToast(payload as never); // toasts live in their own window
    else if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };
  // Each service reports for one agent; connector events carry the agent id so the renderer can tell them apart.
  const sendFor =
    (agentId: string) =>
    (channel: string, payload: unknown): void => {
      if (channel === IPC.connectPrompt) send(channel, { agentId, preview: payload as ConnectPreview } satisfies ConnectPromptEvent);
      else if (channel === IPC.connectorStatus) send(channel, { agentId, status: payload as ConnectorStatus } satisfies ConnectorStatusEvent);
      else send(channel, payload);
    };
  const stateFile = join(app.getPath('userData'), 'app-state.json');
  const agents: Array<{ agent: ConnectAgent; connector: ConnectorLike }> = DEMO
    ? []
    : [
        { agent: { id: 'claude', name: 'Claude Code' }, connector: new ClaudeConnector(HOME_OVERRIDE) },
        { agent: { id: 'antigravity', name: 'Antigravity' }, connector: new AntigravityConnector(HOME_OVERRIDE) },
      ];
  const connectors = agents.map(({ agent, connector }) => ({ agent, service: new ConnectService(connector, stateFile, sendFor(agent.id), agent) }));
  const connect = new Map(connectors.map(({ agent, service }) => [agent.id, service]));
  ipcMain.handle(IPC.connectorGetStatus, (e) =>
    e.sender === win.webContents ? Object.fromEntries([...connect].map(([id, s]) => [id, s.status])) : {},
  );
  ipcMain.handle(IPC.connectPreviewGet, (e) =>
    e.sender === win.webContents ? Object.fromEntries([...connect].flatMap(([id, s]) => (s.currentPreview() ? [[id, s.currentPreview()]] : []))) : {},
  );
  ipcMain.on(IPC.connectAnswer, (e, agentId: unknown, accept: unknown) => {
    if (own(e) && typeof agentId === 'string') void connect.get(agentId)?.answer(accept === true);
  });

  service.onChange((entries) => {
    log('usage', entries.map((x) => `${x.agent.id}:${x.snapshot?.windows.map((w) => Math.round(w.usedPercent)).join('/') ?? '-'}`).join(' '));
    if (!win.isDestroyed()) win.webContents.send(IPC.usageUpdate, entries);
  });

  if (DEBUG) {
    win.webContents.on('console-message', (e) => log('renderer console:', e.message));
    win.webContents.on('did-fail-load', (_e, code, desc) => log('did-fail-load', code, desc));
    win.webContents.on('render-process-gone', (_e, details) => log('render-process-gone', details.reason));
  }

  if (rendererUrl) await win.loadURL(rendererUrl);
  else await win.loadFile(join(__dirname, '../renderer/index.html'));
  win.showInactive();

  const trayHandle = createTray({
    editLayout: () => controller.requestEdit(),
    resetPosition: () => controller.resetPosition(),
    connectors: () => connectors.map(({ agent, service }) => ({ agentId: agent.id, name: agent.name, status: service.status })),
    connect: (agentId) => void connect.get(agentId)?.requestPrompt(),
    disconnect: (agentId) => void connect.get(agentId)?.disconnect(),
  });
  for (const { service } of connectors) service.onStatusChange(() => trayHandle.refresh());
  await service.start();
  for (const { agent, service: s } of connectors) {
    await s.init().catch((e) => log(`${agent.id} connector init failed`, e));
    log(`${agent.id} connector status`, s.status);
  }
  log('started', DEMO ? '(demo)' : '');

  if (SCREENSHOT) {
    setTimeout(async () => {
      const image = await win.webContents.capturePage();
      writeFileSync(SCREENSHOT, image.toPNG());
      log('screenshot written', win.getBounds());
      app.quit();
    }, 5000);
  }

  const stopTopmost = watchTopmost({
    windows: () => [win, ...(floats?.windows() ?? [])],
    subscribe: (reassert) => {
      const onTopChanged = (_e: unknown, isOnTop: boolean): void => {
        if (!isOnTop) reassert();
      };
      powerMonitor.on('resume', reassert);
      powerMonitor.on('unlock-screen', reassert);
      screen.on('display-added', reassert);
      screen.on('display-removed', reassert);
      screen.on('display-metrics-changed', reassert);
      win.on('always-on-top-changed', onTopChanged);
      return () => {
        powerMonitor.off('resume', reassert);
        powerMonitor.off('unlock-screen', reassert);
        screen.off('display-added', reassert);
        screen.off('display-removed', reassert);
        screen.off('display-metrics-changed', reassert);
        if (!win.isDestroyed()) win.off('always-on-top-changed', onTopChanged);
      };
    },
    intervalMs: 30_000,
  });

  app.on('second-instance', () => {
    if (!win.isDestroyed()) win.showInactive();
  });
  app.on('before-quit', () => {
    stopTopmost();
    service.stop();
    floats?.destroy();
  });
  app.on('window-all-closed', () => app.quit());
}
