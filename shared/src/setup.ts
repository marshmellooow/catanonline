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
    settlementsLeft: 5,
    citiesLeft: 4,
    roadsLeft: 15,
  }));

  return {
    phase: 'setupSettlement',
    players,
    order: config.players.map((p) => p.id),
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
