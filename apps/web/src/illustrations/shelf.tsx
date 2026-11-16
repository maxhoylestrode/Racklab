import type { ArtProps } from './types';

/** 1U / 2U vented cantilever tray with numbered slot dividers. */
export function ShelfArt({ w, h, tpl, device }: ArtProps) {
  const slots = tpl.shelf_slots ?? 2;
  const u = h / tpl.height_u;
  const lip = Math.max(4, u * 0.16);
  return (
    <g>
      {/* back wall (darker) and vent slots */}
      <rect width={w} height={h} fill="#101216" />
      <rect x={w * 0.03} y={h * 0.2} width={w * 0.94} height={h * 0.45} fill="url(#rm-vent)" opacity={0.6} />
      {/* ears */}
      <rect x={0} y={0} width={u * 0.35} height={h} fill="#1c1f24" stroke="#30343b" strokeWidth={0.6} />
      <rect x={w - u * 0.35} y={0} width={u * 0.35} height={h} fill="#1c1f24" stroke="#30343b" strokeWidth={0.6} />
      {/* tray lip */}
      <rect x={0} y={h - lip} width={w} height={lip} fill="url(#rm-brushed)" stroke="#4b505a" strokeWidth={0.6} />
      {[...Array(Math.floor(w / 18))].map((_, i) => (
        <rect key={i} x={10 + i * 18} y={h - lip * 0.7} width={10} height={lip * 0.4} rx={lip * 0.2} fill="#0b0c0e" />
      ))}
      {/* slot dividers and numbers */}
      {[...Array(slots)].map((_, i) => (
        <g key={i}>
          {i > 0 && <line x1={(w / slots) * i} y1={h * 0.15} x2={(w / slots) * i} y2={h - lip} stroke="#3b4049" strokeDasharray="3 3" />}
          <text x={(w / slots) * i + 6 + (i === 0 ? u * 0.35 : 0)} y={h - lip - 3} fontSize={Math.max(6, Math.min(9, u * 0.18))} fill="#4b5563" fontFamily="ui-monospace, monospace">{i + 1}</text>
        </g>
      ))}
      <text x={w - u * 0.45} y={h - lip - 3} textAnchor="end" fontSize={Math.max(6, Math.min(9, u * 0.18))} fill="#4b5563" fontFamily="ui-sans-serif, system-ui">{device.name}</text>
    </g>
  );
}
