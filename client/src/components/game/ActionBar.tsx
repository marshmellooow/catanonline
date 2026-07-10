import { useStore } from '../../store';
import { COSTS, canAfford, type ResourceCounts } from '@catan/shared';
import { Dices } from '../../icons';

export type BuildIntent = 'road' | 'settlement' | 'city' | null;

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
        <button className={`btn ${buildIntent === 'road' ? 'btn-gold' : 'btn-ghost'}`} disabled={!canBuyRoad} onClick={() => toggle('road')} title="Holz + Lehm">Straße</button>
        <button className={`btn ${buildIntent === 'settlement' ? 'btn-gold' : 'btn-ghost'}`} disabled={!canBuySettlement} onClick={() => toggle('settlement')} title="Holz+Lehm+Wolle+Getreide">Siedlung</button>
        <button className={`btn ${buildIntent === 'city' ? 'btn-gold' : 'btn-ghost'}`} disabled={!canBuyCity} onClick={() => toggle('city')} title="2 Getreide + 3 Erz">Stadt</button>
        <button className="btn btn-ghost" disabled={!canBuyDev} onClick={() => act({ type: 'buyDevCard' })} title="Wolle+Getreide+Erz">Karte kaufen</button>
        <button className="btn btn-ghost" onClick={onTrade}>Handeln</button>
        <div style={{ flex: 1 }} />
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
