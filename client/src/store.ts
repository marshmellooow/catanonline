import { create } from 'zustand';
import type { RoomState, PublicState, GameEvent, ServerMsg, GameAction } from '@catan/shared';
import { initConnection, send, type ConnStatus } from './net/connection';

const LS_SESSION = 'catan.sessionId';
const LS_NAME = 'catan.name';

export interface ChatEntry {
  from: string;
  name: string;
  colorIndex: number;
  text: string;
  ts: number;
}
export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'turn';
}

interface StoreState {
  status: ConnStatus;
  screen: 'home' | 'lobby' | 'game';
  sessionId: string | null;
  playerId: string | null;
  code: string | null;
  name: string;
  room: RoomState | null;
  game: PublicState | null;
  chat: ChatEntry[];
  toasts: Toast[];
  lastEvents: GameEvent[];
  notFound: string | null;
  diceNonce: number; // erhöht bei jedem Wurf → triggert Würfel-Animation
  everOnline: boolean; // wurde schon mind. einmal verbunden → steuert Boot-Splash vs. Reconnect-Overlay
  booting: boolean; // initialer Ladebildschirm sichtbar
  gameStarting: boolean; // Spielstart-Intro (Insel baut sich auf) sichtbar

  init: () => void;
  setName: (name: string) => void;
  createRoom: (name: string) => void;
  joinRoom: (code: string, name: string) => void;
  leaveRoom: () => void;
  returnToLobby: () => void;
  act: (action: GameAction) => void;
  sendMsg: typeof send;
  pushToast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  clearNotFound: () => void;
  finishBoot: () => void;
  endGameStart: () => void;
}

let toastId = 1;

export const useStore = create<StoreState>((set, get) => ({
  status: 'connecting',
  screen: 'home',
  sessionId: localStorage.getItem(LS_SESSION),
  playerId: null,
  code: null,
  name: localStorage.getItem(LS_NAME) ?? '',
  room: null,
  game: null,
  chat: [],
  toasts: [],
  lastEvents: [],
  notFound: null,
  diceNonce: 0,
  everOnline: false,
  booting: true,
  gameStarting: false,

  init: () => {
    initConnection({
      getSessionId: () => get().sessionId,
      onStatus: (status) => set(status === 'online' ? { status, everOnline: true } : { status }),
      onMessage: (msg) => handleMessage(msg, set, get),
    });
  },

  setName: (name) => {
    localStorage.setItem(LS_NAME, name);
    set({ name });
  },
  createRoom: (name) => {
    get().setName(name);
    send({ t: 'createRoom', name });
  },
  joinRoom: (code, name) => {
    get().setName(name);
    send({ t: 'joinRoom', code: code.toUpperCase(), name });
  },
  leaveRoom: () => {
    send({ t: 'leaveRoom' });
    localStorage.removeItem(LS_SESSION);
    set({ screen: 'home', room: null, game: null, sessionId: null, playerId: null, code: null, chat: [], gameStarting: false });
  },
  returnToLobby: () => send({ t: 'returnToLobby' }),
  act: (action) => send({ t: 'action', action }),
  sendMsg: send,
  pushToast: (text, kind = 'info') => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
    setTimeout(() => get().dismissToast(id), 4200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clearNotFound: () => set({ notFound: null }),
  finishBoot: () => set({ booting: false }),
  endGameStart: () => set({ gameStarting: false }),
}));

function handleMessage(msg: ServerMsg, set: (p: Partial<StoreState>) => void, get: () => StoreState) {
  switch (msg.t) {
    case 'welcome': {
      localStorage.setItem(LS_SESSION, msg.sessionId);
      set({ sessionId: msg.sessionId, playerId: msg.playerId, code: msg.code });
      break;
    }
    case 'roomState': {
      const prev = get().room;
      const wasLobby = get().screen === 'lobby';
      const screen = msg.room.phase === 'lobby' ? 'lobby' : 'game';
      // Frischer Spielstart aus der Lobby → Intro-Ladescreen für alle Spieler zeigen.
      const startingNow = wasLobby && screen === 'game';
      // Zurück in die Lobby (z. B. Rematch nach Spielende) → altes Spiel verwerfen.
      set({ room: msg.room, playerId: msg.you, screen, ...(startingNow ? { gameStarting: true } : {}), ...(msg.room.phase === 'lobby' ? { game: null } : {}) });
      // Toast bei Verbindungswechsel eines Mitspielers
      if (prev && prev.phase === msg.room.phase) {
        for (const p of msg.room.players) {
          const before = prev.players.find((x) => x.id === p.id);
          if (before && before.connected && !p.connected) get().pushToast(`${p.name} hat die Verbindung verloren`, 'bad');
          if (before && !before.connected && p.connected) get().pushToast(`${p.name} ist wieder da`, 'good');
        }
      }
      break;
    }
    case 'gameState': {
      const prev = get().game;
      const wasLobby = get().screen === 'lobby';
      set({ game: msg.state, screen: 'game', ...(wasLobby ? { gameStarting: true } : {}) });
      // „Du bist dran"-Toast
      if (
        msg.state.activePlayer === msg.state.you &&
        (!prev || prev.activePlayer !== msg.state.you) &&
        msg.state.phase !== 'finished'
      ) {
        get().pushToast('Du bist am Zug', 'turn');
      }
      break;
    }
    case 'event': {
      set({ lastEvents: msg.events });
      handleEvents(msg.events, get);
      break;
    }
    case 'chat': {
      set({ chat: [...get().chat.slice(-80), { from: msg.from, name: msg.name, colorIndex: msg.colorIndex, text: msg.text, ts: msg.ts }] });
      break;
    }
    case 'error':
      get().pushToast(msg.message, 'bad');
      break;
    case 'kicked':
      localStorage.removeItem(LS_SESSION);
      set({ screen: 'home', room: null, game: null, sessionId: null, notFound: 'Du wurdest aus dem Raum entfernt.' });
      break;
    case 'roomClosed':
      set({ screen: 'home', room: null, game: null });
      break;
    case 'notFound':
      localStorage.removeItem(LS_SESSION);
      set({ notFound: msg.reason, sessionId: null, screen: 'home' });
      break;
    case 'pong':
      break;
  }
}

function handleEvents(events: GameEvent[], get: () => StoreState) {
  const me = get().playerId;
  for (const ev of events) {
    if (ev.t === 'roll') {
      useStore.setState((s) => ({ diceNonce: s.diceNonce + 1 }));
    } else if (ev.t === 'steal' && ev.to === me && ev.stole) {
      get().pushToast('Du hast eine Karte gestohlen', 'good');
    } else if (ev.t === 'steal' && ev.from === me && ev.stole) {
      get().pushToast('Dir wurde eine Karte gestohlen', 'bad');
    } else if (ev.t === 'monopoly' && ev.player !== me) {
      get().pushToast(`Monopol: ${ev.total} Karten eingezogen`, 'bad');
    } else if (ev.t === 'win') {
      get().pushToast('Spiel beendet!', 'turn');
    }
  }
}
