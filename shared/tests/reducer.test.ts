import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/reducer.js';
import { chooseBotAction } from '../src/bot.js';
import { RESOURCES } from '../src/design.js';
import type { ResourceType } from '../src/design.js';
import type { GameState } from '../src/types.js';

function newGame(players = 3, vpTarget = 10): GameState {
  return createGame({
    mapId: 'classic',
    seed: 2024,
    vpTarget,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i })),
  });
}

/** Startaufstellung via Bot-Logik durchspielen. */
function driveSetup(s: GameState): void {
  let guard = 0;
  while ((s.phase === 'setupSettlement' || s.phase === 'setupRoad') && guard++ < 200) {
    const active = s.order[s.activeIndex];
    const a = chooseBotAction(s, active);
    if (!a) throw new Error('Bot fand keine Setup-Aktion in Phase ' + s.phase);
    const r = applyAction(s, active, a);
    if ('error' in r) throw new Error('Setup-Fehler: ' + r.error);
  }
}

const ok = (r: ReturnType<typeof applyAction>) => expect('events' in r).toBe(true);
const err = (r: ReturnType<typeof applyAction>) => expect('error' in r).toBe(true);

describe('Startaufstellung', () => {
  it('läuft in Schlangenreihenfolge und endet in der Würfelphase', () => {
    const s = newGame(3);
    driveSetup(s);
    expect(s.phase).toBe('roll');
    expect(s.activeIndex).toBe(0);
    for (const p of s.players) {
      expect(p.settlementsLeft).toBe(97); // 99 - 2 (kein Bau-Limit)
      expect(p.roadsLeft).toBe(13); // 15 - 2
    }
    // zweite Siedlung hat Starterträge gebracht
    const totalRes = s.players.reduce((sum, p) => sum + Object.values(p.resources).reduce((a, b) => a + b, 0), 0);
    expect(totalRes).toBeGreaterThan(0);
  });
});

describe('Würfeln', () => {
  it('erzeugt einen gültigen Phasenübergang', () => {
    const s = newGame(3);
    driveSetup(s);
    const active = s.order[s.activeIndex];
    ok(applyAction(s, active, { type: 'rollDice' }));
    expect(['main', 'discard', 'moveRobber']).toContain(s.phase);
    expect(s.hasRolled).toBe(true);
    // Nicht-aktiver Spieler darf nicht würfeln
    err(applyAction(s, s.order[1], { type: 'rollDice' }));
  });
});

describe('Bankhandel', () => {
  it('4:1 tauscht korrekt', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    const p0 = s.players[0];
    p0.resources = { wood: 4, brick: 0, wool: 0, grain: 0, ore: 0 };
    ok(applyAction(s, 'p0', { type: 'bankTrade', give: 'wood', get: 'ore' }));
    expect(p0.resources.wood).toBe(0);
    expect(p0.resources.ore).toBe(1);
    // ohne genug Rohstoff → Fehler
    err(applyAction(s, 'p0', { type: 'bankTrade', give: 'wood', get: 'ore' }));
  });
});

describe('Spielerhandel mit Bestätigungs-Flow', () => {
  it('Angebot → Antwort → Bestätigung tauscht Karten', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.players[0].resources = { wood: 2, brick: 0, wool: 0, grain: 0, ore: 0 };
    s.players[1].resources = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 1 };
    ok(applyAction(s, 'p0', { type: 'proposeTrade', give: { wood: 2 }, get: { ore: 1 } }));
    expect(s.tradeOffer).not.toBeNull();
    ok(applyAction(s, 'p1', { type: 'respondTrade', offerId: s.tradeOffer!.id, accept: true }));
    ok(applyAction(s, 'p2', { type: 'respondTrade', offerId: s.tradeOffer!.id, accept: false }));
    // p0 darf erst nach expliziter Bestätigung tauschen
    ok(applyAction(s, 'p0', { type: 'confirmTrade', offerId: s.tradeOffer!.id, withPlayer: 'p1' }));
    expect(s.tradeOffer).toBeNull();
    expect(s.players[0].resources.wood).toBe(0);
    expect(s.players[0].resources.ore).toBe(1);
    expect(s.players[1].resources.wood).toBe(2);
    expect(s.players[1].resources.ore).toBe(0);
  });

  it('kann nicht mit einem Spieler bestätigen, der nicht angenommen hat', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.players[0].resources = { wood: 2, brick: 0, wool: 0, grain: 0, ore: 0 };
    applyAction(s, 'p0', { type: 'proposeTrade', give: { wood: 1 }, get: { ore: 1 } });
    err(applyAction(s, 'p0', { type: 'confirmTrade', offerId: s.tradeOffer!.id, withPlayer: 'p1' }));
  });
});

