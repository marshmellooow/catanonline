import { memo } from 'react';
import type { Board as BoardT, PlayerColor } from '@catan/shared';
import { Tile, PortMark, Robber, RoadPiece, Settlement, BoardDefs } from './pieces';

const PAD = 34;

/** Ein Tortenstück (Segment i von n) als SVG-Pfad um (cx,cy) mit Radius r; Start oben. */
function pieSlice(cx: number, cy: number, r: number, i: number, n: number): string {
  const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
  const a1 = ((i + 1) / n) * 2 * Math.PI - Math.PI / 2;
  const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`;
}

export interface BoardProps {
  board: BoardT;
  buildings: Record<number, { owner: string; type: 'settlement' | 'city' }>;
  roads: Record<number, { owner: string }>;
  robberHex: number;
  colorOf: (playerId: string) => PlayerColor;
  highlightCorners?: number[];
  highlightEdges?: number[];
  highlightHexes?: number[];
  onCorner?: (id: number) => void;
  onEdge?: (id: number) => void;
  onHex?: (id: number) => void;
}

// Statische Ebene: Terrain + Häfen. Rendert nur neu, wenn sich das Board ändert.
const StaticLayer = memo(function StaticLayer({ board }: { board: BoardT }) {
  return (
    <g>
      {board.hexes.map((hex) => (
        <Tile key={hex.id} hex={hex} />
      ))}
      {board.ports.map((port) => (
        <PortMark
          key={port.id}
          port={port}
          hexW={board.hexW}
          corners={port.corners.map((cid) => board.corners[cid]).filter(Boolean).map((c) => ({ x: c.x, y: c.y }))}
        />
      ))}
    </g>
  );
});

export const Board = memo(function Board(props: BoardProps) {
  const { board, buildings, roads, robberHex, colorOf } = props;
  const w = board.hexW;
  const vbW = board.width + PAD * 2;
  const vbH = board.height + PAD * 2 + 12;

  return (
    <svg
      viewBox={`${-PAD} ${-PAD} ${vbW} ${vbH}`}
      style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none' }}
      preserveAspectRatio="xMidYMid meet"
    >
      <BoardDefs />
      <StaticLayer board={board} />

      {/* Straßen */}
      {Object.entries(roads).map(([id, r]) => {
        const e = board.edges[Number(id)];
        if (!e) return null;
        return <RoadPiece key={`r${id}`} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} w={w} color={colorOf(r.owner)} />;
      })}

      {/* Gebäude */}
      {Object.entries(buildings).map(([id, b]) => {
        const c = board.corners[Number(id)];
        if (!c) return null;
        return (
          <g key={`b${id}`} data-corner={id}>
            <Settlement x={c.x} y={c.y} w={w} color={colorOf(b.owner)} city={b.type === 'city'} />
          </g>
        );
      })}

      {/* Räuber */}
      {board.hexes[robberHex] && <Robber hex={board.hexes[robberHex]} />}

      {/* Highlights + Klick-Ziele */}
      {/* Räuber-Platzierung: dezenter halbtransparenter Kreis je gültigem Feld,
          farblich geteilt nach den Spielern, die dort eine Siedlung/Stadt haben. */}
      {props.highlightHexes?.map((id) => {
        const hex = board.hexes[id];
        if (!hex) return null;
        const owners = [...new Set(hex.corners.map((cid) => buildings[cid]?.owner).filter((o): o is string => !!o))];
        const cols = owners.map((o) => colorOf(o).c);
        const r = w * 0.28;
        return (
          <g key={`hh${id}`} style={{ cursor: 'pointer' }} className="pulse-soft" onClick={() => props.onHex?.(id)}>
            {/* leichter Grund, damit der Kreis auf jedem Feld erkennbar ist */}
            <circle cx={hex.cx} cy={hex.cy} r={r} fill="rgba(8,12,18,0.20)" />
            {cols.length === 1 && <circle cx={hex.cx} cy={hex.cy} r={r} fill={cols[0]} fillOpacity={0.5} />}
            {cols.length > 1 && cols.map((col, i) => <path key={i} d={pieSlice(hex.cx, hex.cy, r, i, cols.length)} fill={col} fillOpacity={0.55} />)}
            <circle cx={hex.cx} cy={hex.cy} r={r} fill="none" stroke="rgba(255,246,224,0.85)" strokeWidth={2.5} />
          </g>
        );
      })}

      {/* Straßen-Bauplätze: saubere „Geister-Straße" — goldener Schimmer + heller Kern,
          kein Filter/keine dunkle Kontur (die auf dunklen Feldern buggy wirkte). */}
      {props.highlightEdges?.map((id) => {
        const e = board.edges[id];
        if (!e) return null;
        return (
          <g key={`he${id}`} style={{ cursor: 'pointer' }} className="pulse-soft" onClick={() => props.onEdge?.(id)}>
            <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="var(--gold)" strokeWidth={w * 0.15} strokeLinecap="round" opacity={0.4} />
            <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#FFF6E0" strokeWidth={w * 0.05} strokeLinecap="round" opacity={0.95} />
            {/* breiter unsichtbarer Klick-/Touch-Bereich */}
            <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="transparent" strokeWidth={w * 0.4} strokeLinecap="round" />
          </g>
        );
      })}

      {/* Siedlungs-/Stadt-Bauplätze: sauberer halbtransparenter Kreis mit hellem Rand
          (wie die Startplatzierung — klar, aber nicht überstrahlt). */}
      {props.highlightCorners?.map((id) => {
        const c = board.corners[id];
        if (!c) return null;
        return (
          <g key={`hc${id}`} style={{ cursor: 'pointer' }} onClick={() => props.onCorner?.(id)}>
            <circle cx={c.x} cy={c.y} r={w * 0.22} fill="transparent" />
            <circle
              cx={c.x}
              cy={c.y}
              r={w * 0.14}
              fill="var(--gold)"
              fillOpacity={0.32}
              stroke="#FFF6E0"
              strokeWidth={w * 0.03}
              className="pulse-soft"
            />
          </g>
        );
      })}
    </svg>
  );
});

export default Board;
