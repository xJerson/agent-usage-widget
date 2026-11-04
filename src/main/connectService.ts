import { IPC } from '../shared/ipc';
import type { ConnectorStatus, ConnectPreview, ToastMessage } from '../shared/types';
import { isPrompted, markPrompted } from './appState';

export interface ConnectorLike {
  status(): Promise<ConnectorStatus>;
  preview(): Promise<ConnectPreview>;
  connect(): Promise<{ changed: boolean; backupFile: string | null }>;
  disconnect(): Promise<{ changed: boolean }>;
  updateHook(): Promise<void>;
}

type Send = (channel: string, payload: unknown) => void;

export interface ConnectAgent {
  id: string;
  /** Shown in toasts, e.g. "Claude Code". */
  name: string;
}

/**
 * Orchestrates one agent's connection: one-time consent on its bubble, tray actions, toasts.
 * The consent buttons are shown at most once automatically; the flag is persisted the moment they are shown.
 */
export class ConnectService {
  status: ConnectorStatus = 'not_connected';
  private preview: ConnectPreview | null = null;
  private onStatus: (status: ConnectorStatus) => void = () => undefined;

  constructor(
    private readonly connector: ConnectorLike,
    private readonly stateFile: string,
    private readonly send: Send,
    private readonly agent: ConnectAgent = { id: 'claude', name: 'Claude Code' },
  ) {}

  /** Called whenever the status changes (the tray rebuilds its menu from it). */
  onStatusChange(cb: (status: ConnectorStatus) => void): void {
    this.onStatus = cb;
  }

  currentPreview(): ConnectPreview | null {
    return this.preview;
  }

  async init(): Promise<void> {
    await this.refreshStatus();
    if (this.status === 'connected') {
      await this.connector.updateHook().catch(() => undefined);
      return;
    }
    if (this.status === 'not_connected' && !isPrompted(this.stateFile, this.agent.id)) {
      await this.showPrompt(true);
    }
  }

  /** Tray: "Connect <agent>…" shows the buttons on the bubble again, without touching the one-time flag. */
  async requestPrompt(): Promise<void> {
    await this.refreshStatus();
    if (this.status === 'not_connected') await this.showPrompt(false);
  }

  private async showPrompt(persistFlag: boolean): Promise<void> {
    try {
      this.preview = await this.connector.preview();
    } catch (e) {
      this.toast(`Could not read ${this.agent.name} settings: ${(e as Error).message}`, 'error');
      return;
    }
    if (persistFlag) markPrompted(this.stateFile, this.agent.id);
    this.send(IPC.connectPrompt, this.preview);
  }

  async answer(accept: boolean): Promise<void> {
    this.preview = null;
    if (!accept) return;
    try {
      const res = await this.connector.connect();
      await this.refreshStatus();
      this.toast(res.changed ? `${this.agent.name} connected. Usage appears after your next prompt.` : `${this.agent.name} is already connected`);
    } catch (e) {
      this.toast(`Could not connect ${this.agent.name}: ${(e as Error).message}`, 'error');
    }
  }

  async disconnect(): Promise<void> {
    try {
      const res = await this.connector.disconnect();
      await this.refreshStatus();
      this.toast(res.changed ? `${this.agent.name} disconnected. Your statusLine was restored.` : 'Nothing to disconnect');
    } catch (e) {
      this.toast(`Could not disconnect ${this.agent.name}: ${(e as Error).message}`, 'error');
    }
  }

  private async refreshStatus(): Promise<void> {
    this.status = await this.connector.status();
    this.send(IPC.connectorStatus, this.status);
    this.onStatus(this.status);
  }

  private toast(message: string, kind: ToastMessage['kind'] = 'info'): void {
    this.send(IPC.toast, { message, kind } satisfies ToastMessage);
  }
}
