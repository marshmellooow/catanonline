import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { victoryPointBreakdown } from '../src/logic.js';
import { toPublicState } from '../src/view.js';
import type { GameState } from '../src/types.js';

function newGame(players = 3): GameState {
  return createGame({
    mapId: 'classic',
    seed: 100,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i })),
  });
}

describe('victoryPointBreakdown', () => {
  it('summiert genau wie victoryPoints und schlüsselt jede Quelle auf', () => {
    const s = newGame();
    const p = s.players[0];
    s.buildings[0] = { owner: 'p0', type: 'settlement' };
    s.buildings[2] = { owner: 'p0', type: 'city' };
    s.longestRoadHolder = 'p0';
    s.largestArmyHolder = 'p0';
    p.devCards.victoryPoint = 1;
    p.newDevCards.victoryPoint = 1;

    const b = victoryPointBreakdown(s, p, true);
    expect(b).toEqual({ settlements: 1, cities: 1, longestRoad: true, largestArmy: true, hidden: 2, total: 1 + 2 + 2 + 2 + 2 });

    // Ohne verdeckte Karten fehlen genau die 2 hidden.
    const noHidden = victoryPointBreakdown(s, p, false);
    expect(noHidden.hidden).toBe(0);
    expect(noHidden.total).toBe(b.total - 2);
  });
});

describe('toPublicState: Aufschlüsselung & Datenschutz', () => {
  it('während des Spiels: nur die EIGENE Aufschlüsselung, fremde SP-Karten bleiben geheim', () => {
    const s = newGame();
    s.players[1].devCards.victoryPoint = 2; // p1 hat 2 verdeckte SP-Karten

    const asP0 = toPublicState(s, 'p0');
    const p0self = asP0.players.find((x) => x.id === 'p0')!;
    const p1seen = asP0.players.find((x) => x.id === 'p1')!;

    expect(p0self.vpBreakdown).toBeDefined(); // eigene: ja
    expect(p1seen.vpBreakdown).toBeUndefined(); // fremde: nein
    expect(p1seen.victoryPoints).toBe(0); // die 2 verdeckten Karten sind NICHT sichtbar
  });

  it('nach dem Sieg: Aufschlüsselung ALLER Spieler inkl. bis dahin verdeckter SP-Karten', () => {
    const s = newGame();
    s.players[1].devCards.victoryPoint = 2;
    s.winner = 'p2';

    const asP0 = toPublicState(s, 'p0');
    const p1seen = asP0.players.find((x) => x.id === 'p1')!;
    expect(p1seen.vpBreakdown).toBeDefined(); // jetzt für alle sichtbar
    expect(p1seen.vpBreakdown!.hidden).toBe(2);
    expect(p1seen.victoryPoints).toBe(2); // die verdeckten Karten zählen jetzt öffentlich
  });

  it('Sieger mit verdeckter SP-Karte erreicht das Ziel auch in fremder Sicht', () => {
    // Das war der Bug: ohne Aufdecken zeigte das Overlay den Gewinner bei anderen mit
    // weniger Punkten als dem Ziel, weil seine verdeckte Karte für sie nicht zählte.
    const s = newGame();
    s.vpTarget = 4;
    // p2 hat 3 Siedlungen (3 SP) + 1 verdeckte SP-Karte = 4.
    s.buildings[0] = { owner: 'p2', type: 'settlement' };
    s.buildings[3] = { owner: 'p2', type: 'settlement' };
    s.buildings[6] = { owner: 'p2', type: 'settlement' };
    s.players[2].devCards.victoryPoint = 1;
    s.winner = 'p2';

    const winnerSeenByP0 = toPublicState(s, 'p0').players.find((x) => x.id === 'p2')!;
    expect(winnerSeenByP0.victoryPoints).toBeGreaterThanOrEqual(s.vpTarget);
    expect(winnerSeenByP0.vpBreakdown!.hidden).toBe(1);
  });
});
