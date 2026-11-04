import { CONNECTABLE_AGENTS } from './connectAgents';
import type { ConnectorStatus } from './types';

export const CONNECT_HINT = `Connect ${CONNECTABLE_AGENTS['claude']!.name} from the tray menu`;

/**
 * The tray hint for a connectable agent's panel. It only appears once the consent buttons are gone
 * (the user chose "Not now") and the agent is still not connected.
 */
export function connectHintFor(input: { agentId: string; status: ConnectorStatus; consentVisible: boolean }): string | null {
  const agent = CONNECTABLE_AGENTS[input.agentId];
  return agent && input.status === 'not_connected' && !input.consentVisible ? `Connect ${agent.name} from the tray menu` : null;
}
