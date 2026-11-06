import type { ReactNode } from 'react';
import type { AgentInfo } from '../../shared/types';
import { AntigravityMark, ArgonMark, Burst, ClaudeMark, CodexMark, GenericMark } from './logos';

/**
 * Renderer-side registry: how each agent's logo is drawn.
 * Adding an agent = add its provider in the main process and its logo here.
 * Brand colours come from the provider's AgentInfo.
 */
type LogoFactory = (size: number, agent: AgentInfo) => ReactNode;

const LOGOS: Record<string, LogoFactory> = {
  claude: (size) => <ClaudeMark size={size} />,
  codex: (size) => <CodexMark size={size} />,
  antigravity: (size) => <AntigravityMark size={size} />,
  'antigravity:gemini': (size) => <AntigravityMark size={size} />,
  'antigravity:argon': (size) => <ArgonMark size={size} />,
  'antigravity:3p': (size) => <ClaudeMark size={size} />,
};

export function renderLogo(agent: AgentInfo, size: number): ReactNode {
  return (LOGOS[agent.id] ?? ((s, a) => <GenericMark color={a.brandLight} size={s} />))(size, agent);
}
