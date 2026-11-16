import type { ArtProps } from './types';

/** Raspberry Pi 4 seen top-down in a small printed bracket: green board, SoC, RAM, GPIO header. */
export function RaspberryPiArt({ w, h, device }: ArtProps) {
  const tray = { x: w * 0.02, y: h * 0.06, w: w * 0.96, h: h * 0.9 };
  const b = { x: w * 0.06, y: h * 0.14, w: w * 0.88, h: h * 0.72 };
  const off = device.status === 'offline';
  return (
    <g>
      <rect x={tray.x} y={tray.y} width={tray.w} height={tray.h} rx={h * 0.08} fill="#e2e8f0" fillOpacity={0.12} stroke="#94a3b8" strokeOpacity={0.5} />
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={h * 0.06} fill="url(#rm-pcb)" stroke="#0f3d1d" />
      {/* mounting holes */}
      {[[0.06, 0.12], [0.06, 0.88], [0.62, 0.12], [0.62, 0.88]].map(([fx, fy], i) => (
        <circle key={i} cx={b.x + b.w * fx} cy={b.y + b.h * fy} r={Math.max(1, h * 0.04)} fill="#d4af37" stroke="#14532d" />
      ))}
      {/* GPIO header */}
      <rect x={b.x + b.w * 0.1} y={b.y + b.h * 0.04} width={b.w * 0.5} height={b.h * 0.12} fill="#111" />
      {[...Array(20)].map((_, i) => <rect key={i} x={b.x + b.w * 0.11 + i * b.w * 0.024} y={b.y + b.h * 0.06} width={b.w * 0.012} height={b.h * 0.08} fill="#d4af37" />)}
      {/* SoC with heat spreader, RAM */}
      <rect x={b.x + b.w * 0.24} y={b.y + b.h * 0.34} width={b.w * 0.16} height={b.h * 0.34} rx={1} fill="#9ca3af" stroke="#6b7280" />
      <rect x={b.x + b.w * 0.44} y={b.y + b.h * 0.36} width={b.w * 0.1} height={b.h * 0.28} fill="#1f2937" />
      {/* label */}
      <text x={b.x + b.w * 0.1} y={b.y + b.h * 0.86} fontSize={Math.max(5, h * 0.11)} fill="#ecfdf5" fillOpacity={0.85} fontFamily="ui-sans-serif, system-ui">{device.name}</text>
      {/* power + activity LEDs */}
      <circle cx={b.x + b.w * 0.04} cy={b.y + b.h * 0.6} r={Math.max(1, h * 0.03)} fill={off ? '#262a31' : '#ef4444'} />
      <circle cx={b.x + b.w * 0.04} cy={b.y + b.h * 0.7} r={Math.max(1, h * 0.03)} fill={off ? '#262a31' : '#22c55e'} className={off ? undefined : 'led-activity'} />
      {/* USB / Ethernet port housings along the right edge (jacks are drawn on top) */}
      <rect x={b.x + b.w * 0.7} y={b.y + b.h * 0.02} width={b.w * 0.3} height={b.h * 0.96} fill="#cbd5e1" fillOpacity={0.12} />
    </g>
  );
}
