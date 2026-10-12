import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeConnector } from './claudeConnector';
import { buildCommand, toPosixPath } from './settingsEdit';

let root: string;
let home: string;
let claudeDir: string;
let settingsFile: string;
let widgetDir: string;
let hookFile: string;

const NOW = 1_700_000_000_000;
const make = () => new ClaudeConnector(home, { hookSource: '// fake hook\n', now: () => NOW });

const ORIGINAL =
  '{\n  "model": "opus",\n  "statusLine": {\n    "type": "command",\n    "command": "bash ~/.claude/statusline-command.sh",\n    "padding": 0\n  },\n  "env": {\n    "A": "1"\n  }\n}\n';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'usage-widget-conn-'));
  home = join(root, 'home dir'); // spaces on purpose
  claudeDir = join(home, '.claude');
  settingsFile = join(claudeDir, 'settings.json');
  widgetDir = join(claudeDir, 'usage-widget');
  hookFile = join(widgetDir, 'hook.js');
  mkdirSync(claudeDir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const readSettings = () => JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, any>;

describe('status', () => {
  it('no_claude_dir when ~/.claude is missing', async () => {
    rmSync(claudeDir, { recursive: true });
    expect(await make().status()).toBe('no_claude_dir');
  });
  it('not_connected without settings, with other statusLine, or with unreadable settings', async () => {
    expect(await make().status()).toBe('not_connected');
    writeFileSync(settingsFile, ORIGINAL);
    expect(await make().status()).toBe('not_connected');
    writeFileSync(settingsFile, '{broken');
    expect(await make().status()).toBe('not_connected');
  });
  it('connected after connect', async () => {
    const c = make();
    await c.connect();
    expect(await c.status()).toBe('connected');
  });
});

describe('preview', () => {
  it('shows before null and a bare hook command when there is no statusLine', async () => {
    writeFileSync(settingsFile, '{"model":"x"}');
    const p = await make().preview();
    expect(p.before).toBeNull();
    expect(p.after).toEqual({ type: 'command', command: buildCommand(hookFile, null) });
  });
  it('shows the wrap of an existing command and does not write anything', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    const p = await make().preview();
    expect(p.before).toEqual({ type: 'command', command: 'bash ~/.claude/statusline-command.sh', padding: 0 });
    expect(p.after).toEqual({
      type: 'command',
      command: buildCommand(hookFile, 'bash ~/.claude/statusline-command.sh'),
      padding: 0,
    });
    expect(readFileSync(settingsFile, 'utf8')).toBe(ORIGINAL);
    expect(existsSync(widgetDir)).toBe(false);
  });
  it('refuses when settings.json is invalid', async () => {
    writeFileSync(settingsFile, '{nope');
    await expect(make().preview()).rejects.toMatchObject({ code: 'invalid_settings' });
  });
});

