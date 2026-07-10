// Karten-Layouts — exakt aus README.md.
// Zeile = Reihe; ungerade Reihen +0.5 versetzt (falls kein expliziter Offset).
// Zelle: [TerrainCode, number|null]. null → Zahl aus Pool/Zufall.

import type { TerrainCode } from './design.js';

export type PortType = '3:1' | 'wood' | 'brick' | 'wool' | 'grain' | 'ore';

export interface PortDef {
  r: number;
  c: number;
  type: PortType;
  deg: number; // Steg-Richtung
}

export interface MapDef {
  id: string;
  title: string;
  desc: string;
  minPlayers: number;
  maxPlayers: number;
  hexW: number;
  rows: Array<{ offset?: number; cells: Array<[TerrainCode, number | null]> }>;
  ports?: PortDef[];
}

/** Aus einem kompakten String eine Zellenreihe bauen (Zahlen aus Pool). */
function parseRow(s: string): Array<[TerrainCode, number | null]> {
  return s.split('').map((ch) => [ch as TerrainCode, null] as [TerrainCode, number | null]);
}

// Zahlen-Pool für Maps 2–5 (zyklisch auf Land ohne Wüste, Lesereihenfolge)
export const NUMBER_POOL = [
  5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11, 12, 8, 10, 5, 4, 9, 5, 9, 12, 3, 2, 6,
];

// Map 1 · Klassik — 19 Felder, offizielle Startaufstellung, explizite Offsets & Zahlen
const MAP1: MapDef = {
  id: 'classic',
  title: 'Map 1 · Klassik',
  desc: '19 Felder ohne Wasser, 3–4 Spieler. Offizielle Startaufstellung — 6 & 8 nie benachbart.',
  minPlayers: 2,
  maxPlayers: 4,
  hexW: 100,
  rows: [
    { offset: 1.0, cells: [['M', 10], ['P', 2], ['F', 9]] },
    { offset: 0.5, cells: [['G', 12], ['H', 6], ['P', 4], ['H', 10]] },
    { offset: 0.0, cells: [['G', 9], ['F', 11], ['D', null], ['F', 3], ['M', 8]] },
    { offset: 0.5, cells: [['F', 8], ['M', 3], ['G', 4], ['P', 5]] },
    { offset: 1.0, cells: [['H', 5], ['G', 6], ['P', 11]] },
  ],
};

// Map 2 · Küstenland — Insel mit Wasserrand + Binnensee
const MAP2: MapDef = {
  id: 'coast',
  title: 'Map 2 · Küstenland',
  desc: '30 Land-Felder als Insel mit Wasserrand und Binnensee, 4–5 Spieler.',
  minPlayers: 2,
  maxPlayers: 5,
  hexW: 88,
  rows: ['WWWWWWWWW', 'WWFGPWWMW', 'WFHGMPFWW', 'WGPDWFGHW', 'WMFGHPWGW', 'WWPMGFHWW', 'WWWFGPWWW', 'WWWWWWWWW'].map((s) => ({ cells: parseRow(s) })),
};

// Map 3 · Kontinent — 53 Felder, komplett Land
const MAP3: MapDef = {
  id: 'continent',
  title: 'Map 3 · Kontinent',
  desc: 'Riesenkarte: 53 Felder durchgehendes Land — alles bebaubar, kein Wasser. 6–10 Spieler.',
  minPlayers: 2,
  maxPlayers: 10,
  hexW: 76,
  rows: ['....GFPMG....', '...FHGPMGF...', '..GPMGFHGPF..', '.MGFHGPDGFMG.', '..FPGMHGFPG..', '...GFHPMGH...', '....PGFGM....'].map((s) => ({ cells: parseRow(s) })),
};

// Map 4 · Seenland — Kontinent mit Binnenseen
const MAP4: MapDef = {
  id: 'lakes',
  title: 'Map 4 · Seenland',
  desc: 'Kontinent mit verstreuten Binnenseen — kompakt, mit Engstellen. 4–6 Spieler.',
  minPlayers: 2,
  maxPlayers: 6,
  hexW: 84,
  rows: ['..FGPMG....', '.GHFWPMGF..', '.PMGFHWGPF.', '.GFWHGPDGM.', '..HPGFWGF..', '...GMHPG...'].map((s) => ({ cells: parseRow(s) })),
};

// Map 5 · Große Hafenkarte — 6–10 Spieler, 10 Häfen
const MAP5: MapDef = {
  id: 'harbor',
  title: 'Map 5 · Große Hafenkarte',
  desc: '42 Land-Felder mit Wasserrand und 10 Häfen. 6–10 Spieler.',
  minPlayers: 2,
  maxPlayers: 10,
  hexW: 88,
  rows: ['WWWWWWWWWWW', 'WWFGPMGFWWW', 'WGHFGPHMGWW', 'WPMGFHGPFGW', 'WGFPDGMHGWW', 'WWHGFPGFMWW', 'WWWGMHPWWWW', 'WWWWWWWWWWW'].map((s) => ({ cells: parseRow(s) })),
  ports: [
    { r: 0, c: 3, type: '3:1', deg: 90 },
    { r: 0, c: 6, type: 'wood', deg: 90 },
    { r: 1, c: 1, type: 'brick', deg: 0 },
    { r: 1, c: 8, type: '3:1', deg: 180 },
    { r: 2, c: 0, type: 'wool', deg: 0 },
    { r: 3, c: 10, type: '3:1', deg: 180 },
    { r: 4, c: 9, type: 'grain', deg: 180 },
    { r: 5, c: 1, type: 'wool', deg: 0 },
    { r: 6, c: 7, type: 'ore', deg: 180 },
    { r: 7, c: 4, type: '3:1', deg: -90 },
  ],
};

export const MAPS: MapDef[] = [MAP1, MAP2, MAP3, MAP4, MAP5];

export function getMap(id: string): MapDef | undefined {
  return MAPS.find((m) => m.id === id);
}
