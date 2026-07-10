import { useStore } from './store';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Game } from './screens/Game';
import { Toasts } from './components/Toasts';
import { BootScreen } from './components/loading/BootScreen';
import { GameIntro } from './components/loading/GameIntro';
import './app.css';

export function App() {
  const screen = useStore((s) => s.screen);
  const status = useStore((s) => s.status);
  const booting = useStore((s) => s.booting);
  const everOnline = useStore((s) => s.everOnline);
  const gameStarting = useStore((s) => s.gameStarting);

  return (
    <div className="app-root">
      {screen === 'home' && <Home />}
      {screen === 'lobby' && <Lobby />}
      {screen === 'game' && <Game />}

      {gameStarting && screen === 'game' && <GameIntro />}

      {/* Reconnect-Overlay nur nach einer bereits bestandenen Verbindung — der
          Erst-Verbindungsaufbau wird vom Boot-Splash abgedeckt. */}
      {everOnline && status !== 'online' && (
        <div className="conn-overlay">
          <div className="dialog conn-card">
            <div className="spinner" />
            <div>
              <div className="marcellus" style={{ fontSize: 20 }}>
                {status === 'offline' ? 'Verbindung verloren' : 'Verbinde…'}
              </div>
              <div className="muted" style={{ fontSize: 14, marginTop: 4 }}>
                Neuer Verbindungsversuch läuft automatisch…
              </div>
            </div>
          </div>
        </div>
      )}

      {booting && <BootScreen />}

      <Toasts />
    </div>
  );
}
