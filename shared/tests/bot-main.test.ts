import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/reducer.js';
import { chooseBotAction } from '../src/bot.js';
import { driveSetup } from './helpers/drive.js';
import { validCityCorners, canPlaceSettlement, playerPorts, resourceTotal } from '../src/logic.js';
import { evalCityCorner } from '../src/bot-eval.js';
import { emptyResources } from '../src/types.js';
import { RESOURCES } from '../src/design.js';
import type { GameState } from '../src/types.js';
import type { ResourceType } from '../src/design.js';

function newGame(players = 3, seed = 2024, mapId = 'classic'): GameState {
  const g = createGame({
    mapId,
    seed,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i })),
  });
  g.order = g.players.map((p) => p.id);
  return g;
}


/** Aufstellung gespielt, dann direkt in die Hauptphase mit p0 am Zug, Hände geleert. */
function mainGame(seed = 2024, mapId = 'classic'): GameState {
  const s = newGame(3, seed, mapId);
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

const CITY = { grain: 2, ore: 3 };
const SETTLEMENT = { wood: 1, brick: 1, wool: 1, grain: 1 };

describe('Leiter: Bauen', () => {
  it('baut die Stadt vor der Siedlung, wenn beides bezahlbar ist', () => {
    const s = mainGame();
    setRes(s, 'p0', { wood: 1, brick: 1, wool: 1, grain: 3, ore: 3 }); // reicht für beides
    expect(validCityCorners(s, 'p0').length).toBeGreaterThan(0);
    const a = chooseBotAction(s, 'p0')!;
    expect(a.type).toBe('buildCity');
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
  });

  it('baut die Stadt auf der ertragreichsten eigenen Siedlung', () => {
    const s = mainGame();
    setRes(s, 'p0', CITY);
    const spots = validCityCorners(s, 'p0');
    expect(spots.length).toBeGreaterThan(1);
    let best = spots[0];
    for (const c of spots) if (evalCityCorner(s, c) > evalCityCorner(s, best)) best = c;
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'buildCity', corner: best });
  });

  it('baut die Siedlung nur auf einem regelkonformen Platz (Abstand + eigener Anschluss)', () => {
    const s = mainGame();
    setRes(s, 'p0', SETTLEMENT);
    const a = chooseBotAction(s, 'p0')!;
    if (a.type !== 'buildSettlement') return; // kein gültiger Platz → andere Sprosse, auch ok
    expect(canPlaceSettlement(s, a.corner, 'p0', false)).toBe(true);
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
  });

  it('baut keine ziellose Straße', () => {
    const s = mainGame();
    setRes(s, 'p0', { wood: 1, brick: 1 }); // reicht NUR für eine Straße
    const a = chooseBotAction(s, 'p0')!;
    // Entweder eine Straße mit Ziel — oder gar keine. Nie etwas Ungültiges.
    if (a.type === 'buildRoad') expect('events' in applyAction(s, 'p0', a)).toBe(true);
    else expect(a.type).toBe('endTurn');
  });

  it('endet den Zug, wenn nichts mehr geht', () => {
    const s = mainGame();
    setRes(s, 'p0', {}); // keine Karten
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'endTurn' });
  });
});

describe('Leiter: Entwicklungskarte kaufen', () => {
  it('spart, wenn nur 1–2 Karten zur Stadt fehlen', () => {
    const s = mainGame();
    // Genug für die Dev-Karte (Wolle+Getreide+Erz), aber es fehlt 1 Erz zur Stadt.
    setRes(s, 'p0', { wool: 1, grain: 2, ore: 2 });
    expect(validCityCorners(s, 'p0').length).toBeGreaterThan(0);
    const a = chooseBotAction(s, 'p0')!;
    expect(a.type).not.toBe('buyDevCard'); // Spar-Guard greift
  });

  it('kauft im Endspurt (need <= 2) trotz Spar-Guard', () => {
    const s = mainGame();
    setRes(s, 'p0', { wool: 1, grain: 2, ore: 2 });
    s.vpTarget = 4; // p0 hat aus dem Setup 2 SP → need = 2 ⇒ Endspurt
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'buyDevCard' });
  });

  it('kauft nichts bei leerem Stapel', () => {
    const s = mainGame();
    setRes(s, 'p0', { wool: 1, grain: 1, ore: 1 });
    s.devDeck = [];
    const a = chooseBotAction(s, 'p0')!;
    expect(a.type).not.toBe('buyDevCard');
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
  });

  it('verbrennt die Siedlungskarten nicht, wenn nur eine Tauschkarte zum Bau fehlt', () => {
    const s = mainGame();
    const corner = s.board.corners.find(
      (c) => canPlaceSettlement(s, c.id, 'p0', true) && c.edges.some((e) => !s.roads[e]),
    )!;
    const edge = corner.edges.find((e) => !s.roads[e])!;
    s.roads[edge] = { owner: 'p0' }; // schafft einen echten, regelkonformen Siedlungsplatz
    expect(canPlaceSettlement(s, corner.id, 'p0', false)).toBe(true);
    s.players.find((p) => p.id === 'p0')!.isBot = true;
    setRes(s, 'p0', { brick: 1, wool: 1, grain: 1, ore: 1 }); // Holz fehlt; Dev wäre bezahlbar
    setRes(s, 'p1', { wood: 1 });
    s.bank.wood = 0; // nur Spielerhandel kann den Bau in diesem Zug freischalten
    expect(chooseBotAction(s, 'p0')).toEqual({
      type: 'proposeTrade', give: { ore: 1 }, get: { wood: 1 },
    });
  });
});

