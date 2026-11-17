/** A 2U-ish unit seen face on: graphite body, two blanking slots, one lit link LED. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect x="3" y="4" width="26" height="24" rx="5" fill="#1a1d23" stroke="rgb(255 255 255 / 0.16)" />
      <rect x="7" y="9" width="18" height="5" rx="1.5" fill="#0c0d10" stroke="rgb(255 255 255 / 0.08)" />
      <rect x="7" y="18" width="18" height="5" rx="1.5" fill="#0c0d10" stroke="rgb(255 255 255 / 0.08)" />
      <circle cx="10" cy="11.5" r="1.2" fill="rgb(69 221 224)" />
      <rect x="13" y="11" width="9" height="1" rx="0.5" fill="rgb(255 255 255 / 0.18)" />
      <rect x="13" y="20" width="6" height="1" rx="0.5" fill="rgb(255 255 255 / 0.12)" />
    </svg>
  );
}
