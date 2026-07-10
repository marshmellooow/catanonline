import { useState } from 'react';
import { useStore } from '../../store';
import { RESOURCE_ORDER, resLabel } from './ui';
import { ResourceCard } from './ResourceCard';
import type { ResourceType } from '@catan/shared';

export function DevPlayDialog({ mode, onClose }: { mode: 'yearOfPlenty' | 'monopoly'; onClose: () => void }) {
  const act = useStore((s) => s.act);
  const [picks, setPicks] = useState<ResourceType[]>([]);

  const isYoP = mode === 'yearOfPlenty';
  const maxPicks = isYoP ? 2 : 1;

  const add = (r: ResourceType) => {
    if (isYoP) {
      if (picks.length < 2) setPicks([...picks, r]);
    } else {
      setPicks([r]);
    }
  };
  const reset = () => setPicks([]);

  const confirm = () => {
    if (isYoP && picks.length === 2) act({ type: 'playYearOfPlenty', resources: [picks[0], picks[1]] });
    else if (!isYoP && picks.length === 1) act({ type: 'playMonopoly', resource: picks[0] });
    onClose();
  };

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="dialog modal-card" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{isYoP ? 'Erfindung — 2 Rohstoffe wählen' : 'Monopol — einen Rohstoff wählen'}</h2>
        <p className="muted">{isYoP ? 'Nimm 2 beliebige Rohstoffe aus der Bank.' : 'Alle Mitspieler geben dir alle Karten dieses Typs.'}</p>
        <div className="res-pick-grid">
          {RESOURCE_ORDER.map((r) => {
            const count = picks.filter((x) => x === r).length;
            return (
              <button key={r} className={`res-pick ${count > 0 ? 'sel' : ''}`} onClick={() => add(r)}>
                <ResourceCard resource={r} size={44} label={false} />
                <span>{resLabel(r)}</span>
                {count > 0 && <span className="pick-badge num">{count}</span>}
              </button>
            );
          })}
        </div>
        <div className="row gap-2" style={{ marginTop: 14 }}>
          <button className="btn btn-gold" disabled={picks.length !== maxPicks} onClick={confirm}>Bestätigen</button>
          <button className="btn btn-ghost" onClick={reset}>Zurücksetzen</button>
          <button className="btn btn-ghost" onClick={onClose}>Abbrechen</button>
        </div>
      </div>
    </div>
  );
}
