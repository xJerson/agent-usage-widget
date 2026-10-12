import type { UsageProvider, UsageSnapshot } from '../shared/types';
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
      plan: id === 'codex' ? 'plus' : 'pro',
      windows: [
        { minutes: 300, usedPercent: Math.min(100, five), resetsAt: nowS + Math.round(2.2 * H) },
        { minutes: 10080, usedPercent: week, resetsAt: nowS + 3 * 24 * H },
      ],
      updatedAt: Date.now(),
    };
  };
}

export function createDemoProviders(): UsageProvider[] {
  const claude = simulated('claude', 20, 41, 0.9);
  const codex = simulated('codex', 62, 18, 0.6);
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
  ];
}
