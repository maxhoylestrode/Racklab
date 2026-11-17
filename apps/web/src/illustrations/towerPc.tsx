import type { ArtProps } from './types';

/** Mid tower drawn side-on, standing on the shelf: tempered panel panel, RGB fan rings, lit accent strip. */
export function TowerPcArt({ w, h, device }: ArtProps) {
  const off = device.status === 'offline';
  const accent = device.color_accent ?? '#7f8ea3';
  const caseX = w * 0.18, caseW = w * 0.64, caseY = h * 0.03, caseH = h * 0.94;
  const fanR = Math.min(caseW * 0.14, caseH * 0.13);
  return (
    <g>
      {/* feet */}
      <rect x={caseX + caseW * 0.08} y={caseY + caseH - 2} width={caseW * 0.12} height={3} fill="#0b0c0e" />
      <rect x={caseX + caseW * 0.8} y={caseY + caseH - 2} width={caseW * 0.12} height={3} fill="#0b0c0e" />
      <rect x={caseX} y={caseY} width={caseW} height={caseH - 2} rx={4} fill="#111317" stroke="#3b3f47" />
      {/* panel panel */}
      <rect x={caseX + caseW * 0.05} y={caseY + caseH * 0.05} width={caseW * 0.72} height={caseH * 0.86} rx={3} fill="url(#rm-glass)" stroke="#475569" strokeOpacity={0.6} />
      {/* motherboard + GPU silhouettes */}
      <rect x={caseX + caseW * 0.12} y={caseY + caseH * 0.1} width={caseW * 0.5} height={caseH * 0.5} fill="#0f172a" opacity={0.8} />
      <rect x={caseX + caseW * 0.12} y={caseY + caseH * 0.48} width={caseW * 0.56} height={caseH * 0.08} rx={1} fill="#1f2937" />
      <rect x={caseX + caseW * 0.24} y={caseY + caseH * 0.2} width={caseW * 0.14} height={caseH * 0.14} rx={2} fill="#334155" />
      {/* PSU shroud */}
      <rect x={caseX + caseW * 0.05} y={caseY + caseH * 0.74} width={caseW * 0.72} height={caseH * 0.17} fill="#1a1d22" />
      {/* front fans */}
      {[0.22, 0.48].map((fy) => {
        const cx = caseX + caseW * 0.88, cy = caseY + caseH * fy + fanR;
        return (
          <g key={fy} opacity={off ? 0.25 : 1}>
            <circle cx={cx} cy={cy} r={fanR * 1.35} fill="url(#rm-fan)" />
            <circle cx={cx} cy={cy} r={fanR} fill="none" stroke={accent} strokeWidth={Math.max(1, fanR * 0.18)} />
            <circle cx={cx} cy={cy} r={fanR * 0.25} fill="#0b0c0e" />
          </g>
        );
      })}
      {/* accent strip */}
      <rect x={caseX + caseW * 0.79} y={caseY + caseH * 0.05} width={Math.max(1.5, caseW * 0.015)} height={caseH * 0.86} fill={off ? '#334155' : accent} />
      {/* power button */}
      <circle cx={caseX + caseW * 0.88} cy={caseY + caseH * 0.08} r={Math.max(1.5, caseW * 0.025)} fill="#0b0c0e" stroke={off ? '#475569' : '#d5d9df'} />
      <text x={caseX + caseW * 0.08} y={caseY + caseH * 0.86} fontSize={Math.max(5, Math.min(10, h * 0.06))} fill="#94a3b8" fontFamily="ui-sans-serif, system-ui">{device.name}</text>
      {/* rear I/O column (where the jacks sit) */}
      <rect x={w * 0.84} y={h * 0.45} width={w * 0.06} height={h * 0.45} rx={1} fill="#1a1d22" stroke="#334155" strokeWidth={0.6} />
      <line x1={caseX + caseW} y1={h * 0.6} x2={w * 0.84} y2={h * 0.6} stroke="#334155" strokeWidth={0.8} />
    </g>
  );
}
