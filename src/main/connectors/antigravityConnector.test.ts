import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AntigravityConnector } from './antigravityConnector';
import { toPosixPath } from './settingsEdit';

let root: string;
let home: string;
let agyDir: string;
let settingsFile: string;
let widgetDir: string;
let hookFile: string;

const NOW = 1_700_000_000_000;
const make = (platform: NodeJS.Platform = 'win32') => new AntigravityConnector(home, { hookSource: '// fake hook\n', now: () => NOW, platform });

const PY = 'python C:\\Users\\Ana Maria\\.gemini\\antigravity-cli\\statusline.py';
const ORIGINAL =
  '{\n  "allowNonWorkspaceAccess": true,\n  "model": "gemini-3",\n  "statusLine": {\n    "type": "command",\n    "command": ' +
  JSON.stringify(PY) +
  ',\n    "enabled": true\n  },\n  "permissions": {\n    "allow": ["read"]\n  },\n  "trustedWorkspaces": ["C:\\\\work"]\n}\n';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'usage-widget-agy-'));
  home = join(root, 'home'); // no spaces: Windows needs an unquoted hook path (see the refusal tests)
  agyDir = join(home, '.gemini', 'antigravity-cli');
  settingsFile = join(agyDir, 'settings.json');
  widgetDir = join(agyDir, 'usage-widget');
  hookFile = join(widgetDir, 'hook.js');
  mkdirSync(agyDir, { recursive: true });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const readSettings = () => JSON.parse(readFileSync(settingsFile, 'utf8')) as Record<string, any>;
const hookPart = () => `node ${toPosixPath(hookFile)} --agent antigravity`; // Windows form: no double quotes at all

