import { describe, it, expect, vi } from 'vitest';
import { Room } from '../src/room.js';
import { GRACE_MS, EMPTY_ROOM_TTL_MS, AUTO_ROLL_MS, BOT_MOVE_DELAY_MS, BOT_FAST_MOVE_DELAY_MS, BOT_TRADE_TIMEOUT_MS, DEFAULT_TURN_SECONDS, validSettlementCorners, validRoadEdges } from '@catan/shared';

// Stub-Socket: readyState OPEN(1), send no-op — Broadcasts crashen nicht.
const sock = () => ({ readyState: 1, send() {} }) as never;

function lobby(n: number) {
  const room = new Room('T', { onEmpty: () => {} });
  const players = Array.from({ length: n }, (_, i) => room.addPlayer('s' + i, 'P' + i, undefined, sock()));
  return { room, players };
}
function startedGame(n = 3) {
  const { room, players } = lobby(n);
  players.forEach((p) => room.setReady(p.id, true));
  expect(room.startGame(players[0].id)).toBeNull();
  expect(room.phase).toBe('playing');
  return { room, players };
}

/** Startaufstellung deterministisch abschließen (jeder Aktive setzt die erste gültige Siedlung/Straße). */
function driveSetup(room: Room) {
  for (let guard = 0; guard < 60; guard++) {
    const g = room.game;
    if (!g || (g.phase !== 'setupSettlement' && g.phase !== 'setupRoad')) return;
    const active = g.order[g.activeIndex];
    if (g.phase === 'setupSettlement') {
      const c = validSettlementCorners(g, active, true);
      room.handleAction(active, { type: 'placeSetupSettlement', corner: c[0] });
    } else {
      const e = validRoadEdges(g, active, g.setupLastSettlement);
      room.handleAction(active, { type: 'placeSetupRoad', edge: e[0] });
    }
  }
}

