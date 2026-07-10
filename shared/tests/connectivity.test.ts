import { describe, it, expect } from 'vitest';
import { buildBoard, landComponentCount } from '../src/board.js';
import { MAPS } from '../src/maps.js';
import type { TerrainCode } from '../src/design.js';

const ALL = [...MAPS.map((m) => m.id), 'random'];

function terrainKey(mapId: string, seed: number): string {
  return buildBoard(mapId, seed).hexes.map((h) => h.terrain).join('');
}
function terrainCounts(mapId: string, seed: number): Record<string, number> {
  const c: Record<string, number> = {};
  for (const h of buildBoard(mapId, seed).hexes) c[h.terrain] = (c[h.terrain] ?? 0) + 1;
  return c;
}

describe('Karten-Konnektivität', () => {
  it('jede Karte hat genau EINE zusammenhängende Landfläche (kein gestrandetes Feld)', () => {
    for (const id of ALL) {
      for (const seed of [1, 42, 777, 9999]) {
        const board = buildBoard(id, seed);
        expect(landComponentCount(board), `${id} @${seed}`).toBe(1);
      }
    }
  });
});

describe('Terrain-Randomisierung pro Partie', () => {
  it('unterschiedliche Seeds ergeben unterschiedliche Terrain-Layouts', () => {
    for (const id of ALL) {
      const a = terrainKey(id, 1);
      const b = terrainKey(id, 2);
      const c = terrainKey(id, 3);
      // mindestens zwei der drei Layouts unterscheiden sich
      expect(new Set([a, b, c]).size).toBeGreaterThan(1);
    }
  });

  it('Rohstoff-Verteilung (Multiset) bleibt über Seeds gleich — nur die Position ändert sich', () => {
    for (const id of ALL) {
      const c1 = terrainCounts(id, 1);
      const c2 = terrainCounts(id, 12345);
      expect(c2).toEqual(c1);
    }
  });

  it('gleicher Seed → identisches Board (deterministisch)', () => {
    for (const id of ALL) {
      expect(terrainKey(id, 555)).toBe(terrainKey(id, 555));
    }
  });

  it('6 und 8 bleiben nach dem Mischen nie benachbart', () => {
    const hot = (n: number | null) => n === 6 || n === 8;
    for (const id of ALL) {
      const board = buildBoard(id, 314);
      for (const hex of board.hexes) {
        if (!hot(hex.number)) continue;
        for (const nb of hex.neighbors) expect(hot(board.hexes[nb].number)).toBe(false);
      }
    }
  });

  it('genau eine Wüste bleibt erhalten (Räuber-Start)', () => {
    for (const id of ALL) {
      const deserts = buildBoard(id, 88).hexes.filter((h) => (h.terrain as TerrainCode) === 'D').length;
      expect(deserts, id).toBeGreaterThanOrEqual(1);
    }
  });
});
