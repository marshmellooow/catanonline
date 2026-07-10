// Einfacher Auto-Bot: übernimmt getrennte/ersetzte Sitze, damit eine Partie
// nie blockiert. Er würfelt, beendet Züge, wirft bei 7 ab, versetzt den Räuber
// und stiehlt — baut und handelt aber nicht (hält das Spiel bloß am Laufen).

import type { GameState } from './types.js';
import type { GameAction } from './actions.js';
import type { ResourceType } from './design.js';
import { RESOURCES, TERRAIN_RESOURCE, pipCount } from './design.js';
import { validSettlementCorners, canPlaceRoad } from './logic.js';

function cornerValue(state: GameState, corner: number): number {
  let v = 0;
  for (const hid of state.board.corners[corner].hexes) {
    const hex = state.board.hexes[hid];
    if (hex.number && TERRAIN_RESOURCE[hex.terrain]) v += pipCount(hex.number);
  }
  return v;
}

export function chooseBotAction(state: GameState, botId: string): GameAction | null {
  const isActive = state.order[state.activeIndex] === botId;

  switch (state.phase) {
    case 'setupSettlement': {
      if (!isActive) return null;
      const spots = validSettlementCorners(state, botId, true);
      if (spots.length === 0) return null;
      let best = spots[0];
      let bestV = -1;
      for (const c of spots) {
        const v = cornerValue(state, c);
        if (v > bestV) { bestV = v; best = c; }
      }
      return { type: 'placeSetupSettlement', corner: best };
    }
    case 'setupRoad': {
      if (!isActive) return null;
      const c = state.setupLastSettlement;
      const edge = state.board.edges.find((e) => canPlaceRoad(state, e.id, botId, c));
      return edge ? { type: 'placeSetupRoad', edge: edge.id } : null;
    }
    case 'roll': {
      if (!isActive) return null;
      return { type: 'rollDice' };
    }
    case 'discard': {
      const need = state.mustDiscard[botId];
      if (need === undefined) return null;
      const p = state.players.find((pl) => pl.id === botId)!;
      const disc: Partial<Record<ResourceType, number>> = {};
      let left = need;
      // von den häufigsten Rohstoffen abwerfen
      const byCount = RESOURCES.slice().sort((a, b) => p.resources[b] - p.resources[a]);
      for (const r of byCount) {
        if (left <= 0) break;
        const take = Math.min(left, p.resources[r]);
        if (take > 0) { disc[r] = take; left -= take; }
      }
      return { type: 'discard', resources: disc };
    }
    case 'moveRobber': {
      if (!isActive) return null;
      // auf ein Landfeld ohne eigene Gebäude, das Gegner trifft
      let target = -1;
      let bestOpp = -1;
      for (const hex of state.board.hexes) {
        if (hex.terrain === 'W' || hex.id === state.robberHex) continue;
        let opp = 0;
        let own = false;
        for (const cid of hex.corners) {
          const b = state.buildings[cid];
          if (!b) continue;
          if (b.owner === botId) own = true;
          else opp++;
        }
        if (own) continue;
        if (opp > bestOpp) { bestOpp = opp; target = hex.id; }
      }
      if (target < 0) {
        target = state.board.hexes.find((h) => h.terrain !== 'W' && h.id !== state.robberHex)?.id ?? state.robberHex;
      }
      return { type: 'moveRobber', hex: target };
    }
    case 'steal': {
      if (!isActive) return null;
      const victim = state.stealCandidates[0];
      return victim ? { type: 'steal', victim } : null;
    }
    case 'roadBuilding': {
      if (!isActive) return null;
      const edge = state.board.edges.find((e) => canPlaceRoad(state, e.id, botId, null));
      // Falls kein Platz: Dummy-endet über main (Reducer schaltet selbst zurück)
      return edge ? { type: 'buildRoad', edge: edge.id } : { type: 'endTurn' };
    }
    case 'main': {
      if (!isActive) return null;
      return { type: 'endTurn' };
    }
    default:
      return null;
  }
}

/** Hat der Bot in dieser Phase überhaupt etwas zu tun? (Auch Nicht-Aktive bei Abwerfen.) */
export function botHasPendingAction(state: GameState, botId: string): boolean {
  if (state.winner) return false;
  if (state.phase === 'discard') return state.mustDiscard[botId] !== undefined;
  return state.order[state.activeIndex] === botId;
}
