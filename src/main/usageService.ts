import { watch, type FSWatcher } from 'node:fs';
import type { UsageEntry, UsageProvider, UsageSnapshot } from '../shared/types';

export interface UsageServiceOptions {
  /** Full rescan (detect + read) period. Also the safety net when file watching misses events. */
  scanIntervalMs?: number;
  /** Debounce for file-system events. */
  debounceMs?: number;
  onError?: (message: string, error: unknown) => void;
}

type Listener = (entries: UsageEntry[]) => void;

/**
 * Registry + reconcile loop.
 *  - every `scanIntervalMs`: re-detect each provider and re-read the detected ones;
 *  - fs.watch on each detected provider's targets triggers a debounced re-read for near-real-time updates.
 * Listeners get the full list of detected agents whenever it changes.
 *
 * fs.watch (not chokidar) is enough here: we watch two directories, need no glob support,
 * Windows supports `recursive` natively, and the periodic rescan covers any missed event.
 */
export class UsageService {
  private readonly scanIntervalMs: number;
  private readonly debounceMs: number;
  private readonly onError: (message: string, error: unknown) => void;
  private readonly listeners = new Set<Listener>();
  private readonly lastGood = new Map<string, UsageSnapshot>();
  private readonly watchers = new Map<string, FSWatcher>();
  private entries: UsageEntry[] = [];
  private lastJson = '[]';
  private running: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly providers: readonly UsageProvider[],
    options: UsageServiceOptions = {},
  ) {
    this.scanIntervalMs = options.scanIntervalMs ?? 5000;
    this.debounceMs = options.debounceMs ?? 250;
    this.onError = options.onError ?? (() => undefined);
  }

  current(): UsageEntry[] {
    return this.entries;
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.scanIntervalMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }

  /** Re-detects and re-reads everything. Calls are serialised so scans never overlap. */
  refresh(): Promise<void> {
    this.running = this.running.then(() => this.scan()).catch((e) => this.onError('refresh failed', e));
    return this.running;
  }

  private async scan(): Promise<void> {
    const next: UsageEntry[] = [];
    const targets = new Map<string, boolean>();

    for (const provider of this.providers) {
      let detected = false;
      try {
        detected = await provider.detect();
      } catch (e) {
        this.onError(`detect failed for ${provider.id}`, e);
      }
      if (!detected) {
        this.lastGood.delete(provider.id);
        continue;
      }
      let snapshot: UsageSnapshot | null = null;
      try {
        snapshot = await provider.read();
      } catch (e) {
        this.onError(`read failed for ${provider.id}`, e);
      }
      if (snapshot) this.lastGood.set(provider.id, snapshot);
      else snapshot = this.lastGood.get(provider.id) ?? null;
      next.push({ agent: provider.info, snapshot });

      for (const t of provider.watchTargets()) targets.set(t, (targets.get(t) ?? false) || provider.watchRecursive === true);
    }

    if (!this.stopped) this.syncWatchers(targets);

    const json = JSON.stringify(next);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.entries = next;
    for (const l of this.listeners) l(next);
  }

  private syncWatchers(targets: Map<string, boolean>): void {
    for (const [target, w] of this.watchers) {
      if (!targets.has(target)) {
        w.close();
        this.watchers.delete(target);
      }
    }
    for (const [target, recursive] of targets) {
      if (this.watchers.has(target)) continue;
      try {
        const w = watch(target, { recursive, persistent: false }, () => this.schedule());
        w.on('error', () => {
          w.close();
          this.watchers.delete(target); // re-created by the next scan
        });
        this.watchers.set(target, w);
      } catch {
        /* target missing or not watchable: the periodic scan still covers it */
      }
    }
  }

  private schedule(): void {
    if (this.stopped || this.debounce) return;
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.refresh();
    }, this.debounceMs);
  }
}
