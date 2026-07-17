import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { PLAYER_COLORS } from '@catan/shared';
import type { PublicPlayer, VpBreakdown } from '@catan/shared';
import { Trophy, ArrowRight, Users, LogOut, ChevronDown, Home, Building2, Swords, Route, EyeOff } from '../../icons';

/** Eine Zeile der Aufschlüsselung — nur zeigen, wenn sie tatsächlich Punkte bringt. */
function VpRow({ icon, label, points }: { icon: React.ReactNode; label: string; points: number }) {
  return (
    <div className="row gap-2 vp-line">
      <span className="row gap-2 muted" style={{ alignItems: 'center' }}>{icon} {label}</span>
      <span className="num" style={{ color: 'var(--gold)' }}>+{points}</span>
    </div>
  );
}

function VpBreakdownRows({ b }: { b: VpBreakdown }) {
  return (
    <div className="col vp-breakdown">
      {b.settlements > 0 && <VpRow icon={<Home size={14} />} label={`Siedlungen × ${b.settlements}`} points={b.settlements} />}
      {b.cities > 0 && <VpRow icon={<Building2 size={14} />} label={`Städte × ${b.cities}`} points={b.cities * 2} />}
      {b.longestRoad && <VpRow icon={<Route size={14} />} label="Längste Straße" points={2} />}
      {b.largestArmy && <VpRow icon={<Swords size={14} />} label="Größte Rittermacht" points={2} />}
      {b.hidden > 0 && <VpRow icon={<EyeOff size={14} />} label={`Verdeckte Siegpunktkarten × ${b.hidden}`} points={b.hidden} />}
    </div>
  );
}

function PlayerResult({ p, isWinner }: { p: PublicPlayer; isWinner: boolean }) {
  // Anfangszustand an der SIEGER-IDENTITÄT festmachen, nicht an der Listenposition:
  // die Sortierung ändert sich beim Spielende noch (Siegpunkte werden aufgedeckt),
  // React behält die Komponenten aber per `key` — ein `rank === 0` beim Mounten traf
  // dann die falschen Zeilen und klappte drei von vier auf.
  const [open, setOpen] = useState(isWinner);
  const col = PLAYER_COLORS[p.colorIndex];
  const canExpand = !!p.vpBreakdown;
  return (
    <div className="vp-result">
      <button
        className="row gap-2 vp-result-head"
        disabled={!canExpand}
        onClick={() => setOpen((o) => !o)}
        style={{ borderColor: isWinner ? col.c : 'transparent' }}
      >
        <span className="row gap-2" style={{ alignItems: 'center' }}>
          {canExpand && <ChevronDown size={15} className={`vp-chevron ${open ? 'open' : ''}`} />}
          <span className="swatch" style={{ background: col.c, width: 18, height: 18 }} />
          {p.name}
        </span>
        <span className="num" style={{ color: 'var(--gold)' }}>{p.victoryPoints} SP</span>
      </button>
      {open && p.vpBreakdown && <VpBreakdownRows b={p.vpBreakdown} />}
    </div>
  );
}

export function WinnerOverlay() {
  const game = useStore((s) => s.game);
  const leaveRoom = useStore((s) => s.leaveRoom);
  const returnToLobby = useStore((s) => s.returnToLobby);
  const [hidden, setHidden] = useState(false);

  // Bei neuem Spielende wieder einblenden (falls von letzter Runde „ausgeblendet").
  const winnerId = game?.winner ?? null;
  useEffect(() => {
    setHidden(false);
  }, [winnerId]);

  if (!game || !game.winner) return null;
  const winner = game.players.find((p) => p.id === game.winner);
  const col = winner ? PLAYER_COLORS[winner.colorIndex] : PLAYER_COLORS[0];
  const ranked = [...game.players].sort((a, b) => b.victoryPoints - a.victoryPoints);

  // „Brett ansehen": Modal ausgeblendet → kleiner Wiedereinblenden-Button.
  if (hidden) {
    return (
      <button className="btn btn-gold winner-reopen" onClick={() => setHidden(false)}>
        <Trophy size={16} /> Ergebnis
      </button>
    );
  }

  return (
    <div className="modal-scrim">
      <div className="dialog modal-card" style={{ textAlign: 'center', borderColor: col.c }}>
        <div style={{ color: 'var(--gold)', display: 'flex', justifyContent: 'center' }}><Trophy size={52} /></div>
        <h1 className="marcellus" style={{ color: col.l, margin: '6px 0' }}>{winner?.name} gewinnt!</h1>
        <p className="muted">Mit {winner?.victoryPoints} Siegpunkten. Gut gespielt.</p>
        <p className="muted vp-hint">Tippe auf einen Spieler für die Punkte-Aufschlüsselung.</p>
        <div className="col gap-2" style={{ marginTop: 10, alignItems: 'stretch' }}>
          {ranked.map((p) => <PlayerResult key={p.id} p={p} isWinner={p.id === game.winner} />)}
        </div>
        <div className="col gap-2" style={{ marginTop: 18, alignItems: 'stretch' }}>
          <button className="btn btn-ghost" onClick={() => setHidden(true)}><ArrowRight size={16} /> Brett ansehen</button>
          <button className="btn btn-gold" onClick={returnToLobby}><Users size={16} /> Zurück zur Lobby</button>
          <button className="btn btn-red" onClick={leaveRoom}><LogOut size={16} /> Zurück zum Start</button>
        </div>
      </div>
    </div>
  );
}
