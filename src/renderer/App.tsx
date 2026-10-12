import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { connectHintFor } from '../shared/connectHint';
import { clampScale } from '../shared/geometry';
import type { ConnectorStatus, ConnectPreview } from '../shared/types';
import { Bubble } from './components/Bubble';
import { EditFrame } from './components/EditChrome';
import { useNow, useUsage } from './lib/hooks';

/**
 * The bubble window. Only the bubbles (and the edit frame) live here, so this window never has to resize when a
 * panel opens: the detail panel, the toast and the edit bar are separate floating windows (see FloatApp) that are
 * placed next to the column using the geometry reported below.
 */
export function App() {
  const entries = useUsage();
  const now = useNow(1000);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [scale, setScale] = useState(1);
  const [prompt, setPrompt] = useState<ConnectPreview | null>(null);
  const [connector, setConnector] = useState<ConnectorStatus>('no_claude_dir');
  const [natural, setNatural] = useState({ width: 0, height: 0 });

  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const editingRef = useRef(false);
  editingRef.current = editing;

  const showToast = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    window.widget.floatToast({ message, kind });
  }, []);

  // Claude Code connector: status and the one-time consent shown on the bubble.
  useEffect(() => {
    void window.widget.getConnectorStatus().then(setConnector);
    void window.widget.getConnectPreview().then((p) => p && setPrompt(p));
    const offs = [window.widget.onConnectorStatus(setConnector), window.widget.onConnectPrompt(setPrompt)];
    return () => offs.forEach((off) => off());
  }, []);

  const answerConnect = useCallback((accept: boolean) => {
    setPrompt(null);
    setOpenId((id) => (id === 'claude' ? null : id));
    window.widget.answerConnect(accept);
  }, []);

  // Persisted scale + restores after a cancelled edit.
  useEffect(() => {
    void window.widget.getLayout().then((l) => setScale(clampScale(l.scale)));
    return window.widget.onLayout((l) => setScale(clampScale(l.scale)));
  }, []);

  // Toasts when agents appear or disappear.
  const known = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const next = new Map(entries.map((e) => [e.agent.id, e.agent.name]));
    const prev = known.current;
    known.current = next;
    if (prev === null) {
      if (next.size) showToast(`${[...next.values()].join(', ')} detected`);
      return;
    }
    const added = [...next].filter(([id]) => !prev.has(id)).map(([, n]) => n);
    const removed = [...prev].filter(([id]) => !next.has(id)).map(([, n]) => n);
    if (removed.length) showToast(`${removed.join(', ')} disconnected`);
    else if (added.length) showToast(`${added.join(', ')} detected`);
    setOpenId((id) => (id && !next.has(id) ? null : id));
  }, [entries, showToast]);

  // Natural (unscaled) size of the bubble column.
  useLayoutEffect(() => {
    const el = scalerRef.current;
    if (!el) return;
    const measure = (): void => setNatural({ width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Tell the main process how big the (scaled) bubble column is.
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el) return;
    const report = (): void => {
      const r = el.getBoundingClientRect();
      window.widget.reportSize({ width: r.width, height: r.height });
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const openEntry = entries.find((e) => e.agent.id === openId) ?? null;

  // Geometry for the floating windows: the scaled column and the open bubble, in client coordinates.
  const lastLayout = useRef('');
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const item = openId ? scalerRef.current?.querySelector<HTMLElement>(`[data-agent="${openId}"]`) : null;
    const b = item?.getBoundingClientRect();
    const layout = {
      stage: { x: r.left, y: r.top, width: r.width, height: r.height },
      bubble: b ? { x: b.left, y: b.top, width: b.width, height: b.height } : null,
    };
    const key = JSON.stringify(layout);
    if (key === lastLayout.current) return;
    lastLayout.current = key;
    window.widget.floatLayout(layout);
  });

  // Content of the floating panel.
  useEffect(() => {
    window.widget.floatPanel(
      openEntry
        ? {
            entry: openEntry,
            preview: openEntry.agent.id === 'claude' ? prompt : null,
            hint: connectHintFor({ agentId: openEntry.agent.id, status: connector, consentVisible: prompt !== null }),
          }
        : null,
    );
  }, [openEntry, prompt, connector]);

  const enterEdit = useCallback(() => {
    if (editingRef.current) return;
    setEditing(true);
    setOpenId(null);
    window.widget.editBegin();
    showToast('Edit mode: drag to move, corners to resize');
  }, [showToast]);

  const exitEdit = useCallback(
    (confirm: boolean) => {
      if (!editingRef.current) return;
      setEditing(false);
      window.widget.editEnd(confirm);
      showToast(confirm ? 'Saved' : 'Changes discarded');
    },
    [showToast],
  );

  useEffect(() => window.widget.onRequestEdit(enterEdit), [enterEdit]);
  useEffect(() => window.widget.onEditAnswer(exitEdit), [exitEdit]);

  // The edit bar is its own window: it shows while editing and follows the scale readout.
  useEffect(() => {
    window.widget.floatBar(editing ? { scale } : null);
  }, [editing, scale]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !editingRef.current) setOpenId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const stage: CSSProperties = { width: natural.width * scale, height: natural.height * scale };

  return (
    <div className="shell" ref={shellRef}>
      <div className="stage" ref={stageRef} style={stage}>
        <div className="scaler" ref={scalerRef} style={{ transform: `scale(${scale})` }}>
          <div className="column">
            {entries.map((entry) => (
              <div className="item" key={entry.agent.id} data-agent={entry.agent.id}>
                <Bubble
                  entry={entry}
                  now={now}
                  open={openId === entry.agent.id}
                  editing={editing}
                  onToggle={() => setOpenId((id) => (id === entry.agent.id ? null : entry.agent.id))}
                  onEdit={enterEdit}
                  consent={
                    entry.agent.id === 'claude' && prompt && !editing
                      ? { onAnswer: answerConnect, onInfo: () => setOpenId((id) => (id === 'claude' ? null : 'claude')) }
                      : null
                  }
                />
              </div>
            ))}
          </div>
        </div>
        {editing && <EditFrame width={stage.width as number} height={stage.height as number} scale={scale} onScale={setScale} />}
      </div>
    </div>
  );
}
