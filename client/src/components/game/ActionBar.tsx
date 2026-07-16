import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store';
import { COSTS, canAfford, type ResourceCounts } from '@catan/shared';
import { Dices, Check, X } from '../../icons';
import { RESOURCE_ORDER } from './ui';
import { ResChip } from './ResChip';

export type BuildIntent = 'road' | 'settlement' | 'city' | null;

/** Kosten-Tooltip: pro benötigtem Rohstoff ein Chip mit Anzahl; vorhanden = farbig, fehlend = ausgegraut. */
function CostPop({ cost, res, anchor }: { cost: Partial<ResourceCounts>; res: ResourceCounts; anchor: DOMRect }) {
  const parts = RESOURCE_ORDER.filter((r) => (cost[r] ?? 0) > 0);
  const affordable = canAfford(res, cost);
  return createPortal(
    <div
      className="cost-pop"
      style={{ position: 'fixed', left: anchor.left + anchor.width / 2, top: anchor.top - 8, transform: 'translate(-50%, -100%)' }}
    >
      <div className="cost-pop-title">Kosten{affordable ? '' : ' · fehlt etwas'}</div>
      <div className="cost-pop-row">
        {parts.map((r) => (
          // Farbig, sobald du diesen Rohstoff überhaupt besitzt; ausgegraut, wenn du keinen hast.
          <ResChip key={r} res={r} count={cost[r]} dim={(res[r] ?? 0) === 0} />
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** Bau-Button mit Hover-Kosten-Tooltip. Der Wrapper-Span fängt Hover auch bei deaktiviertem Button. */
function BuildButton({
  label,
  cost,
  res,
  active,
  disabled,
  onClick,
}: {
  label: string;
  cost: Partial<ResourceCounts>;
  res: ResourceCounts;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const show = () => spanRef.current && setRect(spanRef.current.getBoundingClientRect());
  const hide = () => setRect(null);
  return (
    <span className="build-opt" ref={spanRef} onMouseEnter={show} onMouseLeave={hide}>
      <button className={`btn ${active ? 'btn-gold' : 'btn-ghost'}`} disabled={disabled} onClick={onClick}>
        {label}
      </button>
      {rect && <CostPop cost={cost} res={res} anchor={rect} />}
    </span>
  );
}

/** „Entwicklungskarte kaufen" mit Bestätigungsschritt (kleiner Haken ✓ / Abbrechen ✕),
 *  damit man nicht versehentlich kauft. */
function DevCardBuyButton({ res, disabled, onBuy }: { res: ResourceCounts; disabled: boolean; onBuy: () => void }) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return (
      <span className="dev-buy-confirm">
        <span className="dev-buy-q">Entwicklungskarte kaufen?</span>
        <button className="btn btn-green btn-sm dev-buy-btn" title="Kaufen" aria-label="Kaufen bestätigen" onClick={() => { onBuy(); setConfirming(false); }}>
          <Check size={16} />
        </button>
        <button className="btn btn-ghost btn-sm dev-buy-btn" title="Abbrechen" aria-label="Abbrechen" onClick={() => setConfirming(false)}>
          <X size={16} />
        </button>
      </span>
    );
  }
  return <BuildButton label="Entwicklungskarte kaufen" cost={COSTS.devCard} res={res} disabled={disabled} onClick={() => setConfirming(true)} />;
}

export function ActionBar({
  buildIntent,
  setBuildIntent,
  onTrade,
}: {
  buildIntent: BuildIntent;
  setBuildIntent: (b: BuildIntent) => void;
  onTrade: () => void;
}) {
  const game = useStore((s) => s.game);
  const me = useStore((s) => s.playerId);
  const act = useStore((s) => s.act);
  if (!game || !me) return null;

  const you = game.players.find((p) => p.id === me);
  const yourTurn = game.activePlayer === me;
  const res = (you?.resources ?? { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 }) as ResourceCounts;

  const afford = (cost: Partial<ResourceCounts>) => canAfford(res, cost);

  const toggle = (b: BuildIntent) => setBuildIntent(buildIntent === b ? null : b);

  if (!yourTurn) {
    return null; // Statusanzeige übernimmt das Top-Panel
  }

  if (game.phase === 'roll') {
    return (
      <div className="action-bar">
        <button className="btn btn-gold" style={{ fontSize: 16, padding: '13px 26px' }} onClick={() => act({ type: 'rollDice' })}>
          <Dices size={18} /> Würfeln
        </button>
        <span className="muted">Entwicklungskarten kannst du auch vor dem Wurf spielen.</span>
      </div>
    );
  }

  if (game.phase === 'main') {
    const canBuySettlement = afford(COSTS.settlement) && (you?.settlementsLeft ?? 0) > 0;
    const canBuyRoad = afford(COSTS.road) && (you?.roadsLeft ?? 0) > 0;
    const canBuyCity = afford(COSTS.city) && (you?.citiesLeft ?? 0) > 0;
    const canBuyDev = afford(COSTS.devCard) && game.devDeckCount > 0;
    return (
      <div className="action-bar">
        <BuildButton label="Straße" cost={COSTS.road} res={res} active={buildIntent === 'road'} disabled={!canBuyRoad} onClick={() => toggle('road')} />
        <BuildButton label="Siedlung" cost={COSTS.settlement} res={res} active={buildIntent === 'settlement'} disabled={!canBuySettlement} onClick={() => toggle('settlement')} />
        <BuildButton label="Stadt" cost={COSTS.city} res={res} active={buildIntent === 'city'} disabled={!canBuyCity} onClick={() => toggle('city')} />
        <DevCardBuyButton res={res} disabled={!canBuyDev} onBuy={() => act({ type: 'buyDevCard' })} />
        <button className="btn btn-ghost" onClick={onTrade}>Handeln</button>
        <div className="action-spacer" />
        <button className="btn btn-green" onClick={() => { setBuildIntent(null); act({ type: 'endTurn' }); }}>Zug beenden</button>
      </div>
    );
  }

  if (game.phase === 'roadBuilding') {
    return (
      <div className="action-bar">
        <span className="marcellus">Straßenbau: {game.roadBuildingLeft} Straße(n) übrig — auf dem Brett platzieren.</span>
      </div>
    );
  }

  if (game.phase === 'steal') {
    return (
      <div className="action-bar">
        <span style={{ marginRight: 8 }}>Wem stiehlst du?</span>
        {game.stealCandidates.map((vid) => {
          const v = game.players.find((p) => p.id === vid);
          return (
            <button key={vid} className="btn btn-gold btn-sm" onClick={() => act({ type: 'steal', victim: vid })}>
              {v?.name} ({v?.resourceCount})
            </button>
          );
        })}
      </div>
    );
  }

  if (game.phase === 'moveRobber') {
    return (
      <div className="action-bar">
        <span className="marcellus">Räuber versetzen — wähle ein hervorgehobenes Feld auf dem Brett. Danach kannst du bauen &amp; handeln.</span>
      </div>
    );
  }

  if (game.phase === 'setupSettlement') {
    return (
      <div className="action-bar">
        <span className="marcellus">Startsiedlung setzen — tippe auf eine hervorgehobene Ecke.</span>
      </div>
    );
  }

  if (game.phase === 'setupRoad') {
    return (
      <div className="action-bar">
        <span className="marcellus">Startstraße setzen — tippe auf eine hervorgehobene Kante.</span>
      </div>
    );
  }

  return null;
}
