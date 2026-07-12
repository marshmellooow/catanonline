import type { WebSocket } from 'ws';
import {
  createGame, applyAction, toPublicState, redactEventsFor, chooseBotAction, getMap,
  GRACE_MS, BOT_MOVE_DELAY_MS, AUTO_ROLL_MS, DEFAULT_TURN_SECONDS,
  type GameState, type GameAction, type GameEvent,
  type ServerMsg, type RoomState, type LobbyPlayer,
} from '@catan/shared';

export interface RoomPlayer {
  id: string;
  sessionId: string;
  name: string;
  colorIndex: number;
  ready: boolean;
  connected: boolean;
  isBot: boolean;
  auto: boolean; // temporär vom Bot gesteuert (nach Disconnect-Grace / Host-Ersatz)
  seat: number;
  socket: WebSocket | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  ping: number;
}

const OPEN = 1; // WebSocket.OPEN

export interface RoomHooks {
  onEmpty(code: string): void;
}

export class Room {
  code: string;
  phase: 'lobby' | 'playing' | 'finished' = 'lobby';
  mapId = 'classic';
  vpTarget = 10;
  bankSize = 19;
  turnSeconds = DEFAULT_TURN_SECONDS;
  hostId = '';
  players: RoomPlayer[] = [];
  spectators: { id: string; name: string; socket: WebSocket | null }[] = [];
  game: GameState | null = null;

  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private emptyTimer: ReturnType<typeof setTimeout> | null = null;
  // Auto-Würfeln (Roll-Phase eines verbundenen Menschen): würfelt nach AUTO_ROLL_MS selbst.
  private rollTimer: ReturnType<typeof setTimeout> | null = null;
  // Zug-Countdown: pro Zug eines verbundenen Menschen; bei Ablauf beendet die Bot-Logik den Zug.
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnTimerPlayerId: string | null = null; // Zug-Eigner, für den die Frist läuft
  private turnDeadline = 0; // epoch ms, Ablaufzeitpunkt des aktuellen Zugs
  private botSeq = 0; // monoton, damit Bot-Namen nie kollidieren
  private hooks: RoomHooks;

  constructor(code: string, hooks: RoomHooks) {
    this.code = code;
    this.hooks = hooks;
  }

  // ---------- Hilfen ----------
  private mapDef() {
    return getMap(this.mapId === 'random' ? 'classic' : this.mapId);
  }
  get maxPlayers() {
    return this.mapDef()?.maxPlayers ?? 4;
  }
  get minPlayers() {
    return 2;
  }
  findPlayer(id: string): RoomPlayer | undefined {
    return this.players.find((p) => p.id === id);
  }
  private freeColor(): number {
    const taken = new Set(this.players.map((p) => p.colorIndex));
    for (let i = 0; i < 10; i++) if (!taken.has(i)) return i;
    return 0;
  }
  private connectedHumans(): RoomPlayer[] {
    return this.players.filter((p) => p.connected && !p.isBot);
  }

