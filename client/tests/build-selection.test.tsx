import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COSTS, PLAYER_COLORS, createGame, emptyResources, type Board as BoardT } from '@catan/shared';
import { Board } from '../src/components/board/Board';
import { CostDetails } from '../src/components/game/CostDetails';
import {
  actionForBuildSelection,
  adjacentLandHexIds,
  buildKindForContext,
  selectCornerBuild,
  selectEdgeBuild,
  type BuildSelection,
} from '../src/components/board/buildSelectionLogic';

function testBoard(): BoardT {
  return createGame({
    mapId: 'coast',
    seed: 42,
    vpTarget: 10,
    bankSize: 19,
    players: [
      { id: 'p1', name: 'Spieler Eins', colorIndex: 0, isBot: false },
      { id: 'p2', name: 'Spieler Zwei', colorIndex: 1, isBot: false },
    ],
  }).board;
}

function renderSelection(board: BoardT, selection: BuildSelection) {
  return renderToStaticMarkup(createElement(Board, {
    board,
    buildings: {},
    roads: {},
    robberHex: board.hexes.find((hex) => hex.terrain === 'D')?.id ?? 0,
    colorOf: () => PLAYER_COLORS[0],
    buildKind: selection.kind,
    buildSelection: selection,
    buildColor: PLAYER_COLORS[0],
    onConfirmBuild: () => undefined,
    onCancelBuild: () => undefined,
  }));
}

