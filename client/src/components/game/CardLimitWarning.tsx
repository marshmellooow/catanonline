import { AlertTriangle } from '../../icons';

/**
 * Rote Mitteilung mittig im Bild, solange man **mehr als 7 Rohstoffkarten** hält:
 * Bei einer gewürfelten 7 muss man die Hälfte abwerfen. `pointer-events: none`,
 * damit das Brett darunter bedienbar bleibt.
 */
export function CardLimitWarning({ count }: { count: number }) {
  return (
    <div className="card-limit-warning" role="alert">
      <AlertTriangle size={24} />
      <span>
        Du hast <b>{count}</b> Karten! Bei einer <b>7</b> verlierst du die Hälfte.
      </span>
    </div>
  );
}
