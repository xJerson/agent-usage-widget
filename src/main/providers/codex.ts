import { existsSync } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentInfo, UsageProvider, UsageSnapshot } from '../../shared/types';
import { CODEX_ID, parseCodexRolloutTailDetailed, type Candidate } from './codexParser';

export const CODEX_INFO: AgentInfo = {
  id: CODEX_ID,
  name: 'Codex',
  planLabel: '',
  brand: '#7c86ff',
  brandLight: '#b4baff',
};

const TAIL_BYTES = 256 * 1024;
const MAX_ROLLOUTS = 8;
const RECENT_MS = 7 * 24 * 3_600_000;
const MAX_DIR_AGE_MS = 30 * 24 * 3_600_000;
const MAX_DIRS_VISITED = 45;
const MAX_FILES_STATTED = 300;
const ROLLOUT_RE = /^rollout-.*\.jsonl$/;

/** Lists numeric-named subdirectories, newest (largest) first. */
async function numericDirsDesc(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => Number(b) - Number(a));
  } catch {
    return [];
  }
}

export interface RolloutFile {
  file: string;
  mtimeMs: number;
}

/**
 * Rollouts modified within the last 7 days, most recently modified first (at most `limit`).
 * Date folders are walked newest-first and bounded, but ordering is by mtime, not by file name:
 * an older session that is still being written must be considered.
 */
export async function findRecentRollouts(sessionsDir: string, now: number, limit = MAX_ROLLOUTS): Promise<RolloutFile[]> {
  const found: RolloutFile[] = [];
  let visited = 0;
  let statted = 0;
  outer: for (const y of await numericDirsDesc(sessionsDir)) {
    for (const m of await numericDirsDesc(join(sessionsDir, y))) {
      for (const d of await numericDirsDesc(join(sessionsDir, y, m))) {
        const dirDate = Date.UTC(Number(y), Number(m) - 1, Number(d));
        if (now - dirDate > MAX_DIR_AGE_MS) break outer; // newest-first: everything after is older still
        if (++visited > MAX_DIRS_VISITED) break outer;
        const dayDir = join(sessionsDir, y, m, d);
        let names: string[] = [];
        try {
          names = (await readdir(dayDir)).filter((n) => ROLLOUT_RE.test(n));
        } catch {
          continue;
        }
        for (const n of names) {
          if (++statted > MAX_FILES_STATTED) break outer;
          const file = join(dayDir, n);
          try {
            const { mtimeMs } = await stat(file);
            if (now - mtimeMs <= RECENT_MS) found.push({ file, mtimeMs });
          } catch {
            /* vanished */
          }
        }
      }
    }
  }
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

async function readTail(file: string): Promise<{ text: string; truncatedStart: boolean; mtimeMs: number }> {
  const handle = await open(file, 'r');
  try {
    const { size, mtimeMs } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    if (length > 0) await handle.read(buffer, 0, length, start);
    return { text: buffer.toString('utf8'), truncatedStart: start > 0, mtimeMs };
  } finally {
    await handle.close();
  }
}

export interface CodexProviderOptions {
  now?: () => number;
}

/**
 * Reads rate limits from the token_count events Codex writes to its rollout files (read-only).
 * All sessions share the account limits, so the answer is the snapshot with the most recent EVENT timestamp
 * across the recently modified rollouts, not whatever the newest-named file says.
 */
export class CodexProvider implements UsageProvider {
  readonly info = CODEX_INFO;
  readonly id = CODEX_INFO.id;
  readonly name = CODEX_INFO.name;
  /** The whole sessions tree is watched, so a write in any date folder triggers a refresh. */
  readonly watchRecursive = true;
  private readonly sessionsDir: string;
  private readonly now: () => number;

  constructor(home: string = homedir(), options: CodexProviderOptions = {}) {
    this.sessionsDir = join(home, '.codex', 'sessions');
    this.now = options.now ?? Date.now;
  }

  async detect(): Promise<boolean> {
    return existsSync(this.sessionsDir);
  }

  async read(): Promise<UsageSnapshot | null> {
    const files = await findRecentRollouts(this.sessionsDir, this.now());
    let best: { c: Candidate; mtimeMs: number } | null = null;
    for (const { file, mtimeMs } of files) {
      let c: Candidate | null = null;
      try {
        const tail = await readTail(file);
        c = parseCodexRolloutTailDetailed(tail.text, { truncatedStart: tail.truncatedStart, fallbackUpdatedAt: Math.round(mtimeMs) });
      } catch {
        continue; // file rotated or locked
      }
      if (!c) continue;
      if (
        !best ||
        (c.preferred && !best.c.preferred) ||
        (c.preferred === best.c.preferred &&
          (c.snapshot.updatedAt > best.c.snapshot.updatedAt || (c.snapshot.updatedAt === best.c.snapshot.updatedAt && mtimeMs > best.mtimeMs)))
      ) {
        best = { c, mtimeMs };
      }
    }
    return best?.c.snapshot ?? null;
  }

  watchTargets(): string[] {
    return [this.sessionsDir];
  }
}
