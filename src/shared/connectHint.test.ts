import { describe, expect, it } from 'vitest';
import { CONNECT_HINT, connectHintFor } from './connectHint';

describe('connectHintFor', () => {
  it('shows only for Claude, when not connected and the consent buttons are NOT visible', () => {
    expect(connectHintFor({ agentId: 'claude', status: 'not_connected', consentVisible: false })).toBe(CONNECT_HINT);
  });
  it('is hidden while the consent buttons are visible', () => {
    expect(connectHintFor({ agentId: 'claude', status: 'not_connected', consentVisible: true })).toBeNull();
  });
  it('is hidden once connected, when Claude is absent, or for other agents', () => {
    expect(connectHintFor({ agentId: 'claude', status: 'connected', consentVisible: false })).toBeNull();
    expect(connectHintFor({ agentId: 'claude', status: 'no_claude_dir', consentVisible: false })).toBeNull();
    expect(connectHintFor({ agentId: 'codex', status: 'not_connected', consentVisible: false })).toBeNull();
  });
  it('appears after "Not now" (prompt dismissed, still not connected)', () => {
    const before = connectHintFor({ agentId: 'claude', status: 'not_connected', consentVisible: true });
    const after = connectHintFor({ agentId: 'claude', status: 'not_connected', consentVisible: false });
    expect([before, after]).toEqual([null, CONNECT_HINT]);
  });
});
