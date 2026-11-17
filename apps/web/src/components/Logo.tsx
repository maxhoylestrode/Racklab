/** A small rack unit seen face on, drawn in light strokes for the black brand tile. One lit link LED. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="4" y="5" width="24" height="22" rx="4" fill="none" stroke="#f2f2ee" strokeOpacity="0.85" strokeWidth="1.5" />
      <rect x="8" y="10" width="16" height="4" rx="1" fill="#f2f2ee" fillOpacity="0.18" />
      <rect x="8" y="18" width="16" height="4" rx="1" fill="#f2f2ee" fillOpacity="0.18" />
      <circle cx="10.5" cy="12" r="1.2" fill="#4ad08c" />
      <rect x="13" y="11.5" width="8" height="1" rx="0.5" fill="#f2f2ee" fillOpacity="0.6" />
      <rect x="13" y="19.5" width="5" height="1" rx="0.5" fill="#f2f2ee" fillOpacity="0.45" />
    </svg>
  );
}
