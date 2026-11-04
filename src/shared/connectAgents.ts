/** Agents that need a consented statusLine connector, with the copy the UI shows for each. */
export interface ConnectableAgent {
  /** Display name, e.g. in the tray menu and the consent caption. */
  name: string;
  /** Short name for the caption on the bubble ("Connect Claude?"). */
  caption: string;
  /** Where the hook and its data live, shown in "What changes?". */
  folder: string;
}

export const CONNECTABLE_AGENTS: Readonly<Record<string, ConnectableAgent>> = {
  claude: { name: 'Claude Code', caption: 'Claude', folder: '~/.claude/usage-widget' },
  antigravity: { name: 'Antigravity', caption: 'Antigravity', folder: '~/.gemini/antigravity-cli/usage-widget' },
};
