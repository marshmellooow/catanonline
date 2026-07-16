// Board-Aufbau: aus einer MapDef die vollständige Geometrie ableiten
// (Hexes, Ecken, Kanten, Nachbarschaften, Häfen) und Zahlen deterministisch
// aus dem Seed vergeben (Regel: 6 und 8 nie benachbart).

import type { Board, Hex, Corner, Edge, Port } from './types.js';
import type { TerrainCode } from './design.js';
import { getMap, type MapDef, type PortType } from './maps.js';
import { createRng, shuffle, nextInt, type RngState } from './rng.js';

const H_RATIO = 1.1547; // Höhe = Breite × 1.1547

interface CornerBuild extends Corner {}

/** Die 6 Vertex-Koordinaten eines spitz-oben-Hexagons (Bounding-Box x,y,w,h). */
function hexVertices(x: number, y: number, w: number, h: number): Array<[number, number]> {
  return [
    [x + w / 2, y], // 0 top
    [x + w, y + 0.25 * h], // 1 upper-right
    [x + w, y + 0.75 * h], // 2 lower-right
    [x + w / 2, y + h], // 3 bottom
    [x, y + 0.75 * h], // 4 lower-left
    [x, y + 0.25 * h], // 5 upper-left
  ];
}

const key = (px: number, py: number) => `${Math.round(px)}:${Math.round(py)}`;
const edgeKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

interface Geometry {
  hexes: Hex[];
  corners: Corner[];
  edges: Edge[];
  width: number;
  height: number;
  ports: Port[];
}

function buildGeometry(map: MapDef): Geometry {
  const hexW = map.hexW;
  const h = hexW * H_RATIO;
  const step = h * 0.75;

  const hexes: Hex[] = [];
  const corners: CornerBuild[] = [];
  const cornerByKey = new Map<string, number>();
  const edges: Edge[] = [];
  const edgeByKey = new Map<string, number>();
  let maxX = 0;
  let maxY = 0;

  const getCorner = (px: number, py: number): number => {
    const k = key(px, py);
    let id = cornerByKey.get(k);
    if (id === undefined) {
      id = corners.length;
      cornerByKey.set(k, id);
      corners.push({ id, x: Math.round(px), y: Math.round(py), hexes: [], edges: [], adjacent: [], portId: null });
    }
    return id;
  };

  const getEdge = (a: number, b: number): number => {
    const k = edgeKey(a, b);
    let id = edgeByKey.get(k);
    if (id === undefined) {
      id = edges.length;
      edgeByKey.set(k, id);
      const ca = corners[a];
      const cb = corners[b];
      edges.push({ id, a, b, x1: ca.x, y1: ca.y, x2: cb.x, y2: cb.y, hexes: [] });
      // Nachbarschaft der Ecken
      if (!ca.adjacent.includes(b)) ca.adjacent.push(b);
      if (!cb.adjacent.includes(a)) cb.adjacent.push(a);
      if (!ca.edges.includes(id)) ca.edges.push(id);
      if (!cb.edges.includes(id)) cb.edges.push(id);
    }
    return id;
  };

  map.rows.forEach((row, i) => {
    const offset = row.offset !== undefined ? row.offset : (i % 2) * 0.5;
    row.cells.forEach((cell, j) => {
      const code = cell[0] as TerrainCode;
      if ((code as string) === '.') return;
      const x = (j + offset) * hexW;
      const y = i * step;
      const hexId = hexes.length;
      const verts = hexVertices(x, y, w0(hexW), h);
      const cornerIds = verts.map(([px, py]) => getCorner(px, py));
      // Kanten (6 Seiten)
      const edgeIds: number[] = [];
      for (let k = 0; k < 6; k++) {
        const eId = getEdge(cornerIds[k], cornerIds[(k + 1) % 6]);
        edgeIds.push(eId);
      }
      const hex: Hex = {
        id: hexId,
        row: i,
        col: j,
        terrain: code,
        number: cell[1],
        x: Math.round(x),
        y: Math.round(y),
        w: hexW,
        h: Math.round(h),
        cx: Math.round(x + hexW / 2),
        cy: Math.round(y + h / 2),
        corners: cornerIds,
        neighbors: [],
      };
      hexes.push(hex);
      cornerIds.forEach((cid) => {
        if (!corners[cid].hexes.includes(hexId)) corners[cid].hexes.push(hexId);
      });
      edgeIds.forEach((eid) => {
        if (!edges[eid].hexes.includes(hexId)) edges[eid].hexes.push(hexId);
      });
      maxX = Math.max(maxX, x + hexW);
      maxY = Math.max(maxY, y + h);
    });
  });

  // Hex-Nachbarschaft: teilen sich ≥2 Ecken (also eine Kante)
  for (let a = 0; a < hexes.length; a++) {
    for (let b = a + 1; b < hexes.length; b++) {
      const shared = hexes[a].corners.filter((c) => hexes[b].corners.includes(c)).length;
      if (shared >= 2) {
        hexes[a].neighbors.push(b);
        hexes[b].neighbors.push(a);
      }
    }
  }

  // Häfen werden erst in buildBoard (seed-basiert, nach der finalen Wasser-Form) erzeugt.
  return { hexes, corners, edges, width: Math.ceil(maxX), height: Math.ceil(maxY), ports: [] };
}

