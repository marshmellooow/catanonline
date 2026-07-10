import { describe, it, expect, vi } from 'vitest';
import { Room } from '../src/room.js';
import { GRACE_MS } from '@catan/shared';

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
  it('Letzter Mensch verlässt Lobby: Raum wird nach 120s zerstört', () => {
    vi.useFakeTimers();
    try {
      let emptied: string | null = null;
      const room = new Room('T', { onEmpty: (c) => (emptied = c) });
      const p0 = room.addPlayer('s0', 'P0', undefined, sock());
      room.handleDisconnect(p0.id);
      expect(emptied).toBeNull();
      vi.advanceTimersByTime(120_000 + 10);
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
      vi.advanceTimersByTime(GRACE_MS + 120_000 + 10);
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
