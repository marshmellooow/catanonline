import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/reducer.js';
import { chooseBotAction, botHasPendingAction } from '../src/bot.js';
import { emptyResources } from '../src/types.js';
import type { GameState } from '../src/types.js';
import type { ResourceType } from '../src/design.js';

/** Frisches Spiel, Setup übersprungen: direkt in die Hauptphase mit p0 am Zug. */
function mainPhaseGame(): GameState {
  const s = createGame({
    mapId: 'classic',
    seed: 7,
    players: [
      { id: 'p0', name: 'P0', colorIndex: 0 },
      { id: 'p1', name: 'P1', colorIndex: 1, isBot: true },
      { id: 'p2', name: 'P2', colorIndex: 2, isBot: true },
    ],
  });
  // Feste Zugreihenfolge p0,p1,p2 (der zufällige Start-Shuffle ist separat in
  // turn-order.test.ts getestet) → p0 ist zuverlässig am Zug, unabhängig vom Seed.
  s.order = s.players.map((p) => p.id);
  s.phase = 'main';
  s.activeIndex = 0;
  s.hasRolled = true;
  return s;
}

function setRes(s: GameState, id: string, r: Partial<Record<ResourceType, number>>): void {
  const p = s.players.find((x) => x.id === id)!;
  p.resources = { ...emptyResources(), ...r };
}

describe('Bot-Handel', () => {
  it('setzt Bot-Antworten auf „pending" statt sofort abzulehnen', () => {
    const s = mainPhaseGame();
    setRes(s, 'p0', { ore: 1 });
    setRes(s, 'p1', { wool: 1 });
    const r = applyAction(s, 'p0', { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
    expect('events' in r).toBe(true);
    expect(s.tradeOffer?.responses['p1']).toBe('pending');
    expect(s.tradeOffer?.responses['p2']).toBe('pending');
    expect(botHasPendingAction(s, 'p1')).toBe(true);
  });

  it('nimmt ein faires 1:1-Angebot an', () => {
    const s = mainPhaseGame();
    setRes(s, 'p0', { ore: 1 });
    setRes(s, 'p1', { wool: 1 });
    applyAction(s, 'p0', { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
    const a = chooseBotAction(s, 'p1');
    expect(a).toEqual({ type: 'respondTrade', offerId: s.tradeOffer!.id, accept: true });
  });

  it('lehnt ein unfaires Angebot ab (Bot gäbe mehr, als er bekäme)', () => {
    const s = mainPhaseGame();
    setRes(s, 'p0', { ore: 1 });
    setRes(s, 'p1', { wool: 2 });
    applyAction(s, 'p0', { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 2 } });
    const a = chooseBotAction(s, 'p1');
    expect(a).toEqual({ type: 'respondTrade', offerId: s.tradeOffer!.id, accept: false });
  });

  it('lehnt ab, wenn der Bot die geforderten Karten nicht hat', () => {
    const s = mainPhaseGame();
    setRes(s, 'p0', { ore: 1 });
    setRes(s, 'p1', {}); // p1 (getesteter Bot) hat keine Wolle
    setRes(s, 'p2', { wool: 1 }); // aber p2 hat welche → Angebot ist überhaupt zulässig
    applyAction(s, 'p0', { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
    const a = chooseBotAction(s, 'p1');
    expect(a).toEqual({ type: 'respondTrade', offerId: s.tradeOffer!.id, accept: false });
  });

  it('verhindert Angebote, die kein Mitspieler erfüllen kann', () => {
    const s = mainPhaseGame();
    setRes(s, 'p0', { ore: 1 });
    setRes(s, 'p1', { ore: 3 }); // niemand hat Getreide
    setRes(s, 'p2', { brick: 2 });
    const r = applyAction(s, 'p0', { type: 'proposeTrade', give: { ore: 1 }, get: { grain: 1 } });
    expect('error' in r).toBe(true);
    expect(s.tradeOffer).toBeNull();
    // Sobald ein Mitspieler den Rohstoff hat, geht es wieder.
    setRes(s, 'p2', { grain: 1 });
    const r2 = applyAction(s, 'p0', { type: 'proposeTrade', give: { ore: 1 }, get: { grain: 1 } });
    expect('events' in r2).toBe(true);
    expect(s.tradeOffer).not.toBeNull();
  });

  it('kompletter Ablauf: anbieten → Bot nimmt an → bestätigen bewegt Karten + Event', () => {
    const s = mainPhaseGame();
    setRes(s, 'p0', { ore: 1 });
    setRes(s, 'p1', { wool: 1 });
    applyAction(s, 'p0', { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
    const offerId = s.tradeOffer!.id;
    // Bot p1 antwortet (annehmen), p2 lehnt (nichts zu geben)
    applyAction(s, 'p1', chooseBotAction(s, 'p1')!);
    applyAction(s, 'p2', chooseBotAction(s, 'p2')!);
    expect(s.tradeOffer?.responses['p1']).toBe('accept');
    // Anbieter bestätigt
    const conf = applyAction(s, 'p0', { type: 'confirmTrade', offerId, withPlayer: 'p1' });
    expect('events' in conf).toBe(true);
    if ('events' in conf) expect(conf.events.some((e) => e.t === 'trade')).toBe(true);
    expect(s.tradeOffer).toBeNull();
    const p0 = s.players.find((p) => p.id === 'p0')!;
    const p1 = s.players.find((p) => p.id === 'p1')!;
    expect(p0.resources.ore).toBe(0);
    expect(p0.resources.wool).toBe(1);
    expect(p1.resources.wool).toBe(0);
    expect(p1.resources.ore).toBe(1);
  });
});
