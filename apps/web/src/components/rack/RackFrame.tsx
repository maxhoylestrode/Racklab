import { memo } from 'react';
import type { Geometry } from './geometry';
import { unitTop } from './geometry';

const SANS = 'ui-sans-serif, system-ui';
const MONO = 'ui-monospace, monospace';

/**
 * The 19" cabinet: powder-coated steel body with a vertical brush and top light, a soft floor reflection,
 * rails with 3 square holes per U (drawn as one pattern per rail), U number gutters and blanking panels.
 */
export const RackFrame = memo(function RackFrame({ g, occupied, name }: { g: Geometry; occupied: Set<number>; name: string }) {
  const cabX = g.laneW;
  const cabW = g.width - g.laneW * 2;
  const cabH = g.rackTop + g.rackHeight + g.bottomPanel;
  const holeS = Math.max(2.5, g.u * 0.09);
  const railL = g.laneW + g.gutter;
  const railR = g.faceX + g.faceW;
  const fs = Math.max(9, Math.min(12, g.u * 0.26));
  const reflH = Math.min(30, (g.trayTop - cabH) * 0.8);
  return (
    <g>
      {/* rail hole pattern: one U tall, aligned to the top of the rack */}
      <defs>
        <pattern id="rm-holes" width={g.rail} height={g.u} patternUnits="userSpaceOnUse" patternTransform={`translate(0 ${g.rackTop})`}>
          {[0.143, 0.5, 0.857].map((f) => (
            <g key={f}>
              <rect x={g.rail / 2 - holeS / 2} y={f * g.u - holeS / 2} width={holeS} height={holeS} rx={0.5} fill="#030304" />
              {/* tiny inner shadow: dark top lip, faint lit bottom edge */}
              <rect x={g.rail / 2 - holeS / 2} y={f * g.u - holeS / 2} width={holeS} height={0.7} fill="#000" />
              <rect x={g.rail / 2 - holeS / 2} y={f * g.u + holeS / 2 - 0.5} width={holeS} height={0.5} fill="#ffffff" fillOpacity={0.12} />
            </g>
          ))}
        </pattern>
      </defs>

      {/* floor: contact shadow and a faint reflection */}
      <ellipse cx={g.width / 2} cy={cabH + 2} rx={cabW * 0.56} ry={9} fill="url(#rm-contact)" />
      <rect x={cabX + 10} y={cabH + 3} width={cabW - 20} height={reflH} fill="url(#rm-floor)" />

      {/* cabinet body */}
      <rect x={cabX} y={0} width={cabW} height={cabH} rx={10} fill="url(#rm-steel)" />
      <rect x={cabX} y={0} width={cabW} height={cabH} rx={10} fill="url(#rm-brush-v)" />
      <rect x={cabX} y={0} width={cabW} height={cabH} rx={10} fill="url(#rm-toplight)" />
      <rect x={cabX + 0.5} y={0.5} width={cabW - 1} height={cabH - 1} rx={9.5} fill="none" stroke="#ffffff" strokeOpacity={0.09} />
      <line x1={cabX + 12} y1={1} x2={cabX + cabW - 12} y2={1} stroke="#ffffff" strokeOpacity={0.16} />
      <rect x={cabX + 3} y={3} width={cabW - 6} height={cabH - 6} rx={7} fill="none" stroke="#000" strokeOpacity={0.45} />

      {/* top panel with vents and the rack name */}
      <rect x={cabX + 6} y={6} width={cabW - 12} height={g.topPanel - 4} rx={5} fill="url(#rm-panel)" />
      <rect x={cabX + cabW * 0.32} y={6 + g.topPanel * 0.28} width={cabW * 0.36} height={g.topPanel * 0.36} rx={2} fill="url(#rm-vent)" opacity={0.75} />
      <text x={cabX + 16} y={6 + g.topPanel * 0.62} fontSize={fs} fill="#c9ced6" fillOpacity={0.85} fontFamily={SANS} fontWeight={600}>{name}</text>
      <text x={cabX + cabW - 16} y={6 + g.topPanel * 0.62} textAnchor="end" fontSize={fs * 0.9} fill="#8b929c" fontFamily={MONO}>{g.units}U</text>

      {/* bottom panel and feet */}
      <rect x={cabX + 6} y={g.rackTop + g.rackHeight + 4} width={cabW - 12} height={g.bottomPanel - 10} rx={5} fill="url(#rm-panel)" />
      {[0.12, 0.88].map((f) => (
        <rect key={f} x={cabX + cabW * f - 14} y={cabH - 4} width={28} height={7} rx={2} fill="#08090b" />
      ))}

      {/* interior back, with depth shading at the top */}
      <rect x={g.faceX} y={g.rackTop} width={g.faceW} height={g.rackHeight} fill="#07080a" />
      <rect x={g.faceX} y={g.rackTop} width={g.faceW} height={Math.min(18, g.u * 0.5)} fill="#000" fillOpacity={0.35} />

      {/* empty units: blanking panels */}
      {[...Array(g.units)].map((_, i) => {
        const n = i + 1;
        if (occupied.has(n)) return null;
        const y = unitTop(g, n);
        return (
          <g key={n}>
            <rect x={g.faceX + 1} y={y + 1} width={g.faceW - 2} height={g.u - 2} rx={1.5} fill="url(#rm-blank)" opacity={0.75} />
            <line x1={g.faceX + 2} y1={y + 1.5} x2={g.faceX + g.faceW - 2} y2={y + 1.5} stroke="#ffffff" strokeOpacity={0.04} />
            <rect x={g.faceX + 1} y={y + 1} width={g.faceW - 2} height={g.u - 2} rx={1.5} fill="none" stroke="#000" strokeOpacity={0.5} />
          </g>
        );
      })}

      {/* rails */}
      {[railL, railR].map((x) => (
        <g key={x}>
          <rect x={x} y={g.rackTop - 4} width={g.rail} height={g.rackHeight + 8} rx={1} fill="#191b20" />
          <rect x={x} y={g.rackTop - 4} width={1} height={g.rackHeight + 8} fill="#ffffff" fillOpacity={0.07} />
          <rect x={x + g.rail - 1} y={g.rackTop - 4} width={1} height={g.rackHeight + 8} fill="#000" fillOpacity={0.5} />
          {/* drawn at local x=0 so the pattern tiles line up with the rail */}
          <rect x={0} y={g.rackTop} width={g.rail} height={g.rackHeight} fill="url(#rm-holes)" transform={`translate(${x} 0)`} />
        </g>
      ))}

      {/* U number gutters: 1 at the bottom, every fifth emphasised */}
      {[...Array(g.units)].map((_, i) => {
        const n = i + 1;
        const y = unitTop(g, n) + g.u / 2 + fs * 0.35;
        const strong = n % 5 === 0 || n === 1;
        const common = { fontSize: fs * (strong ? 1 : 0.88), fill: strong ? '#c4c9d1' : '#737a84', fontWeight: strong ? 600 : 400, fontFamily: MONO };
        return (
          <g key={n} aria-hidden>
            <text x={railL - 6} y={y} textAnchor="end" {...common}>{n}</text>
            <text x={railR + g.rail + 6} y={y} textAnchor="start" {...common}>{n}</text>
            <line x1={railL - g.gutter + 6} y1={unitTop(g, n)} x2={railL - 2} y2={unitTop(g, n)} stroke="#ffffff" strokeOpacity={0.05} strokeWidth={1} />
          </g>
        );
      })}
    </g>
  );
});

/** The unracked tray panel under the rack. */
export function TrayPanel({ g, count, highlight }: { g: Geometry; count: number; highlight: 'none' | 'ok' }) {
  const ok = highlight === 'ok';
  return (
    <g>
      <rect x={g.faceX - g.rail} y={g.trayTop} width={g.faceW + g.rail * 2} height={g.trayHeight} rx={14}
        fill="#0f1115" fillOpacity={0.85} stroke={ok ? '#4ad08c' : '#ffffff'} strokeOpacity={ok ? 0.9 : 0.1} strokeWidth={ok ? 1.5 : 1} strokeDasharray={ok ? undefined : '5 5'} />
      <text x={g.faceX + 4} y={g.trayTop + 20} fontSize={12} fill="#e8eaed" fillOpacity={0.88} fontFamily={SANS} fontWeight={500}>Unracked tray</text>
      <text x={g.faceX + g.faceW - 4} y={g.trayTop + 20} textAnchor="end" fontSize={12} fill="#a0a6af" fontFamily={SANS}>
        {count === 0 ? 'Drop loose devices here. They stay wireable.' : `${count} device${count === 1 ? '' : 's'}`}
      </text>
    </g>
  );
}
