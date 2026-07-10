import { useStore } from '../../store';
import { PLAYER_COLORS } from '@catan/shared';
import { Trophy } from '../../icons';

export function WinnerOverlay() {
  const game = useStore((s) => s.game);
  const leaveRoom = useStore((s) => s.leaveRoom);
  if (!game || !game.winner) return null;
  const winner = game.players.find((p) => p.id === game.winner);
  const col = winner ? PLAYER_COLORS[winner.colorIndex] : PLAYER_COLORS[0];

  return (
    <div className="modal-scrim">
      <div className="dialog modal-card" style={{ textAlign: 'center', borderColor: col.c }}>
        <div style={{ color: 'var(--gold)', display: 'flex', justifyContent: 'center' }}><Trophy size={52} /></div>
        <h1 className="marcellus" style={{ color: col.l, margin: '6px 0' }}>{winner?.name} gewinnt!</h1>
        <p className="muted">Mit {winner?.victoryPoints} Siegpunkten. Gut gespielt.</p>
        <div className="col gap-2" style={{ marginTop: 14, alignItems: 'stretch' }}>
          {[...game.players].sort((a, b) => b.victoryPoints - a.victoryPoints).map((p) => (
            <div key={p.id} className="row gap-2" style={{ justifyContent: 'space-between', padding: '6px 10px', background: 'rgba(0,0,0,.2)', borderRadius: 8 }}>
              <span className="row gap-2"><span className="swatch" style={{ background: PLAYER_COLORS[p.colorIndex].c, width: 18, height: 18 }} />{p.name}</span>
              <span className="num" style={{ color: 'var(--gold)' }}>{p.victoryPoints} SP</span>
            </div>
          ))}
        </div>
        <button className="btn btn-gold" style={{ width: '100%', marginTop: 18 }} onClick={leaveRoom}>Zurück zum Start</button>
      </div>
    </div>
  );
}
