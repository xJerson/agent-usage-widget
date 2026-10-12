import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import type { UsageEntry } from '../../shared/types';
import { headWindow, levelOf, resolveWindow } from '../../shared/usage';
import { statusGradient } from '../lib/colors';
import { renderLogo } from '../lib/registry';

const R = 46;
const C = 2 * Math.PI * R;
const DRAG_THRESHOLD = 5;
const CLICK_DELAY = 230;

interface Props {
  entry: UsageEntry;
  now: number;
  open: boolean;
  editing: boolean;
  onToggle(): void;
  onEdit(): void;
  /** One-time Claude Code consent: dimmed logo, confirm / cancel buttons and a caption on top of the bubble. */
  consent?: { onAnswer(accept: boolean): void; onInfo(): void } | null;
}

export function Bubble({ entry, now, open, editing, onToggle, onEdit, consent = null }: Props) {
  // Keep the overlay mounted briefly after the answer so it can animate away.
  const [overlay, setOverlay] = useState(false);
  useEffect(() => {
    if (consent) {
      setOverlay(true);
      return;
    }
    const t = window.setTimeout(() => setOverlay(false), 280);
    return () => window.clearTimeout(t);
  }, [consent !== null]);
  const last = useRef(consent);
  if (consent) last.current = consent;
  const ov = consent ?? last.current;

  const { agent, snapshot } = entry;
  const head = snapshot ? headWindow(snapshot.windows) : null;
  const pct = head ? resolveWindow(head, now).usedPercent : 0;
  const [a, b] = statusGradient(agent, levelOf(pct));
  const theta = (2 * Math.PI * pct) / 100;

  // Pointer handling: drag moves the whole widget (5px threshold), a click is suppressed after a drag,
  // a single click toggles the panel after a short delay so a double-click can enter edit mode instead.
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const movedRef = useRef(false);
  const timerRef = useRef<number | undefined>(undefined);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    startRef.current = { x: e.screenX, y: e.screenY };
    movedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>): void => {
    const s = startRef.current;
    if (!s) return;
    const dx = e.screenX - s.x;
    const dy = e.screenY - s.y;
    if (!movedRef.current) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      movedRef.current = true;
      window.clearTimeout(timerRef.current);
      document.body.classList.add('dragging');
      window.widget.dragStart();
    }
    window.widget.dragMove(dx, dy);
  };
  const endPointer = (): void => {
    if (!startRef.current) return;
    startRef.current = null;
    document.body.classList.remove('dragging');
    if (movedRef.current) window.widget.dragEnd();
  };
  const onClick = (): void => {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    window.clearTimeout(timerRef.current);
    if (editing) return;
    timerRef.current = window.setTimeout(onToggle, CLICK_DELAY);
  };
  const onDoubleClick = (): void => {
    window.clearTimeout(timerRef.current);
    onEdit();
  };

  const style = { '--glow': `${a}aa` } as CSSProperties;
  const gid = `g-${agent.id}`;

  return (
    <div className="bubble-host">
    <button
      type="button"
      className={`bubble${pct >= 90 ? ' hot' : ''}${consent ? ' consenting' : ''}`}
      style={style}
      aria-expanded={open}
      aria-controls={`p-${agent.id}`}
      aria-label={`${agent.name} usage, ${Math.round(pct)}%`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
    >
      <svg className="ring" width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
        </defs>
        <circle className="ring-track" cx="52" cy="52" r={R} fill="none" strokeWidth="7" />
        <circle
          className="ring-fill"
          cx="52"
          cy="52"
          r={R}
          fill="none"
          stroke={`url(#${gid})`}
          strokeWidth="7"
          strokeLinecap="round"
          style={{ strokeDasharray: C, strokeDashoffset: C * (1 - pct / 100), ['--glow' as string]: `${a}aa` }}
        />
        <circle
          className="head-dot"
          r="2.6"
          fill="#fff"
          cx={(52 + R * Math.cos(theta)).toFixed(2)}
          cy={(52 + R * Math.sin(theta)).toFixed(2)}
          style={{ display: pct > 1 ? '' : 'none', ['--glow' as string]: a }}
        />
      </svg>
      <span className="logo">{renderLogo(agent, 46)}</span>
      <span className="name-tag" style={{ background: agent.brand }}>
        {agent.name}
      </span>
      <span className="pct-chip">{Math.round(pct)}%</span>
    </button>
    {overlay && ov && (
      <div className={`consent${consent ? '' : ' out'}`}>
        <div className="consent-buttons">
          <button type="button" className="eb-btn cancel" aria-label="Not now" title="Not now" onClick={() => ov.onAnswer(false)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
            </svg>
          </button>
          <button type="button" className="eb-btn ok" aria-label="Connect Claude Code" title="Connect" onClick={() => ov.onAnswer(true)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 8.5l3.2 3.2L13 4.8" />
            </svg>
          </button>
        </div>
        <button type="button" className="consent-tag" aria-label="Connect Claude Code? Show what changes" title="What changes?" onClick={ov.onInfo}>
          Connect Claude?
        </button>
      </div>
    )}
    </div>
  );
}
