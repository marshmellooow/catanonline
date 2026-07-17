// Bot-Logik: spielt einen Sitz vollständig — Aufstellung, Würfeln, Bauen, Handeln,
// Räuber, Zugende. Damit ist ein Solospiel gegen Bots ein echtes Spiel; zugleich bleibt
// er der Autopilot für getrennte/ersetzte Sitze, damit eine Partie nie blockiert.
//
// ZWEI REGELN, die beim Ändern zählen:
//
// 1. NIE eine Aktion liefern, die der Reducer ablehnt. `room.ts::botTick` plant bei einer
//    abgelehnten Aktion denselben State neu → dieselbe Aktion → Endlosschleife alle 700 ms,
//    Partie tot. Jede Vorbedingung hier spiegelt deshalb die Prüfung im Reducer. Als Netz
//    gibt es zusätzlich `fallbackAction` (siehe unten), aber der Spiegel ist die Lösung.
//
// 2. Diese Funktion ist rein und wird PRO AKTION neu aufgerufen — es gibt keinen Zustand
//    zwischen zwei Ticks. Alles, was über mehrere Aktionen bekannt sein muss, muss aus dem
//    GameState ableitbar sein (z. B. `playedDevThisTurn`, `tradesProposedThisTurn`).
//
// Außerdem läuft `chooseBotAction` über `room.ts::enforceTurn` auch für einen MENSCHEN,
// dessen Zugzeit abgelaufen ist. Sein Zug wird dann voll ausgespielt — mit einer bewussten
// Ausnahme: fremde Gegenangebote werden nie automatisch angenommen (siehe unten).

import type { GameState, TradeOffer, PlayerState, ResourceCounts } from './types.js';
import type { GameAction } from './actions.js';
import type { ResourceType } from './design.js';
import { RESOURCES, TERRAIN_RESOURCE, pipCount } from './design.js';
import {
  COSTS, canAfford, validSettlementCorners, validCityCorners, validRoadEdges,
  playerPorts, bestBankRate, computeLongestRoad, victoryPoints, resourceTotal,
} from './logic.js';
import {
  evalSettlementSpot, evalCityCorner, setupRoadValue, bestRoadTarget,
  missingFor, totalOf, bankReachable,
} from './bot-eval.js';

const getPlayer = (state: GameState, id: string): PlayerState => state.players.find((p) => p.id === id)!;

const RESOURCE_HAND_WEIGHT: Record<ResourceType, number> = {
  wood: 1.1, brick: 1.1, wool: 0.9, grain: 1.2, ore: 1.25,
};

function copyResources(rc: ResourceCounts): ResourceCounts {
  return { wood: rc.wood, brick: rc.brick, wool: rc.wool, grain: rc.grain, ore: rc.ore };
}

/** Hand nach einem gedachten Tausch; `null`, wenn die Abgabe nicht bezahlbar ist. */
function resourcesAfterTrade(
  hand: ResourceCounts, give: Partial<ResourceCounts>, get: Partial<ResourceCounts>,
): ResourceCounts | null {
  const out = copyResources(hand);
  for (const r of RESOURCES) {
    const n = give[r] ?? 0;
    if (out[r] < n) return null;
    out[r] -= n;
    out[r] += get[r] ?? 0;
  }
  return out;
}

/** Bewertet eine Hand gegen die aktuell überhaupt erreichbaren Ziele des Sitzes. */
function handPlanScore(state: GameState, botId: string, hand: ResourceCounts): number {
  const goals = wantedGoalPlans(state, botId);
  let best = goals.length === 0 ? 0 : -Infinity;
  for (const goal of goals) {
    const gap = totalOf(missingFor(hand, goal.cost));
    const score = goal.base - gap * 6 + (gap === 0 ? 8 : 0);
    if (score > best) best = score;
  }
  // Kleine Tönung für Gleichstände: Getreide/Erz sind langfristig etwas wertvoller,
  // Wolle etwas weniger. Die konkrete Zielnähe oben dominiert deutlich.
  for (const r of RESOURCES) best += Math.min(hand[r], 3) * RESOURCE_HAND_WEIGHT[r] * 0.1;
  return best;
}

/** Anzahl allein reicht nicht: der Tausch darf den besten Bauplan nicht verschlechtern. */
function isStrategicTrade(
  state: GameState, botId: string,
  botGives: Partial<ResourceCounts>, botGets: Partial<ResourceCounts>,
): boolean {
  const bot = getPlayer(state, botId);
  const after = resourcesAfterTrade(bot.resources, botGives, botGets);
  if (!after) return false;
  const gain = partialTotal(botGets);
  const cost = partialTotal(botGives);
  if (gain === 0 || cost === 0 || gain < cost) return false;
  return handPlanScore(state, botId, after) + 1e-9 >= handPlanScore(state, botId, bot.resources);
}

