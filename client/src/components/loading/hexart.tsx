// Gemeinsame Hex-Geometrie + SVG-Bausteine für die Ladebildschirme (Boot + Spielstart).
// Bewusst eigenständig von components/board/pieces.tsx: leichtgewichtig, ohne Board-Datenmodell.
import type { CSSProperties } from 'react';
import { TERRAIN, type TerrainCode } from '@catan/shared';

const SQ3 = 1.7320508075688772;

export interface HexCell {
  q: number;
  r: number;
  cx: number;
  cy: number;
  ring: number;
  terrain: TerrainCode;
}

/** Eckpunkte eines spitz-oben-Hexagons um (cx,cy) mit Umkreisradius rad. */
export function hexPoints(cx: number, cy: number, rad: number): string {
  let s = '';
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    s += `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)} `;
  }
  return s.trim();
}

export function axialToPixel(q: number, r: number, rad: number): { cx: number; cy: number } {
  return { cx: rad * SQ3 * (q + r / 2), cy: rad * 1.5 * r };
}

const hexRing = (q: number, r: number): number => (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;

/** 7-Feld-„Blume" (Zentrum + Ring). */
export function flowerCells(rad: number, terr: readonly TerrainCode[]): HexCell[] {
  const axial: Array<[number, number]> = [[0, 0], [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  return axial.map(([q, r], i) => {
    const { cx, cy } = axialToPixel(q, r, rad);
    return { q, r, cx, cy, ring: hexRing(q, r), terrain: terr[i % terr.length] };
  });
}

/** 19-Feld-Insel (Radius-2-Hexagon), wie ein klassisches Catan-Board. */
export function islandCells(rad: number, terr: readonly TerrainCode[]): HexCell[] {
  const cells: HexCell[] = [];
  let i = 0;
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      if (Math.abs(q + r) > 2) continue;
      const { cx, cy } = axialToPixel(q, r, rad);
      cells.push({ q, r, cx, cy, ring: hexRing(q, r), terrain: terr[i % terr.length] });
      i++;
    }
  }
  return cells;
}

/** Radial-Verläufe je Terrain (Board-Farben) — Prefix macht die IDs pro Screen eindeutig. */
export function HexGradients({ prefix, codes }: { prefix: string; codes: TerrainCode[] }) {
  return (
    <defs>
      {codes.map((k) => {
        const t = TERRAIN[k];
        return (
          <radialGradient key={k} id={`${prefix}-${k}`} cx="0.35" cy="0.28" r="0.95">
            <stop offset="0" stopColor={t.light} />
            <stop offset="0.8" stopColor={t.base} />
            <stop offset="1" stopColor={t.base} />
          </radialGradient>
        );
      })}
    </defs>
  );
}

/** Ein einzelnes Feld mit leichter 3D-Kante. */
export function HexTile({
  cell,
  rad,
  gradPrefix,
  className,
  style,
}: {
  cell: HexCell;
  rad: number;
  gradPrefix: string;
  className?: string;
  style?: CSSProperties;
}) {
  const t = TERRAIN[cell.terrain];
  const face = hexPoints(cell.cx, cell.cy, rad - 1.5);
  const side = hexPoints(cell.cx, cell.cy + 4, rad - 1.5);
  return (
    <g className={className} style={style}>
      <polygon points={side} fill={t.side} />
      <polygon points={face} fill={`url(#${gradPrefix}-${cell.terrain})`} stroke="rgba(0,0,0,.16)" strokeWidth={0.6} />
    </g>
  );
}

export function uniqueCodes(cells: HexCell[]): TerrainCode[] {
  return Array.from(new Set(cells.map((c) => c.terrain)));
}
