// Autoritativer Reducer: die EINZIGE Stelle, die den Spielzustand verändert.
// Disziplin: jede Handlung wird zuerst vollständig validiert, dann mutiert —
// so bleibt der State bei ungültigen Actions garantiert unverändert.

import type { GameState, GameEvent, PlayerState, ResourceCounts, TradeOffer } from './types.js';
import type { GameAction } from './actions.js';
import type { ResourceType } from './design.js';
import { RESOURCES, TERRAIN_RESOURCE } from './design.js';
import { createRng, rollDie, nextInt } from './rng.js';
import {
  COSTS, canAfford, payCost, addResources, resourceTotal,
  canPlaceSettlement, canPlaceRoad, validRoadEdges,
  produceResources, updateLongestRoad, updateLargestArmy,
  bestBankRate, playerPorts, checkWin,
} from './logic.js';

export type ApplyResult = { events: GameEvent[] } | { error: string };

const fail = (error: string): ApplyResult => ({ error });

function activePlayer(state: GameState): PlayerState {
  return state.players[indexOfId(state, state.order[state.activeIndex])];
}
function indexOfId(state: GameState, id: string): number {
  return state.players.findIndex((p) => p.id === id);
}
function getPlayer(state: GameState, id: string): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}
function isActive(state: GameState, id: string): boolean {
  return state.order[state.activeIndex] === id;
}

// Client-gelieferte Rohstoffmengen NIE ungeprüft übernehmen: auf nicht-negative
// Ganzzahlen klemmen (verhindert Erzeugen von Karten via negativer Mengen).
function clampCount(v: number | undefined): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function fromCounts(c: Partial<ResourceCounts> | null | undefined): ResourceCounts {
  // Die Payload kommt roh vom Client (der Server reicht JSON ungeprüft an applyAction
  // durch): sie kann null, ein Array, ein String oder eine Zahl sein. Ein Feldzugriff
  // auf null würde hier einen TypeError werfen, der ungefangen aus dem WS-Handler
  // entkommt und den GANZEN Server-Prozess mitsamt allen Räumen beendet.
  const o: Partial<ResourceCounts> = c && typeof c === 'object' ? c : {};
  return { wood: clampCount(o.wood), brick: clampCount(o.brick), wool: clampCount(o.wool), grain: clampCount(o.grain), ore: clampCount(o.ore) };
}
function isResource(r: unknown): r is ResourceType {
  return typeof r === 'string' && (RESOURCES as readonly string[]).includes(r);
}

function log(state: GameState, ev: GameEvent, out: GameEvent[]): void {
  state.log.push(ev);
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
  out.push(ev);
}

function maybeWin(state: GameState, player: PlayerState, out: GameEvent[]): void {
  if (state.winner) return;
  if (checkWin(state, player)) {
    state.winner = player.id;
    state.phase = 'finished';
    log(state, { t: 'win', player: player.id }, out);
  }
}

/** Nach Räuber/Steal in die passende Phase zurück (Wurf vs. Ritter vor Wurf). */
function robberReturnPhase(state: GameState): GameState['phase'] {
  return state.hasRolled ? 'main' : 'roll';
}

function computeStealCandidates(state: GameState, hex: number): string[] {
  const active = state.order[state.activeIndex];
  const set = new Set<string>();
  for (const cid of state.board.hexes[hex].corners) {
    const b = state.buildings[cid];
    if (b && b.owner !== active) {
      const pl = getPlayer(state, b.owner);
      if (pl && resourceTotal(pl.resources) > 0) set.add(b.owner);
    }
  }
  return [...set];
}

