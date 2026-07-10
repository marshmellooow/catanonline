import type { ResourceType } from '@catan/shared';
import { TERRAIN, RESOURCE_LABEL } from '@catan/shared';
import { RES_TERRAIN } from './ui';

/** Rohstoff-Farbe (Gelände-Grundton) — reicht als kompaktes Icon im Log/Tooltip. */
export function resColor(res: ResourceType): string {
  return TERRAIN[RES_TERRAIN[res]].base;
}

/**
 * Kompakter farbiger Rohstoff-Chip mit Anzahl (nur Farbe, kein Motiv).
 * `dim` = Rohstoff nicht (ausreichend) vorhanden → ausgegraut (für Kosten-Tooltip).
 */
export function ResChip({
  res,
  count,
  size = 14,
  dim = false,
}: {
  res: ResourceType;
  count?: number;
  size?: number;
  dim?: boolean;
}) {
  return (
    <span className={`res-chip${dim ? ' dim' : ''}`} title={RESOURCE_LABEL[res]}>
      {count != null && <span className="res-chip-n">{count}×</span>}
      <span
        className="res-chip-swatch"
        style={{ width: size, height: size, background: resColor(res) }}
      />
    </span>
  );
}
