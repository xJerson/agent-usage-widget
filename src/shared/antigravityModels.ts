import type { AgentInfo, UsageEntry } from './types';

export const GEMINI_MODEL_AGENT: AgentInfo = {
  id: 'antigravity:gemini',
  name: 'Gemini',
  planLabel: 'Flash 3.8 & Pro',
  brand: '#4E82EE',
  brandLight: '#A87FFB',
};

export const ARGON_MODEL_AGENT: AgentInfo = {
  id: 'antigravity:argon',
  name: 'Argon 4',
  planLabel: 'Argon 4',
  brand: '#9333ea',
  brandLight: '#c084fc',
};

export const THIRD_PARTY_MODEL_AGENT: AgentInfo = {
  id: 'antigravity:3p',
  name: 'Claude / 3P',
  planLabel: 'Sonnet & OSS',
  brand: '#d97757',
  brandLight: '#f2b08c',
};

export interface SplitAntigravityResult {
  gemini: UsageEntry;
  argon: UsageEntry;
  thirdParty: UsageEntry;
}

/**
 * Splits a unified Antigravity UsageEntry into 3 distinct model-family entries:
 * 1. Gemini: Gemini 3.8 Flash & Pro (gemini-5h, gemini-weekly)
 * 2. Argon: Argon 4 reasoning tokens (gemini-argon-wtu-weekly)
 * 3. Third-party: Claude 3.5 Sonnet, Opus & OSS models (3p-5h, 3p-weekly)
 */
export function splitAntigravityEntry(agyEntry: UsageEntry): SplitAntigravityResult {
  const snap = agyEntry.snapshot;
  const windows = snap?.windows ?? [];

  const geminiWindows = windows.filter((w) => w.id === 'gemini-5h' || w.id === 'gemini-weekly');
  const argonWindows = windows.filter((w) => w.id === 'gemini-argon-wtu-weekly');
  const thirdPartyWindows = windows.filter((w) => w.id === '3p-5h' || w.id === '3p-weekly');

  return {
    gemini: {
      agent: GEMINI_MODEL_AGENT,
      snapshot: snap
        ? { ...snap, agentId: GEMINI_MODEL_AGENT.id, plan: GEMINI_MODEL_AGENT.planLabel, windows: geminiWindows }
        : null,
    },
    argon: {
      agent: ARGON_MODEL_AGENT,
      snapshot: snap
        ? { ...snap, agentId: ARGON_MODEL_AGENT.id, plan: ARGON_MODEL_AGENT.planLabel, windows: argonWindows }
        : null,
    },
    thirdParty: {
      agent: THIRD_PARTY_MODEL_AGENT,
      snapshot: snap
        ? {
            ...snap,
            agentId: THIRD_PARTY_MODEL_AGENT.id,
            plan: THIRD_PARTY_MODEL_AGENT.planLabel,
            windows: thirdPartyWindows,
          }
        : null,
    },
  };
}
