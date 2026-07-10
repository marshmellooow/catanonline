import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import type { GameState } from '../src/types.js';
import {
  canPlaceSettlement, canPlaceRoad, produceResources, computeLongestRoad,
  updateLongestRoad, bestBankRate, resourceTotal,
} from '../src/logic.js';
import { TERRAIN_RESOURCE } from '../src/design.js';

function newGame(players = 3): GameState {
  return createGame({
    mapId: 'classic',
    seed: 100,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i })),
  });
}

/** Findet einen einfachen Pfad aus `len` Kanten und liefert deren Ids. */
function findPath(state: GameState, len: number): number[] {
  const board = state.board;
  const usedEdges = new Set<number>();
  const result: number[] = [];
  function dfs(corner: number): boolean {
    if (result.length === len) return true;
    for (const eid of board.corners[corner].edges) {
      if (usedEdges.has(eid)) continue;
      const e = board.edges[eid];
      const next = e.a === corner ? e.b : e.a;
      usedEdges.add(eid);
      result.push(eid);
      if (dfs(next)) return true;
      result.pop();
      usedEdges.delete(eid);
    }
    return false;
  }
  dfs(board.corners[0].id);
  return result;
}

describe('Bauregeln', () => {
  it('Abstandsregel: keine Siedlung neben Siedlung', () => {
    const s = newGame();
    const corner = s.board.corners[0];
    expect(canPlaceSettlement(s, corner.id, 'p0', true)).toBe(true);
    s.buildings[corner.id] = { owner: 'p0', type: 'settlement' };
    // Nachbar-Ecke jetzt gesperrt
    const adj = corner.adjacent[0];
    expect(canPlaceSettlement(s, adj, 'p1', true)).toBe(false);
    // die belegte Ecke selbst auch
    expect(canPlaceSettlement(s, corner.id, 'p1', true)).toBe(false);
  });

  it('Siedlung im Hauptspiel braucht eigene Straße', () => {
    const s = newGame();
    const corner = s.board.corners[10];
    // ohne Straße nicht baubar (kein Setup)
    expect(canPlaceSettlement(s, corner.id, 'p0', false)).toBe(false);
    // Straße an die Ecke legen
    const edge = corner.edges[0];
    s.roads[edge] = { owner: 'p0' };
    expect(canPlaceSettlement(s, corner.id, 'p0', false)).toBe(true);
  });

  it('Straße braucht Anschluss an eigene Straße/Gebäude', () => {
    const s = newGame();
    const c = s.board.corners[5];
    const e0 = c.edges[0];
    // isoliert nicht baubar
    expect(canPlaceRoad(s, e0, 'p0', null)).toBe(false);
    // mit Gebäude an der Ecke baubar
    s.buildings[c.id] = { owner: 'p0', type: 'settlement' };
    expect(canPlaceRoad(s, e0, 'p0', null)).toBe(true);
  });
});

describe('Ertrag', () => {
  it('Siedlung 1, Stadt 2 Rohstoffe; Räuberfeld schüttet nicht', () => {
    const s = newGame();
    // finde ein Feld mit Zahl 8 und Rohstoff
    const hex = s.board.hexes.find((h) => h.number === 8 && TERRAIN_RESOURCE[h.terrain])!;
    const res = TERRAIN_RESOURCE[hex.terrain]!;
    const corner = hex.corners[0];
    s.buildings[corner] = { owner: 'p0', type: 'settlement' };
    produceResources(s, 8);
    expect(s.players[0].resources[res]).toBe(1);
    // Upgrade zu Stadt → 2
    s.buildings[corner].type = 'city';
    produceResources(s, 8);
    expect(s.players[0].resources[res]).toBe(3);
    // Räuber auf das Feld → kein Ertrag
    s.robberHex = hex.id;
    produceResources(s, 8);
    expect(s.players[0].resources[res]).toBe(3);
  });
});

describe('Längste Straße', () => {
  it('zählt zusammenhängende Straßen und vergibt ab 5', () => {
    const s = newGame();
    const path = findPath(s, 5);
    expect(path.length).toBe(5);
    for (const eid of path) s.roads[eid] = { owner: 'p0' };
    expect(computeLongestRoad(s, 'p0')).toBe(5);
    updateLongestRoad(s);
    expect(s.longestRoadHolder).toBe('p0');
  });

  it('gegnerisches Gebäude unterbricht die Straße', () => {
    const s = newGame();
    const path = findPath(s, 5);
    for (const eid of path) s.roads[eid] = { owner: 'p0' };
    // finde die mittlere Ecke zwischen Kante 2 und 3
    const e2 = s.board.edges[path[2]];
    const e3 = s.board.edges[path[3]];
    const mid = [e2.a, e2.b].find((c) => c === e3.a || c === e3.b)!;
    s.buildings[mid] = { owner: 'p1', type: 'settlement' };
    // längster Teilweg jetzt < 5
    expect(computeLongestRoad(s, 'p0')).toBeLessThan(5);
  });
});

describe('Bank-Kurse', () => {
  it('4:1 ohne Hafen, 3:1 allgemein, 2:1 speziell', () => {
    expect(bestBankRate([], 'wood')).toBe(4);
    expect(bestBankRate(['3:1'], 'wood')).toBe(3);
    expect(bestBankRate(['wood'], 'wood')).toBe(2);
    expect(bestBankRate(['wood', '3:1'], 'brick')).toBe(3);
  });
});

describe('RNG-Determinismus', () => {
  it('gleicher Seed → identischer Startzustand', () => {
    const a = newGame();
    const b = newGame();
    expect(a.devDeck).toEqual(b.devDeck);
    expect(resourceTotal(a.bank)).toBe(resourceTotal(b.bank));
  });
});