describe('status', () => {
  it('no_agent_dir when ~/.gemini/antigravity-cli is missing', async () => {
    rmSync(agyDir, { recursive: true });
    expect(await make().status()).toBe('no_agent_dir');
  });
  it('not_connected without settings, with the user statusLine, or with unreadable settings', async () => {
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
    expect(p.after).toEqual({ type: 'command', command: hookPart(), enabled: true });
  });
  it('shows the wrap of the existing command and writes nothing', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    const p = await make().preview();
    expect(p.before).toEqual({ type: 'command', command: PY, enabled: true });
    expect(p.after).toEqual({ type: 'command', command: hookPart(), enabled: true });
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
    expect(readSettings()).toEqual({ statusLine: { type: 'command', command: hookPart(), enabled: true } });
    expect(readFileSync(hookFile, 'utf8')).toBe('// fake hook\n');
    expect(res.backupFile).toBeNull();
  });

  it('writes a command with no double quotes and keeps the user command off the line (Windows)', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    await make('win32').connect();
    const { command } = readSettings()['statusLine'];
    expect(command).toBe(hookPart());
    expect(command).not.toContain('"');
    expect(command).not.toContain('python');
  });

  it('saves the original command verbatim in connector.json, where the hook reads it', async () => {
    const original = 'python "C:\\Program Files\\x y\\statusline.py" --flag';
    writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: 'command', command: original } }));
    await make('win32').connect();
    const rec = JSON.parse(readFileSync(join(widgetDir, 'connector.json'), 'utf8'));
    expect(rec.originalStatusLine.command).toBe(original);
  });

  it('quotes the hook path for sh off Windows and still keeps the user command off the line', async () => {
    const spaced = join(root, 'my home');
    mkdirSync(join(spaced, '.gemini', 'antigravity-cli'), { recursive: true });
    writeFileSync(join(spaced, '.gemini', 'antigravity-cli', 'settings.json'), ORIGINAL);
    await new AntigravityConnector(spaced, { hookSource: '//', now: () => NOW, platform: 'linux' }).connect();
    const { command } = JSON.parse(readFileSync(join(spaced, '.gemini', 'antigravity-cli', 'settings.json'), 'utf8')).statusLine;
    expect(command).toBe(`node "${toPosixPath(join(spaced, '.gemini', 'antigravity-cli', 'usage-widget', 'hook.js'))}" --agent antigravity`);
  });

  it('refuses on Windows when the hook path has a space, before writing anything', async () => {
    const spaced = join(root, 'my home');
    const dir = join(spaced, '.gemini', 'antigravity-cli');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'settings.json'), ORIGINAL);
    const c = new AntigravityConnector(spaced, { hookSource: '//', now: () => NOW, platform: 'win32' });
    await expect(c.preview()).rejects.toMatchObject({ code: 'unsupported_path' });
    await expect(c.connect()).rejects.toMatchObject({ code: 'unsupported_path' });
    await expect(c.connect()).rejects.toThrow(/spaces or special characters/);
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(ORIGINAL);
    expect(existsSync(join(dir, 'usage-widget'))).toBe(false);
  });

  it('keeps every other key, its value and the key order', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    await make().connect();
    const before = JSON.parse(ORIGINAL) as Record<string, unknown>;
    const after = readSettings();
    expect(Object.keys(after)).toEqual(Object.keys(before));
    for (const key of Object.keys(before)) if (key !== 'statusLine') expect(after[key]).toEqual(before[key]);
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
    expect(rec.originalStatusLine).toEqual({ type: 'command', command: PY, enabled: true });
  });

  it('is idempotent: a second connect changes nothing and never double wraps', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    const c = make();
    await c.connect();
    const afterFirst = readFileSync(settingsFile, 'utf8');
    const res = await c.connect();
    expect(res.changed).toBe(false);
    expect(readFileSync(settingsFile, 'utf8')).toBe(afterFirst);
    expect(afterFirst.match(/hook\.js/g)).toHaveLength(1);
    expect(readdirSync(join(widgetDir, 'backup'))).toHaveLength(1);
  });

  it('refuses invalid settings.json and leaves everything untouched', async () => {
    writeFileSync(settingsFile, '{"statusLine": ');
    await expect(make().connect()).rejects.toMatchObject({ code: 'invalid_settings' });
    expect(readFileSync(settingsFile, 'utf8')).toBe('{"statusLine": ');
    expect(existsSync(widgetDir)).toBe(false);
  });

  it('refuses when the Antigravity folder does not exist and creates nothing', async () => {
    rmSync(agyDir, { recursive: true });
    await expect(make().connect()).rejects.toMatchObject({ code: 'no_agent_dir' });
    expect(existsSync(agyDir)).toBe(false);
  });

  it('does not touch the other files in the folder (statusline.py, statusline_debug.json)', async () => {
    writeFileSync(join(agyDir, 'statusline.py'), 'print("hi")');
    writeFileSync(join(agyDir, 'statusline_debug.json'), '{"email":"x"}');
    writeFileSync(settingsFile, ORIGINAL);
    await make().connect();
    expect(readFileSync(join(agyDir, 'statusline.py'), 'utf8')).toBe('print("hi")');
    expect(readFileSync(join(agyDir, 'statusline_debug.json'), 'utf8')).toBe('{"email":"x"}');
    expect(readdirSync(agyDir).sort()).toEqual(['settings.json', 'statusline.py', 'statusline_debug.json', 'usage-widget']);
  });

  it('leaves no temp files behind', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    await make().connect();
    expect(readdirSync(agyDir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('refreshes hook.js via updateHook only while connected', async () => {
    const c = make();
    await c.connect();
    writeFileSync(hookFile, 'stale');
    await c.updateHook();
    expect(readFileSync(hookFile, 'utf8')).toBe('// fake hook\n');
    await c.disconnect();
    writeFileSync(hookFile, 'leftover');
    await c.updateHook();
    expect(readFileSync(hookFile, 'utf8')).toBe('leftover');
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

  it('keeps a setting the user changed after connecting and restores only the statusLine', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    const c = make();
    await c.connect();
    const s = readSettings();
    s['model'] = 'changed-later';
    writeFileSync(settingsFile, JSON.stringify(s, null, 2) + '\n');
    expect((await c.disconnect()).changed).toBe(true);
    expect(readSettings()).toEqual({ ...JSON.parse(ORIGINAL), model: 'changed-later' });
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
    expect((await make().disconnect()).changed).toBe(false);
    expect(readFileSync(settingsFile, 'utf8')).toBe(ORIGINAL);
  });

  it('does not clobber a statusLine the user changed after connecting', async () => {
    writeFileSync(settingsFile, ORIGINAL);
    const c = make();
    await c.connect();
    const s = readSettings();
    s['statusLine'] = { type: 'command', command: 'my-other-thing' };
    writeFileSync(settingsFile, JSON.stringify(s, null, 2) + '\n');
    expect((await c.disconnect()).changed).toBe(false);
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
