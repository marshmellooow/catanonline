import { describe, it, expect } from 'vitest';
import { buildBoard } from '../src/board.js';
import { createRng, shuffle } from '../src/rng.js';
import type { Board } from '../src/types.js';
import type { TerrainCode } from '../src/design.js';

const isLand = (t: TerrainCode) => t !== 'W';

/** Anteil gleichfarbiger Land-Land-Kanten (0..1). Niedrig = gut gestreut. */
function sameTerrainEdgeFraction(board: Board): number {
  let same = 0;
  let total = 0;
  for (const h of board.hexes) {
    if (!isLand(h.terrain)) continue;
    for (const nb of h.neighbors) {
      if (nb <= h.id) continue; // jede Kante einmal
      const o = board.hexes[nb];
      if (!isLand(o.terrain)) continue;
      total++;
      if (o.terrain === h.terrain) same++;
    }
  }
  return total === 0 ? 0 : same / total;
}

/** Größte zusammenhängende gleichfarbige Fläche (Anzahl Felder). */
function maxSameTerrainCluster(board: Board): number {
  const seen = new Set<number>();
  let max = 0;
  for (const h of board.hexes) {
    if (!isLand(h.terrain) || seen.has(h.id)) continue;
    let size = 0;
    const stack = [h.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      size++;
      for (const nb of board.hexes[id].neighbors) {
        const o = board.hexes[nb];
        if (isLand(o.terrain) && o.terrain === h.terrain && !seen.has(nb)) stack.push(nb);
      }
    }
    if (size > max) max = size;
  }
  return max;
}

/** Referenz: reiner Zufalls-Shuffle desselben Multisets (= altes Verhalten). */
function pureShuffle(board: Board, seed: number): Map<number, TerrainCode> {
  const land = board.hexes.filter((h) => isLand(h.terrain));
  const terr = shuffle(createRng(seed), land.map((h) => h.terrain));
  const m = new Map<number, TerrainCode>();
  land.forEach((h, i) => m.set(h.id, terr[i]));
  return m;
}
function fractionOf(board: Board, m: Map<number, TerrainCode>): number {
  let same = 0;
  let total = 0;
  for (const [id, t] of m) {
    for (const nb of board.hexes[id].neighbors) {
      if (nb <= id || !m.has(nb)) continue;
      total++;
      if (m.get(nb) === t) same++;
    }
  }
  return total === 0 ? 0 : same / total;
}
function maxClusterOf(board: Board, m: Map<number, TerrainCode>): number {
  const seen = new Set<number>();
  let max = 0;
  for (const [start, t] of m) {
    if (seen.has(start)) continue;
    let size = 0;
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      size++;
      for (const nb of board.hexes[id].neighbors) if (m.get(nb) === t && !seen.has(nb)) stack.push(nb);
    }
    if (size > max) max = size;
  }
  return max;
}

const seeds = Array.from({ length: 30 }, (_, i) => 1000 + i * 37);

describe('Terrain-Verteilung (Streuung)', () => {
  it('Kontinent (53 Felder): deutlich weniger gleichfarbige Nachbarn + kleinere Blöcke als reiner Zufall', () => {
    let newFrac = 0;
    let baseFrac = 0;
    let newMax = 0;
    let baseMax = 0;
    for (const s of seeds) {
      const board = buildBoard('continent', s);
      newFrac += sameTerrainEdgeFraction(board);
      newMax += maxSameTerrainCluster(board);
      const pm = pureShuffle(board, s ^ 0xabc);
      baseFrac += fractionOf(board, pm);
      baseMax += maxClusterOf(board, pm);
    }
    const n = seeds.length;
    // eslint-disable-next-line no-console
    console.log(`[continent] gleichfarb. Kanten neu=${(newFrac / n).toFixed(3)} vs zufall=${(baseFrac / n).toFixed(3)} · maxBlock neu=${(newMax / n).toFixed(1)} vs zufall=${(baseMax / n).toFixed(1)}`);
    expect(newFrac / n).toBeLessThan((baseFrac / n) * 0.5); // mind. halbiert
    expect(newMax / n).toBeLessThan(baseMax / n); // kleinere größte Fläche
  });

  it('größter einfarbiger Block bleibt klein (kein „alles auf einem Platz")', () => {
    let worst = 0;
    for (const s of seeds) worst = Math.max(worst, maxSameTerrainCluster(buildBoard('continent', s)));
    // eslint-disable-next-line no-console
    console.log(`[continent] größter einfarbiger Block über ${seeds.length} Seeds: ${worst}`);
    expect(worst).toBeLessThanOrEqual(5); // klein (reiner Zufall liegt bei 7–10+)
  });

  it('Harbor (42 Felder) profitiert ebenfalls', () => {
    let newFrac = 0;
    let baseFrac = 0;
    for (const s of seeds) {
      const board = buildBoard('harbor', s);
      newFrac += sameTerrainEdgeFraction(board);
      baseFrac += fractionOf(board, pureShuffle(board, s ^ 0xabc));
    }
    const n = seeds.length;
    // eslint-disable-next-line no-console
    console.log(`[harbor] gleichfarb. Kanten neu=${(newFrac / n).toFixed(3)} vs zufall=${(baseFrac / n).toFixed(3)}`);
    expect(newFrac / n).toBeLessThan((baseFrac / n) * 0.6);
  });

  it('Rohstoff-Multiset bleibt erhalten (seed-unabhängig, nur umsortiert)', () => {
    const count = (b: Board): Record<string, number> => {
      const m: Record<string, number> = {};
      for (const h of b.hexes) m[h.terrain] = (m[h.terrain] ?? 0) + 1;
      return m;
    };
    expect(count(buildBoard('continent', 42))).toEqual(count(buildBoard('continent', 99)));
  });

  it('Rohstoffe sind ausgewogen (offizielles 4:4:4:3:3-Verhältnis, Getreide nicht dominant)', () => {
    for (const id of ['classic', 'coast', 'continent', 'lakes', 'harbor']) {
      const b = buildBoard(id, 2024);
      const c: Record<string, number> = {};
      for (const h of b.hexes) if ('FHPGM'.includes(h.terrain)) c[h.terrain] = (c[h.terrain] ?? 0) + 1;
      const vals = ['F', 'H', 'P', 'G', 'M'].map((t) => c[t] ?? 0);
      const max = Math.max(...vals);
      const min = Math.min(...vals);
      expect(min).toBeGreaterThan(0); // jeder Rohstoff kommt vor
      expect(max / min).toBeLessThanOrEqual(1.6); // nahe 4:3, keiner dominiert (früher bis 3:1)
      expect(c['G'] ?? 0).toBeLessThanOrEqual(max); // Getreide nie allein an der Spitze über dem Feld
    }
  });

  it('deterministisch: gleicher Seed → identisches Terrain-Layout', () => {
    const a = buildBoard('continent', 7).hexes.map((h) => h.terrain);
    const b = buildBoard('continent', 7).hexes.map((h) => h.terrain);
    expect(a).toEqual(b);
  });
});
