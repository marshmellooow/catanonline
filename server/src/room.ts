import type { WebSocket } from 'ws';
import {
  createGame, applyAction, toPublicState, redactEventsFor, chooseBotAction, resolveTimedOutTrade, fallbackAction, getMap,
  GRACE_MS, EMPTY_ROOM_TTL_MS, BOT_MOVE_DELAY_MS, BOT_FAST_MOVE_DELAY_MS, BOT_TRADE_TIMEOUT_MS, AUTO_ROLL_MS, DEFAULT_TURN_SECONDS,
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

/** Sichtbare Spielzüge bleiben lesbar; rein administrative Zwischenschritte laufen flotter. */
function botDelayFor(action: GameAction): number {
  switch (action.type) {
    case 'bankTrade':
    case 'respondTrade':
    case 'confirmTrade':
    case 'acceptCounter':
    case 'cancelTrade':
    case 'discard':
    case 'autoDiscard':
    case 'endTurn':
      return BOT_FAST_MOVE_DELAY_MS;
    default:
      return BOT_MOVE_DELAY_MS;
  }
}

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
  // Nach Ablauf übernimmt der Autopilot denselben Sitz schrittweise. Ein eigener Timer
  // verhindert, dass scheduleTimers die abgelaufene Zug-Deadline als 0-ms-Kette neu plant.
  private enforcedTurnTimer: ReturnType<typeof setTimeout> | null = null;
  private enforcedTurnPlayerId: string | null = null;
  // Abwurf-Countdown (nach einer 7): läuft für ALLE, die abwerfen müssen; bei Ablauf (halbe
  // Zug-Zeit) wird für säumige Menschen Karte für Karte zufällig abgeworfen.
  private discardTimer: ReturnType<typeof setTimeout> | null = null;
  private discardDeadline = 0; // epoch ms, gemeinsamer Ablaufzeitpunkt der Abwurf-Episode
  // Frist für ein Angebot, das ein Bot einem Menschen gemacht hat. Ohne sie endet der
  // Bot-Zug nie, wenn niemand antwortet: der Bot wartet (bot.ts), und armTurnTimer steigt
  // bei Bot-Aktiven bewusst aus.
  private tradeTimer: ReturnType<typeof setTimeout> | null = null;
  private tradeDeadline = 0; // epoch ms
  private tradeTimerOfferId: string | null = null; // für welches Angebot die Frist läuft
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
  /** Hält den serialisierten Spielzustand bei reinen Präsenzwechseln konsistent. */
  private syncGamePresence(player: RoomPlayer) {
    const gamePlayer = this.game?.players.find((p) => p.id === player.id);
    if (gamePlayer) gamePlayer.connected = player.connected;
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
      this.syncGamePresence(p);
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
      this.syncGamePresence(p);
      this.cancelEmptyTimer();
      // Timer neu planen, BEVOR der Spielstand rausgeht: ein wieder verbundener Mensch, der
      // noch abwerfen muss, bekommt so seinen Abwurf-Countdown zurück (sonst Stall) und die
      // Restzeit stimmt in sendGameTo. Deckt analog Zug-/Auto-Würfel-Timer ab.
      this.scheduleTimers();
      this.broadcastRoom();
      this.sendGameTo(p);
      return true;
    }
    const spec = this.spectators.find((s) => s.id === playerId);
    if (spec) {
      spec.socket = socket;
      this.sendRoomTo(spec.socket, playerId);
      if (this.game) this.send(spec.socket, { t: 'gameState', state: toPublicState(this.game, playerId), turnRemainingMs: this.turnRemainingMs(), discardRemainingMs: this.discardRemainingMs() });
      return true;
    }
    return false;
  }

  handleDisconnect(playerId: string, closingSocket?: WebSocket) {
    const p = this.findPlayer(playerId);
    if (p) {
      // Ein alter Socket kann erst schließen, nachdem dieselbe Sitzung bereits über
      // einen neuen Socket reattacht wurde. Dieses verspätete close darf die neue
      // Verbindung weder nullen noch erneut eine Grace-Frist starten.
      if (closingSocket && p.socket !== closingSocket) return;
      p.socket = null;
      p.connected = false;
      this.syncGamePresence(p);
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
      // Timer sofort neu bewerten: blockiert der Getrennte gerade einen Abwurf, löst der
      // Bot-Tick ihn jetzt auf (findAutoActor deckt getrennte Abwerfer ab) — die Tafel
      // wartet nicht bis Grace-Ende. Für den regulären Zug greift weiterhin der Zug-Timer.
      this.scheduleTimers();
      this.broadcastRoom();
      this.checkEmpty();
      return;
    }
    const spec = this.spectators.find((s) => s.id === playerId);
    if (spec) {
      if (closingSocket && spec.socket !== closingSocket) return;
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
        this.emptyTimer = setTimeout(() => this.destroy(), EMPTY_ROOM_TTL_MS);
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
    this.clearTurnEnforcement();
    this.clearDiscardTimer();
    this.clearTradeTimer();
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
      this.syncGamePresence(target);
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
    this.clearTurnEnforcement();
    this.clearDiscardTimer();
    this.clearTradeTimer();
    this.turnTimerPlayerId = null;
    this.game = null;
    this.phase = 'lobby';
    // In der Lobby werden getrennte Menschen regulär sofort entfernt. Dasselbe gilt
    // beim Rematch für Sitze, die im alten Spiel bereits dauerhaft übernommen wurden;
    // sonst sähen sie wie Bots aus, ließen sich aber weder entfernen noch bereit setzen.
    for (const p of this.players) {
      if (!p.isBot && !p.connected && p.disconnectTimer) clearTimeout(p.disconnectTimer);
    }
    this.players = this.players.filter((p) => p.isBot || p.connected);
    this.players.forEach((p, i) => {
      p.seat = i;
      p.ready = p.isBot;
    });
    this.migrateHostIfNeeded();
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
    const wasEnforced = this.enforcedTurnPlayerId === playerId;
    this.afterGameMutation(result.events);
    // Klickt der Spieler während der bereits laufenden Timeout-Übernahme selbst noch,
    // beginnt der Abstand zur nächsten Auto-Aktion neu statt kurz darauf zu springen.
    if (wasEnforced) this.scheduleEnforcedTurnStep(playerId, botDelayFor(action));
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
        // Auto-Akteur für Abwurf: Bots/übernommene Sitze — UND getrennte Spieler (während
        // der Grace-Frist). Sonst blockiert ein Disconnect mitten im Abwerfen (nach einer 7)
        // die GANZE Tafel bis Grace-Ende, weil weder der Abwurf-Timer (nur verbundene) noch
        // der Bot-Pfad (nur auto) ihn auflöst. Sein Abwurf wird stattdessen sofort aufgelöst.
        if (g.mustDiscard[p.id] !== undefined && (this.isAuto(p) || !p.connected)) return p;
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
      if (proposer && this.isAuto(proposer)) {
        // Warten, solange ein echter Mitspieler noch antworten darf — sonst reißt der Bot
        // ihm den Handelsdialog nach 700 ms wieder weg. Begrenzt von armTradeTimer.
        //
        // Hier `null` und NICHT durchfallen: der Anbieter IST der aktive Spieler (der
        // Reducer lässt nur ihn anbieten). Ein Durchfallen auf den Aktiv-Zweig unten
        // würde denselben Sitz zurückgeben und das Angebot doch wegräumen.
        if (this.hasHumanPending(g.tradeOffer)) return null;
        return proposer;
      }
    }
    const active = this.players.find((p) => p.id === g.order[g.activeIndex]);
    if (active && this.isAuto(active)) return active;
    return null;
  }
  private scheduleBotTick() {
    if (this.botTimer) return;
    const actor = this.findAutoActor();
    if (!actor || !this.game) return;
    // Nur zur Verzögerungswahl vorplanen; im Tick selbst wird gegen den dann aktuellen
    // State neu geplant. So kann eine menschliche Antwort während der Frist nichts veralten.
    const next = chooseBotAction(this.game, actor.id);
    if (!next) return;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      this.botTick();
    }, botDelayFor(next));
  }

  /** Steht ein NICHT-Auto-Spieler (echter Mensch) noch auf 'pending'? */
  private hasHumanPending(offer: { responses: Record<string, string> }): boolean {
    return Object.keys(offer.responses).some((pid) => {
      if (offer.responses[pid] !== 'pending') return false;
      const p = this.findPlayer(pid);
      return !!p && !this.isAuto(p);
    });
  }

  /** Sammelaufruf nach jeder Zustandsänderung: Bots, Auto-Würfeln, Zug-, Abwurf- und Handels-Countdown planen. */
  private scheduleTimers() {
    this.scheduleBotTick();
    this.scheduleRollTimer();
    this.armTurnTimer();
    this.armDiscardTimer();
    this.armTradeTimer();
  }

  private clearTradeTimer() {
    if (this.tradeTimer) { clearTimeout(this.tradeTimer); this.tradeTimer = null; }
    this.tradeDeadline = 0;
    this.tradeTimerOfferId = null;
  }

  /** Ein Bot-Angebot wartet auf einen Menschen → nach BOT_TRADE_TIMEOUT_MS selbst auflösen.
   *  Ohne das bliebe der Zug hängen, wenn niemand klickt (bot.ts wartet bewusst, und
   *  armTurnTimer läuft für Bot-Aktive nicht). */
  private armTradeTimer() {
    const g = this.game;
    if (!g || g.winner || this.phase !== 'playing' || !g.tradeOffer) { this.clearTradeTimer(); return; }
    const proposer = this.findPlayer(g.tradeOffer.from);
    if (!proposer || !this.isAuto(proposer)) { this.clearTradeTimer(); return; } // nur Bot-Angebote laufen ab
    if (!this.hasHumanPending(g.tradeOffer)) { this.clearTradeTimer(); return; } // botTick löst ohnehin sofort auf
    // Frist einmal je Angebot setzen — nicht bei jeder Antwort neu starten.
    if (this.tradeTimerOfferId !== g.tradeOffer.id) {
      if (this.tradeTimer) clearTimeout(this.tradeTimer);
      this.tradeTimerOfferId = g.tradeOffer.id;
      this.tradeDeadline = Date.now() + BOT_TRADE_TIMEOUT_MS;
    } else if (this.tradeTimer) {
      return; // Frist läuft bereits
    }
    const remaining = Math.max(0, this.tradeDeadline - Date.now());
    this.tradeTimer = setTimeout(() => {
      this.tradeTimer = null;
      const gg = this.game;
      if (!gg || gg.winner || !gg.tradeOffer || gg.tradeOffer.id !== this.tradeTimerOfferId) { this.clearTradeTimer(); return; }
      const from = this.findPlayer(gg.tradeOffer.from);
      if (!from || !this.isAuto(from)) { this.clearTradeTimer(); return; }
      // Säumige Menschen zählen als Ablehnung. Eine bereits vorhandene gültige Annahme
      // oder ein guter Konter wird trotzdem ausgeführt — der Timeout darf sie nicht löschen.
      const action = resolveTimedOutTrade(gg, from.id) ?? { type: 'cancelTrade' as const };
      let r = applyAction(gg, from.id, action);
      if ('error' in r) {
        console.warn(`[trade-timeout] Reducer lehnte ${action.type} ab (${r.error}) — Angebot wird abgebrochen.`);
        r = applyAction(gg, from.id, { type: 'cancelTrade' });
      }
      this.clearTradeTimer();
      if ('events' in r) this.afterGameMutation(r.events);
    }, remaining);
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
  private clearTurnEnforcement() {
    if (this.enforcedTurnTimer) { clearTimeout(this.enforcedTurnTimer); this.enforcedTurnTimer = null; }
    this.enforcedTurnPlayerId = null;
  }
  private scheduleEnforcedTurnStep(playerId: string, delay: number) {
    const g = this.game;
    if (
      this.enforcedTurnPlayerId !== playerId || !g || g.winner ||
      this.phase !== 'playing' || g.order[g.activeIndex] !== playerId
    ) return;
    if (this.enforcedTurnTimer) clearTimeout(this.enforcedTurnTimer);
    this.enforcedTurnTimer = setTimeout(() => this.enforceTurn(playerId), delay);
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
    if (this.turnSeconds <= 0) { this.turnTimerPlayerId = null; this.clearTurnEnforcement(); return; }
    const g = this.game;
    if (!g || g.winner || this.phase !== 'playing') { this.turnTimerPlayerId = null; this.clearTurnEnforcement(); return; }
    const active = this.activeRoomPlayer();
    if (!active || this.isAuto(active)) { this.turnTimerPlayerId = null; this.clearTurnEnforcement(); return; } // Bots ticken selbst
    // Kein Zug-Countdown während der Startaufstellung — Setup ist kein „Zug" im engeren Sinn;
    // so bekommt der erste echte Zug die volle Zeit und die Aufstellung wird nicht gehetzt.
    if (g.phase === 'setupSettlement' || g.phase === 'setupRoad') { this.turnTimerPlayerId = null; this.clearTurnEnforcement(); return; }
    // Der abgelaufene Zug wird bereits von enforceTurn getaktet. Seine Deadline bleibt bei
    // 0 für die Anzeige; ein neuer normaler Countdown darf erst beim Spielerwechsel starten.
    if (this.enforcedTurnPlayerId === active.id) return;
    if (this.enforcedTurnPlayerId) this.clearTurnEnforcement();
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
    this.enforcedTurnTimer = null;
    const g = this.game;
    if (!g || g.winner || this.phase !== 'playing') { this.clearTurnEnforcement(); return; }
    if (g.order[g.activeIndex] !== playerId) { this.clearTurnEnforcement(); this.turnTimerPlayerId = null; this.armTurnTimer(); return; }
    const p = this.findPlayer(playerId);
    if (!p || this.isAuto(p)) { this.clearTurnEnforcement(); this.turnTimerPlayerId = null; return; } // wurde Bot → botTick übernimmt

    this.enforcedTurnPlayerId = playerId;

    const action = chooseBotAction(g, playerId);
    if (action) {
      let performedAction = action;
      let result = applyAction(g, playerId, action);
      if ('error' in result) {
        // Netz gegen die 500-ms-Dauerschleife: derselbe State ergäbe dieselbe abgelehnte
        // Aktion, der Zug dieses Menschen endete nie. Einmalig auf eine garantiert
        // gültige Notaktion ausweichen statt neu zu planen.
        console.warn(`[enforceTurn] Reducer lehnte ${action.type} ab (${result.error}) — Notaktion.`);
        const fb = fallbackAction(g, playerId);
        if (fb) {
          performedAction = fb;
          result = applyAction(g, playerId, fb);
        }
      }
      if ('events' in result) {
        // afterGameMutation plant alle übrigen Timer neu. armTurnTimer erkennt dabei die
        // laufende Übernahme und lässt deren separaten Taktgeber in Ruhe.
        this.afterGameMutation(result.events);
        this.scheduleEnforcedTurnStep(playerId, botDelayFor(performedAction));
        return;
      }
    }
    // Keine (gültige) Aktion für mich → wartet auf andere (z. B. deren Abwerfen) → gleich erneut prüfen.
    this.scheduleEnforcedTurnStep(playerId, 500);
  }

  // ---------- Abwurf-Countdown (Auto-Abwerfen nach einer 7) ----------
  private clearDiscardTimer() {
    if (this.discardTimer) { clearTimeout(this.discardTimer); this.discardTimer = null; }
    this.discardDeadline = 0;
  }
  /** Verbundene Menschen, die noch abwerfen müssen (Bots/getrennte macht der Bot-Tick sofort). */
  private pendingDiscardHumans(): RoomPlayer[] {
    const g = this.game;
    if (!g) return [];
    return this.players.filter((p) => g.mustDiscard[p.id] !== undefined && p.connected && !p.isBot && !p.auto);
  }
  /** Restzeit des Abwurf-Countdowns in ms (für die Client-Anzeige), sonst undefined. */
  private discardRemainingMs(): number | undefined {
    if (this.turnSeconds <= 0 || this.phase !== 'playing' || !this.game || this.game.phase !== 'discard' || !this.discardDeadline) return undefined;
    return Math.max(0, this.discardDeadline - Date.now());
  }
  /** Frist = halbe Zug-Zeit; einmal je Abwurf-Episode gesetzt. Nur wenn ein Mensch noch abwerfen muss. */
  private armDiscardTimer() {
    const g = this.game;
    if (!g || g.winner || this.phase !== 'playing' || g.phase !== 'discard' || this.turnSeconds <= 0) { this.clearDiscardTimer(); return; }
    if (this.pendingDiscardHumans().length === 0) { this.clearDiscardTimer(); return; }
    if (this.discardTimer) clearTimeout(this.discardTimer);
    if (!this.discardDeadline) this.discardDeadline = Date.now() + (this.turnSeconds * 1000) / 2;
    const remaining = Math.max(0, this.discardDeadline - Date.now());
    this.discardTimer = setTimeout(() => this.enforceDiscard(), remaining);
  }
  /** Frist abgelaufen → für jeden säumigen Menschen Karte für Karte zufällig abwerfen. */
  private enforceDiscard() {
    this.discardTimer = null;
    const g = this.game;
    if (!g || g.winner || this.phase !== 'playing' || g.phase !== 'discard') { this.clearDiscardTimer(); return; }
    const events: GameEvent[] = [];
    for (const p of this.pendingDiscardHumans()) {
      const result = applyAction(g, p.id, { type: 'autoDiscard' });
      if ('events' in result) events.push(...result.events);
    }
    this.discardDeadline = 0;
    if (events.length) this.afterGameMutation(events); // broadcastet + plant Timer/Bots neu
    else this.clearDiscardTimer();
  }
  private botTick() {
    const g = this.game;
    if (!g || g.winner) return;
    const actor = this.findAutoActor();
    if (!actor) return;
    const action = chooseBotAction(g, actor.id);
    if (action) {
      let result = applyAction(g, actor.id, action);
      if ('error' in result) {
        // Netz gegen die 700-ms-Endlosschleife: scheduleTimers → scheduleBotTick würde
        // denselben State neu planen → dieselbe abgelehnte Aktion → Partie tot. Einmalig
        // auf eine garantiert gültige Notaktion ausweichen statt neu zu planen.
        console.warn(`[bot] Reducer lehnte ${action.type} ab (${result.error}) — Notaktion.`);
        const fb = fallbackAction(g, actor.id);
        result = fb ? applyAction(g, actor.id, fb) : result;
      }
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
    if (this.game) this.send(p.socket, { t: 'gameState', state: toPublicState(this.game, p.id), turnRemainingMs: this.turnRemainingMs(), discardRemainingMs: this.discardRemainingMs() });
  }
  broadcastRoom() {
    const room = this.toRoomState();
    for (const p of this.players) this.send(p.socket, { t: 'roomState', room, you: p.id });
    for (const s of this.spectators) this.send(s.socket, { t: 'roomState', room, you: s.id });
  }
  broadcastGame() {
    if (!this.game) return;
    const trm = this.turnRemainingMs();
    const drm = this.discardRemainingMs();
    for (const p of this.players) this.send(p.socket, { t: 'gameState', state: toPublicState(this.game, p.id), turnRemainingMs: trm, discardRemainingMs: drm });
    for (const s of this.spectators) this.send(s.socket, { t: 'gameState', state: toPublicState(this.game, s.id), turnRemainingMs: trm, discardRemainingMs: drm });
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
