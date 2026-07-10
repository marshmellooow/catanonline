import { memo } from 'react';
import type { Hex, Port, PlayerColor } from '@catan/shared';
import { TERRAIN, chipColor, pipCount, RESOURCE_LABEL } from '@catan/shared';
import { Motifs } from './Motifs';

/** Die 6 Eckpunkte eines Feldes (spitz oben). */
export function hexVerts(hex: Hex): Array<[number, number]> {
  const { x, y, w, h, cx } = hex;
  return [
    [cx, y],
    [x + w, y + 0.25 * h],
    [x + w, y + 0.75 * h],
    [cx, y + h],
    [x, y + 0.75 * h],
    [x, y + 0.25 * h],
  ];
}
const poly = (pts: Array<[number, number]>, dy = 0) => pts.map(([x, y]) => `${x},${y + dy}`).join(' ');
const inset = (pts: Array<[number, number]>, cx: number, cy: number, px: number, w: number) => {
  const f = (w - px * 2) / w;
  return pts.map(([x, y]): [number, number] => [cx + (x - cx) * f, cy + (y - cy) * f]);
};

// ---------- Zahlen-Chip ----------
function Chip({ hex }: { hex: Hex }) {
  if (hex.number == null) return null;
  const size = hex.w * 0.42;
  const cx = hex.cx;
  const cy = hex.y + hex.h * 0.63;
  const col = chipColor(hex.number);
  const pips = pipCount(hex.number);
  const pipR = Math.max(1.4, hex.w * 0.02);
  const gap = pipR * 2.4;
  const startX = cx - ((pips - 1) * gap) / 2;
  return (
    <g>
      <rect
        x={cx - size / 2}
        y={cy - size / 2}
        width={size}
        height={size}
        rx={size * 0.22}
        fill="#F8F2DE"
        stroke="rgba(90,74,48,.28)"
        strokeWidth={2}
      />
      <text
        x={cx}
        y={cy - size * 0.06}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Marcellus, serif"
        fontSize={hex.w * 0.2}
        fill={col}
        fontWeight={hex.number === 6 || hex.number === 8 ? 700 : 400}
      >
        {hex.number}
      </text>
      {Array.from({ length: pips }).map((_, i) => (
        <circle key={i} cx={startX + i * gap} cy={cy + size * 0.3} r={pipR} fill={col} />
      ))}
    </g>
  );
}

// ---------- Ein Feld (statisch) ----------
export const Tile = memo(function Tile({ hex }: { hex: Hex }) {
  const t = TERRAIN[hex.terrain];
  const isWater = hex.terrain === 'W';
  const depth = isWater ? 3 : 10;
  const verts = hexVerts(hex);
  const facePts = inset(verts, hex.cx, hex.y + hex.h / 2, 3, hex.w);
  return (
    <g filter={isWater ? undefined : 'url(#tileShadow)'}>
      <polygon points={poly(verts, depth)} fill={t.side} />
      <polygon points={poly(verts)} fill={t.edge} />
      <polygon points={poly(facePts)} fill={`url(#grad-${hex.terrain})`} />
      <Motifs x={hex.x} y={hex.y} w={hex.w} h={hex.h} terrain={hex.terrain} />
      <Chip hex={hex} />
    </g>
  );
});

// ---------- Hafen ----------
export function PortMark({ port, hexW }: { port: Port; hexW: number }) {
  const plate = hexW * 0.5;
  const label = port.type === '3:1' ? '3:1' : `2:1`;
  const sub = port.type === '3:1' ? '?' : RESOURCE_LABEL[port.type as 'wood']?.[0] ?? '';
  return (
    <g>
      <rect x={port.x - plate / 2} y={port.y - plate * 0.34} width={plate} height={plate * 0.68} rx={plate * 0.16} fill="#F8F2DE" stroke="rgba(90,74,48,.3)" />
      <text x={port.x} y={port.y - plate * 0.05} textAnchor="middle" dominantBaseline="central" fontFamily="Marcellus, serif" fontSize={hexW * 0.16} fill="#3A2E1A">
        {label}
      </text>
      <text x={port.x} y={port.y + plate * 0.2} textAnchor="middle" dominantBaseline="central" fontSize={hexW * 0.11} fill="#6B5A3A" fontWeight={700}>
        {sub}
      </text>
    </g>
  );
}