// hexW als reine Breite (Helper, falls später Padding gewünscht)
const w0 = (w: number) => w;

/** Ausgewogenes Hafen-Typ-Multiset der Größe n (klassisch: 4× 3:1 : je 1× Rohstoff = 9).
 *  Hamilton/Größter-Rest → gleiche faire Anteile unabhängig von n; Positionen werden gemischt. */
function balancedPortTypes(n: number): PortType[] {
  const mix: Array<[PortType, number]> = [
    ['3:1', 4],
    ['wood', 1],
    ['brick', 1],
    ['wool', 1],
    ['grain', 1],
    ['ore', 1],
  ];
  const total = 9;
  const alloc = mix.map(([t, w]) => {
    const exact = (n * w) / total;
    const base = Math.floor(exact);
    return { t, count: base, frac: exact - base };
  });
  let assigned = alloc.reduce((s, a) => s + a.count, 0);
  const byFrac = alloc.map((_, i) => i).sort((i, j) => alloc[j].frac - alloc[i].frac);
  for (let k = 0; assigned < n; k++, assigned++) alloc[byFrac[k % byFrac.length]].count++;
  const out: PortType[] = [];
  for (const a of alloc) for (let c = 0; c < a.count; c++) out.push(a.t);
  return out;
}

/** Zufällige Küstenhäfen (seed-basiert) auf allen Wasser-Karten: verteilt rund um jede
 *  Land/Wasser-Grenze. Ein Hafen sitzt auf einer Küstenkante; seine 2 Eck-Endpunkte sind
 *  die baubaren Anleger. Greedy ohne geteilte Ecken → gestreut (nie zwei Häfen an einer
 *  Ecke). Reine Land-Karten (kein Wasser) bekommen keine Häfen. Deterministisch. */
function generatePorts(hexes: Hex[], corners: Corner[], edges: Edge[], rng: RngState): Port[] {
  const isWater = (hid: number) => hexes[hid].terrain === 'W';
  if (!hexes.some((h) => h.terrain === 'W')) return [];

  // Kandidaten: Kanten genau an der Land/Wasser-Grenze (1 Land- + 1 Wasser-Hex)
  const candidates = edges
    .filter((e) => e.hexes.length === 2 && e.hexes.filter(isWater).length === 1)
    .map((e) => {
      const wid = e.hexes.find(isWater)!;
      const wh = hexes[wid];
      const ca = corners[e.a];
      const cb = corners[e.b];
      const midX = (ca.x + cb.x) / 2;
      const midY = (ca.y + cb.y) / 2;
      return {
        a: e.a,
        b: e.b,
        waterHex: wid,
        // Plakette sitzt genau in der MITTE des Wasser-Hexes; von dort führen Holzstege
        // zu den 2 Anleger-Ecken (siehe PortMark). Max. 1 Hafen je Wasser-Hex ⇒ nie Überlappung.
        x: Math.round(wh.cx),
        y: Math.round(wh.cy),
        deg: Math.round((Math.atan2(wh.cy - midY, wh.cx - midX) * 180) / Math.PI),
      };
    });
  if (!candidates.length) return [];

  const landCount = hexes.filter((h) => h.terrain !== 'W').length;
  const target = Math.max(4, Math.round(landCount / 4.5)); // eher sparsam (auf großen Karten sonst zu viele Häfen)
  const order = shuffle(rng, candidates);
  const usedCorners = new Set<number>();
  const usedWater = new Set<number>();
  const chosen: typeof candidates = [];
  for (const c of order) {
    if (chosen.length >= target) break;
    // Streuung: höchstens EIN Hafen je Wasser-Hex (sonst stapeln sich die Plaketten,
    // da alle zur selben Hex-Mitte gerückt werden) UND keine zwei Häfen an derselben Ecke.
    if (usedWater.has(c.waterHex) || usedCorners.has(c.a) || usedCorners.has(c.b)) continue;
    usedWater.add(c.waterHex);
    usedCorners.add(c.a);
    usedCorners.add(c.b);
    chosen.push(c);
  }
  const types = shuffle(rng, balancedPortTypes(chosen.length));
  return chosen.map((c, idx): Port => {
    corners[c.a].portId = idx;
    corners[c.b].portId = idx;
    return { id: idx, type: types[idx], x: c.x, y: c.y, deg: c.deg, corners: [c.a, c.b] };
  });
}

