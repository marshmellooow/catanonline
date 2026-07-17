import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/reducer.js';
import { chooseBotAction } from '../src/bot.js';
import { driveSetup } from './helpers/drive.js';
import { canAfford, COSTS } from '../src/logic.js';
import { emptyResources } from '../src/types.js';
import type { GameState } from '../src/types.js';

function newGame(): GameState {
  const s = createGame({
    mapId: 'classic',
    seed: 2024,
    players: Array.from({ length: 3 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, colorIndex: i, isBot: true,
    })),
  });
  s.order = s.players.map((p) => p.id);
  return s;
}

function mainGame(): GameState {
  const s = newGame();
  driveSetup(s);
  s.phase = 'main';
  s.hasRolled = true;
  s.activeIndex = 0;
  for (const p of s.players) p.resources = emptyResources();
  return s;
}

describe('Strategischer Abwurf', () => {
  it('behält bei genügend Überschuss exakt die Karten für die nächste Stadt', () => {
    const s = mainGame();
    const p0 = s.players.find((p) => p.id === 'p0')!;
    p0.resources = { wood: 0, brick: 0, wool: 3, grain: 4, ore: 3 };
    s.phase = 'discard';
    s.mustDiscard = { p0: 5 };
    const action = chooseBotAction(s, 'p0')!;
    expect(action.type).toBe('discard');
    expect('events' in applyAction(s, 'p0', action)).toBe(true);
    expect(canAfford(p0.resources, COSTS.city)).toBe(true);
    expect(p0.resources).toEqual({ wood: 0, brick: 0, wool: 0, grain: 2, ore: 3 });
  });

  it('wirft für einen nur übernommenen Menschensitz weiterhin neutral zufällig ab', () => {
    const s = mainGame();
    const p0 = s.players.find((p) => p.id === 'p0')!;
    p0.isBot = false;
    p0.resources = { wood: 2, brick: 2, wool: 2, grain: 2, ore: 2 };
    s.phase = 'discard';
    s.mustDiscard = { p0: 5 };
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'autoDiscard' });
  });
});

describe('Räuber-Zielwahl', () => {
  it('blockiert die starke gegnerische Stadt statt der ersten schwachen Siedlung', () => {
    const s = newGame();
    s.buildings = {};
    s.phase = 'moveRobber';
    s.activeIndex = 0;
    const desert = s.board.hexes.find((h) => h.terrain === 'D')!;
    const weak = s.board.hexes.find((h) => h.terrain !== 'W' && h.terrain !== 'D')!;
    const strong = s.board.hexes.find(
      (h) => h.terrain !== 'W' && h.terrain !== 'D'
        && h.id !== weak.id && !h.corners.some((c) => weak.corners.includes(c)),
    )!;
    s.robberHex = desert.id;
    weak.number = 2;
    strong.number = 6;
    s.buildings[weak.corners[0]] = { owner: 'p1', type: 'settlement' };
    s.buildings[strong.corners[0]] = { owner: 'p2', type: 'city' };
    s.players.find((p) => p.id === 'p1')!.resources.wood = 1;
    s.players.find((p) => p.id === 'p2')!.resources.wood = 1;
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'moveRobber', hex: strong.id });
  });

  it('bestiehlt bei mehreren Kandidaten den öffentlich stärkeren Gegner', () => {
    const s = newGame();
    s.buildings = {
      0: { owner: 'p1', type: 'settlement' },
      3: { owner: 'p2', type: 'city' },
    };
    s.phase = 'steal';
    s.activeIndex = 0;
    s.stealCandidates = ['p1', 'p2'];
    s.players.find((p) => p.id === 'p1')!.resources.wood = 1;
    s.players.find((p) => p.id === 'p2')!.resources.wood = 3;
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'steal', victim: 'p2' });
  });
});
