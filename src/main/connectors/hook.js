#!/usr/bin/env node
// Agent Usage Widget - Claude Code statusLine hook (v1).
// Self-contained: Node core modules only. Installed to ~/.claude/usage-widget/hook.js by the widget.
//
// Usage (set as statusLine.command by the widget):
//   node "<this file>"                       save Claude's statusLine JSON for the widget, print nothing
//   node "<this file>" --then "<command>"    same, then run <command> with the same stdin and forward its
//                                            stdout and exit code (this is how an existing statusLine is kept)
//
// It must never break Claude Code's statusline: every I/O error of its own is swallowed.
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const DATA_FILE = path.join(__dirname, 'claude.json');

// ---- merging rate limits ------------------------------------------------------------------------------------
// Every Claude Code session runs the statusLine, and they all write the same file. A session that has been idle
// still carries older rate_limits, so a plain overwrite can move numbers backwards (used_percentage only ever grows
// inside one window). Merge instead, per window:
//   same resets_at      -> keep the higher used_percentage
//   newer resets_at     -> a new window: take the incoming one
//   older resets_at     -> stale: keep the stored one
//   incoming absent     -> keep the stored one while its resets_at is still in the future
//   resets_at in past   -> dropped (Claude Code itself drops expired windows)
const WINDOW_KEYS = ['five_hour', 'seven_day'];

function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function resetsOf(w) {
  const v = w.resets_at;
  if (typeof v !== 'number' || !isFinite(v)) return null;
  return v >= 1e11 ? v / 1000 : v; // tolerate milliseconds
}

function liveWindow(w, nowSec) {
  if (!isObject(w) || typeof w.used_percentage !== 'number' || !isFinite(w.used_percentage)) return null;
  const r = resetsOf(w);
  return r !== null && r <= nowSec ? null : w;
}

// -> { window, fromIncoming } (window undefined when nothing live is left)
function mergeWindow(stored, incoming, nowSec) {
  const s = liveWindow(stored, nowSec);
  const i = liveWindow(incoming, nowSec);
  if (!s && !i) return { window: undefined, fromIncoming: false };
  if (!s) return { window: i, fromIncoming: true };
  if (!i) return { window: s, fromIncoming: false };
  const rs = resetsOf(s);
  const ri = resetsOf(i);
  if (rs === null || ri === null) return { window: i, fromIncoming: true }; // cannot compare: trust the incoming
  if (ri > rs) return { window: i, fromIncoming: true };
  if (ri < rs) return { window: s, fromIncoming: false };
  if (i.used_percentage >= s.used_percentage) return { window: i, fromIncoming: true };
  return { window: s, fromIncoming: false };
}

function parseObject(text) {
  if (typeof text !== 'string') return null;
  try {
    const data = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
    return isObject(data) ? data : null;
  } catch (e) {
    return null;
  }
}

// Pure. storedText: current file contents or null. Returns { text, accepted }:
//   text     what to write (incoming top-level fields + merged rate_limits)
//   accepted false when the incoming payload contributed nothing (every window was stale or absent); the caller then
//            leaves the file alone, so its mtime keeps meaning "when the data last advanced".
function mergeStatusPayload(storedText, incomingText, nowSec) {
  const incoming = parseObject(incomingText);
  if (!incoming) return { text: incomingText, accepted: true }; // not JSON: keep the old verbatim behaviour
  const stored = parseObject(storedText);
  if (!stored) return { text: incomingText, accepted: true };

  const storedLimits = isObject(stored.rate_limits) ? stored.rate_limits : {};
  const incomingLimits = isObject(incoming.rate_limits) ? incoming.rate_limits : {};
  const limits = Object.assign({}, incomingLimits);
  let accepted = false;
  let any = false;
  for (const key of WINDOW_KEYS) {
    const m = mergeWindow(storedLimits[key], incomingLimits[key], nowSec);
    if (m.window === undefined) delete limits[key];
    else {
      limits[key] = m.window;
      any = true;
    }
    if (m.fromIncoming) accepted = true;
  }
  const out = Object.assign({}, incoming);
  if (any || Object.keys(limits).length > 0) out.rate_limits = limits;
  else delete out.rate_limits;
  // identical text when the incoming payload is already the merged result (keeps the common case byte-stable)
  return { text: JSON.stringify(out), accepted };
}

function writeMerged(file, input) {
  try {
    let storedText = null;
    try {
      storedText = fs.readFileSync(file, 'utf8');
    } catch (e) {
      /* no file yet */
    }
    const result = mergeStatusPayload(storedText, input.toString('utf8'), Date.now() / 1000);
    if (result.accepted) writeAtomic(file, result.text);
  } catch (e) {
    /* never fail the statusline */
  }
}

