import { memo } from 'react';
import type { Geometry } from './geometry';
import { unitTop } from './geometry';

/** The 19" cabinet: steel body, top and bottom panels, rails with 3 holes per U, U number gutters, blanking texture. */
export const RackFrame = memo(function RackFrame({ g, occupied, name }: { g: Geometry; occupied: Set<number>; name: string }) {
  const cabX = g.laneW;
  const cabW = g.width - g.laneW * 2;
  const cabH = g.rackTop + g.rackHeight + g.bottomPanel;
  const holeFracs = [0.143, 0.5, 0.857];
  const holeS = Math.max(2.5, g.u * 0.09);
  const railL = g.laneW + g.gutter;
  const railR = g.faceX + g.faceW;
  const fs = Math.max(8, Math.min(12, g.u * 0.26));
  return (
    <g>
      {/* soft ambient shadow and cabinet body */}
      <ellipse cx={g.width / 2} cy={cabH + 6} rx={cabW * 0.55} ry={10} fill="#000" opacity={0.45} />
      <rect x={cabX} y={0} width={cabW} height={cabH} rx={8} fill="url(#rm-steel)" stroke="#2f343c" />
      <rect x={cabX + 3} y={3} width={cabW - 6} height={cabH - 6} rx={6} fill="none" stroke="#000" strokeOpacity={0.4} />
      {/* top panel with vents and the rack name */}
      <rect x={cabX + 6} y={6} width={cabW - 12} height={g.topPanel - 4} rx={4} fill="url(#rm-panel)" />
      <rect x={cabX + cabW * 0.3} y={6 + g.topPanel * 0.25} width={cabW * 0.4} height={g.topPanel * 0.4} fill="url(#rm-vent)" opacity={0.7} />
      <text x={cabX + 16} y={6 + g.topPanel * 0.62} fontSize={fs} fill="#94a3b8" fontFamily="ui-sans-serif, system-ui" fontWeight={600}>{name}</text>
      <text x={cabX + cabW - 16} y={6 + g.topPanel * 0.62} textAnchor="end" fontSize={fs * 0.9} fill="#64748b" fontFamily="ui-monospace, monospace">{g.units}U</text>
      {/* bottom panel */}
      <rect x={cabX + 6} y={g.rackTop + g.rackHeight + 4} width={cabW - 12} height={g.bottomPanel - 10} rx={4} fill="url(#rm-panel)" />
      {[0.12, 0.88].map((f) => (
        <rect key={f} x={cabX + cabW * f - 14} y={cabH - 4} width={28} height={8} rx={2} fill="#0b0c0e" />
      ))}
      {/* interior back */}
      <rect x={g.faceX} y={g.rackTop} width={g.faceW} height={g.rackHeight} fill="#08090b" />
      {/* empty units: blanking panel texture */}
      {[...Array(g.units)].map((_, i) => {
        const n = i + 1;
        if (occupied.has(n)) return null;
        const y = unitTop(g, n);
        return (
          <g key={n}>
            <rect x={g.faceX + 1} y={y + 1} width={g.faceW - 2} height={g.u - 2} fill="url(#rm-blank)" opacity={0.7} />
            <rect x={g.faceX + 1} y={y + 1} width={g.faceW - 2} height={g.u - 2} fill="none" stroke="#1d2026" />
          </g>
        );
      })}
      {/* rails */}
      {[railL, railR].map((x) => (
        <g key={x}>
          <rect x={x} y={g.rackTop - 4} width={g.rail} height={g.rackHeight + 8} fill="#1b1e23" stroke="#30343b" />
          <rect x={x + g.rail * 0.15} y={g.rackTop - 4} width={g.rail * 0.08} height={g.rackHeight + 8} fill="#ffffff" opacity={0.05} />
          {[...Array(g.units)].map((_, i) =>
            holeFracs.map((f) => (
              <rect key={`${i}-${f}`} x={x + g.rail / 2 - holeS / 2} y={g.rackTop + i * g.u + f * g.u - holeS / 2} width={holeS} height={holeS} rx={0.6} fill="#050506" stroke="#3a3f47" strokeWidth={0.5} />
            )),
          )}
        </g>
      ))}
      {/* U number gutters: 1 at the bottom, every fifth emphasised */}
      {[...Array(g.units)].map((_, i) => {
        const n = i + 1;
        const y = unitTop(g, n) + g.u / 2 + fs * 0.35;
        const strong = n % 5 === 0 || n === 1;
        const common = { fontSize: fs * (strong ? 1 : 0.85), fill: strong ? '#cbd5e1' : '#64748b', fontWeight: strong ? 700 : 400, fontFamily: 'ui-monospace, monospace' };
        return (
          <g key={n} aria-hidden>
            <text x={railL - 5} y={y} textAnchor="end" {...common}>{n}</text>
            <text x={railR + g.rail + 5} y={y} textAnchor="start" {...common}>{n}</text>
            <line x1={railL - g.gutter + 4} y1={unitTop(g, n)} x2={railL - 2} y2={unitTop(g, n)} stroke="#2a2e35" strokeWidth={0.6} />
          </g>
        );
      })}
    </g>
  );
});

/** The unracked tray panel under the rack. */
export function TrayPanel({ g, count, highlight }: { g: Geometry; count: number; highlight: 'none' | 'ok' }) {
  return (
    <g>
      <rect x={g.faceX - g.rail} y={g.trayTop} width={g.faceW + g.rail * 2} height={g.trayHeight} rx={10}
        fill="#11141a" stroke={highlight === 'ok' ? '#22c55e' : '#2a2f37'} strokeWidth={highlight === 'ok' ? 2 : 1} strokeDasharray={highlight === 'ok' ? undefined : '6 4'} />
      <text x={g.faceX} y={g.trayTop + 18} fontSize={11} fill="#94a3b8" fontFamily="ui-sans-serif, system-ui" fontWeight={600}>Unracked tray</text>
      <text x={g.faceX + g.faceW} y={g.trayTop + 18} textAnchor="end" fontSize={10} fill="#64748b" fontFamily="ui-sans-serif, system-ui">
        {count === 0 ? 'Drop loose devices here. They stay wireable.' : `${count} device${count === 1 ? '' : 's'}`}
      </text>
    </g>
  );
}
