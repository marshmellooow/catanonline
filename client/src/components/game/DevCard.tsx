import type { DevCardType } from '@catan/shared';

/** Ein Motiv-Rechteck im Kartenbild (Prozentwerte relativ zur Bildfläche). */
interface DevMotif {
  l: number;
  t: number;
  w: number;
  h: number;
  clip: string; // 'none' oder clip-path polygon(...)
  rad: string; // border-radius (px werden mit Kartengröße skaliert)
  bg: string;
}

/**
 * Entwicklungskarten-Artwork — 1:1 aus dem Design-System portiert
 * (design_handoff_catan_webapp/Hex Game Design v2.dc.html, `devCards`).
 * Alle Karten teilen den lila Verlauf; die Motive bilden das jeweilige Symbol.
 */
export const DEV_ART: Record<DevCardType, { name: string; art: DevMotif[] }> = {
  knight: {
    name: 'Ritter',
    art: [
      { l: 36, t: 10, w: 28, h: 22, clip: 'none', rad: '50%', bg: '#D6DEE6' },
      { l: 26, t: 30, w: 48, h: 48, clip: 'polygon(38% 0%,62% 0%,58% 30%,82% 85%,88% 100%,12% 100%,18% 85%,42% 30%)', rad: '0', bg: '#B8C2CC' },
      { l: 22, t: 78, w: 56, h: 12, clip: 'none', rad: '50%', bg: '#8B95A0' },
    ],
  },
  roadBuilding: {
    name: 'Straßenbau',
    art: [
      { l: 30, t: 16, w: 13, h: 64, clip: 'none', rad: '99px', bg: '#EBC25E' },
      { l: 56, t: 24, w: 13, h: 64, clip: 'none', rad: '99px', bg: '#D9A83E' },
    ],
  },
  yearOfPlenty: {
    name: 'Erfindung',
    art: [
      { l: 18, t: 22, w: 28, h: 46, clip: 'none', rad: '5px', bg: '#F8F2DE' },
      { l: 52, t: 22, w: 28, h: 46, clip: 'none', rad: '5px', bg: '#EBC25E' },
    ],
  },
  monopoly: {
    name: 'Monopol',
    art: [
      { l: 20, t: 24, w: 18, h: 18, clip: 'none', rad: '50%', bg: '#F8F2DE' },
      { l: 41, t: 16, w: 20, h: 20, clip: 'none', rad: '50%', bg: '#FFFFFF' },
      { l: 64, t: 24, w: 18, h: 18, clip: 'none', rad: '50%', bg: '#F8F2DE' },
      { l: 28, t: 48, w: 46, h: 30, clip: 'none', rad: '8px 8px 0 0', bg: '#D6DEE6' },
    ],
  },
  victoryPoint: {
    name: 'Siegpunkt',
    art: [
      { l: 28, t: 16, w: 44, h: 34, clip: 'none', rad: '0 0 50% 50%', bg: '#EBC25E' },
      { l: 45, t: 48, w: 10, h: 16, clip: 'none', rad: '0', bg: '#D9A83E' },
      { l: 33, t: 62, w: 34, h: 9, clip: 'none', rad: '3px', bg: '#B58E36' },
    ],
  },
};

/** Skaliert px-Radien mit der Kartengröße (%- und 0-Werte bleiben). */
function scaleRad(rad: string, k: number): string {
  if (rad === 'none' || rad === '0') return '0';
  return rad.replace(/(\d+)px/g, (_, n) => `${Math.max(1, Math.round(Number(n) * k))}px`);
}

/**
 * Echte Entwicklungskarte im Design-System-Look (Cremerahmen, lila Bild, Motiv, Name).
 * `faceDown` zeigt die Rückseite (Deck, Gegner, Kauf-Animation).
 */
export function DevCard({
  card,
  size = 74,
  label = true,
  faceDown = false,
}: {
  card?: DevCardType;
  size?: number;
  label?: boolean;
  faceDown?: boolean;
}) {
  const k = size / 74;
  const W = size;
  const H = Math.round(size * (100 / 74));
  const pad = Math.max(2, W * 0.066);
  const cardRad = Math.max(3, Math.round(W * 0.12));
  const artRad = Math.max(2, Math.round(W * 0.07));
  const def = card ? DEV_ART[card] : null;
  const showName = label && !faceDown && !!def;

  return (
    <div className="devcard" style={{ width: W, height: H, borderRadius: cardRad, padding: pad }}>
      <div className={`devcard-art${faceDown || !def ? ' back' : ''}`} style={{ borderRadius: artRad }}>
        {faceDown || !def ? (
          <span className="devcard-emblem" />
        ) : (
          def.art.map((m, i) => (
            <span
              key={i}
              className="devcard-motif"
              style={{
                left: `${m.l}%`,
                top: `${m.t}%`,
                width: `${m.w}%`,
                height: `${m.h}%`,
                clipPath: m.clip === 'none' ? undefined : m.clip,
                borderRadius: scaleRad(m.rad, k),
                background: m.bg,
              }}
            />
          ))
        )}
      </div>
      {showName && (
        <div className="devcard-name" style={{ fontSize: Math.max(7, Math.round(W * 0.135)), marginTop: Math.max(1, W * 0.05) }}>
          {def!.name}
        </div>
      )}
    </div>
  );
}
