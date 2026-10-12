import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { resolveGitBash } = createRequire(import.meta.url)('./hook.js') as {
  resolveGitBash(env: Record<string, string | undefined>, exists: (p: string) => boolean): string | null;
};

const SYS_BASH = 'C:\\Windows\\System32\\bash.exe';
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';

const fsWith = (...files: string[]) => {
  const set = new Set(files.map((f) => f.toLowerCase()));
  return (p: string) => set.has(p.toLowerCase());
};

describe('resolveGitBash (Windows)', () => {
  it('never picks the WSL launcher in System32, even when it is first on PATH', () => {
    const env = { PATH: 'C:\\Windows\\System32;C:\\Program Files\\Git\\cmd;C:\\Windows' };
    expect(resolveGitBash(env, fsWith(SYS_BASH, 'C:\\Program Files\\Git\\cmd\\git.exe', GIT_BASH))).toBe(GIT_BASH);
  });

  it('returns null when the only bash is the System32 / WindowsApps launcher', () => {
    const env = { PATH: 'C:\\Windows\\System32;C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps' };
    const exists = fsWith(SYS_BASH, 'C:\\Users\\a\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe');
    expect(resolveGitBash(env, exists)).toBeNull();
  });

  it('derives Git root from git.exe in cmd, bin and mingw64\\bin', () => {
    for (const dir of ['D:\\Tools\\Git\\cmd', 'D:\\Tools\\Git\\bin', 'D:\\Tools\\Git\\mingw64\\bin']) {
      const bash = 'D:\\Tools\\Git\\bin\\bash.exe';
      expect(resolveGitBash({ PATH: `C:\\Windows\\System32;${dir}` }, fsWith(SYS_BASH, `${dir}\\git.exe`, bash))).toBe(bash);
    }
  });

  it('falls back to usr\\bin\\bash.exe under the Git root', () => {
    const bash = 'D:\\Git\\usr\\bin\\bash.exe';
    expect(resolveGitBash({ PATH: 'D:\\Git\\cmd' }, fsWith('D:\\Git\\cmd\\git.exe', bash))).toBe(bash);
  });

  it('uses the standard install locations when git is not on PATH', () => {
    const env = { PATH: 'C:\\Windows\\System32', ProgramFiles: 'C:\\Program Files' };
    expect(resolveGitBash(env, fsWith(SYS_BASH, GIT_BASH))).toBe(GIT_BASH);
    const user = 'C:\\Users\\a\\AppData\\Local\\Programs\\Git\\bin\\bash.exe';
    expect(resolveGitBash({ PATH: '', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, fsWith(user))).toBe(user);
  });

  it('honours CLAUDE_CODE_GIT_BASH_PATH first', () => {
    const custom = 'E:\\portable\\bash.exe';
    const env = { PATH: 'C:\\Program Files\\Git\\cmd', CLAUDE_CODE_GIT_BASH_PATH: custom };
    expect(resolveGitBash(env, fsWith(custom, GIT_BASH, 'C:\\Program Files\\Git\\cmd\\git.exe'))).toBe(custom);
  });

  it('accepts any other bash.exe found on PATH', () => {
    const msys = 'C:\\msys64\\usr\\bin\\bash.exe';
    expect(resolveGitBash({ PATH: 'C:\\Windows\\System32;C:\\msys64\\usr\\bin' }, fsWith(SYS_BASH, msys))).toBe(msys);
  });

  it('compares System32 case-insensitively and ignores SysWOW64 / Sysnative too', () => {
    const env = { PATH: 'c:\\WINDOWS\\system32;C:\\Windows\\SysWOW64;C:\\Windows\\Sysnative' };
    const exists = fsWith('c:\\WINDOWS\\system32\\bash.exe', 'C:\\Windows\\SysWOW64\\bash.exe', 'C:\\Windows\\Sysnative\\bash.exe');
    expect(resolveGitBash(env, exists)).toBeNull();
  });

  it('reads PATH regardless of the variable casing', () => {
    expect(resolveGitBash({ Path: 'C:\\Program Files\\Git\\cmd' }, fsWith('C:\\Program Files\\Git\\cmd\\git.exe', GIT_BASH))).toBe(GIT_BASH);
  });
});
