import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AppState {
  /** True once the Claude Code consent buttons have been shown; they never reappear automatically. */
  connectPrompted: boolean;
}

export function loadAppState(file: string): AppState {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    return { connectPrompted: raw['connectPrompted'] === true };
  } catch {
    return { connectPrompted: false };
  }
}

export function saveAppState(file: string, state: AppState): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state), 'utf8');
  } catch {
    /* best effort */
  }
}