/** Zwei Landfelder sind per Straße verbindbar, wenn sie mindestens eine Ecke teilen. */
function landCornerAdjacency(hexes: Hex[], corners: Corner[]): Map<number, Set<number>> {
  const isLand = (id: number) => hexes[id].terrain !== 'W';
  const adj = new Map<number, Set<number>>();
  const link = (a: number, b: number) => {
    (adj.get(a) ?? adj.set(a, new Set()).get(a)!).add(b);
    (adj.get(b) ?? adj.set(b, new Set()).get(b)!).add(a);
  };
  for (const c of corners) {
    const landHere = c.hexes.filter(isLand);
    for (let i = 0; i < landHere.length; i++) for (let j = i + 1; j < landHere.length; j++) link(landHere[i], landHere[j]);
  }
  return adj;
}

/** Konnektivität sichern: isolierte Land-Inseln (kein Straßen-Weg zum Rest) zu Wasser
 *  machen, damit nie ein Feld unerreichbar strandet. */
function repairConnectivity(hexes: Hex[], corners: Corner[]): void {
  const isLand = (id: number) => hexes[id].terrain !== 'W';
  const adj = landCornerAdjacency(hexes, corners);
  const seen = new Set<number>();
  const comps: number[][] = [];
  for (const h of hexes) {
    if (!isLand(h.id) || seen.has(h.id)) continue;
    const comp: number[] = [];
    const stack = [h.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      comp.push(id);
      for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) stack.push(nb);
    }
    comps.push(comp);
  }
  if (comps.length <= 1) return;
  comps.sort((a, b) => b.length - a.length);
  // alles außer der größten zusammenhängenden Landfläche zu Wasser
  for (let i = 1; i < comps.length; i++) for (const id of comps[i]) hexes[id].terrain = 'W';
}

/** Terrain über alle Landfelder neu mischen (Wasser-Form + Rohstoff-Multiset bleiben,
 *  Zahlen zurückgesetzt) und dabei **streuen**: eine lokale Suche minimiert gleichfarbige
 *  Nachbarschaften, damit keine großen einfarbigen Blöcke entstehen (v. a. auf großen
 *  Karten). Weiterhin zufällig — nur eben verteilt. Deterministisch (seed-basiert). */
// Rohstoff-Mischung wie im offiziellen Catan (4:4:4:3:3) → ausgewogen, Getreide nicht dominant.
const RESOURCE_MIX: Array<[TerrainCode, number]> = [
  ['G', 4], // Getreide
  ['F', 4], // Holz
  ['P', 4], // Wolle
  ['H', 3], // Lehm
  ['M', 3], // Erz
];
const MIX_TOTAL = 18; // 4+4+4+3+3

/**
 * Deterministisches, ausgewogenes Rohstoff-Multiset der Größe n (Hamilton/Größter-Rest-Verfahren).
 * Nur von n abhängig (nicht vom Seed) — jede Karte hat jede Partie dieselben, fairen Anteile,
 * nur die Positionen werden gemischt. Basis-/Klassik-19 ergibt exakt 4/4/4/3/3.
 */
