import { describe, expect, it } from 'vitest';
import { computeView, RES_W_MAX, RES_W_MIN } from './view';

const v = (w: number, h: number, dpr = 1) => computeView(w, h, w * dpr, h * dpr);

describe('computeView', () => {
  it('1920x1080 is exactly 5x of 384x216 with no bars', () => {
    const r = v(1920, 1080);
    expect([r.resW, r.resH, r.scale, r.integer]).toEqual([384, 216, 5, true]);
    expect(r.dev).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(r.u).toBe(6);
  });

  it('height is always 216 and width stays within 4:3..21:9', () => {
    for (const [w, h, d] of [[1280, 720, 1], [2560, 1080, 1], [3440, 1440, 1], [1024, 768, 1], [390, 844, 3], [844, 390, 3], [300, 2000, 1], [5000, 300, 2]]) {
      const r = v(w, h, d);
      expect(r.resH).toBe(216);
      expect(r.resW).toBeGreaterThanOrEqual(RES_W_MIN);
      expect(r.resW).toBeLessThanOrEqual(RES_W_MAX);
      // image fits inside the canvas
      expect(r.dev.x).toBeGreaterThanOrEqual(0);
      expect(r.dev.y).toBeGreaterThanOrEqual(0);
      expect(r.dev.x + r.dev.w).toBeLessThanOrEqual(r.devW + 0.001);
      expect(r.dev.y + r.dev.h).toBeLessThanOrEqual(r.devH + 0.001);
    }
  });

  it('ultrawide gets side bars, portrait gets top/bottom bars', () => {
    const wide = v(3440, 1440);
    expect(wide.resW).toBe(RES_W_MAX);
    expect(wide.dev.x).toBeGreaterThan(0);
    const tall = v(390, 844, 3);
    expect(tall.dev.y).toBeGreaterThan(0);
    expect(tall.dev.x).toBeLessThanOrEqual(1);
  });

  it('HUD unit follows the smaller side of the image', () => {
    const r = v(2560, 1080);
    expect(r.u).toBeCloseTo(Math.min(r.image.w / 320, r.image.h / 180));
    expect(r.u).toBe(6);
  });

  it('keeps clear of safe-area padding', () => {
    const r = computeView(844, 390, 2532, 1170, { top: 0, right: 47, bottom: 21, left: 47 });
    expect(r.image.x).toBeGreaterThanOrEqual(47);
    expect(r.image.x + r.image.w).toBeLessThanOrEqual(844 - 47 + 0.5);
    expect(r.image.y + r.image.h).toBeLessThanOrEqual(390 - 21 + 0.5);
  });
});
