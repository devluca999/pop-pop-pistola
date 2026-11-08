import { describe, expect, it } from 'vitest';
import { MAPS, mapDef } from './index';
import type { FakeKind } from '../../types';

describe('MAPS', () => {
  it('lists the five maps in order', () => {
    expect(MAPS.map((m) => m.id)).toEqual(['noon', 'midnight', 'train', 'mesa', 'saloon']);
  });

  it('every fake kind belongs to some map, noon keeps the classic four', () => {
    const all: FakeKind[] = ['crow', 'tumbleweed', 'door', 'cough', 'flicker', 'whistle', 'hawk', 'glass'];
    const used = new Set(MAPS.flatMap((m) => m.fakes));
    for (const k of all) expect(used.has(k)).toBe(true);
    expect(MAPS[0].fakes).toEqual(['crow', 'tumbleweed', 'door', 'cough']);
  });

  it('palettes fit the dither shader and bells sit on the line of fire', () => {
    for (const m of MAPS) {
      const d = mapDef(m.id);
      expect(d.palette.length).toBeGreaterThanOrEqual(8);
      expect(d.palette.length).toBeLessThanOrEqual(24);
      expect(d.camera.bellZ).toBeLessThan(-4.2); // behind the rival
    }
  });
});