describe('connect', () => {
  it('creates settings with a bare hook when there is no statusLine and no settings file', async () => {
    const res = await make().connect();
    expect(res.changed).toBe(true);
    expect(readSettings()).toEqual({ statusLine: { type: 'command', command: buildCommand(hookFile, null) } });
    expect(readFileSync(hookFile, 'utf8')).toBe('// fake hook\n');
    expect(res.backupFile).toBeNull();
  });

  it('wraps an existing statusLine, keeps every other key and key order', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    await make().connect();
    const s = readSettings();
    expect(Object.keys(s)).toEqual(['model', 'statusLine', 'env']);
    expect(s['model']).toBe('opus');
    expect(s['env']).toEqual({ A: '1' });
    expect(s['statusLine']).toEqual({
      type: 'command',
      command: `node "${toPosixPath(hookFile)}" --then "bash ~/.claude/statusline-command.sh"`,
      padding: 0,
    });
  });

  it('backs up settings.json before changing it', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    const res = await make().connect();
    const files = readdirSync(join(widgetDir, 'backup'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^settings\.2023-11-14T22-13-20-000Z\.json$/);
    expect(readFileSync(join(widgetDir, 'backup', files[0]!), 'utf8')).toBe(ORIGINAL);
    expect(res.backupFile).toBe(join(widgetDir, 'backup', files[0]!));
  });

  it('records the original statusLine verbatim in connector.json', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    await make().connect();
    const rec = JSON.parse(readFileSync(join(widgetDir, 'connector.json'), 'utf8'));
    expect(rec.originalStatusLine).toEqual({ type: 'command', command: 'bash ~/.claude/statusline-command.sh', padding: 0 });
  });

  it('is idempotent: a second connect changes nothing and never double wraps', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    const c = make();
    await c.connect();
    const afterFirst = readFileSync(settingsFile, 'utf8');
    const rec = readFileSync(join(widgetDir, 'connector.json'), 'utf8');
    const res = await c.connect();
    expect(res.changed).toBe(false);
    expect(readFileSync(settingsFile, 'utf8')).toBe(afterFirst);
    expect(readFileSync(join(widgetDir, 'connector.json'), 'utf8')).toBe(rec);
    expect(afterFirst.match(/hook\.js/g)).toHaveLength(1);
    expect(readdirSync(join(widgetDir, 'backup'))).toHaveLength(1);
  });

  it('refuses invalid settings.json and leaves everything untouched', async () => {
    writeFileSync(settingsFile, '{"statusLine": ');
    await expect(make().connect()).rejects.toMatchObject({ code: 'invalid_settings' });
    expect(readFileSync(settingsFile, 'utf8')).toBe('{"statusLine": ');
    expect(existsSync(widgetDir)).toBe(false);
  });

  it('refuses when ~/.claude does not exist', async () => {
    rmSync(claudeDir, { recursive: true });
    await expect(make().connect()).rejects.toMatchObject({ code: 'no_claude_dir' });
    expect(existsSync(claudeDir)).toBe(false);
  });

  it('tolerates a BOM and preserves it', async () => {
    writeFileSync(settingsFile, '﻿{\n  "model": "x"\n}\n');
    await make().connect();
    const text = readFileSync(settingsFile, 'utf8');
    expect(text.startsWith('﻿{')).toBe(true);
    expect(JSON.parse(text.slice(1)).model).toBe('x');
  });

  it('leaves no temp files behind', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    await make().connect();
    expect(readdirSync(claudeDir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('refreshes hook.js on every connected check via updateHook', async () => {
    const c = make();
    await c.connect();
    writeFileSync(hookFile, 'stale');
    await c.updateHook();
    expect(readFileSync(hookFile, 'utf8')).toBe('// fake hook\n');
  });
});

describe('disconnect', () => {
  it('restores the original settings byte for byte', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    const c = make();
    await c.connect();
    const res = await c.disconnect();
    expect(res.changed).toBe(true);
    expect(readFileSync(settingsFile, 'utf8')).toBe(ORIGINAL);
    expect(await c.status()).toBe('not_connected');
  });

  it('removes the statusLine key when there was none, keeping the rest', async () => {
    writeFileSync(settingsFile, '{\n  "model": "x"\n}\n');
    const c = make();
    await c.connect();
    await c.disconnect();
    expect(readFileSync(settingsFile, 'utf8')).toBe('{\n  "model": "x"\n}\n');
  });

  it('keeps the backups', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    const c = make();
    await c.connect();
    await c.disconnect();
    expect(readdirSync(join(widgetDir, 'backup'))).toHaveLength(1);
  });

  it('does nothing when not connected', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    const res = await make().disconnect();
    expect(res.changed).toBe(false);
    expect(readFileSync(settingsFile, 'utf8')).toBe(ORIGINAL);
  });

  it('does not clobber a statusLine the user changed after connecting', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    const c = make();
    await c.connect();
    const s = readSettings();
    s['statusLine'] = { type: 'command', command: 'my-other-thing' };
    writeFileSync(settingsFile, JSON.stringify(s, null, 2) + '\n');
    const res = await c.disconnect();
    expect(res.changed).toBe(false);
    expect(readSettings()['statusLine']).toEqual({ type: 'command', command: 'my-other-thing' });
  });

  it('refuses to guess when the restore record is missing', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    const c = make();
    await c.connect();
    rmSync(join(widgetDir, 'connector.json'));
    await expect(c.disconnect()).rejects.toMatchObject({ code: 'no_restore_info' });
  });
});
