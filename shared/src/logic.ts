// Reine Spiellogik-Helfer: Kosten, Bauregeln, Ertrag, Längste Straße,
// Häfen, Siegpunkte. Keine Seiteneffekte außer explizit dokumentiert.

import type { GameState, ResourceCounts, PlayerState, VpBreakdown } from './types.js';
import type { ResourceType } from './design.js';
import { TERRAIN_RESOURCE, RESOURCES } from './design.js';
import type { PortType } from './maps.js';

// ---------- Rohstoff-Helfer ----------

export const COSTS = {
  road: { wood: 1, brick: 1 } as Partial<ResourceCounts>,
  settlement: { wood: 1, brick: 1, wool: 1, grain: 1 } as Partial<ResourceCounts>,
  city: { grain: 2, ore: 3 } as Partial<ResourceCounts>,
  devCard: { wool: 1, grain: 1, ore: 1 } as Partial<ResourceCounts>,
};

export function resourceTotal(rc: ResourceCounts): number {
  return rc.wood + rc.brick + rc.wool + rc.grain + rc.ore;
}

export function canAfford(rc: ResourceCounts, cost: Partial<ResourceCounts>): boolean {
  return RESOURCES.every((r) => rc[r] >= (cost[r] ?? 0));
}

export function payCost(rc: ResourceCounts, cost: Partial<ResourceCounts>): void {
  for (const r of RESOURCES) rc[r] -= cost[r] ?? 0;
}

export function addResources(rc: ResourceCounts, gain: Partial<ResourceCounts>): void {
  for (const r of RESOURCES) rc[r] += gain[r] ?? 0;
}

// ---------- Ecken / Kanten Belegung ----------

export function playerAt(state: GameState, corner: number): string | null {
  return state.buildings[corner]?.owner ?? null;
}

/** Hat die Ecke ein gegnerisches Gebäude (aus Sicht von p)? */
function occupiedByOpponent(state: GameState, corner: number, p: string): boolean {
  const b = state.buildings[corner];
  return !!b && b.owner !== p;
}

// ---------- Bauregeln ----------

/** Grenzt die Ecke an mindestens ein Landfeld (Küste zählt)? */
export function cornerTouchesLand(state: GameState, corner: number): boolean {
  const c = state.board.corners[corner];
  return !!c && c.hexes.some((hid) => state.board.hexes[hid].terrain !== 'W');
}

/** Grenzt die Kante an mindestens ein Landfeld (Küste zählt)? */
export function edgeTouchesLand(state: GameState, edge: number): boolean {
  const e = state.board.edges[edge];
  return !!e && e.hexes.some((hid) => state.board.hexes[hid].terrain !== 'W');
}

/** Kann Spieler p auf dieser Ecke eine Siedlung platzieren? */
export function canPlaceSettlement(state: GameState, corner: number, p: string, setup: boolean): boolean {
  if (state.buildings[corner]) return false;
  const c = state.board.corners[corner];
  if (!c) return false;
  // Nicht auf reinem Wasser — die Ecke muss an mindestens ein Landfeld grenzen (Küste ist erlaubt).
  if (!cornerTouchesLand(state, corner)) return false;
  // Abstandsregel: alle Nachbar-Ecken frei
  for (const adj of c.adjacent) {
    if (state.buildings[adj]) return false;
  }
  if (setup) return true;
  // Muss an eigene Straße anschließen
  return c.edges.some((eid) => state.roads[eid]?.owner === p);
}

/** Verbindet diese Ecke Straßen von p (für Straßenbau)? Exportiert, weil die
 *  Bot-Bewertung (`bot-eval.ts`) denselben Begriff für ihre Straßen-BFS braucht —
 *  eine eigene Kopie dort würde von `canPlaceRoad` abdriften. */
export function cornerConnectsRoad(state: GameState, corner: number, p: string): boolean {
  if (occupiedByOpponent(state, corner, p)) return false;
  const c = state.board.corners[corner];
  if (state.buildings[corner]?.owner === p) return true;
  return c.edges.some((eid) => state.roads[eid]?.owner === p);
}

/** Kann Spieler p auf dieser Kante eine Straße bauen? setupCorner: in der
 *  Startaufstellung muss die Straße an die eben gesetzte Siedlung grenzen. */
export function canPlaceRoad(state: GameState, edge: number, p: string, setupCorner: number | null): boolean {
  if (state.roads[edge]) return false;
  const e = state.board.edges[edge];
  if (!e) return false;
  // Straßen nur an Land/Küste, nie zwischen zwei Wasserfeldern.
  if (!edgeTouchesLand(state, edge)) return false;
  if (setupCorner !== null) {
    return e.a === setupCorner || e.b === setupCorner;
  }
  return cornerConnectsRoad(state, e.a, p) || cornerConnectsRoad(state, e.b, p);
}

