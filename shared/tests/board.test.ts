import { describe, it, expect } from 'vitest';
import { buildBoard, initialRobberHex } from '../src/board.js';

describe('Board-Geometrie', () => {
  it('Klassik hat 19 Felder, 54 Ecken, 72 Kanten', () => {
    const b = buildBoard('classic', 12345);
    expect(b.hexes.length).toBe(19);
    expect(b.corners.length).toBe(54);
    expect(b.edges.length).toBe(72);
  });

  it('Räuber startet auf der Wüste', () => {
    const b = buildBoard('classic', 1);
    const robber = initialRobberHex(b);
    expect(b.hexes[robber].terrain).toBe('D');
  });

  it('jede Ecke berührt 1–3 Felder, jede Kante genau 1–2', () => {
    const b = buildBoard('classic', 7);
    for (const c of b.corners) {
      expect(c.hexes.length).toBeGreaterThanOrEqual(1);
      expect(c.hexes.length).toBeLessThanOrEqual(3);
    }
    for (const e of b.edges) {
      expect(e.hexes.length).toBeGreaterThanOrEqual(1);
      expect(e.hexes.length).toBeLessThanOrEqual(2);
    }
  });

  it('Ecken-Nachbarschaft ist symmetrisch und über Kanten konsistent', () => {
    const b = buildBoard('classic', 3);
    for (const c of b.corners) {
      for (const adj of c.adjacent) {
        expect(b.corners[adj].adjacent).toContain(c.id);
      }
      // jede benachbarte Ecke hat eine gemeinsame Kante
      for (const adj of c.adjacent) {
        const shared = c.edges.some((eid) => {
          const e = b.edges[eid];
          return e.a === adj || e.b === adj;
        });
        expect(shared).toBe(true);
      }
    }
  });

  it('Klassik-Zahlen: 6 und 8 nie benachbart', () => {
    const b = buildBoard('classic', 999);
    const hot = (n: number | null) => n === 6 || n === 8;
    for (const hex of b.hexes) {
      if (!hot(hex.number)) continue;
      for (const nb of hex.neighbors) {
        expect(hot(b.hexes[nb].number)).toBe(false);
      }
    }
  });

  it('Zufallskarte respektiert die 6/8-Regel und hat 1 Wüste', () => {
    const b = buildBoard('random', 42);
    expect(b.hexes.filter((h) => h.terrain === 'D').length).toBe(1);
    const hot = (n: number | null) => n === 6 || n === 8;
    for (const hex of b.hexes) {
      if (!hot(hex.number)) continue;
      for (const nb of hex.neighbors) {
        expect(hot(b.hexes[nb].number)).toBe(false);
      }
    }
  });

  it('alle 5 Karten bauen fehlerfrei', () => {
    for (const id of ['classic', 'coast', 'continent', 'lakes', 'harbor']) {
      const b = buildBoard(id, 5);
      expect(b.hexes.length).toBeGreaterThan(0);
      expect(b.corners.length).toBeGreaterThan(0);
    }
    const harbor = buildBoard('harbor', 5);
    expect(harbor.ports.length).toBe(10);
    // jeder Hafen hat 1–2 zugeordnete Ecken
    for (const p of harbor.ports) expect(p.corners.length).toBeGreaterThanOrEqual(1);
  });
});
