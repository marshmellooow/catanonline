// Design-System — exakt aus README.md / Hex Game Design v2.dc.html portiert.
// Alle Farben, Motive und Geometrie-Konstanten. Wird von Client (Rendering)
// und Server (Terrain→Rohstoff-Mapping) genutzt.

export type TerrainCode = 'F' | 'H' | 'P' | 'G' | 'M' | 'D' | 'W';
export type ResourceType = 'wood' | 'brick' | 'wool' | 'grain' | 'ore';

export const RESOURCES: ResourceType[] = ['wood', 'brick', 'wool', 'grain', 'ore'];

export const RESOURCE_LABEL: Record<ResourceType, string> = {
  wood: 'Holz',
  brick: 'Lehm',
  wool: 'Wolle',
  grain: 'Getreide',
  ore: 'Erz',
};

/** Terrain → produzierter Rohstoff (Wüste/Wasser: keiner). */
export const TERRAIN_RESOURCE: Record<TerrainCode, ResourceType | null> = {
  F: 'wood',
  H: 'brick',
  P: 'wool',
  G: 'grain',
  M: 'ore',
  D: null,
  W: null,
};

export interface TerrainDef {
  name: string;
  res: string;
  light: string;
  base: string;
  edge: string;
  side: string;
  patImg: string;
  patSize: string;
}

export const TERRAIN: Record<TerrainCode, TerrainDef> = {
  F: { name: 'Wald', res: 'Holz', light: '#5CB268', base: '#3F9150', edge: '#EAD189', side: '#275C34', patImg: 'radial-gradient(circle, rgba(0,0,0,.22) 0 3px, transparent 4px)', patSize: '24px 21px' },
  H: { name: 'Hügel', res: 'Lehm', light: '#E58A54', base: '#D4643A', edge: '#EAD189', side: '#93401F', patImg: 'repeating-linear-gradient(0deg, rgba(0,0,0,.14) 0 3px, transparent 3px 15px)', patSize: 'auto' },
  P: { name: 'Weide', res: 'Wolle', light: '#AFD968', base: '#93C24C', edge: '#EAD189', side: '#5F8A2C', patImg: 'radial-gradient(circle, rgba(255,255,255,.30) 0 2px, transparent 3px)', patSize: '18px 15px' },
  G: { name: 'Feld', res: 'Getreide', light: '#F6C954', base: '#ECB23C', edge: '#EAD189', side: '#A97F22', patImg: 'repeating-linear-gradient(90deg, rgba(0,0,0,.10) 0 3px, transparent 3px 13px)', patSize: 'auto' },
  M: { name: 'Gebirge', res: 'Erz', light: '#B4BCBE', base: '#97A0A2', edge: '#EAD189', side: '#626A6C', patImg: 'repeating-linear-gradient(45deg, rgba(0,0,0,.12) 0 2px, transparent 2px 13px)', patSize: 'auto' },
  D: { name: 'Wüste', res: 'Kein Ertrag', light: '#EFE0AC', base: '#DECC8B', edge: '#F0E2B0', side: '#A6935E', patImg: 'radial-gradient(circle, rgba(0,0,0,.08) 0 2px, transparent 3px)', patSize: '30px 26px' },
  W: { name: 'Wasser', res: 'Nicht bebaubar', light: '#5AA5DC', base: '#4489C0', edge: '#7BBAE4', side: '#2A5F8C', patImg: 'repeating-linear-gradient(0deg, rgba(255,255,255,.10) 0 2px, transparent 2px 18px)', patSize: 'auto' },
};

export interface Motif {
  l: number; t: number; w: number; h: number; clip: string; rad: string; bg: string;
}

const TRI = 'polygon(50% 0%,100% 100%,0% 100%)';

