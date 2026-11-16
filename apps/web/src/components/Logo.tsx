export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="logo-g" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#334155" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
      </defs>
      <rect x="5" y="2" width="22" height="28" rx="3" fill="url(#logo-g)" stroke="#475569" />
      <rect x="8" y="6" width="16" height="4" rx="1" fill="#1e293b" />
      <circle cx="10.5" cy="8" r="1" fill="#22c55e" />
      <circle cx="13.5" cy="8" r="1" fill="#22c55e" />
      <rect x="8" y="12" width="16" height="4" rx="1" fill="#1e293b" />
      <circle cx="10.5" cy="14" r="1" fill="#f59e0b" />
      <rect x="8" y="18" width="16" height="7" rx="1" fill="#1e293b" />
      <path d="M24 20 C 30 20, 30 26, 24 26" stroke="#3b82f6" strokeWidth="1.5" fill="none" />
    </svg>
  );
}
