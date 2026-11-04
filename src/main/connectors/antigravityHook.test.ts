import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AntigravityConnector } from './antigravityConnector';
import hookSource from './hook.js?raw';
import { toPosixPath } from './settingsEdit';

interface Merge {
  text: string | null;
  accepted: boolean;
}
const { mergeAntigravityPayload } = createRequire(import.meta.url)('./hook.js') as {
  mergeAntigravityPayload(stored: string | null, incoming: string, nowMs: number): Merge;
};

const NOW = Date.parse('2026-11-04T00:00:00Z');
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const bucket = (remaining: number, resetMs: number) => ({ remaining_fraction: remaining, reset_time: iso(resetMs) });
const R5 = NOW + 2 * H;
const R7 = NOW + 72 * H;

const EMAIL = 'someone.private@example.com';
const FULL = (quota: Record<string, unknown>) =>
  JSON.stringify({
    product: 'antigravity',
    version: '1.4.12',
    plan_tier: 'Google AI Pro',
    email: EMAIL,
    cwd: 'C:\\Users\\private\\secret-project',
    transcript_path: 'C:\\Users\\private\\.gemini\\transcript.jsonl',
    session_id: 'sess-123-private',
    conversation_title: 'My private conversation',
    quota,
  });
const stored = (m: Merge) => JSON.parse(m.text!) as { v: number; plan_tier?: string; quota: Record<string, { remaining_fraction: number; reset_time: string }>; updated_at: number };

