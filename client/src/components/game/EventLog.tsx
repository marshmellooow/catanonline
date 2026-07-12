import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useStore } from '../../store';
import type { GameEvent, PublicState, ResourceCounts, ResourceType } from '@catan/shared';
import { RESOURCE_ORDER } from './ui';
import { ResChip } from './ResChip';
import { Dices, Hammer, ScrollText, Sparkles, Ghost, HandCoins, ArrowRightLeft, Landmark, Coins, Route, Swords, Trophy, ArrowRight, Gift } from '../../icons';

type IconType = LucideIcon;

function name(game: PublicState, id: string | null): string {
  if (!id) return '';
  return game.players.find((p) => p.id === id)?.name ?? '';
}

/** Rohstoffmengen als kompakte Farbchips (nur Nicht-Null). */
function Amounts({ counts }: { counts: ResourceCounts }) {
  const parts = RESOURCE_ORDER.filter((r) => (counts[r] ?? 0) > 0);
  if (!parts.length) return null;
  return (
    <span className="ev-amounts">
      {parts.map((r) => (
        <ResChip key={r} res={r} count={counts[r]} />
      ))}
    </span>
  );
}

/** Liste von Rohstoff-Typen → Mengen-Objekt (für Erfindung). */
function toCounts(list: ResourceType[]): ResourceCounts {
  const c: ResourceCounts = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
  for (const r of list) c[r]++;
  return c;
}

function fmt(ev: GameEvent, game: PublicState, me: string | null): { Icon: IconType; node: ReactNode } | null {
  const nm = (id: string | null) => name(game, id);
  switch (ev.t) {
    case 'roll':
      return { Icon: Dices, node: <span>{nm(ev.player)} würfelt {ev.sum}</span> };
    case 'produce': {
      // Nur die eigenen Erträge des Betrachters anzeigen (das interessiert dich).
      const mine = me ? ev.gains[me] : undefined;
      if (!mine || RESOURCE_ORDER.every((r) => (mine[r] ?? 0) === 0)) return null;
      return { Icon: Sparkles, node: <span>Du erhältst <Amounts counts={mine} /></span> };
    }
    case 'build':
      return { Icon: Hammer, node: <span>{nm(ev.player)} baut {ev.kind === 'road' ? 'eine Straße' : ev.kind === 'city' ? 'eine Stadt' : 'eine Siedlung'}</span> };
    case 'buyDev':
      return { Icon: ScrollText, node: <span>{nm(ev.player)} kauft eine Entwicklungskarte</span> };
    case 'playDev':
      return { Icon: Sparkles, node: <span>{nm(ev.player)} spielt {ev.card === 'knight' ? 'einen Ritter' : ev.card}</span> };
    case 'robber':
      return { Icon: Ghost, node: <span>{nm(ev.player)} versetzt den Räuber</span> };
    case 'steal': {
      // `stole` = öffentlich (jemand hat geklaut). `resource` ist nur für Dieb & Opfer
      // gesetzt (serverseitig redigiert) → nur die beiden sehen, WELCHE Karte.
      if (!ev.stole) return null;
      if (ev.resource) {
        if (ev.to === me) return { Icon: HandCoins, node: <span>Du stiehlst <ResChip res={ev.resource} /> von {nm(ev.from)}</span> };
        if (ev.from === me) return { Icon: HandCoins, node: <span>{nm(ev.to)} stiehlt <ResChip res={ev.resource} /> von dir</span> };
      }
      return { Icon: HandCoins, node: <span>{nm(ev.to)} stiehlt von {nm(ev.from)}</span> };
    }
    case 'trade':
      return { Icon: ArrowRightLeft, node: <span>{nm(ev.from)} <Amounts counts={ev.give} /> <ArrowRight size={11} className="ev-arrow" /> <Amounts counts={ev.get} /> {nm(ev.to)}</span> };
    case 'bankTrade':
      return { Icon: Landmark, node: <span>{nm(ev.player)} · Bank <Amounts counts={ev.give} /> <ArrowRight size={11} className="ev-arrow" /> <Amounts counts={ev.get} /></span> };
    case 'monopoly':
      return { Icon: Coins, node: <span>{nm(ev.player)} nimmt <ResChip res={ev.resource} count={ev.total} /> (Monopol)</span> };
    case 'yearOfPlenty':
      return { Icon: Gift, node: <span>{nm(ev.player)} (Erfindung) <Amounts counts={toCounts(ev.resources)} /></span> };
    case 'discard':
      return { Icon: HandCoins, node: <span>{nm(ev.player)} wirft {ev.count} {ev.count === 1 ? 'Karte' : 'Karten'} ab</span> };
    case 'longestRoad':
      return ev.player ? { Icon: Route, node: <span>{nm(ev.player)} hat die Längste Straße</span> } : null;
    case 'largestArmy':
      return ev.player ? { Icon: Swords, node: <span>{nm(ev.player)} hat die Größte Rittermacht</span> } : null;
    case 'win':
      return { Icon: Trophy, node: <span>{nm(ev.player)} gewinnt!</span> };
    case 'turn':
      return { Icon: ArrowRight, node: <span>{nm(ev.player)} ist am Zug</span> };
    default:
      return null;
  }
}

export function EventLog() {
  const game = useStore((s) => s.game);
  const me = useStore((s) => s.playerId);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Nur ans Ende scrollen, wenn der Nutzer bereits (fast) unten war — sonst darf
  // er ungestört im Verlauf nach oben scrollen.
  const stickRef = useRef(true);

  const lines = game
    ? game.log
        .map((ev) => fmt(ev, game, me))
        .filter((x): x is { Icon: IconType; node: ReactNode } => x !== null)
        .slice(-60)
    : [];

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  if (!game) return null;
  return (
    <div className="event-log" ref={scrollRef}>
      {lines.map(({ Icon, node }, i) => (
        <div key={i} className="event-line">
          <Icon size={13} className="event-ico" />
          <span className="event-text">{node}</span>
        </div>
      ))}
    </div>
  );
}
