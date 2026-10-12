# Agent Usage Widget

A small floating Windows widget that shows the **subscription usage limits** of your AI coding agents (no API keys).
One glass bubble per detected agent (Claude Code, Codex). Click a bubble for the detail panel with every limit window,
its percentage, time to reset and the last update.

- Bubbles appear and disappear live as agents are detected or go away.
- The ring follows the shortest window (5h) and turns amber from 70% and red (pulsing) from 90%.
- Drag a bubble to move the widget. Double-click (or tray > "Edit size and position") to resize with the corner handles;
  confirm with the check button or Enter, cancel with the X or Esc.
- Position and scale persist in `layout.json` under Electron's `userData` directory and are clamped to the display work area.

Stack: Electron + React + TypeScript + Vite (electron-vite). Windows 11 target.

## Commands

```bash
npm install
npm run dev          # electron-vite dev (HMR)
npm run dev:demo     # same, with simulated data for both agents
npm run build        # production build into ./out
npm run preview      # build and launch the production bundle
npm run typecheck    # tsc for main/preload/shared and for the renderer
npm test             # vitest (pure logic + provider IO against temp dirs)
```

Debug environment variables (main process):

| Variable | Effect |
| --- | --- |
| `USAGE_WIDGET_DEMO=1` | Feeds simulated data for both agents (Codex disappears for 10s every 50s to show live add/remove). Never used otherwise. |
| `USAGE_WIDGET_DEBUG=1` | Logs usage updates and renderer console output to stdout. |
| `USAGE_WIDGET_HOME=<dir>` | Looks for `.claude` / `.codex` under `<dir>` instead of the real home (used for safe tests; Electron does not start reliably with an overridden `USERPROFILE`). Demo mode never touches `~/.claude`. |
| `USAGE_WIDGET_USER_DATA=<dir>` | Overrides Electron's `userData` folder (layout and consent state). |
| `USAGE_WIDGET_SCREENSHOT=<file.png>` | Writes a PNG of the widget after 5s and quits (handy for CI-like checks). |

Note: if you launch from a shell that sets `ELECTRON_RUN_AS_NODE`, unset it first.

## How it works

```
src/shared     types, IPC contract, pure logic (labels, levels, reset/expiry, geometry, resize math)
src/main       Electron main process
  providers/   one UsageProvider per agent: pure parsers + thin file IO
  usageService registry + reconcile loop (rescan every 5s, fs.watch + debounce for near-real-time reads)
  widgetController  window position / scale / size-to-content / drag / edit mode / persistence
  tray.ts      tray icon (drawn in code) and menu
src/preload    strict contextBridge API (window.widget)
src/renderer   React UI (bubbles, panel, edit frame/bar, toast)
```