function emptyResourceCounts(): ResourceCounts {
  return { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

function partialTotal(rc: Partial<ResourceCounts>): number {
  return RESOURCES.reduce((sum, r) => sum + (rc[r] ?? 0), 0);
}

/**
 * Entscheidet, wie ein Bot auf ein Handelsangebot antwortet.
 * Der Bot **gibt** `offer.get` und **erhält** `offer.give`. Er nimmt nur an,
 * wenn er die geforderten Karten hat, nicht weniger Karten erhält und seinen besten
 * aktuellen Bauplan dadurch nicht verschlechtert.
 */
function decideTradeResponse(state: GameState, botId: string, offer: TradeOffer): GameAction {
  // Der Bot **gibt** offer.get und **erhält** offer.give.
  const accept = isStrategicTrade(state, botId, offer.get, offer.give);
  return { type: 'respondTrade', offerId: offer.id, accept };
}

/**
 * Würde der Reducer diesen Tausch ausführen? Spiegelt die `canAfford`-Prüfungen von
 * `confirmTrade`. Der Bot darf nur Aktionen liefern, die `applyAction` akzeptiert —
 * eine abgelehnte Aktion lässt botTick/enforceTurn dieselbe Wahl endlos wiederholen.
 */
function canSettleOffer(state: GameState, proposerId: string, partnerId: string, offer: TradeOffer): boolean {
  const proposer = state.players.find((p) => p.id === proposerId);
  const partner = state.players.find((p) => p.id === partnerId);
  if (!proposer || !partner) return false;
  return (
    RESOURCES.every((r) => proposer.resources[r] >= offer.give[r]) &&
    RESOURCES.every((r) => partner.resources[r] >= offer.get[r])
  );
}

// ---------------- Hauptphase: Prioritätenleiter ----------------
//
// `planMain` gibt NIE null zurück — die unterste Sprosse ist `endTurn`. Jede Sprosse
// prüft ihre Vorbedingungen exakt so, wie der Reducer sie prüft (siehe Kommentare):
// eine abgelehnte Aktion würde botTick alle 700 ms dieselbe Wahl neu treffen lassen.
//
// Terminierung: jede Sprosse verkleinert entweder ein pro Spiel monoton fallendes Maß
// (Bauplätze, roadsLeft, devDeck) oder die Handkarten. Kein Zyklus möglich.

const MONOPOLY_MIN = 3; // darunter verbrennt Monopol nur die Karte

/** Liegt der Räuber auf einem Feld, das MIR Ertrag kostet? (Wüste tut nicht weh.) */
function robberHurtsMe(state: GameState, botId: string): boolean {
  const hex = state.board.hexes[state.robberHex];
  if (!hex || hex.number === null || !TERRAIN_RESOURCE[hex.terrain]) return false;
  return hex.corners.some((c) => state.buildings[c]?.owner === botId);
}

/** Der Rohstoff, der beim Monopol am meisten bringt (feste RESOURCES-Reihenfolge, striktes >). */
function bestMonopoly(state: GameState, botId: string): { res: ResourceType; gain: number } | null {
  let best: ResourceType | null = null;
  let bestGain = 0;
  for (const r of RESOURCES) {
    let total = 0;
    for (const o of state.players) if (o.id !== botId) total += o.resources[r];
    if (total > bestGain) { bestGain = total; best = r; }
  }
  return best ? { res: best, gain: bestGain } : null;
}

/** Zwei Karten, die einen Bau JETZT abschließen — sonst null.
 *  Spiegelt `playYearOfPlenty`: `need[r] <= bank[r]` für beide, inkl. r1===r2 ⇒ bank >= 2. */
function yearOfPlentyPick(state: GameState, botId: string): [ResourceType, ResourceType] | null {
  const p = getPlayer(state, botId);
  for (const cost of wantedGoals(state, botId)) {
    const missing = missingFor(p.resources, cost);
    const need = totalOf(missing);
    if (need === 0 || need > 2) continue; // 0 = schon bezahlbar, >2 = die Karte reicht nicht
    const picks: ResourceType[] = [];
    for (const r of RESOURCES) for (let i = 0; i < missing[r]; i++) picks.push(r);
    if (picks.length === 1) {
      // Nur eine Karte fehlt — die zweite ist geschenkt. Sie MUSS nach Abzug der ersten
      // Wahl noch in der Bank liegen; sonst würde eine leere, bloß „knappe" Sorte die
      // gesamte Erfindung verhindern, obwohl eine andere Zusatzkarte verfügbar ist.
      let second: ResourceType | null = null;
      let bestScore = -Infinity;
      const first = picks[0];
      for (const r of RESOURCES) {
        const alreadyPicked = r === first ? 1 : 0;
        if (state.bank[r] <= alreadyPicked) continue;
        const after = copyResources(p.resources);
        after[first]++;
        after[r]++;
        const score = handPlanScore(state, botId, after);
        if (score > bestScore) { bestScore = score; second = r; }
      }
      if (!second) continue;
      picks.push(second);
    }
    const [r1, r2] = picks;
    const want: ResourceCounts = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    want[r1]++; want[r2]++;
    if (RESOURCES.every((r) => want[r] <= state.bank[r])) return [r1, r2];
  }
  return null;
}

/** Ritter — der einzige Zweig, der auch VOR dem Wurf läuft (guardPlayDev erlaubt 'roll'). */
function planKnight(state: GameState, botId: string): GameAction | null {
  const p = getPlayer(state, botId);
  if (state.playedDevThisTurn) return null; // Reducer-Spiegel
  if (p.devCards.knight <= 0) return null; // NUR devCards — newDevCards sind erst nächsten Zug spielbar
  const armyNext = p.playedKnights + 1;
  // Spiegelt updateLargestArmy: ab 3 Rittern und echt mehr als der aktuelle Halter.
  const takesArmy = state.largestArmyHolder !== botId && armyNext >= 3 && armyNext > state.largestArmySize;
  if (takesArmy && victoryPoints(state, p, true) + 2 >= state.vpTarget) return { type: 'playKnight' }; // Sieg
  if (robberHurtsMe(state, botId)) return { type: 'playKnight' }; // Räuber loswerden
  if (takesArmy) return { type: 'playKnight' }; // Größte Rittermacht
  return null;
}

/** Sprosse 1: Entwicklungskarte spielen. Höchstens eine pro Zug — der Reducer setzt
 *  `playedDevThisTurn`, Reset nur in `endTurn`. Damit ist die Sprosse pro Zug beschränkt. */
function planDevCard(state: GameState, botId: string): GameAction | null {
  if (state.playedDevThisTurn) return null; // Reducer-Spiegel, muss ganz oben stehen
  const p = getPlayer(state, botId);

  const knight = planKnight(state, botId);
  if (knight) return knight;

  if (p.devCards.monopoly > 0) {
    const m = bestMonopoly(state, botId);
    if (m && m.gain >= MONOPOLY_MIN) return { type: 'playMonopoly', resource: m.res };
  }

  if (p.devCards.yearOfPlenty > 0) {
    const pick = yearOfPlentyPick(state, botId);
    if (pick) return { type: 'playYearOfPlenty', resources: pick };
  }

  // Straßenbau nur mit Platz UND Ziel — sonst verpufft die Karte (Reducer: available <= 0).
  if (p.devCards.roadBuilding > 0 && p.roadsLeft > 0
      && validRoadEdges(state, botId, null).length > 0
      && (bestRoadTarget(state, botId) !== null || longestRoadInReach(state, botId))) {
    return { type: 'playRoadBuilding' };
  }

  return null;
}

/** Sprosse 2: Stadt — auf der ertragreichsten eigenen Siedlung. */
function planCity(state: GameState, botId: string): GameAction | null {
  const p = getPlayer(state, botId);
  if (p.citiesLeft <= 0) return null; // Reducer-Spiegel
  if (!canAfford(p.resources, COSTS.city)) return null;
  const spots = validCityCorners(state, botId); // spiegelt „eigene Siedlung dort"
  if (spots.length === 0) return null;
  let best = spots[0];
  let bestV = -Infinity;
  for (const c of spots) {
    const v = evalCityCorner(state, c);
    if (v > bestV) { bestV = v; best = c; }
  }
  return { type: 'buildCity', corner: best };
}

/** Sprosse 3: Siedlung — auf dem besten regelkonformen Platz. */
function planSettlement(state: GameState, botId: string): GameAction | null {
  const p = getPlayer(state, botId);
  if (p.settlementsLeft <= 0) return null;
  if (!canAfford(p.resources, COSTS.settlement)) return null;
  // setup=false ⇒ Abstandsregel UND eigener Straßenanschluss — genau wie im Reducer.
  const spots = validSettlementCorners(state, botId, false);
  if (spots.length === 0) return null;
  let best = spots[0];
  let bestV = -Infinity;
  for (const c of spots) {
    const v = evalSettlementSpot(state, c, botId, 'main');
    if (v > bestV) { bestV = v; best = c; }
  }
  return { type: 'buildSettlement', corner: best };
}

/** Beste jetzt baubare Kante nach der TATSÄCHLICH resultierenden Straßenlänge.
 *  Eine Kante kann zwei Teilnetze verbinden und damit mehr als +1 bringen; die frühere
 *  obere Schranke übersah genau diesen Fall. Die Simulation mutiert den State nicht. */
function bestLongestRoadEdge(
  state: GameState, botId: string, requireAward: boolean,
): { edge: number; length: number } | null {
  if (requireAward && state.longestRoadHolder === botId) return null;
  const target = Math.max(5, state.longestRoadHolder ? state.longestRoadLength + 1 : 5);
  let best: { edge: number; length: number } | null = null;
  for (const edge of validRoadEdges(state, botId, null)) {
    const trial: GameState = {
      ...state,
      roads: { ...state.roads, [edge]: { owner: botId } },
    };
    const length = computeLongestRoad(trial, botId);
    if (requireAward && length < target) continue;
    if (!best || length > best.length) best = { edge, length };
  }
  return best;
}

function longestRoadInReach(state: GameState, botId: string): boolean {
  return bestLongestRoadEdge(state, botId, true) !== null;
}

/** Sprosse 4: Straße — nur mit Ziel (guter Bauplatz in Reichweite oder Längste Straße). */
function planRoad(state: GameState, botId: string): GameAction | null {
  const p = getPlayer(state, botId);
  if (p.roadsLeft <= 0) return null;
  if (!canAfford(p.resources, COSTS.road)) return null;
  // bestRoadTarget liefert nur canPlaceRoad-gültige Kanten (siehe bot-eval.ts).
  const t = bestRoadTarget(state, botId);
  if (t) return { type: 'buildRoad', edge: t.edge };
  const longest = bestLongestRoadEdge(state, botId, true);
  if (longest) return { type: 'buildRoad', edge: longest.edge };
  return null; // ziellose Straßen kosten nur Holz+Lehm
}

interface BotGoalPlan {
  kind: 'city' | 'settlement' | 'road' | 'dev';
  cost: Partial<ResourceCounts>;
  /** Grundwert für Hand-/Handelsvergleiche; Zielnähe wird separat abgezogen. */
  base: number;
}

/** Die Ziele, für die p gerade überhaupt sparen/tauschen würde — in Prioritätenfolge. */
function wantedGoalPlans(state: GameState, botId: string): BotGoalPlan[] {
  const p = getPlayer(state, botId);
  const out: BotGoalPlan[] = [];
  if (p.citiesLeft > 0 && validCityCorners(state, botId).length > 0) {
    out.push({ kind: 'city', cost: COSTS.city, base: 30 });
  }
  if (p.settlementsLeft > 0 && validSettlementCorners(state, botId, false).length > 0) {
    out.push({ kind: 'settlement', cost: COSTS.settlement, base: 25 });
  }
  if (p.roadsLeft > 0 && bestRoadTarget(state, botId) !== null) {
    out.push({ kind: 'road', cost: COSTS.road, base: 12 });
  }
  if (state.devDeck.length > 0) out.push({ kind: 'dev', cost: COSTS.devCard, base: 16 });
  return out;
}

function wantedGoals(state: GameState, botId: string): Array<Partial<ResourceCounts>> {
  return wantedGoalPlans(state, botId).map((goal) => goal.cost);
}

/** Sprosse 5: Entwicklungskarte kaufen. Der Spar-Guard schützt nicht nur die Stadt,
 *  sondern jedes nahe sichere Bauziel, dessen Karten der Dev-Kauf wirklich verbrauchen
 *  würde. Im Endspurt bei zwei fehlenden SP bleibt der bisherige Risiko-Modus erhalten;
 *  ein Bau, der sofort gewinnt, wird aber nie für eine Zufallskarte geopfert. */
function planBuyDev(state: GameState, botId: string): GameAction | null {
  const p = getPlayer(state, botId);
  if (state.devDeck.length === 0) return null; // Reducer-Spiegel
  if (!canAfford(p.resources, COSTS.devCard)) return null;
  const currentVp = victoryPoints(state, p, true);
  const pointsNeeded = state.vpTarget - currentVp;
  const afterBuy = copyResources(p.resources);
  for (const r of RESOURCES) afterBuy[r] -= COSTS.devCard[r] ?? 0;
  for (const goal of wantedGoalPlans(state, botId)) {
    if (goal.kind !== 'city' && goal.kind !== 'settlement') continue;
    const gapBefore = totalOf(missingFor(p.resources, goal.cost));
    const gapAfter = totalOf(missingFor(afterBuy, goal.cost));
    const winsNow = currentVp + 1 >= state.vpTarget;
    if (gapBefore >= 1 && gapBefore <= 2 && gapAfter > gapBefore && (pointsNeeded > 2 || winsNow)) {
      return null;
    }
  }
  return { type: 'buyDevCard' };
}

/** Sprosse 6: Bank-/Hafenhandel — nur, wenn er ein konkretes Ziel in DIESEM Zug freischaltet.
 *  Terminierung: jeder Tausch gibt `rate >= 2` ab und bekommt 1 → die Hand schrumpft strikt.
 *  Ein Hin-und-Her (Holz→Erz→Holz) ist damit unmöglich. */
function planBankTrade(state: GameState, botId: string): GameAction | null {
  const p = getPlayer(state, botId);
  const ports = playerPorts(state, botId);
  for (const cost of wantedGoals(state, botId)) {
    if (canAfford(p.resources, cost)) continue; // schon bezahlbar → Sprosse 2-5 hat es
    if (!bankReachable(state, botId, cost)) continue; // unerreichbar → keine Karten verbrennen
    const missing = missingFor(p.resources, cost);
    const want = RESOURCES.find((r) => missing[r] > 0)!;
    if (state.bank[want] < 1) continue; // Reducer-Spiegel: die Bank muss liefern können
    let give: ResourceType | null = null;
    let bestSpare = 0;
    for (const r of RESOURCES) {
      if (r === want) continue; // Reducer-Spiegel: give !== get
      const rate = bestBankRate(ports, r); // dieselbe Funktion wie im Reducer → Kurs stimmt
      const spare = p.resources[r] - (cost[r] ?? 0); // nur Überschuss NACH dem Ziel
      if (spare >= rate && spare / rate > bestSpare) { bestSpare = spare / rate; give = r; }
    }
    if (give) return { type: 'bankTrade', give, get: want };
  }
  return null;
}

/** Wie viele Angebote ein Bot pro Zug macht. 1 hält den Dialog-Andrang beim Menschen
 *  im Rahmen (3 Bots = 3 Angebote pro Runde) und macht die Terminierung trivial. */
const MAX_BOT_OFFERS_PER_TURN = 1;

/** Sprosse 7: Mitspieler fragen — strikt 1:1, und nur wenn 1–2 Karten zum Ziel fehlen.
 *
 *  1:1 ist derselbe Maßstab, den `decideTradeResponse` zum Annehmen anlegt (gain >= cost) —
 *  also nicht ausbeutbar und von anderen Bots verlässlich annehmbar.
 *
 *  Terminierung: `tradesProposedThisTurn` zählt der REDUCER hoch, Reset nur in `endTurn`.
 *  Nach dem ersten Angebot ist die Sprosse für diesen Zug tot — egal ob das Angebot per
 *  confirmTrade, acceptCounter oder cancelTrade endet. `propose → cancel → propose` ist
 *  damit ausgeschlossen (ohne den Zähler wäre der State danach identisch → Endlosschleife).
 */
function planProposeTrade(state: GameState, botId: string): GameAction | null {
  const p = getPlayer(state, botId);
  // NUR echte Bot-Sitze bieten an. Für einen Menschen, dessen Zugzeit abläuft, wäre ein
  // Angebot in seinem Namen sinnlos und schädlich: er kann nicht verhandeln, ein Gegner
  // könnte es einfach annehmen und ihm so die Karte abnehmen — und `enforceTurn` hätte
  // nichts, worauf es warten könnte (der Warte-Zweig unten gilt nur für Bots, und
  // armTradeTimer wird nur für Auto-Sitze scharf) → der Zug endete nie.
  if (!p.isBot) return null;
  if (state.tradeOffer) return null; // nur ein Angebot gleichzeitig
  if (state.tradesProposedThisTurn >= MAX_BOT_OFFERS_PER_TURN) return null;
  for (const cost of wantedGoals(state, botId)) {
    if (canAfford(p.resources, cost)) continue;
    const missing = missingFor(p.resources, cost);
    const need = totalOf(missing);
    if (need < 1 || need > 2) continue; // zu weit weg → nicht mit Angeboten nerven
    const want = RESOURCES.find((r) => missing[r] > 0)!;
    // Reducer-Spiegel: ohne einen Mitspieler, der `get` liefern kann, lehnt proposeTrade ab.
    if (!state.players.some((o) => o.id !== botId && o.resources[want] >= 1)) continue;
    let give: ResourceType | null = null;
    let bestScore = -Infinity;
    let bestSpare = -1;
    for (const r of RESOURCES) {
      if (r === want) continue;
      const spare = p.resources[r] - (cost[r] ?? 0); // nur echten Überschuss anbieten
      if (spare <= 0) continue;
      const after = resourcesAfterTrade(p.resources, { [r]: 1 }, { [want]: 1 })!;
      const score = handPlanScore(state, botId, after);
      if (score > bestScore || (score === bestScore && spare > bestSpare)) {
        bestScore = score;
        bestSpare = spare;
        give = r;
      }
    }
    if (!give) continue; // nichts entbehrlich → Reducer-Spiegel canAfford(give)
    return { type: 'proposeTrade', give: { [give]: 1 }, get: { [want]: 1 } };
  }
  return null;
}

/**
 * Ein faires, bezahlbares Gegenangebot — oder null.
 *
 * `offer.counters[pid]` steht in ANBIETER-Perspektive: `give` = was der Bot hergibt,
 * `get` = was er bekommt. Die Prüfungen spiegeln `acceptCounter` im Reducer exakt,
 * inklusive der Reihenfolge: erst der Status-Vergleich, DANN erst `counters[...]` lesen
 * (sonst liefert pid='__proto__' einen Prototyp-Treffer).
 */
function compareTradePartners(state: GameState, proposerId: string, a: string, b: string): number {
  const pa = getPlayer(state, a);
  const pb = getPlayer(state, b);
  // Den schwächeren Gegner stärken: erst öffentliche SP, dann öffentliche Handgröße.
  const vp = victoryPoints(state, pa, false) - victoryPoints(state, pb, false);
  if (vp !== 0) return vp;
  const cards = resourceTotal(pa.resources) - resourceTotal(pb.resources);
  if (cards !== 0) return cards;
  // Letzter Tie-Break über die zyklische Zugfolge statt Objekt-/Spieler-ID-Reihenfolge.
  const n = state.order.length;
  const proposer = state.order.indexOf(proposerId);
  const da = (state.order.indexOf(a) - proposer + n) % n;
  const db = (state.order.indexOf(b) - proposer + n) % n;
  return da - db;
}

function findAcceptableCounter(state: GameState, botId: string, offer: TradeOffer): string | null {
  let best: { pid: string; score: number } | null = null;
  for (const pid of Object.keys(offer.counters)) {
    if (offer.responses[pid] !== 'counter') continue;
    const c = offer.counters[pid];
    const partner = state.players.find((p) => p.id === pid);
    if (!partner) continue;
    if (!RESOURCES.every((r) => partner.resources[r] >= c.get[r])) continue; // Reducer-Spiegel
    if (!isStrategicTrade(state, botId, c.give, c.get)) continue;
    const after = resourcesAfterTrade(getPlayer(state, botId).resources, c.give, c.get)!;
    const score = handPlanScore(state, botId, after);
    if (!best || score > best.score
        || (score === best.score && compareTradePartners(state, botId, pid, best.pid) < 0)) {
      best = { pid, score };
    }
  }
  return best?.pid ?? null;
}

/**
 * Löst ein Angebot auf, dessen Anbieter dieser Sitz ist. Liefert immer eine gültige Aktion.
 *
 * Gegenangebote nimmt NUR ein echter Bot-Sitz an. Grund: diese Funktion läuft über
 * `room.ts::enforceTurn` auch für einen MENSCHEN, dessen Zugzeit abgelaufen ist. Vom
 * Gegner diktierte Konditionen dürfen niemandem ungefragt die Karten tauschen — die
 * Fairness-Schranke zählt nur Kartenanzahl, nicht Wert, sodass ein Gegner sonst gezielt
 * die letzte gebrauchte Karte gegen Ballast abziehen könnte.
 *
 * Ein nach Disconnect übernommener Sitz zählt dabei bewusst als Mensch: `auto` lebt nur
 * im Server, im GameState ist `isBot` dort false. Der konservative Rand ist Absicht.
 */
function resolveOwnOffer(state: GameState, botId: string, offer: TradeOffer): GameAction {
  const accepter = Object.keys(offer.responses)
    .filter((pid) => offer.responses[pid] === 'accept' && canSettleOffer(state, botId, pid, offer))
    .sort((a, b) => compareTradePartners(state, botId, a, b))[0];
  if (accepter) return { type: 'confirmTrade', offerId: offer.id, withPlayer: accepter };
  if (getPlayer(state, botId).isBot) {
    const good = findAcceptableCounter(state, botId, offer);
    if (good) return { type: 'acceptCounter', offerId: offer.id, withPlayer: good };
  }
  return { type: 'cancelTrade' }; // für den Anbieter im Reducer IMMER erlaubt → kein Stall
}

/** Timeout-Auflösung für `room.ts`: vorhandene Annahme/Konter noch ausführen, nur sonst
 *  abbrechen. Säumige `pending`-Antworten dürfen eine bereits gültige Annahme nicht löschen. */
export function resolveTimedOutTrade(state: GameState, proposerId: string): GameAction | null {
  const offer = state.tradeOffer;
  if (!offer || offer.from !== proposerId) return null;
  return resolveOwnOffer(state, proposerId, offer);
}

/** Echter Bot: Überschüsse abwerfen und den besten nahen Bauplan möglichst erhalten.
 *  Für einen nur zeitweise übernommenen Menschen bleibt `autoDiscard` zuständig — dessen
 *  Hand soll der Server nicht mit perfekter Strategie in seinem Namen umsortieren. */
function planStrategicDiscard(state: GameState, botId: string, need: number): GameAction {
  const hand = copyResources(getPlayer(state, botId).resources);
  const discard = emptyResourceCounts();
  const goals = wantedGoalPlans(state, botId);
  let reserve: Partial<ResourceCounts> = {};
  let bestGoalScore = -Infinity;
  for (const goal of goals) {
    const score = goal.base - totalOf(missingFor(hand, goal.cost)) * 6;
    if (score > bestGoalScore) { bestGoalScore = score; reserve = goal.cost; }
  }

  for (let i = 0; i < need; i++) {
    let pick: ResourceType | null = null;
    let best = -Infinity;
    for (const r of RESOURCES) {
      if (hand[r] <= 0) continue;
      const after = copyResources(hand);
      after[r]--;
      const surplus = hand[r] - (reserve[r] ?? 0);
      // Überschuss dominiert; sonst gewinnt die Karte mit dem geringsten Planschaden.
      const score = (surplus > 0 ? 100 + surplus * 10 : 0)
        + handPlanScore(state, botId, after)
        - RESOURCE_HAND_WEIGHT[r] * 0.01;
      if (score > best) { best = score; pick = r; }
    }
    if (!pick) break; // reducer-seitig unmöglich, defensiv gegen kaputte Test-States
    hand[pick]--;
    discard[pick]++;
  }
  return { type: 'discard', resources: discard };
}

/** Blockade-Wert eines Räuberfelds aus öffentlichen Informationen. */
function robberHexScore(state: GameState, botId: string, hexId: number): number {
  const hex = state.board.hexes[hexId];
  const me = getPlayer(state, botId);
  const myVp = victoryPoints(state, me, false);
  const pips = hex.number === null ? 0 : pipCount(hex.number);
  const victims = new Set<string>();
  let score = 0;
  for (const cid of hex.corners) {
    const b = state.buildings[cid];
    if (!b) continue;
    const mult = b.type === 'city' ? 2 : 1;
    if (b.owner === botId) {
      score -= mult * (pips + 1) * 2.25;
      continue;
    }
    const opponent = getPlayer(state, b.owner);
    const lead = Math.max(0, victoryPoints(state, opponent, false) - myVp);
    score += mult * pips * (1 + lead * 0.35);
    if (resourceTotal(opponent.resources) > 0) victims.add(opponent.id);
  }
  // Stehlchance nur einmal je Gegner werten, auch wenn mehrere Gebäude am Feld stehen.
  for (const id of victims) {
    const opponent = getPlayer(state, id);
    const lead = Math.max(0, victoryPoints(state, opponent, false) - myVp);
    score += 1.5 + lead * 0.5;
  }
  return score;
}

function bestStealVictim(state: GameState, botId: string): string | null {
  const n = state.order.length;
  const me = state.order.indexOf(botId);
  return state.stealCandidates.slice().sort((a, b) => {
    const pa = getPlayer(state, a);
    const pb = getPlayer(state, b);
    const vp = victoryPoints(state, pb, false) - victoryPoints(state, pa, false);
    if (vp !== 0) return vp;
    const cards = resourceTotal(pb.resources) - resourceTotal(pa.resources);
    if (cards !== 0) return cards;
    const da = (state.order.indexOf(a) - me + n) % n;
    const db = (state.order.indexOf(b) - me + n) % n;
    return da - db;
  })[0] ?? null;
}

/** Die Leiter. Gibt nie null — Sprosse 8 ist `endTurn`. */
function planMain(state: GameState, botId: string): GameAction {
  return planDevCard(state, botId)
    ?? planCity(state, botId)
    ?? planSettlement(state, botId)
    ?? planRoad(state, botId)
    ?? planBuyDev(state, botId)
    ?? planBankTrade(state, botId)
    ?? planProposeTrade(state, botId)
    ?? { type: 'endTurn' };
}

export function chooseBotAction(state: GameState, botId: string): GameAction | null {
  // Offenes Handelsangebot zuerst behandeln — auch wenn der Bot nicht am Zug ist.
  const offer = state.tradeOffer;
  if (offer) {
    if (offer.responses[botId] === 'pending') return decideTradeResponse(state, botId, offer);
    if (offer.from === botId) {
      // Eigenes Angebot (selbst gestellt oder per Sitzübernahme geerbt) auflösen, damit
      // der Zug nicht hängt — aber ein echter Bot wartet erst, bis alle Menschen
      // geantwortet haben. Sonst reißt er ihnen den Dialog nach 700 ms wieder weg.
      //
      // Das Warten gilt AUSDRÜCKLICH nur für Bot-Sitze: begrenzt wird es allein von
      // `armTradeTimer` (BOT_TRADE_TIMEOUT_MS), und der ist nur für Auto-Sitze scharf.
      // Würde hier auch ein Mensch warten, dessen Zugzeit abgelaufen ist, drehte
      // `enforceTurn` alle 500 ms leer und sein Zug endete nie.
      if (getPlayer(state, botId).isBot) {
        const humanPending = Object.keys(offer.responses).some(
          (pid) => offer.responses[pid] === 'pending' && !state.players.find((p) => p.id === pid)?.isBot,
        );
        if (humanPending) return null;
      }
      return resolveOwnOffer(state, botId, offer);
    }
  }

  const isActive = state.order[state.activeIndex] === botId;

  switch (state.phase) {
    case 'setupSettlement': {
      if (!isActive) return null;
      // validSettlementCorners spiegelt canPlaceSettlement — der Reducer prüft dasselbe.
      const spots = validSettlementCorners(state, botId, true);
      if (spots.length === 0) return null;
      let best = spots[0];
      let bestV = -Infinity;
      for (const c of spots) {
        // Nicht nur Pips: Vielfalt, fehlende Rohstoffe, Hafen und Expansionsraum. Der
        // Erstquellen-Term sorgt nebenbei dafür, dass die ZWEITE Siedlung ergänzt,
        // was die erste nicht liefert.
        const v = evalSettlementSpot(state, c, botId, 'setup');
        if (v > bestV) { bestV = v; best = c; } // striktes > ⇒ bei Gleichstand niedrigste Id
      }
      return { type: 'placeSetupSettlement', corner: best };
    }
    case 'setupRoad': {
      if (!isActive) return null;
      const p = state.players.find((pl) => pl.id === botId)!;
      if (p.roadsLeft <= 0) return null;
      const c = state.setupLastSettlement;
      // Exakter Reducer-Spiegel: der prüft canPlaceRoad(..., state.setupLastSettlement).
      const edges = validRoadEdges(state, botId, c);
      if (edges.length === 0) return null;
      let best = edges[0];
      let bestV = -Infinity;
      for (const eid of edges) {
        const e = state.board.edges[eid];
        const far = e.a === c ? e.b : e.a;
        const v = setupRoadValue(state, botId, far);
        if (v > bestV) { bestV = v; best = eid; }
      }
      return { type: 'placeSetupRoad', edge: best };
    }
    case 'roll': {
      if (!isActive) return null;
      // Ritter VOR dem Wurf ist regelkonform (guardPlayDev erlaubt 'roll') und der richtige
      // Moment: liegt der Räuber auf einem eigenen Feld, rettet das den Ertrag dieses Wurfs.
      // Terminierung: playKnight → moveRobber → ggf. steal → zurück nach 'roll' (hasRolled
      // ist noch false) → planKnight liefert jetzt null (playedDevThisTurn) → rollDice.
      return planKnight(state, botId) ?? { type: 'rollDice' };
    }
    case 'discard': {
      const need = state.mustDiscard[botId];
      if (need === undefined) return null;
      return getPlayer(state, botId).isBot
        ? planStrategicDiscard(state, botId, need)
        : { type: 'autoDiscard' };
    }
    case 'moveRobber': {
      if (!isActive) return null;
      let target = -1;
      let bestScore = -Infinity;
      for (const hex of state.board.hexes) {
        if (hex.terrain === 'W' || hex.id === state.robberHex) continue;
        const score = robberHexScore(state, botId, hex.id);
        if (score > bestScore) { bestScore = score; target = hex.id; }
      }
      if (target < 0) {
        target = state.board.hexes.find((h) => h.terrain !== 'W' && h.id !== state.robberHex)?.id ?? state.robberHex;
      }
      return { type: 'moveRobber', hex: target };
    }
    case 'steal': {
      if (!isActive) return null;
      const victim = bestStealVictim(state, botId);
      return victim ? { type: 'steal', victim } : null;
    }
    case 'roadBuilding': {
      if (!isActive) return null;
      // NIEMALS endTurn liefern: `endTurn` verlangt phase === 'main' (Reducer), hier wäre es
      // ein garantierter Reducer-Fehler → botTick plant denselben State neu → Endlosschleife.
      // Laut Reducer kann die Liste hier nicht leer sein (playRoadBuilding rechnet
      // available = min(2, roadsLeft, validRoadEdges) und bleibt bei 0 in 'main'; buildRoad
      // schaltet bei leerer Liste selbst zurück). null ist trotzdem die sichere Antwort.
      const p = state.players.find((pl) => pl.id === botId)!;
      if (p.roadsLeft <= 0) return null;
      const edges = validRoadEdges(state, botId, null);
      if (edges.length === 0) return null;
      const target = bestRoadTarget(state, botId);
      if (target) return { type: 'buildRoad', edge: target.edge };
      const longest = bestLongestRoadEdge(state, botId, false);
      return { type: 'buildRoad', edge: longest?.edge ?? edges[0] };
    }
    case 'main': {
      if (!isActive) return null;
      return planMain(state, botId);
    }
    default:
      return null;
  }
}

/**
 * Notaktion, die der Reducer garantiert akzeptiert — `null`, wenn es keinen sicheren
 * Ausweg gibt.
 *
 * Zweck: `chooseBotAction` spiegelt die Reducer-Prüfungen, aber ein Spiegel ist eine
 * Konvention, die eine künftige Reducer-Änderung still brechen kann. Ohne Netz macht
 * eine abgelehnte Bot-Aktion die Partie tot (botTick plant denselben State alle 700 ms
 * neu → dieselbe Aktion → Endlosschleife). Mit Netz kostet derselbe Fehler eine
 * Warnzeile und einen beendeten Zug.
 *
 * Jeder Zweig ist gegen den Reducer geprüft:
 * `cancelTrade` ist für den Anbieter immer erlaubt; `respondTrade` mit `accept: false`
 * kennt keine `canAfford`-Hürde; `autoDiscard` und `endTurn` prüfen nur Phase + Zuständigkeit.
 */
export function fallbackAction(state: GameState, id: string): GameAction | null {
  if (state.winner) return null;
  const offer = state.tradeOffer;
  if (offer && offer.from === id) return { type: 'cancelTrade' };
  if (offer && offer.responses[id] === 'pending') return { type: 'respondTrade', offerId: offer.id, accept: false };
  if (state.phase === 'discard' && state.mustDiscard[id] !== undefined) return { type: 'autoDiscard' };
  if (state.phase === 'main' && state.order[state.activeIndex] === id) return { type: 'endTurn' };
  // roll/moveRobber/steal/setup*: keine generische Notaktion — dort ist die Wahl trivial
  // und ein Fehlschlag deutet auf einen echten Logikfehler hin, den ein Notausgang nur kaschieren würde.
  return null;
}

/** Hat der Bot etwas zu tun? (Auch Nicht-Aktive: Abwerfen, Handelsangebot beantworten.) */
export function botHasPendingAction(state: GameState, botId: string): boolean {
  if (state.winner) return false;
  if (state.tradeOffer && (state.tradeOffer.responses[botId] === 'pending' || state.tradeOffer.from === botId)) return true;
  if (state.phase === 'discard') return state.mustDiscard[botId] !== undefined;
  return state.order[state.activeIndex] === botId;
}
