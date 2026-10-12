import { useEffect, useState } from 'react';
import type { UsageEntry } from '../../shared/types';

/** Re-renders every `ms` and returns the current time in epoch milliseconds. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Live list of detected agents pushed from the main process. */
export function useUsage(): UsageEntry[] {
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  useEffect(() => {
    let alive = true;
    void window.widget.getUsage().then((e) => alive && setEntries(e));
    const off = window.widget.onUsage((e) => setEntries(e));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return entries;
}
