/**
 * Shared domain types. Units are deliberate and consistent:
 *  - `UsageWindow.resetsAt` is epoch SECONDS, exactly as both sources provide it.
 *  - `UsageSnapshot.updatedAt` is epoch MILLISECONDS (a JS timestamp).
 * The renderer converts `resetsAt` to milliseconds at the edge (see shared/usage.ts).
 */
export interface UsageWindow {
  /** Window length in minutes (300 = 5h, 10080 = 7 days). */
  minutes: number;
  /** 0..100 */
  usedPercent: number;
  /** Epoch seconds, or null when the source does not say. */
  resetsAt: number | null;
}

export interface UsageSnapshot {
  agentId: string;
  /** Plan name as reported by the source (e.g. "plus"), when available. */
  plan?: string;
  windows: UsageWindow[];
  /** Epoch milliseconds of the source data. */
  updatedAt: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  /** Default plan badge text; the snapshot plan wins when present. Empty hides the badge. */
  planLabel: string;
  brand: string;
  brandLight: string;
}

export interface UsageProvider {
  readonly info: AgentInfo;
  readonly id: string;
  readonly name: string;
  /** True when the agent is installed / in use on this machine. */
  detect(): Promise<boolean>;
  /** Latest snapshot, or null when there is nothing (yet) or the source is unreadable. */
  read(): Promise<UsageSnapshot | null>;
  /** Files or directories whose changes should trigger a re-read. */
  watchTargets(): string[];
  /** Watch the targets recursively (needed for nested directory trees such as Codex sessions). */
  readonly watchRecursive?: boolean;
}

/** What the renderer receives for each detected agent. */
export interface UsageEntry {
  agent: AgentInfo;
  snapshot: UsageSnapshot | null;
}

export interface Point {
  x: number;
  y: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface Rect extends Point, Size {}

export interface LayoutState {
  scale: number;
}

export type ConnectorStatus = 'no_claude_dir' | 'not_connected' | 'connected';

/** The statusLine entry of ~/.claude/settings.json before and after connecting (null = no entry). */
export interface ConnectPreview {
  before: unknown;
  after: unknown;
}

export interface ToastMessage {
  message: string;
  kind: 'info' | 'error';
}

/** Content of the detail panel window. */
export interface FloatPanelData {
  entry: UsageEntry;
  preview: ConnectPreview | null;
  hint: string | null;
}

/** Geometry the bubble window reports (client coordinates, already scaled) so floating windows can be placed. */
export interface FloatLayout {
  /** The scaled column of bubbles. */
  stage: Rect;
  /** The bubble the open panel belongs to, if any. */
  bubble: Rect | null;
}

export type FloatRole = 'panel' | 'toast' | 'bar';
export interface FloatBarState {
  scale: number;
}
