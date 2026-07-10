// Zufälliger Vorschlags-Spielername für den Start-Screen.
// Kosmetisch (kein Spielzustand) → bewusst Math.random statt der deterministischen RNG.
// Siedler-thematisch; bewusst keine echten Personennamen (keine privaten Infos).

const ADJEKTIVE = [
  'Flink', 'Weise', 'Kühn', 'Listig', 'Tapfer', 'Ruhig', 'Wild', 'Edel',
  'Schlau', 'Emsig', 'Golden', 'Silbern', 'Mutig', 'Fleißig', 'Wacker', 'Kess',
] as const;

const SUBSTANTIVE = [
  'Siedler', 'Baumeister', 'Händler', 'Ritter', 'Hirte', 'Fischer', 'Räuber',
  'Fürst', 'Pionier', 'Wanderer', 'Schmied', 'Fuchs', 'Wolf', 'Bär', 'Falke', 'Rabe',
] as const;

/**
 * Erzeugt einen zufälligen Anzeigenamen wie „FlinkFuchs42".
 * Länge stets ≤ 20 (passt zum maxLength des Namensfelds).
 */
export function randomName(): string {
  const adj = ADJEKTIVE[Math.floor(Math.random() * ADJEKTIVE.length)];
  const sub = SUBSTANTIVE[Math.floor(Math.random() * SUBSTANTIVE.length)];
  const num = Math.floor(Math.random() * 90) + 10; // 10..99, senkt Kollisionen in der Lobby
  return `${adj}${sub}${num}`;
}
