import type { UsageProvider } from '../../shared/types';
import { ClaudeProvider } from './claude';
import { CodexProvider } from './codex';

/** Adding an agent = add its provider here and its logo to the renderer registry. */
export function createProviders(home?: string): UsageProvider[] {
  return [new ClaudeProvider(home), new CodexProvider(home)];
}
