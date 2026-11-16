import type { ArtProps } from './types';

/**
 * Rack server (R420 1U / R720 2U style): black bezel with a hex vent mesh, drive bays with
 * caddies, power button, LED cluster and a generic oval badge (no trademarked logos).
 */
export function ServerArt({ w, h, device, tpl }: ArtProps) {
  const twoU = tpl.height_u >= 2;
  const ear = h / tpl.height_u * 0.35;
  const bayCols = twoU ? 8 : 4;
  const bayRows = twoU ? 2 : 1;
  const baysX = ear * 1.3;
  const baysW = w * 0.42;
  const bayW = baysW / bayCols;
  const bayH = (h - h * 0.24) / bayRows;
  const off = device.status === 'offline';
  return (
    <g>
      <rect width={w} height={h} rx={2} fill="url(#rm-bezel)" />
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={2} fill="none" stroke="#3a3d44" />
      {/* rack ears */}
      <rect x={0} y={0} width={ear} height={h} fill="#17191d" />
      <rect x={w - ear} y={0} width={ear} height={h} fill="#17191d" />
      {/* drive bays */}
      {[...Array(bayRows)].map((_, r) =>
        [...Array(bayCols)].map((__, c) => {
          const x = baysX + c * bayW, y = h * 0.12 + r * bayH;
          return (
            <g key={`${r}-${c}`}>
              <rect x={x + 1} y={y + 1} width={bayW - 2} height={bayH - 2} rx={1.5} fill="#1d2025" stroke="#33373e" strokeWidth={0.7} />
              <rect x={x + bayW * 0.1} y={y + bayH * 0.22} width={bayW * 0.55} height={bayH * 0.56} fill="url(#rm-mesh)" />
              <rect x={x + bayW * 0.72} y={y + bayH * 0.25} width={bayW * 0.12} height={bayH * 0.5} rx={1} fill="#4b5563" />
              <circle cx={x + bayW * 0.9} cy={y + bayH * 0.3} r={Math.max(0.9, bayH * 0.05)} fill={off ? '#262a31' : '#22c55e'} />
            </g>
          );
        }),
      )}
      {/* vent mesh bezel */}
      <rect x={baysX + baysW + w * 0.015} y={h * 0.1} width={w * 0.2} height={h * 0.8} rx={2} fill="url(#rm-mesh)" stroke="#2b2e34" />
      {/* oval badge area */}
      <ellipse cx={baysX + baysW + w * 0.115} cy={h / 2} rx={Math.min(w * 0.045, h * 0.5)} ry={Math.min(h * 0.22, 14)} fill="#2a2d33" stroke="#6b7280" strokeWidth={0.8} />
      <text x={baysX + baysW + w * 0.115} y={h / 2 + Math.min(h * 0.08, 4)} textAnchor="middle" fontSize={Math.max(5, Math.min(h * 0.2, 10))} fill="#9ca3af" fontFamily="ui-sans-serif, system-ui">{twoU ? '2U' : '1U'}</text>
      {/* power button + LED cluster on the right ear */}
      <circle cx={w - ear * 0.5} cy={h * (twoU ? 0.25 : 0.32)} r={Math.max(2, ear * 0.28)} fill="#0b0c0e" stroke={off ? '#475569' : '#22c55e'} strokeWidth={1.1} />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={w - ear * 0.5} cy={h * (twoU ? 0.55 : 0.62) + i * Math.max(2.5, h * 0.09)} r={Math.max(0.9, ear * 0.1)} fill={off ? '#262a31' : i === 0 ? '#3b82f6' : i === 1 ? '#22c55e' : '#334155'} />
      ))}
      <text x={baysX} y={h - h * 0.03} fontSize={Math.max(5, Math.min(9, h * (twoU ? 0.07 : 0.13)))} fill="#6b7280" fontFamily="ui-monospace, monospace">{device.name}</text>
    </g>
  );
}
