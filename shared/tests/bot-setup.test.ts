import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/reducer.js';
import { chooseBotAction } from '../src/bot.js';
import { validSettlementCorners } from '../src/logic.js';
import { evalSettlementSpot, cornerPips } from '../src/bot-eval.js';
import { RESOURCES } from '../src/design.js';
import type { GameState, Corner } from '../src/types.js';

function newGame(players = 3, seed = 2024, mapId = 'classic'): GameState {
  const g = createGame({
    mapId,
    seed,
    players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i })),
  });
  g.order = g.players.map((p) => p.id);
  return g;
}

/** Alles Land ohne Ertrag — so wirken nur die Ecken, die der Test bewusst aufwertet. */
function flattenBoard(s: GameState): void {
  for (const h of s.board.hexes) {
    if (h.terrain === 'W') continue;
    h.terrain = 'D';
    h.number = null;
  }
}

/** Zwei Ecken mit 3 Feldern, die weder benachbart sind noch ein Feld teilen. */
function twoIndependentCorners(s: GameState): [Corner, Corner] {
  const cands = s.board.corners.filter((c) => c.hexes.length === 3);
  for (const a of cands) {
    const near = new Set<number>([a.id, ...a.adjacent]);
    for (const x of a.adjacent) for (const y of s.board.corners[x].adjacent) near.add(y);
    const b = cands.find((c) => !near.has(c.id) && !c.hexes.some((h) => a.hexes.includes(h)));
    if (b) return [a, b];
  }
  throw new Error('Keine zwei unabhängigen Ecken gefunden');
}

describe('Setup-Siedlung', () => {
  it('wählt das Maximum der Bewertung unter den gültigen Plätzen (Verdrahtung)', () => {
    const s = newGame();
    const spots = validSettlementCorners(s, 'p0', true);
    let best = spots[0];
    for (const c of spots) if (evalSettlementSpot(s, c, 'p0', 'setup') > evalSettlementSpot(s, best, 'p0', 'setup')) best = c;
    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'placeSetupSettlement', corner: best });
  });

  it('nimmt Vielfalt statt roher Pip-Summe', () => {
    const s = newGame();
    flattenBoard(s);
    const [a, b] = twoIndependentCorners(s);
    // A: 3× Wald mit 6 → 15 Pips, aber nur EIN Rohstoff.
    for (const h of a.hexes) { s.board.hexes[h].terrain = 'F'; s.board.hexes[h].number = 6; }
    // B: Wald/Lehm/Erz mit 5 → 12 Pips, aber DREI Rohstoffe.
    const t = ['F', 'H', 'G'] as const;
    b.hexes.forEach((h, i) => { s.board.hexes[h].terrain = t[i]; s.board.hexes[h].number = 5; });

    const rawA = RESOURCES.reduce((x, r) => x + cornerPips(s, a.id)[r], 0);
    const rawB = RESOURCES.reduce((x, r) => x + cornerPips(s, b.id)[r], 0);
    expect(rawA).toBeGreaterThan(rawB); // A hätte die alte Pip-Summen-Logik gewonnen

    expect(chooseBotAction(s, 'p0')).toEqual({ type: 'placeSetupSettlement', corner: b.id });
  });

  it('die zweite Siedlung ergänzt, was die erste nicht liefert', () => {
    const s = newGame();
    flattenBoard(s);
    const cands = s.board.corners.filter((c) => c.hexes.length === 3);
    // Drei paarweise unabhängige Ecken: W (schon besiedelt, Holz), X (nochmal Holz), Y (neue Rohstoffe).
    const picked: Corner[] = [];
    const blocked = new Set<number>();
    for (const c of cands) {
      if (blocked.has(c.id) || c.hexes.some((h) => picked.some((p) => p.hexes.includes(h)))) continue;
      picked.push(c);
      blocked.add(c.id);
      for (const x of c.adjacent) { blocked.add(x); for (const y of s.board.corners[x].adjacent) blocked.add(y); }
      if (picked.length === 3) break;
    }
    expect(picked.length).toBe(3);
    const [w, x, y] = picked;

    for (const h of w.hexes) { s.board.hexes[h].terrain = 'F'; s.board.hexes[h].number = 6; }
    for (const h of x.hexes) { s.board.hexes[h].terrain = 'F'; s.board.hexes[h].number = 6; } // mehr Holz
    // Terrain-Codes: F=Holz, H=Lehm, P=Wolle, G=Getreide, M=Erz, D=Wüste, W=Wasser.
    const t = ['H', 'G', 'M'] as const;
    y.hexes.forEach((h, i) => { s.board.hexes[h].terrain = t[i]; s.board.hexes[h].number = 6; }); // Lehm/Getreide/Erz

    s.buildings[w.id] = { owner: 'p0', type: 'settlement' }; // erste Siedlung: reines Holz
    const a = chooseBotAction(s, 'p0')!;
    expect(a.type).toBe('placeSetupSettlement');
    const chosen = (a as { corner: number }).corner;

    // Nicht auf die exakte Ecke festnageln: Nachbarecken greifen dieselben Hexfelder ab
    // und sind ähnlich gut. Geprüft wird die Aussage selbst — der Bot holt neue Rohstoffe
    // statt nochmal Holz.
    expect(chosen).not.toBe(x.id); // X wäre in reinen Pips gleich stark wie Y
    const pips = cornerPips(s, chosen);
    const fresh = RESOURCES.filter((r) => r !== 'wood' && pips[r] > 0);
    expect(fresh.length, `Ecke ${chosen} liefert nur ${JSON.stringify(pips)}`).toBeGreaterThan(0);
  });
});