describe('Entwicklungskarten', () => {
  it('Ritter versetzt den Räuber, stiehlt und zählt für die Rittermacht', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.players[0].devCards.knight = 1;
    s.players[0].resources = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    // Deterministisch: Setup-Gebäude entfernen, damit am Zielfeld genau EIN Opfer (p1) angrenzt
    // → automatischer Diebstahl (sonst mehrere Kandidaten → Phase 'steal').
    s.buildings = {};
    // Zielfeld mit p1-Gebäude + Karte
    const hex = s.board.hexes.find((h) => h.terrain !== 'W' && h.id !== s.robberHex)!;
    s.buildings[hex.corners[0]] = { owner: 'p1', type: 'settlement' };
    s.players[1].resources = { wood: 1, brick: 0, wool: 0, grain: 0, ore: 0 };
    ok(applyAction(s, 'p0', { type: 'playKnight' }));
    expect(s.phase).toBe('moveRobber');
    expect(s.players[0].playedKnights).toBe(1);
    ok(applyAction(s, 'p0', { type: 'moveRobber', hex: hex.id }));
    // ein Kandidat → automatisch gestohlen
    expect(s.players[0].resources.wood + s.players[1].resources.wood).toBe(1);
    expect(s.players[1].resources.wood).toBe(0);
    expect(s.phase).toBe('main');
  });

  it('nur eine Entwicklungskarte pro Zug', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.players[0].devCards.knight = 1;
    s.players[0].devCards.monopoly = 1;
    applyAction(s, 'p0', { type: 'playKnight' });
    // Räuber auflösen, damit Phase wieder main
    const hex = s.board.hexes.find((h) => h.terrain !== 'W' && h.id !== s.robberHex)!;
    applyAction(s, 'p0', { type: 'moveRobber', hex: hex.id });
    err(applyAction(s, 'p0', { type: 'playMonopoly', resource: 'wool' }));
  });

  it('Monopol zieht alle Karten eines Typs ein', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.players[0].devCards.monopoly = 1;
    s.players[1].resources.wool = 3;
    s.players[2].resources.wool = 2;
    s.players[0].resources.wool = 1;
    ok(applyAction(s, 'p0', { type: 'playMonopoly', resource: 'wool' }));
    expect(s.players[0].resources.wool).toBe(6);
    expect(s.players[1].resources.wool).toBe(0);
    expect(s.players[2].resources.wool).toBe(0);
  });

  it('Erfindung nimmt 2 Rohstoffe aus der Bank', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.players[0].devCards.yearOfPlenty = 1;
    s.players[0].resources = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    const beforeOre = s.bank.ore;
    ok(applyAction(s, 'p0', { type: 'playYearOfPlenty', resources: ['ore', 'ore'] }));
    expect(s.players[0].resources.ore).toBe(2);
    expect(s.bank.ore).toBe(beforeOre - 2);
  });
});

describe('Abwerfen bei 7', () => {
  it('Spieler mit ≥8 Karten müssen die Hälfte abwerfen', () => {
    const s = newGame(3);
    driveSetup(s);
    // p1 mit 8 Karten
    s.players[1].resources = { wood: 8, brick: 0, wool: 0, grain: 0, ore: 0 };
    s.phase = 'discard';
    s.mustDiscard = { p1: 4 };
    err(applyAction(s, 'p1', { type: 'discard', resources: { wood: 3 } })); // falsche Anzahl
    ok(applyAction(s, 'p1', { type: 'discard', resources: { wood: 4 } }));
    expect(s.players[1].resources.wood).toBe(4);
    expect(s.phase).toBe('moveRobber');
  });
});

describe('Sieg', () => {
  it('erkennt 10 Punkte (hier vpTarget 3) beim Stadtausbau', () => {
    const s = newGame(2, 3);
    driveSetup(s); // jeder hat 2 Siedlungen = 2 SP
    s.phase = 'main';
    s.hasRolled = true;
    // p0-Siedlung finden und zur Stadt ausbauen
    const cornerId = Number(Object.keys(s.buildings).find((cid) => s.buildings[Number(cid)].owner === 'p0'));
    s.players[0].resources = { wood: 0, brick: 0, wool: 0, grain: 2, ore: 3 };
    ok(applyAction(s, 'p0', { type: 'buildCity', corner: cornerId }));
    expect(s.winner).toBe('p0');
    expect(s.phase).toBe('finished');
  });
});

