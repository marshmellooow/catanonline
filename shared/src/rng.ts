// Deterministischer, seed-basierter PRNG (mulberry32).
// Gleicher Seed + gleiche Aufrufe → gleiche Zahlenfolge. Dadurch sind
// Würfelwürfe, Deck-Shuffle und Zufallskarten reproduzierbar und der
// autoritative Server kann jede Partie exakt nachrechnen.

export type RngState = { s: number };

export function createRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** Nächste Gleitkommazahl in [0,1). Mutiert den RNG-State. */
export function nextFloat(rng: RngState): number {
  let t = (rng.s += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Ganzzahl in [0, maxExclusive). */
export function nextInt(rng: RngState, maxExclusive: number): number {
  return Math.floor(nextFloat(rng) * maxExclusive);
}

/** Ein W6 (1..6). */
export function rollDie(rng: RngState): number {
  return nextInt(rng, 6) + 1;
}

/** Fisher-Yates-Shuffle (deterministisch, verändert eine Kopie). */
export function shuffle<T>(rng: RngState, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = nextInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Zufälliges Element (oder undefined bei leerem Array). */
export function pick<T>(rng: RngState, arr: readonly T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[nextInt(rng, arr.length)];
}
