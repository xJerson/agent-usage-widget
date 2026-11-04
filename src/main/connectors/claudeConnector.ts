import { homedir } from 'node:os';
import { StatusLineConnector, type ConnectorOptions } from './statusLineConnector';

export type { ConnectorOptions, ConnectResult } from './statusLineConnector';

/** Registers the widget's hook as Claude Code's statusLine command (~/.claude/settings.json). */
export class ClaudeConnector extends StatusLineConnector {
  constructor(home: string = homedir(), options: ConnectorOptions = {}) {
    super(home, { agentName: 'Claude Code', dirSegments: ['.claude'], style: {} }, options);
  }
}