describe('mergeAntigravityPayload', () => {
  it('without a stored file writes only the widget data: all quota windows, plan tier and a timestamp', () => {
    const m = mergeAntigravityPayload(null, FULL({ 'gemini-5h': bucket(0.9, R5), 'gemini-weekly': bucket(0.7, R7), '3p-5h': bucket(1, R5), 'gemini-argon-wtu-weekly': bucket(0.2, R7) }), NOW);
    expect(m.accepted).toBe(true);
    expect(JSON.parse(m.text!)).toEqual({
      v: 1,
      plan_tier: 'Google AI Pro',
      quota: { 'gemini-5h': bucket(0.9, R5), 'gemini-weekly': bucket(0.7, R7), '3p-5h': bucket(1, R5), 'gemini-argon-wtu-weekly': bucket(0.2, R7) },
      updated_at: NOW,
    });
  });

  it('never persists the email or any other field', () => {
    const m = mergeAntigravityPayload(null, FULL({ 'gemini-5h': bucket(0.9, R5) }), NOW);
    for (const secret of [EMAIL, 'someone.private', 'secret-project', 'transcript', 'sess-123', 'private conversation', 'cwd', 'email', '1.4.12']) {
      expect(m.text).not.toContain(secret);
    }
    expect(Object.keys(JSON.parse(m.text!)).sort()).toEqual(['plan_tier', 'quota', 'updated_at', 'v']);
  });

  it('does not copy extra fields from inside a bucket or a hostile plan tier', () => {
    const m = mergeAntigravityPayload(null, JSON.stringify({ plan_tier: 'x'.repeat(500), quota: { 'gemini-5h': { ...bucket(0.5, R5), owner: EMAIL, reset_in_seconds: 7 } } }), NOW);
    expect(m.text).not.toContain(EMAIL);
    expect(m.text).not.toContain('reset_in_seconds');
    expect(stored(m).plan_tier).toBeUndefined();
  });

  it('same window: the lower remaining fraction wins, so an older session cannot move usage backwards', () => {
    const s = mergeAntigravityPayload(null, FULL({ 'gemini-5h': bucket(0.6, R5), 'gemini-weekly': bucket(0.5, R7) }), NOW).text!;
    const m = mergeAntigravityPayload(s, FULL({ 'gemini-5h': bucket(0.8, R5), 'gemini-weekly': bucket(0.6, R7) }), NOW + 1000);
    expect(stored(m).quota['gemini-5h']!.remaining_fraction).toBe(0.6);
    expect(stored(m).quota['gemini-weekly']!.remaining_fraction).toBe(0.5);
    expect(m.accepted).toBe(false); // nothing new came from the incoming payload
  });

  it('same window with more usage takes the incoming value', () => {
    const s = mergeAntigravityPayload(null, FULL({ 'gemini-5h': bucket(0.6, R5) }), NOW).text!;
    const m = mergeAntigravityPayload(s, FULL({ 'gemini-5h': bucket(0.4, R5) }), NOW + 1000);
    expect(m.accepted).toBe(true);
    expect(stored(m).quota['gemini-5h']!.remaining_fraction).toBe(0.4);
    expect(stored(m).updated_at).toBe(NOW + 1000);
  });

  it('treats reset times a few seconds apart as the same window', () => {
    const s = mergeAntigravityPayload(null, FULL({ 'gemini-5h': bucket(0.6, R5) }), NOW).text!;
    const older = mergeAntigravityPayload(s, FULL({ 'gemini-5h': bucket(0.8, R5 - 6000) }), NOW + 1000);
    expect(stored(older).quota['gemini-5h']!.remaining_fraction).toBe(0.6);
    expect(older.accepted).toBe(false);
  });

  it('a later reset is a new window and takes the incoming one; an earlier reset is stale', () => {
    const s = mergeAntigravityPayload(null, FULL({ 'gemini-5h': bucket(0.1, R5) }), NOW).text!;
    const fresh = mergeAntigravityPayload(s, FULL({ 'gemini-5h': bucket(1, R5 + 5 * H) }), NOW + 1000);
    expect(stored(fresh).quota['gemini-5h']).toEqual(bucket(1, R5 + 5 * H));
    expect(fresh.accepted).toBe(true);
    const stale = mergeAntigravityPayload(fresh.text, FULL({ 'gemini-5h': bucket(0.1, R5) }), NOW + 2000);
    expect(stored(stale).quota['gemini-5h']).toEqual(bucket(1, R5 + 5 * H));
    expect(stale.accepted).toBe(false);
  });

  it('keeps a stored window the incoming payload omits while it is still in the future', () => {
    const s = mergeAntigravityPayload(null, FULL({ 'gemini-5h': bucket(0.6, R5), 'gemini-weekly': bucket(0.5, R7) }), NOW).text!;
    const m = mergeAntigravityPayload(s, FULL({ 'gemini-5h': bucket(0.3, R5) }), NOW + 1000);
    expect(stored(m).quota['gemini-weekly']).toEqual(bucket(0.5, R7));
    expect(stored(m).quota['gemini-5h']!.remaining_fraction).toBe(0.3);
  });

  it('drops windows whose reset time has passed', () => {
    const s = mergeAntigravityPayload(null, FULL({ 'gemini-5h': bucket(0.6, R5), 'gemini-weekly': bucket(0.5, R7) }), NOW).text!;
    const m = mergeAntigravityPayload(s, FULL({ 'gemini-weekly': bucket(0.4, R7) }), R5 + 1000);
    expect(Object.keys(stored(m).quota)).toEqual(['gemini-weekly']);
  });

  it('keeps the stored plan tier when the incoming payload has none', () => {
    const s = mergeAntigravityPayload(null, FULL({ 'gemini-5h': bucket(0.6, R5) }), NOW).text!;
    const m = mergeAntigravityPayload(s, JSON.stringify({ quota: { 'gemini-5h': bucket(0.4, R5) } }), NOW + 1000);
    expect(stored(m).plan_tier).toBe('Google AI Pro');
  });

  it('accepts nothing from garbage, non-objects, missing quota or malformed buckets', () => {
    const none = { text: null, accepted: false };
    expect(mergeAntigravityPayload(null, 'not json', NOW)).toEqual(none);
    expect(mergeAntigravityPayload(null, '[]', NOW)).toEqual(none);
    expect(mergeAntigravityPayload(null, JSON.stringify({ email: EMAIL }), NOW)).toEqual(none);
    expect(mergeAntigravityPayload(null, FULL({ 'gemini-5h': { remaining_fraction: 'x', reset_time: iso(R5) }, 'gemini-weekly': { remaining_fraction: 0.5, reset_time: 'soon' } }), NOW)).toEqual(none);
  });

  it('ignores a corrupt stored file', () => {
    const m = mergeAntigravityPayload('{broken', FULL({ 'gemini-5h': bucket(0.4, R5) }), NOW);
    expect(m.accepted).toBe(true);
    expect(stored(m).quota['gemini-5h']!.remaining_fraction).toBe(0.4);
  });
});