function balancedResources(n: number): TerrainCode[] {
  const alloc = RESOURCE_MIX.map(([t, w]) => {
    const exact = (n * w) / MIX_TOTAL;
    const base = Math.floor(exact);
    return { t, count: base, frac: exact - base };
  });
  let assigned = alloc.reduce((s, a) => s + a.count, 0);
  const byFrac = alloc.map((_, i) => i).sort((i, j) => alloc[j].frac - alloc[i].frac);
  for (let k = 0; assigned < n; k++, assigned++) alloc[byFrac[k % byFrac.length]].count++;
  const out: TerrainCode[] = [];
  for (const a of alloc) for (let c = 0; c < a.count; c++) out.push(a.t);
  return out;
}

function shuffleTerrain(hexes: Hex[], rng: RngState): void {
  const landHexes = hexes.filter((h) => h.terrain !== 'W');
  const landIds = landHexes.map((h) => h.id);

  // Ausgewogenes Rohstoff-Multiset (statt der lopsided Kartenvorlage), Wüstenzahl beibehalten,
  // dann zufällig auf die Landfelder verteilen. Positionen werden unten weiter entklumpt.
  const desertCount = landHexes.filter((h) => h.terrain === 'D').length;
  const resN = landHexes.length - desertCount;
  const pool: TerrainCode[] = [...balancedResources(resN), ...Array<TerrainCode>(desertCount).fill('D')];
  const terrains = shuffle(rng, pool);
  landHexes.forEach((h, i) => {
    h.terrain = terrains[i];
    h.number = null;
  });
  if (landIds.length < 3) return;

  // Nur Land-Nachbarn zählen (Wasser ist kein „gleiches Terrain")
  const landNbrs = new Map<number, number[]>();
  for (const id of landIds) landNbrs.set(id, hexes[id].neighbors.filter((nb) => hexes[nb].terrain !== 'W'));

  // Anzahl gleichfarbiger Nachbarn eines Feldes
  const conflicts = (id: number): number => {
    const t = hexes[id].terrain;
    let c = 0;
    for (const nb of landNbrs.get(id)!) if (hexes[nb].terrain === t) c++;
    return c;
  };

  // Lokale Suche: zwei verschieden-farbige Felder tauschen, wenn das die (lokalen)
  // gleichfarbigen Nachbarschaften verringert. Monoton besser → wenige große Blöcke.
  const maxIter = landIds.length * 80;
  const stopAfter = landIds.length * 6; // abbrechen, wenn lange keine Verbesserung
  let sinceImprove = 0;
  for (let it = 0; it < maxIter && sinceImprove < stopAfter; it++) {
    const a = landIds[nextInt(rng, landIds.length)];
    // Ein Feld ohne gleichfarbige Nachbarn muss nicht getauscht werden
    if (conflicts(a) === 0) { sinceImprove++; continue; }
    const b = landIds[nextInt(rng, landIds.length)];
    if (a === b || hexes[a].terrain === hexes[b].terrain) { sinceImprove++; continue; }

    const affected = new Set<number>([a, b]);
    for (const nb of landNbrs.get(a)!) affected.add(nb);
    for (const nb of landNbrs.get(b)!) affected.add(nb);
    let before = 0;
    for (const id of affected) before += conflicts(id);

    const ta = hexes[a].terrain;
    hexes[a].terrain = hexes[b].terrain;
    hexes[b].terrain = ta;

    let after = 0;
    for (const id of affected) after += conflicts(id);

    if (after < before) {
      sinceImprove = 0;
    } else {
      // Verschlechterung/gleich → zurücktauschen
      const tb = hexes[a].terrain;
      hexes[a].terrain = hexes[b].terrain;
      hexes[b].terrain = tb;
      sinceImprove++;
    }
  }
}

/** Zahlen vergeben: 6 & 8 nie auf (kanten-)benachbarten Feldern.
 *  Konstruktiv: die „heißen" Zahlen (6/8) auf ein unabhängiges Hex-Set legen,
 *  dann ist die Regel garantiert erfüllt (statt Zufall-mit-Wiederholung). */
