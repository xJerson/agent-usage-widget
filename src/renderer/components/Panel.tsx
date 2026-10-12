import { forwardRef, type CSSProperties } from 'react';
import type { ConnectPreview, UsageEntry } from '../../shared/types';
import { formatAgo, formatRemaining, levelOf, resolveWindow, windowLabel } from '../../shared/usage';
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
}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel({ entry, now, preview = null, hint = null, style, shown = false }, ref) {
  const { agent, snapshot } = entry;
  const windows = snapshot ? [...snapshot.windows].sort((x, y) => x.minutes - y.minutes) : [];
  const plan = (snapshot?.plan || agent.planLabel).toUpperCase();

  return (
    <div ref={ref} style={style} id={`p-${agent.id}`} className={`panel open${shown ? ' in' : ''}`} role="dialog" aria-label={`${agent.name} usage limits`}>
      <div className="head">
        <div className="mark" style={{ borderColor: `${agent.brand}55`, background: `${agent.brand}1f` }}>
          {renderLogo(agent, 18)}
        </div>
        <div>
          <div className="title">{agent.name}</div>
          <div className="plan">Usage limits</div>
        </div>
        {plan && (
          <span className="badge" style={{ color: agent.brandLight, borderColor: `${agent.brand}55`, background: `${agent.brand}22` }}>
            {plan}
          </span>
        )}
      </div>

      {preview && (
        <div className="changes">
          <div className="m-label">What changes?</div>
          <p>
            Claude Code will run a small hook (saved in <code>~/.claude/usage-widget</code>) as its statusLine command, so the
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
        const [ca, cb] = statusGradient(agent, levelOf(r.usedPercent));
        return (
          <div className="metric" key={w.minutes}>
            <div className="m-top">
              <span className="m-label">{windowLabel(w.minutes)}</span>
              <span className="m-pct">
                <span>{Math.round(r.usedPercent)}</span>
                <small>%</small>
              </span>
            </div>
            <div className="bar" role="progressbar" aria-label={windowLabel(w.minutes)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.usedPercent)}>
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
      <div className="foot">{snapshot ? formatAgo(now - snapshot.updatedAt) : 'No data yet'}</div>
    </div>
  );
});