// ---- the hook as a process -----------------------------------------------------------------------------------------

let root: string;
let dataDir: string;
let hook: string;
let echo: string;

const ECHO = `
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
  const args=process.argv.slice(2);const i=args.indexOf('--exit');
  process.stdout.write(JSON.stringify({args,input}));
  process.exitCode = i>=0 ? Number(args[i+1]) : 0;
});`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'usage widget agy hook-'));
  dataDir = join(root, 'data dir');
  mkdirSync(dataDir, { recursive: true });
  hook = join(dataDir, 'hook.js');
  writeFileSync(hook, hookSource);
  echo = join(root, 'echo script.js');
  writeFileSync(echo, ECHO);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const runHook = (args: string[], input: string) => spawnSync(process.execPath, [hook, '--agent', 'antigravity', ...args], { input, encoding: 'utf8' });
const FAR = Date.parse('2099-01-01T00:00:00Z');
const PAYLOAD = FULL({ 'gemini-5h': bucket(0.75, FAR), 'gemini-weekly': bucket(0.5, FAR + 72 * H) });
const dataFile = () => join(dataDir, 'antigravity.json');

describe('hook.js --agent antigravity', () => {
  it('writes antigravity.json next to itself without the email, and prints nothing without --then', () => {
    const r = runHook([], PAYLOAD);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    const text = readFileSync(dataFile(), 'utf8');
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain('secret-project');
    expect(JSON.parse(text).quota['gemini-5h']).toEqual(bucket(0.75, FAR));
    expect(existsSync(join(dataDir, 'claude.json'))).toBe(false);
    expect(existsSync(dataFile() + '.tmp')).toBe(false);
  });

  it('passes the untouched stdin to the wrapped command and forwards its stdout and exit code', () => {
    const r = runHook(['--then', `node "${toPosixPath(echo)}" --exit 3`], PAYLOAD);
    expect(r.status).toBe(3);
    expect(JSON.parse(r.stdout)).toEqual({ args: ['--exit', '3'], input: PAYLOAD });
    expect(existsSync(dataFile())).toBe(true);
  });

  it('never writes the email even when the wrapped command receives it', () => {
    runHook(['--then', `node "${toPosixPath(echo)}"`], PAYLOAD);
    expect(readFileSync(dataFile(), 'utf8')).not.toContain('example.com');
  });

  it('still runs the wrapped command when the data file cannot be written', () => {
    mkdirSync(dataFile()); // a directory where the file should go
    const r = runHook(['--then', `node "${toPosixPath(echo)}"`], PAYLOAD);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).input).toBe(PAYLOAD);
  });

  it('still runs the wrapped command when stdin is not JSON, and writes nothing', () => {
    const r = runHook(['--then', `node "${toPosixPath(echo)}"`], 'plain text');
    expect(JSON.parse(r.stdout).input).toBe('plain text');
    expect(existsSync(dataFile())).toBe(false);
  });

  it('writes nothing when stdin is empty', () => {
    runHook([], '');
    expect(existsSync(dataFile())).toBe(false);
  });

  it('keeps newer data when an older session reports later', () => {
    runHook([], FULL({ 'gemini-5h': bucket(0.4, FAR) }));
    runHook([], FULL({ 'gemini-5h': bucket(0.9, FAR) }));
    expect(JSON.parse(readFileSync(dataFile(), 'utf8')).quota['gemini-5h'].remaining_fraction).toBe(0.4);
  });

  describe('wrapped command read from connector.json (no --then on the command line)', () => {
    const record = (original: unknown) => writeFileSync(join(dataDir, 'connector.json'), JSON.stringify({ version: 1, originalStatusLine: original }));

    it('runs it with stdin forwarded, stdout passed through and the exit code preserved', () => {
      record({ type: 'command', command: `node "${toPosixPath(echo)}" --exit 5`, enabled: true });
      const r = runHook([], PAYLOAD);
      expect(r.status).toBe(5);
      expect(JSON.parse(r.stdout)).toEqual({ args: ['--exit', '5'], input: PAYLOAD });
      expect(existsSync(dataFile())).toBe(true);
    });

    it('an explicit --then (the old form) wins over connector.json', () => {
      record({ type: 'command', command: 'node -e "process.stdout.write(\'recorded\')"' });
      const r = runHook(['--then', `node "${toPosixPath(echo)}"`], PAYLOAD);
      expect(JSON.parse(r.stdout).input).toBe(PAYLOAD);
    });

    it('exits cleanly, prints nothing and still saves the data when connector.json is missing, corrupt or has no command', () => {
      for (const setup of [() => undefined, () => writeFileSync(join(dataDir, 'connector.json'), '{broken'), () => record(null), () => record({ type: 'command' }), () => record({ command: 42 })]) {
        rmSync(join(dataDir, 'connector.json'), { force: true });
        rmSync(dataFile(), { force: true });
        setup();
        const r = runHook([], PAYLOAD);
        expect(r.status).toBe(0);
        expect(r.stdout).toBe('');
        expect(existsSync(dataFile())).toBe(true);
      }
    });

    it('is only used for Antigravity: the Claude form never reads it', () => {
      record({ type: 'command', command: `node "${toPosixPath(echo)}"` });
      const r = spawnSync(process.execPath, [hook], { input: '{}', encoding: 'utf8' });
      expect(r.stdout).toBe('');
    });
  });

  it('exits 0 and prints nothing when the wrapped command does not exist', () => {
    const r = runHook(['--then', 'definitely-not-a-real-command-xyz'], PAYLOAD);
    expect(r.stdout).toBe('');
    expect(r.status).not.toBeNull();
  });
});

