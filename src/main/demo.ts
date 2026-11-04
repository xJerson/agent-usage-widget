import type { UsageProvider, UsageSnapshot } from '../shared/types';
import { ANTIGRAVITY_INFO } from './providers/antigravity';
import { CLAUDE_INFO } from './providers/claude';
import { CODEX_INFO } from './providers/codex';

/**
 * Simulated agents for USAGE_WIDGET_DEMO=1. Never used in the normal path.
 * Usage creeps up over time (and wraps) so rings, colours and thresholds can be checked;
 * Codex disappears for a while every cycle so live add/remove can be checked too.
 */
const startedAt = Date.now();
const H = 3600;

function simulated(id: string, base5h: number, baseWeek: number, speed: number): () => UsageSnapshot {
  return () => {
    const t = (Date.now() - startedAt) / 1000;
    const nowS = Math.floor(Date.now() / 1000);
    const five = (base5h + t * speed) % 104;
    const week = (baseWeek + t * speed * 0.15) % 100;
    return {
      agentId: id,
      plan: id === 'codex' ? 'plus' : id === 'antigravity' ? 'Pro' : 'pro',
      windows: [
        { minutes: 300, usedPercent: Math.min(100, five), resetsAt: nowS + Math.round(2.2 * H) },
        { minutes: 10080, usedPercent: week, resetsAt: nowS + 3 * 24 * H },
      ],
      updatedAt: Date.now(),
    };
  };
}

function simulatedAntigravity(speed: number): () => UsageSnapshot {
  const base = simulated('antigravity', 8, 26, speed);
  return () => {
    const snap = base();
    const nowS = Math.floor(Date.now() / 1000);
    return {
      ...snap,
      windows: [
        { id: 'gemini-5h', label: 'Gemini · 5h', order: 1, minutes: 300, usedPercent: snap.windows[0]!.usedPercent, resetsAt: snap.windows[0]!.resetsAt },
        { id: 'gemini-weekly', label: 'Gemini · Weekly (7d)', order: 2, minutes: 10080, usedPercent: snap.windows[1]!.usedPercent, resetsAt: snap.windows[1]!.resetsAt },
        { id: 'gemini-argon-wtu-weekly', label: 'Gemini Argon · WTU Weekly', order: 3, minutes: 10080, usedPercent: 75, resetsAt: nowS + 4 * 24 * H },
        { id: '3p-5h', label: 'Third-party (3P) · 5h', order: 4, minutes: 300, usedPercent: 0, resetsAt: nowS + Math.round(1.5 * H) },
        { id: '3p-weekly', label: 'Third-party (3P) · Weekly (7d)', order: 5, minutes: 10080, usedPercent: 58, resetsAt: nowS + 2 * 24 * H },
      ],
    };
  };
}

export function createDemoProviders(): UsageProvider[] {
  const claude = simulated('claude', 20, 41, 0.9);
  const codex = simulated('codex', 62, 18, 0.6);
  const antigravity = simulatedAntigravity(0.4);
  return [
    {
      info: CLAUDE_INFO,
      id: CLAUDE_INFO.id,
      name: CLAUDE_INFO.name,
      detect: async () => true,
      read: async () => claude(),
      watchTargets: () => [],
    },
    {
      info: CODEX_INFO,
      id: CODEX_INFO.id,
      name: CODEX_INFO.name,
      // Present for 40s, gone for 10s, repeating.
      detect: async () => ((Date.now() - startedAt) / 1000) % 50 < 40,
      read: async () => codex(),
      watchTargets: () => [],
    },
    {
      info: ANTIGRAVITY_INFO,
      id: ANTIGRAVITY_INFO.id,
      name: ANTIGRAVITY_INFO.name,
      detect: async () => true,
      read: async () => antigravity(),
      watchTargets: () => [],
    },
  ];
}