function assignNumbers(hexes: Hex[], rng: RngState): void {
  const numberHexes = hexes.filter((hx) => hx.terrain !== 'W' && hx.terrain !== 'D');
  if (numberHexes.length === 0) return;

  const pool = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11, 12, 8, 10, 5, 4, 9, 5, 9, 12, 3, 2, 6];
  const numbers = shuffle(rng, numberHexes.map((_, i) => pool[i % pool.length]));

  const isHot = (n: number) => n === 6 || n === 8;
  const hotNums = numbers.filter(isHot);
  const coldNums = numbers.filter((n) => !isHot(n));

  // Greedy: unabhängige Menge (paarweise nicht kanten-benachbart) für die heißen Zahlen
  const order = shuffle(rng, numberHexes.map((h) => h.id));
  const hotSet = new Set<number>();
  for (const id of order) {
    if (hotSet.size >= hotNums.length) break;
    if (hexes[id].neighbors.some((nb) => hotSet.has(nb))) continue;
    hotSet.add(id);
  }
  // Sollte das unabhängige Set (sehr selten) zu klein sein: mit beliebigen füllen
  for (const id of order) {
    if (hotSet.size >= hotNums.length) break;
    hotSet.add(id);
  }

  let hi = 0;
  let ci = 0;
  for (const hx of numberHexes) {
    hx.number = hotSet.has(hx.id) ? hotNums[hi++] : coldNums[ci++];
  }
}

/** Zufallskarte auf Basis der Klassik-Form (19 Felder) generieren. */
function randomClassic(rng: RngState): MapDef {
  const base = getMap('classic')!;
  // Standard-Verteilung: 4×F, 3×H, 4×P, 4×G, 3×M, 1×D
  const terr: TerrainCode[] = [
    ...Array(4).fill('F'),
    ...Array(3).fill('H'),
    ...Array(4).fill('P'),
    ...Array(4).fill('G'),
    ...Array(3).fill('M'),
    'D',
  ];
  const shuffledTerr = shuffle(rng, terr);
  let ti = 0;
  const rows = base.rows.map((row) => ({
    offset: row.offset,
    cells: row.cells.map((): [TerrainCode, number | null] => [shuffledTerr[ti++], null]),
  }));
  return { ...base, id: 'random', title: 'Zufallskarte', desc: 'Zufällig gemischte Klassik-Karte (6 & 8 nie benachbart).', rows };
}

/** Vollständiges Board aus mapId + seed. Deterministisch. */
export function buildBoard(mapId: string, seed: number): Board {
  const rng = createRng(seed ^ 0x9e3779b9);
  let map: MapDef | undefined;
  if (mapId === 'random') {
    map = randomClassic(rng);
  } else {
    map = getMap(mapId);
  }
  if (!map) throw new Error(`Unbekannte Karte: ${mapId}`);

  const geo = buildGeometry(map);
  repairConnectivity(geo.hexes, geo.corners); // isolierte Land-Inseln entfernen
  shuffleTerrain(geo.hexes, rng); // Terrain jede Partie neu mischen (Form bleibt)
  assignNumbers(geo.hexes, rng); // frische Zahlen (6/8 nie benachbart)
  geo.ports = generatePorts(geo.hexes, geo.corners, geo.edges, rng); // zufällige Küstenhäfen (Wasser-Karten)

  return {
    mapId,
    hexes: geo.hexes,
    corners: geo.corners,
    edges: geo.edges,
    ports: geo.ports,
    width: geo.width,
    height: geo.height,
    hexW: map.hexW,
  };
}

/** Anzahl zusammenhängender Landflächen (per Straße verbindbar = Ecken teilen).
 *  Für ein spielbares Board muss dies genau 1 sein. */
export function landComponentCount(board: Board): number {
  const isLand = (id: number) => board.hexes[id].terrain !== 'W';
  const adj = landCornerAdjacency(board.hexes, board.corners);
  const seen = new Set<number>();
  let comps = 0;
  for (const h of board.hexes) {
    if (!isLand(h.id) || seen.has(h.id)) continue;
    comps++;
    const stack = [h.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) stack.push(nb);
    }
  }
  return comps;
}

/** Start-Räuberfeld: die Wüste (oder Feld 0, falls keine). */
export function initialRobberHex(board: Board): number {
  const desert = board.hexes.find((hx) => hx.terrain === 'D');
  return desert ? desert.id : 0;
}
