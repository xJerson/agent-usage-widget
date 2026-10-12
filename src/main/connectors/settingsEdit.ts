export type ConnectorErrorCode = 'no_claude_dir' | 'invalid_settings' | 'no_restore_info' | 'write_failed';

export class ConnectorError extends Error {
  constructor(
    readonly code: ConnectorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ConnectorError';
  }
}

/** Forward slashes work for node and for every shell Claude Code uses, and avoid backslash escaping. */
export const toPosixPath = (p: string): string => p.replace(/\\/g, '/');

/** POSIX double-quote quoting: escapes the characters that stay special inside double quotes. */
export const quoteForShell = (s: string): string => `"${s.replace(/([\\"$`])/g, '\\$1')}"`;

/** `node "<hook>"`, or `node "<hook>" --then "<original>"` to keep an existing statusLine working. */
export function buildCommand(hookPath: string, original: string | null): string {
  const base = `node ${quoteForShell(toPosixPath(hookPath))}`;
  return original ? `${base} --then ${quoteForShell(original)}` : base;
}

export const isOurCommand = (command: unknown, hookPath: string): boolean =>
  typeof command === 'string' && command.includes(toPosixPath(hookPath));

export interface TextFormat {
  bom: boolean;
  indent: string;
  eol: '\n' | '\r\n';
  trailingNewline: boolean;
}

export const defaultFormat: TextFormat = { bom: false, indent: '  ', eol: '\n', trailingNewline: true };

export function parseSettingsText(raw: string): { data: Record<string, unknown>; format: TextFormat } {
  const bom = raw.startsWith('﻿');
  const text = bom ? raw.slice(1) : raw;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ConnectorError('invalid_settings', 'settings.json is not valid JSON, so it was left untouched. Fix or remove it and try again.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ConnectorError('invalid_settings', 'settings.json is not a JSON object, so it was left untouched.');
  }
  const indent = /^([ \t]+)"/m.exec(text)?.[1] ?? '  ';
  return {
    data: data as Record<string, unknown>,
    format: { bom, indent, eol: text.includes('\r\n') ? '\r\n' : '\n', trailingNewline: /\n$/.test(text) },
  };
}

export function serializeSettings(data: Record<string, unknown>, format: TextFormat): string {
  let out = JSON.stringify(data, null, format.indent);
  if (format.eol === '\r\n') out = out.replace(/\n/g, '\r\n');
  if (format.trailingNewline) out += format.eol;
  return (format.bom ? '﻿' : '') + out;
}
