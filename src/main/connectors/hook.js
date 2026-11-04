#!/usr/bin/env node
// Agent Usage Widget - statusLine hook (v1) for Claude Code and the Antigravity CLI.
// Self-contained: Node core modules only. Installed to <agent folder>/usage-widget/hook.js by the widget.
//
// Usage (set as statusLine.command by the widget):
//   node "<this file>"                       save Claude's statusLine JSON for the widget, print nothing
//   node "<this file>" --then "<command>"    same, then run <command> with the same stdin and forward its
//                                            stdout and exit code (this is how an existing statusLine is kept)
//   node "<this file>" --agent antigravity   same for Antigravity: saves ONLY the quota the widget shows and the plan
//                                            tier to antigravity.json (never the email or anything else it sends). Without
//                                            --then, the wrapped command is read from connector.json next to this file, so the
//                                            command line the agent runs needs no quotes (agy cannot run one that has them).
//
// It must never break the agent's statusline: every I/O error of its own is swallowed.
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

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

// ---- Antigravity: persist only what the widget shows --------------------------------------------------------------
// Antigravity's statusLine JSON also carries the account email, working directory, transcript path, session id and
// conversation title. None of that is ever written: the payload is reduced to the two buckets the widget shows and the
// plan tier, then merged with what is stored (same idea as the Claude merge, per bucket):
//   reset times within a minute  -> the same window: keep the LOWER remaining_fraction (more used)
//   later reset_time             -> a new window: take the incoming one
//   earlier reset_time           -> stale session: keep the stored one
//   incoming absent              -> keep the stored one while its reset_time is still in the future
//   reset_time in the past       -> dropped
const AGY_KEYS = ['gemini-5h', 'gemini-weekly', 'gemini-argon-wtu-weekly', '3p-5h', '3p-weekly'];
const AGY_SAME_WINDOW_MS = 60 * 1000;
const AGY_MAX_PLAN = 64;

// -> { remaining_fraction, reset_time (ISO), ms } or null
function agyBucket(raw) {
  if (!isObject(raw)) return null;
  const f = raw.remaining_fraction;
  if (typeof f !== 'number' || !isFinite(f)) return null;
  const ms = typeof raw.reset_time === 'string' ? Date.parse(raw.reset_time) : NaN;
  if (!isFinite(ms)) return null;
  return { remaining_fraction: Math.min(1, Math.max(0, f)), reset_time: new Date(ms).toISOString(), ms: ms };
}

function agyPlan(v) {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.length <= AGY_MAX_PLAN && !/[\u0000-\u001f]/.test(t) ? t : undefined;
}

// -> { window, fromIncoming } (window undefined when nothing live is left)
function mergeAgyBucket(stored, incoming, nowMs) {
  const s = stored && stored.ms > nowMs ? stored : null;
  const i = incoming && incoming.ms > nowMs ? incoming : null;
  if (!s && !i) return { window: undefined, fromIncoming: false };
  if (!s) return { window: i, fromIncoming: true };
  if (!i) return { window: s, fromIncoming: false };
  const diff = i.ms - s.ms;
  if (diff > AGY_SAME_WINDOW_MS) return { window: i, fromIncoming: true };
  if (diff < -AGY_SAME_WINDOW_MS) return { window: s, fromIncoming: false };
  return i.remaining_fraction <= s.remaining_fraction ? { window: i, fromIncoming: true } : { window: s, fromIncoming: false };
}

// Pure. Returns { text, accepted }: the merged result, and whether the incoming payload contributed anything (when it did
// not, the caller leaves the file alone). text is null when the payload has no usable bucket at all.
function mergeAntigravityPayload(storedText, incomingText, nowMs) {
  const incoming = parseObject(incomingText);
  if (!incoming) return { text: null, accepted: false };
  const stored = parseObject(storedText);
  const storedQuota = stored && isObject(stored.quota) ? stored.quota : {};
  const incomingQuota = isObject(incoming.quota) ? incoming.quota : {};
  const quota = {};
  let accepted = false;
  let usable = false;
  for (const key of AGY_KEYS) {
    const inc = agyBucket(incomingQuota[key]);
    if (inc) usable = true;
    const m = mergeAgyBucket(agyBucket(storedQuota[key]), inc, nowMs);
    if (m.window !== undefined) quota[key] = { remaining_fraction: m.window.remaining_fraction, reset_time: m.window.reset_time };
    if (m.fromIncoming) accepted = true;
  }
  if (!usable) return { text: null, accepted: false }; // nothing the widget can use in this payload
  const plan = agyPlan(incoming.plan_tier) || (stored ? agyPlan(stored.plan_tier) : undefined);
  const out = { v: 1 };
  if (plan) out.plan_tier = plan;
  out.quota = quota;
  out.updated_at = nowMs;
  return { text: JSON.stringify(out), accepted: accepted };
}

function writeMerged(file, input, merge) {
  try {
    let storedText = null;
    try {
      storedText = fs.readFileSync(file, 'utf8');
    } catch (e) {
      /* no file yet */
    }
    const result = merge(storedText, input.toString('utf8'));
    if (result.accepted) writeAtomic(file, result.text);
  } catch (e) {
    /* never fail the statusline */
  }
}

// The statusLine command the user had before connecting, as saved by the connector. Never throws.
function readWrappedCommand() {
  try {
    const record = parseObject(fs.readFileSync(path.join(__dirname, 'connector.json'), 'utf8'));
    const original = record && record.originalStatusLine;
    return isObject(original) && typeof original.command === 'string' && original.command ? original.command : null;
  } catch (e) {
    return null;
  }
}

function parseFlag(argv, name) {
  const i = argv.indexOf(name);
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
// Antigravity does not go through Git Bash (its own command, e.g. "python C:\x\s.py", is written for the Windows
// shell), so there the command goes to cmd.exe directly and no bash.exe is ever looked up.
function candidates(command, agent) {
  if (process.platform === 'win32' && agent === 'antigravity') return [[command, [], { shell: true }]];
  if (process.platform === 'win32') {
    const bash = resolveGitBash(process.env, fs.existsSync);
    const list = bash ? [[bash, ['-c', command], {}]] : [];
    list.push([command, [], { shell: true }]);
    return list;
  }
  return [['/bin/sh', ['-c', command], {}]];
}

function runThen(command, input, agent) {
  const list = candidates(command, agent);
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
  const argv = process.argv.slice(2);
  const agent = parseFlag(argv, '--agent') === 'antigravity' ? 'antigravity' : 'claude';
  const then = parseFlag(argv, '--then') || (agent === 'antigravity' ? readWrappedCommand() : null);
  const file = path.join(__dirname, agent === 'antigravity' ? 'antigravity.json' : 'claude.json');
  const merge =
    agent === 'antigravity'
      ? (stored, incoming) => mergeAntigravityPayload(stored, incoming, Date.now())
      : (stored, incoming) => mergeStatusPayload(stored, incoming, Date.now() / 1000);
  readStdin((input) => {
    // start the wrapped statusLine first: merging is quick, but it must never delay the user's status text
    if (then) runThen(then, input, agent);
    if (input.length > 0) writeMerged(file, input, merge);
  });
}

if (require.main === module) {
  process.on('uncaughtException', () => {
    process.exitCode = process.exitCode || 0;
  });
}
module.exports = { resolveGitBash, mergeStatusPayload, mergeAntigravityPayload };

if (require.main === module) {
  try {
    main();
  } catch (e) {
    /* never fail the statusline */
  }
}
