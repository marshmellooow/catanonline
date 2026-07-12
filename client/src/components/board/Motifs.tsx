import type { TerrainCode } from '@catan/shared';

/**
 * Vektor-Nachzeichnung der gemalten Gelände-Kacheln (flaches Design), innerhalb einer Box (x,y,w,h).
 * Genutzt auf Brett-Feldern und Hafen-Emblemen. Motive füllen das Feld, lassen aber unten Mitte
 * für die Zahl-Plakette Platz.
 */

const ART = {
  F: { trunk: '#6E4A28', log: '#8A5E32', logEnd: '#C0966A', d: '#1E4A2E', m: '#2F6B3E', l: '#4FA05C', ll: '#6BBE79' },
  H: { pitMid: '#A54D2A', pitD: '#833A1F', pitDD: '#5F2A16', rim: '#DB824F', front: '#C25E38', top: '#E88C5C', side: '#993F1F', line: '#7C3418', wood: '#7C5228', woodD: '#523618', woodL: '#A0713C', rope: '#C9A45C' },
  P: { wool: '#F6F3EA', woolSh: '#DAD6C6', face: '#46423B', grass: '#5F8A2C', grassD: '#4C7222' },
  G: { stalk: '#B0801F', ear: '#E3A62A', earLt: '#F6DD92', kernel: '#8F6516', tie: '#9A6E1A', furrow: '#C89A34' },
  M: { d: '#5C636A', m: '#828B8F', l: '#B6BEC1', snow: '#EFF4F6', cart: '#6E4A28', cartD: '#4E3418', wheel: '#38291A', ore: '#8C9498', oreLt: '#BEC5C8' },
  D: { duneD: '#CBB16A', duneL: '#F0E1AD', rock: '#B49B62', rockD: '#8E784A', rockL: '#DBC98D', cactus: '#6BA152', cactusD: '#4C7A40' },
  W: { w1: 'rgba(255,255,255,.36)', w2: 'rgba(255,255,255,.24)', w3: 'rgba(255,255,255,.15)' },
} as const;

