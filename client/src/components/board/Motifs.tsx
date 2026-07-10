import type { TerrainCode } from '@catan/shared';
import { MOTIFS } from '@catan/shared';

const TRI = 'polygon(50% 0%,100% 100%,0% 100%)';
type Motif = (typeof MOTIFS)['F'][number];

/** Ein einzelnes Motiv innerhalb einer Box (x,y,w,h) rendern. */
export function motifShape(box: { x: number; y: number; w: number; h: number }, m: Motif, key: number) {
  const x0 = box.x + (m.l / 100) * box.w;
  const y0 = box.y + (m.t / 100) * box.h;
  const mw = (m.w / 100) * box.w;
  const mh = (m.h / 100) * box.h;
  if (m.clip === TRI) {
    return <polygon key={key} points={`${x0 + mw / 2},${y0} ${x0 + mw},${y0 + mh} ${x0},${y0 + mh}`} fill={m.bg} />;
  }
  if (m.rad === '50%') {
    return <ellipse key={key} cx={x0 + mw / 2} cy={y0 + mh / 2} rx={mw / 2} ry={mh / 2} fill={m.bg} />;
  }
  if (m.rad.startsWith('50% 50% 0 0')) {
    const r = Math.min(mw / 2, mh);
    const d = `M ${x0} ${y0 + mh} L ${x0} ${y0 + r} Q ${x0} ${y0} ${x0 + r} ${y0} L ${x0 + mw - r} ${y0} Q ${x0 + mw} ${y0} ${x0 + mw} ${y0 + r} L ${x0 + mw} ${y0 + mh} Z`;
    return <path key={key} d={d} fill={m.bg} />;
  }
  const rr = m.rad === '0' || m.rad === 'none' ? 0 : Math.min(mw, mh) / 2;
  return <rect key={key} x={x0} y={y0} width={mw} height={mh} rx={rr} ry={rr} fill={m.bg} />;
}

/** Alle Motive eines Geländetyps innerhalb einer Box. */
export function Motifs({ x, y, w, h, terrain }: { x: number; y: number; w: number; h: number; terrain: TerrainCode }) {
  return <>{MOTIFS[terrain].map((m, i) => motifShape({ x, y, w, h }, m, i))}</>;
}
