import type { ConnectorStatus } from './types';

export const CONNECT_HINT = 'Connect Claude Code from the tray menu';

/**
 * The tray hint for the Claude panel. It only appears once the consent buttons are gone
 * (the user chose "Not now") and Claude Code is still not connected.
 */
export function connectHintFor(input: { agentId: string; status: ConnectorStatus; consentVisible: boolean }): string | null {
  return input.agentId === 'claude' && input.status === 'not_connected' && !input.consentVisible ? CONNECT_HINT : null;
}
