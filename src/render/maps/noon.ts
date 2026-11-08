// High Noon Main Street: the original town (refs/map.png).
import type { MapDef } from './types';
import { NOON_SKY } from '../textures';
import { PALETTE_16 } from '../post';
import * as P from './props';

const TOWER_Z = -33.2;
const fx = P.frontX;

export const NOON: MapDef = {
  id: 'noon',
  name: 'High Noon Main Street',
  fakes: ['crow', 'tumbleweed', 'door', 'cough'],
  palette: PALETTE_16,
  light: {
    // low, cool ambient: shadows read blue-grey against the warm sunlit dirt
    hemi: { sky: 0xc4c9cf, ground: 0x6a4c34, intensity: 1.05 },
    // strong warm high-noon key, almost overhead: short, hard shadows
    key: { color: 0xfff0dc, intensity: 3.5, pos: [0.6, 14, 7], target: [0, 0, -4], shadow: { l: -16, r: 16, t: 22, b: -26, far: 50 } },
    // warm bounce off the street lights both rows of facades
    fills: [-1, 1].map((sx) => ({ color: 0xf8c08f, intensity: 1.25, pos: [sx * 10, 3, 4] as [number, number, number], target: [0, 2, -6] as [number, number, number] })),
    fog: { color: 0xe6e2da, near: 90, far: 330 },
    sky: NOON_SKY,
    rim: { color: 0xfff1d6, strength: 0.32 },
    lantern: 2.2,
  },
  camera: {
    bellZ: TOWER_Z,
    title: { cx: 1.5, cz: -1, r: 12, y: 3.6, look: [0, 3.2, -14], fov: 42 },
  },
  props: [
    P.ground(0xe6b48a),
    P.street(0xf0bf92),
    // left row: [z centre, length, height, wall colour, opts]
    P.building(-1, 1.5, 6, 5.2, 0x634337),
    P.building(-1, -6.6, 9, 6.6, 0x634337, { sign: 'SALOON', horseshoe: true, doors: true, lantern: 'far' }),
    P.building(-1, -14.6, 6, 5.0, 0x8f5843, { sign: 'BANK' }),
    P.building(-1, -20.6, 5, 4.2, 0x40302a),
    P.building(1, 1.5, 5, 4.8, 0x40302a),
    P.building(1, -5.2, 7.6, 5.4, 0x8f5843, { sign: 'GENERAL STORE', lantern: 'far' }),
    P.building(1, -12.9, 7, 6.4, 0x634337, { sign: 'SHERIFF', star: true, lantern: 'near' }),
    P.building(1, -19.8, 5.4, 4.4, 0x634337, { sign: 'HOTEL' }),
    // cougher in the general store's lower window
    P.cougher([fx(-5.2) + 0.05, 0.95, -5.2 - 7.6 * 0.3]),
    // hitching rail + horse (left mid-ground)
    P.hitchingRail(-6.6, -13.2),
    P.horse(-6.6 + 1.7, -13.2 - 0.75),
    // lamp post near the camera: its lantern hangs beside the near duelist's hat
    P.lampPost(-3.62, -1.0, 1),
    P.barrel(-(fx(0) - 2.5), 0.2),
    P.barrel(-(fx(0) - 2.6), -0.7),
    P.barrel(fx(-3) - 2.45, -2.6),
    P.barrel(-(fx(-10) - 2.4), -10.4),
    P.crate(-(fx(-9) - 2.6), -9.3, 0.7),
    P.crate(-(fx(-9) - 2.55), -9.25, 0.55, 0.7),
    P.crate(fx(-9) - 2.5, -9.4, 0.8),
    P.crate(fx(-17) - 2.3, -16.6, 0.6),
    // rail fence with the crow, in front of the store
    P.fenceZ(fx(-9) - 3.0, -8.3, 3),
    P.crow([fx(-9) - 3.0, 1.0, -8.6]),
    P.tumbleweed(),
    P.shrubs(22, 21, -20, 4, (z, side, r) => side * (fx(z) - 2.2 - r() * 0.4)),
    P.church(TOWER_Z),
    // fence across the end of the street, open in the middle
    P.fenceX(-3.2 - 5 * 1.3, -27.6, 5 * 1.3),
    P.fenceX(3.2, -27.6, 5 * 1.3),
    P.waterTower(-9.5, -40),
    P.cactus(12.5, -9, 1.4),
    P.cactus(10.5, -26, 1.3),
    P.cactus(-12, -30, 1.0),
    P.cactus(16, -16, 1.5),
    P.butte(-40, -150, 20, 15, 0xae9386),
    P.butte(-14, -175, 13, 10, 0x97a6b6),
    P.butte(18, -160, 17, 13, 0xae9386),
    P.butte(44, -140, 13, 9, 0x97a6b6),
    P.butte(-66, -130, 14, 8, 0x97a6b6),
    P.butte(70, -165, 18, 11, 0xae9386),
  ],
};