export function applyAction(state: GameState, playerId: string, action: GameAction): ApplyResult {
  if (state.phase === 'finished') return fail('Spiel ist beendet.');
  const out: GameEvent[] = [];

  switch (action.type) {
    // ---------------- Startaufstellung ----------------
    case 'placeSetupSettlement': {
      if (state.phase !== 'setupSettlement') return fail('Nicht in der Aufstellungsphase.');
      if (!isActive(state, playerId)) return fail('Du bist nicht am Zug.');
      const p = activePlayer(state);
      if (!canPlaceSettlement(state, action.corner, playerId, true)) return fail('Ungültiger Bauplatz (Abstandsregel).');
      if (p.settlementsLeft <= 0) return fail('Keine Siedlungen mehr.');
      state.buildings[action.corner] = { owner: playerId, type: 'settlement' };
      p.settlementsLeft--;
      state.setupLastSettlement = action.corner;
      // Zweite Runde: Starterträge ausschütten
      if (state.setupRound === 1) {
        const gain: ResourceCounts = fromCounts({});
        for (const hid of state.board.corners[action.corner].hexes) {
          const res = TERRAIN_RESOURCE[state.board.hexes[hid].terrain];
          if (res && state.bank[res] > 0) {
            gain[res]++;
            state.bank[res]--;
          }
        }
        addResources(p.resources, gain);
        if (resourceTotal(gain) > 0) log(state, { t: 'produce', gains: { [playerId]: gain } }, out);
      }
      updateLongestRoad(state);
      log(state, { t: 'build', player: playerId, kind: 'settlement', at: action.corner }, out);
      state.phase = 'setupRoad';
      return { events: out };
    }
    case 'placeSetupRoad': {
      if (state.phase !== 'setupRoad') return fail('Erst Siedlung setzen.');
      if (!isActive(state, playerId)) return fail('Du bist nicht am Zug.');
      const p = activePlayer(state);
      if (!canPlaceRoad(state, action.edge, playerId, state.setupLastSettlement)) return fail('Straße muss an die neue Siedlung grenzen.');
      if (p.roadsLeft <= 0) return fail('Keine Straßen mehr.');
      state.roads[action.edge] = { owner: playerId };
      p.roadsLeft--;
      updateLongestRoad(state);
      log(state, { t: 'build', player: playerId, kind: 'road', at: action.edge }, out);
      advanceSetup(state, out);
      return { events: out };
    }

    // ---------------- Würfeln ----------------
    case 'rollDice': {
      if (state.phase !== 'roll') return fail('Jetzt kann nicht gewürfelt werden.');
      if (!isActive(state, playerId)) return fail('Du bist nicht am Zug.');
      const rng = createRng(state.rngState);
      const d1 = rollDie(rng);
      const d2 = rollDie(rng);
      state.rngState = rng.s;
      state.dice = [d1, d2];
      state.hasRolled = true;
      const sum = d1 + d2;
      log(state, { t: 'roll', player: playerId, dice: [d1, d2], sum }, out);
      if (sum === 7) {
        // Abwerfen bestimmen
        const md: Record<string, number> = {};
        for (const pl of state.players) {
          const total = resourceTotal(pl.resources);
          if (total >= 8) md[pl.id] = Math.floor(total / 2);
        }
        state.mustDiscard = md;
        state.phase = Object.keys(md).length > 0 ? 'discard' : 'moveRobber';
      } else {
        const gains = produceResources(state, sum);
        if (Object.keys(gains).length > 0) log(state, { t: 'produce', gains }, out);
        state.phase = 'main';
      }
      return { events: out };
    }

    // ---------------- Abwerfen (bei 7) ----------------
    case 'discard': {
      if (state.phase !== 'discard') return fail('Kein Abwerfen nötig.');
      const need = state.mustDiscard[playerId];
      if (need === undefined) return fail('Du musst nichts abwerfen.');
      const disc = fromCounts(action.resources);
      const p = getPlayer(state, playerId)!;
      if (resourceTotal(disc) !== need) return fail(`Genau ${need} Karten abwerfen.`);
      if (!canAfford(p.resources, disc)) return fail('So viele Karten hast du nicht.');
      payCost(p.resources, disc);
      for (const r of RESOURCES) state.bank[r] += disc[r];
      delete state.mustDiscard[playerId];
      log(state, { t: 'discard', player: playerId, count: need }, out);
      if (Object.keys(state.mustDiscard).length === 0) state.phase = 'moveRobber';
      return { events: out };
    }

    // ---------------- Auto-Abwerfen (Zeit abgelaufen) ----------------
    // Wirft die geforderte Anzahl ab, aber KARTE FÜR KARTE zufällig aus der Hand
    // (flacher Pool, ohne Zurücklegen) — also ein zufälliger Mix statt „alles von einer Sorte".
    case 'autoDiscard': {
      if (state.phase !== 'discard') return fail('Kein Abwerfen nötig.');
      const need = state.mustDiscard[playerId];
      if (need === undefined) return fail('Du musst nichts abwerfen.');
      const p = getPlayer(state, playerId)!;
      const pool: ResourceType[] = [];
      for (const r of RESOURCES) for (let i = 0; i < p.resources[r]; i++) pool.push(r);
      const rng = createRng(state.rngState);
      const take = Math.min(need, pool.length);
      for (let k = 0; k < take; k++) {
        const idx = nextInt(rng, pool.length);
        const r = pool.splice(idx, 1)[0];
        p.resources[r]--;
        state.bank[r]++;
      }
      state.rngState = rng.s;
      delete state.mustDiscard[playerId];
      log(state, { t: 'discard', player: playerId, count: take }, out);
      if (Object.keys(state.mustDiscard).length === 0) state.phase = 'moveRobber';
      return { events: out };
    }

    // ---------------- Räuber versetzen ----------------
    case 'moveRobber': {
      if (state.phase !== 'moveRobber') return fail('Räuber kann jetzt nicht versetzt werden.');
      if (!isActive(state, playerId)) return fail('Du bist nicht am Zug.');
      const hex = state.board.hexes[action.hex];
      if (!hex) return fail('Unbekanntes Feld.');
      if (action.hex === state.robberHex) return fail('Der Räuber muss auf ein anderes Feld.');
      if (hex.terrain === 'W') return fail('Der Räuber kann nicht ins Wasser.');
      state.robberHex = action.hex;
      log(state, { t: 'robber', player: playerId, hex: action.hex }, out);
      const candidates = computeStealCandidates(state, action.hex);
      if (candidates.length === 0) {
        state.stealCandidates = [];
        state.phase = robberReturnPhase(state);
      } else if (candidates.length === 1) {
        stealFrom(state, candidates[0], out);
        state.phase = robberReturnPhase(state);
      } else {
        state.stealCandidates = candidates;
        state.phase = 'steal';
      }
      return { events: out };
    }
    case 'steal': {
      if (state.phase !== 'steal') return fail('Jetzt kann nicht gestohlen werden.');
      if (!isActive(state, playerId)) return fail('Du bist nicht am Zug.');
      if (!state.stealCandidates.includes(action.victim)) return fail('Ungültiges Ziel.');
      stealFrom(state, action.victim, out);
      state.stealCandidates = [];
      state.phase = robberReturnPhase(state);
      return { events: out };
    }

    // ---------------- Bauen ----------------
    case 'buildRoad': {
      const free = state.phase === 'roadBuilding';
      if (!free && state.phase !== 'main') return fail('Jetzt kann nicht gebaut werden.');
      if (!isActive(state, playerId)) return fail('Du bist nicht am Zug.');
      const p = activePlayer(state);
      if (!canPlaceRoad(state, action.edge, playerId, null)) return fail('Ungültiger Straßenplatz.');
      if (p.roadsLeft <= 0) return fail('Keine Straßen mehr.');
      if (!free) {
        if (!canAfford(p.resources, COSTS.road)) return fail('Nicht genug Rohstoffe (Holz + Lehm).');
        payCost(p.resources, COSTS.road);
        for (const r of RESOURCES) state.bank[r] += COSTS.road[r] ?? 0;
      }
      state.roads[action.edge] = { owner: playerId };
      p.roadsLeft--;
      log(state, { t: 'build', player: playerId, kind: 'road', at: action.edge }, out);
      {
        const prevLR = state.longestRoadHolder;
        if (updateLongestRoad(state)) log(state, { t: 'longestRoad', player: state.longestRoadHolder, prev: prevLR }, out);
      }
      if (free) {
        state.roadBuildingLeft--;
        if (state.roadBuildingLeft <= 0 || validRoadEdges(state, playerId, null).length === 0) {
          state.roadBuildingLeft = 0;
          state.phase = 'main';
        }
      }
      maybeWin(state, p, out);
      return { events: out };
    }
    case 'buildSettlement': {
      if (state.phase !== 'main') return fail('Jetzt kann nicht gebaut werden.');
      if (!isActive(state, playerId)) return fail('Du bist nicht am Zug.');
      const p = activePlayer(state);
      if (!canPlaceSettlement(state, action.corner, playerId, false)) return fail('Ungültiger Bauplatz (Abstand/Anschluss).');
      if (p.settlementsLeft <= 0) return fail('Keine Siedlungen mehr.');
      if (!canAfford(p.resources, COSTS.settlement)) return fail('Nicht genug Rohstoffe.');
      payCost(p.resources, COSTS.settlement);
      for (const r of RESOURCES) state.bank[r] += COSTS.settlement[r] ?? 0;
      state.buildings[action.corner] = { owner: playerId, type: 'settlement' };
      p.settlementsLeft--;
      log(state, { t: 'build', player: playerId, kind: 'settlement', at: action.corner }, out);
      {
        const prevLR = state.longestRoadHolder;
        if (updateLongestRoad(state)) log(state, { t: 'longestRoad', player: state.longestRoadHolder, prev: prevLR }, out);
      }
      maybeWin(state, p, out);
      return { events: out };
    }
    case 'buildCity': {
      if (state.phase !== 'main') return fail('Jetzt kann nicht gebaut werden.');
      if (!isActive(state, playerId)) return fail('Du bist nicht am Zug.');
      const p = activePlayer(state);
      const b = state.buildings[action.corner];
      if (!b || b.owner !== playerId || b.type !== 'settlement') return fail('Hier steht keine eigene Siedlung.');
      if (p.citiesLeft <= 0) return fail('Keine Städte mehr.');
      if (!canAfford(p.resources, COSTS.city)) return fail('Nicht genug Rohstoffe (2 Getreide + 3 Erz).');
      payCost(p.resources, COSTS.city);
      for (const r of RESOURCES) state.bank[r] += COSTS.city[r] ?? 0;
      b.type = 'city';
      p.citiesLeft--;
      p.settlementsLeft++;
      log(state, { t: 'build', player: playerId, kind: 'city', at: action.corner }, out);
      maybeWin(state, p, out);
      return { events: out };
    }

    // ---------------- Entwicklungskarten ----------------
    case 'buyDevCard': {
      if (state.phase !== 'main') return fail('Jetzt nicht möglich.');
      if (!isActive(state, playerId)) return fail('Du bist nicht am Zug.');
      const p = activePlayer(state);
      if (state.devDeck.length === 0) return fail('Der Entwicklungsstapel ist leer.');
      if (!canAfford(p.resources, COSTS.devCard)) return fail('Nicht genug Rohstoffe (Wolle + Getreide + Erz).');
      payCost(p.resources, COSTS.devCard);
      for (const r of RESOURCES) state.bank[r] += COSTS.devCard[r] ?? 0;
      const card = state.devDeck.pop()!;
      if (card === 'victoryPoint') {
        p.newDevCards.victoryPoint++;
      } else {
        p.newDevCards[card]++;
      }
      log(state, { t: 'buyDev', player: playerId }, out);
      maybeWin(state, p, out);
      return { events: out };
    }
    case 'playKnight': {
      const g = guardPlayDev(state, playerId, 'knight');
      if (g) return g;
      const p = activePlayer(state);
      p.devCards.knight--;
      p.playedKnights++;
      state.playedDevThisTurn = true;
      log(state, { t: 'playDev', player: playerId, card: 'knight' }, out);
      if (updateLargestArmy(state)) log(state, { t: 'largestArmy', player: state.largestArmyHolder }, out);
      state.phase = 'moveRobber';
      maybeWin(state, p, out);
      return { events: out };
    }
    case 'playRoadBuilding': {
      const g = guardPlayDev(state, playerId, 'roadBuilding');
      if (g) return g;
      const p = activePlayer(state);
      p.devCards.roadBuilding--;
      state.playedDevThisTurn = true;
      log(state, { t: 'playDev', player: playerId, card: 'roadBuilding' }, out);
      const available = Math.min(2, p.roadsLeft, validRoadEdges(state, playerId, null).length);
      if (available <= 0) {
        return { events: out }; // Karte verpufft, aber gilt als gespielt
      }
      state.roadBuildingLeft = available;
      state.phase = 'roadBuilding';
      return { events: out };
    }
    case 'playYearOfPlenty': {
      const g = guardPlayDev(state, playerId, 'yearOfPlenty');
      if (g) return g;
      const p = activePlayer(state);
      const [r1, r2] = action.resources;
      if (!isResource(r1) || !isResource(r2)) return fail('Ungültiger Rohstoff.');
      const need = fromCounts({});
      need[r1]++; need[r2]++;
      for (const r of RESOURCES) if (need[r] > state.bank[r]) return fail('Die Bank hat nicht genug Rohstoffe.');
      p.devCards.yearOfPlenty--;
      state.playedDevThisTurn = true;
      addResources(p.resources, need);
      for (const r of RESOURCES) state.bank[r] -= need[r];
      log(state, { t: 'playDev', player: playerId, card: 'yearOfPlenty' }, out);
      log(state, { t: 'yearOfPlenty', player: playerId, resources: [r1, r2] }, out);
      return { events: out };
    }
    case 'playMonopoly': {
      const g = guardPlayDev(state, playerId, 'monopoly');
      if (g) return g;
      const p = activePlayer(state);
      const res = action.resource;
      if (!isResource(res)) return fail('Ungültiger Rohstoff.');
      p.devCards.monopoly--;
      state.playedDevThisTurn = true;
      let total = 0;
      for (const other of state.players) {
        if (other.id === playerId) continue;
        total += other.resources[res];
        other.resources[res] = 0;
      }
      p.resources[res] += total;
      log(state, { t: 'playDev', player: playerId, card: 'monopoly' }, out);
      log(state, { t: 'monopoly', player: playerId, resource: res, total }, out);
      return { events: out };
    }

    // ---------------- Handel ----------------
    case 'bankTrade': {
      if (state.phase !== 'main') return fail('Handel nur im Bauzug.');
      if (!isActive(state, playerId)) return fail('Nur der aktive Spieler handelt mit der Bank.');
      const p = activePlayer(state);
      if (!isResource(action.give) || !isResource(action.get)) return fail('Ungültiger Rohstoff.');
      if (action.give === action.get) return fail('Gleiche Rohstoffe.');
      const rate = bestBankRate(playerPorts(state, playerId), action.give);
      if (p.resources[action.give] < rate) return fail(`Du brauchst ${rate}× ${action.give}.`);
      if (state.bank[action.get] < 1) return fail('Die Bank hat diesen Rohstoff nicht.');
      p.resources[action.give] -= rate;
      state.bank[action.give] += rate;
      p.resources[action.get] += 1;
      state.bank[action.get] -= 1;
      const give = fromCounts({ [action.give]: rate });
      const get = fromCounts({ [action.get]: 1 });
      log(state, { t: 'bankTrade', player: playerId, give, get }, out);
      return { events: out };
    }
    case 'proposeTrade': {
      if (state.phase !== 'main') return fail('Handel nur im Bauzug.');
      if (!isActive(state, playerId)) return fail('Nur der aktive Spieler bietet an.');
      const p = activePlayer(state);
      const give = fromCounts(action.give);
      const get = fromCounts(action.get);
      if (resourceTotal(give) === 0 || resourceTotal(get) === 0) return fail('Beide Seiten müssen mindestens eine Karte enthalten.');
      if (!canAfford(p.resources, give)) return fail('Du hast die angebotenen Karten nicht.');
      // Kein Mitspieler kann die geforderten Karten liefern? Dann gar nicht erst anbieten.
      // (Autoritativ auf dem Server, weil der Client fremde Hände bewusst nicht kennt.)
      if (!state.players.some((o) => o.id !== playerId && canAfford(o.resources, get))) {
        return fail('Kein Mitspieler hat die geforderten Karten.');
      }
      const responses: Record<string, 'accept' | 'reject' | 'pending' | 'counter'> = {};
      for (const other of state.players) {
        if (other.id === playerId) continue;
        // Alle Mitspieler (auch Bots/übernommene Sitze) dürfen antworten — die
        // Bot-Antwort kommt serverseitig über die Auto-Steuerung (siehe bot.ts).
        responses[other.id] = 'pending';
      }
      // Eindeutige Id über einen monotonen Zähler: propose→cancel→propose im selben
      // Zug ergab früher dieselbe Id, sodass eine verspätete Antwort/ein Gegenangebot
      // zum ALTEN Angebot das neue getroffen hätte.
      const offer: TradeOffer = { id: `t${state.tradeSeq++}`, from: playerId, give, get, responses, counters: {} };
      state.tradeOffer = offer;
      return { events: out };
    }
    case 'respondTrade': {
      const offer = state.tradeOffer;
      if (!offer || offer.id !== action.offerId) return fail('Kein aktuelles Angebot.');
      if (!(playerId in offer.responses)) return fail('Du bist nicht Teil dieses Angebots.');
      if (action.accept) {
        const p = getPlayer(state, playerId)!;
        if (!canAfford(p.resources, offer.get)) return fail('Du hast die geforderten Karten nicht.');
        offer.responses[playerId] = 'accept';
      } else {
        offer.responses[playerId] = 'reject';
      }
      // Wer normal antwortet, zieht ein früheres Gegenangebot zurück — sonst bliebe
      // es als annehmbares „Geisterangebot" liegen. (Zugleich der Rückzieh-Weg.)
      delete offer.counters[playerId];
      return { events: out };
    }
    case 'confirmTrade': {
      const offer = state.tradeOffer;
      if (!offer || offer.id !== action.offerId) return fail('Kein aktuelles Angebot.');
      if (offer.from !== playerId) return fail('Nur der Anbieter bestätigt.');
      if (offer.responses[action.withPlayer] !== 'accept') return fail('Dieser Spieler hat nicht angenommen.');
      const proposer = getPlayer(state, playerId)!;
      const partner = getPlayer(state, action.withPlayer)!;
      if (!canAfford(proposer.resources, offer.give)) return fail('Du hast die Karten nicht mehr.');
      if (!canAfford(partner.resources, offer.get)) return fail('Der Partner hat die Karten nicht mehr.');
      payCost(proposer.resources, offer.give);
      addResources(proposer.resources, offer.get);
      payCost(partner.resources, offer.get);
      addResources(partner.resources, offer.give);
      log(state, { t: 'trade', from: playerId, to: action.withPlayer, give: offer.give, get: offer.get }, out);
      state.tradeOffer = null;
      return { events: out };
    }
    case 'counterTrade': {
      const offer = state.tradeOffer;
      if (!offer || offer.id !== action.offerId) return fail('Kein aktuelles Angebot.');
      if (offer.from === playerId) return fail('Du kannst dein eigenes Angebot nicht kontern.');
      if (!(playerId in offer.responses)) return fail('Du bist nicht Teil dieses Angebots.');
      // Mengen aus Sicht des Konternden — clampen (nicht-negative Ganzzahlen, nur
      // bekannte Rohstoffe), niemals ungeprüft übernehmen.
      const myGive = fromCounts(action.give);
      const myGet = fromCounts(action.get);
      if (resourceTotal(myGive) === 0 || resourceTotal(myGet) === 0) return fail('Beide Seiten müssen mindestens eine Karte enthalten.');
      const me = getPlayer(state, playerId)!;
      if (!canAfford(me.resources, myGive)) return fail('Du hast die angebotenen Karten nicht.');
      // BEWUSST NICHT geprüft: ob der Anbieter `myGet` besitzt. Sonst wäre die
      // Fehlermeldung ein exaktes Hand-Orakel (man könnte die fremde Hand binär
      // abfragen). Geprüft wird erst beim Annehmen — da kennt der Anbieter seine
      // eigene Hand, also kein Leak.
      // In die ANBIETER-Perspektive drehen (siehe TradeCounter): was ich bekomme,
      // gibt der Anbieter her — und umgekehrt.
      offer.counters[playerId] = { give: myGet, get: myGive };
      offer.responses[playerId] = 'counter';
      return { events: out };
    }
    case 'acceptCounter': {
      const offer = state.tradeOffer;
      if (!offer || offer.id !== action.offerId) return fail('Kein aktuelles Angebot.');
      if (offer.from !== playerId) return fail('Nur der Anbieter nimmt ein Gegenangebot an.');
      // Erst der String-Vergleich auf den Status, DANN erst `counters[...]` lesen:
      // sonst liefert z. B. withPlayer='__proto__' einen Prototyp-Treffer (truthy),
      // und das nachfolgende getPlayer(...)! würde den Server crashen.
      if (offer.responses[action.withPlayer] !== 'counter') return fail('Von diesem Spieler liegt kein Gegenangebot vor.');
      const counter = offer.counters[action.withPlayer];
      if (!counter) return fail('Von diesem Spieler liegt kein Gegenangebot vor.');
      const partner = getPlayer(state, action.withPlayer);
      if (!partner) return fail('Spieler unbekannt.');
      const proposer = getPlayer(state, playerId)!;
      // Beide Hände zur AUSFÜHRUNGSZEIT neu prüfen — zwischen Kontern und Annehmen
      // kann sich alles geändert haben (Bauen, Monopol, Räuber, Abwurf nach 7).
      if (!canAfford(proposer.resources, counter.give)) return fail('Du hast die Karten nicht mehr.');
      if (!canAfford(partner.resources, counter.get)) return fail('Der Partner hat die Karten nicht mehr.');
      // Identischer Tausch wie confirmTrade — counters stehen in Anbieter-Perspektive.
      payCost(proposer.resources, counter.give);
      addResources(proposer.resources, counter.get);
      payCost(partner.resources, counter.get);
      addResources(partner.resources, counter.give);
      log(state, { t: 'trade', from: playerId, to: action.withPlayer, give: counter.give, get: counter.get }, out);
      state.tradeOffer = null;
      return { events: out };
    }
    case 'cancelTrade': {
      // Muss für den Anbieter IMMER möglich bleiben (auch bei offenen Gegenangeboten):
      // die Auto-Steuerung (enforceTurn/botTick) löst ein Angebot hierüber auf — ein
      // zusätzlicher Guard würde dort eine Endlosschleife erzeugen.
      if (!state.tradeOffer) return fail('Kein Angebot offen.');
      if (state.tradeOffer.from !== playerId) return fail('Nur der Anbieter kann abbrechen.');
      state.tradeOffer = null;
      return { events: out };
    }

    // ---------------- Zug beenden ----------------
    case 'endTurn': {
      if (state.phase !== 'main') return fail('Zug kann jetzt nicht beendet werden.');
      if (!isActive(state, playerId)) return fail('Du bist nicht am Zug.');
      endTurn(state, out);
      return { events: out };
    }

    default:
      return fail('Unbekannte Aktion.');
  }
}

