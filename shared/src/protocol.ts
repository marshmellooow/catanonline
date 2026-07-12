// Netzwerk-Protokoll (JSON über WebSocket). Von Client & Server geteilt.

import type { GameAction } from './actions.js';
import type { PublicState, GameEvent } from './types.js';

export type RoomPhase = 'lobby' | 'playing' | 'finished';

export interface LobbyPlayer {
  id: string;
  name: string;
  colorIndex: number;
  ready: boolean;
  isHost: boolean;
  connected: boolean;
  isBot: boolean;
  seat: number;
}

export interface RoomState {
  code: string;
  phase: RoomPhase;
  mapId: string;
  vpTarget: number;
  bankSize: number;
  turnSeconds: number; // Zug-Countdown in Sekunden (0 = aus)
  players: LobbyPlayer[];
  spectators: { id: string; name: string }[];
  hostId: string;
  minPlayers: number;
  maxPlayers: number;
  // Latenz je Spieler (ms), vom Server gepflegt
  ping: Record<string, number>;
}

// ---------- Client → Server ----------
export type ClientMsg =
  | { t: 'createRoom'; name: string; colorIndex?: number }
  | { t: 'joinRoom'; code: string; name: string }
  | { t: 'rejoin'; sessionId: string }
  | { t: 'setReady'; ready: boolean }
  | { t: 'setColor'; colorIndex: number }
  | { t: 'setName'; name: string }
  | { t: 'chooseMap'; mapId: string }
  | { t: 'setOption'; vpTarget: number }
  | { t: 'setBankSize'; bankSize: number }
  | { t: 'setTurnTime'; turnSeconds: number }
  | { t: 'kick'; playerId: string }
  | { t: 'replaceWithBot'; playerId: string }
  | { t: 'addBot' }
  | { t: 'removeBot'; playerId: string }
  | { t: 'startGame' }
  | { t: 'returnToLobby' }
  | { t: 'leaveRoom' }
  | { t: 'action'; action: GameAction }
  | { t: 'chat'; text: string }
  | { t: 'ping'; ts: number };

// ---------- Server → Client ----------
export type ServerMsg =
  | { t: 'welcome'; sessionId: string; playerId: string; code: string }
  | { t: 'roomState'; room: RoomState; you: string }
  | { t: 'gameState'; state: PublicState; turnRemainingMs?: number; discardRemainingMs?: number }
  | { t: 'event'; events: GameEvent[] }
  | { t: 'chat'; from: string; name: string; colorIndex: number; text: string; ts: number }
  | { t: 'error'; message: string }
  | { t: 'pong'; ts: number }
  | { t: 'kicked' }
  | { t: 'roomClosed' }
  | { t: 'notFound'; reason: string };

// Konstanten
export const GRACE_MS = 90_000; // Reconnect-Frist bei Verbindungsverlust
export const EMPTY_ROOM_TTL_MS = 120_000; // leere Räume nach dieser Zeit löschen
export const BOT_MOVE_DELAY_MS = 700; // Bot-Zug-Verzögerung (spürbar, nicht hektisch)
export const AUTO_ROLL_MS = 3_000; // Roll-Phase: nach dieser Zeit automatisch für den Spieler würfeln
export const DEFAULT_TURN_SECONDS = 60; // Zug-Countdown-Standard (0 = aus)
export const TURN_TIME_OPTIONS = [0, 30, 60, 90, 120] as const; // wählbar in der Lobby
