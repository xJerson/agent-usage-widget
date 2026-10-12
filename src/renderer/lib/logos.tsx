/** Agent marks. The drawing code is ported 1:1 from the approved prototype. */

export function Burst({ color, size }: { color: string; size: number }) {
  const lines = [];
  for (let i = 0; i < 12; i++) {
    const a = ((i * 30 - 90) * Math.PI) / 180;
    const len = i % 2 ? 8.2 : 10.6;
    lines.push(
      <line
        key={i}
        x1={(Math.cos(a) * 1.6).toFixed(2)}
        y1={(Math.sin(a) * 1.6).toFixed(2)}
        x2={(Math.cos(a) * len).toFixed(2)}
        y2={(Math.sin(a) * len).toFixed(2)}
      />,
    );
  }
  return (
    <svg className="mk" width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true">
      <g stroke={color} strokeLinecap="round" strokeWidth="2.6">
        {lines}
      </g>
    </svg>
  );
}

/** Codex mark: cloud outline with a terminal prompt (>_) inside. */
export function CodexMark({ color, size }: { color: string; size: number }) {
  return (
    <svg className="mk" width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true">
      <g fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round">
        <path strokeWidth="2.2" d="M-6 6.2 A4.5 4.5 0 0 1 -6.2 -1.4 A6 6 0 0 1 5.2 -3.6 A4.8 4.8 0 0 1 6.2 6.2 Z" />
        <path strokeWidth="1.9" d="M-3.4 -0.6 L-0.8 1.9 L-3.4 4.4 M0.6 4.4 H4" />
      </g>
    </svg>
  );
}

/** Neutral mark for agents that have no dedicated logo yet. */
export function GenericMark({ color, size }: { color: string; size: number }) {
  return (
    <svg className="mk" width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true">
      <g fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
        <circle r="7" />
        <circle r="1.6" fill={color} />
      </g>
    </svg>
  );
}
