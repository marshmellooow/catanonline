import type { TerrainCode } from '@catan/shared';

/**
 * Detaillierte Gelände-Illustrationen (flaches Vektor-Design) innerhalb einer Box (x,y,w,h).
 * Wird auf Brett-Feldern, Hafen-Emblemen und Rohstoffkarten genutzt → ein Ort, überall konsistent.
 * Motive sitzen im oberen/mittleren Band, damit auf dem Feld die Zahl-Plakette (unten) frei bleibt.
 */

const ART = {
  F: { trunk: '#6E4A28', dark: '#1F4D30', mid: '#2F6B3E', light: '#4FA05C' },
  H: { brick: '#B24E2D', top: '#DE7648', mortar: '#792F16' },
  P: { wool: '#F6F3EA', woolSh: '#DAD6C6', face: '#46423B', grass: '#5F8A2C' },
  G: { stalk: '#B0801F', ear: '#E3A62A', earLt: '#F4D98A', kernel: '#93691A' },
  M: { dark: '#666D74', mid: '#858D90', light: '#B7BFC1', snow: '#EEF3F5' },
  D: { duneD: '#CBB16A', duneL: '#F0E1AD', cactus: '#6C9E56', cactusD: '#4E7A42', sun: '#F5E3A6' },
  W: { w1: 'rgba(255,255,255,.36)', w2: 'rgba(255,255,255,.24)', w3: 'rgba(255,255,255,.15)' },
} as const;

