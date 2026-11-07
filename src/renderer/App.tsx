import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { splitAntigravityEntry } from '../shared/antigravityModels';
import { connectHintFor } from '../shared/connectHint';
import { clampScale } from '../shared/geometry';
import type { AntigravityModelKey, ConnectorStatus, ConnectPreview } from '../shared/types';
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
  // Per agent id: the consent prompts waiting for an answer, and each connector's status.
  const [prompts, setPrompts] = useState<Record<string, ConnectPreview>>({});
  const [connectors, setConnectors] = useState<Record<string, ConnectorStatus>>({});
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [agyExpanded, setAgyExpanded] = useState(() => {
    try {
      return localStorage.getItem('agy_expanded') === 'true';
    } catch {
      return false;
    }
  });
  const [primaryModel, setPrimaryModel] = useState<AntigravityModelKey>(() => {
    try {
      const saved = localStorage.getItem('agy_primary_model');
      if (saved === 'gemini' || saved === '3p' || saved === 'argon') return saved;
    } catch {}
    return 'gemini';
  });

  const showToast = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    window.widget.floatToast({ message, kind });
  }, []);

  const selectPrimaryModel = useCallback(
    (key: AntigravityModelKey, collapse = false) => {
      setPrimaryModel(key);
      try {
        localStorage.setItem('agy_primary_model', key);
      } catch {}
      const name = key === 'argon' ? 'Argon 4' : key === '3p' ? 'Claude / 3P' : 'Gemini';
      showToast(`${name} seleccionado`);
      if (collapse) {
        setAgyExpanded(false);
        try {
          localStorage.setItem('agy_expanded', 'false');
        } catch {}
      }
    },
    [showToast],
  );

  const closeAgyExpanded = useCallback(() => {
    if (editingRef.current) return;
    setOpenId(null);
    setAgyExpanded(false);
    try {
      localStorage.setItem('agy_expanded', 'false');
    } catch {}
  }, []);

  const toggleAgyExpanded = useCallback(() => {
    if (editingRef.current) return;
    setOpenId(null);
    setAgyExpanded((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('agy_expanded', String(next));
      } catch {}
      return next;
    });
  }, []);

  const shellRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const scalerRef = useRef<HTMLDivElement>(null);
  const editingRef = useRef(false);
  editingRef.current = editing;

  // Agent connectors (Claude Code, Antigravity): status and the one-time consent shown on the bubble.
  useEffect(() => {
    void window.widget.getConnectorStatus().then(setConnectors);
    void window.widget.getConnectPreview().then((p) => setPrompts((cur) => ({ ...p, ...cur })));
    const offs = [
      window.widget.onConnectorStatus((agentId, status) => setConnectors((cur) => ({ ...cur, [agentId]: status }))),
      window.widget.onConnectPrompt((agentId, preview) => setPrompts((cur) => ({ ...cur, [agentId]: preview }))),
    ];
    return () => offs.forEach((off) => off());
  }, []);

  const answerConnect = useCallback((agentId: string, accept: boolean) => {
    setPrompts(({ [agentId]: _answered, ...rest }) => rest);
    setOpenId((id) => (id === agentId ? null : id));
    window.widget.answerConnect(agentId, accept);
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

  const openEntry = (() => {
    if (!openId) return null;
    if (agyExpanded) return null;
    const direct = entries.find((e) => e.agent.id === openId);
    if (direct) {
      if (openId === 'antigravity') {
        const sub = splitAntigravityEntry(direct);
        return primaryModel === 'argon' ? sub.argon : primaryModel === '3p' ? sub.thirdParty : sub.gemini;
      }
      return direct;
    }
    return null;
  })();

  // Geometry for the floating windows: the scaled column and the open bubble, in client coordinates.
  const lastLayout = useRef('');
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const r = stage.getBoundingClientRect();
    const item = openId && !agyExpanded ? scalerRef.current?.querySelector<HTMLElement>(`[data-agent="${openId}"]`) : null;
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
    const rootAgentId = openEntry ? (openEntry.agent.id.startsWith('antigravity') ? 'antigravity' : openEntry.agent.id) : null;
    window.widget.floatPanel(
      openEntry && rootAgentId
        ? {
            entry: openEntry,
            preview: prompts[openEntry.agent.id] ?? prompts[rootAgentId] ?? null,
            hint: connectHintFor({
              agentId: rootAgentId,
              status: connectors[rootAgentId] ?? 'no_agent_dir',
              consentVisible: rootAgentId in prompts,
            }),
          }
        : null,
    );
  }, [openEntry, prompts, connectors]);

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
            {entries.map((entry) => {
              if (entry.agent.id === 'antigravity') {
                const sub = splitAntigravityEntry(entry);
                if (agyExpanded) {
                  return (
                    <div className="antigravity-cluster" key={entry.agent.id}>
                      <div className="item sub-item in" data-agent="antigravity:3p">
                        <Bubble
                          entry={{
                            ...sub.thirdParty,
                            agent: {
                              ...sub.thirdParty.agent,
                              name: primaryModel === '3p' ? '✓ Claude 3P' : 'Claude 3P',
                            },
                          }}
                          logoId="antigravity:3p"
                          now={now}
                          open={false}
                          editing={editing}
                          onToggle={() => selectPrimaryModel('3p', true)}
                          onEdit={enterEdit}
                          onContextMenu={closeAgyExpanded}
                        />
                      </div>
                      <div className="item sub-item in" data-agent="antigravity:argon">
                        <Bubble
                          entry={{
                            ...sub.argon,
                            agent: {
                              ...sub.argon.agent,
                              name: primaryModel === 'argon' ? '✓ Argon 4' : 'Argon 4',
                            },
                          }}
                          logoId="antigravity:argon"
                          now={now}
                          open={false}
                          editing={editing}
                          onToggle={() => selectPrimaryModel('argon', true)}
                          onEdit={enterEdit}
                          onContextMenu={closeAgyExpanded}
                        />
                      </div>
                      <div className="item" data-agent="antigravity:gemini">
                        <Bubble
                          entry={{
                            ...sub.gemini,
                            agent: {
                              ...sub.gemini.agent,
                              name: primaryModel === 'gemini' ? '✓ Gemini' : 'Gemini',
                            },
                          }}
                          logoId="antigravity:gemini"
                          now={now}
                          open={false}
                          editing={editing}
                          onToggle={() => selectPrimaryModel('gemini', true)}
                          onEdit={enterEdit}
                          onContextMenu={closeAgyExpanded}
                          consent={
                            prompts[entry.agent.id] && !editing
                              ? {
                                  onAnswer: (accept) => answerConnect(entry.agent.id, accept),
                                  onInfo: () => setOpenId((id) => (id === entry.agent.id ? null : entry.agent.id)),
                                }
                              : null
                          }
                        />
                      </div>
                    </div>
                  );
                }

                const activeSubEntry =
                  primaryModel === 'argon' ? sub.argon :
                  primaryModel === '3p' ? sub.thirdParty :
                  sub.gemini;

                const primaryName =
                  primaryModel === 'argon' ? 'Argon 4' :
                  primaryModel === '3p' ? 'Claude 3P' :
                  'Gemini';

                return (
                  <div className="item" key={entry.agent.id} data-agent="antigravity">
                    <Bubble
                      entry={{
                        ...activeSubEntry,
                        agent: {
                          ...activeSubEntry.agent,
                          id: 'antigravity',
                          name: `Antigravity · ${primaryName}`,
                        },
                      }}
                      logoId={`antigravity:${primaryModel}`}
                      now={now}
                      open={openId === 'antigravity'}
                      editing={editing}
                      onToggle={() => setOpenId((id) => (id === 'antigravity' ? null : 'antigravity'))}
                      onEdit={enterEdit}
                      onContextMenu={toggleAgyExpanded}
                      consent={
                        prompts[entry.agent.id] && !editing
                          ? {
                              onAnswer: (accept) => answerConnect(entry.agent.id, accept),
                              onInfo: () => setOpenId((id) => (id === entry.agent.id ? null : entry.agent.id)),
                            }
                          : null
                      }
                    />
                  </div>
                );
              }

              return (
                <div className="item" key={entry.agent.id} data-agent={entry.agent.id}>
                  <Bubble
                    entry={entry}
                    now={now}
                    open={openId === entry.agent.id}
                    editing={editing}
                    onToggle={() => setOpenId((id) => (id === entry.agent.id ? null : entry.agent.id))}
                    onEdit={enterEdit}
                    consent={
                      prompts[entry.agent.id] && !editing
                        ? {
                            onAnswer: (accept) => answerConnect(entry.agent.id, accept),
                            onInfo: () => setOpenId((id) => (id === entry.agent.id ? null : entry.agent.id)),
                          }
                        : null
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
        {editing && <EditFrame width={stage.width as number} height={stage.height as number} scale={scale} onScale={setScale} />}
      </div>
    </div>
  );
}
