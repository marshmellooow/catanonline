import { describe, it, expect } from 'vitest';
import { buildBoard } from '../src/board.js';
import { getMap } from '../src/maps.js';

const WATER_MAPS = ['coast', 'lakes', 'harbor'];
const LAND_MAPS = ['classic', 'continent'];
const PORT_TYPES = ['3:1', 'wood', 'brick', 'wool', 'grain', 'ore'];

describe('Küstenhäfen (prozedural, seed-basiert)', () => {
  it('Wasser-Karten bekommen Häfen, reine Land-Karten nicht', () => {
    for (const id of WATER_MAPS) {
      expect(buildBoard(id, 42).ports.length, `${id} sollte Häfen haben`).toBeGreaterThan(0);
    }
    for (const id of LAND_MAPS) {
      expect(buildBoard(id, 42).ports.length, `${id} (kein Wasser) sollte keine Häfen haben`).toBe(0);
    }
    // Zufallskarte = reine Klassik-Form (kein Wasser) → keine Häfen
    expect(buildBoard('random', 42).ports.length).toBe(0);
  });

  it('jeder Hafen: genau 2 gültige Küsten-Ecken (Land+Wasser), keine geteilten Ecken, portId gesetzt', () => {
    for (const id of WATER_MAPS) {
      const b = buildBoard(id, 7);
      const isWater = (hid: number) => b.hexes[hid].terrain === 'W';
      const usedCorners = new Set<number>();
      for (const p of b.ports) {
        expect(p.corners.length).toBe(2);
        expect(PORT_TYPES).toContain(p.type);
        for (const cid of p.corners) {
          const c = b.corners[cid];
          expect(c).toBeTruthy();
          // Küsten-Ecke berührt Land UND Wasser
          expect(c.hexes.some((h) => !isWater(h))).toBe(true);
          expect(c.hexes.some((h) => isWater(h))).toBe(true);
          // keine zwei Häfen an derselben Ecke (Streuung)
          expect(usedCorners.has(cid)).toBe(false);
          usedCorners.add(cid);
          // Ecke verweist auf genau diesen Hafen
          expect(c.portId).toBe(p.id);
        }
      }
    }
  });

  it('Hafen-Typen sind gemischt (mind. ein 3:1 und ein Rohstoff-Hafen auf großer Karte)', () => {
    const b = buildBoard('harbor', 3);
    const types = new Set(b.ports.map((p) => p.type));
    expect(b.ports.length).toBeGreaterThanOrEqual(5);
    expect(types.has('3:1')).toBe(true);
    expect([...types].some((t) => t !== '3:1')).toBe(true);
  });

  it('Häfen stapeln sich nicht — Plaketten überlappen nie (max. 1 Hafen je Wasser-Hex)', () => {
    for (const id of WATER_MAPS) {
      const plateW = getMap(id)!.hexW * 0.74; // Plakettenbreite (größte Dimension)
      for (const seed of [1, 2, 28, 55, 77]) {
        const b = buildBoard(id, seed);
        for (let i = 0; i < b.ports.length; i++) {
          for (let j = i + 1; j < b.ports.length; j++) {
            const d = Math.hypot(b.ports[i].x - b.ports[j].x, b.ports[i].y - b.ports[j].y);
            // Abstand ≥ Plakettenbreite ⇒ keine Überlappung (Plakette ist breiter als hoch)
            expect(d, `${id} seed ${seed}: Häfen ${i}&${j} überlappen (${d.toFixed(0)}px < ${plateW.toFixed(0)})`).toBeGreaterThanOrEqual(plateW);
          }
        }
      }
    }
  });

  it('deterministisch: gleicher Seed → identische Häfen; anderer Seed → andere', () => {
    expect(JSON.stringify(buildBoard('harbor', 123).ports)).toBe(JSON.stringify(buildBoard('harbor', 123).ports));
    expect(JSON.stringify(buildBoard('harbor', 999).ports)).not.toBe(JSON.stringify(buildBoard('harbor', 123).ports));
  });

  it('Hafen-Plaketten liegen innerhalb der Board-Grenzen', () => {
    const b = buildBoard('coast', 5);
    for (const p of b.ports) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(b.width);
      expect(p.y).toBeLessThanOrEqual(b.height);
    }
  });
});
