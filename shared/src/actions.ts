import type { ResourceCounts } from './types.js';
import type { ResourceType } from './design.js';

// Jede Spielhandlung ist eine serialisierbare Action.
export type GameAction =
  | { type: 'placeSetupSettlement'; corner: number }
  | { type: 'placeSetupRoad'; edge: number }
  | { type: 'rollDice' }
  | { type: 'buildRoad'; edge: number }
  | { type: 'buildSettlement'; corner: number }
  | { type: 'buildCity'; corner: number }
  | { type: 'buyDevCard' }
  | { type: 'playKnight' }
  | { type: 'playRoadBuilding' }
  | { type: 'playYearOfPlenty'; resources: [ResourceType, ResourceType] }
  | { type: 'playMonopoly'; resource: ResourceType }
  | { type: 'moveRobber'; hex: number }
  | { type: 'steal'; victim: string }
  | { type: 'discard'; resources: Partial<ResourceCounts> }
  | { type: 'bankTrade'; give: ResourceType; get: ResourceType }
  | { type: 'proposeTrade'; give: Partial<ResourceCounts>; get: Partial<ResourceCounts> }
  | { type: 'respondTrade'; offerId: string; accept: boolean }
  | { type: 'confirmTrade'; offerId: string; withPlayer: string }
  | { type: 'cancelTrade' }
  | { type: 'endTurn' };

export type ActionResult = { ok: true } | { ok: false; error: string };
