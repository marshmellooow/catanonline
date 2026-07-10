import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import type { GameState } from '../src/types.js';
import { canPlaceSettlement, canPlaceRoad, validSettlementCorners, validRoadEdges } from '../src/logic.js';

function coastGame(): GameState {
  return createGame({
    mapId: 'coast',
    seed: 3,
    players: [0, 1].map((i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i })),
  });
}

const isWater = (s: GameState, hid: number) => s.board.hexes[hid].terrain === 'W';

describe('Bauen am Wasser', () => {
  it('reine Wasser-Ecken sind nicht bebaubar, Küsten- und Landecken schon', () => {
    const s = coastGame();
    const pureWater = s.board.corners.find((c) => c.hexes.every((h) => isWater(s, h)));
    const coastal = s.board.corners.find((c) => c.hexes.some((h) => isWater(s, h)) && c.hexes.some((h) => !isWater(s, h)));
    const inland = s.board.corners.find((c) => c.hexes.every((h) => !isWater(s, h)));

    expect(pureWater).toBeDefined();
    expect(coastal).toBeDefined();
    expect(inland).toBeDefined();

    expect(canPlaceSettlement(s, pureWater!.id, 'p0', true)).toBe(false);
    expect(canPlaceSettlement(s, coastal!.id, 'p0', true)).toBe(true); // Küste erlaubt
    expect(canPlaceSettlement(s, inland!.id, 'p0', true)).toBe(true);
  });

  it('gültige Setup-Ecken enthalten keine reine Wasser-Ecke', () => {
    const s = coastGame();
    const valid = new Set(validSettlementCorners(s, 'p0', true));
    for (const c of s.board.corners) {
      if (c.hexes.every((h) => isWater(s, h))) {
        expect(valid.has(c.id)).toBe(false);
      }
    }
    expect(valid.size).toBeGreaterThan(0);
  });

  it('Straßen zwischen zwei Wasserfeldern sind nicht baubar (auch nicht im Setup)', () => {
    const s = coastGame();
    const waterEdge = s.board.edges.find((e) => e.hexes.length === 2 && e.hexes.every((h) => isWater(s, h)));
    expect(waterEdge).toBeDefined();
    // selbst wenn die Kante an die gesetzte Startsiedlung grenzte:
    expect(canPlaceRoad(s, waterEdge!.id, 'p0', waterEdge!.a)).toBe(false);
    expect(canPlaceRoad(s, waterEdge!.id, 'p0', null)).toBe(false);
    // Küsten-Straße dagegen erlaubt (mit Anschluss)
    const coastEdge = s.board.edges.find((e) => e.hexes.some((h) => isWater(s, h)) && e.hexes.some((h) => !isWater(s, h)));
    expect(coastEdge).toBeDefined();
    s.buildings[coastEdge!.a] = { owner: 'p0', type: 'settlement' };
    expect(validRoadEdges(s, 'p0', null)).toContain(coastEdge!.id);
  });
});
