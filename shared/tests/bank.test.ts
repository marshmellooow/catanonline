import { describe, it, expect } from 'vitest';
import { createGame, bankOf } from '../src/setup.js';
import type { GameState } from '../src/types.js';
import { produceResources } from '../src/logic.js';
import { applyAction } from '../src/reducer.js';
import { chooseBotAction } from '../src/bot.js';
import { nextAutoActor } from './helpers/drive.js';
import { TERRAIN_RESOURCE, RESOURCES } from '../src/design.js';

function newGame(bankSize?: number, players = 3): GameState {
  return createGame({
    mapId: 'classic',
    seed: 55,
    bankSize,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i })),
  });
}

describe('Bank-Größe', () => {
  it('setzt den Startbestand je Rohstoff', () => {
    const s = newGame(10);
    expect(s.bank).toEqual({ wood: 10, brick: 10, wool: 10, grain: 10, ore: 10 });
  });
  it('Standard 19, geklemmt auf 3–50', () => {
    expect(bankOf(undefined).wood).toBe(19);
    expect(bankOf(1).wood).toBe(3);
    expect(bankOf(999).wood).toBe(50);
  });
});

describe('Knappheitsregel', () => {
  it('leere Bank → niemand bekommt diesen Rohstoff', () => {
    const s = newGame(19);
    const hex = s.board.hexes.find((h) => h.number === 5 && TERRAIN_RESOURCE[h.terrain])!;
    const res = TERRAIN_RESOURCE[hex.terrain]!;
    s.buildings[hex.corners[0]] = { owner: 'p0', type: 'settlement' };
    s.bank[res] = 0; // Bank leer
    produceResources(s, 5);
    expect(s.players[0].resources[res]).toBe(0);
  });

  it('mehrere Empfänger + zu wenig Bank → niemand bekommt (offizielle Regel)', () => {
    const s = newGame(19);
    const hex = s.board.hexes.find((h) => h.number === 5 && TERRAIN_RESOURCE[h.terrain])!;
    const res = TERRAIN_RESOURCE[hex.terrain]!;
    s.buildings[hex.corners[0]] = { owner: 'p0', type: 'settlement' };
    s.buildings[hex.corners[2]] = { owner: 'p1', type: 'settlement' };
    s.bank[res] = 1; // nur 1, aber 2 fordern
    produceResources(s, 5);
    expect(s.players[0].resources[res]).toBe(0);
    expect(s.players[1].resources[res]).toBe(0);
    expect(s.bank[res]).toBe(1);
  });

  it('genau ein Empfänger → bekommt den Rest der Bank', () => {
    const s = newGame(19);
    const hex = s.board.hexes.find((h) => h.number === 5 && TERRAIN_RESOURCE[h.terrain])!;
    const res = TERRAIN_RESOURCE[hex.terrain]!;
    s.buildings[hex.corners[0]] = { owner: 'p0', type: 'city' }; // fordert 2
    s.bank[res] = 1; // nur 1 da
    produceResources(s, 5);
    expect(s.players[0].resources[res]).toBe(1);
    expect(s.bank[res]).toBe(0);
  });
});

describe('Kartenerhaltung', () => {
  it('Bank + alle Hände = 5 × Bankgröße — invariant bei jeder Aktion eines ganzen Spiels', () => {
    const bankSize = 12;
    const s = createGame({
      mapId: 'classic',
      seed: 7,
      bankSize,
      players: [0, 1, 2].map((i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i, isBot: true })),
    });
    const EXPECT = 5 * bankSize;
    const total = () => {
      let sum = RESOURCES.reduce((a, r) => a + s.bank[r], 0);
      for (const p of s.players) sum += RESOURCES.reduce((a, r) => a + p.resources[r], 0);
      return sum;
    };
    expect(total()).toBe(EXPECT);

    let guard = 0;
    while ((s.phase === 'setupSettlement' || s.phase === 'setupRoad') && guard++ < 200) {
      const actor = s.order[s.activeIndex];
      applyAction(s, actor, chooseBotAction(s, actor)!);
      expect(total()).toBe(EXPECT);
    }
    for (let i = 0; i < 400 && !s.winner; i++) {
      // nextAutoActor statt order[activeIndex]: seit der Bot selbst Handel anbietet, wäre
      // „immer der Aktive" falsch — der Anbieter löste sein Angebot auf, bevor jemand
      // geantwortet hat, und der Handelspfad bliebe ungetestet.
      const actor = nextAutoActor(s);
      if (!actor) throw new Error('Kein Akteur in ' + s.phase);
      const a = chooseBotAction(s, actor);
      if (!a) throw new Error('Bot stecken geblieben in ' + s.phase);
      const r = applyAction(s, actor, a);
      if ('error' in r) throw new Error('Fehler: ' + r.error);
      expect(total()).toBe(EXPECT); // keine Karte darf verschwinden oder entstehen
    }
  });
});
