import { describe, expect, it } from 'vitest';
import {
  buildCommand,
  ConnectorError,
  isOurCommand,
  parseSettingsText,
  quoteForShell,
  quoteForWindows,
  serializeSettings,
  toPosixPath,
} from './settingsEdit';

describe('toPosixPath', () => {
  it('uses forward slashes', () => {
    expect(toPosixPath('C:\\Users\\Ana Maria\\.claude\\usage-widget\\hook.js')).toBe('C:/Users/Ana Maria/.claude/usage-widget/hook.js');
  });
});

describe('quoteForShell', () => {
  it('wraps in double quotes and escapes the characters special inside them', () => {
    expect(quoteForShell('plain')).toBe('"plain"');
    expect(quoteForShell('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteForShell('a\\b $HOME `x`')).toBe('"a\\\\b \\$HOME \\`x\\`"');
  });
});

describe('quoteForWindows', () => {
  it('wraps in double quotes and leaves backslashes alone when no quote follows them', () => {
    expect(quoteForWindows('python C:\\Users\\Ana Maria\\s.py')).toBe('"python C:\\Users\\Ana Maria\\s.py"');
  });
  it('escapes embedded quotes and the backslashes right before them (CommandLineToArgvW rules)', () => {
    expect(quoteForWindows('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteForWindows('a\\"b')).toBe('"a\\\\\\"b"');
  });
  it('doubles trailing backslashes so they do not escape the closing quote', () => {
    expect(quoteForWindows('C:\\dir\\')).toBe('"C:\\dir\\\\"');
  });
  it('does not treat $ or backticks as special (cmd.exe and PowerShell argv, not POSIX)', () => {
    expect(quoteForWindows('$HOME `x`')).toBe('"$HOME `x`"');
  });
});

describe('buildCommand', () => {
  const hook = 'C:\\Users\\Ana Maria\\.claude\\usage-widget\\hook.js';
  it('is a plain node call when there is no original command', () => {
    expect(buildCommand(hook, null)).toBe('node "C:/Users/Ana Maria/.claude/usage-widget/hook.js"');
  });
  it('wraps the original command with --then', () => {
    expect(buildCommand(hook, 'bash ~/.claude/statusline-command.sh')).toBe(
      'node "C:/Users/Ana Maria/.claude/usage-widget/hook.js" --then "bash ~/.claude/statusline-command.sh"',
    );
  });
  it('escapes quotes inside the original command', () => {
    expect(buildCommand('/h/hook.js', 'node "/a b/s.js" --x "y"')).toBe('node "/h/hook.js" --then "node \\"/a b/s.js\\" --x \\"y\\""');
  });
});

describe('buildCommand with a style', () => {
  it('adds extra hook arguments before --then and uses the given quoting', () => {
    const style = { args: '--agent antigravity', quote: quoteForWindows };
    expect(buildCommand('C:\\h\\hook.js', null, style)).toBe('node "C:/h/hook.js" --agent antigravity');
    expect(buildCommand('C:\\h\\hook.js', 'python C:\\a b\\s.py', style)).toBe('node "C:/h/hook.js" --agent antigravity --then "python C:\\a b\\s.py"');
  });
});

describe('isOurCommand', () => {
  it('recognises commands that call our hook, wrapped or not', () => {
    const hook = '/home/u/.claude/usage-widget/hook.js';
    expect(isOurCommand(buildCommand(hook, null), hook)).toBe(true);
    expect(isOurCommand(buildCommand(hook, 'echo hi'), hook)).toBe(true);
    expect(isOurCommand('bash ~/.claude/statusline-command.sh', hook)).toBe(false);
    expect(isOurCommand(undefined, hook)).toBe(false);
    expect(isOurCommand(buildCommand(hook, 'echo hi', { args: '--agent antigravity' }), hook)).toBe(true);
  });
});

describe('parse / serialize', () => {
  it('round-trips 2-space, trailing newline', () => {
    const raw = '{\n  "a": 1,\n  "b": { "c": 2 }\n}\n';
    const { data, format } = parseSettingsText(raw);
    expect(serializeSettings(data, format)).toBe('{\n  "a": 1,\n  "b": {\n    "c": 2\n  }\n}\n');
  });
  it('keeps tabs, CRLF, BOM and a missing trailing newline', () => {
    const raw = '\uFEFF{\r\n\t"a": 1\r\n}';
    const { data, format } = parseSettingsText(raw);
    expect(serializeSettings(data, format)).toBe(raw);
  });
  it('defaults to 2 spaces for a single-line file', () => {
    const { data, format } = parseSettingsText('{"a":1}');
    expect(serializeSettings(data, format)).toBe('{\n  "a": 1\n}');
  });
  it('refuses invalid JSON and non-objects with a clear error', () => {
    for (const bad of ['', '{"a":', '[1]', 'null', '// comment\n{}']) {
      expect(() => parseSettingsText(bad)).toThrow(ConnectorError);
    }
    try {
      parseSettingsText('{oops');
    } catch (e) {
      expect((e as ConnectorError).code).toBe('invalid_settings');
      expect((e as Error).message).toMatch(/not valid JSON/);
    }
  });
});
