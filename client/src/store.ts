import { create } from 'zustand';
import type { RoomState, PublicState, GameEvent, ServerMsg, GameAction } from '@catan/shared';
import { initConnection, send, type ConnStatus } from './net/connection';

const LS_SESSION = 'catan.sessionId';
const LS_NAME = 'catan.name';
const LS_UISCALE = 'catan.uiScale';

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.35;
export const UI_SCALE_DEFAULT = 1.1;

function loadUiScale(): number {
  const raw = Number(localStorage.getItem(LS_UISCALE));
  if (!Number.isFinite(raw) || raw <= 0) return UI_SCALE_DEFAULT;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, raw));
}

export interface ChatEntry {
  from: string;
  name: string;
  colorIndex: number;
  text: string;
  ts: number;
  dice?: [number, number]; // gesetzt = Würfel-Eintrag (statt Textnachricht)
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
  turnDeadline: number | null; // lokaler Ablaufzeitpunkt (epoch ms) des Zug-Countdowns; null = aus/kein Limit
  chat: ChatEntry[];
  toasts: Toast[];
  lastEvents: GameEvent[];
  notFound: string | null;
  diceNonce: number; // erhöht bei jedem Wurf → triggert Würfel-Animation
  everOnline: boolean; // wurde schon mind. einmal verbunden → steuert Boot-Splash vs. Reconnect-Overlay
  booting: boolean; // initialer Ladebildschirm sichtbar
  gameStarting: boolean; // Spielstart-Intro (Insel baut sich auf) sichtbar
  uiScale: number; // UI-Skalierung (Karten/Bank/Feed) — persistiert

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
  setUiScale: (n: number) => void;
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
  turnDeadline: null,
  chat: [],
  toasts: [],
  lastEvents: [],
  notFound: null,
  diceNonce: 0,
  everOnline: false,
  booting: true,
  gameStarting: false,
  uiScale: loadUiScale(),

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
  setUiScale: (n) => {
    const v = Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, Math.round(n * 100) / 100));
    localStorage.setItem(LS_UISCALE, String(v));
    set({ uiScale: v });
  },
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
      const trm = msg.turnRemainingMs;
      const turnDeadline = typeof trm === 'number' ? Date.now() + trm : null;
      set({ game: msg.state, screen: 'game', turnDeadline, ...(wasLobby ? { gameStarting: true } : {}) });
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
      // Wurf als Chat-Eintrag (mit Würfel-Symbolen) protokollieren — für alle sichtbar.
      const g = get().game;
      const pl = g?.players.find((p) => p.id === ev.player);
      const entry: ChatEntry = {
        from: ev.player,
        name: pl?.name ?? '',
        colorIndex: pl?.colorIndex ?? -1,
        text: '',
        ts: Date.now(),
        dice: ev.dice,
      };
      useStore.setState((s) => ({ chat: [...s.chat.slice(-80), entry] }));
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
