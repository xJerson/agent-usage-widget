import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
  type CommandStyle,
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

/** What differs between agents; everything else (backup, wrap, restore) is shared. */
export interface ConnectorSpec {
  /** Shown in error messages, e.g. "Claude Code". */
  agentName: string;
  /** The agent's data folder relative to the home directory, e.g. ['.claude']. */
  dirSegments: string[];
  /** How the hook command is built (quoting, extra hook arguments). */
  style: CommandStyle;
  /** Extra fields for a statusLine entry that does not exist yet. */
  newEntryDefaults?: Record<string, unknown>;
  /**
   * Restore settings.json from the backup, byte for byte, on disconnect when it is still exactly what connect wrote.
   * Needed when the file contains structures JSON.stringify would reformat (e.g. inline arrays).
   */
  exactRestore?: boolean;
  /**
   * Keep the user's original command OFF the command line: the hook reads it from connector.json. For agents that
   * cannot run a command containing double quotes (agy escapes them, so node would receive literal quote characters).
   */
  originalInRecord?: boolean;
  /** Throws a ConnectorError when the hook path cannot be used in a command line this agent can run. */
  checkHookPath?(hookPath: string): void;
}

interface ConnectorRecord {
  version: 1;
  originalStatusLine: unknown;
  hookPath: string;
  connectedAt: number;
  backupFile: string | null;
  /** sha256 of the settings.json text connect wrote (only with `exactRestore`). */
  writtenHash?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Registers the widget's hook as an agent's statusLine command, wrapping any existing one.
 * Every path derives from the injected `home`, so tests never touch the real agent folders.
 */
export class StatusLineConnector {
  private readonly agentDir: string;
  private readonly settingsFile: string;
  private readonly widgetDir: string;
  readonly hookFile: string;
  private readonly recordFile: string;
  private readonly hookSource: string;
  private readonly now: () => number;

  constructor(
    home: string,
    private readonly spec: ConnectorSpec,
    options: ConnectorOptions = {},
  ) {
    this.agentDir = join(home, ...spec.dirSegments);
    this.settingsFile = join(this.agentDir, 'settings.json');
    this.widgetDir = join(this.agentDir, 'usage-widget');
    this.hookFile = join(this.widgetDir, 'hook.js');
    this.recordFile = join(this.widgetDir, 'connector.json');
    this.hookSource = options.hookSource ?? hookSourceDefault;
    this.now = options.now ?? Date.now;
  }

  private async load(): Promise<{ data: Record<string, unknown>; format: TextFormat; exists: boolean }> {
    if (!existsSync(this.agentDir)) {
      throw new ConnectorError('no_agent_dir', `${this.spec.agentName} was not found (no ~/${this.spec.dirSegments.join('/')} folder).`);
    }
    if (!existsSync(this.settingsFile)) return { data: {}, format: defaultFormat, exists: false };
    const { data, format } = parseSettingsText(await readFile(this.settingsFile, 'utf8'));
    return { data, format, exists: true };
  }

  private commandOf(statusLine: unknown): string | null {
    return isRecord(statusLine) && typeof statusLine['command'] === 'string' && statusLine['command'] ? statusLine['command'] : null;
  }

  /** The statusLine entry that results from connecting: the current one with our command, or a fresh one. */
  private wrapped(current: unknown, command: string | null): Record<string, unknown> {
    const base = isRecord(current) ? current : { ...this.spec.newEntryDefaults };
    return { ...base, type: 'command', command: buildCommand(this.hookFile, this.spec.originalInRecord ? null : command, this.spec.style) };
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
    if (!existsSync(this.agentDir)) return 'no_agent_dir';
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
    this.spec.checkHookPath?.(this.hookFile);
    return { before: current ?? null, after: this.wrapped(current, command) };
  }

  async connect(): Promise<ConnectResult> {
    const { data, format, exists } = await this.load();
    const current = data['statusLine'];
    const command = this.commandOf(current);
    if (isOurCommand(command, this.hookFile)) return { changed: false, backupFile: null };
    this.spec.checkHookPath?.(this.hookFile); // before anything is written

    let backupFile: string | null = null;
    await mkdir(join(this.widgetDir, 'backup'), { recursive: true });
    if (exists) {
      const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
      backupFile = join(this.widgetDir, 'backup', `settings.${stamp}.json`);
      await copyFile(this.settingsFile, backupFile);
    }
    await this.writeAtomic(this.hookFile, this.hookSource);

    data['statusLine'] = this.wrapped(current, command);
    const written = serializeSettings(data, format);

    const record: ConnectorRecord = {
      version: 1,
      originalStatusLine: current ?? null,
      hookPath: this.hookFile,
      connectedAt: this.now(),
      backupFile,
      ...(this.spec.exactRestore ? { writtenHash: sha256(written) } : {}),
    };
    await this.writeAtomic(this.recordFile, JSON.stringify(record, null, 2) + '\n');
    await this.writeAtomic(this.settingsFile, written);
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
    if (await this.restoreBackupVerbatim(record)) {
      await rm(this.recordFile, { force: true });
      return { changed: true };
    }
    if (record.originalStatusLine === null || record.originalStatusLine === undefined) delete data['statusLine'];
    else data['statusLine'] = record.originalStatusLine;
    await this.writeAtomic(this.settingsFile, serializeSettings(data, format));
    await rm(this.recordFile, { force: true });
    return { changed: true };
  }

  /** Only when settings.json is untouched since connect: then the backup IS the right restore, down to the byte. */
  private async restoreBackupVerbatim(record: ConnectorRecord): Promise<boolean> {
    if (!this.spec.exactRestore || !record.writtenHash || !record.backupFile) return false;
    try {
      const [current, backup] = await Promise.all([readFile(this.settingsFile, 'utf8'), readFile(record.backupFile, 'utf8')]);
      if (sha256(current) !== record.writtenHash) return false;
      await this.writeAtomic(this.settingsFile, backup);
      return true;
    } catch {
      return false;
    }
  }

  /** Keeps the installed hook.js current after an app update (only when connected). */
  async updateHook(): Promise<void> {
    if ((await this.status()) !== 'connected') return;
    await this.writeAtomic(this.hookFile, this.hookSource);
  }
}
