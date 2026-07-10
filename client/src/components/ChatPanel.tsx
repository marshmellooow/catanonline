import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { PLAYER_COLORS } from '@catan/shared';

export function ChatPanel() {
  const chat = useStore((s) => s.chat);
  const sendMsg = useStore((s) => s.sendMsg);
  const [text, setText] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [chat.length]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    sendMsg({ t: 'chat', text: t });
    setText('');
  };

  return (
    <div className="side" style={{ flex: 1, minHeight: 0 }}>
      <div className="chat-log" ref={logRef}>
        {chat.length === 0 && <div className="muted" style={{ fontSize: 13 }}>Noch keine Nachrichten…</div>}
        {chat.map((c, i) => (
          <div key={i} className="chat-line">
            <span className="chat-name" style={{ color: c.colorIndex >= 0 ? PLAYER_COLORS[c.colorIndex].l : 'var(--muted)' }}>
              {c.name}:
            </span>{' '}
            <span className="text-2">{c.text}</span>
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input value={text} maxLength={300} placeholder="Nachricht…" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
        <button className="btn btn-ghost btn-sm" onClick={send}>Senden</button>
      </div>
    </div>
  );
}