// ---------------- interne Helfer ----------------

function guardPlayDev(state: GameState, playerId: string, card: 'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly'): ApplyResult | null {
  if (state.phase !== 'main' && state.phase !== 'roll') return { error: 'Entwicklungskarte jetzt nicht spielbar.' };
  if (!isActive(state, playerId)) return { error: 'Du bist nicht am Zug.' };
  if (state.playedDevThisTurn) return { error: 'Nur eine Entwicklungskarte pro Zug.' };
  const p = activePlayer(state);
  if (p.devCards[card] <= 0) return { error: 'Diese Karte hast du nicht (spielbar).' };
  return null;
}

function stealFrom(state: GameState, victimId: string, out: GameEvent[]): void {
  const active = activePlayer(state);
  const victim = getPlayer(state, victimId)!;
  // flache Kartenliste
  const pool: ResourceType[] = [];
  for (const r of RESOURCES) for (let i = 0; i < victim.resources[r]; i++) pool.push(r);
  if (pool.length === 0) {
    log(state, { t: 'steal', from: victimId, to: active.id, resource: null, stole: false }, out);
    return;
  }
  const rng = createRng(state.rngState);
  const idx = nextInt(rng, pool.length);
  state.rngState = rng.s;
  const res = pool[idx];
  victim.resources[res]--;
  active.resources[res]++;
  log(state, { t: 'steal', from: victimId, to: active.id, resource: res, stole: true }, out);
}

