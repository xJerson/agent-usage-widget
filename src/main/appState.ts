import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AppState {
  /** True once the Claude Code consent buttons have been shown; they never reappear automatically. */
  connectPrompted: boolean;
}

/** Claude keeps its original flag; every other agent is listed in `promptedAgents`. */
const LEGACY_AGENT = 'claude';

function readRaw(file: string): Record<string, unknown> {
  try {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeRaw(file: string, state: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state), 'utf8');
  } catch {
    /* best effort */
  }
}

export function loadAppState(file: string): AppState {
  return { connectPrompted: readRaw(file)['connectPrompted'] === true };
}

/** Keys this function does not own (other agents' consent flags) are kept. */
export function saveAppState(file: string, state: AppState): void {
  writeRaw(file, { ...readRaw(file), ...state });
}

/** True once the consent buttons were shown for this agent. */
export function isPrompted(file: string, agentId: string): boolean {
  const raw = readRaw(file);
  if (agentId === LEGACY_AGENT) return raw['connectPrompted'] === true;
  const list = raw['promptedAgents'];
  return Array.isArray(list) && list.includes(agentId);
}

export function markPrompted(file: string, agentId: string): void {
  const raw = readRaw(file);
  if (agentId === LEGACY_AGENT) {
    writeRaw(file, { ...raw, connectPrompted: true });
    return;
  }
  const list = Array.isArray(raw['promptedAgents']) ? (raw['promptedAgents'] as unknown[]) : [];
  if (!list.includes(agentId)) writeRaw(file, { ...raw, promptedAgents: [...list, agentId] });
}