describe('Setup-Straße', () => {
  it('grenzt über alle Seeds und Karten immer an die eben gesetzte Siedlung', () => {
    // Reducer-Spiegel: canPlaceRoad(..., state.setupLastSettlement). Bricht das, lehnt
    // der Reducer ab und der botTick dreht endlos.
    for (const mapId of ['classic', 'coast', 'harbor', 'lakes', 'continent']) {
      for (const seed of [1, 7, 42, 2024]) {
        const s = newGame(4, seed, mapId);
        s.players.forEach((p) => (p.isBot = true));
        let guard = 0;
        while ((s.phase === 'setupSettlement' || s.phase === 'setupRoad') && guard++ < 200) {
          const active = s.order[s.activeIndex];
          const a = chooseBotAction(s, active);
          expect(a, `${mapId}/${seed}: keine Setup-Aktion in ${s.phase}`).not.toBeNull();
          if (a!.type === 'placeSetupRoad') {
            const last = s.setupLastSettlement!;
            const e = s.board.edges[a!.edge];
            expect(e.a === last || e.b === last, `${mapId}/${seed}: Kante ${a!.edge} grenzt nicht an ${last}`).toBe(true);
          }
          const r = applyAction(s, active, a!);
          expect('events' in r, `${mapId}/${seed}: Reducer lehnte ${a!.type} ab`).toBe(true);
        }
        expect(s.phase).toBe('roll'); // Aufstellung sauber durchgelaufen
      }
    }
  });

  it('zeigt zu einem Bauplatz statt in die Küsten-Sackgasse', () => {
    // Wasser-Karte: eine der Kanten an der Siedlung führt aufs offene Wasser hinaus,
    // die andere ins Landesinnere. Die alte „erste gültige Kante" nahm, was die
    // Kanten-Id hergab; jetzt muss die landeinwärts zeigende gewinnen.
    const s = newGame(3, 7, 'coast');
    s.players.forEach((p) => (p.isBot = true));
    let guard = 0;
    let checked = 0;
    while ((s.phase === 'setupSettlement' || s.phase === 'setupRoad') && guard++ < 200) {
      const active = s.order[s.activeIndex];
      const a = chooseBotAction(s, active)!;
      if (a.type === 'placeSetupRoad') {
        const last = s.setupLastSettlement!;
        const e = s.board.edges[a.edge];
        const far = e.a === last ? e.b : e.a;
        // Die gewählte Zielecke muss mindestens eine freie Fortsetzung an Land haben.
        const canGoOn = s.board.corners[far].edges.some(
          (eid) => !s.roads[eid] && s.board.edges[eid].hexes.some((h) => s.board.hexes[h].terrain !== 'W'),
        );
        expect(canGoOn, `Sackgasse: Kante ${a.edge} → Ecke ${far}`).toBe(true);
        checked++;
      }
      applyAction(s, active, a);
    }
    expect(checked).toBe(6); // 3 Spieler × 2 Runden
  });
});

describe('Determinismus', () => {
  it('gleicher Seed → identische Aufstellung', () => {
    const run = (): string => {
      const s = newGame(4, 99);
      s.players.forEach((p) => (p.isBot = true));
      let guard = 0;
      const acts: string[] = [];
      while ((s.phase === 'setupSettlement' || s.phase === 'setupRoad') && guard++ < 200) {
        const active = s.order[s.activeIndex];
        const a = chooseBotAction(s, active)!;
        acts.push(`${active}:${JSON.stringify(a)}`);
        applyAction(s, active, a);
      }
      return acts.join('|');
    };
    expect(run()).toBe(run());
  });
});
