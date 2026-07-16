import type { ClientMsg, ServerMsg } from '@catan/shared';

export type ConnStatus = 'connecting' | 'online' | 'offline';

interface Handlers {
  onMessage: (msg: ServerMsg) => void;
  onStatus: (status: ConnStatus) => void;
  getSessionId: () => string | null;
}

const STALE_MS = 20_000; // seit so lange nichts vom Server → Verbindung gilt als (still) tot → reconnect

let ws: WebSocket | null = null;
let handlers: Handlers | null = null;
let retry = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let manualClose = false;
let lastRecv = Date.now(); // Zeitpunkt der letzten empfangenen Server-Nachricht (Watchdog)

function url(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

function scheduleReconnect() {
  if (reconnectTimer || manualClose) return;
  const delay = Math.min(1000 * 2 ** retry, 8000); // Exponential-Backoff, max 8s
  retry++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    open();
  }, delay);
}

function open() {
  if (!handlers) return;
  manualClose = false;
  handlers.onStatus('connecting');
  const socket = new WebSocket(url());
  ws = socket;

  socket.onopen = () => {
    retry = 0;
    lastRecv = Date.now();
    handlers?.onStatus('online');
    // Reconnect: bekannte Sitzung wiederherstellen
    const sid = handlers?.getSessionId();
    if (sid) send({ t: 'rejoin', sessionId: sid });
    // Latenz-Ping + Watchdog
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      // Watchdog: seit STALE_MS nichts vom Server empfangen (obwohl wir alle 5s pingen)?
      // → Verbindung gilt als (still) tot → proaktiv schließen und neu verbinden. Auf Mobil
      //   hängt das native `close` bei schlechtem Netz oft sehr lange — das fängt es ab.
      if (Date.now() - lastRecv > STALE_MS) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
        return;
      }
      send({ t: 'ping', ts: Date.now() });
    }, 5000);
  };
  socket.onmessage = (ev) => {
    lastRecv = Date.now();
    try {
      handlers?.onMessage(JSON.parse(ev.data) as ServerMsg);
    } catch {
      /* ignore */
    }
  };
  socket.onclose = () => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    ws = null;
    if (!manualClose) {
      handlers?.onStatus('offline');
      scheduleReconnect();
    }
  };
  socket.onerror = () => {
    socket.close();
  };
}

export function initConnection(h: Handlers) {
  handlers = h;
  open();
}

export function send(msg: ClientMsg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

export function isOpen(): boolean {
  return !!ws && ws.readyState === WebSocket.OPEN;
}
