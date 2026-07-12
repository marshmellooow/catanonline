import { useId } from 'react';
import type { ResourceType } from '@catan/shared';
import { TERRAIN, RESOURCE_LABEL } from '@catan/shared';
import { RES_TERRAIN } from './ui';
import { Motifs } from '../board/Motifs';

/** Echte Rohstoffkarte: Cremerahmen, Gelände-Verlauf + Motive (wie auf dem Brett). */
export function ResourceCard({ resource, size = 62, label = true }: { resource: ResourceType; size?: number; label?: boolean }) {
  const code = RES_TERRAIN[resource];
  const t = TERRAIN[code];
  const uid = useId().replace(/:/g, '');
  const W = size;
  const H = Math.round(size * 1.4);
  const fr = Math.max(2, W * 0.075);
  const labelH = label ? W * 0.26 : fr;
  const artX = fr;
  const artY = fr;
  const artW = W - 2 * fr;
  const artH = H - fr - labelH;
  const rArt = W * 0.08;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.35))' }}>
      <defs>
        <radialGradient id={`g${uid}`} cx="0.35" cy="0.25" r="0.95">
          <stop offset="0" stopColor={t.light} />
          <stop offset="0.75" stopColor={t.base} />
          <stop offset="1" stopColor={t.base} />
        </radialGradient>
        <clipPath id={`c${uid}`}>
          <rect x={artX} y={artY} width={artW} height={artH} rx={rArt} ry={rArt} />
        </clipPath>
      </defs>
      <rect x="0.5" y="0.5" width={W - 1} height={H - 1} rx={W * 0.14} fill="#F8F2DE" stroke="rgba(90,74,48,.35)" strokeWidth="1" />
      <g clipPath={`url(#c${uid})`}>
        <rect x={artX} y={artY} width={artW} height={artH} fill={`url(#g${uid})`} />
        <Motifs x={artX} y={artY} w={artW} h={artH} terrain={code} />
      </g>
      {label && (
        <text
          x={W / 2}
          y={H - labelH / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={W * 0.17}
          fill="#3A2E1A"
          fontWeight={700}
          fontFamily="'Alegreya Sans', sans-serif"
        >
          {RESOURCE_LABEL[resource]}
        </text>
      )}
    </svg>
  );
}
