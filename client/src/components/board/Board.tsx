import { memo } from 'react';
import type { Board as BoardT, PlayerColor } from '@catan/shared';
import { Tile, PortMark, Robber, RoadPiece, Settlement, BoardDefs, hexVerts } from './pieces';

const PAD = 34;

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
      {props.highlightHexes?.map((id) => {
        const hex = board.hexes[id];
        if (!hex) return null;
        const pts = hexVerts(hex).map(([x, y]) => `${x},${y}`).join(' ');
        return (
          <polygon
            key={`hh${id}`}
            points={pts}
            fill="rgba(235,194,94,.18)"
            stroke="var(--gold)"
            strokeWidth={3}
            style={{ cursor: 'pointer' }}
            className="pulse-soft"
            onClick={() => props.onHex?.(id)}
          />
        );
      })}

      {props.highlightEdges?.map((id) => {
        const e = board.edges[id];
        if (!e) return null;
        return (
          <g key={`he${id}`} style={{ cursor: 'pointer' }} onClick={() => props.onEdge?.(id)}>
            {/* dunkle Kontur — konstanter Kontrast auf hellem wie dunklem Terrain */}
            <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="#1c1508" strokeWidth={w * 0.26} strokeLinecap="round" opacity={0.55} />
            {/* heller, glühender, stark pulsierender Kern */}
            <line
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              stroke="#FFD766"
              strokeWidth={w * 0.16}
              strokeLinecap="round"
              filter="url(#hlGlow)"
              className="pulse-strong"
            />
            {/* breiter unsichtbarer Klick-/Touch-Bereich */}
            <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="transparent" strokeWidth={w * 0.4} strokeLinecap="round" />
          </g>
        );
      })}

      {props.highlightCorners?.map((id) => {
        const c = board.corners[id];
        if (!c) return null;
        return (
          <g key={`hc${id}`} style={{ cursor: 'pointer' }} onClick={() => props.onCorner?.(id)}>
            <circle cx={c.x} cy={c.y} r={w * 0.22} fill="transparent" />
            {/* pulsierender Glut-Ring */}
            <circle
              cx={c.x}
              cy={c.y}
              r={w * 0.17}
              fill="none"
              stroke="#FFD766"
              strokeWidth={w * 0.05}
              filter="url(#hlGlow)"
              className="pulse-node"
              style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
            />
            {/* heller Kern-Punkt */}
            <circle
              cx={c.x}
              cy={c.y}
              r={w * 0.105}
              fill="#FFD766"
              stroke="#2a2011"
              strokeWidth={1.5}
              filter="url(#hlGlow)"
            />
          </g>
        );
      })}
    </svg>
  );
});

export default Board;
