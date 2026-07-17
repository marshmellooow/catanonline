// Test-Treiber für reine Bot-Tische.
//
// WICHTIG: `nextAutoActor` spiegelt `Room.findAutoActor` (server/src/room.ts). Wer einfach
// `s.order[s.activeIndex]` nimmt, fragt bei offenem Angebot direkt den ANBIETER — der löst
// es dann auf, bevor irgendwer geantwortet hat, und der Spielerhandel wird nie getestet.

import { applyAction } from '../../src/reducer.js';
import { chooseBotAction } from '../../src/bot.js';
import type { GameState } from '../../src/types.js';

/** Wer ist als Nächstes dran? Reihenfolge wie im Server: Abwurf → Angebot → aktiver Zug. */
export function nextAutoActor(s: GameState): string | null {
  if (s.winner) return null;
  if (s.phase === 'discard') return Object.keys(s.mustDiscard)[0] ?? null;
  const o = s.tradeOffer;
  if (o) {
    const pending = s.players.find((p) => o.responses[p.id] === 'pending');
    if (pending) return pending.id;
    return o.from; // alle haben geantwortet → der Anbieter löst auf
  }
  return s.order[s.activeIndex] ?? null;
}

/** Startaufstellung per Bot-Logik durchspielen. Wirft bei Bot-Stillstand oder Reducer-Fehler. */
export function driveSetup(s: GameState): void {
  let guard = 0;
  while ((s.phase === 'setupSettlement' || s.phase === 'setupRoad') && guard++ < 200) {
    const actor = s.order[s.activeIndex];
    const a = chooseBotAction(s, actor);
    if (!a) throw new Error(`Bot fand keine Setup-Aktion in Phase ${s.phase}`);
    const r = applyAction(s, actor, a);
    if ('error' in r) throw new Error(`Setup-Fehler (${a.type}): ${r.error}`);
  }
  if (guard >= 200) throw new Error('Startaufstellung terminiert nicht');
}

export interface DriveResult {
  steps: number;
  /** Meiste Aktionen, die ein einzelner Zug gebraucht hat (Terminierungs-Maß). */
  maxActionsPerTurn: number;
  /** Meiste proposeTrade eines einzelnen Zugs (Angebots-Budget). */
  maxOffersPerTurn: number;
}

/**
 * Spielt einen Bot-Tisch bis zum Sieg oder `limit` Aktionen.
 * `onStep` läuft nach JEDER Aktion — dort gehören Invarianten hin (z. B. Kartenerhaltung).
 */
export function driveGame(s: GameState, limit: number, onStep?: (s: GameState) => void): DriveResult {
  let steps = 0;
  let actionsThisTurn = 0;
  let offersThisTurn = 0;
  let maxActionsPerTurn = 0;
  let maxOffersPerTurn = 0;
  for (; steps < limit && !s.winner; steps++) {
    const actor = nextAutoActor(s);
    if (!actor) throw new Error(`Kein Akteur in Phase ${s.phase} (Schritt ${steps})`);
    const a = chooseBotAction(s, actor);
    if (!a) throw new Error(`Bot stecken geblieben in Phase ${s.phase} (Schritt ${steps})`);
    const r = applyAction(s, actor, a);
    if ('error' in r) throw new Error(`Reducer lehnte ${a.type} in Phase ${s.phase} ab: ${r.error} (Schritt ${steps})`);
    actionsThisTurn++;
    if (a.type === 'proposeTrade') offersThisTurn++;
    if (a.type === 'endTurn') {
      if (actionsThisTurn > maxActionsPerTurn) maxActionsPerTurn = actionsThisTurn;
      if (offersThisTurn > maxOffersPerTurn) maxOffersPerTurn = offersThisTurn;
      actionsThisTurn = 0;
      offersThisTurn = 0;
    }
    onStep?.(s);
  }
  return { steps, maxActionsPerTurn, maxOffersPerTurn };
}
