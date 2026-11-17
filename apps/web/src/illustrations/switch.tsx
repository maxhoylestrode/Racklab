import type { ArtProps } from './types';

/** Rack switch: brushed dark faceplate, ear screws, model label, port block outline, status LEDs. */
export function SwitchArt({ w, h, device, tpl }: ArtProps) {
  const ear = h * 0.32;
  const groups = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  for (const p of device.ports) {
    if (!p.group) continue;
    const x = (p.layout_x / 1000) * w, y = (p.layout_y / (tpl.height_u * 100)) * h;
    const g = groups.get(p.group) ?? { x0: x, x1: x, y0: y, y1: y };
    groups.set(p.group, { x0: Math.min(g.x0, x), x1: Math.max(g.x1, x), y0: Math.min(g.y0, y), y1: Math.max(g.y1, y) });
  }
  const pad = h * 0.36;
  return (
    <g>
      <rect width={w} height={h} rx={2} fill="url(#rm-brushed)" />
      <rect width={w} height={h} rx={2} fill="url(#rm-brush-lines)" />
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={2} fill="none" stroke="#454a54" strokeOpacity={0.6} />
      {[ear * 0.55, w - ear * 0.55].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={h / 2} r={h * 0.1} fill="#0b0c0f" stroke="#5a606b" strokeWidth={0.8} />
          <line x1={cx - h * 0.06} y1={h / 2} x2={cx + h * 0.06} y2={h / 2} stroke="#5a606b" strokeWidth={0.8} />
        </g>
      ))}
      <text x={ear * 1.4} y={h * 0.42} fontSize={Math.max(7, h * 0.2)} fontWeight={600} fill="#cbd5e1" fontFamily="ui-sans-serif, system-ui">{device.name}</text>
      <text x={ear * 1.4} y={h * 0.7} fontSize={Math.max(6, h * 0.15)} fill="#7c8492" fontFamily="ui-monospace, monospace">
        {tpl.port_layout.length}-PORT GIGABIT{tpl.port_layout.some((p) => p.poe) ? ' PoE+' : ''}
      </text>
      <g>
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <circle cx={w * 0.31 + i * h * 0.3} cy={h * 0.5} r={Math.max(1.2, h * 0.06)} fill={device.status === 'offline' ? '#262a31' : i === 0 ? '#4ad08c' : '#334155'} />
          </g>
        ))}
      </g>
      {[...groups.values()].map((g, i) => (
        <rect key={i} x={g.x0 - pad} y={g.y0 - pad * 1.3} width={g.x1 - g.x0 + pad * 2} height={g.y1 - g.y0 + pad * 2.2} rx={2} fill="#0d0f12" fillOpacity={0.55} stroke="#3a3f48" strokeWidth={0.8} />
      ))}
    </g>
  );
}
