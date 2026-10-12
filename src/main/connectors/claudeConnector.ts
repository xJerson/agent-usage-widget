import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ConnectorStatus, ConnectPreview } from '../../shared/types';
import hookSourceDefault from './hook.js?raw';
import {
  buildCommand,
  ConnectorError,
  defaultFormat,
  isOurCommand,
  parseSettingsText,
  serializeSettings,
  type TextFormat,
} from './settingsEdit';

export interface ConnectorOptions {
  /** Hook script contents (defaults to the bundled hook.js). */
  hookSource?: string;
  now?: () => number;
}

export interface ConnectResult {
  changed: boolean;
  backupFile: string | null;
}

interface ConnectorRecord {
  version: 1;
  originalStatusLine: unknown;
  hookPath: string;
  connectedAt: number;
  backupFile: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Registers the widget's hook as Claude Code's statusLine command, wrapping any existing one.
 * Every path derives from the injected `home`, so tests never touch the real ~/.claude.
 */
export class ClaudeConnector {
  private readonly claudeDir: string;
  private readonly settingsFile: string;
  private readonly widgetDir: string;
  readonly hookFile: string;
  private readonly recordFile: string;
  private readonly hookSource: string;
  private readonly now: () => number;

  constructor(home: string = homedir(), options: ConnectorOptions = {}) {
    this.claudeDir = join(home, '.claude');
    this.settingsFile = join(this.claudeDir, 'settings.json');
    this.widgetDir = join(this.claudeDir, 'usage-widget');
    this.hookFile = join(this.widgetDir, 'hook.js');
    this.recordFile = join(this.widgetDir, 'connector.json');
    this.hookSource = options.hookSource ?? hookSourceDefault;
    this.now = options.now ?? Date.now;
  }

  private async load(): Promise<{ data: Record<string, unknown>; format: TextFormat; exists: boolean }> {
    if (!existsSync(this.claudeDir)) {
      throw new ConnectorError('no_claude_dir', 'Claude Code was not found (no ~/.claude folder).');
    }
    if (!existsSync(this.settingsFile)) return { data: {}, format: defaultFormat, exists: false };
    const { data, format } = parseSettingsText(await readFile(this.settingsFile, 'utf8'));
    return { data, format, exists: true };
  }

  private commandOf(statusLine: unknown): string | null {
    return isRecord(statusLine) && typeof statusLine['command'] === 'string' && statusLine['command'] ? statusLine['command'] : null;
  }

  private async writeAtomic(file: string, content: string): Promise<void> {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await writeFile(tmp, content, 'utf8');
      await rename(tmp, file);
    } catch (e) {
      await rm(tmp, { force: true });
      throw new ConnectorError('write_failed', `Could not write ${file}: ${(e as Error).message}`);
    }
  }

  async status(): Promise<ConnectorStatus> {
    if (!existsSync(this.claudeDir)) return 'no_claude_dir';
    try {
      const { data } = await this.load();
      return isOurCommand(this.commandOf(data['statusLine']), this.hookFile) ? 'connected' : 'not_connected';
    } catch {
      return 'not_connected';
    }
  }

  /** What would change in the statusLine entry. Writes nothing. */
  async preview(): Promise<ConnectPreview> {
    const { data } = await this.load();
    const current = data['statusLine'];
    const command = this.commandOf(current);
    if (isOurCommand(command, this.hookFile)) return { before: current, after: current };
    return {
      before: current ?? null,
      after: { ...(isRecord(current) ? current : {}), type: 'command', command: buildCommand(this.hookFile, command) },
    };
  }

  async connect(): Promise<ConnectResult> {
    const { data, format, exists } = await this.load();
    const current = data['statusLine'];
    const command = this.commandOf(current);
    if (isOurCommand(command, this.hookFile)) return { changed: false, backupFile: null };

    let backupFile: string | null = null;
    await mkdir(join(this.widgetDir, 'backup'), { recursive: true });
    if (exists) {
      const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
      backupFile = join(this.widgetDir, 'backup', `settings.${stamp}.json`);
      await copyFile(this.settingsFile, backupFile);
    }
    await this.writeAtomic(this.hookFile, this.hookSource);

    const record: ConnectorRecord = {
      version: 1,
      originalStatusLine: current ?? null,
      hookPath: this.hookFile,
      connectedAt: this.now(),
      backupFile,
    };
    await this.writeAtomic(this.recordFile, JSON.stringify(record, null, 2) + '\n');

    data['statusLine'] = { ...(isRecord(current) ? current : {}), type: 'command', command: buildCommand(this.hookFile, command) };
    await this.writeAtomic(this.settingsFile, serializeSettings(data, format));
    return { changed: true, backupFile };
  }

  async disconnect(): Promise<{ changed: boolean }> {
    const { data, format, exists } = await this.load();
    if (!exists || !isOurCommand(this.commandOf(data['statusLine']), this.hookFile)) return { changed: false };

    let record: ConnectorRecord;
    try {
      record = JSON.parse(await readFile(this.recordFile, 'utf8')) as ConnectorRecord;
    } catch {
      throw new ConnectorError(
        'no_restore_info',
        'The saved original statusLine is missing, so it cannot be restored automatically. Restore it from the backup folder.',
      );
    }
    if (record.originalStatusLine === null || record.originalStatusLine === undefined) delete data['statusLine'];
    else data['statusLine'] = record.originalStatusLine;
    await this.writeAtomic(this.settingsFile, serializeSettings(data, format));
    await rm(this.recordFile, { force: true });
    return { changed: true };
  }

  /** Keeps the installed hook.js current after an app update (only when connected). */
  async updateHook(): Promise<void> {
    if ((await this.status()) !== 'connected') return;
    await this.writeAtomic(this.hookFile, this.hookSource);
  }
}