export function Motifs({ x, y, w, h, terrain }: { x: number; y: number; w: number; h: number; terrain: TerrainCode }) {
  // Prozent-Koordinaten (0..100) → absolut in der Box
  const X = (p: number) => x + (p / 100) * w;
  const Y = (p: number) => y + (p / 100) * h;
  const wp = (d: number) => (d / 100) * w; // Breite in % der Box
  const hp = (d: number) => (d / 100) * h; // Höhe in % der Box
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, fill: string, key?: string | number) => (
    <polygon key={key} points={`${X(ax)},${Y(ay)} ${X(bx)},${Y(by)} ${X(cx)},${Y(cy)}`} fill={fill} />
  );
  const rect = (l: number, t: number, r: number, b: number, fill: string, rx = 0, key?: string | number) => (
    <rect key={key} x={X(l)} y={Y(t)} width={X(r) - X(l)} height={Y(b) - Y(t)} rx={rx ? X(l + rx) - X(l) : 0} fill={fill} />
  );
  // Halb-Ellipse (Kuppe) mit flachem Boden
  const dome = (cx: number, base: number, rad: number, height: number, fill: string, key?: string | number) => (
    <path key={key} d={`M ${X(cx - rad)} ${Y(base)} Q ${X(cx - rad)} ${Y(base - height)} ${X(cx)} ${Y(base - height)} Q ${X(cx + rad)} ${Y(base - height)} ${X(cx + rad)} ${Y(base)} Z`} fill={fill} />
  );

  switch (terrain) {
    case 'F': {
      // Nadelbäume: Stamm + 3 gestapelte Kronen (dunkel→hell)
      const pine = (cx: number, base: number, s: number, key: string) => {
        const tw = 2.4 * s; // halbe Stammbreite
        const fw = 13 * s; // halbe Kronenbreite unten
        return (
          <g key={key}>
            {rect(cx - tw, base, cx + tw, base + 8 * s, ART.F.trunk)}
            {tri(cx, base - 34 * s, cx - fw, base, cx + fw, base, ART.F.dark)}
            {tri(cx, base - 42 * s, cx - fw * 0.82, base - 12 * s, cx + fw * 0.82, base - 12 * s, ART.F.mid)}
            {tri(cx, base - 48 * s, cx - fw * 0.6, base - 24 * s, cx + fw * 0.6, base - 24 * s, ART.F.light)}
          </g>
        );
      };
      return (
        <>
          {pine(28, 58, 0.8, 'l')}
          {pine(72, 56, 0.85, 'r')}
          {pine(50, 64, 1.05, 'c')}
        </>
      );
    }
    case 'H': {
      // Ziegelmauer (Lehm): 3 Reihen im Läuferverband + Mörtel-Hintergrund + heller Oberkante
      const bw = 15;
      const bh = 8;
      const gap = 1.6;
      const half = (bw - gap) / 2;
      const brick = (lx: number, ty: number, bwd: number, key: string) => (
        <g key={key}>
          <rect x={X(lx)} y={Y(ty)} width={X(lx + bwd) - X(lx)} height={Y(ty + bh) - Y(ty)} rx={X(lx + 0.8) - X(lx)} fill={ART.H.brick} />
          <rect x={X(lx)} y={Y(ty)} width={X(lx + bwd) - X(lx)} height={Y(ty + 2.6) - Y(ty)} rx={X(lx + 0.8) - X(lx)} fill={ART.H.top} />
        </g>
      );
      const L = 24; // linker Rand
      return (
        <>
          {/* Mörtel-Hintergrund */}
          <rect x={X(L - 2)} y={Y(31)} width={X(L + 3 * bw + 2 * gap + 2) - X(L - 2)} height={Y(60) - Y(31)} rx={X(L) - X(L - 2)} fill={ART.H.mortar} />
          {/* untere Reihe (A): 3 ganze Ziegel */}
          {brick(L, 51, bw, 'a1')}
          {brick(L + bw + gap, 51, bw, 'a2')}
          {brick(L + 2 * (bw + gap), 51, bw, 'a3')}
          {/* mittlere Reihe (B): halb + 2 ganze + halb (versetzt) */}
          {brick(L, 42, half, 'b0')}
          {brick(L + half + gap, 42, bw, 'b1')}
          {brick(L + half + gap + bw + gap, 42, bw, 'b2')}
          {brick(L + half + gap + 2 * (bw + gap), 42, half, 'b3')}
          {/* obere Reihe (A): 3 ganze Ziegel */}
          {brick(L, 33, bw, 'c1')}
          {brick(L + bw + gap, 33, bw, 'c2')}
          {brick(L + 2 * (bw + gap), 33, bw, 'c3')}
        </>
      );
    }
    case 'P': {
      // Zwei Schafe nebeneinander (nach außen blickend) → klar als Schafherde erkennbar
      const sheep = (cx: number, cy: number, s: number, faceLeft: boolean, key: string) => {
        const dir = faceLeft ? -1 : 1;
        const bw = 11 * s;
        const bh = 7.5 * s;
        const hx = cx + dir * bw * 0.95;
        const hy = cy - bh * 0.1;
        const legW = wp(1.8 * s);
        const legH = hp(7 * s);
        return (
          <g key={key}>
            {/* Beine */}
            <rect x={X(cx - bw * 0.5)} y={Y(cy + bh * 0.45)} width={legW} height={legH} fill={ART.P.face} />
            <rect x={X(cx + bw * 0.2)} y={Y(cy + bh * 0.45)} width={legW} height={legH} fill={ART.P.face} />
            {/* Wollkörper + Fluff */}
            <ellipse cx={X(cx)} cy={Y(cy)} rx={wp(bw)} ry={hp(bh)} fill={ART.P.wool} />
            <circle cx={X(cx - bw * 0.55)} cy={Y(cy - bh * 0.5)} r={wp(4.2 * s)} fill={ART.P.wool} />
            <circle cx={X(cx)} cy={Y(cy - bh * 0.85)} r={wp(4.8 * s)} fill={ART.P.wool} />
            <circle cx={X(cx + bw * 0.55)} cy={Y(cy - bh * 0.5)} r={wp(4.2 * s)} fill={ART.P.wool} />
            {/* Kopf + Ohr + Auge */}
            <ellipse cx={X(hx)} cy={Y(hy)} rx={wp(4.4 * s)} ry={hp(5.2 * s)} fill={ART.P.face} />
            <ellipse cx={X(hx + dir * 2 * s)} cy={Y(hy - 3.4 * s)} rx={wp(1.9 * s)} ry={hp(2.6 * s)} fill={ART.P.face} />
            <circle cx={X(hx + dir * 1.4 * s)} cy={Y(hy - 0.4 * s)} r={wp(1.1 * s)} fill="#fff" opacity={0.9} />
          </g>
        );
      };
      return (
        <>
          {/* Grasbüschel */}
          {tri(12, 60, 16, 52, 20, 60, ART.P.grass)}
          {tri(82, 60, 86, 51, 90, 60, ART.P.grass)}
          {sheep(33, 37, 0.9, true, 's1')}
          {sheep(66, 40, 0.84, false, 's2')}
        </>
      );
    }
    case 'G': {
      // Weizen: Halme mit Ähren (Körner als Chevrons)
      const ear = (cx: number, top: number, key: string) => (
        <g key={key}>
          <ellipse cx={X(cx)} cy={Y(top + 7)} rx={X(4.2) - X(0)} ry={Y(8) - Y(0)} fill={ART.G.ear} />
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              d={`M ${X(cx - 4)} ${Y(top + 3 + i * 4)} Q ${X(cx)} ${Y(top + 1 + i * 4)} ${X(cx + 4)} ${Y(top + 3 + i * 4)}`}
              stroke={ART.G.kernel}
              strokeWidth={Math.max(0.8, X(1) - X(0))}
              fill="none"
              strokeLinecap="round"
            />
          ))}
          <ellipse cx={X(cx - 1.4)} cy={Y(top + 5)} rx={X(1.3) - X(0)} ry={Y(2.4) - Y(0)} fill={ART.G.earLt} opacity={0.8} />
        </g>
      );
      const stalk = (x1: number, x2: number, key: string) => (
        <line key={key} x1={X(x1)} y1={Y(66)} x2={X(x2)} y2={Y(30)} stroke={ART.G.stalk} strokeWidth={Math.max(1, X(1.5) - X(0))} strokeLinecap="round" />
      );
      return (
        <>
          {stalk(50, 50, 's1')}
          {stalk(40, 37, 's2')}
          {stalk(60, 63, 's3')}
          {ear(50, 22, 'e1')}
          {ear(37, 26, 'e2')}
          {ear(63, 26, 'e3')}
        </>
      );
    }
    case 'M': {
      // Bergkette: Gipfel mit Schneekappen + Schattenflanke
      return (
        <>
          {/* hinterer Gipfel links */}
          {tri(30, 30, 14, 62, 46, 62, ART.M.dark)}
          {tri(30, 30, 24, 42, 36, 42, ART.M.snow)}
          {/* Hauptgipfel */}
          {tri(58, 20, 34, 64, 82, 64, ART.M.mid)}
          {tri(58, 20, 34, 64, 58, 64, ART.M.dark)}
          {tri(58, 20, 49, 34, 67, 34, ART.M.snow)}
          <polygon points={`${X(58)},${Y(20)} ${X(53)},${Y(34)} ${X(58)},${Y(34)}`} fill={ART.M.light} opacity={0.7} />
        </>
      );
    }
    case 'D': {
      // Wüste: Sonne + Dünen + Kaktus
      return (
        <>
          <circle cx={X(74)} cy={Y(28)} r={X(6) - X(0)} fill={ART.D.sun} />
          {dome(62, 68, 30, 14, ART.D.duneD)}
          {dome(30, 70, 24, 12, ART.D.duneL)}
          {/* Kaktus */}
          {rect(45, 36, 51, 66, ART.D.cactus, 3)}
          {rect(38, 46, 44, 50, ART.D.cactus, 2)}
          {rect(38, 42, 41, 50, ART.D.cactus, 1.5)}
          {rect(52, 50, 58, 54, ART.D.cactus, 2)}
          {rect(55, 44, 58, 54, ART.D.cactus, 1.5)}
          <rect x={X(46.5)} y={Y(38)} width={X(1.4) - X(0)} height={Y(26) - Y(0)} fill={ART.D.cactusD} opacity={0.5} />
        </>
      );
    }
    case 'W': {
      // Wasser: gestaltete Wellen + kleiner Glanz
      const wave = (yy: number, op: string, key: string) => (
        <path
          key={key}
          d={`M ${X(20)} ${Y(yy)} Q ${X(30)} ${Y(yy - 4)} ${X(40)} ${Y(yy)} T ${X(60)} ${Y(yy)} T ${X(80)} ${Y(yy)}`}
          stroke={op}
          strokeWidth={Math.max(1, X(2) - X(0))}
          fill="none"
          strokeLinecap="round"
        />
      );
      return (
        <>
          {wave(38, ART.W.w1, 'a')}
          {wave(52, ART.W.w2, 'b')}
          {wave(64, ART.W.w3, 'c')}
        </>
      );
    }
    default:
      return null;
  }
}
