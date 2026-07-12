import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { flowerCells, HexGradients, HexTile, uniqueCodes } from './hexart';
import { APP_VERSION_LABEL, type TerrainCode } from '@catan/shared';
import './loading.css';

const RAD = 27;
const FLOWER_TERR: TerrainCode[] = ['G', 'F', 'H', 'P', 'M', 'W', 'D'];
const CELLS = flowerCells(RAD, FLOWER_TERR);
const CODES = uniqueCodes(CELLS);

const MIN_MS = 2500; // Splash mindestens so lange zeigen, damit die Animation sichtbar ist
const FADE_MS = 520; // muss zur .is-leaving-Transition in loading.css passen

/** Initialer Ladebildschirm beim Öffnen der Website (während der WS-Verbindungsaufbau läuft). */
export function BootScreen() {
  const status = useStore((s) => s.status);
  const finishBoot = useStore((s) => s.finishBoot);
  const [leaving, setLeaving] = useState(false);
  const born = useRef(Date.now());

  // Sobald online (und die Mindestdauer erreicht ist): ausblenden.
  useEffect(() => {
    if (status !== 'online') return;
    const wait = Math.max(0, MIN_MS - (Date.now() - born.current));
    const t = setTimeout(() => setLeaving(true), wait);
    return () => clearTimeout(t);
  }, [status]);

  // Nach dem Ausblenden aus dem DOM nehmen.
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(finishBoot, FADE_MS);
    return () => clearTimeout(t);
  }, [leaving, finishBoot]);

  return (
    <div className={`boot ${leaving ? 'is-leaving' : ''}`} role="status" aria-live="polite">
      <div className="boot-inner">
        <div className="boot-glow" />
        <svg className="boot-hexes" viewBox="-80 -74 160 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <HexGradients prefix="boot" codes={CODES} />
          {CELLS.map((c, i) => (
            <HexTile
              key={i}
              cell={c}
              rad={RAD}
              gradPrefix="boot"
              className="boot-hex"
              style={{ animationDelay: `${(0.09 * i).toFixed(2)}s` }}
            />
          ))}
        </svg>

        <h1 className="boot-title">Catan Online</h1>
        <div className="boot-bar" aria-hidden="true">
          <span />
        </div>
        <div className="boot-status">
          {status === 'online' ? 'Bereit' : status === 'offline' ? 'Verbindung wird aufgebaut…' : 'Verbinde mit dem Server…'}
        </div>
        <div className="powered-by boot-credit">Powered by <b>Marshl</b></div>
        <div className="boot-version">{APP_VERSION_LABEL}</div>
      </div>
    </div>
  );
}
