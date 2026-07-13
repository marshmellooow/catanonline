import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { GameEvent, ResourceCounts, ResourceType } from '@catan/shared';
import { RESOURCE_ORDER } from './ui';
import { ResourceCard } from './ResourceCard';

/**
 * Kurzes Karten-Popup, NUR für den Betrachter selbst: was man erhält (Ausschüttung,
 * Erfindung, Monopol, selbst geklaut) ODER was einem gestohlen wurde — kurz groß über
 * der Hand. Getrennt von den fliegenden Karten (Board→Hand-Animation).
 */
interface Draw {
  id: number;
  counts: ResourceCounts;
  title: string;
  kind: 'gain' | 'loss';
}

const SHOW_MS = 3100; // Anzeigedauer (1 Sekunde länger als vorher)

let counter = 0;

function empty(): ResourceCounts {
  return { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}
function sum(c: ResourceCounts): number {
  return RESOURCE_ORDER.reduce((s, r) => s + c[r], 0);
}

/** Karten-Änderung des Betrachters aus einer Event-Batch (redigiert, d. h. `me`-Sicht). */
function changeForMe(events: GameEvent[], me: string): Draw | null {
  const gain = empty();
  let gainTitle = 'Du erhältst';
  const loss = empty(); // was MIR gestohlen wurde (Opfer sieht den Rohstoff, Dritte nicht)
  for (const ev of events) {
    if (ev.t === 'produce') {
      const mine = ev.gains[me];
      if (mine) for (const r of RESOURCE_ORDER) gain[r] += mine[r] ?? 0;
    } else if (ev.t === 'steal' && ev.resource) {
      if (ev.to === me) { gain[ev.resource] += 1; gainTitle = 'Gestohlen'; }
      else if (ev.from === me) { loss[ev.resource] += 1; }
    } else if (ev.t === 'yearOfPlenty' && ev.player === me) {
      for (const r of ev.resources) gain[r] += 1;
      gainTitle = 'Erfindung';
    } else if (ev.t === 'monopoly' && ev.player === me && ev.total > 0) {
      gain[ev.resource] += ev.total;
      gainTitle = 'Monopol';
    }
  }
  if (sum(gain) > 0) return { id: counter++, counts: gain, title: gainTitle, kind: 'gain' };
  if (sum(loss) > 0) return { id: counter++, counts: loss, title: 'Dir gestohlen', kind: 'loss' };
  return null;
}

export function DrawPopup() {
  const lastEvents = useStore((s) => s.lastEvents);
  const me = useStore((s) => s.playerId);
  const [draw, setDraw] = useState<Draw | null>(null);
  const processedRef = useRef(lastEvents);

  useEffect(() => {
    if (processedRef.current === lastEvents) return; // gleiche Batch (auch StrictMode)
    processedRef.current = lastEvents;
    if (!lastEvents.length || !me) return;

    const d = changeForMe(lastEvents, me);
    if (!d) return;
    setDraw(d);
    const t = setTimeout(() => setDraw((cur) => (cur && cur.id === d.id ? null : cur)), SHOW_MS);
    return () => clearTimeout(t);
  }, [lastEvents, me]);

  if (!draw) return null;
  const cards: ResourceType[] = RESOURCE_ORDER.filter((r) => draw.counts[r] > 0);

  return (
    <div className="draw-overlay">
      <div className={`draw-pop ${draw.kind === 'loss' ? 'loss' : ''}`} key={draw.id}>
        <div className="draw-title">{draw.title}</div>
        <div className="draw-cards">
          {cards.map((r) => (
            <div key={r} className="draw-card">
              <ResourceCard resource={r} size={78} />
              {draw.counts[r] > 1 && <span className="draw-count num">×{draw.counts[r]}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
