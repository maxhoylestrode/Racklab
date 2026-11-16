import type { ArtProps } from './types';

/** 24 port keystone patch panel: dark faceplate, numbered keystone blocks, cable label strip. */
export function PatchPanelArt({ w, h, device }: ArtProps) {
  return (
    <g>
      <rect width={w} height={h} rx={2} fill="url(#rm-brushed)" />
      <rect x={0.5} y={0.5} width={w - 1} height={h - 1} rx={2} fill="none" stroke="#454a54" strokeOpacity={0.6} />
      <rect x={w * 0.08} y={h * 0.08} width={w * 0.84} height={h * 0.16} fill="#e5e7eb" fillOpacity={0.85} />
      <text x={w * 0.09} y={h * 0.21} fontSize={Math.max(5, h * 0.12)} fill="#1f2937" fontFamily="ui-monospace, monospace">{device.name}</text>
      {device.ports.map((p) => (
        <text key={p.id} x={(p.layout_x / 1000) * w} y={h * 0.93} textAnchor="middle" fontSize={Math.max(4, h * 0.11)} fill="#6b7280" fontFamily="ui-monospace, monospace">{p.label}</text>
      ))}
    </g>
  );
}
