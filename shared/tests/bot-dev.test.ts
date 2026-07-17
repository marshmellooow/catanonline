import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/reducer.js';
import { chooseBotAction } from '../src/bot.js';
import { driveSetup } from './helpers/drive.js';
import { emptyResources } from '../src/types.js';
import { TERRAIN_RESOURCE } from '../src/design.js';
import { bestRoadTarget } from '../src/bot-eval.js';
import type { GameState } from '../src/types.js';
import type { ResourceType } from '../src/design.js';

function newGame(players = 3, seed = 2024): GameState {
  const g = createGame({
    mapId: 'classic',
    seed,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i })),
  });
  g.order = g.players.map((p) => p.id);
  return g;
}


function mainGame(seed = 2024): GameState {
  const s = newGame(3, seed);
  driveSetup(s);
  s.phase = 'main';
  s.hasRolled = true;
  s.activeIndex = 0;
  for (const p of s.players) p.resources = emptyResources();
  return s;
}

function setRes(s: GameState, id: string, r: Partial<Record<ResourceType, number>>): void {
  s.players.find((x) => x.id === id)!.resources = { ...emptyResources(), ...r };
}

/** Ein Ertragsfeld, auf dem p0 baut — dort tut der Räuber weh. */
function hexWithOwnBuilding(s: GameState, id: string): number {
  const hex = s.board.hexes.find(
    (h) => h.number !== null && TERRAIN_RESOURCE[h.terrain] && h.corners.some((c) => s.buildings[c]?.owner === id),
  );
  expect(hex, 'kein Ertragsfeld mit eigenem Gebäude gefunden').toBeDefined();
  return hex!.id;
}

describe('Ritter', () => {
  it('wird VOR dem Wurf gespielt, wenn der Räuber auf einem eigenen Ertragsfeld liegt', () => {
    const s = mainGame();
    s.phase = 'roll';
    s.hasRolled = false;
    s.players.find((p) => p.id === 'p0')!.devCards.knight = 1;
    s.robberHex = hexWithOwnBuilding(s, 'p0');
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'playKnight' });
  });

  it('wird NICHT gespielt, wenn der Räuber auf der Wüste liegt', () => {
    const s = mainGame();
    s.phase = 'roll';
    s.hasRolled = false;
    s.players.find((p) => p.id === 'p0')!.devCards.knight = 1;
    const desert = s.board.hexes.find((h) => h.terrain === 'D')!;
    s.robberHex = desert.id; // trifft niemanden → kein Grund, die Karte zu verbrennen
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'rollDice' });
  });

  it('wird für die Größte Rittermacht gespielt', () => {
    const s = mainGame();
    const p0 = s.players.find((p) => p.id === 'p0')!;
    p0.devCards.knight = 1;
    p0.playedKnights = 2; // der dritte holt die Auszeichnung
    s.robberHex = s.board.hexes.find((h) => h.terrain === 'D')!.id; // Räuber tut nicht weh
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'playKnight' });
  });

  it('wird nicht gespielt, wenn er die Rittermacht NICHT holt und der Räuber nicht stört', () => {
    const s = mainGame();
    const p0 = s.players.find((p) => p.id === 'p0')!;
    p0.devCards.knight = 1;
    p0.playedKnights = 0; // 1 Ritter reicht nicht (Schwelle 3)
    s.robberHex = s.board.hexes.find((h) => h.terrain === 'D')!.id;
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'endTurn' });
  });

  it('Terminierung: Ritter in roll → Räuber → zurück nach roll → dann würfeln', () => {
    const s = mainGame();
    s.phase = 'roll';
    s.hasRolled = false;
    s.players.find((p) => p.id === 'p0')!.devCards.knight = 1;
    s.robberHex = hexWithOwnBuilding(s, 'p0');
    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      const a = chooseBotAction(s, 'p0');
      if (!a) break;
      seen.push(a.type);
      expect('events' in applyAction(s, 'p0', a), `${a.type} abgelehnt`).toBe(true);
      if (a.type === 'rollDice') break;
    }
    expect(seen[0]).toBe('playKnight');
    expect(seen).toContain('moveRobber');
    expect(seen[seen.length - 1]).toBe('rollDice'); // landet zuverlässig beim Wurf
  });
});

