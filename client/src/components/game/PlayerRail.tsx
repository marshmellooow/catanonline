import { useStore } from '../../store';
import { PLAYER_COLORS } from '@catan/shared';
import { Bot, Layers, ScrollText, Swords, Route } from '../../icons';

export function PlayerRail() {
  const game = useStore((s) => s.game);
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.playerId);
  const sendMsg = useStore((s) => s.sendMsg);
  if (!game) return null;

  const isHost = room?.hostId === me;
  const ping = room?.ping ?? {};

  return (
    <div className="rail panel">
      <div className="rail-head">
        <span className="marcellus">Spieler</span>
        <span className="muted" style={{ fontSize: 12 }}>Ziel: {game.vpTarget} SP</span>
      </div>
      <div className="rail-list">
        {game.order.map((pid) => {
          const p = game.players.find((x) => x.id === pid)!;
          const col = PLAYER_COLORS[p.colorIndex];
          const active = game.activePlayer === pid;
          const latency = ping[pid];
          const connDot = !p.connected ? 'gone' : latency !== undefined && latency > 400 ? 'away' : 'online';
          return (
            <div key={pid} data-player-row={pid} className={`rail-player ${active ? 'active' : ''}`} style={active ? { borderColor: col.c } : undefined}>
              <div className="swatch" style={{ background: col.c }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row gap-2" style={{ justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {p.name}{p.isBot && <Bot size={13} className="muted" />}
                  </span>
                  <span className="num" style={{ fontSize: 20, color: 'var(--gold)' }}>{p.victoryPoints}</span>
                </div>
                <div className="row gap-3 muted" style={{ fontSize: 12, marginTop: 3, flexWrap: 'wrap' }}>
                  <span className="stat" title="Handkarten"><Layers size={13} /> {p.resourceCount}</span>
                  <span className="stat" title="Entwicklungskarten"><ScrollText size={13} /> {p.devCardCount}</span>
                  <span className="stat" title={p.largestArmy ? 'Größte Rittermacht (Auszeichnung, +2 SP)' : 'Gespielte Ritter'} style={p.largestArmy ? { color: 'var(--gold)', fontWeight: 700 } : undefined}><Swords size={13} /> {p.playedKnights}</span>
                  <span className="stat" title={p.longestRoad ? 'Längste Straße (Auszeichnung, +2 SP)' : 'Längste eigene Straße'} style={p.longestRoad ? { color: 'var(--gold)', fontWeight: 700 } : undefined}><Route size={14} /> {p.roadLength}</span>
                </div>
              </div>
              <div className={`status-dot ${connDot}`} title={p.connected ? 'verbunden' : 'getrennt'} />
              {isHost && !p.connected && !p.isBot && game.phase !== 'finished' && (
                <button className="btn btn-sm btn-ghost" style={{ padding: '2px 6px' }} onClick={() => sendMsg({ t: 'replaceWithBot', playerId: pid })} title="Durch Bot ersetzen">
                  Bot
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
