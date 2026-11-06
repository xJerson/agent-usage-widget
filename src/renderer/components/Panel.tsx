import { forwardRef, useEffect, useState, type CSSProperties } from 'react';
import type { AntigravityClusterData, AntigravityModelKey, ConnectPreview, UsageEntry } from '../../shared/types';
import { formatAgo, formatRemaining, levelOf, resolveWindow, windowLabel } from '../../shared/usage';
import { CONNECTABLE_AGENTS } from '../../shared/connectAgents';
import { statusGradient } from '../lib/colors';
import { renderLogo } from '../lib/registry';

const clock = (ms: number): string =>
  new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

const pretty = (v: unknown): string => JSON.stringify(v ?? null, null, 2);

interface PanelProps {
  style?: CSSProperties;
  /** Fade/scale-in state, driven by the floating window once it has its final size. */
  shown?: boolean;
  entry: UsageEntry;
  now: number;
  /** While the one-time consent is shown: the statusLine before / after, so consent stays informed. */
  preview?: ConnectPreview | null;
  /** Shown under "Waiting for first prompt" while Claude Code is not connected. */
  hint?: string | null;
  antigravityCluster?: AntigravityClusterData;
}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { entry, now, preview = null, hint = null, style, shown = false, antigravityCluster },
  ref,
) {
  const [selectedKey, setSelectedKey] = useState<AntigravityModelKey>(() => antigravityCluster?.activeKey ?? 'gemini');
  const [primaryKey, setPrimaryKey] = useState<AntigravityModelKey>(() => antigravityCluster?.primaryKey ?? 'gemini');

  useEffect(() => {
    if (antigravityCluster) {
      setSelectedKey(antigravityCluster.activeKey);
      setPrimaryKey(antigravityCluster.primaryKey);
    }
  }, [antigravityCluster?.activeKey, antigravityCluster?.primaryKey]);

  const activeModelSummary = antigravityCluster?.models.find((m) => m.key === selectedKey);
  const { agent, snapshot } = entry;

  const displayAgent = activeModelSummary
    ? {
        ...agent,
        id: `antigravity:${activeModelSummary.key}`,
        name: `Antigravity · ${activeModelSummary.name}`,
        brand: activeModelSummary.brand,
        brandLight: activeModelSummary.brandLight,
        planLabel: activeModelSummary.planLabel,
      }
    : agent;

  const rawWindows = activeModelSummary
    ? activeModelSummary.windows
    : snapshot
    ? snapshot.windows
    : [];

  const windows = [...rawWindows].sort((x, y) => (x.order ?? x.minutes) - (y.order ?? y.minutes));
  const plan = (snapshot?.plan || displayAgent.planLabel).toUpperCase();
  const rootId = agent.id.startsWith('antigravity') ? 'antigravity' : agent.id;
  const connect = CONNECTABLE_AGENTS[rootId] ?? { name: agent.name, folder: '' };

  const handleSetPrimary = (key: AntigravityModelKey) => {
    setPrimaryKey(key);
    window.widget.setPrimaryModel('antigravity', key);
  };

  return (
    <div
      ref={ref}
      style={style}
      id={`p-${agent.id}`}
      className={`panel open${shown ? ' in' : ''}`}
      role="dialog"
      aria-label={`${displayAgent.name} usage limits`}
    >
      <div className="head">
        <div className="mark" style={{ borderColor: `${displayAgent.brand}55`, background: `${displayAgent.brand}1f` }}>
          {renderLogo(displayAgent, 18)}
        </div>
        <div>
          <div className="title">{displayAgent.name}</div>
          <div className="plan">Usage limits</div>
        </div>
        {plan && (
          <span className="badge" style={{ color: displayAgent.brandLight, borderColor: `${displayAgent.brand}55`, background: `${displayAgent.brand}22` }}>
            {plan}
          </span>
        )}
      </div>

      {antigravityCluster && (
        <div className="model-deck" role="tablist" aria-label="Modelos de Antigravity">
          {antigravityCluster.models.map((m) => {
            const isSelected = m.key === selectedKey;
            const isPrimary = m.key === primaryKey;
            return (
              <button
                key={m.key}
                type="button"
                className={`model-card-btn${isSelected ? ' active' : ''}`}
                role="tab"
                aria-selected={isSelected}
                style={{ ['--glow' as string]: `${m.brand}aa` } as CSSProperties}
                onClick={() => setSelectedKey(m.key)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSetPrimary(m.key);
                }}
                title={`${m.name} (Clic para ver métricas, Clic derecho para fijar como widget principal)`}
              >
                <div className="mc-header">
                  <span className="mc-label">
                    <span className="mc-dot" style={{ background: m.brand }} />
                    {m.name}
                  </span>
                  {isPrimary ? (
                    <span className="mc-star" title="Modelo fijado como principal en el widget colapsado">★ Principal</span>
                  ) : (
                    <span
                      className="mc-pin-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetPrimary(m.key);
                      }}
                      title="Fijar como modelo principal"
                    >
                      Fijar
                    </span>
                  )}
                </div>
                <div className="mc-metric-row">
                  <span className="mc-pct">
                    {Math.round(m.pct)}<small>%</small>
                  </span>
                  <span className="mc-cadence">{m.cadence}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {preview && (
        <div className="changes">
          <div className="m-label">What changes?</div>
          <p>
            {connect.name} will run a small hook (saved in <code>{connect.folder}</code>) as its statusLine command, so the
            widget can read your limits. An existing statusLine keeps running unchanged, a backup of settings.json is saved
            first, and you can disconnect from the tray menu.
          </p>
          <div className="diff-label">Before</div>
          <pre>{pretty(preview.before)}</pre>
          <div className="diff-label">After</div>
          <pre>{pretty(preview.after)}</pre>
        </div>
      )}
      {windows.length === 0 && (
        <div className="metric empty">
          <div className="m-label">Waiting for first prompt</div>
          <div className="m-sub">
            <span>{hint ?? 'Usage appears after the first request.'}</span>
          </div>
        </div>
      )}
      {windows.map((w) => {
        const r = resolveWindow(w, now);
        const [ca, cb] = statusGradient(displayAgent, levelOf(r.usedPercent));
        const label = w.label ?? windowLabel(w.minutes);
        const key = w.id ?? `${w.minutes}-${w.label ?? ''}`;
        return (
          <div className={`metric${r.limitReached ? ' limit' : ''}`} key={key}>
            <div className="m-top">
              <div className="m-meta">
                <span className="m-label">
                  {label}
                  {r.limitReached && <span className="m-limit">Limit reached</span>}
                </span>
                {w.models && (
                  <div className="m-models">
                    <span className="m-models-tag">Modelos:</span>
                    <span>{w.models}</span>
                  </div>
                )}
              </div>
              <span className="m-pct">
                <span>{Math.round(r.usedPercent)}</span>
                <small>%</small>
              </span>
            </div>
            <div className="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.usedPercent)}>
              <div
                className="fill"
                style={{ width: `${r.usedPercent}%`, background: `linear-gradient(90deg, ${ca}, ${cb})`, ['--glow' as string]: `${ca}99` } as CSSProperties}
              />
              <div className="ticks" />
            </div>
            <div className="m-sub">
              <span>
                {r.resetsAtMs !== null ? (
                  <>
                    Resets in <b>{formatRemaining(r.resetsAtMs - now)}</b>
                  </>
                ) : r.expired || r.usedPercent === 0 ? (
                  'Starts at next prompt'
                ) : (
                  'Reset time unknown'
                )}
              </span>
              <span>{r.resetsAtMs !== null ? clock(r.resetsAtMs) : ''}</span>
            </div>
          </div>
        );
      })}
      <div className="foot">{snapshot && snapshot.windows.length > 0 ? formatAgo(now - snapshot.updatedAt) : 'No data yet'}</div>
    </div>
  );
});
