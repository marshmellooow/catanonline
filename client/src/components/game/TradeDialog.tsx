import { useState } from 'react';
import { useStore } from '../../store';
import { RESOURCE_ORDER, resLabel } from './ui';
import { ResourceCard } from './ResourceCard';
import { bestBankRate, playerPorts, type ResourceType, type GameState } from '@catan/shared';
import { ArrowUp, ArrowDown, X, Plus, Minus } from '../../icons';

function emptyCounts(): Record<ResourceType, number> {
  return { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

/** Handels-Editor. Zwei Modi:
 *  - 'propose' (Standard): der aktive Spieler schlägt einen Handel vor (inkl. Bank-Tausch).
 *  - 'counter': ein Empfänger schickt ein Gegenangebot zurück. `give`/`get` bleiben
 *    aus SEINER Sicht („Du gibst / Du bekommst") — der Reducer dreht die Perspektive.
 *    Kein Bank-Tausch (nur für den aktiven Spieler sinnvoll), kein activePlayer-Check. */
export function TradeDialog({
  onClose,
  mode = 'propose',
  offerId,
  initialGive,
  initialGet,
}: {
  onClose: () => void;
  mode?: 'propose' | 'counter';
  offerId?: string;
  initialGive?: Record<ResourceType, number>;
  initialGet?: Record<ResourceType, number>;
}) {
  const game = useStore((s) => s.game);
  const me = useStore((s) => s.playerId);
  const act = useStore((s) => s.act);
  const [give, setGive] = useState(initialGive ?? emptyCounts());
  const [get, setGet] = useState(initialGet ?? emptyCounts());
  const isCounter = mode === 'counter';

  if (!game || !me) return null;
  const you = game.players.find((p) => p.id === me)!;
  const res = you.resources!;
  // Häfen des Spielers für Bankkurse
  const ports = playerPorts(game as unknown as GameState, me);

  const totalGive = RESOURCE_ORDER.reduce((s, r) => s + give[r], 0);
  const totalGet = RESOURCE_ORDER.reduce((s, r) => s + get[r], 0);

  const stepGive = (r: ResourceType, d: number) => setGive((p) => ({ ...p, [r]: Math.max(0, Math.min(res[r], p[r] + d)) }));
  const stepGet = (r: ResourceType, d: number) => setGet((p) => ({ ...p, [r]: Math.max(0, p[r] + d) }));

  // Bank-Tausch: genau ein Geben-Typ mit passendem Kurs, genau ein Bekommen-Typ = 1
  const giveTypes = RESOURCE_ORDER.filter((r) => give[r] > 0);
  const getTypes = RESOURCE_ORDER.filter((r) => get[r] > 0);
  const bankPossible =
    giveTypes.length === 1 && getTypes.length === 1 && get[getTypes[0]] === 1 && give[giveTypes[0]] === bestBankRate(ports, giveTypes[0]);
  const bankRate = giveTypes.length === 1 ? bestBankRate(ports, giveTypes[0]) : 4;

  // Im Gegenangebot-Modus ist man bewusst NICHT der aktive Spieler.
  const canOffer = totalGive > 0 && totalGet > 0 && (isCounter || game.activePlayer === me);

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="dialog modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{isCounter ? 'Gegenangebot' : 'Handel vorschlagen'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="trade-give-get">
          <div>
            <div className="field-label" style={{ color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 4 }}><ArrowUp size={14} /> Du gibst</div>
            {RESOURCE_ORDER.map((r) => (
              <div key={r} className={`trade-res ${res[r] > 0 ? 'owned' : 'empty'}`}>
                <ResourceCard resource={r} size={30} label={false} />
                <div className="trade-res-label">
                  {resLabel(r)}
                  <span className="trade-res-count" title="Im Besitz">{res[r]}</span>
                </div>
                <div className="stepper">
                  <button className="step-btn step-minus" onClick={() => stepGive(r, -1)} disabled={give[r] === 0} aria-label={`Ein ${resLabel(r)} weniger geben`}>
                    <Minus size={16} />
                  </button>
                  <span className={`num${give[r] > 0 ? ' active' : ''}`}>{give[r]}</span>
                  <button className="step-btn step-plus" onClick={() => stepGive(r, 1)} disabled={give[r] >= res[r]} aria-label={`Ein ${resLabel(r)} mehr geben`}>
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div>
            <div className="field-label" style={{ color: 'var(--green-light)', display: 'flex', alignItems: 'center', gap: 4 }}><ArrowDown size={14} /> Du bekommst</div>
            {RESOURCE_ORDER.map((r) => (
              <div key={r} className="trade-res owned">
                <ResourceCard resource={r} size={30} label={false} />
                <div className="trade-res-label">{resLabel(r)}</div>
                <div className="stepper">
                  <button className="step-btn step-minus" onClick={() => stepGet(r, -1)} disabled={get[r] === 0} aria-label={`Ein ${resLabel(r)} weniger bekommen`}>
                    <Minus size={16} />
                  </button>
                  <span className={`num${get[r] > 0 ? ' active active-get' : ''}`}>{get[r]}</span>
                  <button className="step-btn step-plus step-plus-get" onClick={() => stepGet(r, 1)} aria-label={`Ein ${resLabel(r)} mehr bekommen`}>
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="row gap-2" style={{ marginTop: 16, flexWrap: 'wrap' }}>
          <button
            className="btn btn-gold"
            disabled={!canOffer}
            onClick={() => {
              if (isCounter && offerId) act({ type: 'counterTrade', offerId, give, get });
              else act({ type: 'proposeTrade', give, get });
              onClose();
            }}
          >
            {isCounter ? 'Gegenangebot senden' : 'Spielern anbieten'}
          </button>
          {!isCounter && (
            <button
              className="btn btn-outline"
              disabled={!bankPossible}
              title={`Kurs ${bankRate}:1`}
              onClick={() => { act({ type: 'bankTrade', give: giveTypes[0], get: getTypes[0] }); onClose(); }}
            >
              Bank-Tausch {giveTypes.length === 1 ? `${bankRate}:1` : '4:1'}
            </button>
          )}
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          {isCounter
            ? 'Dein Gegenangebot geht zurück an den Spieler am Zug — er kann es annehmen.'
            : `Bank-Tausch: gib genau ${bankRate}× einen Rohstoff für 1× einen anderen. Häfen senken den Kurs.`}
        </p>
      </div>
    </div>
  );
}
