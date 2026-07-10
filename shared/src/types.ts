import type { TerrainCode, ResourceType } from './design.js';
import type { PortType } from './maps.js';

// ---------- Statische Board-Geometrie (einmal berechnet, dann konstant) ----------

export interface Hex {
  id: number;
  row: number;
  col: number;
  terrain: TerrainCode;
  number: number | null;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  corners: number[]; // die 6 Ecken dieses Feldes
  neighbors: number[]; // per Kante benachbarte Hex-Ids
}

export interface Corner {
  id: number;
  x: number;
  y: number;
  hexes: number[]; // angrenzende Hex-Ids
  edges: number[]; // angrenzende Kanten-Ids
  adjacent: number[]; // per Kante benachbarte Ecken (für Abstandsregel)
  portId: number | null;
}

export interface Edge {
  id: number;
  a: number; // Ecken-Id
  b: number; // Ecken-Id
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  hexes: number[];
}

export interface Port {
  id: number;
  type: PortType;
  x: number;
  y: number;
  deg: number;
  corners: number[]; // Ecken, die den Hafen nutzen können
}

export interface Board {
  mapId: string;
  hexes: Hex[];
  corners: Corner[];
  edges: Edge[];
  ports: Port[];
  width: number;
  height: number;
  hexW: number;
}

// ---------- Rohstoffe & Entwicklungskarten ----------

export type ResourceCounts = Record<ResourceType, number>;

export type DevCardType = 'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly' | 'victoryPoint';

export type DevCardCounts = Record<DevCardType, number>;

export function emptyResources(): ResourceCounts {
  return { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

export function emptyDevCards(): DevCardCounts {
  return { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0, victoryPoint: 0 };
}

// ---------- Spielzustand ----------

export type GamePhase =
  | 'setupSettlement'
  | 'setupRoad'
  | 'roll'
  | 'discard'
  | 'moveRobber'
  | 'steal'
  | 'main'
  | 'roadBuilding'
  | 'finished';

export interface PlayerState {
  id: string;
  name: string;
  colorIndex: number;
  resources: ResourceCounts;
  devCards: DevCardCounts; // spielbar
  newDevCards: DevCardCounts; // in diesem Zug gekauft, erst nächsten Zug spielbar
  playedKnights: number;
  connected: boolean;
  isBot: boolean;
  // Bestandslimits
  settlementsLeft: number;
  citiesLeft: number;
  roadsLeft: number;
}

export interface Building {
  owner: string;
  type: 'settlement' | 'city';
}

export interface TradeOffer {
  id: string;
  from: string;
  give: ResourceCounts;
  get: ResourceCounts;
  responses: Record<string, 'accept' | 'reject' | 'pending'>;
}

export type GameEvent =
  | { t: 'roll'; player: string; dice: [number, number]; sum: number }
  | { t: 'produce'; gains: Record<string, ResourceCounts> }
  | { t: 'build'; player: string; kind: 'settlement' | 'city' | 'road'; at: number }
  | { t: 'buyDev'; player: string }
  | { t: 'playDev'; player: string; card: DevCardType }
  | { t: 'robber'; player: string; hex: number }
  // `resource` ist der konkret gestohlene Rohstoff — pro Empfänger redigiert (nur Dieb & Opfer
  // sehen ihn, sonst null). `stole` sagt öffentlich, dass eine Karte den Besitzer wechselte
  // (bleibt bei Redaktion erhalten); false, wenn das Opfer keine Karte hatte.
  | { t: 'steal'; from: string; to: string; resource: ResourceType | null; stole: boolean }
  | { t: 'discard'; player: string; count: number }
  | { t: 'trade'; from: string; to: string; give: ResourceCounts; get: ResourceCounts }
  | { t: 'bankTrade'; player: string; give: ResourceCounts; get: ResourceCounts }
  | { t: 'monopoly'; player: string; resource: ResourceType; total: number }
  | { t: 'yearOfPlenty'; player: string; resources: ResourceType[] }
  | { t: 'longestRoad'; player: string | null; prev?: string | null }
  | { t: 'largestArmy'; player: string | null }
  | { t: 'win'; player: string }
  | { t: 'turn'; player: string }
  | { t: 'info'; text: string };

export interface GameState {
  phase: GamePhase;
  players: PlayerState[];
  order: string[]; // Spieler-Ids in Sitzreihenfolge
  activeIndex: number; // Index in order
  board: Board;

  buildings: Record<number, Building>; // cornerId → Gebäude
  roads: Record<number, { owner: string }>; // edgeId → Straße
  robberHex: number;

  bank: ResourceCounts;
  devDeck: DevCardType[]; // verdeckt (nur Server), Rest-Stapel
  dice: [number, number] | null;

  // Setup
  setupRound: number; // 0 = erste Runde, 1 = zweite Runde
  setupLastSettlement: number | null; // Ecke der zuletzt in Runde 2 platzierten Siedlung

  // Nach Wurf 7
  mustDiscard: Record<string, number>;
  stealCandidates: string[];

  // Dev-Karten-Sonderzustände
  roadBuildingLeft: number;
  playedDevThisTurn: boolean;
  hasRolled: boolean;

  // Handel
  tradeOffer: TradeOffer | null;

  // Auszeichnungen
  longestRoadHolder: string | null;
  longestRoadLength: number;
  largestArmyHolder: string | null;
  largestArmySize: number;

  winner: string | null;
  vpTarget: number;

  rngState: number; // aktueller PRNG-Zustand (nur Server-relevant)
  turnCount: number;
  log: GameEvent[];
}

// ---------- Öffentliche (redigierte) Sicht für einen Spieler ----------

export interface PublicPlayer {
  id: string;
  name: string;
  colorIndex: number;
  connected: boolean;
  isBot: boolean;
  resourceCount: number; // Handkartenanzahl (Gegner)
  resources?: ResourceCounts; // nur eigene
  devCardCount: number;
  playedKnights: number;
  victoryPoints: number; // öffentlich (ohne verdeckte SP-Karten außer eigene)
  settlementsLeft: number;
  citiesLeft: number;
  roadsLeft: number;
  longestRoad: boolean;
  largestArmy: boolean;
  ports: PortType[];
  // nur eigene:
  devCards?: DevCardCounts;
  newDevCards?: DevCardCounts;
}

export interface PublicState {
  phase: GamePhase;
  players: PublicPlayer[];
  order: string[];
  activeIndex: number;
  activePlayer: string | null;
  board: Board;
  buildings: Record<number, Building>;
  roads: Record<number, { owner: string }>;
  robberHex: number;
  dice: [number, number] | null;
  mustDiscard: Record<string, number>;
  stealCandidates: string[];
  roadBuildingLeft: number;
  setupLastSettlement: number | null;
  hasRolled: boolean;
  playedDevThisTurn: boolean;
  tradeOffer: TradeOffer | null;
  longestRoadHolder: string | null;
  largestArmyHolder: string | null;
  winner: string | null;
  vpTarget: number;
  bankTotals: ResourceCounts;
  devDeckCount: number;
  turnCount: number;
  log: GameEvent[];
  you: string; // Empfänger-Id
}
