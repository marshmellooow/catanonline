// Bewertungsschicht für den Bot: „wie gut ist dieser Platz", „wohin zeigt eine Straße",
// „reicht mein Überschuss über die Bank für dieses Ziel". Alles rein und ohne
// Seiteneffekte — kein RNG, kein Date.now, keine State-Mutation. Kennt bewusst KEINE
// `GameAction`: das Übersetzen von Bewertung in Züge macht allein `bot.ts`.
//
// Determinismus ist hier eine harte Anforderung (Tests fahren identische Seeds gegen
// identische Endzustände): alle Schleifen laufen über Board-Arrays in Id-Reihenfolge
// oder über `RESOURCES`. Tie-Breaks IMMER mit striktem `>` — so gewinnt bei Gleichstand
// die niedrigste Id, nie die Zufalls-Reihenfolge einer Hash-Map.

import type { GameState, ResourceCounts } from './types.js';
import type { ResourceType } from './design.js';
import { RESOURCES, TERRAIN_RESOURCE, pipCount } from './design.js';
import {
  canPlaceSettlement, cornerTouchesLand, edgeTouchesLand, cornerConnectsRoad,
  playerPorts, bestBankRate, canAfford,
} from './logic.js';

/** Wie viel ein Rohstoff in der Praxis wert ist. Holz/Lehm bauen früh Straßen und
 *  Siedlungen (und sind damit Expansion), Wolle ist am ehesten entbehrlich. Bewusst
 *  flach gehalten: der Pip-Term soll dominieren, das hier ist nur eine Tönung. */
const RESOURCE_WEIGHT: Record<ResourceType, number> = {
  brick: 1.15, wood: 1.15, grain: 1.05, ore: 1.0, wool: 0.85,
};

const DIVERSITY_BONUS = 1.5; // je verschiedenem Rohstoff an der Ecke
const FIRST_SOURCE_BONUS = 2.5; // Rohstoff, den ich sonst GAR NICHT habe
const PORT_ANY_BONUS = 1.5; // 3:1-Hafen
const PORT_SPECIAL_BONUS = 2.5; // 2:1-Hafen MIT Nachschub
const PORT_SPECIAL_DRY = 0.5; // 2:1-Hafen ohne Nachschub — fast wertlos
const PORT_SUPPLY_MIN = 3; // ab so vielen Pips gilt ein 2:1-Hafen als versorgt
const EXPANSION_WEIGHT = 0.5;
const BLOCK_WEIGHT = 0.4;

/** Wie weit der Bot für einen Bauplatz Straßen vorstreckt. Über 3 wird die Bewertung
 *  spekulativ (der Gegner baut dazwischen) und die BFS teurer, ohne besser zu spielen. */
export const MAX_ROAD_LOOKAHEAD = 3;
const ROAD_STEP_PENALTY = 2.0; // jede Straße kostet Holz+Lehm und einen Zug
const MIN_ROAD_TARGET_SCORE = 4.0; // darunter lohnt die Straße nicht

