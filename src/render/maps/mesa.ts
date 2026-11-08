// Mesa at Sunset: open desert, orange-to-purple sky, long low-sun shadows, a mission bell gable.
import { bellY, CHAR_COLORS, type MapDef } from './types';
import * as P from './props';

const BELL_Z = -17;

export const MESA: MapDef = {
  id: 'mesa',
  name: 'Mesa at Sunset',
  fakes: ['hawk'],
  palette: [
    ...CHAR_COLORS,
    0x1d1028, 0x3b1d3f, 0x6a2f55, 0x9c4058, 0xd0603e, 0xf08a3a, 0xf6b45a,
    0xfadc8c, 0x5a3a2a, 0x8a5236, 0xb87a8f, 0xc8835a,
  ],
  light: {
    hemi: { sky: 0xb87a8f, ground: 0x5a3a2a, intensity: 1.2 },
    // sun low on the right: long raking shadows stretch left across the sand
    key: { color: 0xffa860, intensity: 3.6, pos: [20, 5, 3], target: [0, 0, -4], shadow: { l: -22, r: 22, t: 26, b: -26, far: 70 } },
    fills: [{ color: 0x8a6ab0, intensity: 0.9, pos: [-8, 5, 10], target: [0, 1.5, -4] }],
    fog: { color: 0xd0806a, near: 50, far: 220 },
    sky: {
      key: 'mesa',
      stops: [[0, 0xfadc8c], [0.18, 0xf08a3a], [0.45, 0xb24d58], [0.75, 0x6a2f55], [1, 0x3b1d3f]],
      horizon: 0.66,
      corner: 0.45,
      disc: { x: 54, y: 60, r: 10, color: 0xfadc8c, rim: 0xf6b45a, halo: 0xf6b45a, haloAmt: 0.75 },
    },
    rim: { color: 0xffb070, strength: 0.6 },
    lantern: 2.0,
  },
  camera: {
    bellZ: BELL_Z,
    title: { cx: 1.5, cz: -1, r: 12, y: 3.4, look: [0, 3.0, -14], fov: 44 },
  },
  props: [
    P.ground(0xd08a5a, 200, 80, 13),
    P.missionGable(BELL_Z, bellY(BELL_Z)),
    P.cactus(-5.5, -6, 1.5, 0x4a5a3a),
    P.cactus(7.5, -11, 1.3, 0x4a5a3a),
    P.cactus(-9, -20, 1.1, 0x4a5a3a),
    P.cactus(13, -26, 1.6, 0x4a5a3a),
    P.cactus(-16, -32, 1.4, 0x4a5a3a),
    P.rock(-3.8, -1.5, 0.9, 0x8a5236),
    P.rock(4.5, -4.5, 0.6, 0x8a5236),
    P.rock(-7, -13, 1.4, 0x5a3a2a),
    P.rock(9, -18, 1.8, 0x8a5236),
    P.wagonWheel(3.6, -8.2, -0.5),
    P.fenceX(-12, -9, 5, 0x8a5236),
    P.shrubs(18, 55, -30, 4, (_z, side, r) => side * (2.6 + r() * 9)),
    P.hawk(),
    // big buttes close-ish and on the horizon
    P.butte(-34, -80, 22, 22, 0x9c4058, 0.6),
    P.butte(30, -95, 26, 26, 0x6a2f55, 0.6),
    P.butte(-8, -140, 18, 14, 0x6a2f55),
    P.butte(70, -150, 20, 13, 0x9c4058),
    P.butte(-75, -140, 22, 12, 0x6a2f55),
  ],
};
