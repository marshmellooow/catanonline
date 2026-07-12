import { useStore, UI_SCALE_MIN, UI_SCALE_MAX } from '../../store';
import { Settings, Minus, Plus, X } from '../../icons';

/** Einstellungen: bislang die UI-Größe (Karten, Bank, Aktivitäts-Feed). Wert bleibt gespeichert. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const uiScale = useStore((s) => s.uiScale);
  const setUiScale = useStore((s) => s.setUiScale);
  const pct = Math.round(uiScale * 100);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal-card" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={19} /> Einstellungen
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>

        <div style={{ marginTop: 18 }}>
          <div className="field-label">UI-Größe — Karten, Bank & Verlauf</div>
          <div className="row gap-3" style={{ alignItems: 'center', marginTop: 8 }}>
            <button
              className="btn btn-ghost"
              aria-label="Kleiner"
              disabled={uiScale <= UI_SCALE_MIN + 0.001}
              onClick={() => setUiScale(uiScale - 0.05)}
            >
              <Minus size={16} />
            </button>
            <div className="num" style={{ minWidth: 70, textAlign: 'center', fontSize: 22, color: 'var(--gold)' }}>
              {pct}%
            </div>
            <button
              className="btn btn-ghost"
              aria-label="Größer"
              disabled={uiScale >= UI_SCALE_MAX - 0.001}
              onClick={() => setUiScale(uiScale + 0.05)}
            >
              <Plus size={16} />
            </button>
          </div>
          <input
            type="range"
            min={UI_SCALE_MIN}
            max={UI_SCALE_MAX}
            step={0.05}
            value={uiScale}
            onChange={(e) => setUiScale(Number(e.target.value))}
            style={{ width: '100%', marginTop: 14, accentColor: 'var(--gold)' }}
          />
          <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
            Macht deine Handkarten, die Bank und den Aktivitäts-Verlauf größer oder kleiner. Gilt nur für dich.
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          <button className="btn btn-gold" onClick={onClose}>Fertig</button>
        </div>
      </div>
    </div>
  );
}
