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

/** Antigravity / Gemini mark: Google's iconic 4-pointed sparkle star with secondary spark. */
export function AntigravityMark({ color, size }: { color?: string; size: number }) {
  const gradId = `gemini-grad-${size}`;
  return (
    <svg className="mk" width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="-10" y1="-10" x2="10" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4E82EE" />
          <stop offset="45%" stopColor="#7C75FF" />
          <stop offset="100%" stopColor="#A87FFB" />
        </linearGradient>
      </defs>
      {/* Primary Gemini Sparkle */}
      <path
        fill={color && color !== '#5fd3c4' && color !== '#7be0d2' ? color : `url(#${gradId})`}
        d="M 0 -10.5 C 0 -2.4 2.4 0 10.5 0 C 2.4 0 0 2.4 0 10.5 C 0 2.4 -2.4 0 -10.5 0 C -2.4 0 0 -2.4 0 -10.5 Z"
      />
      {/* Secondary Companion Spark */}
      <path
        fill="#A87FFB"
        opacity="0.85"
        d="M 6.5 -8.8 C 6.5 -7.2 7.2 -6.5 8.8 -6.5 C 7.2 -6.5 6.5 -5.8 6.5 -4.2 C 6.5 -5.8 5.8 -6.5 4.2 -6.5 C 5.8 -6.5 6.5 -7.2 6.5 -8.8 Z"
      />
    </svg>
  );
}

export const GeminiMark = AntigravityMark;

/** Argon mark: Google's reasoning sparkle with luminous nucleus and thinking spark in purple. */
export function ArgonMark({ color, size }: { color?: string; size: number }) {
  const gradId = `argon-grad-${size}`;
  return (
    <svg className="mk" width={size} height={size} viewBox="-12 -12 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="-10" y1="-10" x2="10" y2="10" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#c084fc" />
          <stop offset="50%" stopColor="#9333ea" />
          <stop offset="100%" stopColor="#7e22ce" />
        </linearGradient>
      </defs>
      <path
        fill={color && color !== '#9333ea' && color !== '#c084fc' ? color : `url(#${gradId})`}
        d="M 0 -10.5 C 0 -2.4 2.4 0 10.5 0 C 2.4 0 0 2.4 0 10.5 C 0 2.4 -2.4 0 -10.5 0 C -2.4 0 0 -2.4 0 -10.5 Z"
      />
      <circle cx="0" cy="0" r="2.8" fill="#ffffff" opacity="0.95" />
      <circle cx="0" cy="0" r="1.4" fill="#581c87" />
      <path
        fill="#e9d5ff"
        opacity="0.9"
        d="M 6.5 -8.8 C 6.5 -7.2 7.2 -6.5 8.8 -6.5 C 7.2 -6.5 6.5 -5.8 6.5 -4.2 C 6.5 -5.8 5.8 -6.5 4.2 -6.5 C 5.8 -6.5 6.5 -7.2 6.5 -8.8 Z"
      />
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
