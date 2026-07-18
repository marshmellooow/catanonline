import { useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { Board as BoardT, PlayerColor } from '@catan/shared';
import { RoadPiece, Settlement, hexVerts } from './pieces';
import { adjacentLandHexIds, buildLabel, type BuildSelection } from './buildSelectionLogic';
import { Check, X } from '../../icons';

function insetHexPoints(board: BoardT, hexId: number): string {
  const hex = board.hexes[hexId];
  if (!hex) return '';
  const factor = 0.94;
  return hexVerts(hex)
    .map(([x, y]) => `${hex.cx + (x - hex.cx) * factor},${hex.cy + (y - hex.cy) * factor}`)
    .join(' ');
}

/** Sanfter Flächenpuls: zeigt während der Auswahl angrenzende Landfelder. */
export function AdjacentHexFeedback({ board, selection }: { board: BoardT; selection: BuildSelection }) {
  const ids = adjacentLandHexIds(board, selection);
  if (!ids.length) return null;
  return (
    <g className="build-adjacent-feedback" style={{ pointerEvents: 'none' }}>
      {ids.map((id) => (
        <polygon
          key={id}
          data-adjacent-hex={id}
          className="build-adjacent-hex"
          points={insetHexPoints(board, id)}
        />
      ))}
    </g>
  );
}

interface BuildPreviewProps {
  board: BoardT;
  selection: BuildSelection;
  color: PlayerColor;
}

function selectionAnchor(board: BoardT, selection: BuildSelection) {
  const edge = selection.kind === 'road' ? board.edges[selection.edge] : null;
  const corner = selection.kind === 'road' ? null : board.corners[selection.corner];
  return edge
    ? { x: (edge.x1 + edge.x2) / 2, y: (edge.y1 + edge.y2) / 2 }
    : corner
      ? { x: corner.x, y: corner.y }
      : null;
}

/** Das markierte Ziel bleibt Teil der scharfen SVG-Geometrie und folgt Pan/Zoom. */
export function BuildTargetPreview({ board, selection, color }: BuildPreviewProps) {
  const anchor = selectionAnchor(board, selection);
  if (!anchor) return null;
  const w = board.hexW;
  const edge = selection.kind === 'road' ? board.edges[selection.edge] : null;

  return (
    <g data-build-target-preview={selection.kind}>
      {edge ? (
        <g className="build-target-preview" opacity={0.72} style={{ pointerEvents: 'none' }}>
          <RoadPiece x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} w={w} color={color} />
        </g>
      ) : (
        <circle
          className="build-target-ring"
          cx={anchor.x}
          cy={anchor.y}
          r={w * 0.18}
          fill="rgba(255,246,224,.12)"
          stroke={color.c}
          strokeWidth={w * 0.045}
          style={{ pointerEvents: 'none' }}
        />
      )}
    </g>
  );
}

interface ScreenPosition {
  left: number;
  top: number;
  width: number;
  above: boolean;
  stemX: number;
  stemHeight: number;
}

interface BuildConfirmationOverlayProps extends BuildPreviewProps {
  svgRef: RefObject<SVGSVGElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}

const CARD_WIDTH = 184;
const CARD_HEIGHT = 100;
const CARD_GAP = 16;
const VIEWPORT_GUTTER = 28;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/**
 * Die Karte bleibt bewusst im Bildschirmraum: Auf großen Karten, bei mobilem
 * Fit-to-screen sowie nach Pan/Zoom behält sie echte 44-px-Touchziele. Nur Ziel-
 * Ring beziehungsweise Geisterstraße liegen weiterhin in der SVG-Geometrie.
 */