describe('Nur eine Karte pro Zug — und nie eine frisch gekaufte', () => {
  it('spielt keine zweite Dev-Karte im selben Zug', () => {
    const s = mainGame();
    const p0 = s.players.find((p) => p.id === 'p0')!;
    p0.devCards.knight = 1;
    p0.devCards.monopoly = 1;
    p0.playedKnights = 2;
    s.playedDevThisTurn = true; // in diesem Zug schon eine gespielt
    const a = chooseBotAction(s, 'p0')!;
    expect(['playKnight', 'playMonopoly', 'playYearOfPlenty', 'playRoadBuilding']).not.toContain(a.type);
  });

  it('spielt NIEMALS eine Karte aus newDevCards (erst nächsten Zug spielbar)', () => {
    const s = mainGame();
    const p0 = s.players.find((p) => p.id === 'p0')!;
    p0.newDevCards.knight = 1; // frisch gekauft
    p0.newDevCards.monopoly = 1;
    p0.playedKnights = 2; // wäre Rittermacht — aber die Karte ist noch nicht spielbar
    setRes(s, 'p1', { wood: 5 }); // Monopol wäre lohnend
    s.robberHex = hexWithOwnBuilding(s, 'p0'); // Räuber stört — wäre ein Ritter-Grund
    const a = chooseBotAction(s, 'p0')!;
    expect(a.type).toBe('endTurn');
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
  });
});

describe('Monopol', () => {
  it('erst ab Schwelle — und auf den ertragreichsten Rohstoff', () => {
    const s = mainGame();
    s.players.find((p) => p.id === 'p0')!.devCards.monopoly = 1;
    setRes(s, 'p1', { wood: 1, ore: 2 });
    setRes(s, 'p2', { ore: 3 }); // Erz gesamt 5, Holz gesamt 1
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'playMonopoly', resource: 'ore' });
  });

  it('nicht bei magerer Beute', () => {
    const s = mainGame();
    s.players.find((p) => p.id === 'p0')!.devCards.monopoly = 1;
    setRes(s, 'p1', { wood: 1 });
    setRes(s, 'p2', { ore: 1 }); // Bestes wäre 1 < MONOPOLY_MIN
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'endTurn' });
  });
});

