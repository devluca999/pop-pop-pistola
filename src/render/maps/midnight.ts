// Midnight Lantern Street: a black void, one pool of lantern light, cold moonlight.
import { bellY, CHAR_COLORS, type MapDef } from './types';
import * as P from './props';

const BELL_Z = -24;

export const MIDNIGHT: MapDef = {
  id: 'midnight',
  name: 'Midnight Lantern Street',
  fakes: ['flicker'],
  palette: [
    ...CHAR_COLORS,
    0x05060b, 0x0d1222, 0x18213a, 0x2b3a5c, 0x4a5f86, 0x8fa3c4, 0xc9d4e6,
    0x231b19, 0x40302a, 0x634337, 0x8f5843, 0xeda978, 0xf8c08f,
  ],
  light: {
    hemi: { sky: 0x4a5f86, ground: 0x18131c, intensity: 1.1 },
    // moon: high, behind-left of the rival, so the duelists get a cold rim
    key: { color: 0x9fb4dc, intensity: 1.6, pos: [-6, 12, -14], target: [0, 0, 0], shadow: { l: -16, r: 16, t: 22, b: -26, far: 50 } },
    fills: [{ color: 0x8fa3c4, intensity: 1.8, pos: [3, 5, 12], target: [0, 1.5, -4] }],
    fog: { color: 0x05060b, near: 16, far: 52 },
    sky: {
      key: 'midnight',
      stops: [[0, 0x18213a], [0.35, 0x0d1222], [1, 0x05060b]],
      horizon: 0.62,
      corner: 0.4,
      disc: { x: 28, y: 16, r: 7, color: 0xe6ecf4, rim: 0xc9d4e6, halo: 0x2b3a5c, haloAmt: 0.8 },
      stars: 46,
      starColor: 0xc9d4e6,
    },
    rim: { color: 0xb8c8ec, strength: 0.55 },
    lantern: 4.2,
  },
  camera: {
    bellZ: BELL_Z,
    title: { cx: 1.0, cz: -2, r: 9, y: 3.0, look: [0, 3.0, -14], fov: 44 },
  },
  props: [
    P.ground(0x3a3040, 120, 50, 7),
    P.street(0x4a3e48, 7, 60, -20),
    // the one lantern: on a post just right of the rival, its pool lights both duelists
    P.lampPost(3.1, -3.4, -1, 11),
    P.flickerFake(),
    // dark storefronts at the edge of the light, a few lit windows
    P.darkBlock(-8.5, -2, 5, 5.5, 8, 0x40302a),
    P.darkBlock(-8.5, -12, 5, 6.5, 9, 0x231b19),
    P.darkBlock(8.5, -4, 5, 5.0, 9, 0x231b19),
    P.darkBlock(8.5, -15, 5, 6.0, 9, 0x40302a),
    P.litWindow(-5.98, 1.6, -10.5),
    P.litWindow(5.98, 3.6, -13),
    P.barrel(2.4, -2.4, 0.45),
    P.barrel(-4.8, -6.5, 0.45),
    P.crate(4.6, -7.5, 0.8),
    P.fenceZ(-4.3, -14, 4, 1.2, 0x634337),
    P.shrubs(10, 33, -20, 2, (_z, side, r) => side * (4.5 + r() * 2)),
    // fire-bell trestle at the end of the street, lit by the moon
    P.bellTrestle(BELL_Z, bellY(BELL_Z)),
    // a small lamp on the trestle so the bell glints in the dark
    P.lantern(1.0, BELL_Z + 1.6, bellY(BELL_Z) - 0.6, 1.4, 7),
    P.waterTower(-12, -36),
    P.butte(-30, -110, 18, 11, 0x18213a),
    P.butte(20, -120, 16, 9, 0x18213a),
  ],
};
