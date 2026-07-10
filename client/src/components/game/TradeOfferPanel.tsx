import { useStore } from '../../store';
import { RESOURCE_ORDER, resLabel } from './ui';
import { Check, X, Clock } from '../../icons';
import type { ResourceCounts, ResourceType } from '@catan/shared';

function summarize(counts: ResourceCounts): string {
  const parts = RESOURCE_ORDER.filter((r) => counts[r] > 0).map((r) => `${counts[r]}× ${resLabel(r)}`);
  return parts.length ? parts.join(', ') : '—';
}
function canAffordCounts(res: ResourceCounts, need: ResourceCounts): boolean {
  return RESOURCE_ORDER.every((r: ResourceType) => res[r] >= need[r]);
}

export function TradeOfferPanel() {
  const game = useStore((s) => s.game);
  const me = useStore((s) => s.playerId);
  const act = useStore((s) => s.act);
  if (!game || !me || !game.tradeOffer) return null;

  const offer = game.tradeOffer;
  const isProposer = offer.from === me;
  const proposerName = game.players.find((p) => p.id === offer.from)?.name ?? '';
  const you = game.players.find((p) => p.id === me);

  if (isProposer) {
    return (
      <div className="offer-panel dialog">
        <div className="offer-head">Dein Angebot läuft</div>
        <div className="offer-body">
          <div>Du gibst: <b style={{ color: 'var(--gold)' }}>{summarize(offer.give)}</b></div>
          <div>Du bekommst: <b style={{ color: 'var(--green-light)' }}>{summarize(offer.get)}</b></div>
        </div>
        <div className="offer-responses">
          {Object.entries(offer.responses).map(([pid, status]) => {
            const p = game.players.find((x) => x.id === pid);
            return (
              <div key={pid} className="offer-resp">
                <span>{p?.name}</span>
                {status === 'accept' && (
                  <button className="btn btn-green btn-sm" onClick={() => act({ type: 'confirmTrade', offerId: offer.id, withPlayer: pid })}>
                    <Check size={14} /> Bestätigen
                  </button>
                )}
                {status === 'pending' && <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Clock size={13} /> Wartet…</span>}
                {status === 'reject' && <span style={{ color: '#e08074', display: 'inline-flex', alignItems: 'center', gap: 4 }}><X size={13} /> Abgelehnt</span>}
              </div>
            );
          })}
        </div>
        <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={() => act({ type: 'cancelTrade' })}>
          Angebot zurückziehen
        </button>
      </div>
    );
  }

  // Empfänger-Sicht
  const myStatus = offer.responses[me];
  if (myStatus === undefined) return null; // ich bin nicht angesprochen (z. B. Zuschauer)
  const canAccept = you?.resources ? canAffordCounts(you.resources, offer.get) : false;
  return (
    <div className="offer-panel dialog">
      <div className="offer-head">{proposerName} bietet dir an</div>
      <div className="offer-body">
        <div>Du gibst: <b style={{ color: 'var(--gold)' }}>{summarize(offer.get)}</b></div>
        <div>Du bekommst: <b style={{ color: 'var(--green-light)' }}>{summarize(offer.give)}</b></div>
      </div>
      {myStatus === 'pending' ? (
        <div className="row gap-2" style={{ marginTop: 8 }}>
          <button className="btn btn-green btn-sm" disabled={!canAccept} onClick={() => act({ type: 'respondTrade', offerId: offer.id, accept: true })}>
            <Check size={14} /> Annehmen
          </button>
          <button className="btn btn-red btn-sm" onClick={() => act({ type: 'respondTrade', offerId: offer.id, accept: false })}>
            <X size={14} /> Ablehnen
          </button>
          {!canAccept && <span className="muted" style={{ fontSize: 12 }}>Karten fehlen</span>}
        </div>
      ) : (
        <div className="muted" style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {myStatus === 'accept' ? <><Check size={14} /> Angenommen — warte auf Bestätigung</> : <><X size={14} /> Abgelehnt</>}
        </div>
      )}
    </div>
  );
}
