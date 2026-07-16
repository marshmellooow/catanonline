import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';

const mkPlayers = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i }));

describe('Startreihenfolge (bei Spielstart einmal zufällig ausgelost)', () => {
  it('order ist eine vollständige Permutation aller Spieler-IDs; activeIndex startet bei 0', () => {
    const g = createGame({ mapId: 'classic', seed: 7, players: mkPlayers(4) });
    expect([...g.order].sort()).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(new Set(g.order).size).toBe(4);
    expect(g.activeIndex).toBe(0);
  });

  it('deterministisch: gleicher Seed → gleiche Reihenfolge', () => {
    const a = createGame({ mapId: 'classic', seed: 42, players: mkPlayers(5) });
    const b = createGame({ mapId: 'classic', seed: 42, players: mkPlayers(5) });
    expect(a.order).toEqual(b.order);
  });

  it('wird wirklich gemischt: der Startspieler variiert über Seeds', () => {
    const firsts = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) firsts.add(createGame({ mapId: 'classic', seed, players: mkPlayers(4) }).order[0]);
    expect(firsts.size).toBeGreaterThanOrEqual(3); // mehrere verschiedene Startspieler
  });

  it('Order-Shuffle nutzt einen eigenen RNG-Strom → Dev-Deck (Haupt-RNG) bleibt unberührt', () => {
    // Dev-Deck hängt nur am Seed (vor dem Order-Shuffle), nicht an der Spielerzahl.
    const g1 = createGame({ mapId: 'classic', seed: 99, players: mkPlayers(3) });
    const g2 = createGame({ mapId: 'classic', seed: 99, players: mkPlayers(4) });
    expect(g1.devDeck).toEqual(g2.devDeck);
  });
});