describe('Leiter: Bank-/Hafenhandel', () => {
  it('tauscht nur, wenn der Tausch ein Ziel in diesem Zug freischaltet', () => {
    const s = mainGame();
    // 4 überzähliges Holz + Rest der Siedlung → 1 Tausch schaltet die Siedlung frei.
    setRes(s, 'p0', { wood: 5, wool: 1, grain: 1 });
    const a = chooseBotAction(s, 'p0')!;
    expect(a).toEqual({ type: 'bankTrade', give: 'wood', get: 'brick' });
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
  });

  it('tauscht nicht, wenn KEIN Ziel danach erreichbar wäre', () => {
    const s = mainGame();
    // 3 Holz: für jedes Ziel fehlt mehr, als der Überschuss (2 nach Abzug) hergibt.
    // Achtung beim Aufbau solcher Fälle: der Bot prüft ALLE Ziele (Stadt/Siedlung/
    // Straße/Dev) — ein Überschuss von 4 Holz schaltet z. B. schon die Straße frei.
    setRes(s, 'p0', { wood: 3 });
    const a = chooseBotAction(s, 'p0')!;
    expect(a).toEqual({ type: 'endTurn' });
  });

  it('tauscht nicht, wenn die Bank den Zielrohstoff nicht mehr hat', () => {
    const s = mainGame();
    setRes(s, 'p0', { wood: 5, wool: 1, grain: 1 });
    s.devDeck = []; // sonst wiche der Bot auf das Dev-Ziel aus (Erz statt Lehm)
    s.bank.brick = 0; // Siedlung und Straße brauchen beide Lehm
    const a = chooseBotAction(s, 'p0')!;
    expect(a.type).not.toBe('bankTrade');
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
  });

  it('nutzt den 2:1-Hafenkurs statt 4:1', () => {
    // Häfen gibt es nur auf Wasser-Karten (classic hat keine).
    const s = mainGame(7, 'harbor');
    const port = s.board.ports[0];
    port.type = 'wood';
    if (!port.corners.some((c) => s.buildings[c]?.owner === 'p0')) {
      s.buildings[port.corners[0]] = { owner: 'p0', type: 'settlement' };
    }
    expect(playerPorts(s, 'p0')).toContain('wood');
    // Mit 2:1 reichen 3 Holz (1 fürs Ziel + 2 zum Tauschen) — mit 4:1 wären es 5.
    setRes(s, 'p0', { wood: 3, wool: 1, grain: 1 });
    const a = chooseBotAction(s, 'p0')!;
    expect(a).toEqual({ type: 'bankTrade', give: 'wood', get: 'brick' });
    const before = resourceTotal(s.players.find((p) => p.id === 'p0')!.resources);
    expect('events' in applyAction(s, 'p0', a)).toBe(true);
    const after = resourceTotal(s.players.find((p) => p.id === 'p0')!.resources);
    expect(before - after).toBe(1); // 2 abgegeben, 1 bekommen → Kurs 2 wirklich genutzt
  });

  it('jeder Bank-Handel verkleinert die Hand strikt (Terminierungs-Invariante)', () => {
    const s = mainGame();
    setRes(s, 'p0', { wood: 9, wool: 1, grain: 1 });
    for (let i = 0; i < 10; i++) {
      const a = chooseBotAction(s, 'p0')!;
      if (a.type !== 'bankTrade') break;
      const before = resourceTotal(s.players.find((p) => p.id === 'p0')!.resources);
      expect('events' in applyAction(s, 'p0', a)).toBe(true);
      const after = resourceTotal(s.players.find((p) => p.id === 'p0')!.resources);
      expect(after).toBeLessThan(before); // sonst wäre ein Hin-und-Her möglich
    }
  });
});

describe('Invariante: der Reducer akzeptiert JEDE Aktion der Hauptphase', () => {
  it('Fuzz über viele zufällige Hände, Seeds und Karten', () => {
    // Der Wächter für die zentrale Randbedingung: eine vom Reducer abgelehnte Bot-Aktion
    // würde botTick alle 700 ms dieselbe Wahl neu treffen lassen — Partie tot.
    let rng = 12345;
    const rand = (n: number): number => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };
    let checked = 0;
    for (const mapId of ['classic', 'harbor', 'coast']) {
      for (const seed of [1, 42, 2024]) {
        for (let trial = 0; trial < 40; trial++) {
          const s = mainGame(seed, mapId);
          for (const p of s.players) {
            const res = emptyResources();
            for (const r of RESOURCES) res[r] = rand(6);
            p.resources = res;
          }
          // Gelegentlich den Stapel leeren bzw. die Bank auszehren.
          if (trial % 7 === 0) s.devDeck = [];
          if (trial % 5 === 0) for (const r of RESOURCES) s.bank[r] = rand(2);
          const a = chooseBotAction(s, 'p0');
          expect(a, `${mapId}/${seed}/${trial}: keine Aktion in main`).not.toBeNull();
          const r = applyAction(s, 'p0', a!);
          expect('events' in r, `${mapId}/${seed}/${trial}: ${JSON.stringify(a)} → ${'error' in r ? r.error : ''}`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBe(360);
  });
});
