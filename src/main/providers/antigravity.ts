import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentInfo, UsageProvider, UsageSnapshot } from '../../shared/types';
import { ANTIGRAVITY_ID, ensureAntigravityWindows, parseAntigravityStatusline } from './antigravityParser';

export const ANTIGRAVITY_INFO: AgentInfo = {
  id: ANTIGRAVITY_ID,
  name: 'Antigravity',
  planLabel: '',
  brand: '#4E82EE',
  brandLight: '#A87FFB',
};

export interface AntigravityProviderOptions {
  /** Delay before re-reading a file that failed to parse (it may be mid-write). */
  retryDelayMs?: number;
}

/**
 * Reads the quota file the widget's hook keeps at ~/.gemini/antigravity-cli/usage-widget/antigravity.json (see
 * connectors/hook.js). That file holds only the two windows shown, the plan tier and a timestamp. The CLI's own files
 * (settings, credentials, statusline_debug.json) are never opened here.
 */
export class AntigravityProvider implements UsageProvider {
  readonly info = ANTIGRAVITY_INFO;
  readonly id = ANTIGRAVITY_INFO.id;
  readonly name = ANTIGRAVITY_INFO.name;
  private readonly agyDir: string;
  private readonly dataDir: string;
  private readonly dataFile: string;
  private readonly retryDelayMs: number;

  constructor(home: string = homedir(), options: AntigravityProviderOptions = {}) {
    this.agyDir = join(home, '.gemini', 'antigravity-cli');
    this.dataDir = join(this.agyDir, 'usage-widget');
    this.dataFile = join(this.dataDir, 'antigravity.json');
    this.retryDelayMs = options.retryDelayMs ?? 80;
  }

  async detect(): Promise<boolean> {
    return existsSync(this.agyDir);
  }

  async read(): Promise<UsageSnapshot | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [raw, info] = await Promise.all([readFile(this.dataFile, 'utf8'), stat(this.dataFile)]);
        const snapshot = parseAntigravityStatusline(raw, Math.round(info.mtimeMs));
        if (snapshot) return { ...snapshot, windows: ensureAntigravityWindows(snapshot.windows) };
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
          return null;
        }
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs));
          continue;
        }
        return null;
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, this.retryDelayMs));
    }
    return null;
  }

  watchTargets(): string[] {
    // Watch the data dir once it exists; before that, the CLI folder so its creation is noticed.
    return [existsSync(this.dataDir) ? this.dataDir : this.agyDir];
  }
}
