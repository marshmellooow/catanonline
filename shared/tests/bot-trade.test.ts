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
  /** p1 (Bot) ist Anbieter, p0 (Mensch) kontert. */
  function botOfferWithCounter(counterGive: Partial<Record<ResourceType, number>>, counterGet: Partial<Record<ResourceType, number>>): GameState {
    const s = mainPhaseGame();
    setRes(s, 'p1', { ore: 2, wool: 2 });
    setRes(s, 'p0', { wood: 3, grain: 3 });
    s.activeIndex = 1;
    applyAction(s, 'p1', { type: 'proposeTrade', give: { ore: 1 }, get: { wood: 1 } });
    applyAction(s, 'p0', { type: 'counterTrade', offerId: s.tradeOffer!.id, give: counterGive, get: counterGet });
    return s;
  }

  /** p0 (MENSCH) ist Anbieter, p1 (Bot) kontert. Dieser Fall läuft über
   *  room.ts::enforceTurn, wenn die Zugzeit des Menschen abläuft. */
  function humanOfferWithCounter(counterGive: Partial<Record<ResourceType, number>>, counterGet: Partial<Record<ResourceType, number>>): GameState {
    const s = mainPhaseGame();
    setRes(s, 'p0', { wood: 3, grain: 3 });
    setRes(s, 'p1', { ore: 2, wool: 2 });
    s.activeIndex = 0;
    applyAction(s, 'p0', { type: 'proposeTrade', give: { wood: 1 }, get: { ore: 1 } });
    applyAction(s, 'p1', { type: 'counterTrade', offerId: s.tradeOffer!.id, give: counterGive, get: counterGet });
    return s;
  }

  it('ein MENSCH bekommt nie ein Gegenangebot untergeschoben — auch kein „faires"', () => {
    // Der Zweig läuft über room.ts::enforceTurn auch für einen verbundenen Menschen,
    // dessen Zugzeit abläuft. Vom Gegner diktierte Konditionen dürfen niemandem
    // ungefragt die Karten tauschen: die Fairness-Schranke zählt nur Anzahl, nicht Wert —
    // ein Gegner könnte sonst gezielt die letzte gebrauchte Karte gegen Ballast abziehen.
    const p0 = (s: GameState) => s.players.find((p) => p.id === 'p0')!;
    const cases: Array<[Partial<Record<ResourceType, number>>, Partial<Record<ResourceType, number>>]> = [
      [{ ore: 2 }, { grain: 2 }], // aus p0-Sicht fair (2 für 2) — trotzdem NICHT annehmen
      [{ ore: 2 }, { grain: 1 }], // sogar vorteilhaft für p0 — trotzdem nicht
    ];
    for (const [g, t] of cases) {
      const s = humanOfferWithCounter(g, t);
      expect(p0(s).isBot).toBe(false); // Mensch-Sitz
      const before = { ...p0(s).resources };
      const a = chooseBotAction(s, 'p0');
      expect(a, `Konter ${JSON.stringify(g)}→${JSON.stringify(t)}`).toEqual({ type: 'cancelTrade' });
      expect('events' in applyAction(s, 'p0', a!)).toBe(true); // Reducer akzeptiert → kein Endlos-Tick
      expect(p0(s).resources).toEqual(before); // keine Karte bewegt
      expect(s.tradeOffer).toBeNull();
    }
  });

  it('ein echter Bot-Sitz nimmt ein faires, bezahlbares Gegenangebot an', () => {
    const s = botOfferWithCounter({ grain: 2 }, { ore: 1 }); // p0 gibt 2 Getreide, will 1 Erz
    expect(s.players.find((p) => p.id === 'p1')!.isBot).toBe(true);
    const a = chooseBotAction(s, 'p1');
    expect(a).toEqual({ type: 'acceptCounter', offerId: s.tradeOffer!.id, withPlayer: 'p0' });
    expect('events' in applyAction(s, 'p1', a!)).toBe(true);
    // p1 gab 1 Erz her und bekam 2 Getreide.
    const p1 = s.players.find((p) => p.id === 'p1')!;
    expect(p1.resources.ore).toBe(1);
    expect(p1.resources.grain).toBe(2);
    expect(s.tradeOffer).toBeNull();
  });

  it('ein Bot-Sitz lehnt unfaire oder unbezahlbare Gegenangebote ab', () => {
    const cases: Array<[Partial<Record<ResourceType, number>>, Partial<Record<ResourceType, number>>]> = [
      [{ grain: 1 }, { ore: 2 }], // unfair: p1 gäbe 2 Erz für 1 Getreide
      [{ grain: 1 }, { wool: 3 }], // p1 hat nur 2 Wolle → unbezahlbar
    ];
    for (const [g, t] of cases) {
      const s = botOfferWithCounter(g, t);
      const a = chooseBotAction(s, 'p1');
      expect(a, `Konter ${JSON.stringify(g)}→${JSON.stringify(t)}`).toEqual({ type: 'cancelTrade' });
      expect('events' in applyAction(s, 'p1', a!)).toBe(true);
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

describe('Bot schlägt selbst Handel vor', () => {
  /** Aufstellung gespielt → p0 hat Gebäude/Straßen und damit echte Bauziele. */
  function botTurnGame(): GameState {
    const s = createGame({
      mapId: 'classic',
      seed: 2024,
      players: [
        { id: 'p0', name: 'P0', colorIndex: 0, isBot: true },
        { id: 'p1', name: 'P1', colorIndex: 1 },
        { id: 'p2', name: 'P2', colorIndex: 2 },
      ],
    });
    s.order = s.players.map((p) => p.id);
    let guard = 0;
    while ((s.phase === 'setupSettlement' || s.phase === 'setupRoad') && guard++ < 200) {
      const active = s.order[s.activeIndex];
      applyAction(s, active, chooseBotAction(s, active)!);
    }
    s.phase = 'main';
    s.hasRolled = true;
    s.activeIndex = 0;
    for (const p of s.players) p.resources = emptyResources();
    return s;
  }

  it('fragt einen Mitspieler, wenn genau eine Karte zur Stadt fehlt', () => {
    const s = botTurnGame();
    // Wolle ist entbehrlich (die Stadt braucht nur Getreide + Erz) → sie ist die Gegengabe.
    // Achtung: hätte p0 NUR die 2 Getreide + 2 Erz, böte er nichts an — Karten, die fürs
    // Ziel gebraucht werden, gibt der Bot bewusst nicht her.
    setRes(s, 'p0', { grain: 2, ore: 2, wool: 2 }); // 1 Erz fehlt zur Stadt
    setRes(s, 'p1', { ore: 3 }); // p1 kann liefern
    s.bank.ore = 0; // Bankweg versperrt → der Spielerhandel ist der einzige Weg
    const a = chooseBotAction(s, 'p0')!;
    expect(a).toEqual({ type: 'proposeTrade', give: { wool: 1 }, get: { ore: 1 } });
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
  });

  it('bietet nichts an, was kein Mitspieler liefern kann (Reducer würde ablehnen)', () => {
    const s = botTurnGame();
    setRes(s, 'p0', { grain: 2, ore: 2, wool: 2 });
    setRes(s, 'p1', {}); // niemand hat Erz
    setRes(s, 'p2', {});
    s.bank.ore = 0;
    const a = chooseBotAction(s, 'p0')!;
    expect(a.type).not.toBe('proposeTrade');
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
  });

  it('höchstens ein Angebot pro Zug — auch nach cancelTrade', () => {
    // Ohne diesen Zähler wäre der State nach cancelTrade identisch zu vorher → der Bot
    // böte endlos neu an und der Zug endete nie.
    const s = botTurnGame();
    setRes(s, 'p0', { grain: 2, ore: 2, wool: 2 });
    setRes(s, 'p1', { ore: 3 });
    s.bank.ore = 0;
    const first = chooseBotAction(s, 'p0')!;
    expect(first.type).toBe('proposeTrade');
    applyAction(s, 'p0', first);
    expect(s.tradesProposedThisTurn).toBe(1);
    // Angebot platzt (alle lehnen ab) → der Bot darf NICHT erneut anbieten.
    applyAction(s, 'p0', { type: 'cancelTrade' });
    const second = chooseBotAction(s, 'p0')!;
    expect(second.type).not.toBe('proposeTrade');
    expect(second).toEqual({ type: 'endTurn' });
  });

  it('endTurn setzt das Angebots-Budget zurück', () => {
    const s = botTurnGame();
    setRes(s, 'p0', { grain: 2, ore: 2, wool: 2 });
    setRes(s, 'p1', { ore: 3 });
    s.bank.ore = 0;
    applyAction(s, 'p0', chooseBotAction(s, 'p0')!);
    applyAction(s, 'p0', { type: 'cancelTrade' });
    expect(s.tradesProposedThisTurn).toBe(1);
    applyAction(s, 'p0', { type: 'endTurn' });
    expect(s.tradesProposedThisTurn).toBe(0);
  });

  it('wartet, solange ein MENSCH noch antworten kann', () => {
    // Sonst reißt der Bot dem Menschen den Handelsdialog nach 700 ms wieder weg.
    const s = botTurnGame();
    setRes(s, 'p0', { grain: 2, ore: 2, wool: 2 });
    setRes(s, 'p1', { ore: 3 });
    s.bank.ore = 0;
    applyAction(s, 'p0', chooseBotAction(s, 'p0')!);
    expect(s.tradeOffer!.responses['p1']).toBe('pending');
    expect(chooseBotAction(s, 'p0')).toBeNull(); // warten
    // Sobald der Mensch geantwortet hat, löst der Bot auf.
    applyAction(s, 'p1', { type: 'respondTrade', offerId: s.tradeOffer!.id, accept: false });
    applyAction(s, 'p2', { type: 'respondTrade', offerId: s.tradeOffer!.id, accept: false });
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'cancelTrade' });
  });

  it('löst sofort auf, wenn nur Bots offen sind', () => {
    const s = botTurnGame();
    s.players.forEach((p) => (p.isBot = true)); // reiner Bot-Tisch
    setRes(s, 'p0', { grain: 2, ore: 2, wool: 2 });
    setRes(s, 'p1', { ore: 3 });
    s.bank.ore = 0;
    applyAction(s, 'p0', chooseBotAction(s, 'p0')!);
    expect(chooseBotAction(s, 'p0')).not.toBeNull(); // kein Warten auf Bots
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

  it('lehnt 1:1 ab, wenn dafür die letzte Karte eines nahen Stadtziels geopfert würde', () => {
    const s = mainPhaseGame();
    s.buildings[s.board.corners[0].id] = { owner: 'p1', type: 'settlement' };
    setRes(s, 'p0', { wool: 1 });
    setRes(s, 'p1', { grain: 2, ore: 2 }); // nur ein Erz fehlt zur Stadt
    applyAction(s, 'p0', { type: 'proposeTrade', give: { wool: 1 }, get: { ore: 1 } });
    expect(chooseBotAction(s, 'p1')).toEqual({
      type: 'respondTrade', offerId: s.tradeOffer!.id, accept: false,
    });
  });

  it('wählt bei mehreren Annahmen den schwächeren Gegner statt den ersten Objekt-Eintrag', () => {
    const s = mainPhaseGame();
    s.players.find((p) => p.id === 'p0')!.isBot = true;
    s.buildings[s.board.corners[0].id] = { owner: 'p1', type: 'settlement' }; // p1 führt 1:0
    setRes(s, 'p0', { ore: 1 });
    setRes(s, 'p1', { wool: 1 });
    setRes(s, 'p2', { wool: 1 });
    applyAction(s, 'p0', { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
    applyAction(s, 'p1', chooseBotAction(s, 'p1')!);
    applyAction(s, 'p2', chooseBotAction(s, 'p2')!);
    expect(chooseBotAction(s, 'p0')).toEqual({
      type: 'confirmTrade', offerId: s.tradeOffer!.id, withPlayer: 'p2',
    });
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
