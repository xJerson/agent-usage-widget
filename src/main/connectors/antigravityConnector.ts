import { homedir } from 'node:os';
import { ConnectorError, quoteForShell, toPosixPath } from './settingsEdit';
import { StatusLineConnector, type ConnectorOptions } from './statusLineConnector';

export interface AntigravityConnectorOptions extends ConnectorOptions {
  /** Test hook: which platform's command rules to use (defaults to the running one). */
  platform?: NodeJS.Platform;
}

/** Characters that need quoting (or mean something) in a cmd.exe command line. */
const UNSAFE_ON_WINDOWS = /[\s"&|<>^%()!;,=]/;

/**
 * Registers the widget's hook as the Antigravity CLI's statusLine command (~/.gemini/antigravity-cli/settings.json).
 *
 * agy is a Go program that runs the command roughly as `cmd /c <command>`, and Go escapes every double quote it finds as
 * `\"`, so node would receive literal quote characters and look the hook up as a relative path. On Windows the command
 * therefore contains NO double quotes (`node C:/.../hook.js --agent antigravity`) and the user's original command is not
 * put on the line at all: the hook reads it from connector.json. That also means a hook path with a space or another
 * cmd.exe special character cannot be written; Connect refuses with a clear error instead of writing a command that
 * cannot run (an 8.3 short path is not reliable, since short names can be disabled per volume).
 * Off Windows the path is quoted for `sh` as usual.
 */
export class AntigravityConnector extends StatusLineConnector {
  constructor(home: string = homedir(), options: AntigravityConnectorOptions = {}) {
    const windows = (options.platform ?? process.platform) === 'win32';
    super(
      home,
      {
        agentName: 'Antigravity',
        dirSegments: ['.gemini', 'antigravity-cli'],
        style: { args: '--agent antigravity', quote: windows ? (s) => s : quoteForShell },
        newEntryDefaults: { enabled: true },
        exactRestore: true,
        originalInRecord: true,
        checkHookPath: (hookPath) => {
          if (windows && UNSAFE_ON_WINDOWS.test(toPosixPath(hookPath))) {
            throw new ConnectorError(
              'unsupported_path',
              `Antigravity cannot run a status line command whose path contains spaces or special characters (${hookPath}). ` +
                'Move your user folder to a path without them, or add the hook to your statusline script by hand.',
            );
          }
        },
      },
      options,
    );
  }
}