function advanceSetup(state: GameState, out: GameEvent[]): void {
  const n = state.order.length;
  if (state.setupRound === 0) {
    if (state.activeIndex < n - 1) {
      state.activeIndex++;
    } else {
      state.setupRound = 1; // Schlange kehrt um, gleicher Spieler nochmal
    }
    state.phase = 'setupSettlement';
  } else {
    if (state.activeIndex > 0) {
      state.activeIndex--;
      state.phase = 'setupSettlement';
    } else {
      // Aufstellung fertig → Hauptspiel
      state.phase = 'roll';
      state.hasRolled = false;
      state.turnCount = 1;
      log(state, { t: 'turn', player: state.order[state.activeIndex] }, out);
    }
  }
  state.setupLastSettlement = null;
}

function endTurn(state: GameState, out: GameEvent[]): void {
  const p = activePlayer(state);
  // gekaufte Karten werden nächsten Zug spielbar
  for (const k of ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'] as const) {
    p.devCards[k] += p.newDevCards[k];
    p.newDevCards[k] = 0;
  }
  state.playedDevThisTurn = false;
  state.hasRolled = false;
  state.dice = null;
  state.tradeOffer = null;
  state.mustDiscard = {};
  state.stealCandidates = [];
  state.roadBuildingLeft = 0;
  state.activeIndex = (state.activeIndex + 1) % state.order.length;
  state.phase = 'roll';
  state.turnCount++;
  log(state, { t: 'turn', player: state.order[state.activeIndex] }, out);
}