describe('Bauauswahl', () => {
  it('übersetzt jede passende Auswahl erst bei Bestätigung in die richtige Spielaktion', () => {
    expect(buildKindForContext('setupSettlement', null)).toBe('settlement');
    expect(buildKindForContext('setupRoad', null)).toBe('road');
    expect(buildKindForContext('roadBuilding', null)).toBe('road');
    expect(buildKindForContext('main', 'city')).toBe('city');

    expect(selectCornerBuild('setupSettlement', null, 7)).toEqual({ kind: 'settlement', corner: 7 });
    expect(selectCornerBuild('main', 'city', 8)).toEqual({ kind: 'city', corner: 8 });
    expect(selectEdgeBuild('setupRoad', null, 9)).toEqual({ kind: 'road', edge: 9 });
    expect(selectEdgeBuild('main', 'road', 10)).toEqual({ kind: 'road', edge: 10 });

    expect(actionForBuildSelection('setupSettlement', null, { kind: 'settlement', corner: 7 }))
      .toEqual({ type: 'placeSetupSettlement', corner: 7 });
    expect(actionForBuildSelection('setupRoad', null, { kind: 'road', edge: 9 }))
      .toEqual({ type: 'placeSetupRoad', edge: 9 });
    expect(actionForBuildSelection('roadBuilding', null, { kind: 'road', edge: 10 }))
      .toEqual({ type: 'buildRoad', edge: 10 });
    expect(actionForBuildSelection('main', 'road', { kind: 'road', edge: 10 }))
      .toEqual({ type: 'buildRoad', edge: 10 });
    expect(actionForBuildSelection('main', 'settlement', { kind: 'settlement', corner: 7 }))
      .toEqual({ type: 'buildSettlement', corner: 7 });
    expect(actionForBuildSelection('main', 'city', { kind: 'city', corner: 8 }))
      .toEqual({ type: 'buildCity', corner: 8 });
  });

  it('verwirft veraltete oder zum Zieltyp unpassende Auswahlen', () => {
    expect(selectCornerBuild('setupRoad', null, 7)).toBeNull();
    expect(selectEdgeBuild('setupSettlement', null, 9)).toBeNull();
    expect(actionForBuildSelection('main', 'road', { kind: 'city', corner: 8 })).toBeNull();
    expect(actionForBuildSelection('roll', null, { kind: 'settlement', corner: 7 })).toBeNull();
  });

  it('markiert an einer Siedlung exakt die angrenzenden Landfelder und baut noch nichts', () => {
    const board = testBoard();
    const corner = board.corners.find((candidate) =>
      candidate.hexes.some((id) => board.hexes[id]?.terrain !== 'W'),
    );
    expect(corner).toBeDefined();
    const selection: BuildSelection = { kind: 'settlement', corner: corner!.id };
    const expected = adjacentLandHexIds(board, selection).sort((a, b) => a - b);
    const html = renderSelection(board, selection);
    const actual = [...html.matchAll(/data-adjacent-hex="(\d+)"/g)]
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);

    expect(actual).toEqual(expected);
    expect(actual.length).toBeGreaterThan(0);
    expect(html).toContain('data-build-preview="settlement"');
    expect(html).toContain(`data-preview-corner="${corner!.id}"`);
    expect(html).toContain('aria-label="Siedlung hier bauen"');
    expect(html).not.toContain(`data-corner="${corner!.id}"`);
  });

  it('zeigt Straße und Stadt passend an, ohne bei Straßen Felder als Ertrag zu markieren', () => {
    const board = testBoard();
    const roadHtml = renderSelection(board, { kind: 'road', edge: board.edges[0].id });
    const cityHtml = renderSelection(board, { kind: 'city', corner: board.corners[0].id });

    expect(roadHtml).toContain('data-build-preview="road"');
    expect(roadHtml).toContain(`data-preview-edge="${board.edges[0].id}"`);
    expect(roadHtml).toContain('aria-label="Straße hier bauen"');
    expect(roadHtml).not.toContain('data-adjacent-hex=');
    expect(roadHtml).not.toContain(`data-road="${board.edges[0].id}"`);
    expect(cityHtml).toContain('data-build-preview="city"');
    expect(cityHtml).toContain('aria-label="Stadt hier bauen"');
  });

  it('kennzeichnet ausreichende und tatsächlich fehlende Rohstoffmengen eindeutig', () => {
    const resources = emptyResources();
    resources.grain = 2;
    resources.ore = 1;
    const html = renderToStaticMarkup(createElement(CostDetails, { cost: COSTS.city, res: resources }));

    expect(html).toContain('data-cost-resource="grain"');
    expect(html).toContain('data-cost-resource="ore"');
    expect(html).toMatch(/data-cost-resource="grain" data-cost-status="available"/);
    expect(html).toMatch(/data-cost-resource="ore" data-cost-status="missing"/);
    expect(html).toContain('2 fehlt');
    expect(html).toContain('Getreide');
    expect(html).toContain('Erz');
  });

  it('rendert Straßen-Baukanten mit eigenem Puls hinter vorhandenen Gebäuden', () => {
    const board = testBoard();
    const edge = board.edges[0];
    const html = renderToStaticMarkup(createElement(Board, {
      board,
      buildings: { [edge.a]: { owner: 'p1', type: 'settlement' } },
      roads: {},
      robberHex: board.hexes.find((hex) => hex.terrain === 'D')?.id ?? 0,
      colorOf: () => PLAYER_COLORS[0],
      buildKind: 'road',
      buildSelection: { kind: 'road', edge: edge.id },
      buildColor: PLAYER_COLORS[0],
      highlightEdges: [edge.id],
      onEdge: () => undefined,
      onConfirmBuild: () => undefined,
      onCancelBuild: () => undefined,
    }));

    expect(html).toContain(`data-highlight-edge="${edge.id}"`);
    expect(html).toContain('build-road-candidate');
    expect(html).toContain('build-road-backdrop');
    expect(html).toContain('build-road-pulse');
    expect(html).toContain('build-road-core');
    expect(html).toMatch(new RegExp(`data-corner="${edge.a}" style="pointer-events:none"`));

    const candidateIndex = html.indexOf(`data-highlight-edge="${edge.id}"`);
    const previewIndex = html.indexOf('data-build-target-preview="road"');
    const buildingIndex = html.indexOf(`data-corner="${edge.a}"`);
    expect(candidateIndex).toBeGreaterThanOrEqual(0);
    expect(previewIndex).toBeGreaterThanOrEqual(0);
    expect(buildingIndex).toBeGreaterThan(candidateIndex);
    expect(buildingIndex).toBeGreaterThan(previewIndex);
  });
});
