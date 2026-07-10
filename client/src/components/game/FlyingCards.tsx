import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import type { ResourceType, ResourceCounts, GameEvent } from '@catan/shared';
import { RESOURCE_ORDER } from './ui';
import { ResourceCard } from './ResourceCard';
import { DevCard } from './DevCard';

type FlyContent = { kind: 'res'; res: ResourceType } | { kind: 'dev' };

interface Flyer {
  id: number;
  content: FlyContent;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  delay: number;
}

interface Pt {
  x: number;
  y: number;
}

let counter = 0;
const MAX_PER_BATCH = 40;

function centerOf(el: Element | null): Pt | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const q = (sel: string) => centerOf(document.querySelector(sel));

/** Bank-Rohstoffstapel eines Typs (Fallback: gesamtes Bank-Panel). */
const bankRes = (res: ResourceType): Pt | null => q(`[data-bank-res="${res}"]`) ?? q('.bank-panel');
/** Verdeckter Dev-Stapel in der Bank. */
const bankDev = (): Pt | null => q('[data-bank-dev]') ?? q('.bank-panel');

/** Ankerpunkt eines Spielers: eigene Hand bzw. Zeile in der Spielerleiste. */
function playerAnchor(pid: string, me: string | null): Pt | null {
  if (pid === me) return q('[data-hand]') ?? q('[data-hand-dev]') ?? q('.hand');
  return q(`[data-player-row="${pid}"]`);
}

function FlyerCard({ f, onDone }: { f: Flyer; onDone: (id: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone; // immer die aktuelle Funktion, ohne den Effekt neu auszulösen
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dx = f.toX - f.fromX;
    const dy = f.toY - f.fromY;
    const anim = el.animate(
      [
        { transform: 'translate(-50%,-50%) scale(0.45) rotate(-10deg)', opacity: 0, offset: 0 },
        { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1, offset: 0.18 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.8) rotate(6deg)`, opacity: 1, offset: 0.9 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.4) rotate(6deg)`, opacity: 0, offset: 1 },
      ],
      { duration: 760, delay: f.delay, easing: 'cubic-bezier(.35,.65,.3,1)', fill: 'both' },
    );
    anim.onfinish = () => doneRef.current(f.id);
    return () => anim.cancel();
    // WICHTIG: nur einmal beim Mount. Sonst starten noch laufende Flyer neu,
    // sobald ein anderer endet (onDone wechselt bei jedem Re-Render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={ref} className="flyer" style={{ left: f.fromX, top: f.fromY }}>
      {f.content.kind === 'dev' ? (
        <DevCard size={46} faceDown label={false} />
      ) : (
        <ResourceCard resource={f.content.res} size={42} label={false} />
      )}
    </div>
  );
}

export function FlyingCards() {
  const lastEvents = useStore((s) => s.lastEvents);
  const me = useStore((s) => s.playerId);
  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const processedRef = useRef<GameEvent[]>(lastEvents);

  useEffect(() => {
    if (processedRef.current === lastEvents) return; // gleiche Batch (auch StrictMode-Doppelaufruf)
    processedRef.current = lastEvents;
    if (!lastEvents.length) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const next: Flyer[] = [];
    const add = (content: FlyContent, from: Pt | null, to: Pt | null, delay = 0, fan = 0): boolean => {
      if (!from || !to || next.length >= MAX_PER_BATCH) return false;
      next.push({ id: counter++, content, fromX: from.x + fan, fromY: from.y, toX: to.x + fan, toY: to.y, delay });
      return true;
    };
    // Alle Karten einer Rohstoffmenge von A nach B fliegen lassen (räumlich leicht aufgefächert).
    const flyCounts = (counts: ResourceCounts, from: Pt | null, to: Pt | null, delay: number): void => {
      if (!from || !to) return;
      for (const res of RESOURCE_ORDER) {
        const amt = counts[res] ?? 0;
        for (let i = 0; i < amt; i++) {
          const off = (i - (amt - 1) / 2) * 7;
          if (!add({ kind: 'res', res }, from, to, delay, off)) return;
        }
      }
    };

    outer: for (const ev of lastEvents) {
      if (ev.t === 'produce') {
        // Ausschüttung: pro Empfänger Bank → Hand (eigene, feiner je Rohstoff) bzw. Spielerleiste.
        for (const [pid, gain] of Object.entries(ev.gains)) {
          for (const res of RESOURCE_ORDER) {
            const amt = gain[res] ?? 0;
            if (amt <= 0) continue;
            const from = bankRes(res);
            const target =
              pid === me
                ? q(`[data-hand-res="${res}"]`) ?? q('[data-hand]')
                : playerAnchor(pid, me);
            for (let i = 0; i < amt; i++) {
              const off = (i - (amt - 1) / 2) * 7;
              if (!add({ kind: 'res', res }, from, target, 0, off)) break outer;
            }
          }
        }
      } else if (ev.t === 'buyDev') {
        // Kauf: verdeckte Entwicklungskarte Bank → Käufer (Hand bzw. Spielerleiste).
        add({ kind: 'dev' }, bankDev(), playerAnchor(ev.player, me));
      } else if (ev.t === 'trade') {
        // Spieler-Handel: `give` fliegt vom Anbieter zum Partner, `get` zurück.
        const a = playerAnchor(ev.from, me);
        const b = playerAnchor(ev.to, me);
        flyCounts(ev.give, a, b, 0);
        flyCounts(ev.get, b, a, 150);
      } else if (ev.t === 'bankTrade') {
        // Bank-Tausch: abgegebene Karten → Bank, erhaltene Karten ← Bank.
        const p = playerAnchor(ev.player, me);
        for (const res of RESOURCE_ORDER) {
          const amt = ev.give[res] ?? 0;
          for (let i = 0; i < amt; i++) if (!add({ kind: 'res', res }, p, bankRes(res), 0, (i - (amt - 1) / 2) * 7)) break outer;
        }
        for (const res of RESOURCE_ORDER) {
          const amt = ev.get[res] ?? 0;
          for (let i = 0; i < amt; i++) if (!add({ kind: 'res', res }, bankRes(res), p, 150, (i - (amt - 1) / 2) * 7)) break outer;
        }
      } else if (ev.t === 'yearOfPlenty') {
        // Erfindung: 2 gewählte Rohstoffe Bank → Spieler.
        const p = playerAnchor(ev.player, me);
        ev.resources.forEach((res, i) => add({ kind: 'res', res }, bankRes(res), p, 0, (i - (ev.resources.length - 1) / 2) * 9));
      }
    }

    if (next.length) setFlyers((prev) => [...prev, ...next]);
  }, [lastEvents, me]);

  const remove = (id: number) => setFlyers((prev) => prev.filter((x) => x.id !== id));

  if (!flyers.length) return null;
  return (
    <div className="flyers-overlay">
      {flyers.map((f) => (
        <FlyerCard key={f.id} f={f} onDone={remove} />
      ))}
    </div>
  );
}
