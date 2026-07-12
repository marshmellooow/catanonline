import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { PLAYER_COLORS } from '@catan/shared';

const PIP_POS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
  6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

/** Kleines Würfel-Symbol für Chat-Wurfeinträge. */
function MiniDie({ n }: { n: number }) {
  return (
    <svg viewBox="0 0 100 100" width="17" height="17" style={{ verticalAlign: 'middle', flexShrink: 0 }}>
      <rect x="6" y="6" width="88" height="88" rx="18" fill="#F8F2DE" stroke="rgba(90,74,48,.35)" strokeWidth="4" />
      {(PIP_POS[n] ?? []).map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="11" fill="#1F5C3A" />
      ))}
    </svg>
  );
}

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
            {c.dice ? (
              <span className="chat-roll">
                <MiniDie n={c.dice[0]} />
                <MiniDie n={c.dice[1]} />
                <b className="chat-roll-sum num">{c.dice[0] + c.dice[1]}</b>
              </span>
            ) : (
              <span className="text-2">{c.text}</span>
            )}
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
