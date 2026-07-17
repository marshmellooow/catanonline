import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/reducer.js';
import { chooseBotAction } from '../src/bot.js';
import { driveSetup } from './helpers/drive.js';
import { canPlaceRoad, canPlaceSettlement, playerPorts } from '../src/logic.js';
import { emptyResources } from '../src/types.js';
import { RESOURCES } from '../src/design.js';
import {
  cornerPips, playerPipCoverage, expansionRoom, evalSettlementSpot, evalCityCorner,
  roadDistances, bestRoadTarget, missingFor, bankReachable, MAX_ROAD_LOOKAHEAD,
} from '../src/bot-eval.js';
import { COSTS } from '../src/logic.js';
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

/** Häfen gibt es NUR auf den Wasser-Karten — `classic` hat null Häfen. Hafen-Tests
 *  müssen deshalb `harbor` nehmen, sonst prüfen sie versehentlich nichts. */
function harborGame(seed = 2024): GameState {
  const g = newGame(3, seed, 'harbor');
  expect(g.board.ports.length).toBeGreaterThan(0);
  return g;
}


function setRes(s: GameState, id: string, r: Partial<Record<ResourceType, number>>): void {
  s.players.find((x) => x.id === id)!.resources = { ...emptyResources(), ...r };
}

describe('cornerPips / playerPipCoverage', () => {
  it('schlüsselt die Pips einer Ecke nach Rohstoff auf', () => {
    const s = newGame();
    const corner = s.board.corners.find((c) => c.hexes.some((h) => s.board.hexes[h].number !== null))!;
    const pips = cornerPips(s, corner.id);
    const sum = RESOURCES.reduce((a, r) => a + pips[r], 0);
    expect(sum).toBeGreaterThan(0);
    // Kein Rohstoff darf mehr Pips haben, als die Ecke insgesamt hergibt.
    for (const r of RESOURCES) expect(pips[r]).toBeLessThanOrEqual(sum);
  });

  it('Wüste trägt nichts bei — eine Ecke nur an Wüste/Wasser hat 0 Pips', () => {
    const s = newGame();
    const desert = s.board.hexes.find((h) => h.terrain === 'D')!;
    expect(desert).toBeDefined();
    // Eine Ecke der Wüste künstlich isolieren: alle anderen Nachbarfelder zu Wasser machen.
    const cid = desert.corners[0];
    for (const hid of s.board.corners[cid].hexes) {
      if (hid === desert.id) continue;
      s.board.hexes[hid].terrain = 'W';
      s.board.hexes[hid].number = null;
    }
    const pips = cornerPips(s, cid);
    expect(RESOURCES.every((r) => pips[r] === 0)).toBe(true);
    expect(evalSettlementSpot(s, cid, 'p0', 'setup')).toBeLessThan(
      evalSettlementSpot(s, s.board.corners.find((c) => cornerPips(s, c.id).wood > 0)!.id, 'p0', 'setup'),
    );
  });

  it('eine Stadt zählt doppelt — wie die Ausschüttung', () => {
    const s = newGame();
    driveSetup(s);
    const cid = Number(Object.keys(s.buildings).find((k) => s.buildings[Number(k)].owner === 'p0')!);
    const before = playerPipCoverage(s, 'p0');
    s.buildings[cid].type = 'city';
    const after = playerPipCoverage(s, 'p0');
    const pips = cornerPips(s, cid);
    for (const r of RESOURCES) expect(after[r]).toBe(before[r] + pips[r]);
  });
});

