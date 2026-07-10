import { useEffect, useState } from 'react';
import { randomName } from '@catan/shared';
import { useStore } from '../store';

export function Home() {
  const { name, setName, createRoom, joinRoom, status, notFound, clearNotFound } = useStore();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  // Kein gespeicherter Name → mit einem zufälligen Vorschlag vorbelegen (editierbar).
  const [localName, setLocalName] = useState(() => name || randomName());
  const [code, setCode] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const room = params.get('room');
    if (room) {
      setCode(room.toUpperCase());
      setTab('join');
    }
  }, []);

  const canSubmit = localName.trim().length >= 2 && status === 'online' && (tab === 'create' || code.trim().length >= 4);

  const submit = () => {
    if (!canSubmit) return;
    clearNotFound();
    setName(localName.trim());
    if (tab === 'create') createRoom(localName.trim());
    else joinRoom(code.trim(), localName.trim());
  };

  return (
    <div className="home">
      <div className="panel home-card">
        <h1 className="home-title">Catan Online</h1>
        <p className="home-sub">Hex-Aufbau-Strategie · Live-Multiplayer für 2–10 Spieler</p>

        <div className="tab-row">
          <div className={`tab ${tab === 'create' ? 'active' : ''}`} onClick={() => setTab('create')}>
            Raum erstellen
          </div>
          <div className={`tab ${tab === 'join' ? 'active' : ''}`} onClick={() => setTab('join')}>
            Beitreten
          </div>
        </div>

        <div className="field-label">Dein Name</div>
        <input
          value={localName}
          maxLength={20}
          placeholder="Dein Spielername"
          onChange={(e) => setLocalName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          style={{ width: '100%', marginBottom: 16 }}
          autoFocus
        />

        {tab === 'join' && (
          <>
            <div className="field-label">Raum-Code</div>
            <input
              value={code}
              maxLength={6}
              placeholder="6-stelliger Code"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              style={{ width: '100%', marginBottom: 16, letterSpacing: 4, fontFamily: 'Marcellus, serif', fontSize: 20 }}
            />
          </>
        )}

        {notFound && <div className="toast bad" style={{ marginBottom: 14 }}>{notFound}</div>}

        <button className="btn btn-gold" style={{ width: '100%', fontSize: 16, padding: 14 }} disabled={!canSubmit} onClick={submit}>
          {tab === 'create' ? 'Raum erstellen' : 'Raum beitreten'}
        </button>

        {status !== 'online' && <p className="muted" style={{ textAlign: 'center', marginTop: 14, fontSize: 13 }}>Verbinde mit dem Server…</p>}
      </div>
    </div>
  );
}