describe('Erfindung', () => {
  // Hinweis für künftige Tests: DIREKT nach der Aufstellung gibt es keinen gültigen
  // Siedlungsplatz — die Abstandsregel sperrt die Enden der beiden Startstraßen. Ziele
  // wie „Siedlung" existieren deshalb erst später; die Stadt geht dagegen sofort.

  it('holt die zwei fehlenden Karten für die Stadt (auch 2× denselben Rohstoff)', () => {
    const s = mainGame();
    s.players.find((p) => p.id === 'p0')!.devCards.yearOfPlenty = 1;
    setRes(s, 'p0', { grain: 2, ore: 1 }); // zur Stadt (2 Getreide + 3 Erz) fehlen 2 Erz
    s.bank.ore = 5;
    const a = chooseBotAction(s, 'p0')!;
    expect(a.type).toBe('playYearOfPlenty');
    expect((a as { resources: ResourceType[] }).resources).toEqual(['ore', 'ore']);
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
    expect(s.players.find((p) => p.id === 'p0')!.resources.ore).toBe(3); // Stadt jetzt bezahlbar
  });

  it('wählt nie 2× denselben Rohstoff, wenn die Bank nur einen hat (bank < 2)', () => {
    const s = mainGame();
    s.players.find((p) => p.id === 'p0')!.devCards.yearOfPlenty = 1;
    setRes(s, 'p0', { grain: 2, ore: 1 }); // zur Stadt fehlen 2 Erz
    s.bank.ore = 1; // ['ore','ore'] wäre vom Reducer abgelehnt → Endlosschleife
    const a = chooseBotAction(s, 'p0')!;
    if (a.type === 'playYearOfPlenty') {
      // Der Bot darf auf ein ANDERES Ziel ausweichen (z. B. Holz+Lehm für die Straße) —
      // nur die unerfüllbare Kombination ist verboten.
      expect((a as { resources: ResourceType[] }).resources).not.toEqual(['ore', 'ore']);
    }
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
  });

  it('spielt gar nicht, wenn die Bank leer ist', () => {
    const s = mainGame();
    s.players.find((p) => p.id === 'p0')!.devCards.yearOfPlenty = 1;
    setRes(s, 'p0', { grain: 2, ore: 1 });
    for (const r of ['wood', 'brick', 'wool', 'grain', 'ore'] as const) s.bank[r] = 0;
    const a = chooseBotAction(s, 'p0')!;
    expect(a.type).not.toBe('playYearOfPlenty');
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
  });

  it('r1 === r2 verlangt bank >= 2 — der Reducer akzeptiert die Wahl immer', () => {
    const s = mainGame();
    s.players.find((p) => p.id === 'p0')!.devCards.yearOfPlenty = 1;
    // Nur 1 Erz fehlt zur Stadt → zweite Karte ist frei wählbar.
    setRes(s, 'p0', { grain: 2, ore: 2 });
    for (const r of ['wood', 'brick', 'wool', 'grain'] as const) s.bank[r] = 0;
    s.bank.ore = 1; // 2× Erz wäre unmöglich, 1× Erz + irgendwas auch
    const a = chooseBotAction(s, 'p0')!;
    expect('events' in applyAction(s, 'p0', a)).toBe(true); // nie eine abgelehnte Aktion
  });

  it('nimmt eine verfügbare Zusatzkarte, wenn der knappste Rohstoff der Bank leer ist', () => {
    const s = mainGame();
    s.players.find((p) => p.id === 'p0')!.devCards.yearOfPlenty = 1;
    setRes(s, 'p0', { grain: 2, ore: 2 }); // nur 1 Erz fehlt zur Stadt
    s.bank = { wood: 0, brick: 5, wool: 5, grain: 5, ore: 5 };
    const a = chooseBotAction(s, 'p0')!;
    expect(a.type).toBe('playYearOfPlenty');
    if (a.type !== 'playYearOfPlenty') return;
    expect(a.resources).toContain('ore');
    expect(a.resources).not.toContain('wood');
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
    expect(s.players.find((p) => p.id === 'p0')!.resources.ore).toBe(3);
  });
});

describe('Straßenbau', () => {
  it('wird nur mit freien Kanten und Straßen im Vorrat gespielt', () => {
    const s = mainGame();
    const p0 = s.players.find((p) => p.id === 'p0')!;
    p0.devCards.roadBuilding = 1;
    p0.roadsLeft = 0; // kein Vorrat → die Karte würde verpuffen
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'endTurn' });
  });

  it('baut nach dem Ausspielen beide Gratis-Straßen und landet wieder in main', () => {
    const s = mainGame();
    s.players.find((p) => p.id === 'p0')!.devCards.roadBuilding = 1;
    const a = chooseBotAction(s, 'p0')!;
    expect(a.type).toBe('playRoadBuilding');
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
    expect(s.phase).toBe('roadBuilding');
    let built = 0;
    while (s.phase === 'roadBuilding' && built < 5) {
      const b = chooseBotAction(s, 'p0')!;
      expect(b.type).toBe('buildRoad');
      expect('events' in applyAction(s, 'p0', b)).toBe(true);
      built++;
    }
    expect(built).toBe(2);
    expect(s.phase).toBe('main');
  });

  it('folgt nach dem Ausspielen der zuvor bewerteten Zielkante', () => {
    const s = newGame(4, 1);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.activeIndex = 0;
    for (const p of s.players) p.resources = emptyResources();
    const active = s.order[s.activeIndex];
    const p = s.players.find((x) => x.id === active)!;
    p.devCards.roadBuilding = 1;
    const target = bestRoadTarget(s, active);
    expect(target).not.toBeNull();
    const play = chooseBotAction(s, active)!;
    expect(play.type).toBe('playRoadBuilding');
    expect('events' in applyAction(s, active, play)).toBe(true);
    expect(chooseBotAction(s, active)).toEqual({ type: 'buildRoad', edge: target!.edge });
  });
});
