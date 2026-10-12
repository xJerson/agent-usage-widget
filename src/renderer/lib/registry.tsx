import type { ReactNode } from 'react';
import type { AgentInfo } from '../../shared/types';
import { Burst, CodexMark, GenericMark } from './logos';

/**
 * Renderer-side registry: how each agent's logo is drawn.
 * Adding an agent = add its provider in the main process and its logo here.
 * Brand colours come from the provider's AgentInfo.
 */
type LogoFactory = (size: number, agent: AgentInfo) => ReactNode;

const LOGOS: Record<string, LogoFactory> = {
  claude: (size) => <Burst color="#d97757" size={size} />,
  codex: (size) => <CodexMark color="#9aa2ff" size={size} />,
};

export function renderLogo(agent: AgentInfo, size: number): ReactNode {
  return (LOGOS[agent.id] ?? ((s, a) => <GenericMark color={a.brandLight} size={s} />))(size, agent);
}