describe('Robustheit: Bots blockieren nie', () => {
  it('reiner Bot-Verlauf läuft 400 Aktionen fehlerfrei (inkl. 7er/Abwerfen/Räuber)', () => {
    const s = newGame(4);
    s.players.forEach((p) => (p.isBot = true));
    driveSetup(s);
    let steps = 0;
    for (; steps < 400 && !s.winner; steps++) {
      let actor: string;
      if (s.phase === 'discard') actor = Object.keys(s.mustDiscard)[0];
      else actor = s.order[s.activeIndex];
      const a = chooseBotAction(s, actor);
      if (!a) throw new Error(`Bot stecken geblieben in Phase ${s.phase} (Schritt ${steps})`);
      const r = applyAction(s, actor, a);
      if ('error' in r) throw new Error(`Bot-Fehler in Phase ${s.phase}: ${r.error}`);
    }
    expect(steps).toBe(400); // nie blockiert, kein Deadlock
    expect(s.turnCount).toBeGreaterThan(10);
  });
});

describe('Zug beenden', () => {
  it('reicht an den nächsten Spieler weiter und macht gekaufte Karten spielbar', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.players[0].newDevCards.knight = 1;
    ok(applyAction(s, 'p0', { type: 'endTurn' }));
    expect(s.activeIndex).toBe(1);
    expect(s.phase).toBe('roll');
    expect(s.players[0].devCards.knight).toBe(1);
    expect(s.players[0].newDevCards.knight).toBe(0);
  });
});

describe('Auto-Abwerfen (autoDiscard) — Karte für Karte zufällig', () => {
  function discardScenario(hand: Partial<Record<ResourceType, number>>, need: number, seedNudge = 0): GameState {
    const s = newGame(3);
    driveSetup(s);
    const pid = s.order[0];
    const p = s.players.find((pl) => pl.id === pid)!;
    p.resources = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0, ...hand };
    s.phase = 'discard';
    s.mustDiscard = { [pid]: need };
    s.rngState = (s.rngState + seedNudge) >>> 0;
    return s;
  }

  it('wirft genau N ab, konserviert Karten (Hand → Bank), Phase → moveRobber', () => {
    const s = discardScenario({ wood: 3, brick: 3, wool: 2 }, 4);
    const pid = s.order[0];
    const p = s.players.find((pl) => pl.id === pid)!;
    const bankBefore = { ...s.bank };
    const handBefore = { ...p.resources };
    ok(applyAction(s, pid, { type: 'autoDiscard' }));
    let moved = 0;
    for (const r of RESOURCES) {
      expect(p.resources[r]).toBeLessThanOrEqual(handBefore[r]); // Hand nur reduziert
      const d = handBefore[r] - p.resources[r];
      expect(s.bank[r] - bankBefore[r]).toBe(d); // exakt diese Menge in die Bank
      moved += d;
    }
    expect(moved).toBe(4);
    expect(s.mustDiscard[pid]).toBeUndefined();
    expect(s.phase).toBe('moveRobber');
  });

  it('ist deterministisch für gegebenen RNG-State', () => {
    const a = discardScenario({ wood: 4, brick: 4 }, 3);
    const b = discardScenario({ wood: 4, brick: 4 }, 3);
    ok(applyAction(a, a.order[0], { type: 'autoDiscard' }));
    ok(applyAction(b, b.order[0], { type: 'autoDiscard' }));
    const pa = a.players.find((p) => p.id === a.order[0])!.resources;
    const pb = b.players.find((p) => p.id === b.order[0])!.resources;
    expect(pa).toEqual(pb);
  });

  it('entscheidet pro Karte zufällig — kommt zu einem Mix, nicht immer „alles von einer Sorte"', () => {
    // Hand {wood:5, brick:5}, need=2: über viele RNG-States muss mindestens einmal
    // ein 1:1-Mix herauskommen (echter Per-Karte-Zufall).
    let sawMix = false;
    for (let i = 0; i < 60 && !sawMix; i++) {
      const s = discardScenario({ wood: 5, brick: 5 }, 2, (i * 2654435761) >>> 0);
      const pid = s.order[0];
      const before = { ...s.players.find((p) => p.id === pid)!.resources };
      applyAction(s, pid, { type: 'autoDiscard' });
      const after = s.players.find((p) => p.id === pid)!.resources;
      if (before.wood - after.wood === 1 && before.brick - after.brick === 1) sawMix = true;
    }
    expect(sawMix).toBe(true);
  });

  it('lehnt autoDiscard außerhalb der Abwurf-Phase ab', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    err(applyAction(s, s.order[0], { type: 'autoDiscard' }));
  });
});
