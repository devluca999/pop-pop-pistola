// Saloon Interior: bar across the back with a bell over it, piano, swinging doors, dusty light shafts.
import { bellY, CHAR_COLORS, type MapDef } from './types';
import * as P from './props';

const BAR_Z = -10;
const BELL_Z = BAR_Z - 0.4;
const CEIL = 7.4;

export const SALOON: MapDef = {
  id: 'saloon',
  name: 'Saloon Interior',
  fakes: ['glass'],
  palette: [
    ...CHAR_COLORS,
    0x120c0a, 0x2a1a12, 0x4a2e1c, 0x6e4426, 0x9a6234, 0xc48a4a, 0xe8b870,
    0xf6dca4, 0x3c4a3a, 0x6e2a22, 0x8fa6a8, 0x5c5b67,
  ],
  light: {
    hemi: { sky: 0xc48a4a, ground: 0x4a2e1c, intensity: 1.6 },
    // daylight through the high left windows, slanting down across the room
    key: { color: 0xffd8a0, intensity: 1.6, pos: [-9, 9, 1], target: [1, 0, -4], shadow: { l: -12, r: 12, t: 14, b: -14, far: 40 } },
    fills: [{ color: 0xc48a4a, intensity: 0.8, pos: [6, 3, 6], target: [0, 1.5, -6] }],
    fog: { color: 0x2a1a12, near: 22, far: 48 },
    sky: 0x120c0a,
    rim: { color: 0xffd8a0, strength: 0.45 },
    lantern: 4.0,
  },
  camera: {
    bellZ: BELL_Z,
    title: { cx: 0.8, cz: 1, r: 4, y: 2.6, look: [0, 2.6, -10], fov: 50 },
  },
  props: [
    P.room(8, 8.5, -13.5, CEIL),
    P.bar(BAR_Z, bellY(BELL_Z)),
    P.breakingBottle([1.6, 1.26, BAR_Z + 0.15]),
    P.piano(-7.3, -5, 1),
    P.sideDoors(8, -3),
    P.lightShafts([{ x: -5.5, z: -2, tilt: -0.45 }, { x: -5.5, z: -7, tilt: -0.45 }], CEIL),
    P.table(-4.6, -1),
    P.table(4.8, -7),
    P.table(-5, -9.5),
    P.ceilingLamp(-3, -6, 4.6, CEIL),
    P.ceilingLamp(3.4, -5.5, 4.6, CEIL),
    P.ceilingLamp(-2.4, BAR_Z + 0.8, 4.2, CEIL, 6),
    P.ceilingLamp(2.4, BAR_Z + 0.8, 4.2, CEIL, 6),
    P.barrel(6.8, -11.6, 0.45),
    P.barrel(-6.9, -12, 0.45),
    P.crate(6.6, 5, 0.7),
  ],
};