export function Motifs({ x, y, w, h, terrain }: { x: number; y: number; w: number; h: number; terrain: TerrainCode }) {
  const X = (p: number) => x + (p / 100) * w;
  const Y = (p: number) => y + (p / 100) * h;
  const wp = (d: number) => (d / 100) * w;
  const hp = (d: number) => (d / 100) * h;
  const tri = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, fill: string, key?: string | number) => (
    <polygon key={key} points={`${X(ax)},${Y(ay)} ${X(bx)},${Y(by)} ${X(cx)},${Y(cy)}`} fill={fill} />
  );
  const poly = (pts: Array<[number, number]>, fill: string, key?: string | number) => (
    <polygon key={key} points={pts.map(([px, py]) => `${X(px)},${Y(py)}`).join(' ')} fill={fill} />
  );

  switch (terrain) {
    case 'F': {
      // Dichter Nadelwald + Baumstamm-Stapel. Feine dunkle Kontur, damit die Umrisse
      // sich vom Feldgrün abheben (kaum sichtbar).
      const pine = (cx: number, base: number, s: number, key: string) => {
        const tw = 2.2 * s, fw = 12 * s;
        const sw = Math.max(0.4, wp(0.35));
        const t = (ax: number, ay: number, bx: number, by: number, cx2: number, cy2: number, fill: string, k: string) => (
          <polygon key={k} points={`${X(ax)},${Y(ay)} ${X(bx)},${Y(by)} ${X(cx2)},${Y(cy2)}`} fill={fill} stroke="rgba(0,0,0,0.38)" strokeWidth={sw} strokeLinejoin="round" />
        );
        return (
          <g key={key}>
            <rect x={X(cx - tw)} y={Y(base)} width={wp(2 * tw)} height={hp(7 * s)} fill={ART.F.trunk} />
            {t(cx, base - 30 * s, cx - fw, base, cx + fw, base, ART.F.d, 'd')}
            {t(cx, base - 37 * s, cx - fw * 0.82, base - 10 * s, cx + fw * 0.82, base - 10 * s, ART.F.m, 'm')}
            {t(cx, base - 43 * s, cx - fw * 0.6, base - 21 * s, cx + fw * 0.6, base - 21 * s, ART.F.l, 'l')}
          </g>
        );
      };
      const log = (cx: number, cy: number, len: number, key: string) => (
        <g key={key}>
          <rect x={X(cx - len)} y={Y(cy)} width={wp(2 * len)} height={hp(5)} rx={hp(2.5)} fill={ART.F.log} />
          <ellipse cx={X(cx - len)} cy={Y(cy + 2.5)} rx={wp(2.4)} ry={hp(2.6)} fill={ART.F.logEnd} />
        </g>
      );
      return (
        <>
          {/* hintere Reihe klein/dunkel — tiefer + kleiner, damit die Spitzen im Feld bleiben */}
          {pine(24, 45, 0.5, 'b1')}
          {pine(39, 43, 0.52, 'b2')}
          {pine(54, 44, 0.5, 'b3')}
          {pine(69, 45, 0.52, 'b4')}
          {pine(82, 47, 0.46, 'b5')}
          {/* vordere Reihe groß/hell */}
          {pine(30, 60, 0.95, 'f1')}
          {pine(64, 62, 1.0, 'f2')}
          {/* Baumstamm-Stapel (unten-links neben der Zahl) */}
          {log(21, 63, 8, 'l1')}
          {log(23, 68, 7, 'l2')}
        </>
      );
    }
    case 'H': {
      // Lehmgrube mit Holzkran + Haufen rechteckiger Ziegel (mit Shading)
      const brick = (lx: number, ty: number, bw: number, bh: number, key: string) => {
        const dx = bw * 0.34, dy = bh * 0.8;
        return (
          <g key={key}>
            <rect x={X(lx)} y={Y(ty)} width={wp(bw)} height={hp(bh)} fill={ART.H.front} />
            <polygon points={`${X(lx)},${Y(ty)} ${X(lx + dx)},${Y(ty - dy)} ${X(lx + bw + dx)},${Y(ty - dy)} ${X(lx + bw)},${Y(ty)}`} fill={ART.H.top} />
            <polygon points={`${X(lx + bw)},${Y(ty)} ${X(lx + bw + dx)},${Y(ty - dy)} ${X(lx + bw + dx)},${Y(ty + bh - dy)} ${X(lx + bw)},${Y(ty + bh)}`} fill={ART.H.side} />
          </g>
        );
      };
      // Holzbalken (dunkle Kante + Kern)
      const beam = (x1: number, y1: number, x2: number, y2: number, wd: number, key: string) => (
        <g key={key}>
          <line x1={X(x1)} y1={Y(y1)} x2={X(x2)} y2={Y(y2)} stroke={ART.H.woodD} strokeWidth={Math.max(1.4, wp(wd + 0.7))} strokeLinecap="round" />
          <line x1={X(x1)} y1={Y(y1)} x2={X(x2)} y2={Y(y2)} stroke={ART.H.wood} strokeWidth={Math.max(1, wp(wd))} strokeLinecap="round" />
        </g>
      );
      return (
        <>
          {/* Lehmgrube (terrassiert) */}
          <ellipse cx={X(58)} cy={Y(37)} rx={wp(21)} ry={hp(11)} fill={ART.H.pitMid} />
          <ellipse cx={X(58)} cy={Y(38)} rx={wp(14.5)} ry={hp(7)} fill={ART.H.pitD} />
          <ellipse cx={X(58)} cy={Y(39)} rx={wp(8)} ry={hp(3.8)} fill={ART.H.pitDD} />
          <path d={`M ${X(39)} ${Y(31)} Q ${X(58)} ${Y(23)} ${X(77)} ${Y(31)}`} stroke={ART.H.rim} strokeWidth={Math.max(1, wp(1.2))} fill="none" opacity={0.6} />
          {/* Holzkran */}
          {beam(31, 47, 31, 17, 2.2, 'mast')}
          {beam(31, 19, 58, 13, 1.8, 'jib')}
          {beam(31, 21, 41, 46, 1.6, 'brace')}
          {beam(25, 47, 42, 47, 2, 'foot')}
          <circle cx={X(58)} cy={Y(13)} r={wp(1.6)} fill={ART.H.woodL} stroke={ART.H.woodD} strokeWidth={Math.max(0.5, wp(0.5))} />
          <line x1={X(58)} y1={Y(14.6)} x2={X(58)} y2={Y(30)} stroke={ART.H.rope} strokeWidth={Math.max(0.6, wp(0.6))} />
          {/* Eimer mit Lehm über der Grube */}
          <polygon points={`${X(54.5)},${Y(30)} ${X(61.5)},${Y(30)} ${X(60)},${Y(35.5)} ${X(56)},${Y(35.5)}`} fill={ART.H.wood} stroke={ART.H.woodD} strokeWidth={Math.max(0.5, wp(0.5))} />
          <ellipse cx={X(58)} cy={Y(30.5)} rx={wp(3.4)} ry={hp(1.4)} fill={ART.H.pitDD} />
          {/* Ziegelhaufen links neben der Zahl (rechteckig, geschichtet) */}
          {brick(12, 68, 8, 3.8, 'b1')}
          {brick(20.5, 68, 8, 3.8, 'b2')}
          {brick(14.5, 63.6, 8, 3.8, 'b3')}
          {brick(23, 63.6, 7, 3.8, 'b4')}
          {brick(12.5, 59.2, 8, 3.8, 'b5')}
        </>
      );
    }
    case 'P': {
      // Weide mit Schafen + Grasbüschel
      const sheep = (cx: number, cy: number, s: number, faceLeft: boolean, key: string) => {
        const dir = faceLeft ? -1 : 1;
        const bw = 11 * s, bh = 7.5 * s;
        const hx = cx + dir * bw * 0.95, hy = cy - bh * 0.1;
        return (
          <g key={key}>
            <rect x={X(cx - bw * 0.5)} y={Y(cy + bh * 0.45)} width={wp(1.8 * s)} height={hp(7 * s)} fill={ART.P.face} />
            <rect x={X(cx + bw * 0.2)} y={Y(cy + bh * 0.45)} width={wp(1.8 * s)} height={hp(7 * s)} fill={ART.P.face} />
            <ellipse cx={X(cx)} cy={Y(cy)} rx={wp(bw)} ry={hp(bh)} fill={ART.P.wool} />
            <circle cx={X(cx - bw * 0.55)} cy={Y(cy - bh * 0.5)} r={wp(4.2 * s)} fill={ART.P.wool} />
            <circle cx={X(cx)} cy={Y(cy - bh * 0.85)} r={wp(4.8 * s)} fill={ART.P.wool} />
            <circle cx={X(cx + bw * 0.55)} cy={Y(cy - bh * 0.5)} r={wp(4.2 * s)} fill={ART.P.wool} />
            <ellipse cx={X(hx)} cy={Y(hy)} rx={wp(4.4 * s)} ry={hp(5.2 * s)} fill={ART.P.face} />
            <ellipse cx={X(hx + dir * 2 * s)} cy={Y(hy - 3.4 * s)} rx={wp(1.9 * s)} ry={hp(2.6 * s)} fill={ART.P.face} />
            <circle cx={X(hx + dir * 1.4 * s)} cy={Y(hy - 0.4 * s)} r={wp(1.1 * s)} fill="#fff" opacity={0.9} />
          </g>
        );
      };
      const grass = (cx: number, base: number, key: string) => (
        <g key={key}>
          {tri(cx - 3, base, cx - 1, base - 8, cx + 1, base, ART.P.grassD)}
          {tri(cx, base, cx + 2, base - 9, cx + 4, base, ART.P.grass)}
        </g>
      );
      return (
        <>
          {grass(16, 60, 'g1')}
          {grass(80, 58, 'g2')}
          {grass(50, 70, 'g3')}
          {sheep(33, 37, 0.9, true, 's1')}
          {sheep(66, 41, 0.82, false, 's2')}
          {sheep(50, 58, 0.62, true, 's3')}
        </>
      );
    }
    case 'G': {
      // Getreidefeld: Furchen + stehende Weizenhalme mit klaren Ähren
      const furrow = (yy: number, key: string) => (
        <path key={key} d={`M ${X(16)} ${Y(yy)} Q ${X(38)} ${Y(yy - 3)} ${X(60)} ${Y(yy)} T ${X(88)} ${Y(yy)}`} stroke={ART.G.furrow} strokeWidth={Math.max(1, wp(1.4))} fill="none" strokeLinecap="round" opacity={0.5} />
      );
      const ear = (cx: number, top: number, len: number, key: string) => {
        const mid = top + len / 2, hw = 3.6;
        return (
          <g key={key}>
            <path d={`M ${X(cx)} ${Y(top)} Q ${X(cx + hw)} ${Y(mid)} ${X(cx)} ${Y(top + len)} Q ${X(cx - hw)} ${Y(mid)} ${X(cx)} ${Y(top)} Z`} fill={ART.G.ear} />
            {[0, 1, 2, 3].map((i) => {
              const yy = top + len * (0.22 + i * 0.19);
              return <path key={i} d={`M ${X(cx - hw * 0.72)} ${Y(yy)} Q ${X(cx)} ${Y(yy - len * 0.09)} ${X(cx + hw * 0.72)} ${Y(yy)}`} stroke={ART.G.kernel} strokeWidth={Math.max(0.5, wp(0.6))} fill="none" />;
            })}
            <ellipse cx={X(cx - 0.9)} cy={Y(mid - len * 0.12)} rx={wp(0.9)} ry={hp(2)} fill={ART.G.earLt} opacity={0.75} />
            {[-1.7, 0, 1.7].map((dx, i) => (
              <line key={`aw${i}`} x1={X(cx)} y1={Y(top)} x2={X(cx + dx)} y2={Y(top - 5)} stroke={ART.G.stalk} strokeWidth={Math.max(0.5, wp(0.5))} strokeLinecap="round" />
            ))}
          </g>
        );
      };
      const stalk = (baseX: number, base: number, topX: number, headTop: number, key: string) => {
        const len = (base - headTop) * 0.4;
        return (
          <g key={key}>
            <line x1={X(baseX)} y1={Y(base)} x2={X(topX)} y2={Y(headTop + len * 0.55)} stroke={ART.G.stalk} strokeWidth={Math.max(1, wp(1.3))} strokeLinecap="round" />
            {ear(topX, headTop, len, `${key}e`)}
          </g>
        );
      };
      return (
        <>
          {furrow(62, 'fr1')}
          {furrow(68, 'fr2')}
          {furrow(74, 'fr3')}
          {stalk(38, 54, 34, 21, 's1')}
          {stalk(50, 56, 50, 13, 's2')}
          {stalk(62, 54, 66, 21, 's3')}
        </>
      );
    }
    case 'M': {
      // Gebirge mit Schneekappen + Erz-Lore
      const cart = (cx: number, cy: number, s: number, key: string) => {
        const body: Array<[number, number]> = [[cx - 8 * s, cy - 5 * s], [cx + 8 * s, cy - 5 * s], [cx + 6 * s, cy + 4 * s], [cx - 6 * s, cy + 4 * s]];
        return (
          <g key={key}>
            {[-4, -1, 2].map((dx, i) => (
              <circle key={i} cx={X(cx + dx * s * 2)} cy={Y(cy - 6 * s)} r={wp(2.4 * s)} fill={i % 2 ? ART.M.oreLt : ART.M.ore} />
            ))}
            {poly(body, ART.M.cart)}
            <polygon points={body.map(([px, py]) => `${X(px)},${Y(py)}`).join(' ')} fill="none" stroke={ART.M.cartD} strokeWidth={Math.max(0.8, wp(0.8))} />
            <circle cx={X(cx - 4.5 * s)} cy={Y(cy + 5 * s)} r={wp(2.2 * s)} fill={ART.M.wheel} />
            <circle cx={X(cx + 4.5 * s)} cy={Y(cy + 5 * s)} r={wp(2.2 * s)} fill={ART.M.wheel} />
          </g>
        );
      };
      return (
        <>
          {/* hinterer Gipfel */}
          {tri(30, 24, 10, 60, 50, 60, ART.M.d)}
          {tri(30, 24, 22, 38, 38, 38, ART.M.snow)}
          {/* Hauptgipfel */}
          {tri(62, 16, 36, 60, 90, 60, ART.M.m)}
          {tri(62, 16, 36, 60, 62, 60, ART.M.d)}
          {tri(62, 16, 52, 32, 72, 32, ART.M.snow)}
          {poly([[62, 16], [56, 32], [62, 32]], ART.M.l, 'hl')}
          {/* Erz-Lore vorne (unten-links neben der Zahl) */}
          {cart(21, 64, 0.9, 'cart')}
        </>
      );
    }
    case 'D': {
      // Wüste: Dünen + Kakteen + ein paar Felsen
      const rock = (cx: number, base: number, s: number, key: string) => (
        <g key={key}>
          {poly([[cx - 5 * s, base], [cx - 3.5 * s, base - 4.5 * s], [cx + 1 * s, base - 5.5 * s], [cx + 4 * s, base - 3 * s], [cx + 5 * s, base]], ART.D.rockD)}
          {poly([[cx - 3.5 * s, base - 4.5 * s], [cx + 1 * s, base - 5.5 * s], [cx - 0.5 * s, base - 2.5 * s], [cx - 2.5 * s, base - 2 * s]], ART.D.rockL)}
        </g>
      );
      const cactus = (cx: number, base: number, s: number, key: string) => {
        const bw = 3.4 * s, bh = 20 * s, top = base - bh;
        const armW = Math.max(1.6, wp(3.2 * s));
        const armWd = armW + Math.max(0.8, wp(0.7));
        const arms = [
          `M ${X(cx)} ${Y(base - bh * 0.5)} h ${-wp(5.5 * s)} v ${-hp(8 * s)}`,
          `M ${X(cx)} ${Y(base - bh * 0.34)} h ${wp(4.8 * s)} v ${-hp(6 * s)}`,
        ];
        return (
          <g key={key}>
            {arms.map((d, i) => <path key={`ad${i}`} d={d} fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth={armWd} strokeLinecap="round" strokeLinejoin="round" />)}
            {arms.map((d, i) => <path key={`a${i}`} d={d} fill="none" stroke={ART.D.cactus} strokeWidth={armW} strokeLinecap="round" strokeLinejoin="round" />)}
            <rect x={X(cx - bw)} y={Y(top)} width={wp(2 * bw)} height={hp(bh)} rx={wp(bw)} fill={ART.D.cactus} stroke="rgba(0,0,0,0.28)" strokeWidth={Math.max(0.4, wp(0.4))} />
            <rect x={X(cx - bw * 0.35)} y={Y(top + bh * 0.1)} width={wp(bw * 0.7)} height={hp(bh * 0.8)} rx={wp(bw * 0.35)} fill={ART.D.cactusD} opacity={0.32} />
          </g>
        );
      };
      return (
        <>
          <path d={`M ${X(10)} ${Y(58)} Q ${X(40)} ${Y(46)} ${X(70)} ${Y(58)} Z`} fill={ART.D.duneL} opacity={0.5} />
          <path d={`M ${X(40)} ${Y(68)} Q ${X(66)} ${Y(54)} ${X(92)} ${Y(68)} Z`} fill={ART.D.duneD} opacity={0.45} />
          {rock(72, 58, 1.0, 'r1')}
          {rock(16, 60, 0.85, 'r2')}
          {rock(52, 66, 1.2, 'r3')}
          {cactus(50, 41, 0.95, 'c1')}
          {cactus(23, 52, 0.78, 'c2')}
          {cactus(80, 46, 0.66, 'c3')}
          {cactus(37, 60, 0.6, 'c4')}
        </>
      );
    }
    case 'W': {
      const wave = (yy: number, op: string, key: string) => (
        <path key={key} d={`M ${X(20)} ${Y(yy)} Q ${X(30)} ${Y(yy - 4)} ${X(40)} ${Y(yy)} T ${X(60)} ${Y(yy)} T ${X(80)} ${Y(yy)}`} stroke={op} strokeWidth={Math.max(1, wp(2))} fill="none" strokeLinecap="round" />
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