describe('Room-Lifecycle: Leave / Reconnect / Host', () => {
  it('Leave in der Lobby: Sitz frei, Sitze reindexiert', () => {
    const { room, players } = lobby(3);
    room.removePlayer(players[1].id);
    expect(room.players.length).toBe(2);
    expect(room.players.map((p) => p.seat)).toEqual([0, 1]);
    expect(room.findPlayer(players[1].id)).toBeUndefined();
  });

  it('Host verlässt Lobby: Host migriert zum nächsten (nach Sitz)', () => {
    const { room, players } = lobby(3);
    expect(room.hostId).toBe(players[0].id);
    room.removePlayer(players[0].id);
    expect(room.hostId).toBe(players[1].id);
  });

  it('Leave mitten im Spiel: Sitz bleibt, Bot übernimmt (auto), Spiel läuft weiter', () => {
    const { room, players } = startedGame(3);
    room.removePlayer(players[1].id);
    const p = room.findPlayer(players[1].id);
    expect(p).toBeDefined();
    expect(p!.connected).toBe(false);
    expect(p!.auto).toBe(true);
    expect(room.players.length).toBe(3);
    expect(room.phase).toBe('playing');
  });

  it('Disconnect im Spiel: Grace-Frist, danach Auto-Bot', () => {
    vi.useFakeTimers();
    try {
      const { room, players } = startedGame(3);
      room.handleDisconnect(players[1].id);
      const p = room.findPlayer(players[1].id)!;
      expect(p.connected).toBe(false);
      expect(p.auto).toBe(false); // Grace läuft noch
      expect(p.disconnectTimer).not.toBeNull();
      vi.advanceTimersByTime(GRACE_MS + 10);
      expect(p.auto).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Reconnect innerhalb der Grace: bricht Auto-Übernahme ab, Mensch übernimmt wieder', () => {
    vi.useFakeTimers();
    try {
      const { room, players } = startedGame(3);
      room.handleDisconnect(players[1].id);
      room.reattach(players[1].id, sock());
      const p = room.findPlayer(players[1].id)!;
      expect(p.connected).toBe(true);
      expect(p.auto).toBe(false);
      expect(p.disconnectTimer).toBeNull();
      vi.advanceTimersByTime(GRACE_MS + 10);
      expect(p.auto).toBe(false); // Grace-Callback wurde gecancelt
    } finally {
      vi.useRealTimers();
    }
  });

  it('Host-Disconnect im Spiel: Host migriert sofort zum verbundenen Menschen', () => {
    const { room, players } = startedGame(3);
    expect(room.hostId).toBe(players[0].id);
    room.handleDisconnect(players[0].id);
    expect(room.hostId).toBe(players[1].id);
  });
});

describe('Rematch: returnToLobby', () => {
  it('nach Spielende zurück in die Lobby: Sitze bleiben, ready zurückgesetzt, Spiel verworfen', () => {
    const { room, players } = startedGame(3);
    room.phase = 'finished'; // Spielende simulieren
    players.forEach((p) => (p.ready = true));
    room.returnToLobby(players[1].id);
    expect(room.phase).toBe('lobby');
    expect(room.game).toBeNull();
    expect(room.players.length).toBe(3); // Sitze/Spieler bleiben
    expect(room.players.every((p) => p.ready === false)).toBe(true); // ready zurückgesetzt
  });

  it('ignoriert returnToLobby, solange das Spiel läuft', () => {
    const { room, players } = startedGame(3);
    room.returnToLobby(players[0].id);
    expect(room.phase).toBe('playing');
    expect(room.game).not.toBeNull();
  });
});

describe('Room-Cleanup (checkEmpty)', () => {
  it('Letzter Mensch verlässt Lobby: Raum wird nach der Leerraum-TTL zerstört', () => {
    vi.useFakeTimers();
    try {
      let emptied: string | null = null;
      const room = new Room('T', { onEmpty: (c) => (emptied = c) });
      const p0 = room.addPlayer('s0', 'P0', undefined, sock());
      room.handleDisconnect(p0.id);
      expect(emptied).toBeNull();
      vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS + 10);
      expect(emptied).toBe('T');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Solo-Spiel (1 Mensch + Bot): verlässt der Mensch, räumt der Raum auf (Bots halten ihn nicht am Leben)', () => {
    vi.useFakeTimers();
    try {
      let emptied: string | null = null;
      const room = new Room('T', { onEmpty: (c) => (emptied = c) });
      const host = room.addPlayer('s0', 'Host', undefined, sock());
      room.addBot(host.id);
      room.setReady(host.id, true);
      expect(room.startGame(host.id)).toBeNull();
      room.handleDisconnect(host.id);
      vi.advanceTimersByTime(GRACE_MS + EMPTY_ROOM_TTL_MS + 10);
      expect(emptied).toBe('T');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Reconnect vor Ablauf des Cleanup-Timers hält den Raum am Leben', () => {
    vi.useFakeTimers();
    try {
      let emptied: string | null = null;
      const room = new Room('T', { onEmpty: (c) => (emptied = c) });
      const { players } = { players: [room.addPlayer('s0', 'P0', undefined, sock())] };
      room.setReady(players[0].id, true);
      room.addBot(players[0].id);
      room.startGame(players[0].id);
      room.handleDisconnect(players[0].id); // connectedHumans 0 → emptyTimer startet
      vi.advanceTimersByTime(60_000);
      room.reattach(players[0].id, sock()); // vor 120s zurück
      vi.advanceTimersByTime(120_000);
      expect(emptied).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Lobby-Option: Zug-Zeit (setTurnTime)', () => {
  it('Standard 60s; nur Host, nur Lobby; Bereich [15..600], 0 = aus, NaN ignoriert', () => {
    const { room, players } = lobby(2);
    expect(room.turnSeconds).toBe(DEFAULT_TURN_SECONDS);
    expect(room.toRoomState().turnSeconds).toBe(60);

    room.setTurnTime(players[1].id, 30); // nicht Host → ignoriert
    expect(room.turnSeconds).toBe(60);

    room.setTurnTime(players[0].id, 30);
    expect(room.turnSeconds).toBe(30);
    room.setTurnTime(players[0].id, 0); // aus
    expect(room.turnSeconds).toBe(0);
    room.setTurnTime(players[0].id, 5); // <15 → auf 15 geklemmt
    expect(room.turnSeconds).toBe(15);
    room.setTurnTime(players[0].id, 9999); // >600 → 600
    expect(room.turnSeconds).toBe(600);
    room.setTurnTime(players[0].id, Number.NaN); // ungültig → unverändert
    expect(room.turnSeconds).toBe(600);
  });

  it('nicht mehr änderbar, sobald das Spiel läuft', () => {
    const { room, players } = startedGame(2);
    room.setTurnTime(players[0].id, 30);
    expect(room.turnSeconds).toBe(DEFAULT_TURN_SECONDS); // Änderung nur in der Lobby
  });
});

describe('Auto-Würfeln (#2) & Zug-Countdown (#3)', () => {
  it('würfelt in der Roll-Phase eines Menschen nach AUTO_ROLL_MS automatisch', () => {
    vi.useFakeTimers();
    try {
      const { room } = startedGame(3);
      driveSetup(room);
      expect(room.game!.phase).toBe('roll');
      expect(room.game!.hasRolled).toBe(false);
      vi.advanceTimersByTime(AUTO_ROLL_MS + 50);
      expect(room.game!.hasRolled).toBe(true);
      expect(room.game!.dice).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('KEIN Auto-Würfeln in der Startaufstellung', () => {
    vi.useFakeTimers();
    try {
      const { room } = startedGame(3);
      expect(room.game!.phase).toBe('setupSettlement');
      vi.advanceTimersByTime(AUTO_ROLL_MS + 50);
      expect(room.game!.phase).toBe('setupSettlement'); // unverändert, kein Wurf
    } finally {
      vi.useRealTimers();
    }
  });

  it('Zug-Countdown beendet den Zug eines Menschen bei Ablauf automatisch', () => {
    vi.useFakeTimers();
    try {
      const { room, players } = lobby(3);
      players.forEach((p) => room.setReady(p.id, true));
      room.setTurnTime(players[0].id, 20); // kurzer Zug fürs Test
      room.startGame(players[0].id);
      driveSetup(room);
      expect(room.game!.phase).toBe('roll');
      const firstActive = room.game!.activeIndex;
      // Über die Frist hinaus vorspulen: Auto-Würfeln (3s) + Zug-Timer (20s) +
      // genug Zeit für mehrere sichtbar getaktete Autopilot-Schritte.
      vi.advanceTimersByTime(20_000 + BOT_MOVE_DELAY_MS * 12);
      expect(room.game!.activeIndex).not.toBe(firstActive); // Zug ist weitergegangen
      expect(room.game!.turnCount).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('taktet Folgeaktionen eines abgelaufenen Menschenzugs wie reguläre Bot-Züge', () => {
    vi.useFakeTimers();
    try {
      const { room, players } = lobby(3);
      players.forEach((p) => room.setReady(p.id, true));
      room.setTurnTime(players[0].id, 20);
      room.startGame(players[0].id);
      driveSetup(room);

      const g = room.game!;
      const active = g.order[g.activeIndex];
      const actor = g.players.find((p) => p.id === active)!;
      g.phase = 'main';
      g.hasRolled = true;
      actor.resources = { wood: 1, brick: 1, wool: 0, grain: 0, ore: 0 };
      expect(validRoadEdges(g, active, null).length).toBeGreaterThan(0);

      const intern = room as unknown as {
        clearRollTimer(): void;
        clearTurnTimer(): void;
        enforceTurn(playerId: string): void;
        turnRemainingMs(): number | undefined;
      };
      intern.clearRollTimer();
      intern.clearTurnTimer();

      const roadsBefore = Object.values(g.roads).filter((r) => r.owner === active).length;
      intern.enforceTurn(active); // erster Schritt genau beim Ablauf: sichtbarer Straßenbau
      expect(Object.values(g.roads).filter((r) => r.owner === active)).toHaveLength(roadsBefore + 1);
      expect(g.order[g.activeIndex]).toBe(active);

      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS - 1);
      expect(g.order[g.activeIndex]).toBe(active); // kein 0-ms-Durchrauschen

      vi.advanceTimersByTime(1); // nächster Schritt: Zugende
      expect(g.order[g.activeIndex]).not.toBe(active);
      expect(intern.turnRemainingMs()).toBe(20_000); // nächster Mensch erhält eine volle neue Frist
    } finally {
      vi.useRealTimers();
    }
  });

  it('startet den Autopilot-Abstand neu, wenn der überzogene Spieler selbst noch baut', () => {
    vi.useFakeTimers();
    try {
      const { room, players } = lobby(3);
      players.forEach((p) => room.setReady(p.id, true));
      room.startGame(players[0].id);
      driveSetup(room);

      const g = room.game!;
      const active = g.order[g.activeIndex];
      const actor = g.players.find((p) => p.id === active)!;
      g.phase = 'main';
      g.hasRolled = true;
      actor.resources = { wood: 2, brick: 2, wool: 0, grain: 0, ore: 0 };

      const intern = room as unknown as {
        clearRollTimer(): void;
        clearTurnTimer(): void;
        enforceTurn(playerId: string): void;
      };
      intern.clearRollTimer();
      intern.clearTurnTimer();
      intern.enforceTurn(active); // erste Straße durch die Timeout-Übernahme

      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS / 2);
      const manualEdge = validRoadEdges(g, active, null)[0];
      expect(manualEdge).toBeDefined();
      room.handleAction(active, { type: 'buildRoad', edge: manualEdge });

      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS / 2); // ursprünglicher Termin wäre jetzt
      expect(g.order[g.activeIndex]).toBe(active);
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS / 2 - 1);
      expect(g.order[g.activeIndex]).toBe(active);
      vi.advanceTimersByTime(1); // 700 ms seit der manuellen Straße → Zugende
      expect(g.order[g.activeIndex]).not.toBe(active);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Abwurf-Countdown (Auto-Abwerfen nach einer 7)', () => {
  // Injiziert ein Abwurf-Szenario in ein reales Spiel und bewaffnet die Timer.
  function discardSetup(turnSeconds: number, need: number) {
    const { room, players } = lobby(3);
    players.forEach((p) => room.setReady(p.id, true));
    room.setTurnTime(players[0].id, turnSeconds);
    room.startGame(players[0].id);
    driveSetup(room);
    const g = room.game!;
    const pid = players[1].id; // ein NICHT-aktiver, verbundener Mensch muss abwerfen
    const p = g.players.find((pl) => pl.id === pid)!;
    p.resources = { wood: 3, brick: 3, wool: 2, grain: 0, ore: 0 };
    g.phase = 'discard';
    g.mustDiscard = { [pid]: need };
    (room as unknown as { scheduleTimers(): void }).scheduleTimers();
    return { room, g, pid, p };
  }
  const handTotal = (r: { wood: number; brick: number; wool: number; grain: number; ore: number }) =>
    r.wood + r.brick + r.wool + r.grain + r.ore;

  it('wirft für einen säumigen Menschen nach halber Zug-Zeit automatisch (zufällig) ab', () => {
    vi.useFakeTimers();
    try {
      const { g, pid, p } = discardSetup(20, 4); // halbe Zeit = 10s
      vi.advanceTimersByTime(10_000 + 200);
      expect(g.mustDiscard[pid]).toBeUndefined(); // automatisch abgeworfen
      expect(handTotal(p.resources)).toBe(4); // 8 → 4
      expect(g.phase).toBe('moveRobber'); // Phase weitergegangen
    } finally {
      vi.useRealTimers();
    }
  });

  it('kein Auto-Abwurf, wenn Zug-Zeit aus (0)', () => {
    vi.useFakeTimers();
    try {
      const { g, pid, p } = discardSetup(0, 4);
      vi.advanceTimersByTime(120_000);
      expect(g.mustDiscard[pid]).toBe(4); // niemand hat automatisch abgeworfen
      expect(handTotal(p.resources)).toBe(8);
    } finally {
      vi.useRealTimers();
    }
  });

  it('getrennter Abwerfer blockiert die Tafel nicht: Abwurf wird per Bot-Tick sofort aufgelöst (nicht erst nach Grace)', () => {
    vi.useFakeTimers();
    try {
      const { room, g, pid } = discardSetup(0, 4); // Zug-Zeit AUS → nur der Disconnect-Pfad kann auflösen
      expect(g.mustDiscard[pid]).toBe(4);
      room.handleDisconnect(pid); // Spieler fällt mitten im Abwerfen raus (bleibt weg)
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 300); // ein Bot-Tick — NICHT die 180s-Grace
      expect(g.mustDiscard[pid]).toBeUndefined(); // sofort aufgelöst, ohne auf Grace zu warten
      expect(g.phase).toBe('moveRobber'); // Tafel läuft weiter
    } finally {
      vi.useRealTimers();
    }
  });

  it('Reconnect waehrend der Abwurf-Frist bewaffnet den Timer neu → kein Stall', () => {
    vi.useFakeTimers();
    try {
      const { room, g, pid, p } = discardSetup(20, 4); // Frist 10s
      // Abwerfer trennt Verbindung; eine Zustandsaenderung waehrend er weg ist nullt die Frist
      // (pendingDiscardHumans leer → clearDiscardTimer). Ohne Re-Arm bei reattach bliebe es dabei.
      room.handleDisconnect(pid);
      (room as unknown as { scheduleTimers(): void }).scheduleTimers();
      // Danach kommt er zurueck — reattach MUSS die Frist neu bewaffnen, sonst Dauer-Stall in 'discard'.
      room.reattach(pid, sock());
      vi.advanceTimersByTime(10_000 + 500);
      expect(g.mustDiscard[pid]).toBeUndefined(); // automatisch abgeworfen statt Dauer-Stall
      expect(handTotal(p.resources)).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Bot-Angebote an Menschen', () => {
  /** p1 = per Sitzübernahme bot-gesteuert (auto) und am Zug; p0/p2 = verbundene Menschen. */
  function botProposerGame() {
    const { room, players } = startedGame(3);
    driveSetup(room);
    // replaceWithBot greift nur bei GETRENNTEN Sitzen — removePlayer mitten im Spiel
    // lässt den Sitz stehen und setzt auto = true (der reguläre Übernahme-Pfad).
    room.removePlayer(players[1].id);
    expect(room.findPlayer(players[1].id)!.auto).toBe(true);
    const g = room.game!;
    g.phase = 'main';
    g.hasRolled = true;
    g.activeIndex = g.order.indexOf(players[1].id);
    for (const p of g.players) p.resources = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    return { room, players, g, bot: players[1].id };
  }

  it('administratives Zugende nutzt den schnellen Bot-Takt', () => {
    vi.useFakeTimers();
    try {
      const { room, g, bot } = botProposerGame();
      const intern = room as unknown as {
        botTimer: ReturnType<typeof setTimeout> | null;
        scheduleTimers(): void;
      };
      if (intern.botTimer) clearTimeout(intern.botTimer);
      intern.botTimer = null;
      intern.scheduleTimers();
      expect(g.order[g.activeIndex]).toBe(bot);
      vi.advanceTimersByTime(BOT_FAST_MOVE_DELAY_MS - 1);
      expect(g.order[g.activeIndex]).toBe(bot);
      vi.advanceTimersByTime(2);
      expect(g.order[g.activeIndex]).not.toBe(bot);
    } finally {
      vi.useRealTimers();
    }
  });

  it('findAutoActor liefert den Anbieter NICHT, solange ein Mensch noch antworten darf', () => {
    vi.useFakeTimers();
    try {
      const { room, players, g, bot } = botProposerGame();
      g.players.find((p) => p.id === bot)!.resources.ore = 1;
      g.players.find((p) => p.id === players[0].id)!.resources.wool = 1;
      room.handleAction(bot, { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
      expect(g.tradeOffer).not.toBeNull();
      // Ein Bot-Tick darf das Angebot NICHT wegräumen — die Menschen sind noch dran.
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 300);
      expect(g.tradeOffer, 'Angebot wurde dem Menschen weggerissen').not.toBeNull();
      expect(g.tradeOffer!.responses[players[0].id]).toBe('pending');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ein unbeantwortetes Bot-Angebot läuft nach BOT_TRADE_TIMEOUT_MS ab — der Zug endet', () => {
    vi.useFakeTimers();
    try {
      const { room, players, g, bot } = botProposerGame();
      g.players.find((p) => p.id === bot)!.resources.ore = 1;
      g.players.find((p) => p.id === players[0].id)!.resources.wool = 1;
      room.handleAction(bot, { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
      expect(g.tradeOffer).not.toBeNull();
      // Niemand klickt. Ohne Frist bliebe der Bot-Zug für immer hängen: bot.ts wartet
      // bewusst, und armTurnTimer läuft für Bot-Aktive nicht.
      vi.advanceTimersByTime(BOT_TRADE_TIMEOUT_MS + 500);
      expect(g.tradeOffer).toBeNull();
      // Danach läuft der Bot normal weiter und beendet seinen Zug.
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS * 6);
      expect(g.order[g.activeIndex]).not.toBe(bot);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Timeout führt eine vorhandene Annahme aus, obwohl ein anderer Mensch säumig ist', () => {
    vi.useFakeTimers();
    try {
      const { room, players, g, bot } = botProposerGame();
      g.players.find((p) => p.id === bot)!.resources.ore = 1;
      g.players.find((p) => p.id === players[0].id)!.resources.wool = 1;
      room.handleAction(bot, { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
      const offerId = g.tradeOffer!.id;
      room.handleAction(players[0].id, { type: 'respondTrade', offerId, accept: true });
      expect(g.tradeOffer!.responses[players[2].id]).toBe('pending');
      vi.advanceTimersByTime(BOT_TRADE_TIMEOUT_MS + 100);
      expect(g.tradeOffer).toBeNull();
      expect(g.players.find((p) => p.id === bot)!.resources.wool).toBe(1);
      expect(g.players.find((p) => p.id === players[0].id)!.resources.ore).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('antwortet der Mensch, löst der Bot sofort auf — ohne auf die Frist zu warten', () => {
    vi.useFakeTimers();
    try {
      const { room, players, g, bot } = botProposerGame();
      g.players.find((p) => p.id === bot)!.resources.ore = 1;
      g.players.find((p) => p.id === players[0].id)!.resources.wool = 1;
      room.handleAction(bot, { type: 'proposeTrade', give: { ore: 1 }, get: { wool: 1 } });
      const offerId = g.tradeOffer!.id;
      room.handleAction(players[0].id, { type: 'respondTrade', offerId, accept: true });
      room.handleAction(players[2].id, { type: 'respondTrade', offerId, accept: false });
      vi.advanceTimersByTime(BOT_MOVE_DELAY_MS + 300); // ein Tick genügt — keine 15 s
      expect(g.tradeOffer).toBeNull();
      expect(g.players.find((p) => p.id === bot)!.resources.wool).toBe(1); // Tausch ausgeführt
    } finally {
      vi.useRealTimers();
    }
  });

  it('Tisch mit 3 Bots + untätigem Menschen spielt bis zum Sieg durch', () => {
    // Deckt beides ab: der Bot-Tick treibt die Bot-Sitze, und der Zug des untätigen
    // MENSCHEN wird nach Ablauf der Zugzeit von enforceTurn voll ausgespielt.
    // (Den Menschen zu entfernen ginge nicht: ohne verbundenen Menschen gilt der Raum
    // als leer und wird nach EMPTY_ROOM_TTL_MS abgeräumt — der Tick stirbt mit.)
    vi.useFakeTimers();
    try {
      const { room, players } = lobby(1);
      for (let i = 0; i < 3; i++) room.addBot(players[0].id); // braucht echtes Math.random für die Bot-Ids
      room.setReady(players[0].id, true);
      // startGame würfelt den Seed aus `Date.now() ^ Math.random()` — ohne festen Wert
      // wäre dieser Test von Lauf zu Lauf ein anderes Brett und damit flaky. Date.now()
      // steht unter Fake-Timern still, Math.random pinnen wir nur für diesen Aufruf.
      const rnd = vi.spyOn(Math, 'random').mockReturnValue(0.4242);
      expect(room.startGame(players[0].id)).toBeNull();
      rnd.mockRestore();
      driveSetup(room); // Setup hat bewusst keinen Countdown → hier direkt durchspielen
      expect(room.game!.phase).not.toBe('setupSettlement');
      for (let i = 0; i < 20_000 && room.phase === 'playing'; i++) {
        vi.advanceTimersByTime(1000);
      }
      expect(room.phase).toBe('finished');
      expect(room.game!.winner).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
