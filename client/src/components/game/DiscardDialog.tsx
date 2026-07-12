import { useEffect, useLayoutEffect, useState } from 'react';
import { useStore } from '../../store';
import { RESOURCE_ORDER, resLabel } from './ui';
import { ResourceCard } from './ResourceCard';
import type { ResourceType } from '@catan/shared';

export function DiscardDialog() {
  const game = useStore((s) => s.game);
  const me = useStore((s) => s.playerId);
  const act = useStore((s) => s.act);
  const discardDeadline = useStore((s) => s.discardDeadline);
  const [sel, setSel] = useState<Record<ResourceType, number>>({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
  const [now, setNow] = useState(() => Date.now());

  // Auswahl NICHT über mehrere Räuber-Runden merken: bei jedem Eintritt in die
  // Abwerf-Phase zurücksetzen (die Komponente bleibt sonst gemountet → alter Stand).
  const inDiscard = game?.phase === 'discard';
  useEffect(() => {
    if (inDiscard) setSel({ wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 });
  }, [inDiscard]);

  // Countdown bis zum automatischen Zufalls-Abwurf (halbe Zug-Zeit).
  // useLayoutEffect: setzt `now` beim Sichtbarwerden VOR dem Paint frisch → kein kurzer
  // Flash eines zu großen Werts (sonst zeigt der erste Frame die bisherige Spieldauer + Frist).
  useLayoutEffect(() => {
    if (discardDeadline == null) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [discardDeadline]);

  if (!game || !me || game.phase !== 'discard') return null;
  const need = game.mustDiscard[me];
  if (need === undefined) {
    return (
      <div className="modal-scrim">
        <div className="dialog modal-card">
          <h2>Abwerfen</h2>
          <p className="muted">Warte auf die anderen Spieler beim Abwerfen…</p>
        </div>
      </div>
    );
  }
  const you = game.players.find((p) => p.id === me)!;
  const res = you.resources!;
  const total = RESOURCE_ORDER.reduce((s, r) => s + sel[r], 0);

  // Countdown-Label (nur wenn ein Zug-Zeitlimit aktiv ist).
  const remainMs = discardDeadline != null ? Math.max(0, discardDeadline - now) : null;
  const remainSecs = remainMs != null ? Math.ceil(remainMs / 1000) : null;
  const countdownLabel =
    remainSecs != null
      ? remainSecs >= 60
        ? `${Math.floor(remainSecs / 60)}:${String(remainSecs % 60).padStart(2, '0')}`
        : `${remainSecs}s`
      : null;

  const step = (r: ResourceType, d: number) => {
    setSel((prev) => {
      const v = Math.max(0, Math.min(res[r], prev[r] + d));
      return { ...prev, [r]: v };
    });
  };

  return (
    <div className="modal-scrim">
      <div className="dialog modal-card">
        <h2>Abwerfen — du hältst zu viele Karten</h2>
        <p className="muted">Wirf genau <b style={{ color: 'var(--gold)' }}>{need}</b> Karten ab (gewählt: {total}/{need}).</p>
        {countdownLabel != null && (
          <div className={`discard-timer ${remainSecs != null && remainSecs <= 10 ? 'low' : ''}`}>
            Automatischer Zufalls-Abwurf in <b className="num">{countdownLabel}</b>
          </div>
        )}
        <div className="trade-rows">
          {RESOURCE_ORDER.map((r) => (
            <div key={r} className="trade-res">
              <ResourceCard resource={r} size={30} label={false} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>{resLabel(r)}</div>
                <div className="muted" style={{ fontSize: 12 }}>Hand: {res[r]}</div>
              </div>
              <div className="stepper">
                <button onClick={() => step(r, -1)} disabled={sel[r] === 0}>−</button>
                <span className="num">{sel[r]}</span>
                <button onClick={() => step(r, 1)} disabled={sel[r] >= res[r] || total >= need}>+</button>
              </div>
            </div>
          ))}
        </div>
        <button
          className="btn btn-gold"
          style={{ width: '100%', marginTop: 14 }}
          disabled={total !== need}
          onClick={() => act({ type: 'discard', resources: sel })}
        >
          {total} Karten abwerfen
        </button>
      </div>
    </div>
  );
}
