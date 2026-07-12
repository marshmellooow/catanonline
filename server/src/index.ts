import { WebSocketServer, type WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import { Room } from './room.js';
import type { ClientMsg, ServerMsg } from '@catan/shared';

// Eigene Env-Variable, damit ein generisches PORT (z. B. vom Dev-/Preview-Harness
// für den Vite-Client gesetzt) den WS-Server nicht auf denselben Port umleitet.
const PORT = Number(process.env.CATAN_SERVER_PORT ?? 8787);

// Raum-Codes: keine mehrdeutigen Zeichen (0/O/1/I/L)
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const rooms = new Map<string, Room>();
const sessions = new Map<string, { code: string; playerId: string }>();

function genCode(): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    if (!rooms.has(c)) return c;
  }
  return randomUUID().slice(0, 6).toUpperCase();
}

interface Conn {
  sessionId?: string;
  code?: string;
  playerId?: string;
  isSpectator?: boolean;
  alive: boolean;
}

const wss = new WebSocketServer({ port: PORT });
const hooks = {
  onEmpty(code: string) {
    const room = rooms.get(code);
    if (room) {
      // zugehörige Sessions aufräumen
      for (const [sid, s] of sessions) if (s.code === code) sessions.delete(sid);
      rooms.delete(code);
      console.log(`[room ${code}] destroyed (empty)`);
    }
  },
};

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

wss.on('connection', (ws: WebSocket) => {
  const conn: Conn = { alive: true };
  (ws as unknown as { _conn: Conn })._conn = conn;
  ws.on('pong', () => (conn.alive = true));

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handle(ws, conn, msg);
  });

  ws.on('close', () => {
    if (conn.code && conn.playerId) {
      const room = rooms.get(conn.code);
      room?.handleDisconnect(conn.playerId);
    }
  });
  ws.on('error', () => {});
});

function handle(ws: WebSocket, conn: Conn, msg: ClientMsg) {
  switch (msg.t) {
    case 'createRoom': {
      const code = genCode();
      const room = new Room(code, hooks);
      rooms.set(code, room);
      const sessionId = randomUUID();
      const player = room.addPlayer(sessionId, msg.name, msg.colorIndex, ws);
      conn.sessionId = sessionId;
      conn.code = code;
      conn.playerId = player.id;
      conn.isSpectator = false;
      sessions.set(sessionId, { code, playerId: player.id });
      send(ws, { t: 'welcome', sessionId, playerId: player.id, code });
      room.broadcastRoom();
      console.log(`[room ${code}] created by ${player.name}`);
      return;
    }
    case 'joinRoom': {
      const code = msg.code.trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        send(ws, { t: 'notFound', reason: 'Raum nicht gefunden.' });
        return;
      }
      const sessionId = randomUUID();
      const { playerId, isSpectator } = room.join(sessionId, msg.name, ws);
      conn.sessionId = sessionId;
      conn.code = code;
      conn.playerId = playerId;
      conn.isSpectator = isSpectator;
      sessions.set(sessionId, { code, playerId });
      send(ws, { t: 'welcome', sessionId, playerId, code });
      return;
    }
    case 'rejoin': {
      const s = sessions.get(msg.sessionId);
      if (!s) {
        send(ws, { t: 'notFound', reason: 'Sitzung abgelaufen.' });
        return;
      }
      const room = rooms.get(s.code);
      if (!room) {
        sessions.delete(msg.sessionId);
        send(ws, { t: 'notFound', reason: 'Raum existiert nicht mehr.' });
        return;
      }
      const okReattach = room.reattach(s.playerId, ws);
      if (!okReattach) {
        send(ws, { t: 'notFound', reason: 'Sitz nicht mehr vorhanden.' });
        return;
      }
      conn.sessionId = msg.sessionId;
      conn.code = s.code;
      conn.playerId = s.playerId;
      send(ws, { t: 'welcome', sessionId: msg.sessionId, playerId: s.playerId, code: s.code });
      console.log(`[room ${s.code}] ${s.playerId} reconnected`);
      return;
    }
    case 'ping': {
      // raumunabhängig beantworten (auch auf dem Startbildschirm)
      send(ws, { t: 'pong', ts: msg.ts });
      if (conn.code && conn.playerId) rooms.get(conn.code)?.pong(conn.playerId, msg.ts);
      return;
    }
    default:
      break;
  }

  // Ab hier ist eine Raumzugehörigkeit nötig
  if (!conn.code || !conn.playerId) {
    send(ws, { t: 'error', message: 'Kein aktiver Raum.' });
    return;
  }
  const room = rooms.get(conn.code);
  if (!room) {
    send(ws, { t: 'error', message: 'Raum nicht mehr vorhanden.' });
    return;
  }
  const pid = conn.playerId;

  switch (msg.t) {
    case 'setReady': room.setReady(pid, msg.ready); break;
    case 'setColor': room.setColor(pid, msg.colorIndex); break;
    case 'setName': room.setName(pid, msg.name); break;
    case 'chooseMap': room.chooseMap(pid, msg.mapId); break;
    case 'setOption': room.setOption(pid, msg.vpTarget); break;
    case 'setBankSize': room.setBankSize(pid, msg.bankSize); break;
    case 'setTurnTime': room.setTurnTime(pid, msg.turnSeconds); break;
    case 'kick': room.kick(pid, msg.playerId); break;
    case 'replaceWithBot': room.replaceWithBot(pid, msg.playerId); break;
    case 'addBot': room.addBot(pid); break;
    case 'removeBot': room.removeBot(pid, msg.playerId); break;
    case 'startGame': {
      const err = room.startGame(pid);
      if (err) send(ws, { t: 'error', message: err });
      break;
    }
    case 'returnToLobby': room.returnToLobby(pid); break;
    case 'leaveRoom': {
      room.removePlayer(pid);
      if (conn.sessionId) sessions.delete(conn.sessionId);
      conn.code = undefined;
      conn.playerId = undefined;
      break;
    }
    case 'action': room.handleAction(pid, msg.action); break;
    case 'chat': room.chat(pid, msg.text); break;
    default:
      break;
  }
}

// Heartbeat: tote Verbindungen erkennen und schließen
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const conn = (ws as unknown as { _conn?: Conn })._conn;
    if (!conn) continue;
    if (!conn.alive) {
      ws.terminate();
      continue;
    }
    conn.alive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 30_000);

wss.on('close', () => clearInterval(heartbeat));

console.log(`Catan-Server läuft auf ws://localhost:${PORT}`);
