import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';

/**
 * Kurze Siegpunkt-Einblendung über neu gesetzten Gebäuden:
 * Siedlung → „+1 SP", Stadt → „+2 SP" (Wert des Gebäudes). Steigt auf und blendet aus.
 * Positioniert per DOM-Anker `[data-corner]` (in Board.tsx), lebt in einem fixen Overlay.
 */
interface Pop {
  id: number;
  x: number;
  y: number;
  text: string;
}

let counter = 0;

function cornerCenter(cornerId: number): { x: number; y: number } | null {
  const el = document.querySelector(`[data-corner="${cornerId}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function BuildPopups() {
  const lastEvents = useStore((s) => s.lastEvents);
  const [pops, setPops] = useState<Pop[]>([]);
  const processedRef = useRef(lastEvents);

  useEffect(() => {
    if (processedRef.current === lastEvents) return; // gleiche Batch (auch StrictMode)
    processedRef.current = lastEvents;
    if (!lastEvents.length) return;

    const next: Pop[] = [];
    for (const ev of lastEvents) {
      if (ev.t === 'build' && (ev.kind === 'settlement' || ev.kind === 'city')) {
        const c = cornerCenter(ev.at);
        if (!c) continue;
        next.push({ id: counter++, x: c.x, y: c.y, text: ev.kind === 'city' ? '+2 SP' : '+1 SP' });
      }
    }
    if (!next.length) return;
    setPops((prev) => [...prev, ...next]);
    const ids = new Set(next.map((p) => p.id));
    const t = setTimeout(() => setPops((prev) => prev.filter((p) => !ids.has(p.id))), 1500);
    return () => clearTimeout(t);
  }, [lastEvents]);

  if (!pops.length) return null;
  return (
    <div className="vp-overlay">
      {pops.map((p) => (
        <div key={p.id} className="vp-pop" style={{ left: p.x, top: p.y }}>
          {p.text}
        </div>
      ))}
    </div>
  );
}
