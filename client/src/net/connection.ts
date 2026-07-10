import type { ClientMsg, ServerMsg } from '@catan/shared';

export type ConnStatus = 'connecting' | 'online' | 'offline';

interface Handlers {
  onMessage: (msg: ServerMsg) => void;
  onStatus: (status: ConnStatus) => void;
  getSessionId: () => string | null;
}

let ws: WebSocket | null = null;
let handlers: Handlers | null = null;
let retry = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let manualClose = false;

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
    handlers?.onStatus('online');
    // Reconnect: bekannte Sitzung wiederherstellen
    const sid = handlers?.getSessionId();
    if (sid) send({ t: 'rejoin', sessionId: sid });
    // Latenz-Ping
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => send({ t: 'ping', ts: Date.now() }), 5000);
  };
  socket.onmessage = (ev) => {
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