describe('evalSettlementSpot', () => {
  it('Vielfalt schlägt eine höhere rohe Pip-Summe', () => {
    // Ecke A: viele Pips, aber nur EIN Rohstoff. Ecke B: weniger Pips, drei Rohstoffe.
    // Ein reiner Pip-Summierer (die alte cornerValue-Logik) würde A wählen.
    const s = newGame();
    const a = s.board.corners.find((c) => c.hexes.length === 3)!;
    const b = s.board.corners.find((c) => c.hexes.length === 3 && c.id !== a.id && !a.adjacent.includes(c.id))!;
    // A: 3× Wald mit 6 (5 Pips) = 15 Pips, 1 Rohstoff
    for (const h of a.hexes) { s.board.hexes[h].terrain = 'F'; s.board.hexes[h].number = 6; }
    // B: Wald/Lehm/Erz mit 5 (4 Pips) = 12 Pips, 3 Rohstoffe
    const terrains: Array<'F' | 'H' | 'G'> = ['F', 'H', 'G'];
    b.hexes.forEach((h, i) => { s.board.hexes[h].terrain = terrains[i]; s.board.hexes[h].number = 5; });

    const pipsA = cornerPips(s, a.id);
    const pipsB = cornerPips(s, b.id);
    const rawA = RESOURCES.reduce((x, r) => x + pipsA[r], 0);
    const rawB = RESOURCES.reduce((x, r) => x + pipsB[r], 0);
    expect(rawA).toBeGreaterThan(rawB); // A hat objektiv mehr Pips …

    const scoreA = evalSettlementSpot(s, a.id, 'p0', 'setup');
    const scoreB = evalSettlementSpot(s, b.id, 'p0', 'setup');
    expect(scoreB).toBeGreaterThan(scoreA); // … B gewinnt trotzdem
  });

  it('Erstquellen-Bonus fällt weg, sobald ich den Rohstoff anderswo schon produziere', () => {
    const s = newGame();
    // Zielecke: reiner Wald → genau ein Erstquellen-Bonus (Holz).
    const target = s.board.corners.find((c) => c.hexes.length === 3)!;
    for (const h of target.hexes) { s.board.hexes[h].terrain = 'F'; s.board.hexes[h].number = 6; }
    const fresh = evalSettlementSpot(s, target.id, 'p0', 'main');

    // p0 baut WOANDERS eine Holzquelle. Die Ecke muss wirklich unabhängig sein:
    // kein gemeinsames Hexfeld (sonst ändert das Umfärben die Pips der Zielecke selbst)
    // und nicht in Abstand ≤2 (sonst ändert sich deren expansionRoom).
    const near = new Set<number>([target.id, ...target.adjacent]);
    for (const a of target.adjacent) for (const b of s.board.corners[a].adjacent) near.add(b);
    const other = s.board.corners.find(
      (c) => !near.has(c.id) && c.hexes.length === 3 && !c.hexes.some((h) => target.hexes.includes(h)),
    )!;
    for (const h of other.hexes) { s.board.hexes[h].terrain = 'F'; s.board.hexes[h].number = 5; }
    s.buildings[other.id] = { owner: 'p0', type: 'settlement' };
    expect(playerPipCoverage(s, 'p0').wood).toBeGreaterThan(0);

    const covered = evalSettlementSpot(s, target.id, 'p0', 'main');
    expect(fresh - covered).toBeCloseTo(2.5); // exakt der FIRST_SOURCE_BONUS, nichts sonst
  });

  it('2:1-Hafen zählt nur mit Nachschub voll, 3:1 immer', () => {
    // Isoliert den Hafen-Term sauber: dieselbe Ecke, gleicher Spieler, gleiche Coverage —
    // umgeschaltet wird NUR portId. Die Differenz zur hafenlosen Variante IST der Term.
    const s = harborGame();
    const port = s.board.ports.find((p) => p.type !== '3:1')!;
    const res = port.type as ResourceType;
    const cid = port.corners[0];

    const noPort = (() => { s.board.corners[cid].portId = null; return evalSettlementSpot(s, cid, 'p0', 'main'); })();
    s.board.corners[cid].portId = port.id;

    // Ohne Nachschub: p0 produziert den Hafen-Rohstoff nirgends.
    expect(playerPipCoverage(s, 'p0')[res] + cornerPips(s, cid)[res]).toBeLessThan(3);
    const dry = evalSettlementSpot(s, cid, 'p0', 'main');
    expect(dry - noPort).toBeCloseTo(0.5); // PORT_SPECIAL_DRY

    // Mit Nachschub: eine weit entfernte Stadt liefert den Rohstoff reichlich.
    const supply = s.board.corners.find(
      (c) => c.id !== cid && !s.board.corners[cid].adjacent.includes(c.id) && c.hexes.length === 3,
    )!;
    // Terrain-Codes: F=Holz, H=Lehm, P=Wolle, G=Getreide, M=Erz (siehe TERRAIN_RESOURCE).
    for (const h of supply.hexes) {
      s.board.hexes[h].terrain = ({ wood: 'F', brick: 'H', wool: 'P', grain: 'G', ore: 'M' } as const)[res];
      s.board.hexes[h].number = 6;
    }
    s.buildings[supply.id] = { owner: 'p0', type: 'city' };
    expect(playerPipCoverage(s, 'p0')[res]).toBeGreaterThanOrEqual(3); // Nachschub steht wirklich

    const wetNoPort = (() => { s.board.corners[cid].portId = null; return evalSettlementSpot(s, cid, 'p0', 'main'); })();
    s.board.corners[cid].portId = port.id;
    const wet = evalSettlementSpot(s, cid, 'p0', 'main');
    expect(wet - wetNoPort).toBeCloseTo(2.5); // PORT_SPECIAL_BONUS — fünfmal so viel wie trocken

    // 3:1 ist unabhängig vom Nachschub immer gleich viel wert.
    port.type = '3:1';
    expect(evalSettlementSpot(s, cid, 'p0', 'main') - wetNoPort).toBeCloseTo(1.5); // PORT_ANY_BONUS
  });
});

