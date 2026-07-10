import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useStore } from '../../store';
import { Route } from '../../icons';

/**
 * Transientes Banner oben, wenn die Längste Straße (Länge ≥ 5) vergeben wird
 * oder den Besitzer wechselt („geklaut"). Zeigt bei Wechsel, wer sie vorher hatte.
 * Getrieben vom `longestRoad`-Event (enthält neuen Halter + `prev`).
 */
export function LongestRoadBanner() {
  const lastEvents = useStore((s) => s.lastEvents);
  const game = useStore((s) => s.game);
  const gameRef = useRef(game);
  gameRef.current = game;

  const [banner, setBanner] = useState<{ key: number; node: ReactNode; stolen: boolean } | null>(null);
  const processedRef = useRef(lastEvents);
  const dismissRef = useRef<number | null>(null);
  const keyRef = useRef(0);

  useEffect(() => {
    if (processedRef.current === lastEvents) return; // gleiche Batch (auch StrictMode)
    processedRef.current = lastEvents;
    // Letztes longestRoad-Event der Batch gewinnt.
    const lr = [...lastEvents].reverse().find((e) => e.t === 'longestRoad');
    if (!lr || lr.t !== 'longestRoad') return;

    const g = gameRef.current;
    const nameOf = (id: string | null | undefined) => (id ? g?.players.find((p) => p.id === id)?.name ?? '' : '');
    const holder = lr.player;
    const prev = lr.prev ?? null;

    let node: ReactNode;
    let stolen = false;
    if (!holder) {
      node = <span>Längste Straße ist wieder frei</span>;
    } else if (prev && prev !== holder) {
      stolen = true;
      node = (
        <span>
          <b>{nameOf(holder)}</b> schnappt sich die Längste Straße von <b>{nameOf(prev)}</b>
        </span>
      );
    } else {
      node = (
        <span>
          <b>{nameOf(holder)}</b> hat jetzt die Längste Straße
        </span>
      );
    }

    keyRef.current += 1;
    setBanner({ key: keyRef.current, node, stolen });
    if (dismissRef.current) clearTimeout(dismissRef.current);
    dismissRef.current = window.setTimeout(() => setBanner(null), 4800);
  }, [lastEvents]);

  useEffect(() => () => { if (dismissRef.current) clearTimeout(dismissRef.current); }, []);

  if (!banner) return null;
  return (
    <div className="lr-banner-wrap">
      <div key={banner.key} className={`lr-banner${banner.stolen ? ' stolen' : ''}`}>
        <Route size={18} />
        {banner.node}
      </div>
    </div>
  );
}
