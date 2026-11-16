/** Shared gradients and patterns for the rack scene. Rendered once inside each scene <svg>. */
export function RackDefs() {
  return (
    <defs>
      <linearGradient id="rm-steel" x1="0" x2="1">
        <stop offset="0" stopColor="#1a1d23" />
        <stop offset="0.45" stopColor="#2a2e36" />
        <stop offset="1" stopColor="#16181d" />
      </linearGradient>
      <linearGradient id="rm-panel" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#2b2f37" />
        <stop offset="1" stopColor="#15171c" />
      </linearGradient>
      <linearGradient id="rm-brushed" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#3b4049" />
        <stop offset="0.08" stopColor="#2c3038" />
        <stop offset="0.5" stopColor="#24272e" />
        <stop offset="0.92" stopColor="#1d2026" />
        <stop offset="1" stopColor="#111317" />
      </linearGradient>
      <pattern id="rm-brush-lines" width="6" height="2" patternUnits="userSpaceOnUse">
        <rect width="6" height="2" fill="transparent" />
        <line x1="0" y1="0.5" x2="6" y2="0.5" stroke="#ffffff" strokeOpacity="0.025" />
      </pattern>
      <linearGradient id="rm-bezel" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#202227" />
        <stop offset="1" stopColor="#0b0c0e" />
      </linearGradient>
      <pattern id="rm-mesh" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#0d0e11" />
        <polygon points="3,0.6 5.4,1.8 5.4,4.2 3,5.4 0.6,4.2 0.6,1.8" fill="#24272d" />
      </pattern>
      <pattern id="rm-blank" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="10" height="10" fill="#14161a" />
        <line x1="0" y1="0" x2="0" y2="10" stroke="#1c1f24" strokeWidth="3" />
      </pattern>
      <pattern id="rm-vent" width="8" height="4" patternUnits="userSpaceOnUse">
        <rect width="8" height="4" fill="#1b1d22" />
        <rect x="1" y="1" width="6" height="1.6" rx="0.8" fill="#0a0b0d" />
      </pattern>
      <linearGradient id="rm-pcb" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#1f7a3a" />
        <stop offset="1" stopColor="#14592a" />
      </linearGradient>
      <linearGradient id="rm-glass" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#7dd3fc" stopOpacity="0.18" />
        <stop offset="0.5" stopColor="#0f172a" stopOpacity="0.55" />
        <stop offset="1" stopColor="#38bdf8" stopOpacity="0.12" />
      </linearGradient>
      <radialGradient id="rm-fan" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#a855f7" stopOpacity="0.9" />
        <stop offset="0.65" stopColor="#6d28d9" stopOpacity="0.35" />
        <stop offset="1" stopColor="#4c1d95" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="rm-laptop-screen" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#1e3a8a" />
        <stop offset="1" stopColor="#0f172a" />
      </linearGradient>
      <linearGradient id="rm-router" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#f8fafc" />
        <stop offset="1" stopColor="#cbd5e1" />
      </linearGradient>
      <filter id="rm-shadow" x="-10%" y="-10%" width="120%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.55" />
      </filter>
      <filter id="rm-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="1.4" result="b" />
        <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
      <radialGradient id="rm-ambient" cx="0.5" cy="0.45" r="0.6">
        <stop offset="0" stopColor="#1e293b" stopOpacity="0.55" />
        <stop offset="1" stopColor="#0b0f17" stopOpacity="0" />
      </radialGradient>
    </defs>
  );
}
