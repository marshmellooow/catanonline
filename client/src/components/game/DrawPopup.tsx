import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { GameEvent, ResourceCounts, ResourceType } from '@catan/shared';
import { RESOURCE_ORDER } from './ui';
import { ResourceCard } from './ResourceCard';

/**
 * Kurzes „Du ziehst"-Popup, NUR für den Betrachter selbst: sobald man Karten erhält
 * (Ausschüttung, Erfindung, Monopol, Diebstahl), erscheinen sie kurz groß über der Hand.
 * Getrennt von den fliegenden Karten (Board→Hand-Animation) — reine Info „was habe ich bekommen".
 */
interface Draw {
  id: number;
  counts: ResourceCounts;
  title: string;
}

let counter = 0;

function empty(): ResourceCounts {
  return { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
}

/** Netto-Kartengewinn des Betrachters aus einer Event-Batch (redigiert, d. h. `me`-Sicht). */
function gainsForMe(events: GameEvent[], me: string): { counts: ResourceCounts; title: string } | null {
  const c = empty();
  let title = 'Du erhältst';
  for (const ev of events) {
    if (ev.t === 'produce') {
      const mine = ev.gains[me];
      if (mine) for (const r of RESOURCE_ORDER) c[r] += mine[r] ?? 0;
    } else if (ev.t === 'steal' && ev.to === me && ev.resource) {
      c[ev.resource] += 1;
      title = 'Gestohlen';
    } else if (ev.t === 'yearOfPlenty' && ev.player === me) {
      for (const r of ev.resources) c[r] += 1;
      title = 'Erfindung';
    } else if (ev.t === 'monopoly' && ev.player === me && ev.total > 0) {
      c[ev.resource] += ev.total;
      title = 'Monopol';
    }
  }
  const total = RESOURCE_ORDER.reduce((s, r) => s + c[r], 0);
  return total > 0 ? { counts: c, title } : null;
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

    const g = gainsForMe(lastEvents, me);
    if (!g) return;
    const id = counter++;
    setDraw({ id, counts: g.counts, title: g.title });
    const t = setTimeout(() => setDraw((cur) => (cur && cur.id === id ? null : cur)), 2100);
    return () => clearTimeout(t);
  }, [lastEvents, me]);

  if (!draw) return null;
  const cards: ResourceType[] = RESOURCE_ORDER.filter((r) => draw.counts[r] > 0);

  return (
    <div className="draw-overlay">
      <div className="draw-pop" key={draw.id}>
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
