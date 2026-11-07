import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FLOAT_PADDING } from '../shared/ipc';
import type { FloatBarState, FloatPanelData, FloatRole, ToastMessage } from '../shared/types';
import { EditBar } from './components/EditChrome';
import { Panel } from './components/Panel';
import { useNow } from './lib/hooks';

type Phase = 'hidden' | 'measuring' | 'in' | 'out';
const FADE_OUT_MS = 220;

/**
 * A floating window (panel, toast or edit bar). It resizes and positions itself while nothing is visible:
 *  1. content arrives -> rendered invisible ("measuring") -> its size is reported and awaited (the main process sizes,
 *     places and shows the window),
 *  2. only then the content fades in ("in");
 *  3. on close it fades out first ("out") and only afterwards tells main to hide the window.
 */
export function FloatApp({ role }: { role: FloatRole }) {
  const [content, setContent] = useState<unknown>(null);
  const [phase, setPhase] = useState<Phase>('hidden');
  const shellRef = useRef<HTMLDivElement>(null);
  const outTimer = useRef<number | undefined>(undefined);
  const now = useNow(1000);

  useEffect(
    () =>
      window.widget.onFloatContent((c) => {
        window.clearTimeout(outTimer.current);
        if (c === null) {
          setPhase((p) => (p === 'hidden' ? p : 'out'));
          outTimer.current = window.setTimeout(() => {
            setContent(null);
            setPhase('hidden');
            window.widget.floatHidden();
          }, FADE_OUT_MS);
          return;
        }
        setContent(c);
        setPhase((p) => (p === 'in' || p === 'out' ? 'in' : 'measuring'));
      }),
    [],
  );

  // Size handshake: report, wait for main to apply it, then fade in.
  useLayoutEffect(() => {
    const el = shellRef.current;
    if (!el || content === null) return;
    let cancelled = false;
    const report = (): Promise<void> => {
      const r = el.getBoundingClientRect();
      return window.widget.floatSize({ width: r.width, height: r.height });
    };
    if (phase === 'measuring') {
      void report().then(() => {
        if (cancelled) return;
        // wait for a frame painted at the new window size before starting the fade
        requestAnimationFrame(() => requestAnimationFrame(() => !cancelled && setPhase((p) => (p === 'measuring' ? 'in' : p))));
      });
    }
    const ro = new ResizeObserver(() => void report());
    ro.observe(el);
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [phase === 'measuring', content]);

  const shown = phase === 'in';
  return (
    <div className="float-shell" ref={shellRef} data-phase={phase} style={{ padding: FLOAT_PADDING[role] }}>
      {content !== null && role === 'panel' && <PanelBody data={content as FloatPanelData} now={now} shown={shown} />}
      {content !== null && role === 'toast' && <ToastBody toast={content as ToastMessage} shown={shown} />}
      {content !== null && role === 'bar' && <BarBody state={content as FloatBarState} shown={shown} />}
    </div>
  );
}

function PanelBody({ data, now, shown }: { data: FloatPanelData; now: number; shown: boolean }) {
  return <Panel entry={data.entry} now={now} preview={data.preview} hint={data.hint} shown={shown} />;
}

function ToastBody({ toast, shown }: { toast: ToastMessage; shown: boolean }) {
  return (
    <div className={`toast${toast.kind === 'error' ? ' error' : ''}${shown ? ' in' : ''}`} role={toast.kind === 'error' ? 'alert' : 'status'}>
      {toast.message}
    </div>
  );
}

function BarBody({ state, shown }: { state: FloatBarState; shown: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') window.widget.barAnswer(false);
      else if (e.key === 'Enter') window.widget.barAnswer(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className={`editbar-wrap${shown ? ' in' : ''}`}>
      <EditBar scale={state.scale} onCancel={() => window.widget.barAnswer(false)} onConfirm={() => window.widget.barAnswer(true)} />
    </div>
  );
}