  private send(socket: WebSocket | null, msg: ServerMsg) {
    if (socket && socket.readyState === OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  // ---------- Lobby: Beitritt / Verlassen ----------
  addPlayer(sessionId: string, name: string, colorIndex: number | undefined, socket: WebSocket): RoomPlayer {
    const id = 'p_' + Math.random().toString(36).slice(2, 10);
    const color = colorIndex !== undefined && !this.players.some((p) => p.colorIndex === colorIndex) ? colorIndex : this.freeColor();
    const player: RoomPlayer = {
      id, sessionId, name: name.slice(0, 20) || 'Spieler',
      colorIndex: color, ready: false, connected: true, isBot: false, auto: false,
      seat: this.players.length, socket, disconnectTimer: null, ping: 0,
    };
    this.players.push(player);
    if (!this.hostId) this.hostId = id;
    this.cancelEmptyTimer();
    return player;
  }

  addSpectator(name: string, socket: WebSocket): string {
    const id = 's_' + Math.random().toString(36).slice(2, 10);
    this.spectators.push({ id, name: name.slice(0, 20) || 'Zuschauer', socket });
    return id;
  }

  /** Beitritt: im Lobby-Zustand als Spieler (wenn Platz), sonst Zuschauer. */
  join(sessionId: string, name: string, socket: WebSocket): { playerId: string; isSpectator: boolean } {
    if (this.phase === 'lobby' && this.players.length < this.maxPlayers) {
      const p = this.addPlayer(sessionId, name, undefined, socket);
      this.broadcastRoom();
      return { playerId: p.id, isSpectator: false };
    }
    const id = this.addSpectator(name, socket);
    this.broadcastRoom();
    return { playerId: id, isSpectator: true };
  }

  removePlayer(playerId: string) {
    const p = this.findPlayer(playerId);
    if (!p) {
      this.spectators = this.spectators.filter((s) => s.id !== playerId);
      this.broadcastRoom();
      return;
    }
    if (this.phase === 'lobby') {
      // Sitz freigeben
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
      this.players = this.players.filter((x) => x.id !== playerId);
      this.players.forEach((x, i) => (x.seat = i));
      this.migrateHostIfNeeded();
    } else {
      // Im Spiel: Sitz bleibt, Bot übernimmt
      p.connected = false;
      p.auto = true;
      p.socket = null;
      this.migrateHostIfNeeded();
      this.scheduleTimers();
    }
    this.checkEmpty();
    this.broadcastRoom();
    this.broadcastGame();
  }

  // ---------- Reconnect ----------
  reattach(playerId: string, socket: WebSocket): boolean {
    const p = this.findPlayer(playerId);
    if (p) {
      if (p.disconnectTimer) {
        clearTimeout(p.disconnectTimer);
        p.disconnectTimer = null;
      }
      p.socket = socket;
      p.connected = true;
      p.auto = false; // Mensch übernimmt wieder
      this.cancelEmptyTimer();
      this.broadcastRoom();
      this.sendGameTo(p);
      return true;
    }
    const spec = this.spectators.find((s) => s.id === playerId);
    if (spec) {
      spec.socket = socket;
      this.sendRoomTo(spec.socket, playerId);
      if (this.game) this.send(spec.socket, { t: 'gameState', state: toPublicState(this.game, playerId), turnRemainingMs: this.turnRemainingMs() });
      return true;
    }
    return false;
  }

  handleDisconnect(playerId: string) {
    const p = this.findPlayer(playerId);
    if (p) {
      p.socket = null;
      p.connected = false;
      if (this.phase === 'lobby') {
        // sofort Sitz freigeben
        this.players = this.players.filter((x) => x.id !== playerId);
        this.players.forEach((x, i) => (x.seat = i));
        this.migrateHostIfNeeded();
        this.checkEmpty();
        this.broadcastRoom();
        return;
      }
      // Im Spiel: Grace-Frist, danach Bot-Übernahme
      this.migrateHostIfNeeded();
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
      p.disconnectTimer = setTimeout(() => {
        p.auto = true;
        p.disconnectTimer = null;
        this.broadcastRoom();
        this.scheduleTimers();
        this.checkEmpty();
      }, GRACE_MS);
      this.broadcastRoom();
      this.checkEmpty();
      return;
    }
    const spec = this.spectators.find((s) => s.id === playerId);
    if (spec) {
      this.spectators = this.spectators.filter((s) => s.id !== playerId);
      this.checkEmpty();
    }
  }

  private migrateHostIfNeeded() {
    const host = this.findPlayer(this.hostId);
    if (host && host.connected && !host.isBot) return;
    const next = this.connectedHumans().sort((a, b) => a.seat - b.seat)[0];
    if (next) this.hostId = next.id;
  }

  private checkEmpty() {
    if (this.connectedHumans().length === 0) {
      if (!this.emptyTimer) {
        this.emptyTimer = setTimeout(() => this.destroy(), 120_000);
      }
    } else {
      this.cancelEmptyTimer();
    }
  }
  private cancelEmptyTimer() {
    if (this.emptyTimer) {
      clearTimeout(this.emptyTimer);
      this.emptyTimer = null;
    }
  }
  private destroy() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.clearRollTimer();
    this.clearTurnTimer();
    for (const p of this.players) if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    this.hooks.onEmpty(this.code);
  }

  // ---------- Lobby-Einstellungen ----------
  setReady(playerId: string, ready: boolean) {
    const p = this.findPlayer(playerId);
    if (p) p.ready = ready;
    this.broadcastRoom();
  }
  setColor(playerId: string, colorIndex: number) {
    if (colorIndex < 0 || colorIndex > 9) return;
    if (this.players.some((p) => p.id !== playerId && p.colorIndex === colorIndex)) return;
    const p = this.findPlayer(playerId);
    if (p && this.phase === 'lobby') p.colorIndex = colorIndex;
    this.broadcastRoom();
  }
  setName(playerId: string, name: string) {
    const p = this.findPlayer(playerId);
    if (p) p.name = name.slice(0, 20) || 'Spieler';
    this.broadcastRoom();
  }
  chooseMap(playerId: string, mapId: string) {
    if (playerId !== this.hostId || this.phase !== 'lobby') return;
    if (mapId === 'random' || getMap(mapId)) {
      this.mapId = mapId;
      // Bietet die neue Karte weniger Plätze, überzählige Bots (von hinten) entfernen,
      // damit die Spielerzahl zur Karte passt. Menschen werden nicht automatisch entfernt.
      while (this.players.length > this.maxPlayers) {
        let removed = false;
        for (let i = this.players.length - 1; i >= 0; i--) {
          if (this.players[i].isBot) {
            this.players.splice(i, 1);
            removed = true;
            break;
          }
        }
        if (!removed) break; // nur noch Menschen übrig
      }
      this.players.forEach((p, i) => (p.seat = i));
      this.broadcastRoom();
    }
  }
  setOption(playerId: string, vpTarget: number) {
    if (playerId !== this.hostId || this.phase !== 'lobby') return;
    const n = Math.floor(Number(vpTarget));
    if (!Number.isFinite(n)) return; // fehlerhafte/manipulierte Eingabe ignorieren
    this.vpTarget = Math.max(3, Math.min(20, n));
    this.broadcastRoom();
  }
  setBankSize(playerId: string, bankSize: number) {
    if (playerId !== this.hostId || this.phase !== 'lobby') return;
    const n = Math.floor(Number(bankSize));
    if (!Number.isFinite(n)) return; // fehlerhafte/manipulierte Eingabe ignorieren
    this.bankSize = Math.max(3, Math.min(50, n));
    this.broadcastRoom();
  }
  setTurnTime(playerId: string, turnSeconds: number) {
    if (playerId !== this.hostId || this.phase !== 'lobby') return;
    const n = Math.floor(Number(turnSeconds));
    if (!Number.isFinite(n)) return; // fehlerhafte/manipulierte Eingabe ignorieren
    // 0 = aus; sonst auf einen sinnvollen Bereich begrenzen.
    this.turnSeconds = n <= 0 ? 0 : Math.max(15, Math.min(600, n));
    this.broadcastRoom();
  }
  kick(hostId: string, targetId: string) {
    if (hostId !== this.hostId) return;
    const target = this.findPlayer(targetId);
    if (!target) return;
    this.send(target.socket, { t: 'kicked' });
    if (this.phase === 'lobby') {
      this.players = this.players.filter((p) => p.id !== targetId);
      this.players.forEach((x, i) => (x.seat = i));
    } else {
      target.connected = false;
      target.auto = true;
      target.socket = null;
      this.scheduleTimers();
    }
    this.broadcastRoom();
    this.broadcastGame();
  }
  /** Host fügt einen Bot-Sitz hinzu (nur in der Lobby, respektiert maxPlayers). */
  addBot(hostId: string) {
    if (hostId !== this.hostId || this.phase !== 'lobby') return;
    if (this.players.length >= this.maxPlayers) return;
    const bot: RoomPlayer = {
      id: 'bot_' + Math.random().toString(36).slice(2, 10),
      sessionId: 'bot_' + Math.random().toString(36).slice(2, 10),
      name: `Bot ${++this.botSeq}`,
      colorIndex: this.freeColor(),
      ready: true,
      connected: true,
      isBot: true,
      auto: false,
      seat: this.players.length,
      socket: null,
      disconnectTimer: null,
      ping: 0,
    };
    this.players.push(bot);
    this.broadcastRoom();
  }

  /** Host entfernt einen Bot-Sitz (nur in der Lobby). */
  removeBot(hostId: string, botId: string) {
    if (hostId !== this.hostId || this.phase !== 'lobby') return;
    const bot = this.findPlayer(botId);
    if (!bot || !bot.isBot) return;
    this.players = this.players.filter((p) => p.id !== botId);
    this.players.forEach((p, i) => (p.seat = i));
    this.broadcastRoom();
  }

  replaceWithBot(hostId: string, targetId: string) {
    if (hostId !== this.hostId || this.phase !== 'playing') return;
    const target = this.findPlayer(targetId);
    if (!target || target.connected) return; // nur getrennte ersetzen
    if (target.disconnectTimer) {
      clearTimeout(target.disconnectTimer);
      target.disconnectTimer = null;
    }
    target.auto = true;
    this.broadcastRoom();
    this.scheduleTimers();
  }

  // ---------- Spielstart ----------
  startGame(hostId: string): string | null {
    if (hostId !== this.hostId) return 'Nur der Host startet.';
    if (this.phase !== 'lobby') return 'Spiel läuft bereits.';
    if (this.players.length < this.minPlayers) return `Mindestens ${this.minPlayers} Spieler nötig.`;
    if (this.players.length > this.maxPlayers) return `Zu viele Spieler für diese Karte (max. ${this.maxPlayers}). Entferne Spieler oder wähle eine größere Karte.`;
    if (!this.players.every((p) => p.ready || p.isBot)) return 'Alle müssen bereit sein.';
    const seed = (Date.now() ^ (Math.floor(Math.random() * 0x7fffffff))) >>> 0;
    this.game = createGame({
      mapId: this.mapId,
      seed,
      vpTarget: this.vpTarget,
      bankSize: this.bankSize,
      players: this.players
        .slice()
        .sort((a, b) => a.seat - b.seat)
        .map((p) => ({ id: p.id, name: p.name, colorIndex: p.colorIndex, isBot: p.isBot })),
    });
    this.phase = 'playing';
    this.scheduleTimers();
    this.broadcastRoom();
    this.broadcastGame();
    return null;
  }

  /** Nach Spielende zurück in die Lobby (Rematch): Spieler/Sitze/Einstellungen bleiben, Bereit-Status zurück. */
  returnToLobby(playerId: string) {
    if (this.phase !== 'finished') return; // nur nach Spielende
    if (!this.findPlayer(playerId)) return; // Zuschauer nicht
    if (this.botTimer) { clearTimeout(this.botTimer); this.botTimer = null; }
    this.clearRollTimer();
    this.clearTurnTimer();
    this.turnTimerPlayerId = null;
    this.game = null;
    this.phase = 'lobby';
    for (const p of this.players) if (!p.isBot) p.ready = false;
    this.broadcastRoom();
  }

  // ---------- Spielaktionen ----------
  handleAction(playerId: string, action: GameAction) {
    if (!this.game || this.phase !== 'playing') return;
    const p = this.findPlayer(playerId);
    if (!p) {
      this.send(this.socketOf(playerId), { t: 'error', message: 'Zuschauer können nicht handeln.' });
      return;
    }
    const result = applyAction(this.game, playerId, action);
    if ('error' in result) {
      this.send(p.socket, { t: 'error', message: result.error });
      return;
    }
    this.afterGameMutation(result.events);
  }

  private afterGameMutation(events: GameEvent[]) {
    if (!this.game) return;
    if (this.game.winner) this.phase = 'finished';
    // Timer VOR dem Broadcast planen, damit turnRemainingMs zum neuen Zug sofort stimmt
    // (sonst erscheint die Countdown-Pille erst nach der ersten Aktion des Zugs).
    this.scheduleTimers();
    this.broadcastGame();
    if (events.length) this.broadcastEvents(events);
    this.broadcastRoom();
  }

  // ---------- Bot-Steuerung ----------
  private isAuto(p: RoomPlayer): boolean {
    return p.isBot || p.auto;
  }
  private findAutoActor(): RoomPlayer | null {
    const g = this.game;
    if (!g || g.winner) return null;
    if (g.phase === 'discard') {
      for (const p of this.players) {
        if (g.mustDiscard[p.id] !== undefined && this.isAuto(p)) return p;
      }
      return null;
    }
    // Offenes Handelsangebot: Auto-Spieler (Bots/übernommene Sitze) beantworten es,
    // auch wenn sie nicht am Zug sind. Erst alle offenen Antworten, dann löst ein
    // Auto-Anbieter sein Angebot selbst auf (bestätigen/annullieren).
    if (g.tradeOffer) {
      for (const p of this.players) {
        if (this.isAuto(p) && g.tradeOffer.responses[p.id] === 'pending') return p;
      }
      const proposer = this.players.find((p) => p.id === g.tradeOffer!.from);
      if (proposer && this.isAuto(proposer)) return proposer;
    }
    const active = this.players.find((p) => p.id === g.order[g.activeIndex]);
    if (active && this.isAuto(active)) return active;
    return null;
  }
  private scheduleBotTick() {
    if (this.botTimer) return;
    if (!this.findAutoActor()) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      this.botTick();
    }, BOT_MOVE_DELAY_MS);
  }

  /** Sammelaufruf nach jeder Zustandsänderung: Bots, Auto-Würfeln und Zug-Countdown planen. */
  private scheduleTimers() {
    this.scheduleBotTick();
    this.scheduleRollTimer();
    this.armTurnTimer();
  }

  /** Aktiver Zug-Spieler (falls vorhanden). */
  private activeRoomPlayer(): RoomPlayer | null {
    const g = this.game;
    if (!g || g.winner) return null;
    return this.players.find((p) => p.id === g.order[g.activeIndex]) ?? null;
  }

  // ---------- Auto-Würfeln (#2) ----------
  private clearRollTimer() {
    if (this.rollTimer) { clearTimeout(this.rollTimer); this.rollTimer = null; }
  }
  /** In der Roll-Phase eines verbundenen Menschen nach AUTO_ROLL_MS automatisch würfeln. */
  private scheduleRollTimer() {
    this.clearRollTimer();
    const g = this.game;
    if (!g || g.winner || this.phase !== 'playing') return;
    if (g.phase !== 'roll') return;
    const active = this.activeRoomPlayer();
    if (!active || this.isAuto(active)) return; // Bots/übernommene Sitze macht botTick
    this.rollTimer = setTimeout(() => {
      this.rollTimer = null;
      this.autoRoll(active.id);
    }, AUTO_ROLL_MS);
  }
  private autoRoll(playerId: string) {
    const g = this.game;
    if (!g || g.winner || this.phase !== 'playing') return;
    if (g.phase !== 'roll' || g.order[g.activeIndex] !== playerId) return;
    const p = this.findPlayer(playerId);
    if (!p || this.isAuto(p)) return; // inzwischen Bot/getrennt → nicht doppelt würfeln
    const result = applyAction(g, playerId, { type: 'rollDice' });
    if ('events' in result) this.afterGameMutation(result.events);
  }

  // ---------- Zug-Countdown (#3) ----------
  private clearTurnTimer() {
    if (this.turnTimer) { clearTimeout(this.turnTimer); this.turnTimer = null; }
  }
  /** Aktuelle Restzeit des Zugs in ms (für die Client-Anzeige), sonst undefined. */
  private turnRemainingMs(): number | undefined {
    if (this.turnSeconds <= 0 || this.phase !== 'playing' || !this.turnDeadline) return undefined;
    const active = this.activeRoomPlayer();
    if (!active || this.isAuto(active) || active.id !== this.turnTimerPlayerId) return undefined;
    return Math.max(0, this.turnDeadline - Date.now());
  }
  /** Startet/erneuert die Zug-Frist. Neue Frist nur bei Zug-Eignerwechsel; sonst gleiche Deadline. */
  private armTurnTimer() {
    this.clearTurnTimer();
    if (this.turnSeconds <= 0) { this.turnTimerPlayerId = null; return; }
    const g = this.game;
    if (!g || g.winner || this.phase !== 'playing') { this.turnTimerPlayerId = null; return; }
    const active = this.activeRoomPlayer();
    if (!active || this.isAuto(active)) { this.turnTimerPlayerId = null; return; } // Bots ticken selbst
    // Kein Zug-Countdown während der Startaufstellung — Setup ist kein „Zug" im engeren Sinn;
    // so bekommt der erste echte Zug die volle Zeit und die Aufstellung wird nicht gehetzt.
    if (g.phase === 'setupSettlement' || g.phase === 'setupRoad') { this.turnTimerPlayerId = null; return; }
    if (this.turnTimerPlayerId !== active.id) {
      this.turnTimerPlayerId = active.id;
      this.turnDeadline = Date.now() + this.turnSeconds * 1000;
    }
    const remaining = Math.max(0, this.turnDeadline - Date.now());
    this.turnTimer = setTimeout(() => this.enforceTurn(active.id), remaining);
  }
  /** Frist abgelaufen → Zug per Bot-Logik zu Ende spielen (würfeln, Räuber, … , Zug beenden). */
  private enforceTurn(playerId: string) {
    this.turnTimer = null;
    const g = this.game;
    if (!g || g.winner || this.phase !== 'playing') return;
    if (g.order[g.activeIndex] !== playerId) { this.turnTimerPlayerId = null; this.armTurnTimer(); return; }
    const p = this.findPlayer(playerId);
    if (!p || this.isAuto(p)) { this.turnTimerPlayerId = null; return; } // wurde Bot → botTick übernimmt

    const action = chooseBotAction(g, playerId);
    if (action) {
      const result = applyAction(g, playerId, action);
      if ('events' in result) {
        // afterGameMutation broadcastet UND plant Timer neu: bleibt es (überzogen) mein Zug,
        // setzt armTurnTimer sofort das nächste enforceTurn (remaining=0) → Zug wird zu Ende gespielt;
        // geht der Zug weiter, plant scheduleBotTick den nächsten (Bot-)Akteur.
        this.afterGameMutation(result.events);
        return;
      }
    }
    // Keine (gültige) Aktion für mich → wartet auf andere (z. B. deren Abwerfen) → gleich erneut prüfen.
    this.turnTimer = setTimeout(() => this.enforceTurn(playerId), 500);
  }
  private botTick() {
    const g = this.game;
    if (!g || g.winner) return;
    const actor = this.findAutoActor();
    if (!actor) return;
    const action = chooseBotAction(g, actor.id);
    if (action) {
      const result = applyAction(g, actor.id, action);
      if ('events' in result) {
        if (g.winner) this.phase = 'finished';
        // Timer VOR dem Broadcast planen → turnRemainingMs zum neuen Zug sofort korrekt.
        this.scheduleTimers();
        this.broadcastGame();
        if (result.events.length) this.broadcastEvents(result.events);
        this.broadcastRoom();
        return;
      }
    }
    this.scheduleTimers();
  }

  // ---------- Chat & Ping ----------
  chat(playerId: string, text: string) {
    const clean = text.slice(0, 300).trim();
    if (!clean) return;
    const p = this.findPlayer(playerId);
    const spec = this.spectators.find((s) => s.id === playerId);
    const name = p?.name ?? spec?.name ?? '???';
    const colorIndex = p?.colorIndex ?? -1;
    this.broadcast({ t: 'chat', from: playerId, name, colorIndex, text: clean, ts: Date.now() });
  }
  pong(playerId: string, sentTs: number) {
    const p = this.findPlayer(playerId);
    if (p) p.ping = Math.max(0, Date.now() - sentTs);
  }

  // ---------- Serialisierung / Broadcast ----------
  private socketOf(id: string): WebSocket | null {
    return this.findPlayer(id)?.socket ?? this.spectators.find((s) => s.id === id)?.socket ?? null;
  }
  toRoomState(): RoomState {
    const players: LobbyPlayer[] = this.players
      .slice()
      .sort((a, b) => a.seat - b.seat)
      .map((p) => ({
        id: p.id, name: p.name, colorIndex: p.colorIndex, ready: p.ready,
        isHost: p.id === this.hostId, connected: p.connected, isBot: p.isBot || p.auto, seat: p.seat,
      }));
    const ping: Record<string, number> = {};
    for (const p of this.players) ping[p.id] = p.ping;
    return {
      code: this.code, phase: this.phase, mapId: this.mapId, vpTarget: this.vpTarget, bankSize: this.bankSize,
      turnSeconds: this.turnSeconds,
      players, spectators: this.spectators.map((s) => ({ id: s.id, name: s.name })),
      hostId: this.hostId, minPlayers: this.minPlayers, maxPlayers: this.maxPlayers, ping,
    };
  }
  private sendRoomTo(socket: WebSocket | null, you: string) {
    this.send(socket, { t: 'roomState', room: this.toRoomState(), you });
  }
  private sendGameTo(p: RoomPlayer) {
    if (this.game) this.send(p.socket, { t: 'gameState', state: toPublicState(this.game, p.id), turnRemainingMs: this.turnRemainingMs() });
  }
  broadcastRoom() {
    const room = this.toRoomState();
    for (const p of this.players) this.send(p.socket, { t: 'roomState', room, you: p.id });
    for (const s of this.spectators) this.send(s.socket, { t: 'roomState', room, you: s.id });
  }
  broadcastGame() {
    if (!this.game) return;
    const trm = this.turnRemainingMs();
    for (const p of this.players) this.send(p.socket, { t: 'gameState', state: toPublicState(this.game, p.id), turnRemainingMs: trm });
    for (const s of this.spectators) this.send(s.socket, { t: 'gameState', state: toPublicState(this.game, s.id), turnRemainingMs: trm });
  }
  broadcastEvents(events: GameEvent[]) {
    // Empfängerspezifisch redigieren: der beim Diebstahl konkret gestohlene Rohstoff
    // darf nur an Dieb und Opfer gehen (analog zur toPublicState-Redaktion).
    for (const p of this.players) this.send(p.socket, { t: 'event', events: redactEventsFor(events, p.id) });
    for (const s of this.spectators) this.send(s.socket, { t: 'event', events: redactEventsFor(events, s.id) });
  }
  private broadcast(msg: ServerMsg) {
    for (const p of this.players) this.send(p.socket, msg);
    for (const s of this.spectators) this.send(s.socket, msg);
  }
}
