// Redigierte Sicht: Der Server sendet jedem Spieler nur, was er sehen darf.
// Eigene Hand & eigene (verdeckte) Karten voll; von Gegnern nur Anzahlen.

import type { GameState, GameEvent, PublicState, PublicPlayer } from './types.js';
import { resourceTotal, victoryPoints, playerPorts, computeLongestRoad } from './logic.js';

function devCardTotal(counts: Record<string, number>): number {
  return Object.values(counts).reduce((s, n) => s + n, 0);
}

/**
 * Redigiert ein einzelnes Event für einen bestimmten Betrachter.
 * Beim Räuber-Diebstahl darf nur der Dieb (`to`) und das Opfer (`from`) wissen,
 * welche Karte gestohlen wurde — Dritte (inkl. Zuschauer) sehen `resource: null`.
 * Alle anderen Event-Typen bleiben unverändert.
 */
export function redactEventFor(event: GameEvent, viewerId: string): GameEvent {
  if (event.t === 'steal' && event.resource !== null && viewerId !== event.from && viewerId !== event.to) {
    return { ...event, resource: null };
  }
  return event;
}

/** Redigiert eine Event-Liste für einen bestimmten Betrachter (siehe {@link redactEventFor}). */
export function redactEventsFor(events: GameEvent[], viewerId: string): GameEvent[] {
  return events.map((e) => redactEventFor(e, viewerId));
}

export function toPublicState(state: GameState, viewerId: string): PublicState {
  const players: PublicPlayer[] = state.players.map((p) => {
    const isYou = p.id === viewerId;
    const pub: PublicPlayer = {
      id: p.id,
      name: p.name,
      colorIndex: p.colorIndex,
      connected: p.connected,
      isBot: p.isBot,
      resourceCount: resourceTotal(p.resources),
      devCardCount: devCardTotal(p.devCards) + devCardTotal(p.newDevCards),
      playedKnights: p.playedKnights,
      victoryPoints: victoryPoints(state, p, isYou), // eigene inkl. verdeckter SP-Karten
      settlementsLeft: p.settlementsLeft,
      citiesLeft: p.citiesLeft,
      roadsLeft: p.roadsLeft,
      longestRoad: state.longestRoadHolder === p.id,
      roadLength: computeLongestRoad(state, p.id),
      largestArmy: state.largestArmyHolder === p.id,
      ports: playerPorts(state, p.id),
    };
    if (isYou) {
      pub.resources = { ...p.resources };
      pub.devCards = { ...p.devCards };
      pub.newDevCards = { ...p.newDevCards };
    }
    return pub;
  });

  return {
    phase: state.phase,
    players,
    order: state.order,
    activeIndex: state.activeIndex,
    activePlayer: state.order[state.activeIndex] ?? null,
    board: state.board,
    buildings: state.buildings,
    roads: state.roads,
    robberHex: state.robberHex,
    dice: state.dice,
    mustDiscard: state.mustDiscard,
    stealCandidates: viewerId === state.order[state.activeIndex] ? state.stealCandidates : [],
    roadBuildingLeft: state.roadBuildingLeft,
    setupLastSettlement: state.setupLastSettlement,
    hasRolled: state.hasRolled,
    playedDevThisTurn: state.playedDevThisTurn,
    tradeOffer: state.tradeOffer,
    longestRoadHolder: state.longestRoadHolder,
    largestArmyHolder: state.largestArmyHolder,
    winner: state.winner,
    vpTarget: state.vpTarget,
    bankTotals: { ...state.bank },
    devDeckCount: state.devDeck.length,
    turnCount: state.turnCount,
    log: redactEventsFor(state.log.slice(-40), viewerId),
    you: viewerId,
  };
}
