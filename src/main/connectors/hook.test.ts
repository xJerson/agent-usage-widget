import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClaudeConnector } from './claudeConnector';
import hookSource from './hook.js?raw';
import { toPosixPath } from './settingsEdit';

let root: string;
let dataDir: string;
let hook: string;
let echo: string;

const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0;

/** Wrapped command fixture: prints its args and stdin as JSON, optionally exits with a code. */
const ECHO = `
let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{
  const args=process.argv.slice(2);const i=args.indexOf('--exit');
  process.stdout.write(JSON.stringify({args,input}));
  process.exitCode = i>=0 ? Number(args[i+1]) : 0;
});`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'usage widget hook-'));
  dataDir = join(root, 'data dir');
  mkdirSync(dataDir, { recursive: true });
  hook = join(dataDir, 'hook.js');
  writeFileSync(hook, hookSource);
  echo = join(root, 'echo script.js');
  writeFileSync(echo, ECHO);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const runHook = (args: string[], input: string) =>
  spawnSync(process.execPath, [hook, ...args], { input, encoding: 'utf8' });

const STATUS_JSON = '{"rate_limits":{"five_hour":{"used_percentage":12,"resets_at":1800000000}}}';

describe('hook.js', () => {
  it('writes stdin to claude.json next to itself and prints nothing without --then', () => {
    const r = runHook([], STATUS_JSON);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(readFileSync(join(dataDir, 'claude.json'), 'utf8')).toBe(STATUS_JSON);
    expect(existsSync(join(dataDir, 'claude.json.tmp'))).toBe(false);
  });

  it('replaces an existing claude.json atomically', () => {
    writeFileSync(join(dataDir, 'claude.json'), 'old');
    runHook([], STATUS_JSON);
    expect(readFileSync(join(dataDir, 'claude.json'), 'utf8')).toBe(STATUS_JSON);
  });

  it('passes stdin through to the wrapped command and forwards its stdout', () => {
    const then = `node "${toPosixPath(echo)}"`;
    const r = runHook(['--then', then], STATUS_JSON);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ args: [], input: STATUS_JSON });
    expect(readFileSync(join(dataDir, 'claude.json'), 'utf8')).toBe(STATUS_JSON);
  });

  it('forwards the exit code of the wrapped command', () => {
    const r = runHook(['--then', `node "${toPosixPath(echo)}" --exit 3`], STATUS_JSON);
    expect(r.status).toBe(3);
  });

  it('handles paths with spaces and quotes in the wrapped command', () => {
    const r = runHook(['--then', `node "${toPosixPath(echo)}" --label "say \\"hi\\" there"`], 'x');
    expect(JSON.parse(r.stdout).args).toEqual(['--label', 'say "hi" there']);
  });

  it('never fails when the data file cannot be written, and still runs the wrapped command', () => {
    mkdirSync(join(dataDir, 'claude.json')); // a directory where the file should go
    const r = runHook(['--then', `node "${toPosixPath(echo)}"`], STATUS_JSON);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).input).toBe(STATUS_JSON);
  });

  it('exits 0 and prints nothing when the wrapped command does not exist', () => {
    const r = runHook(['--then', 'definitely-not-a-real-command-xyz'], STATUS_JSON);
    expect(r.stdout).toBe('');
    expect(r.status).not.toBeNull();
  });

  it('does not write an empty claude.json when stdin is empty', () => {
    runHook([], '');
    expect(existsSync(join(dataDir, 'claude.json'))).toBe(false);
  });
});

describe.skipIf(!hasSh)('command built by the connector, run through a POSIX shell', () => {
  it('round-trips an original command with quotes, spaces and variables', async () => {
    const home = join(root, 'my home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    const original = `node "${toPosixPath(echo)}" --label "a \\"b\\" $HOME" --exit 4`;
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: original } }));
    await new ClaudeConnector(home).connect();
    const { statusLine } = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));

    const r = spawnSync('sh', ['-c', statusLine.command], { input: STATUS_JSON, encoding: 'utf8', env: { ...process.env, HOME: '/home/x' } });
    expect(r.status).toBe(4);
    expect(JSON.parse(r.stdout)).toEqual({ args: ['--label', 'a "b" /home/x', '--exit', '4'], input: STATUS_JSON });
    expect(readFileSync(join(home, '.claude', 'usage-widget', 'claude.json'), 'utf8')).toBe(STATUS_JSON);
  });
});
