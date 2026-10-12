import { useRef, type PointerEvent } from 'react';
import { resizeFromCorner, type Corner } from '../../shared/geometry';

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

interface FrameProps {
  /** Scaled content size in px and the current scale. */
  width: number;
  height: number;
  scale: number;
  onScale(scale: number): void;
}

/** Dashed frame with four corner handles: proportional resize that keeps the opposite corner fixed. */
export function EditFrame({ width, height, scale, onScale }: FrameProps) {
  const grab = useRef<{ corner: Corner; x: number; y: number; w: number; h: number; s: number } | null>(null);

  const down = (corner: Corner) => (e: PointerEvent<HTMLSpanElement>) => {
    grab.current = { corner, x: e.screenX, y: e.screenY, w: width, h: height, s: scale };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add('dragging');
    window.widget.dragStart();
    e.preventDefault();
  };
  const move = (e: PointerEvent<HTMLSpanElement>): void => {
    const g = grab.current;
    if (!g) return;
    const r = resizeFromCorner(g.corner, { width: g.w, height: g.h, scale: g.s }, { dx: e.screenX - g.x, dy: e.screenY - g.y });
    onScale(r.scale);
    window.widget.setScale(r.scale);
    window.widget.dragMove(r.anchorDx, r.anchorDy);
  };
  const up = (): void => {
    if (!grab.current) return;
    grab.current = null;
    document.body.classList.remove('dragging');
    window.widget.dragEnd();
  };

  return (
    <div className="frame" aria-hidden="true">
      {CORNERS.map((c) => (
        <span key={c} className={`handle ${c}`} onPointerDown={down(c)} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      ))}
    </div>
  );
}

interface BarProps {
  scale: number;
  onCancel(): void;
  onConfirm(): void;
}

export function EditBar({ scale, onCancel, onConfirm }: BarProps) {
  return (
    <div className="editbar" role="toolbar" aria-label="Edit widget size and position">
      <span className="eb-label">Drag the corners to resize</span>
      <span className="eb-val" aria-live="polite">
        {Math.round(scale * 100)}%
      </span>
      <button type="button" className="eb-btn cancel" aria-label="Discard changes" title="Discard (Esc)" onClick={onCancel}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
        </svg>
      </button>
      <button type="button" className="eb-btn ok" aria-label="Save changes" title="Save (Enter)" onClick={onConfirm}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8.5l3.2 3.2L13 4.8" />
        </svg>
      </button>
    </div>
  );
}