export function validSettlementCorners(state: GameState, p: string, setup: boolean): number[] {
  return state.board.corners.filter((c) => canPlaceSettlement(state, c.id, p, setup)).map((c) => c.id);
}

export function validCityCorners(state: GameState, p: string): number[] {
  return Object.keys(state.buildings)
    .map(Number)
    .filter((cid) => state.buildings[cid].owner === p && state.buildings[cid].type === 'settlement');
}

export function validRoadEdges(state: GameState, p: string, setupCorner: number | null): number[] {
  return state.board.edges.filter((e) => canPlaceRoad(state, e.id, p, setupCorner)).map((e) => e.id);
}

// ---------- Häfen ----------

export function playerPorts(state: GameState, p: string): PortType[] {
  const set = new Set<PortType>();
  for (const port of state.board.ports) {
    if (port.corners.some((cid) => state.buildings[cid]?.owner === p)) set.add(port.type);
  }
  return [...set];
}

/** Bester Bank-Kurs für einen Rohstoff (2 mit Spezialhafen, 3 mit 3:1, sonst 4). */
export function bestBankRate(ports: PortType[], resource: ResourceType): number {
  if (ports.includes(resource as PortType)) return 2;
  if (ports.includes('3:1')) return 3;
  return 4;
}

// ---------- Ertrag ----------

/** Rohstoff-Ausschüttung für eine gewürfelte Summe. Mutiert Spieler & Bank. */
export function produceResources(state: GameState, sum: number): Record<string, ResourceCounts> {
  const gains: Record<string, ResourceCounts> = {};
  const ensure = (pid: string): ResourceCounts => (gains[pid] ??= { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });

  // Erst Bedarf sammeln, dann gegen Bank-Bestand ausschütten
  const demand: Record<ResourceType, Array<{ pid: string; amount: number }>> = {
    wood: [], brick: [], wool: [], grain: [], ore: [],
  };

  for (const hex of state.board.hexes) {
    if (hex.number !== sum) continue;
    if (hex.id === state.robberHex) continue;
    const res = TERRAIN_RESOURCE[hex.terrain];
    if (!res) continue;
    for (const cid of hex.corners) {
      const b = state.buildings[cid];
      if (!b) continue;
      const amount = b.type === 'city' ? 2 : 1;
      demand[res].push({ pid: b.owner, amount });
    }
  }

  for (const res of RESOURCES) {
    const reqs = demand[res];
    const totalReq = reqs.reduce((s, r) => s + r.amount, 0);
    if (totalReq === 0) continue;
    if (totalReq <= state.bank[res]) {
      for (const r of reqs) {
        ensure(r.pid)[res] += r.amount;
        state.bank[res] -= r.amount;
      }
    } else {
      // Bank-Knappheit: Nur wenn genau ein Spieler betroffen ist, bekommt er den Rest;
      // sonst erhält niemand diesen Rohstoff (offizielle Regel).
      const players = new Set(reqs.map((r) => r.pid));
      if (players.size === 1) {
        const give = state.bank[res];
        const pid = reqs[0].pid;
        ensure(pid)[res] += give;
        state.bank[res] -= give;
      }
    }
  }
  // leere Einträge entfernen
  for (const pid of Object.keys(gains)) {
    const g = gains[pid];
    if (resourceTotal(g) === 0) delete gains[pid];
    else addResourcesToPlayer(state, pid, g);
  }
  return gains;
}

function addResourcesToPlayer(state: GameState, pid: string, g: ResourceCounts): void {
  const pl = state.players.find((p) => p.id === pid);
  if (pl) addResources(pl.resources, g);
}

// ---------- Längste Straße ----------

