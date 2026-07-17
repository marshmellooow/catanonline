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

describe('Bot + Gegenangebot', () => {
  /** p1 (Bot) hat den Anbieter-Sitz geerbt und p0 (Mensch) hat gekontert. */
  function botOfferWithCounter(counterGive: Partial<Record<ResourceType, number>>, counterGet: Partial<Record<ResourceType, number>>): GameState {
    const s = mainPhaseGame();
    setRes(s, 'p1', { ore: 2, wool: 2 });
    setRes(s, 'p0', { wood: 3, grain: 3 });
    // Angebot im Namen von p1 (so, als hätte der Bot den Sitz übernommen)
    s.activeIndex = 1;
    applyAction(s, 'p1', { type: 'proposeTrade', give: { ore: 1 }, get: { wood: 1 } });
    applyAction(s, 'p0', { type: 'counterTrade', offerId: s.tradeOffer!.id, give: counterGive, get: counterGet });
    return s;
  }

  it('Gegenangebote werden NIE automatisch angenommen — auch nicht ein „faires"', () => {
    // Dieser Zweig läuft über room.ts::enforceTurn auch für einen verbundenen MENSCHEN,
    // dessen Zugzeit abläuft. Vom Gegner diktierte Konditionen dürfen niemandem
    // ungefragt die Karten tauschen (die Fairness-Schranke zählt nur Anzahl, nicht Wert:
    // ein Gegner könnte gezielt die letzte gebrauchte Karte gegen Ballast abziehen).
    const cases: Array<[Partial<Record<ResourceType, number>>, Partial<Record<ResourceType, number>>]> = [
      [{ grain: 2 }, { ore: 1 }], // „fair" (Gewinn 2 > Kosten 1) — trotzdem NICHT annehmen
      [{ grain: 3 }, { wool: 2 }], // „fair", anderer Rohstoff
      [{ grain: 1 }, { ore: 2 }], // unfair
    ];
    for (const [g, t] of cases) {
      const s = botOfferWithCounter(g, t);
      const before = { ...s.players.find((p) => p.id === 'p1')!.resources };
      const a = chooseBotAction(s, 'p1');
      expect(a, `Konter ${JSON.stringify(g)}→${JSON.stringify(t)}`).toEqual({ type: 'cancelTrade' });
      expect('events' in applyAction(s, 'p1', a!)).toBe(true); // Reducer akzeptiert → kein Endlos-Tick
      expect(s.players.find((p) => p.id === 'p1')!.resources).toEqual(before); // keine Karte bewegt
      expect(s.tradeOffer).toBeNull();
    }
  });

  it('kein Endlos-Tick: veraltetes „accept" (Partner hat die Karten nicht mehr) → cancelTrade', () => {
    // Sonst liefert der Bot ewig ein confirmTrade, das der Reducer ablehnt → botTick/
    // enforceTurn wiederholen es alle 700 ms, der Zug endet nie.
    const s = mainPhaseGame();
    s.activeIndex = 1;
    setRes(s, 'p1', { ore: 1 });
    setRes(s, 'p0', { wood: 1 });
    applyAction(s, 'p1', { type: 'proposeTrade', give: { ore: 1 }, get: { wood: 1 } });
    applyAction(s, 'p0', { type: 'respondTrade', offerId: s.tradeOffer!.id, accept: true });
    setRes(s, 'p0', {}); // p0 verliert das Holz nachträglich (Bauen/Monopol/Räuber)
    const a = chooseBotAction(s, 'p1');
    expect(a).toEqual({ type: 'cancelTrade' });
    expect('events' in applyAction(s, 'p1', a!)).toBe(true);
    expect(s.tradeOffer).toBeNull();
  });

  it('bezahlbares „accept" wird weiterhin normal bestätigt', () => {
    const s = mainPhaseGame();
    s.activeIndex = 1;
    setRes(s, 'p1', { ore: 1 });
    setRes(s, 'p0', { wood: 1 });
    applyAction(s, 'p1', { type: 'proposeTrade', give: { ore: 1 }, get: { wood: 1 } });
    applyAction(s, 'p0', { type: 'respondTrade', offerId: s.tradeOffer!.id, accept: true });
    const a = chooseBotAction(s, 'p1');
    expect(a).toEqual({ type: 'confirmTrade', offerId: s.tradeOffer!.id, withPlayer: 'p0' });
    expect('events' in applyAction(s, 'p1', a!)).toBe(true);
    expect(s.players.find((p) => p.id === 'p1')!.resources.wood).toBe(1);
  });

  it('Bot als Empfänger antwortet normal, auch wenn ein FREMDER gekontert hat', () => {
    const s = mainPhaseGame();
    setRes(s, 'p0', { ore: 1 });
    setRes(s, 'p1', { wool: 1 });
    setRes(s, 'p2', { wool: 1 });
    applyAction(s, 'p0', { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
    applyAction(s, 'p2', { type: 'counterTrade', offerId: s.tradeOffer!.id, give: { wool: 1 }, get: { ore: 1 } });
    // p1 steht weiter auf 'pending' → Bot antwortet ganz normal
    const a = chooseBotAction(s, 'p1');
    expect(a).toEqual({ type: 'respondTrade', offerId: s.tradeOffer!.id, accept: true });
    expect('events' in applyAction(s, 'p1', a!)).toBe(true);
  });
});

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
