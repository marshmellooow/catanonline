import { useStore } from '../../store';
import { RESOURCE_ORDER, resLabel } from './ui';
import { ResourceCard } from './ResourceCard';
import { DevCard } from './DevCard';
import { Landmark } from '../../icons';

/** Sichtbare Bank: Restbestand je Rohstoff + verdeckter Entwicklungskarten-Stapel. */
export function BankPanel() {
  const game = useStore((s) => s.game);
  if (!game) return null;
  const bank = game.bankTotals;
  const devLeft = game.devDeckCount;
  return (
    <div className="bank-panel panel">
      <div className="bank-title"><Landmark size={15} /> Bank</div>
      <div className="bank-row">
        {RESOURCE_ORDER.map((res) => {
          const n = bank[res];
          return (
            <div key={res} data-bank-res={res} className={`bank-item ${n === 0 ? 'empty' : ''}`} title={`${resLabel(res)}: ${n}${n === 0 ? ' — leer, keine Ausschüttung' : ''}`}>
              <ResourceCard resource={res} size={30} label={false} />
              <span className="bank-count num">{n}</span>
            </div>
          );
        })}
        <div className="bank-sep" aria-hidden="true" />
        <div
          data-bank-dev
          className={`bank-item bank-dev ${devLeft === 0 ? 'empty' : ''}`}
          title={`Entwicklungskarten: ${devLeft} im Stapel${devLeft === 0 ? ' — Deck leer' : ''}`}
        >
          <div className="dev-stack">
            <DevCard size={30} faceDown label={false} />
          </div>
          <span className="bank-count num">{devLeft}</span>
        </div>
      </div>
    </div>
  );
}
