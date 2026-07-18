import type { Board as BoardT, GameAction, PublicState } from '@catan/shared';

export type BuildIntent = 'road' | 'settlement' | 'city' | null;
export type BuildKind = Exclude<BuildIntent, null>;

export type BuildSelection =
  | { kind: 'settlement' | 'city'; corner: number }
  | { kind: 'road'; edge: number };

const BUILD_LABEL: Record<BuildKind, string> = {
  settlement: 'Siedlung',
  city: 'Stadt',
  road: 'Straße',
};

export function buildLabel(kind: BuildKind): string {
  return BUILD_LABEL[kind];
}

/** Welche Figur kann im aktuellen Spielkontext überhaupt ausgewählt werden? */
export function buildKindForContext(phase: PublicState['phase'], intent: BuildIntent): BuildKind | null {
  if (phase === 'setupSettlement') return 'settlement';
  if (phase === 'setupRoad' || phase === 'roadBuilding') return 'road';
  if (phase === 'main') return intent;
  return null;
}

export function selectCornerBuild(
  phase: PublicState['phase'],
  intent: BuildIntent,
  corner: number,
): BuildSelection | null {
  const kind = buildKindForContext(phase, intent);
  return kind === 'settlement' || kind === 'city' ? { kind, corner } : null;
}

export function selectEdgeBuild(
  phase: PublicState['phase'],
  intent: BuildIntent,
  edge: number,
): BuildSelection | null {
  return buildKindForContext(phase, intent) === 'road' ? { kind: 'road', edge } : null;
}

/**
 * Übersetzt nur eine noch zum aktuellen Kontext passende Auswahl in eine Aktion.
 * Wechselt zwischen Auswahl und Bestätigung der Zug oder die Phase, liefert die
 * Funktion bewusst null statt eine veraltete Aktion an den Server zu schicken.
 */
export function actionForBuildSelection(
  phase: PublicState['phase'],
  intent: BuildIntent,
  selection: BuildSelection,
): GameAction | null {
  if (buildKindForContext(phase, intent) !== selection.kind) return null;
  if (selection.kind === 'road') {
    if (phase === 'setupRoad') return { type: 'placeSetupRoad', edge: selection.edge };
    if (phase === 'roadBuilding' || (phase === 'main' && intent === 'road')) {
      return { type: 'buildRoad', edge: selection.edge };
    }
    return null;
  }
  if (selection.kind === 'settlement') {
    if (phase === 'setupSettlement') return { type: 'placeSetupSettlement', corner: selection.corner };
    if (phase === 'main' && intent === 'settlement') return { type: 'buildSettlement', corner: selection.corner };
    return null;
  }
  if (phase === 'main' && intent === 'city') return { type: 'buildCity', corner: selection.corner };
  return null;
}

/** Nur Felder mit echter Landfläche markieren; Wasser würde fälschlich Ertrag suggerieren. */
export function adjacentLandHexIds(board: BoardT, selection: BuildSelection): number[] {
  if (selection.kind === 'road') return [];
  const corner = board.corners[selection.corner];
  return corner?.hexes.filter((id) => board.hexes[id]?.terrain !== 'W') ?? [];
}
