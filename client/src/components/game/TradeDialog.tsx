import { useState } from 'react';
import { useStore } from '../../store';
import { RESOURCE_ORDER, resLabel } from './ui';
import { ResourceCard } from './ResourceCard';
import { bestBankRate, playerPorts, type ResourceType, type GameState } from '@catan/shared';
import { ArrowUp, ArrowDown, X } from '../../icons';

function emptyCounts(): Record<ResourceType, number> {
  return { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

export function TradeDialog({ onClose }: { onClose: () => void }) {
  const game = useStore((s) => s.game);
  const me = useStore((s) => s.playerId);
  const act = useStore((s) => s.act);
  const [give, setGive] = useState(emptyCounts());
  const [get, setGet] = useState(emptyCounts());

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

  const canOffer = totalGive > 0 && totalGet > 0 && game.activePlayer === me;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="dialog modal-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Handel vorschlagen</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="trade-give-get">
          <div>
            <div className="field-label" style={{ color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: 4 }}><ArrowUp size={14} /> Du gibst</div>
            {RESOURCE_ORDER.map((r) => (
              <div key={r} className="trade-res" style={{ opacity: give[r] > 0 ? 1 : 0.5 }}>
                <ResourceCard resource={r} size={30} label={false} />
                <div style={{ flex: 1, fontWeight: 700 }}>{resLabel(r)} <span className="muted" style={{ fontWeight: 400 }}>({res[r]})</span></div>
                <div className="stepper">
                  <button onClick={() => stepGive(r, -1)} disabled={give[r] === 0}>−</button>
                  <span className="num">{give[r]}</span>
                  <button onClick={() => stepGive(r, 1)} disabled={give[r] >= res[r]}>+</button>
                </div>
              </div>
            ))}
          </div>
          <div>
            <div className="field-label" style={{ color: 'var(--green-light)', display: 'flex', alignItems: 'center', gap: 4 }}><ArrowDown size={14} /> Du bekommst</div>
            {RESOURCE_ORDER.map((r) => (
              <div key={r} className="trade-res" style={{ opacity: get[r] > 0 ? 1 : 0.5 }}>
                <ResourceCard resource={r} size={30} label={false} />
                <div style={{ flex: 1, fontWeight: 700 }}>{resLabel(r)}</div>
                <div className="stepper">
                  <button onClick={() => stepGet(r, -1)} disabled={get[r] === 0}>−</button>
                  <span className="num">{get[r]}</span>
                  <button onClick={() => stepGet(r, 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="row gap-2" style={{ marginTop: 16, flexWrap: 'wrap' }}>
          <button className="btn btn-gold" disabled={!canOffer} onClick={() => { act({ type: 'proposeTrade', give, get }); onClose(); }}>
            Spielern anbieten
          </button>
          <button
            className="btn btn-outline"
            disabled={!bankPossible}
            title={`Kurs ${bankRate}:1`}
            onClick={() => { act({ type: 'bankTrade', give: giveTypes[0], get: getTypes[0] }); onClose(); }}
          >
            Bank-Tausch {giveTypes.length === 1 ? `${bankRate}:1` : '4:1'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          Bank-Tausch: gib genau {bankRate}× einen Rohstoff für 1× einen anderen. Häfen senken den Kurs.
        </p>
      </div>
    </div>
  );
}
