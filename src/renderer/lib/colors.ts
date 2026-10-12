import type { AgentInfo } from '../../shared/types';
import type { Level } from '../../shared/usage';

/** Status colours: brand below 70%, amber 70-90, red from 90. */
export function statusGradient(agent: AgentInfo, level: Level): [string, string] {
  if (level === 'ok') return [agent.brand, agent.brandLight];
  if (level === 'warn') return ['#e0a53c', '#f5cf7a'];
  return ['#e5484d', '#ff8a8e'];
}
