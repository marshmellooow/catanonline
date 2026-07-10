import { useStore } from '../../store';
import type { DevCardType } from '@catan/shared';
import { RESOURCE_ORDER, resLabel, DEV_LABEL } from './ui';
import { ResourceCard } from './ResourceCard';
import { DevCard } from './DevCard';
import { HoverTip } from './HoverTip';

const DEV_ORDER: DevCardType[] = ['knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'];

/** Kurzerklärung je Entwicklungskarte (Hover-Tooltip). */
const DEV_DESC: Record<DevCardType, string> = {
  knight: 'Versetze den Räuber und stiehl einem Nachbarn eine Karte. 3 gespielte Ritter = Größte Rittermacht (+2 SP).',
  roadBuilding: 'Baue sofort 2 Straßen kostenlos (soweit Bauplätze frei sind).',
  yearOfPlenty: 'Nimm 2 beliebige Rohstoffe aus der Bank.',
  monopoly: 'Nenne einen Rohstoff — alle Mitspieler geben dir alle ihre Karten dieses Typs.',
  victoryPoint: 'Verdeckter Siegpunkt: zählt sofort +1 SP, wird erst beim Sieg aufgedeckt (nicht spielbar).',
};

export function Hand({ onPlayDev }: { onPlayDev: (card: DevCardType) => void }) {
  const game = useStore((s) => s.game);
  const me = useStore((s) => s.playerId);
  if (!game || !me) return null;
  const you = game.players.find((p) => p.id === me);
  if (!you || !you.resources) return null;

  const canPlayDev = game.activePlayer === me && (game.phase === 'main' || game.phase === 'roll') && !game.playedDevThisTurn;
  const dev = you.devCards ?? { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0, victoryPoint: 0 };
  const newDev = you.newDevCards ?? { knight: 0, roadBuilding: 0, yearOfPlenty: 0, monopoly: 0, victoryPoint: 0 };

  const res = you.resources;
  const held = RESOURCE_ORDER.filter((r) => res[r] > 0);

  return (
    <div className="hand">
      <div className="hand-res" data-hand>
        {held.length === 0 && <div className="hand-empty muted">Keine Rohstoffe</div>}
        {held.map((r) => (
          <div key={r} className="res-slot" data-hand-res={r} title={resLabel(r)}>
            <ResourceCard resource={r} size={64} />
            {res[r] > 1 && <div className="res-count num">{res[r]}</div>}
          </div>
        ))}
      </div>

      <div className="hand-dev" data-hand-dev>
        {DEV_ORDER.map((card) => {
          const owned = dev[card];
          const pending = newDev[card];
          const total = owned + pending;
          if (total === 0) return null;
          const isVp = card === 'victoryPoint';
          // VP-Karten sind verdeckte Punkte (nicht spielbar). Frisch gekaufte Karten
          // (owned === 0) erst nächsten Zug spielbar.
          const playable = !isVp && canPlayDev && owned > 0;
          const tip = (
            <div className="devtip">
              <div className="devtip-title">{DEV_LABEL[card]}</div>
              <div className="devtip-desc">{DEV_DESC[card]}</div>
              {owned === 0 && !isVp && <div className="devtip-note">Diese Runde gekauft — erst nächsten Zug spielbar.</div>}
            </div>
          );
          return (
            <HoverTip key={card} tip={tip}>
              <button
                type="button"
                className={`dev-slot ${isVp ? 'vp' : ''} ${playable ? 'playable' : ''}`}
                disabled={!playable}
                onClick={playable ? () => onPlayDev(card) : undefined}
              >
                <DevCard card={card} size={58} />
                {total > 1 && <span className="dev-count num">{total}</span>}
                {pending > 0 && owned > 0 && <span className="dev-new">+{pending}</span>}
                {owned === 0 && !isVp && <span className="dev-lock">neu</span>}
              </button>
            </HoverTip>
          );
        })}
      </div>
    </div>
  );
}
