import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/reducer.js';
import { chooseBotAction } from '../src/bot.js';
import { victoryPoints } from '../src/logic.js';
import { RESOURCES } from '../src/design.js';
import { emptyResources } from '../src/types.js';
import { driveSetup, driveGame, nextAutoActor } from './helpers/drive.js';
import type { GameState } from '../src/types.js';

const LIMIT = 5000;

function botGame(seed: number, players = 4, mapId = 'classic', bankSize?: number): GameState {
  const s = createGame({
    mapId,
    seed,
    ...(bankSize !== undefined ? { bankSize } : {}),
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i, isBot: true })),
  });
  return s;
}

describe('Vier-Bot-Spiel findet einen Sieger', () => {
  // DAS ist der Kernbeweis dieses Umbaus: früher passte der Bot in der Hauptphase nur
  // (`case 'main': return endTurn`), ein Spiel konnte also gar nicht enden. Ein Solospiel
  // gegen Bots war damit kein Spiel.
  it.each([1, 2, 3, 7, 42, 2024])('Seed %i', (seed) => {
    const s = botGame(seed);
    driveSetup(s);
    const { steps } = driveGame(s, LIMIT);
    expect(s.winner, `kein Sieger nach ${steps} Aktionen (Zug ${s.turnCount})`).not.toBeNull();
    expect(s.phase).toBe('finished');
    const winner = s.players.find((p) => p.id === s.winner)!;
    expect(victoryPoints(s, winner, true)).toBeGreaterThanOrEqual(s.vpTarget);
  });

  it('auch auf den Wasser-Karten', () => {
    for (const mapId of ['coast', 'harbor', 'lakes', 'continent']) {
      const s = botGame(7, 4, mapId);
      driveSetup(s);
      driveGame(s, LIMIT);
      expect(s.winner, `${mapId}: kein Sieger`).not.toBeNull();
    }
  });
});

describe('Terminierung', () => {
  it('kein Zug braucht mehr als 40 Aktionen', () => {
    // Direktes Maß für das Terminierungs-Argument: jede Sprosse der Leiter verkleinert
    // ein monoton fallendes Maß oder verbraucht ein Budget — es gibt keinen Zyklus.
    for (const seed of [1, 42, 2024]) {
      const s = botGame(seed);
      driveSetup(s);
      const { maxActionsPerTurn } = driveGame(s, LIMIT);
      expect(maxActionsPerTurn, `Seed ${seed}`).toBeGreaterThan(0);
      expect(maxActionsPerTurn, `Seed ${seed}: Zug mit ${maxActionsPerTurn} Aktionen`).toBeLessThanOrEqual(40);
    }
  });

  it('höchstens ein Handelsangebot pro Zug', () => {
    for (const seed of [1, 42, 2024]) {
      const s = botGame(seed);
      driveSetup(s);
      const { maxOffersPerTurn } = driveGame(s, LIMIT);
      expect(maxOffersPerTurn, `Seed ${seed}`).toBeLessThanOrEqual(1);
    }
  });

  it('der Zug endet auch ohne jeden Rohstoff', () => {
    const s = botGame(7);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    for (const p of s.players) p.resources = emptyResources();
    expect(chooseBotAction(s, s.order[s.activeIndex])).toEqual({ type: 'endTurn' });
  });
});

describe('Invarianten über ein ganzes Spiel', () => {
  it('kein Reducer-Fehler, kein Stillstand — bis zum Sieg', () => {
    // driveGame wirft bei 'error' oder null. Dass es durchläuft, IST die Zusage:
    // eine abgelehnte Bot-Aktion würde den botTick alle 700 ms endlos wiederholen.
    for (const seed of [1, 42, 2024]) {
      const s = botGame(seed);
      driveSetup(s);
      expect(() => driveGame(s, LIMIT)).not.toThrow();
      expect(s.winner).not.toBeNull();
    }
  });

  it('Kartenerhaltung: Bank + alle Hände bleiben konstant — nach JEDER Aktion bis zum Sieg', () => {
    const bankSize = 19;
    const s = botGame(2024, 4, 'classic', bankSize);
    const EXPECT = 5 * bankSize;
    const total = (): number => {
      let sum = RESOURCES.reduce((a, r) => a + s.bank[r], 0);
      for (const p of s.players) sum += RESOURCES.reduce((a, r) => a + p.resources[r], 0);
      return sum;
    };
    expect(total()).toBe(EXPECT);
    driveSetup(s);
    expect(total()).toBe(EXPECT);
    driveGame(s, LIMIT, () => {
      expect(total()).toBe(EXPECT); // keine Karte darf entstehen oder verschwinden
    });
    expect(s.winner).not.toBeNull();
    // Und keine Hand darf je negativ werden (Bank-Korruption).
    for (const p of s.players) for (const r of RESOURCES) expect(p.resources[r]).toBeGreaterThanOrEqual(0);
    for (const r of RESOURCES) expect(s.bank[r]).toBeGreaterThanOrEqual(0);
  });

  it('Determinismus: gleicher Seed → identischer Endzustand', () => {
    const run = (): string => {
      const s = botGame(2024);
      driveSetup(s);
      driveGame(s, LIMIT);
      return JSON.stringify({
        winner: s.winner,
        turnCount: s.turnCount,
        buildings: s.buildings,
        roads: s.roads,
        bank: s.bank,
        hands: s.players.map((p) => p.resources),
        knights: s.players.map((p) => p.playedKnights),
        longestRoad: [s.longestRoadHolder, s.longestRoadLength],
        largestArmy: [s.largestArmyHolder, s.largestArmySize],
        tradeSeq: s.tradeSeq,
      });
    };
    expect(run()).toBe(run());
  });
});

describe('nextAutoActor spiegelt die Server-Reihenfolge', () => {
  it('Abwurf vor Angebot vor aktivem Zug; Anbieter erst, wenn alle geantwortet haben', () => {
    const s = botGame(7, 3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.activeIndex = 0;
    s.players[0].resources = { ...emptyResources(), ore: 1 };
    s.players[1].resources = { ...emptyResources(), wool: 1 };
    applyAction(s, s.order[0], { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
    // Offenes Angebot → zuerst die Antwortenden, nicht der Anbieter.
    expect(nextAutoActor(s)).not.toBe(s.order[0]);
    applyAction(s, s.order[1], chooseBotAction(s, s.order[1])!);
    applyAction(s, s.order[2], chooseBotAction(s, s.order[2])!);
    // Jetzt haben alle geantwortet → der Anbieter löst auf.
    expect(nextAutoActor(s)).toBe(s.order[0]);
    // Abwurf hat Vorrang vor allem anderen.
    s.phase = 'discard';
    s.mustDiscard = { [s.order[2]]: 4 };
    expect(nextAutoActor(s)).toBe(s.order[2]);
  });
});
