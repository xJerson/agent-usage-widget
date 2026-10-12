import type {
  ConnectorStatus,
  ConnectPreview,
  FloatBarState,
  FloatLayout,
  FloatPanelData,
  LayoutState,
  Size,
  ToastMessage,
  UsageEntry,
} from './types';

export const IPC = {
  usageGet: 'usage:get',
  usageUpdate: 'usage:update',
  layoutGet: 'layout:get',
  layoutChanged: 'layout:changed',
  reportSize: 'widget:report-size',
  dragStart: 'widget:drag-start',
  dragMove: 'widget:drag-move',
  dragEnd: 'widget:drag-end',
  setScale: 'widget:set-scale',
  editBegin: 'widget:edit-begin',
  editEnd: 'widget:edit-end',
  requestEdit: 'widget:request-edit',
  connectPrompt: 'connect:prompt',
  connectAnswer: 'connect:answer',
  connectorStatus: 'connector:status',
  connectorGetStatus: 'connector:get-status',
  connectPreviewGet: 'connect:preview-get',
  toast: 'toast',
  floatLayout: 'float:layout',
  floatPanel: 'float:panel',
  floatToast: 'float:toast',
  floatBar: 'float:bar',
  floatContent: 'float:content',
  floatSize: 'float:size',
  floatHidden: 'float:hidden',
  barAnswer: 'float:bar-answer',
  editAnswer: 'widget:edit-answer',
} as const;

/** Strict API exposed on `window.widget` by the preload script. */
export interface WidgetApi {
  getUsage(): Promise<UsageEntry[]>;
  onUsage(cb: (entries: UsageEntry[]) => void): () => void;
  getLayout(): Promise<LayoutState>;
  onLayout(cb: (layout: LayoutState) => void): () => void;
  /** Content size in CSS px (excluding the transparent padding the shell adds). */
  reportSize(size: Size): void;
  /** Drag deltas are in screen px relative to the drag start. */
  dragStart(): void;
  dragMove(dx: number, dy: number): void;
  dragEnd(): void;
  setScale(scale: number): void;
  editBegin(): void;
  editEnd(confirm: boolean): void;
  /** Fired when the tray asks to enter edit mode. */
  onRequestEdit(cb: () => void): () => void;
  /** Claude Code connector: status, one-time consent prompt on the bubble, and main-process toasts. */
  getConnectorStatus(): Promise<ConnectorStatus>;
  onConnectorStatus(cb: (status: ConnectorStatus) => void): () => void;
  onConnectPrompt(cb: (preview: ConnectPreview) => void): () => void;
  getConnectPreview(): Promise<ConnectPreview | null>;
  answerConnect(accept: boolean): void;
  /** Bubble window -> main: geometry and content for the floating windows (panel, toast, edit bar). */
  floatLayout(layout: FloatLayout): void;
  floatPanel(data: FloatPanelData | null): void;
  floatToast(toast: ToastMessage): void;
  floatBar(state: FloatBarState | null): void;
  /** Edit bar window -> main -> bubble window. */
  barAnswer(confirm: boolean): void;
  onEditAnswer(cb: (confirm: boolean) => void): () => void;
  /** Floating windows: content pushed by main, size report (resolves once the window has its size), fade-out done. */
  onFloatContent(cb: (content: unknown) => void): () => void;
  floatSize(size: Size): Promise<void>;
  floatHidden(): void;
}

/** Transparent padding (px) around the content, room for glow, shadows and edit handles. */
export const WINDOW_PADDING = 32;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;
