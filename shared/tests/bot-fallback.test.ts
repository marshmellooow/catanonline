import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/reducer.js';
import { chooseBotAction, fallbackAction } from '../src/bot.js';
import { driveSetup } from './helpers/drive.js';
import { emptyResources } from '../src/types.js';
import type { GameState } from '../src/types.js';
import type { ResourceType } from '../src/design.js';

function newGame(players = 3): GameState {
  const g = createGame({
    mapId: 'classic',
    seed: 2024,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i })),
  });
  g.order = g.players.map((p) => p.id);
  return g;
}


function setRes(s: GameState, id: string, r: Partial<Record<ResourceType, number>>): void {
  s.players.find((x) => x.id === id)!.resources = { ...emptyResources(), ...r };
}

describe('fallbackAction — Notausgang gegen die Endlosschleife', () => {
  it('Anbieter → cancelTrade (auch bei offenem Gegenangebot)', () => {
    const s = newGame();
    s.phase = 'main';
    s.hasRolled = true;
    setRes(s, 'p0', { ore: 1 });
    setRes(s, 'p1', { wool: 1 });
    applyAction(s, 'p0', { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
    applyAction(s, 'p1', { type: 'counterTrade', offerId: s.tradeOffer!.id, give: { wool: 1 }, get: { ore: 1 } });
    expect(fallbackAction(s, 'p0')).toEqual({ type: 'cancelTrade' });
  });

  it('offener Empfänger → respondTrade(false)', () => {
    const s = newGame();
    s.phase = 'main';
    s.hasRolled = true;
    setRes(s, 'p0', { ore: 1 });
    setRes(s, 'p1', { wool: 1 });
    applyAction(s, 'p0', { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
    expect(fallbackAction(s, 'p1')).toEqual({ type: 'respondTrade', offerId: s.tradeOffer!.id, accept: false });
  });

  it('Abwurf-Phase → autoDiscard, aber nur für Betroffene', () => {
    const s = newGame();
    s.phase = 'discard';
    s.mustDiscard = { p1: 4 };
    setRes(s, 'p1', { wood: 8 });
    expect(fallbackAction(s, 'p1')).toEqual({ type: 'autoDiscard' });
    expect(fallbackAction(s, 'p0')).toBeNull();
  });

  it('main + am Zug → endTurn, sonst null', () => {
    const s = newGame();
    s.phase = 'main';
    s.hasRolled = true;
    expect(fallbackAction(s, 'p0')).toEqual({ type: 'endTurn' });
    expect(fallbackAction(s, 'p1')).toBeNull();
  });

  it('nach dem Sieg keine Notaktion mehr', () => {
    const s = newGame();
    s.phase = 'main';
    s.winner = 'p0';
    expect(fallbackAction(s, 'p0')).toBeNull();
  });

  it('Fuzz: über ein ganzes Bot-Spiel liefert fallbackAction nur reducer-gültige Aktionen', () => {
    // Der Sinn des Netzes ist, dass es IMMER greift. Ein Notausgang, den der Reducer
    // selbst ablehnt, wäre schlimmer als keiner — dann liefe die Schleife trotzdem.
    const s = newGame(4);
    s.players.forEach((p) => (p.isBot = true));
    driveSetup(s);
    let checked = 0;
    for (let step = 0; step < 400 && !s.winner; step++) {
      for (const p of s.players) {
        const fb = fallbackAction(s, p.id);
        if (!fb) continue;
        // Auf einem Klon prüfen, damit der echte Spielverlauf unberührt bleibt.
        const clone: GameState = structuredClone(s);
        const r = applyAction(clone, p.id, fb);
        expect('events' in r, `${fb.type} für ${p.id} in Phase ${s.phase} abgelehnt`).toBe(true);
        checked++;
      }
      const actor = s.phase === 'discard' ? Object.keys(s.mustDiscard)[0] : s.order[s.activeIndex];
      const a = chooseBotAction(s, actor);
      if (!a) break;
      applyAction(s, actor, a);
    }
    expect(checked).toBeGreaterThan(50); // der Fuzz hat wirklich etwas geprüft
  });
});

describe('roadBuilding-Phase liefert nie endTurn', () => {
  it('endTurn wäre hier ein garantierter Reducer-Fehler → Endlosschleife', () => {
    const s = newGame();
    s.players.forEach((p) => (p.isBot = true));
    driveSetup(s);
    // Bewusst auf den Union-Typ geweitet: sonst nagelt die Kontrollfluss-Analyse
    // `s.phase` auf 'main' fest und hält den Schleifen-Vergleich unten für
    // unmöglich — dass `applyAction` die Phase mutiert, sieht sie nicht.
    s.phase = 'main' as GameState['phase'];
    s.hasRolled = true;
    s.activeIndex = 0;
    const p0 = s.players.find((p) => p.id === 'p0')!;
    p0.devCards.roadBuilding = 1;
    const r = applyAction(s, 'p0', { type: 'playRoadBuilding' });
    expect('events' in r).toBe(true);
    expect(s.phase).toBe('roadBuilding'); // sonst prüfte die Schleife unten gar nichts
    // Solange die Karte läuft, muss jede Bot-Aktion vom Reducer akzeptiert werden.
    let built = 0;
    while (s.phase === 'roadBuilding' && built < 5) {
      const a = chooseBotAction(s, 'p0');
      expect(a).not.toEqual({ type: 'endTurn' });
      if (!a) break;
      expect('events' in applyAction(s, 'p0', a)).toBe(true);
      built++;
    }
    expect(built).toBe(2); // beide Gratis-Straßen wirklich gebaut
    expect(s.phase).toBe('main'); // Reducer hat selbst zurückgeschaltet
  });
});
