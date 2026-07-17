import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { RESOURCE_ORDER, resLabel } from './ui';
import { Check, X, Clock, Pencil } from '../../icons';
import { TradeDialog } from './TradeDialog';
import type { ResourceCounts, ResourceType } from '@catan/shared';

function summarize(counts: ResourceCounts): string {
  const parts = RESOURCE_ORDER.filter((r) => counts[r] > 0).map((r) => `${counts[r]}× ${resLabel(r)}`);
  return parts.length ? parts.join(', ') : '—';
}
function canAffordCounts(res: ResourceCounts, need: ResourceCounts): boolean {
  return RESOURCE_ORDER.every((r: ResourceType) => res[r] >= need[r]);
}
/** Vorbelegung fürs Gegenangebot: nie mehr eintragen, als man wirklich besitzt —
 *  sonst schickt der Dialog ein Angebot, das der Server zwingend ablehnt. */
function clampToHand(want: ResourceCounts, res: ResourceCounts): Record<ResourceType, number> {
  const out = {} as Record<ResourceType, number>;
  for (const r of RESOURCE_ORDER) out[r] = Math.min(want[r], res[r]);
  return out;
}
function toCounts(c: ResourceCounts): Record<ResourceType, number> {
  const out = {} as Record<ResourceType, number>;
  for (const r of RESOURCE_ORDER) out[r] = c[r];
  return out;
}

export function TradeOfferPanel() {
  const game = useStore((s) => s.game);
  const me = useStore((s) => s.playerId);
  const act = useStore((s) => s.act);
  const [countering, setCountering] = useState(false);
  // Das Panel bleibt dauerhaft gemountet (Game.tsx) und blendet sich bei fehlendem
  // Angebot nur per `return null` aus — React verwirft den State dabei NICHT. Ohne
  // Reset ginge der Editor beim nächsten, fremden Angebot ungefragt wieder auf.
  const offerId = game?.tradeOffer?.id ?? null;
  useEffect(() => {
    setCountering(false);
  }, [offerId]);

  if (!game || !me || !game.tradeOffer) return null;

  const offer = game.tradeOffer;
  const isProposer = offer.from === me;
  const proposerName = game.players.find((p) => p.id === offer.from)?.name ?? '';
  const you = game.players.find((p) => p.id === me);
  const myRes = you?.resources;

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
            // Gegenangebot: `counters[pid]` steht bereits in DEINER (Anbieter-)Sicht.
            const counter = status === 'counter' ? offer.counters?.[pid] : undefined;
            if (counter) {
              const affordable = myRes ? canAffordCounts(myRes, counter.give) : false;
              return (
                <div key={pid} className="offer-resp is-counter">
                  <div className="offer-resp-top">
                    <span>{p?.name}</span>
                    <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Pencil size={12} /> Gegenangebot
                    </span>
                  </div>
                  <div className="offer-counter-terms">
                    <div>Du gibst: <b style={{ color: 'var(--gold)' }}>{summarize(counter.give)}</b></div>
                    <div>Du bekommst: <b style={{ color: 'var(--green-light)' }}>{summarize(counter.get)}</b></div>
                  </div>
                  <button
                    className="btn btn-green btn-sm"
                    disabled={!affordable}
                    title={affordable ? 'Gegenangebot annehmen' : 'Dir fehlen die Karten dafür'}
                    onClick={() => act({ type: 'acceptCounter', offerId: offer.id, withPlayer: pid })}
                  >
                    <Check size={14} /> Annehmen
                  </button>
                  {!affordable && <span className="muted" style={{ fontSize: 12 }}>Karten fehlen</span>}
                </div>
              );
            }
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
  const canAccept = myRes ? canAffordCounts(myRes, offer.get) : false;
  const myCounter = offer.counters?.[me];

  return (
    <>
      <div className="offer-panel dialog">
        <div className="offer-head">{proposerName} bietet dir an</div>
        <div className="offer-body">
          <div>Du gibst: <b style={{ color: 'var(--gold)' }}>{summarize(offer.get)}</b></div>
          <div>Du bekommst: <b style={{ color: 'var(--green-light)' }}>{summarize(offer.give)}</b></div>
        </div>
        {myStatus === 'pending' && (
          <div className="row gap-2" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-green btn-sm" disabled={!canAccept} onClick={() => act({ type: 'respondTrade', offerId: offer.id, accept: true })}>
              <Check size={14} /> Annehmen
            </button>
            <button className="btn btn-red btn-sm" onClick={() => act({ type: 'respondTrade', offerId: offer.id, accept: false })}>
              <X size={14} /> Ablehnen
            </button>
            <button className="btn btn-ghost btn-sm" title="Gegenangebot machen" aria-label="Gegenangebot machen" onClick={() => setCountering(true)}>
              <Pencil size={14} />
            </button>
            {!canAccept && <span className="muted" style={{ fontSize: 12 }}>Karten fehlen</span>}
          </div>
        )}
        {myStatus === 'counter' && myCounter && (
          // `myCounter` steht in Anbieter-Sicht → für mich gespiegelt anzeigen.
          <div style={{ marginTop: 8 }}>
            <div className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Pencil size={14} /> Gegenangebot gesendet — warte auf {proposerName}
            </div>
            <div className="offer-counter-terms" style={{ marginTop: 6 }}>
              <div>Du gibst: <b style={{ color: 'var(--gold)' }}>{summarize(myCounter.get)}</b></div>
              <div>Du bekommst: <b style={{ color: 'var(--green-light)' }}>{summarize(myCounter.give)}</b></div>
            </div>
            <div className="row gap-2" style={{ marginTop: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setCountering(true)}>
                <Pencil size={14} /> Ändern
              </button>
              <button className="btn btn-red btn-sm" onClick={() => act({ type: 'respondTrade', offerId: offer.id, accept: false })}>
                <X size={14} /> Zurückziehen
              </button>
            </div>
          </div>
        )}
        {(myStatus === 'accept' || myStatus === 'reject') && (
          <div className="muted" style={{ marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            {myStatus === 'accept' ? <><Check size={14} /> Angenommen — warte auf Bestätigung</> : <><X size={14} /> Abgelehnt</>}
          </div>
        )}
      </div>

      {countering && myRes && (
        // Vorbelegung: liegt schon ein eigener Konter vor („Ändern"), diesen laden —
        // sonst die Konditionen des Angebots. Beides aus MEINER Sicht (myCounter steht
        // in Anbieter-Sicht → gespiegelt). `key` bindet den internen Dialog-State an
        // das Angebot, damit nie Mengen eines alten Angebots an eine neue Id gehen.
        <TradeDialog
          key={offer.id}
          mode="counter"
          offerId={offer.id}
          initialGive={clampToHand(myCounter ? myCounter.get : offer.get, myRes)}
          initialGet={toCounts(myCounter ? myCounter.give : offer.give)}
          onClose={() => setCountering(false)}
        />
      )}
    </>
  );
}