export const MOTIFS: Record<TerrainCode, Motif[]> = {
  F: [
    { l: 26, t: 22, w: 20, h: 24, clip: TRI, rad: '0', bg: '#1F4D30' },
    { l: 46, t: 14, w: 24, h: 32, clip: TRI, rad: '0', bg: '#265C3A' },
    { l: 37, t: 36, w: 17, h: 19, clip: TRI, rad: '0', bg: '#1B4429' },
  ],
  H: [
    { l: 22, t: 32, w: 28, h: 16, clip: 'none', rad: '50% 50% 0 0', bg: '#9A4E2B' },
    { l: 46, t: 27, w: 32, h: 21, clip: 'none', rad: '50% 50% 0 0', bg: '#8A4526' },
    { l: 36, t: 40, w: 24, h: 12, clip: 'none', rad: '50% 50% 0 0', bg: '#A65A33' },
  ],
  P: [
    { l: 26, t: 28, w: 21, h: 13, clip: 'none', rad: '50%', bg: '#F2EFE4' },
    { l: 51, t: 36, w: 17, h: 11, clip: 'none', rad: '50%', bg: '#E6E0CB' },
  ],
  G: [
    { l: 32, t: 18, w: 5, h: 28, clip: 'none', rad: '99px', bg: '#B07F22' },
    { l: 44, t: 14, w: 5, h: 32, clip: 'none', rad: '99px', bg: '#A87718' },
    { l: 56, t: 18, w: 5, h: 28, clip: 'none', rad: '99px', bg: '#B07F22' },
  ],
  M: [
    { l: 18, t: 26, w: 34, h: 26, clip: TRI, rad: '0', bg: '#6B7178' },
    { l: 44, t: 18, w: 40, h: 34, clip: TRI, rad: '0', bg: '#787F87' },
    { l: 57, t: 18, w: 14, h: 11, clip: TRI, rad: '0', bg: '#E8ECEF' },
    { l: 28, t: 26, w: 14, h: 10, clip: TRI, rad: '0', bg: '#DDE2E6' },
  ],
  D: [
    { l: 16, t: 16, w: 30, h: 9, clip: 'none', rad: '50%', bg: '#C4AE6C' },
    { l: 56, t: 23, w: 26, h: 8, clip: 'none', rad: '50%', bg: '#BCA562' },
  ],
  W: [
    { l: 24, t: 28, w: 22, h: 4, clip: 'none', rad: '99px', bg: 'rgba(255,255,255,.30)' },
    { l: 50, t: 40, w: 20, h: 4, clip: 'none', rad: '99px', bg: 'rgba(255,255,255,.22)' },
    { l: 32, t: 54, w: 24, h: 4, clip: 'none', rad: '99px', bg: 'rgba(255,255,255,.26)' },
  ],
};

export interface PlayerColor {
  name: string;
  c: string;   // Fläche
  d: string;   // dunkel
  l: string;   // hell (color-mix c 70% white)
  c2: string;  // Dachfront (color-mix d 65% white)
}

const RAW_COLORS = [
  { name: 'Rot', c: '#C63D2F', d: '#8E2B21' },
  { name: 'Blau', c: '#2E6DA4', d: '#204D75' },
  { name: 'Orange', c: '#E67E22', d: '#A85A16' },
  { name: 'Weiß', c: '#EDE7D6', d: '#B0A88F' },
  { name: 'Grün', c: '#2E9E5B', d: '#1F6E3F' },
  { name: 'Braun', c: '#8B5A2B', d: '#5F3D1C' },
  { name: 'Violett', c: '#8E5AA8', d: '#644076' },
  { name: 'Türkis', c: '#2AA5A0', d: '#1B7370' },
  { name: 'Rosa', c: '#D4699B', d: '#9C4A70' },
  { name: 'Schwarz', c: '#3A4450', d: '#1C222A' },
];

export const PLAYER_COLORS: PlayerColor[] = RAW_COLORS.map((p) => ({
  ...p,
  l: `color-mix(in srgb, ${p.c} 70%, white)`,
  c2: `color-mix(in srgb, ${p.d} 65%, white)`,
}));

export const chipColor = (n: number): string => (n === 6 || n === 8 ? '#B03A2E' : '#1F5C3A');

/** Wahrscheinlichkeits-Pips einer Zahl: 6 − |7 − n|. */
export const pipCount = (n: number): number => 6 - Math.abs(7 - n);

// UI-Farben (README)
export const UI = {
  bg: 'radial-gradient(1200px 800px at 40% 20%, #17384C, #0D2230 70%)',
  textPrimary: '#E9E2D0',
  textSecondary: '#B9C6CC',
  textMuted: '#8FA5AF',
  panel: '#122C3C',
  dialog: '#0E2434',
  gold: '#EBC25E',
  goldShadow: '#B58E36',
  green: '#2E9E5B',
  greenLight: '#7FBF6C',
  red: '#C63D2F',
  sand: '#EAD189',
  chipBg: '#F8F2DE',
} as const;
