import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/reducer.js';
import { chooseBotAction } from '../src/bot.js';
import type { GameState } from '../src/types.js';
import { RESOURCES } from '../src/design.js';

function newGame(players = 3): GameState {
  const g = createGame({ mapId: 'classic', seed: 11, players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i })) });
  // feste Zugreihenfolge p0,p1,… (der zufällige Start-Shuffle ist separat getestet)
  g.order = g.players.map((p) => p.id);
  return g;
}
function driveSetup(s: GameState) {
  let g = 0;
  while ((s.phase === 'setupSettlement' || s.phase === 'setupRoad') && g++ < 200) {
    const a = chooseBotAction(s, s.order[s.activeIndex])!;
    applyAction(s, s.order[s.activeIndex], a);
  }
}
const total = (s: GameState) => {
  let sum = RESOURCES.reduce((a, r) => a + s.bank[r], 0);
  for (const p of s.players) sum += RESOURCES.reduce((a, r) => a + p.resources[r], 0);
  return sum;
};

describe('Manipulierte Eingaben (Trust-Boundary)', () => {
  it('proposeTrade mit negativer Menge erzeugt keine Karten', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.players[0].resources = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    s.players[1].resources = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 1 };
    const before = total(s);
    const r = applyAction(s, 'p0', { type: 'proposeTrade', give: { wood: -8 } as never, get: { ore: 1 } });
    expect('error' in r).toBe(true);
    expect(s.tradeOffer).toBeNull();
    expect(s.players[0].resources.wood).toBe(0);
    expect(total(s)).toBe(before);
  });

  it('discard mit negativer Menge erzeugt keine Karten und korrumpiert die Bank nicht', () => {
    const s = newGame(3);
    driveSetup(s);
    s.players[1].resources = { wood: 0, brick: 10, wool: 0, grain: 0, ore: 0 };
    s.phase = 'discard';
    s.mustDiscard = { p1: 4 };
    const bankBefore = { ...s.bank };
    const before = total(s);
    const r = applyAction(s, 'p1', { type: 'discard', resources: { wood: -3, brick: 7 } as never });
    expect('error' in r).toBe(true); // sanitisiert {wood:0,brick:7} → Summe 7 ≠ 4
    expect(s.players[1].resources.wood).toBe(0);
    expect(s.bank).toEqual(bankBefore);
    expect(total(s)).toBe(before);
  });

  it('bankTrade / Monopol / Erfindung mit ungültigem Rohstoff werden abgelehnt', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.players[0].resources = { wood: 4, brick: 0, wool: 0, grain: 0, ore: 0 };
    s.players[0].devCards.monopoly = 1;
    s.players[0].devCards.yearOfPlenty = 1;
    expect('error' in applyAction(s, 'p0', { type: 'bankTrade', give: 'gold' as never, get: 'ore' })).toBe(true);
    expect('error' in applyAction(s, 'p0', { type: 'playMonopoly', resource: 'gold' as never })).toBe(true);
    expect('error' in applyAction(s, 'p0', { type: 'playYearOfPlenty', resources: ['gold' as never, 'ore' as never] })).toBe(true);
    // Karten/Bestände unverändert
    expect(s.players[0].resources.wood).toBe(4);
    expect(s.players[0].devCards.monopoly).toBe(1);
    expect(s.players[0].devCards.yearOfPlenty).toBe(1);
  });

  it('gemischtes negatives Angebot wird geklemmt (kein Minting)', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.players[0].resources = { wood: 0, brick: 1, wool: 0, grain: 0, ore: 0 };
    s.players[1].resources = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 1 };
    applyAction(s, 'p0', { type: 'proposeTrade', give: { wood: -8, brick: 1 } as never, get: { ore: 1 } });
    // Angebot gespeichert, aber Holz auf 0 geklemmt
    expect(s.tradeOffer?.give).toEqual({ wood: 0, brick: 1, wool: 0, grain: 0, ore: 0 });
    applyAction(s, 'p1', { type: 'respondTrade', offerId: s.tradeOffer!.id, accept: true });
    const before = total(s);
    applyAction(s, 'p0', { type: 'confirmTrade', offerId: s.tradeOffer!.id, withPlayer: 'p1' });
    expect(s.players[0].resources.wood).toBe(0); // kein erzeugtes Holz
    expect(total(s)).toBe(before);
  });
});
