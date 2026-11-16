import { memo } from 'react';
import type { Port } from '@rackmap/shared';

export interface PortVisual { linked: boolean }

/** Deterministic pseudo-random delay so LEDs blink out of phase but stay stable across renders. */
function delayFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return `${(Math.abs(h) % 2600) / 1000}s`;
}

/**
 * Draws one jack centred at (x, y) with size s (the jack's height in px), plus its link LED.
 * LEDs: linked = steady green with an activity blink (amber for PoE); unlinked = dark.
 */
export const Jack = memo(function Jack({ port, x, y, s, linked, offline, led = true }: {
  port: Port; x: number; y: number; s: number; linked: boolean; offline: boolean; led?: boolean;
}) {
  const ledColor = linked ? (port.poe ? '#f59e0b' : '#22c55e') : '#262a31';
  const ledR = Math.max(1.2, s * 0.13);
  const showLed = led && ['rj45', 'sfp', 'sfp_plus', 'idrac'].includes(port.kind);
  const blink = linked && !offline;
  let body: JSX.Element;
  switch (port.kind) {
    case 'rj45':
    case 'idrac': {
      const w = s * 1.05, h = s * 0.9;
      body = (
        <g>
          <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={s * 0.08} fill="#0a0b0d" stroke={port.kind === 'idrac' ? '#3b82f6' : '#4b5059'} strokeWidth={Math.max(0.6, s * 0.06)} />
          <rect x={x - w * 0.22} y={y + h * 0.18} width={w * 0.44} height={h * 0.32} fill="#2d3139" />
          {[...Array(4)].map((_, i) => <rect key={i} x={x - w * 0.34 + i * w * 0.2} y={y - h * 0.38} width={w * 0.07} height={h * 0.2} fill="#b08d3a" />)}
        </g>
      );
      break;
    }
    case 'sfp':
    case 'sfp_plus': {
      const w = s * 1.25, h = s * 0.7;
      body = (
        <g>
          <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={s * 0.05} fill="#0a0b0d" stroke="#8b919c" strokeWidth={Math.max(0.6, s * 0.06)} />
          <rect x={x - w * 0.36} y={y - h * 0.18} width={w * 0.72} height={h * 0.36} fill="#1a1c21" />
        </g>
      );
      break;
    }
    case 'usb': {
      const w = s * 0.9, h = s * 0.42;
      body = (
        <g>
          <rect x={x - w / 2} y={y - h / 2} width={w} height={h} rx={s * 0.04} fill="#0a0b0d" stroke="#6b7280" strokeWidth={Math.max(0.5, s * 0.05)} />
          <rect x={x - w * 0.36} y={y - h * 0.3} width={w * 0.72} height={h * 0.3} fill="#2563eb" />
        </g>
      );
      break;
    }
    case 'power': {
      const w = s * 1.1, h = s * 0.85;
      body = (
        <g>
          <path d={`M${x - w / 2} ${y - h / 2} h${w} v${h * 0.62} l${-w * 0.2} ${h * 0.38} h${-w * 0.6} l${-w * 0.2} ${-h * 0.38} z`} fill="#0a0b0d" stroke="#6b7280" strokeWidth={Math.max(0.5, s * 0.05)} />
          {[-0.25, 0, 0.25].map((dx) => <rect key={dx} x={x + dx * w - s * 0.05} y={y - h * 0.15} width={s * 0.1} height={h * 0.32} fill="#9ca3af" />)}
        </g>
      );
      break;
    }
    case 'hdmi': {
      const w = s * 0.9, h = s * 0.38;
      body = <path d={`M${x - w / 2} ${y - h / 2} h${w} v${h * 0.6} l${-w * 0.12} ${h * 0.4} h${-w * 0.76} l${-w * 0.12} ${-h * 0.4} z`} fill="#0a0b0d" stroke="#6b7280" strokeWidth={Math.max(0.5, s * 0.05)} />;
      break;
    }
    default: {
      // VGA / console / other: a D-sub style connector.
      const w = s * 1.3, h = s * 0.6;
      body = (
        <g>
          <path d={`M${x - w / 2} ${y - h / 2} h${w} l${-w * 0.1} ${h} h${-w * 0.8} z`} fill="#1e3a8a" stroke="#64748b" strokeWidth={Math.max(0.5, s * 0.05)} />
          {[...Array(5)].map((_, i) => <circle key={i} cx={x - w * 0.3 + i * w * 0.15} cy={y - h * 0.1} r={s * 0.04} fill="#cbd5e1" />)}
        </g>
      );
    }
  }
  return (
    <g>
      {body}
      {showLed && (
        <circle
          cx={x + s * 0.42}
          cy={y - s * 0.62}
          r={ledR}
          fill={ledColor}
          className={blink ? 'led-activity' : undefined}
          style={blink ? { animationDelay: delayFor(port.id) } : undefined}
          filter={linked ? 'url(#rm-glow)' : undefined}
        />
      )}
    </g>
  );
});