// ---------- Räuber ----------
// Klassische Spielfigur (Bauer/Meeple): Kugelkopf, Kragen, glockenförmiger Körper,
// runder Sockel. Glatte Bézier-Silhouette statt eckigem Polygon.
export function Robber({ hex }: { hex: Hex }) {
  const w = hex.w * 0.34; // Referenzbreite
  const h = hex.w * 0.52; // Gesamthöhe
  const cx = hex.cx;
  const topY = hex.cy - h * 0.62; // Scheitel des Kopfes

  const headR = w * 0.27;
  const headCy = topY + headR;
  const neckY = headCy + headR * 0.92; // Halsöffnung / Kragen
  const neckHalf = w * 0.15;
  const bodyHalf = w * 0.46; // maximale Körperbreite
  const baseY = topY + h; // Standfläche
  const baseTopY = baseY - h * 0.12; // Oberkante des Sockels

  // Glockenförmiger Körper von der Halsöffnung zum Sockel (links runter, rechts hoch).
  const body =
    `M ${cx - neckHalf} ${neckY} ` +
    `C ${cx - neckHalf} ${neckY + h * 0.1}, ${cx - bodyHalf} ${baseTopY - h * 0.16}, ${cx - bodyHalf} ${baseTopY} ` +
    `L ${cx + bodyHalf} ${baseTopY} ` +
    `C ${cx + bodyHalf} ${baseTopY - h * 0.16}, ${cx + neckHalf} ${neckY + h * 0.1}, ${cx + neckHalf} ${neckY} Z`;

  return (
    <g style={{ pointerEvents: 'none', filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.55))' }}>
      {/* Bodenschatten */}
      <ellipse cx={cx} cy={baseY + h * 0.015} rx={bodyHalf * 1.12} ry={w * 0.13} fill="rgba(0,0,0,.3)" />
      {/* Sockel */}
      <ellipse cx={cx} cy={baseTopY} rx={bodyHalf} ry={w * 0.16} fill="url(#robberBody)" stroke="rgba(0,0,0,.4)" strokeWidth={0.6} />
      {/* Körper */}
      <path d={body} fill="url(#robberBody)" stroke="rgba(0,0,0,.4)" strokeWidth={0.6} />
      {/* Kragen */}
      <ellipse cx={cx} cy={neckY} rx={neckHalf * 1.7} ry={w * 0.08} fill="url(#robberHead)" stroke="rgba(0,0,0,.32)" strokeWidth={0.5} />
      {/* Kopf */}
      <circle cx={cx} cy={headCy} r={headR} fill="url(#robberHead)" stroke="rgba(0,0,0,.35)" strokeWidth={0.5} />
      {/* Glanzlicht */}
      <ellipse cx={cx - headR * 0.3} cy={headCy - headR * 0.34} rx={headR * 0.32} ry={headR * 0.22} fill="rgba(255,255,255,.4)" />
    </g>
  );
}

// ---------- Spielfiguren ----------
export function RoadPiece({ x1, y1, x2, y2, w, color }: { x1: number; y1: number; x2: number; y2: number; w: number; color: PlayerColor }) {
  // auf 68 % der Kantenlänge zusammenziehen
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const f = 0.68;
  const ax = mx + (x1 - mx) * f;
  const ay = my + (y1 - my) * f;
  const bx = mx + (x2 - mx) * f;
  const by = my + (y2 - my) * f;
  const width = w * 0.12;
  return (
    <g style={{ pointerEvents: 'none' }}>
      <line x1={ax} y1={ay + 3} x2={bx} y2={by + 3} stroke={color.d} strokeWidth={width} strokeLinecap="round" />
      <line x1={ax} y1={ay} x2={bx} y2={by} stroke={color.c} strokeWidth={width} strokeLinecap="round" />
    </g>
  );
}

export function Settlement({ x, y, w, color, city }: { x: number; y: number; w: number; color: PlayerColor; city?: boolean }) {
  const s = w * (city ? 0.3 : 0.24);
  return (
    <g transform={`translate(${x - s / 2}, ${y - s / 2})`} style={{ pointerEvents: 'none', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.7))' }}>
      {city ? (
        <>
          {/* Turm */}
          <rect x={0} y={s * 0.3} width={s * 0.34} height={s * 0.7} fill={color.c} />
          <polygon points={`${0},${s * 0.3} ${s * 0.17},${s * 0.06} ${s * 0.34},${s * 0.3}`} fill={color.c2} />
          {/* Hauptgebäude */}
          <rect x={s * 0.32} y={s * 0.5} width={s * 0.68} height={s * 0.5} fill={color.c} />
          <polygon points={`${s * 0.32},${s * 0.5} ${s * 0.66},${s * 0.26} ${s},${s * 0.5}`} fill={color.c2} />
        </>
      ) : (
        <>
          <rect x={s * 0.12} y={s * 0.45} width={s * 0.76} height={s * 0.55} fill={color.c} />
          <polygon points={`${s * 0.12},${s * 0.45} ${s * 0.5},${s * 0.08} ${s * 0.88},${s * 0.45}`} fill={color.c2} />
          <rect x={s * 0.4} y={s * 0.62} width={s * 0.2} height={s * 0.38} fill="rgba(0,0,0,.35)" />
        </>
      )}
    </g>
  );
}

// ---------- Defs (Verläufe/Filter) ----------
export function BoardDefs() {
  return (
    <defs>
      {(['F', 'H', 'P', 'G', 'M', 'D', 'W'] as const).map((k) => {
        const t = TERRAIN[k];
        return (
          <radialGradient key={k} id={`grad-${k}`} cx="0.35" cy="0.25" r="0.95">
            <stop offset="0" stopColor={t.light} />
            <stop offset="0.75" stopColor={t.base} />
            <stop offset="1" stopColor={t.base} />
          </radialGradient>
        );
      })}
      <filter id="tileShadow" x="-20%" y="-20%" width="140%" height="150%">
        <feDropShadow dx="0" dy="5" stdDeviation="3.5" floodColor="#000" floodOpacity="0.35" />
      </filter>
      <linearGradient id="robberBody" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#646E7A" />
        <stop offset="0.48" stopColor="#3E444D" />
        <stop offset="1" stopColor="#23272D" />
      </linearGradient>
      <radialGradient id="robberHead" cx="0.33" cy="0.28" r="0.8">
        <stop offset="0" stopColor="#79828F" />
        <stop offset="0.78" stopColor="#383E46" />
      </radialGradient>
    </defs>
  );
}
