import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { APP_VERSION_LABEL, PLAYER_COLORS, createGame } from '@catan/shared';

let App: typeof import('../src/App').App;
let Board: typeof import('../src/components/board/Board').Board;

beforeAll(async () => {
  const values = new Map<string, string>();
  const storage: Storage = {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
  vi.stubGlobal('localStorage', storage);
  ({ App } = await import('../src/App'));
  ({ Board } = await import('../src/components/board/Board'));
});

describe('Client-Smoke', () => {
  it('rendert den vollständigen App-Einstieg mit Bootscreen und Startseite', () => {
    const html = renderToStaticMarkup(createElement(App));
    expect(html).toContain('Catan Online');
    expect(html).toContain('Raum erstellen');
    expect(html).toContain('Dein Spielername');
    expect(html).toContain('role="status"');
    expect(html).toContain(APP_VERSION_LABEL);
  });

  it('rendert eine reale Wasserkarte inklusive Zoom-Ebene und Häfen', () => {
    const board = createGame({
      mapId: 'coast',
      seed: 42,
      vpTarget: 10,
      bankSize: 19,
      players: [
        { id: 'p1', name: 'Spieler Eins', colorIndex: 0, isBot: false },
        { id: 'p2', name: 'Spieler Zwei', colorIndex: 1, isBot: false },
      ],
    }).board;
    const robberHex = board.hexes.find((hex) => hex.terrain === 'D')?.id ?? 0;
    const html = renderToStaticMarkup(createElement(Board, {
      board,
      buildings: {},
      roads: {},
      robberHex,
      colorOf: () => PLAYER_COLORS[0],
    }));
    expect(html).toContain('data-zoom-layer');
    expect(html).toContain('viewBox=');
    expect(html).toContain('<svg');
    expect(board.ports.length).toBeGreaterThan(0);
  });
});
