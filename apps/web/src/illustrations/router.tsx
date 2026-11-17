import type { ArtProps } from './types';

/** Home router with antenna stubs, sitting on a shelf. Ports along the rear lip. */
export function RouterArt({ w, h, device }: ArtProps) {
  const off = device.status === 'offline';
  const body = { x: w * 0.08, y: h * 0.5, w: w * 0.84, h: h * 0.44 };
  const antennas = [0.16, 0.38, 0.62, 0.84];
  return (
    <g>
      {antennas.map((fx, i) => {
        const x = w * fx;
        const tilt = (i - 1.5) * 6;
        return (
          <g key={fx} transform={`rotate(${tilt} ${x} ${body.y})`}>
            <rect x={x - w * 0.018} y={h * 0.04} width={w * 0.036} height={body.y - h * 0.04} rx={w * 0.018} fill="#d5d9df" stroke="#94a3b8" strokeWidth={0.6} />
          </g>
        );
      })}
      <rect x={body.x} y={body.y} width={body.w} height={body.h} rx={body.h * 0.35} fill="url(#rm-router)" stroke="#64748b" filter="url(#rm-shadow)" />
      <rect x={body.x + body.w * 0.05} y={body.y + body.h * 0.12} width={body.w * 0.9} height={body.h * 0.1} rx={2} fill="#e6e8eb" fillOpacity={0.6} />
      {/* status LEDs */}
      {[0, 1, 2, 3, 4].map((i) => (
        <circle key={i} cx={body.x + body.w * 0.08 + i * body.w * 0.05} cy={body.y + body.h * 0.4} r={Math.max(1, h * 0.022)}
          fill={off ? '#94a3b8' : i === 1 || i === 2 ? '#45dde0' : '#4ad08c'} />
      ))}
      <text x={body.x + body.w * 0.5} y={body.y + body.h * 0.45} textAnchor="middle" fontSize={Math.max(5, h * 0.09)} fill="#334155" fontFamily="ui-sans-serif, system-ui" fontWeight={600}>
        {device.name.replace(/\s*\(.*\)$/, '')}
      </text>
      {/* rear port strip */}
      <rect x={w * 0.12} y={h * 0.68} width={w * 0.8} height={h * 0.26} rx={2} fill="#1e293b" fillOpacity={0.85} />
    </g>
  );
}
