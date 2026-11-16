import type { ArtProps } from './types';

/** An open laptop on the shelf, seen from the front-side. Wifi glyph when tagged `wifi`. */
export function LaptopArt({ w, h, device }: ArtProps) {
  const off = device.status === 'offline';
  const screen = { x: w * 0.22, y: h * 0.06, w: w * 0.56, h: h * 0.62 };
  const wifi = device.tags.includes('wifi');
  return (
    <g>
      <rect x={screen.x} y={screen.y} width={screen.w} height={screen.h} rx={3} fill="#1f2937" stroke="#4b5563" />
      <rect x={screen.x + screen.w * 0.04} y={screen.y + screen.h * 0.07} width={screen.w * 0.92} height={screen.h * 0.84} rx={1} fill={off ? '#0b0c0e' : 'url(#rm-laptop-screen)'} />
      {!off && (
        <g>
          {[0, 1, 2].map((i) => (
            <rect key={i} x={screen.x + screen.w * 0.1} y={screen.y + screen.h * (0.22 + i * 0.16)} width={screen.w * (0.6 - i * 0.12)} height={screen.h * 0.06} rx={1} fill="#60a5fa" fillOpacity={0.5 - i * 0.1} />
          ))}
        </g>
      )}
      {/* keyboard deck in perspective */}
      <path d={`M${screen.x - w * 0.03} ${screen.y + screen.h} h${screen.w + w * 0.06} l${w * 0.12} ${h * 0.22} h${-(screen.w + w * 0.3)} z`} fill="#9ca3af" stroke="#6b7280" />
      <path d={`M${screen.x + w * 0.01} ${screen.y + screen.h + h * 0.03} h${screen.w - w * 0.02} l${w * 0.07} ${h * 0.12} h${-(screen.w + w * 0.12)} z`} fill="#4b5563" />
      <rect x={w * 0.08} y={h * 0.9} width={w * 0.84} height={h * 0.05} rx={2} fill="#6b7280" />
      {wifi && (
        <g transform={`translate(${screen.x + screen.w * 0.86} ${screen.y + screen.h * 0.2})`} stroke="#38bdf8" fill="none" strokeWidth={Math.max(0.8, h * 0.02)} strokeLinecap="round">
          <path d={`M${-h * 0.08} 0 a${h * 0.11} ${h * 0.11} 0 0 1 ${h * 0.16} 0`} />
          <path d={`M${-h * 0.045} ${h * 0.04} a${h * 0.06} ${h * 0.06} 0 0 1 ${h * 0.09} 0`} />
          <circle cx={0} cy={h * 0.075} r={h * 0.012} fill="#38bdf8" />
        </g>
      )}
      <text x={w * 0.5} y={h * 0.985} textAnchor="middle" fontSize={Math.max(5, h * 0.08)} fill="#94a3b8" fontFamily="ui-sans-serif, system-ui">{device.name}</text>
    </g>
  );
}
