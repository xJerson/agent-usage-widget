import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAppState, saveAppState } from './appState';
import { ConnectService, type ConnectorLike } from './connectService';
import type { ConnectorStatus, ConnectPreview } from '../shared/types';

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'usage-widget-state-'));
  file = join(dir, 'app-state.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('appState', () => {
  it('defaults to not prompted and survives garbage', () => {
    expect(loadAppState(file)).toEqual({ connectPrompted: false });
    writeFileSync(file, '{oops');
    expect(loadAppState(file)).toEqual({ connectPrompted: false });
  });
  it('round-trips', () => {
    saveAppState(file, { connectPrompted: true });
    expect(loadAppState(file)).toEqual({ connectPrompted: true });
  });
});

const PREVIEW: ConnectPreview = { before: null, after: { type: 'command', command: 'node "x"' } };

function fakeConnector(status: ConnectorStatus): ConnectorLike & { calls: string[]; status_: ConnectorStatus; fail?: Error } {
  const c = {
    calls: [] as string[],
    status_: status,
    fail: undefined as Error | undefined,
    status: async () => c.status_,
    preview: async () => PREVIEW,
    connect: async () => {
      c.calls.push('connect');
      if (c.fail) throw c.fail;
      c.status_ = 'connected';
      return { changed: true, backupFile: null };
    },
    disconnect: async () => {
      c.calls.push('disconnect');
      c.status_ = 'not_connected';
      return { changed: true };
    },
    updateHook: async () => {
      c.calls.push('updateHook');
    },
  };
  return c;
}

function setup(status: ConnectorStatus, prompted = false) {
  saveAppState(file, { connectPrompted: prompted });
  const connector = fakeConnector(status);
  const sent: Array<[string, unknown]> = [];
  const svc = new ConnectService(connector, file, (channel, payload) => sent.push([channel, payload]));
  return { connector, sent, svc };
}

describe('ConnectService one-time prompt', () => {
  it('prompts on first launch when not connected and persists the flag immediately', async () => {
    const { svc, sent } = setup('not_connected');
    await svc.init();
    expect(sent.filter(([c]) => c === 'connect:prompt')).toHaveLength(1);
    expect(loadAppState(file).connectPrompted).toBe(true);
  });

  it('never prompts automatically again, whatever the earlier answer', async () => {
    const first = setup('not_connected');
    await first.svc.init();
    await first.svc.answer(false); // "Not now"
    const second = new ConnectService(fakeConnector('not_connected'), file, (c) => second_sent.push(c));
    const second_sent: string[] = [];
    await second.init();
    expect(second_sent.filter((c) => c === 'connect:prompt')).toHaveLength(0);
  });

  it('does not prompt when already connected or Claude is not installed, nor consume the flag', async () => {
    for (const status of ['connected', 'no_claude_dir'] as const) {
      const { svc, sent } = setup(status);
      await svc.init();
      expect(sent.some(([c]) => c === 'connect:prompt')).toBe(false);
      expect(loadAppState(file).connectPrompted).toBe(false);
    }
  });

  it('refreshes hook.js at startup when connected', async () => {
    const { svc, connector } = setup('connected', true);
    await svc.init();
    expect(connector.calls).toContain('updateHook');
  });
});

describe('ConnectService actions', () => {
  it('the pending preview is cleared after either answer (prompt dismissed)', async () => {
    for (const accept of [false, true]) {
      const { svc } = setup('not_connected');
      await svc.init();
      expect(svc.currentPreview()).not.toBeNull();
      await svc.answer(accept);
      expect(svc.currentPreview()).toBeNull();
    }
  });

  it('"Not now" changes nothing', async () => {
    const { svc, connector } = setup('not_connected');
    await svc.init();
    await svc.answer(false);
    expect(connector.calls).not.toContain('connect');
  });

  it('"Connect" connects, reports status and a success toast', async () => {
    const { svc, connector, sent } = setup('not_connected');
    await svc.init();
    await svc.answer(true);
    expect(connector.calls).toContain('connect');
    expect(sent).toContainEqual(['connector:status', 'connected']);
    expect(sent.some(([c, p]) => c === 'toast' && /connected/i.test((p as { message: string }).message))).toBe(true);
  });

  it('surfaces connect errors as an error toast and stays not connected', async () => {
    const { svc, connector, sent } = setup('not_connected');
    connector.fail = new Error('settings.json is not valid JSON');
    await svc.init();
    await svc.answer(true);
    const toast = sent.filter(([c]) => c === 'toast').pop()?.[1] as { message: string; kind: string };
    expect(toast.kind).toBe('error');
    expect(toast.message).toMatch(/not valid JSON/);
    expect(svc.status).toBe('not_connected');
  });

  it('tray request shows the card even after the one-time prompt was used', async () => {
    const { svc, sent } = setup('not_connected', true);
    await svc.init();
    expect(sent.some(([c]) => c === 'connect:prompt')).toBe(false);
    await svc.requestPrompt();
    expect(sent.some(([c]) => c === 'connect:prompt')).toBe(true);
  });

  it('disconnect restores and reports', async () => {
    const { svc, connector, sent } = setup('connected', true);
    await svc.init();
    await svc.disconnect();
    expect(connector.calls).toContain('disconnect');
    expect(sent).toContainEqual(['connector:status', 'not_connected']);
    expect(readFileSync(file, 'utf8')).toContain('connectPrompted');
  });
});
