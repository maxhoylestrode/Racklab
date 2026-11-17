/** Shared gradients and patterns for the rack scene. Rendered once inside each scene <svg>. */
export function RackDefs() {
  return (
    <defs>
      {/* Cabinet: dark powder-coated steel with a faint vertical brush and light falling from the top. */}
      <linearGradient id="rm-steel" x1="0" x2="1">
        <stop offset="0" stopColor="#14161a" />
        <stop offset="0.5" stopColor="#1d2026" />
        <stop offset="1" stopColor="#131519" />
      </linearGradient>
      <pattern id="rm-brush-v" width="3" height="12" patternUnits="userSpaceOnUse">
        <rect width="3" height="12" fill="transparent" />
        <line x1="0.5" y1="0" x2="0.5" y2="12" stroke="#ffffff" strokeOpacity="0.022" />
        <line x1="2" y1="0" x2="2" y2="7" stroke="#000000" strokeOpacity="0.12" />
      </pattern>
      <linearGradient id="rm-toplight" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#ffffff" stopOpacity="0.08" />
        <stop offset="0.18" stopColor="#ffffff" stopOpacity="0.025" />
        <stop offset="0.5" stopColor="#ffffff" stopOpacity="0" />
      </linearGradient>
      <linearGradient id="rm-floor" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#9fb3c2" stopOpacity="0.07" />
        <stop offset="1" stopColor="#9fb3c2" stopOpacity="0" />
      </linearGradient>
      <radialGradient id="rm-contact" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#000" stopOpacity="0.6" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="rm-panel" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#262930" />
        <stop offset="1" stopColor="#14161a" />
      </linearGradient>
      {/* Device faceplates: brushed metal. */}
      <linearGradient id="rm-brushed" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#3a3f48" />
        <stop offset="0.08" stopColor="#2b2f37" />
        <stop offset="0.5" stopColor="#24272e" />
        <stop offset="0.92" stopColor="#1c1f25" />
        <stop offset="1" stopColor="#111317" />
      </linearGradient>
      <pattern id="rm-brush-lines" width="6" height="2" patternUnits="userSpaceOnUse">
        <rect width="6" height="2" fill="transparent" />
        <line x1="0" y1="0.5" x2="6" y2="0.5" stroke="#ffffff" strokeOpacity="0.025" />
      </pattern>
      <linearGradient id="rm-bezel" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#212329" />
        <stop offset="1" stopColor="#0b0c0e" />
      </linearGradient>
      <pattern id="rm-mesh" width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="6" height="6" fill="#0c0d10" />
        <polygon points="3,0.6 5.4,1.8 5.4,4.2 3,5.4 0.6,4.2 0.6,1.8" fill="#24272d" />
      </pattern>
      <pattern id="rm-blank" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="10" height="10" fill="#121418" />
        <line x1="0" y1="0" x2="0" y2="10" stroke="#191c21" strokeWidth="3" />
      </pattern>
      <pattern id="rm-vent" width="8" height="4" patternUnits="userSpaceOnUse">
        <rect width="8" height="4" fill="#1a1c21" />
        <rect x="1" y="1" width="6" height="1.6" rx="0.8" fill="#08090b" />
      </pattern>
      <linearGradient id="rm-pcb" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#2b5a42" />
        <stop offset="1" stopColor="#1d4230" />
      </linearGradient>
      <linearGradient id="rm-glass" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#a9bccb" stopOpacity="0.14" />
        <stop offset="0.5" stopColor="#0f1217" stopOpacity="0.6" />
        <stop offset="1" stopColor="#a9bccb" stopOpacity="0.08" />
      </linearGradient>
      <radialGradient id="rm-fan" cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#8a9aae" stopOpacity="0.45" />
        <stop offset="0.65" stopColor="#5d6b7c" stopOpacity="0.18" />
        <stop offset="1" stopColor="#3c4652" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="rm-laptop-screen" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0" stopColor="#1d2733" />
        <stop offset="1" stopColor="#0d1116" />
      </linearGradient>
      <linearGradient id="rm-router" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0" stopColor="#d6dade" />
        <stop offset="1" stopColor="#a9afb8" />
      </linearGradient>
      <filter id="rm-shadow" x="-10%" y="-10%" width="120%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" floodColor="#000" floodOpacity="0.55" />
      </filter>
    </defs>
  );
}
