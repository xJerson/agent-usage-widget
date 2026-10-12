import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type WidgetApi } from '../shared/ipc';

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, payload: T): void => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

const api: WidgetApi = {
  getUsage: () => ipcRenderer.invoke(IPC.usageGet),
  onUsage: (cb) => subscribe(IPC.usageUpdate, cb),
  getLayout: () => ipcRenderer.invoke(IPC.layoutGet),
  onLayout: (cb) => subscribe(IPC.layoutChanged, cb),
  reportSize: (size) => ipcRenderer.send(IPC.reportSize, { width: size.width, height: size.height }),
  dragStart: () => ipcRenderer.send(IPC.dragStart),
  dragMove: (dx, dy) => ipcRenderer.send(IPC.dragMove, dx, dy),
  dragEnd: () => ipcRenderer.send(IPC.dragEnd),
  setScale: (scale) => ipcRenderer.send(IPC.setScale, scale),
  editBegin: () => ipcRenderer.send(IPC.editBegin),
  editEnd: (confirm) => ipcRenderer.send(IPC.editEnd, confirm === true),
  onRequestEdit: (cb) => subscribe<undefined>(IPC.requestEdit, () => cb()),
  getConnectorStatus: () => ipcRenderer.invoke(IPC.connectorGetStatus),
  onConnectorStatus: (cb) => subscribe(IPC.connectorStatus, cb),
  onConnectPrompt: (cb) => subscribe(IPC.connectPrompt, cb),
  getConnectPreview: () => ipcRenderer.invoke(IPC.connectPreviewGet),
  answerConnect: (accept) => ipcRenderer.send(IPC.connectAnswer, accept === true),
  floatLayout: (layout) => ipcRenderer.send(IPC.floatLayout, layout),
  floatPanel: (data) => ipcRenderer.send(IPC.floatPanel, data),
  floatToast: (toast) => ipcRenderer.send(IPC.floatToast, toast),
  floatBar: (state) => ipcRenderer.send(IPC.floatBar, state),
  barAnswer: (confirm) => ipcRenderer.send(IPC.barAnswer, confirm === true),
  onEditAnswer: (cb) => subscribe(IPC.editAnswer, cb),
  onFloatContent: (cb) => subscribe(IPC.floatContent, cb),
  floatSize: (size) => ipcRenderer.invoke(IPC.floatSize, { width: size.width, height: size.height }),
  floatHidden: () => ipcRenderer.send(IPC.floatHidden),
};

contextBridge.exposeInMainWorld('widget', api);
