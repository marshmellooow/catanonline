import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { Timer } from '../../icons';

/**
 * Vollbild-Effekte rund um den Zug-Countdown (server-synchron, für ALLE Spieler gleich):
 *
 *  1) **Großer Intro-Timer** — startet ein neuer Zug mit Limit, blitzt die Restzeit
 *     kurz groß in der Bildschirmmitte auf und schrumpft nach ~2 s in die obere Ecke
 *     (wo die kleine `TurnTimer`-Pille im Kopf sitzt). Rein per CSS-Keyframe.
 *  2) **Roter Bildschirm-Puls** — sobald der Timer in den roten Modus kommt (≤10 s),
 *     pulsiert der Screen leicht rot an den Rändern, im selben 1-s-Tempo wie die
 *     Timer-Pille. **Nur für die Person, die gerade am Zug ist** (activePlayer === you) —
 *     damit die anderen nicht gestört werden, der Aktive aber merkt: gleich ist Schluss.
 *
 * Kein Server-/Store-Umbau nötig: liest nur `turnDeadline` + den aktuellen Zug
 * (activePlayer/turnCount). Während Bot-Zügen/Setup liefert der Server keine echte
 * Restzeit (→ 0), daher greifen beide Effekte automatisch nur bei echten Zügen mit Limit.
 */

const BIG_MIN_REMAINING_MS = 2000; // darunter (Bot/Setup/abgelaufen) kein Intro

function fmt(secs: number): string {
  const mm = Math.floor(secs / 60);
  const ss = secs % 60;
  return mm > 0 ? `${mm}:${String(ss).padStart(2, '0')}` : `${ss}s`;
}

export function TurnTimerFx() {
  const deadline = useStore((s) => s.turnDeadline);
  const activePlayer = useStore((s) => s.game?.activePlayer);
  const you = useStore((s) => s.game?.you);
  const turnCount = useStore((s) => s.game?.turnCount);
  const [now, setNow] = useState(() => Date.now());
  const [big, setBig] = useState<{ key: string; label: string } | null>(null);
  const lastTurnKey = useRef<string | null>(null);

  // Ticken, solange ein Limit aktiv ist — treibt den Sekundenwert für den roten Puls.
  useEffect(() => {
    if (deadline == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [deadline]);

  // Zugwechsel erkennen → großen Intro-Timer auslösen (nur bei echter Restzeit).
  const turnKey = activePlayer != null ? `${activePlayer}#${turnCount}` : null;
  useEffect(() => {
    if (!turnKey || turnKey === lastTurnKey.current) return;
    lastTurnKey.current = turnKey;
    const remaining = deadline != null ? deadline - Date.now() : 0;
    if (remaining > BIG_MIN_REMAINING_MS) {
      setBig({ key: turnKey, label: fmt(Math.ceil(remaining / 1000)) });
    }
  }, [turnKey, deadline]);

  const secs = deadline != null ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
  const low = secs != null && secs > 0 && secs <= 10;
  // Roter Puls nur für den aktiven Spieler — die anderen sollen nicht gestört werden.
  const myTurn = activePlayer != null && activePlayer === you;

  return (
    <>
      {low && myTurn && <div className="turn-red-pulse" aria-hidden="true" />}

      {big && (
        <div className="turn-big-wrap" aria-hidden="true">
          <div
            key={big.key}
            className="turn-big"
            onAnimationEnd={() => setBig((b) => (b && b.key === big.key ? null : b))}
          >
            <Timer size={30} />
            <span className="turn-big-num">{big.label}</span>
          </div>
        </div>
      )}
    </>
  );
}