function parseThen(argv) {
  const i = argv.indexOf('--then');
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null;
}

function sleep(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (e) {
    /* ignore */
  }
}

function writeAtomic(file, data) {
  const tmp = file + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, data);
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        fs.renameSync(tmp, file);
        return;
      } catch (e) {
        sleep(15); // Windows: the target may be briefly open in the widget
      }
    }
    fs.writeFileSync(file, data);
  } catch (e) {
    /* never fail the statusline */
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch (e) {
      /* already renamed or never created */
    }
  }
}

function readStdin(done) {
  const chunks = [];
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done(Buffer.concat(chunks));
  };
  try {
    if (process.stdin.isTTY) return finish();
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', finish);
    process.stdin.on('error', finish);
    const guard = setTimeout(finish, 5000);
    guard.unref();
  } catch (e) {
    finish();
  }
}

// Windows: find Git for Windows' bash explicitly. Never take "bash" from PATH blindly, because
// C:\Windows\System32\bash.exe (and the WindowsApps alias) is the WSL launcher, which would run the command inside WSL.
// Pure: takes the environment and an exists() predicate so it can be tested with injected PATH / candidates.
function resolveGitBash(env, exists) {
  const w = path.win32;
  const get = (name) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? env[key] : undefined;
  };
  const wsl = /[\\/](system32|syswow64|sysnative|windowsapps)([\\/]|$)/i;
  const dirs = (get('PATH') || '').split(';').map((d) => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const out = [];
  const add = (p) => {
    if (p && !wsl.test(p) && out.indexOf(p) < 0) out.push(p);
  };
  add(get('CLAUDE_CODE_GIT_BASH_PATH'));
  for (const dir of dirs) {
    if (!exists(w.join(dir, 'git.exe')) && !exists(w.join(dir, 'git.cmd'))) continue;
    const root = w.basename(dir).toLowerCase() === 'bin' && w.basename(w.dirname(dir)).toLowerCase() === 'mingw64'
      ? w.dirname(w.dirname(dir))
      : ['cmd', 'bin'].indexOf(w.basename(dir).toLowerCase()) >= 0
        ? w.dirname(dir)
        : dir;
    add(w.join(root, 'bin', 'bash.exe'));
    add(w.join(root, 'usr', 'bin', 'bash.exe'));
  }
  for (const base of [get('ProgramFiles'), get('ProgramW6432'), get('ProgramFiles(x86)'), get('LOCALAPPDATA') && w.join(get('LOCALAPPDATA'), 'Programs')]) {
    if (base) add(w.join(base, 'Git', 'bin', 'bash.exe'));
  }
  for (const dir of dirs) add(w.join(dir, 'bash.exe'));
  for (const candidate of out) if (exists(candidate)) return candidate;
  return null;
}

// Runs the original statusLine command through a shell. On Windows Claude Code runs commands through
// Git Bash, so use Git's bash (the original command may rely on it, e.g. "~"); only without one fall back to cmd.exe.
function candidates(command) {
  if (process.platform === 'win32') {
    const bash = resolveGitBash(process.env, fs.existsSync);
    const list = bash ? [[bash, ['-c', command], {}]] : [];
    list.push([command, [], { shell: true }]);
    return list;
  }
  return [['/bin/sh', ['-c', command], {}]];
}

function runThen(command, input) {
  const list = candidates(command);
  const attempt = (index) => {
    const entry = list[index];
    if (!entry) return;
    let started = false;
    let child;
    try {
      child = cp.spawn(entry[0], entry[1], Object.assign({ stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true }, entry[2]));
    } catch (e) {
      return attempt(index + 1);
    }
    child.on('spawn', () => {
      started = true;
    });
    child.on('error', () => {
      if (!started) attempt(index + 1);
    });
    child.stdin.on('error', () => {});
    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.on('close', (code) => {
      process.exitCode = code === null ? 1 : code;
    });
    try {
      child.stdin.end(input);
    } catch (e) {
      /* child may already be gone */
    }
  };
  attempt(0);
}

function main() {
  const then = parseThen(process.argv.slice(2));
  readStdin((input) => {
    // start the wrapped statusLine first: merging is quick, but it must never delay the user's status text
    if (then) runThen(then, input);
    if (input.length > 0) writeMerged(DATA_FILE, input);
  });
}

if (require.main === module) {
  process.on('uncaughtException', () => {
    process.exitCode = process.exitCode || 0;
  });
}
module.exports = { resolveGitBash, mergeStatusPayload };

if (require.main === module) {
  try {
    main();
  } catch (e) {
    /* never fail the statusline */
  }
}