function zeroPips(): Record<ResourceType, number> {
  return { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

/** Pips je Rohstoff an einer Ecke (Wüste/Wasser = 0). */
export function cornerPips(state: GameState, corner: number): Record<ResourceType, number> {
  const out = zeroPips();
  const c = state.board.corners[corner];
  if (!c) return out;
  for (const hid of c.hexes) {
    const hex = state.board.hexes[hid];
    const r = TERRAIN_RESOURCE[hex.terrain];
    if (hex.number && r) out[r] += pipCount(hex.number);
  }
  return out;
}

/** Pips je Rohstoff aus ALLEN Gebäuden von p. Eine Stadt zählt doppelt — genau wie
 *  die Ausschüttung in `produceResources`. */
export function playerPipCoverage(state: GameState, p: string): Record<ResourceType, number> {
  const out = zeroPips();
  for (const key of Object.keys(state.buildings)) {
    const cid = Number(key);
    const b = state.buildings[cid];
    if (b.owner !== p) continue;
    const mult = b.type === 'city' ? 2 : 1;
    const pips = cornerPips(state, cid);
    for (const r of RESOURCES) out[r] += pips[r] * mult;
  }
  return out;
}

/** Freie, landberührende Ecken in Abstand 2 — die Plätze, die von hier aus später
 *  überhaupt noch bebaubar wären. Bestraft damit Sackgassen und Küsten-Zipfel. */
export function expansionRoom(state: GameState, corner: number): number {
  const c = state.board.corners[corner];
  if (!c) return 0;
  const seen = new Set<number>([corner, ...c.adjacent]);
  let n = 0;
  for (const a of c.adjacent) {
    for (const b of state.board.corners[a].adjacent) {
      if (seen.has(b)) continue;
      seen.add(b);
      if (state.buildings[b]) continue;
      if (!cornerTouchesLand(state, b)) continue;
      n++;
    }
  }
  return n;
}

/**
 * Wie gut ist diese Ecke als Siedlungsplatz für p? Additiv, ohne Simulation.
 * `stage: 'setup'` wertet zusätzlich das Wegschnappen starker Plätze.
 *
 * Die Terme im Einzelnen: Grundertrag (Pips × Nutzen), Vielfalt an der Ecke, Rohstoffe
 * die p bisher komplett fehlen, Hafen (nur mit Nachschub), Expansionsraum.
 */
export function evalSettlementSpot(state: GameState, corner: number, p: string, stage: 'setup' | 'main'): number {
  const pips = cornerPips(state, corner);
  let score = 0;

  for (const r of RESOURCES) score += pips[r] * RESOURCE_WEIGHT[r];

  const kinds = RESOURCES.filter((r) => pips[r] > 0).length;
  score += kinds * DIVERSITY_BONUS;

  // Was ich noch gar nicht produziere, ist mehr wert als mehr vom Gleichen. In der
  // Startaufstellung sorgt das automatisch dafür, dass die ZWEITE Siedlung ergänzt,
  // was die erste nicht liefert — playerPipCoverage sieht die erste ja schon.
  const have = playerPipCoverage(state, p);
  for (const r of RESOURCES) if (pips[r] > 0 && have[r] === 0) score += FIRST_SOURCE_BONUS;

  const portId = state.board.corners[corner].portId;
  if (portId !== null) {
    const t = state.board.ports[portId].type;
    if (t === '3:1') score += PORT_ANY_BONUS;
    else score += have[t] + pips[t] >= PORT_SUPPLY_MIN ? PORT_SPECIAL_BONUS : PORT_SPECIAL_DRY;
  }

  score += expansionRoom(state, corner) * EXPANSION_WEIGHT;

  // Blockade-Proxy: kein rekursives Gegner-Eval (das wäre wechselseitig rekursiv),
  // sondern die rohe Pip-Summe — ein objektiv starker Platz ist auch der, den der
  // Gegner als Nächstes nimmt. Wirkt nur im Setup, wo Plätze wirklich knapp sind.
  if (stage === 'setup') {
    const raw = RESOURCES.reduce((s, r) => s + pips[r], 0);
    score += raw * BLOCK_WEIGHT;
  }

  return score;
}

/** Wert eines Stadt-Ausbaus: die Ausschüttung verdoppelt sich, das entspricht exakt
 *  dem Grundertrag der Ecke. Vielfalt/Hafen/Expansion ändern sich durch den Ausbau nicht. */
export function evalCityCorner(state: GameState, corner: number): number {
  const pips = cornerPips(state, corner);
  return RESOURCES.reduce((s, r) => s + pips[r] * RESOURCE_WEIGHT[r], 0);
}

export interface RoadReach {
  /** Wie viele NEUE Straßen bis zu dieser Ecke nötig sind (0 = schon angebunden). */
  dist: number;
  /** Die erste Kante dieses Wegs — die, die p jetzt bauen müsste. -1 bei dist 0. */
  firstEdge: number;
}

/**
 * Straßen-BFS: für jede erreichbare Ecke `{dist, firstEdge}`.
 *
 * Start (dist 0) sind exakt die Ecken mit `cornerConnectsRoad` — also die, von denen aus
 * `canPlaceRoad(..., null)` eine Straße erlaubt. Expandiert wird über freie Landkanten.
 * Eine gegnerisch bebaute Ecke bekommt noch eine `dist` (die Straße DORTHIN ist baubar,
 * `canPlaceRoad` verlangt nur EINEN verbundenen Endpunkt), wird aber nicht weiter
 * expandiert — genau die Sperrwirkung, die auch `cornerConnectsRoad` dort hat.
 *
 * Damit ist jedes gelieferte `firstEdge` garantiert `canPlaceRoad`-gültig: es geht von
 * einer dist-0-Ecke aus, ist frei und landberührend. (Der Bot darf keine Aktion liefern,
 * die der Reducer ablehnt — sonst dreht der botTick endlos.)
 */
export function roadDistances(state: GameState, p: string): Map<number, RoadReach> {
  const reach = new Map<number, RoadReach>();
  const queue: number[] = [];
  for (const c of state.board.corners) {
    if (cornerConnectsRoad(state, c.id, p)) {
      reach.set(c.id, { dist: 0, firstEdge: -1 });
      queue.push(c.id);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const cid = queue[i];
    const cur = reach.get(cid)!;
    if (cur.dist >= MAX_ROAD_LOOKAHEAD) continue;
    const b = state.buildings[cid];
    if (b && b.owner !== p) continue; // gegnerisches Gebäude sperrt die Weiterfahrt
    for (const eid of state.board.corners[cid].edges) {
      if (state.roads[eid]) continue;
      if (!edgeTouchesLand(state, eid)) continue;
      const e = state.board.edges[eid];
      const next = e.a === cid ? e.b : e.a;
      if (reach.has(next)) continue; // FIFO ⇒ der erste Fund ist der kürzeste Weg
      reach.set(next, { dist: cur.dist + 1, firstEdge: cur.dist === 0 ? eid : cur.firstEdge });
      queue.push(next);
    }
  }
  return reach;
}

/** Die beste Straße, die p jetzt bauen kann, gemessen am Bauplatz, den sie erschließt.
 *  `null`, wenn nichts in Reichweite den Aufwand lohnt. */
export function bestRoadTarget(
  state: GameState, p: string,
): { edge: number; corner: number; dist: number; score: number } | null {
  const reach = roadDistances(state, p);
  let best: { edge: number; corner: number; dist: number; score: number } | null = null;
  for (const c of state.board.corners) {
    const r = reach.get(c.id);
    if (!r || r.dist < 1 || r.dist > MAX_ROAD_LOOKAHEAD) continue;
    // setup=true ist Absicht: gefragt ist „bebaubar NACH dem Straßenbau" — Abstandsregel
    // und Landberührung gelten weiter, nur der Straßenanschluss entsteht ja gerade erst.
    if (!canPlaceSettlement(state, c.id, p, true)) continue;
    const score = evalSettlementSpot(state, c.id, p, 'main') - ROAD_STEP_PENALTY * r.dist;
    if (score > (best?.score ?? -Infinity)) best = { edge: r.firstEdge, corner: c.id, dist: r.dist, score };
  }
  return best && best.score >= MIN_ROAD_TARGET_SCORE ? best : null;
}

const SETUP_ROAD_STEP_PENALTY = 1.5; // je weiterer Straße bis zum Ziel
const SETUP_ROAD_DEADEND_MALUS = 3.0; // Straße, die nirgendwo hinführt

/**
 * Wie viel taugt eine Setup-Straße, die zur Ecke `far` zeigt?
 *
 * Ersetzt „erste gültige Kante" (= faktisch Zufallsrichtung, weil die Kanten-Id nichts
 * mit dem Brett zu tun hat). Gemessen wird, was von `far` aus in ein bis zwei weiteren
 * Straßen erreichbar wird. `far` selbst zählt praktisch nie: es grenzt an die eben
 * gesetzte Siedlung und ist damit durch die Abstandsregel gesperrt — genau deshalb ist
 * die Frage „wohin führt sie", nicht „was liegt dort".
 */
export function setupRoadValue(state: GameState, p: string, far: number): number {
  const dist = new Map<number, number>([[far, 0]]);
  const queue = [far];
  let best = -Infinity;
  for (let i = 0; i < queue.length; i++) {
    const cid = queue[i];
    const d = dist.get(cid)!;
    if (canPlaceSettlement(state, cid, p, true)) {
      const v = evalSettlementSpot(state, cid, p, 'setup') - SETUP_ROAD_STEP_PENALTY * d;
      if (v > best) best = v;
    }
    if (d >= 2) continue;
    const b = state.buildings[cid];
    if (b && b.owner !== p) continue; // gegnerisches Gebäude sperrt die Weiterfahrt
    for (const eid of state.board.corners[cid].edges) {
      if (state.roads[eid]) continue;
      if (!edgeTouchesLand(state, eid)) continue;
      const e = state.board.edges[eid];
      const next = e.a === cid ? e.b : e.a;
      if (dist.has(next)) continue;
      dist.set(next, d + 1);
      queue.push(next);
    }
  }
  // Küsten-Sackgasse: von hier erschließt die Straße nichts mehr.
  return best === -Infinity ? -SETUP_ROAD_DEADEND_MALUS : best;
}

/** Was p bis zu `cost` noch fehlt (nie negativ). */
export function missingFor(have: ResourceCounts, cost: Partial<ResourceCounts>): ResourceCounts {
  const out: ResourceCounts = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
  for (const r of RESOURCES) out[r] = Math.max(0, (cost[r] ?? 0) - have[r]);
  return out;
}

export function totalOf(rc: ResourceCounts): number {
  return RESOURCES.reduce((s, r) => s + rc[r], 0);
}

/**
 * Kann p `cost` über Bank-/Hafenhandel in DIESEM Zug erreichen?
 *
 * Gezählt wird nur der Überschuss, der nach Abzug des Ziels übrig bleibt — sonst würde
 * der Bot Karten wegtauschen, die er für genau dieses Ziel braucht. `bestBankRate` ist
 * dieselbe Funktion, die auch der Reducer nutzt ⇒ der Hafenkurs stimmt per Konstruktion.
 * Die Bank-Prüfung am Ende spiegelt `bankTrade` (die Bank muss liefern können).
 */
export function bankReachable(state: GameState, p: string, cost: Partial<ResourceCounts>): boolean {
  const player = state.players.find((x) => x.id === p);
  if (!player) return false;
  const res = player.resources;
  if (canAfford(res, cost)) return true;
  const ports = playerPorts(state, p);
  const missing = missingFor(res, cost);
  const need = totalOf(missing);
  let units = 0;
  for (const r of RESOURCES) {
    const spare = res[r] - (cost[r] ?? 0);
    if (spare > 0) units += Math.floor(spare / bestBankRate(ports, r));
  }
  if (units < need) return false;
  return RESOURCES.every((r) => missing[r] <= state.bank[r]);
}