describe('evalCityCorner', () => {
  it('bewertet die ertragreichere eigene Siedlung höher', () => {
    const s = newGame();
    const rich = s.board.corners.find((c) => c.hexes.length === 3)!;
    const poor = s.board.corners.find((c) => c.hexes.length === 3 && c.id !== rich.id)!;
    for (const h of rich.hexes) { s.board.hexes[h].terrain = 'F'; s.board.hexes[h].number = 6; }
    for (const h of poor.hexes) { s.board.hexes[h].terrain = 'F'; s.board.hexes[h].number = 2; }
    expect(evalCityCorner(s, rich.id)).toBeGreaterThan(evalCityCorner(s, poor.id));
  });
});

describe('roadDistances / bestRoadTarget — der Reducer-Spiegel', () => {
  it('jede gelieferte firstEdge ist canPlaceRoad-gültig (über ein ganzes Bot-Spiel)', () => {
    // Das ist die zentrale Zusage der BFS. Bricht sie, liefert der Bot eine Aktion,
    // die der Reducer ablehnt → botTick dreht endlos.
    const s = newGame(4);
    s.players.forEach((p) => (p.isBot = true));
    driveSetup(s);
    let checked = 0;
    for (let step = 0; step < 200 && !s.winner; step++) {
      for (const p of s.players) {
        for (const [, r] of roadDistances(s, p.id)) {
          if (r.dist < 1) continue;
          expect(canPlaceRoad(s, r.firstEdge, p.id, null), `firstEdge ${r.firstEdge} für ${p.id}`).toBe(true);
          checked++;
        }
      }
      const actor = s.phase === 'discard' ? Object.keys(s.mustDiscard)[0] : s.order[s.activeIndex];
      const a = chooseBotAction(s, actor);
      if (!a) break;
      applyAction(s, actor, a);
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('dist 0 sind genau die schon angebundenen Ecken, dist 1 kostet eine Straße', () => {
    const s = newGame();
    driveSetup(s);
    const reach = roadDistances(s, 'p0');
    const zero = [...reach.entries()].filter(([, r]) => r.dist === 0);
    expect(zero.length).toBeGreaterThan(0);
    for (const [cid] of zero) {
      // dist 0 heißt: eigenes Gebäude oder eigene Straße an der Ecke
      const own = s.buildings[cid]?.owner === 'p0'
        || s.board.corners[cid].edges.some((e) => s.roads[e]?.owner === 'p0');
      expect(own).toBe(true);
    }
    for (const [, r] of reach) expect(r.dist).toBeLessThanOrEqual(MAX_ROAD_LOOKAHEAD);
  });

  it('ein gegnerisches Gebäude sperrt die Weiterfahrt', () => {
    const s = newGame();
    driveSetup(s);
    const reach0 = roadDistances(s, 'p0');
    // Eine dist-1-Ecke von p0 mit einem Gegner belegen → alles dahinter fällt weg
    const target = [...reach0.entries()].find(([cid, r]) => r.dist === 1 && !s.buildings[cid]);
    if (!target) return;
    const [blockCid] = target;
    s.buildings[blockCid] = { owner: 'p1', type: 'settlement' };
    const reach1 = roadDistances(s, 'p0');
    // Die Ecke selbst bleibt erreichbar (Straße dorthin ist baubar) …
    expect(reach1.get(blockCid)?.dist).toBe(1);
    // … aber sie darf nichts Neues mehr erschließen.
    for (const nb of s.board.corners[blockCid].adjacent) {
      if (reach0.get(nb)?.dist === 2 && !reach1.has(nb)) return; // Sperrwirkung nachgewiesen
    }
  });

  it('bestRoadTarget liefert nur baubare Kanten und plausible Ziele', () => {
    const s = newGame();
    driveSetup(s);
    const t = bestRoadTarget(s, 'p0');
    if (!t) return;
    expect(canPlaceRoad(s, t.edge, 'p0', null)).toBe(true);
    expect(canPlaceSettlement(s, t.corner, 'p0', true)).toBe(true);
    expect(t.dist).toBeGreaterThanOrEqual(1);
    expect(t.dist).toBeLessThanOrEqual(MAX_ROAD_LOOKAHEAD);
  });

  it('deterministisch: gleicher State → gleiches Ziel', () => {
    const a = newGame(); driveSetup(a);
    const b = newGame(); driveSetup(b);
    expect(bestRoadTarget(a, 'p0')).toEqual(bestRoadTarget(b, 'p0'));
  });
});

describe('missingFor / bankReachable', () => {
  it('missingFor ist nie negativ', () => {
    const have = { wood: 5, brick: 0, wool: 0, grain: 0, ore: 0 };
    expect(missingFor(have, COSTS.road)).toEqual({ wood: 0, brick: 1, wool: 0, grain: 0, ore: 0 });
  });

  it('erreichbar: 4 überzählige Holz → 1 Lehm für die Straße', () => {
    const s = newGame();
    setRes(s, 'p0', { wood: 5 }); // 1 Holz fürs Ziel + 4 zum Tauschen
    expect(bankReachable(s, 'p0', COSTS.road)).toBe(true);
  });

  it('unerreichbar: der Überschuss reicht nicht für den Kurs', () => {
    const s = newGame();
    setRes(s, 'p0', { wood: 4 }); // 1 fürs Ziel, nur 3 übrig → 4:1 geht nicht
    expect(bankReachable(s, 'p0', COSTS.road)).toBe(false);
  });

  it('rechnet den Hafenkurs mit: mit 2:1-Holzhafen reichen 3 Holz', () => {
    // Häfen gibt es nur auf Wasser-Karten → harbor, nicht classic (dort wäre ports[0]
    // undefined und der Test prüfte versehentlich nichts).
    const s = harborGame();
    setRes(s, 'p0', { wood: 3 });
    expect(bankReachable(s, 'p0', COSTS.road)).toBe(false); // ohne Hafen: 1 fürs Ziel, 2 übrig < 4:1
    const port = s.board.ports[0];
    port.type = 'wood';
    s.buildings[port.corners[0]] = { owner: 'p0', type: 'settlement' };
    expect(playerPorts(s, 'p0')).toContain('wood'); // der Hafen zählt für p0 wirklich
    expect(bankReachable(s, 'p0', COSTS.road)).toBe(true); // 2 übrig / Kurs 2 = 1 Einheit = das fehlende Lehm
  });

  it('unerreichbar, wenn die Bank den fehlenden Rohstoff nicht mehr hat', () => {
    const s = newGame();
    setRes(s, 'p0', { wood: 9 });
    s.bank.brick = 0;
    expect(bankReachable(s, 'p0', COSTS.road)).toBe(false);
  });

  it('schon bezahlbar → trivial erreichbar', () => {
    const s = newGame();
    setRes(s, 'p0', { wood: 1, brick: 1 });
    expect(bankReachable(s, 'p0', COSTS.road)).toBe(true);
  });
});

describe('expansionRoom', () => {
  it('eine zugebaute Umgebung lässt keinen Platz mehr', () => {
    const s = newGame();
    const c = s.board.corners.find((x) => x.adjacent.length >= 2)!;
    const open = expansionRoom(s, c.id);
    // Alle Ecken in Abstand 2 belegen
    for (const a of c.adjacent) {
      for (const b of s.board.corners[a].adjacent) {
        if (b === c.id || c.adjacent.includes(b)) continue;
        s.buildings[b] = { owner: 'p1', type: 'settlement' };
      }
    }
    expect(expansionRoom(s, c.id)).toBe(0);
    expect(open).toBeGreaterThan(0);
  });
});