/** Längster zusammenhängender Straßenzug von p (durch gegnerische Gebäude unterbrochen). */
export function computeLongestRoad(state: GameState, p: string): number {
  const owned = state.board.edges.filter((e) => state.roads[e.id]?.owner === p).map((e) => e.id);
  if (owned.length === 0) return 0;
  const edgesById = state.board.edges;
  // Inzidenz: Ecke → eigene Kanten
  const inc = new Map<number, number[]>();
  for (const eid of owned) {
    const e = edgesById[eid];
    (inc.get(e.a) ?? inc.set(e.a, []).get(e.a)!).push(eid);
    (inc.get(e.b) ?? inc.set(e.b, []).get(e.b)!).push(eid);
  }
  const blocked = (corner: number) => occupiedByOpponent(state, corner, p);

  let best = 0;
  const used = new Set<number>();
  const dfs = (corner: number): number => {
    if (blocked(corner)) return 0;
    let localBest = 0;
    for (const eid of inc.get(corner) ?? []) {
      if (used.has(eid)) continue;
      const e = edgesById[eid];
      const next = e.a === corner ? e.b : e.a;
      used.add(eid);
      const len = 1 + dfs(next);
      used.delete(eid);
      if (len > localBest) localBest = len;
    }
    return localBest;
  };

  for (const corner of inc.keys()) {
    const len = dfs(corner);
    if (len > best) best = len;
  }
  return best;
}

// ---------- Auszeichnungen ----------

export function updateLongestRoad(state: GameState): boolean {
  const lengths = new Map<string, number>();
  for (const pl of state.players) lengths.set(pl.id, computeLongestRoad(state, pl.id));
  const holder = state.longestRoadHolder;
  const eligible = [...lengths.entries()].filter(([, l]) => l >= 5);
  let newHolder: string | null = null;
  if (eligible.length > 0) {
    const max = Math.max(...eligible.map(([, l]) => l));
    if (holder && (lengths.get(holder) ?? 0) === max && max >= 5) {
      newHolder = holder;
    } else {
      const top = eligible.filter(([, l]) => l === max).map(([id]) => id);
      if (top.length === 1) newHolder = top[0];
      else if (holder && (lengths.get(holder) ?? 0) >= 5) newHolder = holder;
      else newHolder = null;
    }
  }
  const changed = newHolder !== holder;
  state.longestRoadHolder = newHolder;
  state.longestRoadLength = newHolder ? (lengths.get(newHolder) ?? 0) : 0;
  return changed;
}

export function updateLargestArmy(state: GameState): boolean {
  const holder = state.largestArmyHolder;
  const sizes = state.players.map((p) => ({ id: p.id, k: p.playedKnights }));
  const eligible = sizes.filter((s) => s.k >= 3);
  let newHolder: string | null = holder;
  if (eligible.length > 0) {
    const max = Math.max(...eligible.map((s) => s.k));
    const holderK = holder ? sizes.find((s) => s.id === holder)?.k ?? 0 : 0;
    if (!holder || holderK < max) {
      const top = eligible.filter((s) => s.k === max);
      if (top.length === 1) newHolder = top[0].id;
    }
  } else {
    newHolder = null;
  }
  const changed = newHolder !== holder;
  state.largestArmyHolder = newHolder;
  state.largestArmySize = newHolder ? sizes.find((s) => s.id === newHolder)?.k ?? 0 : 0;
  return changed;
}

// ---------- Siegpunkte ----------

export function countBuildings(state: GameState, p: string): { settlements: number; cities: number } {
  let settlements = 0;
  let cities = 0;
  for (const cid of Object.keys(state.buildings)) {
    const b = state.buildings[Number(cid)];
    if (b.owner !== p) continue;
    if (b.type === 'city') cities++;
    else settlements++;
  }
  return { settlements, cities };
}

/**
 * Woraus sich die Siegpunkte zusammensetzen — die einzige Quelle der Wahrheit;
 * `victoryPoints` ist nur die Summe daraus.
 *
 * `includeHidden`: verdeckte SP-Karten mitzählen. Nur für den Besitzer selbst, für die
 * Sieg-Prüfung — und nach Spielende für alle (dann ist nichts mehr geheim, siehe `view.ts`).
 */
export function victoryPointBreakdown(state: GameState, player: PlayerState, includeHidden: boolean): VpBreakdown {
  const { settlements, cities } = countBuildings(state, player.id);
  const longestRoad = state.longestRoadHolder === player.id;
  const largestArmy = state.largestArmyHolder === player.id;
  const hidden = includeHidden ? player.devCards.victoryPoint + player.newDevCards.victoryPoint : 0;
  return {
    settlements,
    cities,
    longestRoad,
    largestArmy,
    hidden,
    total: settlements + cities * 2 + (longestRoad ? 2 : 0) + (largestArmy ? 2 : 0) + hidden,
  };
}

/** Siegpunkte. includeHidden: verdeckte SP-Karten mitzählen (nur für Besitzer/Sieg). */
export function victoryPoints(state: GameState, player: PlayerState, includeHidden: boolean): number {
  return victoryPointBreakdown(state, player, includeHidden).total;
}

export function checkWin(state: GameState, player: PlayerState): boolean {
  return victoryPoints(state, player, true) >= state.vpTarget;
}