// agy is written in Go and runs the command roughly as exec.Command("cmd", "/c", command). Go (like node's default
// argument quoting) escapes embedded double quotes as \", so a quoted hook path reaches node with literal quote characters.
// spawnSync('cmd.exe', ['/c', command]) without shell:true reproduces that; spawn(command, {shell:true}) does not.
describe.skipIf(process.platform !== 'win32')('command written by the connector, run the way agy runs it (cmd.exe /c)', () => {
  let plain: string; // no spaces: an unquoted hook path cannot contain any
  beforeEach(() => {
    plain = mkdtempSync(join(tmpdir(), 'agyreg-'));
  });
  afterEach(() => rmSync(plain, { recursive: true, force: true }));

  const setup = async (original: string | null) => {
    const home = join(plain, 'home');
    const agyDir = join(home, '.gemini', 'antigravity-cli');
    mkdirSync(agyDir, { recursive: true });
    const statusLine = original === null ? {} : { statusLine: { type: 'command', command: original, enabled: true } };
    writeFileSync(join(agyDir, 'settings.json'), JSON.stringify(statusLine));
    await new AntigravityConnector(home, { platform: 'win32' }).connect();
    const written = JSON.parse(readFileSync(join(agyDir, 'settings.json'), 'utf8')).statusLine.command as string;
    return { agyDir, written };
  };
  const runLikeAgy = (command: string) => spawnSync('cmd.exe', ['/c', command], { input: PAYLOAD, encoding: 'utf8', cwd: tmpdir() });

  it('runs the hook, the wrapped command (stdin, stdout, exit code) and writes antigravity.json', async () => {
    const plainEcho = join(plain, 'echo.js');
    writeFileSync(plainEcho, ECHO);
    const original = `node ${plainEcho} --label "a b" --exit 4`; // a real Windows command: backslashes, an argument with spaces
    const { agyDir, written } = await setup(original);

    expect(written).not.toContain('"');
    const r = runLikeAgy(written);
    expect(r.stderr).not.toMatch(/Cannot find module/);
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout)).toEqual({ args: ['--label', 'a b', '--exit', '4'], input: PAYLOAD });
    const text = readFileSync(join(agyDir, 'usage-widget', 'antigravity.json'), 'utf8');
    expect(JSON.parse(text).quota['gemini-5h']).toEqual(bucket(0.75, FAR));
    expect(text).not.toContain(EMAIL);
  });

  it('works when there was no statusLine before: saves the data and prints nothing', async () => {
    const { agyDir, written } = await setup(null);
    const r = runLikeAgy(written);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(existsSync(join(agyDir, 'usage-widget', 'antigravity.json'))).toBe(true);
  });
});
