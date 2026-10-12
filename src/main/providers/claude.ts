import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentInfo, UsageProvider, UsageSnapshot } from '../../shared/types';
import { CLAUDE_ID, ensureClaudeWindows, parseClaudeStatusline } from './claudeParser';
import { applyLimitOverlay, ClaudeLimitScanner } from './claudeLimit';
import { ClaudePlanReader } from './claudePlan';

export const CLAUDE_INFO: AgentInfo = {
  id: CLAUDE_ID,
  name: 'Claude Code',
  planLabel: '',
  brand: '#d97757',
  brandLight: '#f2b08c',
};

export interface ClaudeProviderOptions {
  /** Delay before re-reading a file that failed to parse (it may be mid-write). */
  retryDelayMs?: number;
  now?: () => number;
}

/**
 * Reads the JSON that Claude Code passes to a statusLine command, as dumped by the user's
 * statusline script into ~/.claude/usage-widget/claude.json (see README).
 */
export class ClaudeProvider implements UsageProvider {
  readonly info = CLAUDE_INFO;
  readonly id = CLAUDE_INFO.id;
  readonly name = CLAUDE_INFO.name;
  private readonly claudeDir: string;
  private readonly dataDir: string;
  private readonly dataFile: string;
  private readonly retryDelayMs: number;
  private readonly plan: ClaudePlanReader;
  private readonly limits: ClaudeLimitScanner;
  private readonly now: () => number;

  constructor(home: string = homedir(), options: ClaudeProviderOptions = {}) {
    this.claudeDir = join(home, '.claude');
    this.dataDir = join(this.claudeDir, 'usage-widget');
    this.dataFile = join(this.dataDir, 'claude.json');
    this.retryDelayMs = options.retryDelayMs ?? 80;
    this.plan = new ClaudePlanReader(home);
    this.now = options.now ?? Date.now;
    this.limits = new ClaudeLimitScanner(home, { now: this.now });
  }

  async detect(): Promise<boolean> {
    return existsSync(this.claudeDir);
  }

  async read(): Promise<UsageSnapshot | null> {
    const [snapshot, plan, events] = await Promise.all([this.readUsage(), this.plan.read(), this.limits.scan()]);
    if (snapshot) {
      const windows = applyLimitOverlay(snapshot.windows, events, this.now());
      return { ...snapshot, windows, ...(plan ? { plan } : {}) };
    }
    // No usage dump yet (or half-written). A detected limit message still counts, and the plan badge is still shown.
    const overlaid = applyLimitOverlay(ensureClaudeWindows([]), events, this.now());
    const hasLimit = overlaid.some((w) => w.limitReached);
    if (hasLimit) return { agentId: CLAUDE_ID, ...(plan ? { plan } : {}), windows: overlaid, updatedAt: this.now() };
    return plan ? { agentId: CLAUDE_ID, plan, windows: [], updatedAt: 0 } : null;
  }

  private async readUsage(): Promise<UsageSnapshot | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [raw, info] = await Promise.all([readFile(this.dataFile, 'utf8'), stat(this.dataFile)]);
        const snapshot = parseClaudeStatusline(raw, Math.round(info.mtimeMs));
        if (snapshot) return { ...snapshot, windows: ensureClaudeWindows(snapshot.windows) };
      } catch {
        return null; // missing file or unreadable: nothing to show yet
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, this.retryDelayMs));
    }
    return null;
  }

  watchTargets(): string[] {
    // Watch the data dir once it exists; before that, watch ~/.claude so its creation is noticed.
    return [existsSync(this.dataDir) ? this.dataDir : this.claudeDir];
  }
}