Hexagonal split: `UsageProvider` (in `src/shared/types.ts`) is the port; `ClaudeProvider` and `CodexProvider` are adapters.
Parsing (`parseClaudeStatusline`, `parseCodexRolloutTail`) is pure and unit-tested; file access is a thin layer around it.
To add an agent: implement a provider, add it to `src/main/providers/index.ts`, and add its logo to
`src/renderer/lib/registry.tsx` (brand colours come from the provider's `AgentInfo`).

Units: `UsageWindow.resetsAt` is epoch **seconds** (as both sources give it) and `UsageSnapshot.updatedAt` is epoch
**milliseconds**. The renderer converts at the edge. The renderer also owns the time-based reset: once `now >= resetsAt`
the window shows 0% and "Starts at next prompt".

`fs.watch` is used instead of chokidar: only two directories are watched, no globbing is needed, Windows supports
`recursive` natively, and the 5s rescan covers any missed event, so it saves a dependency.

Window model: the bubble window is exactly the scaled column of bubbles plus 32px of transparent padding, pinned at its
bottom-right anchor. The scale applies only to the bubbles. The detail panel (always its fixed 320px design size), the
toast and the edit bar are separate small transparent windows (`src/main/floatWindows.ts`) placed next to the column: the
panel to its left, bottom-aligned with its bubble (flipping to the right if there is no room), the toast and edit bar above
it. They are resized while invisible and fade in only after the new size is applied, and the bubble window is never
resized when they open or close; resizing a transparent window shows one stale frame, which used to make the bubbles blink.
Dragging moves the window through IPC from pointer events (no `-webkit-app-region`, which swallows clicks). The bubble
window is non-focusable; the edit bar window takes focus while editing so Enter / Esc work.

## Data sources

| Agent | Detected when | Source | Notes |
| --- | --- | --- | --- |
| Claude Code | `~/.claude` exists | `~/.claude/usage-widget/claude.json`, written by the hook (see below) | Windows 300 / 10080 min from `rate_limits.five_hour` / `seven_day`. No file or no `rate_limits` yet: bubble at 0% and "Waiting for first prompt". |
| Codex | `~/.codex/sessions` exists | Newest `rollout-*.jsonl` under `~/.codex/sessions/YYYY/MM/DD/` | Reads only the last 256 KB, scans backwards for a `token_count` event with `rate_limits` (`primary` / `secondary`, `plan_type`); falls back to the previous 4 files. Read-only; only rate-limit fields are parsed. |

The widget never writes into `~/.codex`. It writes into `~/.claude/usage-widget` and `~/.claude/settings.json` only after you click Connect (and on Disconnect).

## Claude Code integration

Claude Code only hands its rate limits to its `statusLine` command, so the widget registers a tiny hook there. Nothing is
changed without your consent.

**Automatic connect (recommended).** On the first launch where Claude Code is detected but not connected, the Claude bubble
dims its logo and shows two buttons on top of it: a check ("Connect") and an X ("Not now"), with the caption
"Connect Claude Code?". Click the caption to open the panel with **What changes?**: the exact `statusLine` entry before and
after. Either choice dismisses the buttons, and they never reappear on their own (`connectPrompted` is stored in
`app-state.json` in Electron's `userData` folder as soon as they are shown). Later you can use the tray menu:
"Connect Claude Code…" or "Disconnect Claude Code".

What Connect does, all under `~/.claude`:

1. Backs up `settings.json` to `usage-widget/backup/settings.<timestamp>.json`.
2. Copies a dependency-free hook to `usage-widget/hook.js` (a stable path, so moving or updating the app never breaks it;
   it is refreshed on startup while connected).
3. Sets `statusLine.command` to `node "<...>/hook.js"`. If you already have a statusLine it is **wrapped, not replaced**:
   `node "<...>/hook.js" --then "<your original command>"`. The hook saves Claude's JSON to `usage-widget/claude.json`
   (atomic write), runs your original command with the same stdin and forwards its output and exit code.
4. Saves your original `statusLine` object verbatim in `usage-widget/connector.json`.

Other keys, their order and the file formatting (indentation, line endings, BOM) are preserved, writes are atomic, and
connecting twice never double-wraps. If `settings.json` is not valid JSON the widget refuses and leaves it alone.
Needs `node` on the PATH of the shell Claude Code uses (it already is when Claude Code is installed through npm; the
command is run through Git Bash on Windows).

**Disconnect.** Tray menu > "Disconnect Claude Code" restores the original `statusLine` exactly (or removes the key if there
was none). Backups are kept. To undo it by hand, copy a file from `~/.claude/usage-widget/backup/` over `settings.json`.

**Manual fallback.** If you prefer not to let the widget edit settings, add this ONE line to your own statusline script,
right after it reads stdin into `$input` (also in `scripts/claude-statusline-snippet.sh`):

```bash
mkdir -p ~/.claude/usage-widget && printf '%s' "$input" > ~/.claude/usage-widget/claude.json
```

`rate_limits` is only present for subscription accounts after the first response of a session, and each window may be absent
on its own; the widget handles all of those cases, and also ignores a half-written file. While not connected, the Claude panel
says "Connect Claude Code from the tray menu".

## Tray menu

Connect Claude Code… / Disconnect Claude Code (depending on state), Edit size and position, Reset position, Start with Windows (off by default), Quit. Only one instance runs at a time.

## Known limits

- The glass blur applies to the widget's own content only; a transparent Electron window cannot blur the desktop behind it.
- Claude does not report its plan name in the statusline JSON, so the Claude panel shows no plan badge.
- Packaging into an installer is not set up (no electron-builder dependency); `npm run build` produces the runnable bundle.
