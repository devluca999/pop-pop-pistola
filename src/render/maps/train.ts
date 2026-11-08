// Train Platform: depot with a cupola bell, water tower, a train pulls through now and then.
import { bellY, CHAR_COLORS, type MapDef } from './types';
import * as P from './props';

const BELL_Z = -21;

export const TRAIN: MapDef = {
  id: 'train',
  name: 'Train Platform',
  fakes: ['whistle'],
  palette: [
    ...CHAR_COLORS,
    0x231b19, 0x40302a, 0x634337, 0x8f5843, 0xad7658, 0x5c5b67, 0x8a8f99,
    0xb7b9b8, 0xdcd6cb, 0x69819d, 0x97a6b6, 0xe0b48a, 0xc69a62,
  ],
  light: {
    hemi: { sky: 0xb7bfca, ground: 0x5a4a40, intensity: 1.1 },
    // afternoon sun from the right, a bit lower than noon
    key: { color: 0xffe8cc, intensity: 3.0, pos: [9, 11, 6], target: [0, 0, -6], shadow: { l: -18, r: 18, t: 24, b: -28, far: 60 } },
    fills: [{ color: 0xd8c4a8, intensity: 0.9, pos: [-10, 3, 4], target: [0, 2, -6] }],
    fog: { color: 0xd8d4cc, near: 60, far: 240 },
    sky: {
      key: 'train',
      stops: [[0, 0xe6e2da], [0.3, 0xc4c9cf], [0.7, 0x8a98ab], [1, 0x5c6c86]],
      horizon: 0.6,
      corner: 0.5,
      disc: { x: 40, y: 18, r: 7, color: 0xf6eede, rim: 0xf3e4c8, halo: 0xd8dad8, haloAmt: 0.7 },
    },
    rim: { color: 0xfff1d6, strength: 0.3 },
    lantern: 2.0,
  },
  camera: {
    bellZ: BELL_Z,
    title: { cx: 1.5, cz: -1, r: 11, y: 3.4, look: [0, 3.2, -14], fov: 44 },
  },
  props: [
    P.ground(0xb69a78, 160, 70, 9),
    // the duel happens on the long platform
    P.platform(-0.5, -6, 9, 34, 0.02),
    P.track(5.8, 30, -140),
    P.passingTrain(5.8),
    // steam bursts in from beyond the right edge of frame
    P.steamWhistle([6.3, 0.8, -1.5]),
    P.depot(BELL_Z + 1, bellY(BELL_Z) - 0.8),
    P.waterTower(11.5, -16, 0.9),
    P.lampPost(-3.62, -1.0, 1),
    P.lantern(-3.4, BELL_Z + 1.6, 3.0),
    P.crate(-4.2, -8, 0.8),
    P.crate(-4.0, -8.9, 0.6, 0.8),
    P.barrel(-4.4, -11, 0.45),
    P.barrel(-3.9, -11.6, 0.45),
    P.crate(3.2, -12, 0.7),
    // baggage cart
    P.wagonWheel(-4.2, -4, 0.3),
    P.fenceZ(-5.2, 6, 10, 1.6, 0x634337),
    P.building(-1, -30, 7, 5, 0x634337, { sign: 'FREIGHT' }),
    P.shrubs(12, 41, -40, 4, (_z, side, r) => side * (8 + r() * 6)),
    P.cactus(14, -30, 1.3),
    P.cactus(-13, -36, 1.1),
    P.butte(-40, -150, 20, 15, 0xae9386),
    P.butte(10, -170, 15, 11, 0x97a6b6),
    P.butte(55, -150, 18, 12, 0xae9386),
  ],
};
