import type { LucideIcon } from 'lucide-react';
import { useStore } from '../../store';
import type { GameEvent, PublicState } from '@catan/shared';
import { RESOURCE_LABEL } from '@catan/shared';
import { Dices, Hammer, ScrollText, Sparkles, Ghost, HandCoins, ArrowRightLeft, Landmark, Coins, Route, Swords, Trophy, ArrowRight } from '../../icons';

type IconType = LucideIcon;

function name(game: PublicState, id: string | null): string {
  if (!id) return '';
  return game.players.find((p) => p.id === id)?.name ?? '';
}

function fmt(ev: GameEvent, game: PublicState): { Icon: IconType; text: string } | null {
  switch (ev.t) {
    case 'roll':
      return { Icon: Dices, text: `${name(game, ev.player)} würfelt ${ev.sum}` };
    case 'build':
      return { Icon: Hammer, text: `${name(game, ev.player)} baut ${ev.kind === 'road' ? 'eine Straße' : ev.kind === 'city' ? 'eine Stadt' : 'eine Siedlung'}` };
    case 'buyDev':
      return { Icon: ScrollText, text: `${name(game, ev.player)} kauft eine Entwicklungskarte` };
    case 'playDev':
      return { Icon: Sparkles, text: `${name(game, ev.player)} spielt ${ev.card === 'knight' ? 'einen Ritter' : ev.card}` };
    case 'robber':
      return { Icon: Ghost, text: `${name(game, ev.player)} versetzt den Räuber` };
    case 'steal':
      // `stole` (nicht `resource`) entscheidet über die Zeile: Dritte erhalten `resource: null`,
      // sollen den Diebstahl aber trotzdem sehen. Bei leerem Opfer (stole: false) keine Zeile.
      return ev.stole ? { Icon: HandCoins, text: `${name(game, ev.to)} stiehlt von ${name(game, ev.from)}` } : null;
    case 'trade':
      return { Icon: ArrowRightLeft, text: `${name(game, ev.from)} handelt mit ${name(game, ev.to)}` };
    case 'bankTrade':
      return { Icon: Landmark, text: `${name(game, ev.player)} tauscht mit der Bank` };
    case 'monopoly':
      return { Icon: Coins, text: `${name(game, ev.player)} nimmt ${ev.total}× ${RESOURCE_LABEL[ev.resource]} (Monopol)` };
    case 'longestRoad':
      return ev.player ? { Icon: Route, text: `${name(game, ev.player)} hat die Längste Straße` } : null;
    case 'largestArmy':
      return ev.player ? { Icon: Swords, text: `${name(game, ev.player)} hat die Größte Rittermacht` } : null;
    case 'win':
      return { Icon: Trophy, text: `${name(game, ev.player)} gewinnt!` };
    case 'turn':
      return { Icon: ArrowRight, text: `${name(game, ev.player)} ist am Zug` };
    default:
      return null;
  }
}

export function EventLog() {
  const game = useStore((s) => s.game);
  if (!game) return null;
  const lines = game.log.map((ev) => fmt(ev, game)).filter((x): x is { Icon: IconType; text: string } => x !== null).slice(-6);
  return (
    <div className="event-log">
      {lines.map(({ Icon, text }, i) => (
        <div key={i} className="event-line" style={{ opacity: 0.5 + (i / lines.length) * 0.5 }}>
          <Icon size={13} className="event-ico" />
          <span>{text}</span>
        </div>
      ))}
    </div>
  );
}