export function BuildConfirmationOverlay({
  board,
  selection,
  color,
  svgRef,
  onConfirm,
  onCancel,
}: BuildConfirmationOverlayProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<ScreenPosition | null>(null);
  const selectionKey = `${selection.kind}-${selection.kind === 'road' ? selection.edge : selection.corner}`;
  const label = buildLabel(selection.kind);

  useEffect(() => {
    const svg = svgRef.current;
    const anchor = selectionAnchor(board, selection);
    const layer = svg?.querySelector<SVGGElement>('[data-zoom-layer]');
    if (!svg || !layer || !anchor) return;
    const panzoom = svg.closest('.panzoom');
    let frame = 0;

    const updatePosition = () => {
      const matrix = layer.getScreenCTM();
      if (!matrix) return;
      const point = svg.createSVGPoint();
      point.x = anchor.x;
      point.y = anchor.y;
      const screen = point.matrixTransform(matrix);
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(CARD_WIDTH, Math.max(120, viewportWidth - VIEWPORT_GUTTER * 2));
      const maxLeft = Math.max(VIEWPORT_GUTTER, viewportWidth - width - VIEWPORT_GUTTER);
      const aboveSpace = screen.y - CARD_GAP;
      const belowSpace = viewportHeight - screen.y - CARD_GAP;
      const above = aboveSpace >= CARD_HEIGHT || aboveSpace >= belowSpace;
      const preferredTop = above ? screen.y - CARD_HEIGHT - CARD_GAP : screen.y + CARD_GAP;
      const maxTop = Math.max(VIEWPORT_GUTTER, viewportHeight - CARD_HEIGHT - VIEWPORT_GUTTER);
      const left = clamp(screen.x - width / 2, VIEWPORT_GUTTER, maxLeft);
      const top = clamp(preferredTop, VIEWPORT_GUTTER, maxTop);
      const connectorDistance = above
        ? screen.y - (top + CARD_HEIGHT)
        : top - screen.y;
      const next: ScreenPosition = {
        left,
        top,
        width,
        above,
        stemX: clamp(screen.x - left, 24, width - 24),
        stemHeight: clamp(connectorDistance, 8, 48),
      };
      setPosition((current) => current
        && Math.abs(current.left - next.left) < 0.5
        && Math.abs(current.top - next.top) < 0.5
        && current.width === next.width
        && current.above === next.above
        && Math.abs(current.stemX - next.stemX) < 0.5
        && Math.abs(current.stemHeight - next.stemHeight) < 0.5
        ? current
        : next);
    };
    const schedulePosition = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    };

    updatePosition();
    panzoom?.addEventListener('catan:board-transform', schedulePosition);
    window.addEventListener('resize', schedulePosition);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedulePosition);
    observer?.observe(svg);
    return () => {
      cancelAnimationFrame(frame);
      panzoom?.removeEventListener('catan:board-transform', schedulePosition);
      window.removeEventListener('resize', schedulePosition);
      observer?.disconnect();
    };
  }, [board, selection, selectionKey, svgRef]);

  useEffect(() => {
    if (position) confirmRef.current?.focus();
  }, [selectionKey, !!position]);

  const style = position
    ? ({
        left: position.left,
        top: position.top,
        width: position.width,
        '--build-stem-x': `${position.stemX}px`,
        '--build-stem-height': `${position.stemHeight}px`,
      } as CSSProperties)
    : ({ visibility: 'hidden' } as CSSProperties);

  return (
    <div
      data-build-preview={selection.kind}
      data-preview-corner={selection.kind === 'road' ? undefined : selection.corner}
      data-preview-edge={selection.kind === 'road' ? selection.edge : undefined}
      className={`build-confirm-overlay ${position?.above ? 'above' : 'below'}`}
      style={style}
    >
      <span className="build-confirm-screen-stem" aria-hidden="true" />
      <button
        ref={confirmRef}
        type="button"
        data-build-confirm={selection.kind}
        className="build-confirm-main"
        aria-label={`${label} hier bauen`}
        onClick={onConfirm}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <span className="build-confirm-copy">
          <strong>{label}</strong>
          <small>Hier bauen</small>
        </span>
        <svg className="build-confirm-piece" viewBox="0 0 80 64" aria-hidden="true" focusable="false">
          {selection.kind === 'road' ? (
            <RoadPiece x1={14} y1={46} x2={66} y2={18} w={84} color={color} />
          ) : (
            <Settlement x={40} y={43} w={160} color={color} city={selection.kind === 'city'} />
          )}
        </svg>
        <span className="build-confirm-check" aria-hidden="true"><Check size={21} /></span>
      </button>
      <button
        type="button"
        data-build-cancel
        className="build-confirm-cancel"
        aria-label="Auswahl abbrechen"
        onClick={onCancel}
      >
        <X size={19} />
      </button>
    </div>
  );
}
