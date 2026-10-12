import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Maps `oauthAccount.organizationType` to a badge label.
 * Only "claude_pro" -> "PRO" is verified against real data. Anything containing "max" -> "MAX" (no 5x / 20x
 * distinction, which cannot be verified). Every other value gives no badge rather than a guess.
 */
export function mapPlanLabel(organizationType: unknown): string | undefined {
  if (typeof organizationType !== 'string') return undefined;
  const t = organizationType.trim().toLowerCase();
  if (!t) return undefined;
  if (t === 'claude_pro') return 'PRO';
  if (t.includes('max')) return 'MAX';
  return undefined;
}

export interface ClaudePlanReaderOptions {
  /** Test hook to count reads. */
  readText?: (file: string) => Promise<string>;
}

/**
 * Reads ONE field, `oauthAccount.organizationType`, from ~/.claude.json (the file in the home directory, not
 * the ~/.claude folder). Read-only. Nothing else in the file is kept or exposed: it is parsed, the single field is
 * extracted and the rest is dropped immediately. The credentials file is never opened.
 *
 * The result is cached by mtime + size so the (possibly large) file is not re-parsed on every 5s scan.
 * It never throws: a missing, invalid or half-written file keeps the last known plan.
 */
export class ClaudePlanReader {
  private readonly file: string;
  private readonly readText: (file: string) => Promise<string>;
  private key = '';
  private label: string | undefined;

  constructor(home: string = homedir(), options: ClaudePlanReaderOptions = {}) {
    this.file = join(home, '.claude.json');
    this.readText = options.readText ?? ((f) => readFile(f, 'utf8'));
  }

  async read(): Promise<string | undefined> {
    try {
      const info = await stat(this.file);
      const key = `${info.mtimeMs}:${info.size}`;
      if (key === this.key) return this.label;
      const raw = await this.readText(this.file);
      const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const label = extractLabel(text);
      if (label.ok) {
        this.key = key;
        this.label = label.value;
      }
      // not ok (unreadable / partial): keep the previous value and the old key, so the next scan tries again
      return this.label;
    } catch {
      return this.label; // missing file or I/O error
    }
  }
}

function extractLabel(text: string): { ok: boolean; value?: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: true, value: undefined };
  const account = (data as Record<string, unknown>)['oauthAccount'];
  if (typeof account !== 'object' || account === null || Array.isArray(account)) return { ok: true, value: undefined };
  return { ok: true, value: mapPlanLabel((account as Record<string, unknown>)['organizationType']) };
}
