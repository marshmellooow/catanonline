import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { MAPS, PLAYER_COLORS, buildBoard, getMap, TURN_TIME_OPTIONS, APP_VERSION_LABEL } from '@catan/shared';
import { Board } from '../components/board/Board';
import { ChatPanel } from '../components/ChatPanel';
import { InfoDialog } from '../components/InfoDialog';
import { Crown, Bot, Check, LogOut, Info } from '../icons';

const MAP_OPTIONS = [
  ...MAPS.map((m) => ({ id: m.id, title: m.title, desc: m.desc })),
  { id: 'random', title: 'Zufallskarte', desc: 'Terrain & Zahlen zufällig gemischt (6 & 8 nie benachbart).' },
];

export function Lobby() {
  const { room, playerId, sendMsg, leaveRoom } = useStore();
  const [copied, setCopied] = useState(false);
  const [showInfo, setShowInfo] = useState(false);

  const previewBoard = useMemo(() => (room ? buildBoard(room.mapId, 777) : null), [room?.mapId]);

  if (!room) return null;
  const me = room.players.find((p) => p.id === playerId);
  const isHost = me?.isHost ?? false;
  const takenColors = new Set(room.players.filter((p) => p.id !== playerId).map((p) => p.colorIndex));
  const allReady = room.players.length >= room.minPlayers && room.players.every((p) => p.ready);
  const mapDef = getMap(room.mapId === 'random' ? 'classic' : room.mapId);

  const copyLink = () => {
    navigator.clipboard?.writeText(`${location.origin}?room=${room.code}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="lobby">
      <div className="lobby-main">
        {/* Kopf */}
        <div className="panel" style={{ padding: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>Raum-Code — teile ihn mit Freunden</div>
            <div className="row gap-3">
              <div className="code-badge">{room.code}</div>
              <button className="btn btn-ghost btn-sm" onClick={copyLink}>{copied ? <><Check size={14} /> Kopiert</> : 'Link kopieren'}</button>
            </div>
          </div>
          <div className="row gap-2">
            <button className="btn btn-ghost" onClick={() => setShowInfo(true)} title="Info & Regeln"><Info size={15} /> Info</button>
            <button className="btn btn-red" onClick={leaveRoom}><LogOut size={15} /> Verlassen</button>
          </div>
        </div>

        {/* Karten-Vorschau + Auswahl */}
        <div className="panel lobby-map" style={{ padding: 16, minHeight: 0, flex: 1 }}>
          <div className="col" style={{ minHeight: 0 }}>
            <h3 style={{ margin: '0 0 10px' }}>Karte</h3>
            <div className="map-grid" style={{ overflowY: 'auto', paddingRight: 4 }}>
              {MAP_OPTIONS.map((m) => (
                <button
                  key={m.id}
                  className={`map-card ${room.mapId === m.id ? 'sel' : ''}`}
                  disabled={!isHost}
                  onClick={() => sendMsg({ t: 'chooseMap', mapId: m.id })}
                >
                  <h4>{m.title}</h4>
                  <p>{m.desc}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="center" style={{ background: 'rgba(0,0,0,.2)', borderRadius: 12, minHeight: 240, overflow: 'hidden' }}>
            {previewBoard && (
              <Board
                board={previewBoard}
                buildings={{}}
                roads={{}}
                robberHex={previewBoard.hexes.find((h) => h.terrain === 'D')?.id ?? 0}
                colorOf={() => PLAYER_COLORS[0]}
              />
            )}
          </div>
        </div>

        {/* Optionen */}
        <div className="panel" style={{ padding: 16, display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div className="field-label">Siegpunkte-Ziel</div>
            <div className="row gap-2" style={{ flexWrap: 'wrap' }}>
              {[8, 10, 12, 15, 18, 20].map((v) => (
                <button
                  key={v}
                  className={`btn btn-sm ${room.vpTarget === v ? 'btn-gold' : 'btn-ghost'}`}
                  disabled={!isHost}
                  onClick={() => sendMsg({ t: 'setOption', vpTarget: v })}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="field-label">Bank pro Rohstoff</div>
            <div className="row gap-2">
              {[10, 19, 25, 30].map((v) => (
                <button
                  key={v}
                  className={`btn btn-sm ${room.bankSize === v ? 'btn-gold' : 'btn-ghost'}`}
                  disabled={!isHost}
                  onClick={() => sendMsg({ t: 'setBankSize', bankSize: v })}
                  title="So viele Karten je Rohstoff hat die Bank. Ist die Bank leer, bekommt niemand diesen Rohstoff."
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="field-label">Zug-Zeit</div>
            <div className="row gap-2">
              {TURN_TIME_OPTIONS.map((v) => (
                <button
                  key={v}
                  className={`btn btn-sm ${room.turnSeconds === v ? 'btn-gold' : 'btn-ghost'}`}
                  disabled={!isHost}
                  onClick={() => sendMsg({ t: 'setTurnTime', turnSeconds: v })}
                  title="Zeitlimit pro Zug. Läuft es ab, wird der Zug automatisch zu Ende gespielt."
                >
                  {v === 0 ? 'Aus' : `${v}s`}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="field-label">Spieler {mapDef ? `(${room.minPlayers}–${room.maxPlayers})` : ''}</div>
            <div className="text-2">{room.players.length} beigetreten</div>
          </div>
        </div>
      </div>

      {/* Seitenpanel: Spieler + Chat */}
      <div className="panel side">
        <div style={{ padding: 16, borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 12px' }}>Spieler</h3>
          <div className="col gap-2">
            {room.players.map((p) => {
              const col = PLAYER_COLORS[p.colorIndex];
              return (
                <div key={p.id} className={`seat ${p.id === playerId ? 'you' : ''}`}>
                  <div className="swatch" style={{ background: col.c }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      {p.name}
                      {p.isBot && <Bot size={14} className="muted" />}
                      {p.isHost && <span title="Host" style={{ color: 'var(--gold)', display: 'inline-flex' }}><Crown size={14} /></span>}
                      {p.id === playerId && <span className="muted">(du)</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>{p.ready ? 'Bereit' : 'Nicht bereit'}</div>
                  </div>
                  <div className={`status-dot ${p.connected ? 'online' : 'gone'}`} />
                  {isHost && p.id !== playerId && (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => sendMsg(p.isBot ? { t: 'removeBot', playerId: p.id } : { t: 'kick', playerId: p.id })}
                    >
                      {p.isBot ? 'Entfernen' : 'Kick'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {isHost && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 10, width: '100%' }}
              disabled={room.players.length >= room.maxPlayers}
              onClick={() => sendMsg({ t: 'addBot' })}
            >
              <Bot size={15} /> Bot hinzufügen {room.players.length >= room.maxPlayers && '(Karte voll)'}
            </button>
          )}

          {/* Farbwahl */}
          <div style={{ marginTop: 14 }}>
            <div className="field-label">Deine Farbe</div>
            <div className="color-grid">
              {PLAYER_COLORS.map((c, i) => (
                <button
                  key={i}
                  className={`color-dot ${me?.colorIndex === i ? 'picked' : ''} ${takenColors.has(i) ? 'taken' : ''}`}
                  style={{ background: c.c }}
                  disabled={takenColors.has(i)}
                  title={c.name}
                  onClick={() => sendMsg({ t: 'setColor', colorIndex: i })}
                />
              ))}
            </div>
          </div>

          {/* Aktionen */}
          <div className="col gap-2" style={{ marginTop: 16 }}>
            <button
              className={`btn ${me?.ready ? 'btn-ghost' : 'btn-green'}`}
              onClick={() => sendMsg({ t: 'setReady', ready: !me?.ready })}
            >
              {me?.ready ? <><Check size={16} /> Bereit — klicken zum Zurücknehmen</> : 'Bereit'}
            </button>
            {isHost && (
              <button className="btn btn-gold" disabled={!allReady} onClick={() => sendMsg({ t: 'startGame' })}>
                Spiel starten {!allReady && '(alle müssen bereit sein)'}
              </button>
            )}
            {!isHost && <div className="muted center" style={{ fontSize: 13, padding: 6 }}>Warte auf den Host…</div>}
          </div>
        </div>

        <ChatPanel />
        <div className="lobby-version muted">{APP_VERSION_LABEL}</div>
      </div>

      {showInfo && <InfoDialog onClose={() => setShowInfo(false)} />}
    </div>
  );
}
