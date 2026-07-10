import type { PublicState, ResourceType, PlayerColor } from '@catan/shared';
import { TERRAIN, PLAYER_COLORS, RESOURCE_LABEL } from '@catan/shared';

export const RES_TERRAIN: Record<ResourceType, keyof typeof TERRAIN> = {
  wood: 'F',
  brick: 'H',
  wool: 'P',
  grain: 'G',
  ore: 'M',
};

export const RESOURCE_ORDER: ResourceType[] = ['wood', 'brick', 'wool', 'grain', 'ore'];

export function resourceGradient(res: ResourceType): string {
  const t = TERRAIN[RES_TERRAIN[res]];
  return `radial-gradient(120% 100% at 35% 25%, ${t.light}, ${t.base} 75%)`;
}

export function resLabel(res: ResourceType): string {
  return RESOURCE_LABEL[res];
}

export function makeColorOf(game: PublicState | null): (playerId: string) => PlayerColor {
  const map = new Map<string, number>();
  game?.players.forEach((p) => map.set(p.id, p.colorIndex));
  return (playerId: string) => PLAYER_COLORS[map.get(playerId) ?? 0];
}

export const DEV_LABEL: Record<string, string> = {
  knight: 'Ritter',
  roadBuilding: 'Straßenbau',
  yearOfPlenty: 'Erfindung',
  monopoly: 'Monopol',
  victoryPoint: 'Siegpunkt',
};

export function phaseLabel(state: PublicState, you: string): string {
  const active = state.activePlayer;
  const yourTurn = active === you;
  const name = state.players.find((p) => p.id === active)?.name ?? '';
  switch (state.phase) {
    case 'setupSettlement':
      return yourTurn ? 'Setze deine Startsiedlung' : `${name} setzt eine Siedlung`;
    case 'setupRoad':
      return yourTurn ? 'Setze deine Startstraße' : `${name} setzt eine Straße`;
    case 'roll':
      return yourTurn ? 'Du bist dran — würfle!' : `${name} würfelt…`;
    case 'discard':
      return 'Karten abwerfen (7 gewürfelt)';
    case 'moveRobber':
      return yourTurn ? 'Versetze den Räuber' : `${name} versetzt den Räuber`;
    case 'steal':
      return yourTurn ? 'Wähle, wem du stiehlst' : `${name} stiehlt eine Karte`;
    case 'roadBuilding':
      return yourTurn ? 'Baue 2 Straßen (Straßenbau-Karte)' : `${name} baut Straßen`;
    case 'main':
      return yourTurn ? 'Bauen · Handeln · Zug beenden' : `${name} ist am Zug`;
    case 'finished':
      return 'Spiel beendet';
    default:
      return '';
  }
}
