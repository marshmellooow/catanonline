import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction } from '../src/reducer.js';
import { chooseBotAction } from '../src/bot.js';
import { redactEventFor, redactEventsFor, toPublicState } from '../src/view.js';
import type { GameState, GameEvent } from '../src/types.js';

function newGame(players = 3): GameState {
  return createGame({ mapId: 'classic', seed: 7, players: Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, colorIndex: i })) });
}
function driveSetup(s: GameState) {
  let g = 0;
  while ((s.phase === 'setupSettlement' || s.phase === 'setupRoad') && g++ < 200) {
    const a = chooseBotAction(s, s.order[s.activeIndex])!;
    applyAction(s, s.order[s.activeIndex], a);
  }
}
const stealEventOf = (log: GameEvent[]) => log.find((e): e is Extract<GameEvent, { t: 'steal' }> => e.t === 'steal');

describe('Steal-Event Redaktion (Informationsleck)', () => {
  it('redactEventFor: nur Dieb und Opfer sehen den Rohstoff, Dritte erhalten null', () => {
    const ev: GameEvent = { t: 'steal', from: 'p1', to: 'p0', resource: 'wood', stole: true };
    // Dieb (to) und Opfer (from) sehen den echten Rohstoff
    expect(redactEventFor(ev, 'p0')).toEqual(ev);
    expect(redactEventFor(ev, 'p1')).toEqual(ev);
    // Dritter sieht resource: null — aber das stole-Flag bleibt erhalten (Zeile „X stiehlt von Y")
    expect(redactEventFor(ev, 'p2')).toEqual({ t: 'steal', from: 'p1', to: 'p0', resource: null, stole: true });
    // unbeteiligter/anonymer Betrachter (z. B. Zuschauer) ebenfalls null, stole bleibt true
    expect(redactEventFor(ev, 's_zuschauer')).toEqual({ t: 'steal', from: 'p1', to: 'p0', resource: null, stole: true });
    // Original bleibt unverändert (keine Mutation)
    expect(ev.resource).toBe('wood');
  });

  it('redactEventFor: andere Event-Typen bleiben unverändert', () => {
    const roll: GameEvent = { t: 'roll', player: 'p0', dice: [3, 4], sum: 7 };
    expect(redactEventFor(roll, 'p2')).toBe(roll);
    // ein Steal ohne gestohlene Karte (Opfer hatte nichts) ist bereits null/false und bleibt so
    const empty: GameEvent = { t: 'steal', from: 'p1', to: 'p0', resource: null, stole: false };
    expect(redactEventsFor([empty], 'p2')).toEqual([empty]);
  });

  it('toPublicState.log: Dritte sehen den gestohlenen Rohstoff nicht, Dieb/Opfer schon', () => {
    const s = newGame(3);
    driveSetup(s);
    s.phase = 'main';
    s.hasRolled = true;
    s.players[0].devCards.knight = 1;
    // Zielfeld mit p1-Gebäude, p1 hält genau 1 Holz → Diebstahl von Holz ist erzwungen
    const hex = s.board.hexes.find((h) => h.terrain !== 'W' && h.id !== s.robberHex)!;
    // Feld leeren, damit p1 der EINZIGE Kandidat ist (unabhängig vom Board-Layout/Bot-Setup)
    for (const c of hex.corners) delete s.buildings[c];
    s.buildings[hex.corners[0]] = { owner: 'p1', type: 'settlement' };
    s.players[1].resources = { wood: 1, brick: 0, wool: 0, grain: 0, ore: 0 };
    applyAction(s, 'p0', { type: 'playKnight' });
    applyAction(s, 'p0', { type: 'moveRobber', hex: hex.id }); // ein Kandidat → automatischer Steal

    // Der Server-State kennt den echten Rohstoff
    expect(stealEventOf(s.log)?.resource).toBe('wood');

    // Dieb (p0) und Opfer (p1) sehen 'wood' in ihrem redigierten Log
    expect(stealEventOf(toPublicState(s, 'p0').log)?.resource).toBe('wood');
    expect(stealEventOf(toPublicState(s, 'p1').log)?.resource).toBe('wood');
    // Dritter (p2) und ein Zuschauer sehen resource: null ...
    expect(stealEventOf(toPublicState(s, 'p2').log)?.resource).toBeNull();
    expect(stealEventOf(toPublicState(s, 's_zuschauer').log)?.resource).toBeNull();
    // ... sehen aber weiterhin, DASS gestohlen wurde (stole bleibt true → „X stiehlt von Y")
    expect(stealEventOf(toPublicState(s, 'p2').log)?.stole).toBe(true);
    expect(stealEventOf(toPublicState(s, 's_zuschauer').log)?.stole).toBe(true);
  });
});
