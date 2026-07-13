import { APP_VERSION_LABEL } from '@catan/shared';
import { X } from '../icons';
import { InfoBasics } from './game/InfoBasics';

/**
 * Info- & Regeln-Dialog. Aktuell zeigt er die App-Version (aus @catan/shared,
 * einzige Quelle) und einen Platzhalter für die Spielregeln — hier werden die
 * Regeln später Schritt für Schritt eingebaut. Wird von Home & Lobby genutzt.
 */
export function InfoDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="info-scrim" onClick={onClose}>
      <div className="info-card panel" onClick={(e) => e.stopPropagation()}>
        <div className="info-head">
          <div>
            <h2 className="info-title">Catan Online</h2>
            <div className="info-version">{APP_VERSION_LABEL}</div>
          </div>
          <button className="btn btn-ghost btn-sm" aria-label="Schließen" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="info-body">
          <section className="info-sec">
            <h3>So funktioniert Catan</h3>
            <p className="muted">
              Baue Straßen, Siedlungen und Städte, sammle Rohstoffe (Holz, Lehm, Wolle, Getreide, Erz),
              handle mit Mitspielern und erreiche als Erster das Siegpunkte-Ziel.
            </p>
          </section>

          <InfoBasics />
        </div>

        <div className="info-foot">
          <span className="muted">Version {APP_VERSION_LABEL}</span>
          <button className="btn btn-gold btn-sm" onClick={onClose}>Verstanden</button>
        </div>
      </div>
    </div>
  );
}
