import type { GameState, PlayerState, DevCardType } from './types.js';
import { emptyResources, emptyDevCards } from './types.js';
import { buildBoard, initialRobberHex } from './board.js';
import { createRng, shuffle } from './rng.js';

export interface PlayerConfig {
  id: string;
  name: string;
  colorIndex: number;
  isBot?: boolean;
}

export interface GameConfig {
  players: PlayerConfig[];
  mapId: string;
  seed: number;
  vpTarget?: number;
  bankSize?: number; // Karten je Rohstoff in der Bank (Standard 19)
}

function buildDevDeck(): DevCardType[] {
  const deck: DevCardType[] = [];
  for (let i = 0; i < 14; i++) deck.push('knight');
  for (let i = 0; i < 2; i++) deck.push('roadBuilding');
  for (let i = 0; i < 2; i++) deck.push('yearOfPlenty');
  for (let i = 0; i < 2; i++) deck.push('monopoly');
  for (let i = 0; i < 5; i++) deck.push('victoryPoint');
  return deck;
}

/** Bank-Startbestand je Rohstoff (geklemmt auf 3–50, Standard 19; robust gegen NaN). */
export function bankOf(size: number | undefined): GameState['bank'] {
  const raw = Math.floor(Number(size));
  const n = Number.isFinite(raw) ? Math.max(3, Math.min(50, raw)) : 19;
  return { wood: n, brick: n, wool: n, grain: n, ore: n };
}

export function createGame(config: GameConfig): GameState {
  const board = buildBoard(config.mapId, config.seed);
  const rng = createRng(config.seed);
  const devDeck = shuffle(rng, buildDevDeck());

  // Startreihenfolge einmal zufällig auslosen — wer zuerst dran ist (und die gesamte
  // Zugfolge) wird bei jedem Spielstart neu gemischt. Eigener RNG-Strom, damit Würfel
  // und Dev-Deck unverändert/reproduzierbar bleiben. Die Spielerleiste zeigt `order`.
  const orderRng = createRng((config.seed ^ 0x5bd1e995) >>> 0);
  const order = shuffle(orderRng, config.players.map((p) => p.id));

  const players: PlayerState[] = config.players.map((pc) => ({
    id: pc.id,
    name: pc.name,
    colorIndex: pc.colorIndex,
    resources: emptyResources(),
    devCards: emptyDevCards(),
    newDevCards: emptyDevCards(),
    playedKnights: 0,
    connected: true,
    isBot: !!pc.isBot,
    // Kein Bau-Limit für Siedlungen/Städte (bewusst „unbegrenzt"): hoch angesetzt,
    // das echte Limit sind die Bauplätze/Rohstoffe auf dem Brett. Straßen bleiben klassisch (15).
    settlementsLeft: 99,
    citiesLeft: 99,
    roadsLeft: 15,
  }));

  return {
    phase: 'setupSettlement',
    players,
    order,
    activeIndex: 0,
    board,
    buildings: {},
    roads: {},
    robberHex: initialRobberHex(board),
    bank: bankOf(config.bankSize),
    devDeck,
    dice: null,
    setupRound: 0,
    setupLastSettlement: null,
    mustDiscard: {},
    stealCandidates: [],
    roadBuildingLeft: 0,
    playedDevThisTurn: false,
    hasRolled: false,
    tradeOffer: null,
    tradeSeq: 0,
    longestRoadHolder: null,
    longestRoadLength: 0,
    largestArmyHolder: null,
    largestArmySize: 0,
    winner: null,
    vpTarget: config.vpTarget ?? 10,
    rngState: rng.s,
    turnCount: 0,
    log: [],
  };
}
