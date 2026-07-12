import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { islandCells, HexGradients, HexTile, uniqueCodes } from './hexart';
import { chipColor, pipCount, APP_VERSION_LABEL, type TerrainCode } from '@catan/shared';
import './loading.css';

const RAD = 24;
// Bewusst „gemischte" Verteilung — rein dekorativ, keine echte Catan-Regel.
const ISLAND_TERR: TerrainCode[] = ['P', 'F', 'G', 'M', 'H', 'F', 'G', 'P', 'M', 'D', 'H', 'P', 'G', 'F', 'P', 'G', 'H', 'F', 'M'];
const ISLAND_NUMS = [9, 5, 10, 8, 4, 11, 6, 3, 5, 0, 12, 9, 4, 6, 2, 10, 3, 8, 11];
const CELLS = islandCells(RAD, ISLAND_TERR);
const CODES = uniqueCodes(CELLS);

const LEAVE_MS = 2400; // Ausblenden starten
const DONE_MS = 2900; // aus dem DOM nehmen (muss > LEAVE_MS + Fade sein)

/** Kleiner runder Zahlen-Chip wie ein Catan-Zahlentoken. */
function Chip({ cx, cy, n, delay }: { cx: number; cy: number; n: number; delay: number }) {
  const col = chipColor(n);
  const pips = pipCount(n);
  const r = RAD * 0.4;
  const pipR = 0.9;
  const gap = pipR * 2.6;
  const startX = cx - ((pips - 1) * gap) / 2;
  const strong = n === 6 || n === 8;
  return (
    <g className="isle-chip" style={{ animationDelay: `${delay.toFixed(2)}s` }}>
      <circle cx={cx} cy={cy} r={r} fill="#F8F2DE" stroke="rgba(90,74,48,.3)" strokeWidth={0.8} />
      <text
        x={cx}
        y={cy - r * 0.16}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Marcellus, serif"
        fontSize={RAD * 0.34}
        fill={col}
        fontWeight={strong ? 700 : 400}
      >
        {n}
      </text>
      {Array.from({ length: pips }).map((_, i) => (
        <circle key={i} cx={startX + i * gap} cy={cy + r * 0.5} r={pipR} fill={col} />
      ))}
    </g>
  );
}

/** Ladebildschirm beim Spielstart durch den Host — die Insel baut sich sichtbar auf. */
export function GameIntro() {
  const endGameStart = useStore((s) => s.endGameStart);
  const room = useStore((s) => s.room);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setLeaving(true), LEAVE_MS);
    const t2 = setTimeout(endGameStart, DONE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [endGameStart]);

  const host = room?.players.find((p) => p.isHost)?.name;

  return (
    <div className={`intro ${leaving ? 'is-leaving' : ''}`} role="status" aria-live="polite">
      <div className="intro-inner">
        <div className="intro-title">Das Spiel beginnt</div>

        <div className="intro-stage">
          <div className="isle-wave" aria-hidden="true" />
          <svg className="intro-island" viewBox="-108 -104 216 210" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <HexGradients prefix="isle" codes={CODES} />
            {CELLS.map((c, i) => (
              <HexTile
                key={`h${i}`}
                cell={c}
                rad={RAD}
                gradPrefix="isle"
                className="isle-hex"
                style={{ animationDelay: `${(0.15 * c.ring + 0.03 * i).toFixed(2)}s` }}
              />
            ))}
            {CELLS.map((c, i) =>
              c.terrain === 'D' || !ISLAND_NUMS[i] ? null : (
                <Chip key={`c${i}`} cx={c.cx} cy={c.cy} n={ISLAND_NUMS[i]} delay={1.25 + 0.025 * i} />
              ),
            )}
          </svg>
        </div>

        <div className="intro-sub">{host ? `${host} eröffnet die Partie` : 'Die Insel wird vorbereitet…'}</div>
        <div className="intro-version">{APP_VERSION_LABEL}</div>
      </div>
    </div>
  );
}
