import { describe, it, expect } from 'vitest';
import { randomName } from '../src/names.js';

describe('randomName', () => {
  it('erzeugt Namen: Buchstaben (inkl. Umlaute) + zwei Ziffern, 2..20 Zeichen', () => {
    for (let i = 0; i < 300; i++) {
      const n = randomName();
      expect(n.length).toBeGreaterThanOrEqual(2);
      expect(n.length).toBeLessThanOrEqual(20);
      expect(n).toMatch(/^[A-Za-zÄÖÜäöüß]+\d{2}$/);
    }
  });

  it('enthält niemals echte/private Personennamen (z. B. „Marcel")', () => {
    for (let i = 0; i < 300; i++) {
      expect(randomName().toLowerCase()).not.toContain('marcel');
    }
  });

  it('variiert (nicht immer derselbe Name)', () => {
    const set = new Set(Array.from({ length: 50 }, () => randomName()));
    expect(set.size).toBeGreaterThan(1);
  });
});
