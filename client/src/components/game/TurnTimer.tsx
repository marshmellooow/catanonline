import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { Timer } from '../../icons';

/** Zug-Countdown im Kopf: zeigt die Restzeit des aktuellen Zugs (server-gesteuert, für alle gleich). */
export function TurnTimer() {
  const deadline = useStore((s) => s.turnDeadline);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [deadline]);

  if (deadline == null) return null;
  const secs = Math.max(0, Math.ceil((deadline - now) / 1000));
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  const label = mm > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : `${ss}s`;

  return (
    <span className={`turn-timer num ${secs <= 10 ? 'low' : ''}`} title="Restzeit für diesen Zug">
      <Timer size={14} /> {label}
    </span>
  );
}
