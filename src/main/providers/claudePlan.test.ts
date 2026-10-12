import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeProvider } from './claude';
import { ClaudePlanReader, mapPlanLabel } from './claudePlan';

describe('mapPlanLabel', () => {
  it('claude_pro -> PRO (the only value verified against real data)', () => {
    expect(mapPlanLabel('claude_pro')).toBe('PRO');
  });
  it('max-like types -> MAX, without inventing 5x / 20x tiers', () => {
    expect(mapPlanLabel('claude_max')).toBe('MAX');
    expect(mapPlanLabel('Claude_Max_5x')).toBe('MAX');
    expect(mapPlanLabel('max')).toBe('MAX');
  });
  it('unknown, empty and non-string values give no badge', () => {
    for (const v of ['claude_team', 'claude_enterprise', 'free', 'pro', '', '   ', null, undefined, 42, {}, ['claude_pro']]) {
      expect(mapPlanLabel(v)).toBeUndefined();
    }
  });
});

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'usage-widget-plan-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const file = () => join(home, '.claude.json');
/** Synthetic account file: includes fields that must never be exposed. */
const account = (organizationType: unknown) =>
  JSON.stringify({
    userID: 'synthetic-user-id',
    oauthAccount: { emailAddress: 'someone@example.invalid', displayName: 'Synthetic Person', organizationType },
    projects: { '/some/project': { history: ['secret prompt'] } },
  });

describe('ClaudePlanReader', () => {
  it('reads claude_pro as PRO', async () => {
    writeFileSync(file(), account('claude_pro'));
    expect(await new ClaudePlanReader(home).read()).toBe('PRO');
  });
  it('reads a max-like type as MAX', async () => {
    writeFileSync(file(), account('claude_max'));
    expect(await new ClaudePlanReader(home).read()).toBe('MAX');
  });
  it('unknown type -> no badge', async () => {
    writeFileSync(file(), account('claude_something_new'));
    expect(await new ClaudePlanReader(home).read()).toBeUndefined();
  });
  it('missing file, invalid JSON, partial file and absent field never throw', async () => {
    const r = new ClaudePlanReader(home);
    expect(await r.read()).toBeUndefined(); // missing
    writeFileSync(file(), '{"oauthAccount":{"organizationType":"claude_p');
    expect(await new ClaudePlanReader(home).read()).toBeUndefined(); // partially written
    writeFileSync(file(), 'not json at all');
    expect(await new ClaudePlanReader(home).read()).toBeUndefined();
    writeFileSync(file(), JSON.stringify({ userID: 'x' }));
    expect(await new ClaudePlanReader(home).read()).toBeUndefined(); // field absent
    writeFileSync(file(), JSON.stringify({ oauthAccount: 'oops' }));
    expect(await new ClaudePlanReader(home).read()).toBeUndefined();
    writeFileSync(file(), '[1,2,3]');
    expect(await new ClaudePlanReader(home).read()).toBeUndefined();
  });
  it('tolerates a UTF-8 BOM', async () => {
    writeFileSync(file(), '﻿' + account('claude_pro'));
    expect(await new ClaudePlanReader(home).read()).toBe('PRO');
  });

  it('caches by mtime and size: the file is not re-read or re-parsed while unchanged', async () => {
    writeFileSync(file(), account('claude_pro'));
    let reads = 0;
    const r = new ClaudePlanReader(home, {
      readText: async (f) => {
        reads++;
        return (await import('node:fs/promises')).readFile(f, 'utf8');
      },
    });
    expect(await r.read()).toBe('PRO');
    expect(await r.read()).toBe('PRO');
    expect(await r.read()).toBe('PRO');
    expect(reads).toBe(1);

    writeFileSync(file(), account('claude_max'));
    const t = new Date(Date.now() + 5000);
    utimesSync(file(), t, t);
    expect(await r.read()).toBe('MAX');
    expect(reads).toBe(2);
  });

  it('keeps the last known plan if the file becomes unreadable (e.g. being rewritten)', async () => {
    writeFileSync(file(), account('claude_pro'));
    const r = new ClaudePlanReader(home);
    expect(await r.read()).toBe('PRO');
    writeFileSync(file(), '{"oauthAccount":{');
    const t = new Date(Date.now() + 5000);
    utimesSync(file(), t, t);
    expect(await r.read()).toBe('PRO');
  });
});

describe('ClaudeProvider plan wiring', () => {
  const claudeDir = () => join(home, '.claude');
  const dump = (body: object) => {
    mkdirSync(join(claudeDir(), 'usage-widget'), { recursive: true });
    writeFileSync(join(claudeDir(), 'usage-widget', 'claude.json'), JSON.stringify(body));
  };

  it('carries the plan on a normal snapshot', async () => {
    writeFileSync(file(), account('claude_pro'));
    dump({ rate_limits: { five_hour: { used_percentage: 12, resets_at: 1_800_000_000 } } });
    const snap = await new ClaudeProvider(home).read();
    expect(snap?.plan).toBe('PRO');
    expect(snap?.windows.map((w) => w.minutes)).toEqual([300, 10080]);
  });

  it('shows the plan before the first prompt: a snapshot with no windows and no claude.json', async () => {
    mkdirSync(claudeDir(), { recursive: true });
    writeFileSync(file(), account('claude_pro'));
    const snap = await new ClaudeProvider(home).read();
    expect(snap).toMatchObject({ agentId: 'claude', plan: 'PRO', windows: [] });
  });

  it('is still null when there is neither data nor a known plan', async () => {
    mkdirSync(claudeDir(), { recursive: true });
    expect(await new ClaudeProvider(home).read()).toBeNull();
    writeFileSync(file(), account('claude_something_new'));
    expect(await new ClaudeProvider(home).read()).toBeNull();
  });

  it('exposes nothing else from ~/.claude.json', async () => {
    mkdirSync(claudeDir(), { recursive: true });
    writeFileSync(file(), account('claude_pro'));
    const snap = await new ClaudeProvider(home).read();
    const text = JSON.stringify(snap);
    for (const secret of ['someone@example.invalid', 'Synthetic Person', 'synthetic-user-id', 'secret prompt', '/some/project']) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(snap ?? {}).sort()).toEqual(['agentId', 'plan', 'updatedAt', 'windows']);
  });
});
