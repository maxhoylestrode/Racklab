import type { ArtProps } from './types';

/** Fallback faceplate for custom templates: clean panel with the device name and a status LED. */
export function GenericArt({ w, h, device, tpl }: ArtProps) {
  const loose = tpl.form_factor === 'loose';
  const off = device.status === 'offline';
  const accent = device.color_accent ?? '#6b7380';
  return (
    <g>
      <rect width={w} height={h} rx={loose ? 6 : 2} fill={loose ? '#1e293b' : 'url(#rm-brushed)'} stroke="#475569" strokeOpacity={0.6} />
      <rect x={0} y={0} width={Math.max(3, w * 0.012)} height={h} fill={accent} opacity={0.8} />
      <text x={w * 0.04} y={Math.min(h * 0.5 + 4, h - 4)} fontSize={Math.max(7, Math.min(14, h * 0.28))} fontWeight={600} fill="#d5d9df" fontFamily="ui-sans-serif, system-ui">{device.name}</text>
      <text x={w * 0.04} y={Math.min(h * 0.5 + 4, h - 4) + Math.max(7, Math.min(12, h * 0.22))} fontSize={Math.max(5, Math.min(10, h * 0.17))} fill="#94a3b8" fontFamily="ui-sans-serif, system-ui">{tpl.name}</text>
      <circle cx={w - h * 0.25} cy={h * 0.3} r={Math.max(1.5, h * 0.06)} fill={off ? '#262a31' : '#4ad08c'} />
    </g>
  );
}
