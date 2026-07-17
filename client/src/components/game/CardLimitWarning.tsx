import { useEffect, useState } from 'react';
import { AlertTriangle } from '../../icons';

/** Wie lange die Warnung mittig stehen bleibt, bevor sie nach oben wandert. */
const CENTER_MS = 10_000;

/**
 * Rote Mitteilung, solange man **mehr als 7 Rohstoffkarten** hält: bei einer
 * gewürfelten 7 muss man die Hälfte abwerfen.
 *
 * Sie erscheint mittig (damit man sie sicher bemerkt), bleibt dort ~10 s und
 * wandert dann kompakt an den oberen Rand, wo sie bleibt, bis man wieder unter
 * die Grenze kommt — so verdeckt sie das Brett nicht dauerhaft.
 * `pointer-events: none`, damit das Brett darunter bedienbar bleibt.
 */
export function CardLimitWarning({ count }: { count: number }) {
  const [docked, setDocked] = useState(false);

  useEffect(() => {
    // Läuft einmal je „Auftreten": sobald man wieder ≤7 Karten hat, wird die
    // Komponente unmountet — beim nächsten Mal beginnt die Mitte-Phase neu.
    // Ändert sich nur die Anzahl (8→9), bleibt sie stehen, wo sie ist.
    const t = setTimeout(() => setDocked(true), CENTER_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={`card-limit-warning${docked ? ' docked' : ''}`} role="alert">
      <AlertTriangle size={24} />
      <span>
        Du hast <b>{count}</b> Karten! Bei einer <b>7</b> verlierst du die Hälfte.
      </span>
    </div>
  );
}
