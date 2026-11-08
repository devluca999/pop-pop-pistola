import * as THREE from 'three';
import type { CharacterId } from '../types';
import { C, lam, basic, box, cyl, ico, starGeo, addRim } from './materials';

/**
 * A character built from faceted papercraft pieces (tapered cylinders, lathes, extrusions,
 * tubes; all flat shaded). Local space: feet at origin, facing +z, character's left hand on +x.
 */
export interface Rig {
  id: CharacterId;
  root: THREE.Group;
  body: THREE.Group;   // fall/lean pivot at the feet
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  hat: THREE.Group;
  hatHome: { parent: THREE.Object3D; pos: THREE.Vector3; rot: THREE.Euler };
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  hipY: number;
  gunHand: THREE.Object3D;
  gunHolster: THREE.Object3D | null;
  muzzle: THREE.Object3D;
  mouth: THREE.Object3D;
  bottle?: THREE.Object3D;
  coverL?: THREE.Object3D;
  coverR?: THREE.Object3D;
  lanternGlow?: THREE.Mesh;
  halo?: THREE.Group;
  pips?: THREE.Mesh[];
  /** Colours used for the vaporize burst. */
  burst: number[];
}

// ------------------------------------------------------------------ local palette
/** Base colours picked from the game's quantize palette (refs/map.png) so they survive it. */
const K = {
  red: 0xa8392a, redDark: 0x6e2219,
  hat: 0xae9386, hatShade: 0x8f7a70, hatBand: 0x40302a,
  stache: 0x634337,
  skin: 0xf0b483, skinShade: 0xd49066,
  shirt: 0xc4c9cf, vest: 0x5c5b67,
  pants: 0x634337, boot: 0xae9386, leather: 0x634337, belt: 0x231b19,
  brass: 0xd9a33a, metal: 0xc4c9cf, metalDark: 0x5c5b67, wood: 0x8f5843, woodDark: 0x40302a,
  blue: 0x69819d, blueDark: 0x4f6283,
  ink: 0x231b19, black: 0x090808,
  habit: 0x40302a, habitDark: 0x231b19, coif: 0xedebe7,
  spur: 0xc4c9cf, cigar: 0x634337, book: 0x40302a, paper: 0xf9d8b0, bottle: 0x634337,
} as const;

// ------------------------------------------------------------------ geometry helpers
const TAU = Math.PI * 2;
const dsCache = new Map<number, THREE.MeshLambertMaterial>();
/** Double-sided flat Lambert for open shells (coat, brims, hood). */
function lam2(hex: number): THREE.MeshLambertMaterial {
  let m = dsCache.get(hex);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true, side: THREE.DoubleSide });
    addRim(m);
    dsCache.set(hex, m);
  }
  return m;
}

function group(x = 0, y = 0, z = 0, parent?: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}

/** Add child to parent and return the child (Object3D.add returns the parent). */
function put<T extends THREE.Object3D>(parent: THREE.Object3D, child: T): T {
  parent.add(child);
  return child;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

/**
 * Lathe from (radius, y) pairs, top to bottom. `gap` leaves the front (+z) open by that many
 * radians. `pleat` zig-zags alternate segments outward, more toward the hem, for paper folds.
 */
function lathe(
  prof: [number, number][], seg: number, mat: THREE.Material,
  opts: { gap?: number; pleat?: number; sz?: number; rot?: number } = {},
): THREE.Mesh {
  const gap = opts.gap ?? 0;
  const pts = prof.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y));
  const start = gap / 2 + (opts.rot ?? 0);
  const len = TAU - gap;
  const g = new THREE.LatheGeometry(pts, seg, start, len);
  const pleat = opts.pleat ?? 0;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const yTop = prof[0][1];
  const yBot = prof[prof.length - 1][1];
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), z = pos.getZ(i);
    const y = pos.getY(i);
    if (pleat) {
      const k = Math.round((i / pts.length) | 0);
      const w = Math.min(1, Math.max(0, (yTop - y) / (yTop - yBot)));
      const f = 1 + (k % 2 ? pleat : -pleat * 0.35) * w * w;
      x *= f; z *= f;
    }
    pos.setXYZ(i, x, y, z * (opts.sz ?? 1));
  }
  g.computeVertexNormals();
  return mesh(g, mat);
}

/** Tube along a smooth curve whose radius follows rFn(t). */
function tube(
  pts: THREE.Vector3[], rFn: (t: number) => number, segs: number, radial: number, mat: THREE.Material,
): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const P = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    curve.getPointAt(i / segs, P);
    const k = rFn(i / segs);
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(P).multiplyScalar(k).add(P);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  g.computeVertexNormals();
  return mesh(g, mat);
}

/** Mirror a list of points across x. */
const mirror = (pts: THREE.Vector3[]): THREE.Vector3[] => pts.map((p) => new THREE.Vector3(-p.x, p.y, p.z));
const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Flat polygon (x,y) extruded `depth` along z, centred on z. */
function extrude(pts: [number, number][], depth: number, mat: THREE.Material, bevel = 0): THREE.Mesh {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 2,
  });
  g.translate(0, 0, -depth / 2);
  return mesh(g, mat);
}

/** Thick faceted ring (hat brim) with an edge band; lift(angle, t) bends it, t = 0 inner .. 1 outer. */
function brimGeo(rIn: number, rOut: number, seg: number, thick: number, lift: (a: number, t: number) => number): THREE.BufferGeometry {
  const ts = [0, 0.5, 1];
  const top: THREE.Vector3[][] = [];
  const bot: THREE.Vector3[][] = [];
  for (let k = 0; k <= seg; k++) {
    const a = (k / seg) * TAU;
    top.push([]); bot.push([]);
    for (const t of ts) {
      const r = rIn + (rOut - rIn) * t;
      const y = lift(a, t);
      const th = thick * (1 - t * 0.5);
      top[k].push(V(Math.sin(a) * r, y + th / 2, Math.cos(a) * r));
      bot[k].push(V(Math.sin(a) * r, y - th / 2, Math.cos(a) * r));
    }
  }
  const p: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) => {
    p.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z);
  };
  const last = ts.length - 1;
  for (let k = 0; k < seg; k++) {
    for (let i = 0; i < last; i++) {
      quad(top[k][i], top[k][i + 1], top[k + 1][i + 1], top[k + 1][i]);
      quad(bot[k][i], bot[k + 1][i], bot[k + 1][i + 1], bot[k][i + 1]);
    }
    quad(top[k][last], bot[k][last], bot[k + 1][last], top[k + 1][last]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  return g;
}

/** Cowboy boot foot: side profile extruded across x. Toe toward +z, sole at y = 0. */
function bootFoot(len: number, h: number, w: number, mat: THREE.Material): THREE.Mesh {
  const m = extrude([
    [-0.28 * len, 0], [0.62 * len, 0], [0.72 * len, 0.28 * h], [0.5 * len, 0.75 * h],
    [0.1 * len, h], [-0.28 * len, h],
  ], w, mat);
  m.geometry.rotateY(-Math.PI / 2);
  return m;
}

/** Leg: hip pivot -> thigh -> knee -> shin -> boot. Returns the hip pivot. */
function leg(
  parent: THREE.Object3D, x: number, hipY: number, o: {
    thigh: number; rT: number; rK: number; rA: number; pants: number; boot: number;
    bow: number; shaftR: number; shaftH: number; footL: number; footH: number;
  },
): { pivot: THREE.Group; ankle: THREE.Group } {
  const side = Math.sign(x);
  const pivot = group(x, 0, 0, parent); // the puppet drives this one's rotation
  const thigh = group(0, 0, 0, pivot);
  thigh.rotation.z = side * o.bow; // bowlegged: knees out, feet back under the hips
  const pm = lam(o.pants);
  thigh.add(cyl(o.rK, o.rT, o.thigh, 5, pm, 0, -o.thigh / 2, 0));
  const knee = group(0, -o.thigh, 0, thigh);
  knee.rotation.z = -side * o.bow * 2;
  knee.add(ico(o.rK * 1.1, pm));
  const shin = hipY - o.thigh;
  knee.add(cyl(o.rA, o.rK, shin - o.shaftH, 5, pm, 0, -(shin - o.shaftH) / 2, 0));
  const ankle = group(0, -shin, 0, knee);
  ankle.rotation.z = side * o.bow;
  const bm = lam(o.boot);
  ankle.add(cyl(o.shaftR * 1.12, o.shaftR, o.shaftH, 6, bm, 0, o.footH + o.shaftH / 2 - 0.02, 0));
  ankle.add(bootFoot(o.footL, o.footH, o.shaftR * 2, bm));
  return { pivot, ankle };
}

/** Bony hand with a thumb and finger stubs, hanging along -y. */
function hand(parent: THREE.Object3D, r: number, skin: number, side: number, fingers = 3): void {
  const m = lam(skin);
  const palm = cyl(r * 0.85, r, r * 1.6, 5, m, 0, -r * 0.7, 0);
  palm.scale.z = 0.6;
  parent.add(palm);
  for (let i = 0; i < fingers; i++) {
    const f = cyl(r * 0.22, r * 0.28, r * 1.1, 4, m, (i - (fingers - 1) / 2) * r * 0.55, -r * 1.9, r * 0.1);
    f.rotation.x = 0.35;
    parent.add(f);
  }
  const th = cyl(r * 0.2, r * 0.28, r * 1.0, 4, m, -side * r * 0.9, -r * 0.9, r * 0.25);
  th.rotation.z = -side * 0.6;
  parent.add(th);
}

/** Arm hanging from a shoulder pivot along -y: flared sleeve, cuff, hand. */
function arm(
  parent: THREE.Object3D, x: number, y: number, len: number, rTop: number, rCuff: number,
  sleeve: number, cuff: number, skin: number, handR: number, fingers = 3,
): [THREE.Group, THREE.Group] {
  const side = Math.sign(x);
  const pivot = group(x, y, 0, parent);
  const sm = lam(sleeve);
  pivot.add(ico(rTop * 1.15, sm));
  pivot.add(cyl(rTop, rCuff, len * 0.82, 6, sm, 0, -len * 0.41, 0));
  pivot.add(cyl(rCuff * 1.08, rCuff * 1.15, len * 0.1, 6, lam(cuff), 0, -len * 0.84, 0));
  const h = group(0, -len * 0.88, 0, pivot);
  hand(h, handR, skin, side, fingers);
  const anchor = group(0, -len * 0.12, 0, h);
  return [pivot, anchor];
}

function revolver(): { g: THREE.Group; muzzle: THREE.Object3D } {
  const g = new THREE.Group();
  // barrel points along -y (down the arm), so aiming the arm aims the gun
  g.add(cyl(0.022, 0.022, 0.3, 6, lam(K.metal), 0, -0.2, 0.025));
  g.add(cyl(0.013, 0.013, 0.05, 4, lam(K.metalDark), 0, -0.34, 0.025));
  const drum = cyl(0.045, 0.045, 0.09, 6, lam(K.metalDark), 0, -0.04, 0.03);
  g.add(drum);
  g.add(cyl(0.035, 0.03, 0.06, 5, lam(K.metal), 0, 0.02, 0.025));
  const grip = extrude([[0.03, -0.02], [-0.11, 0.02], [-0.13, 0.08], [0.02, 0.05]], 0.04, lam(K.woodDark));
  grip.geometry.rotateY(-Math.PI / 2);
  grip.position.set(0, 0.02, 0.0);
  g.add(grip);
  const muzzle = group(0, -0.38, 0.025, g);
  return { g, muzzle };
}

function shotgun(): { g: THREE.Group; muzzle: THREE.Object3D } {
  const g = new THREE.Group();
  const m = lam(K.metal);
  g.add(cyl(0.035, 0.035, 0.42, 6, m, -0.035, -0.26, 0.03));
  g.add(cyl(0.035, 0.035, 0.42, 6, m, 0.035, -0.26, 0.03));
  g.add(cyl(0.07, 0.065, 0.1, 6, lam(K.metalDark), 0, -0.05, 0.03));
  const stock = extrude([[0.04, -0.06], [-0.2, -0.0], [-0.22, 0.09], [0.04, 0.06]], 0.08, lam(K.wood));
  stock.geometry.rotateY(-Math.PI / 2);
  stock.position.set(0, 0.0, 0.0);
  g.add(stock);
  const muzzle = group(0, -0.5, 0.03, g);
  return { g, muzzle };
}

function finish(r: Omit<Rig, 'hatHome'>): Rig {
  // Cast hard noon shadows on the ground, but don't receive them: under an overhead sun the
  // giant brims would otherwise black out the whole costume and kill the colour read.
  r.root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.receiveShadow = false;
  });
  return {
    ...r,
    hatHome: { parent: r.hat.parent!, pos: r.hat.position.clone(), rot: r.hat.rotation.clone() },
  };
}

// ---------------------------------------------------------------- Hector
function buildHector(): Rig {
  const root = new THREE.Group();
  const body = group(0, 0, 0, root);
  const hipY = 1.02;
  const hips = group(0, hipY, 0, body);
  const legOpts = {
    thigh: 0.5, rT: 0.05, rK: 0.036, rA: 0.032, pants: K.pants, boot: K.boot,
    bow: 0.12, shaftR: 0.055, shaftH: 0.24, footL: 0.26, footH: 0.09,
  };
  const legL = leg(hips, 0.1, hipY, legOpts).pivot;
  const legR = leg(hips, -0.1, hipY, legOpts).pivot;

  const torso = group(0, 0, 0, hips);
  // shirt + vest
  torso.add(cyl(0.12, 0.1, 0.62, 6, lam(K.shirt), 0, 0.36, 0));
  const vest = lathe([[0.06, 0.62], [0.13, 0.55], [0.125, 0.3], [0.11, 0.04]], 6, lam2(K.vest), { gap: 0.55 });
  torso.add(vest);
  torso.add(cyl(0.135, 0.13, 0.07, 6, lam(K.woodDark), 0, 0.04, 0)); // belt
  torso.add(box(0.06, 0.05, 0.02, lam(K.brass), 0, 0.04, 0.13)); // buckle
  // hip block between legs so the coat gap never shows a void
  torso.add(cyl(0.12, 0.1, 0.12, 6, lam(K.pants), 0, -0.04, 0));

  // long red coat: open front, pleated hem that flares out
  const coat = lathe([
    [0.08, 0.76], [0.22, 0.67], [0.21, 0.56], [0.16, 0.36], [0.15, 0.14], [0.2, -0.06], [0.27, -0.3], [0.36, -0.52],
  ], 10, lam2(K.red), { gap: 1.35, pleat: 0.16, sz: 0.78 });
  torso.add(coat);
  // back vent: dark seam down the tails
  const vent = tube([V(0, 0.08, -0.13), V(0, -0.24, -0.2), V(0, -0.5, -0.28)], () => 0.012, 3, 3, lam(K.redDark));
  torso.add(vent);
  // stand-up collar and lapels
  torso.add(lathe([[0.07, 0.88], [0.085, 0.76], [0.12, 0.68]], 6, lam2(K.redDark), { gap: 0.9 }));
  for (const s of [1, -1]) {
    const lap = extrude([[0, 0], [0.07, 0.04], [0.035, 0.24], [0.0, 0.2]], 0.02, lam(K.redDark));
    lap.position.set(s * 0.05, 0.4, 0.125);
    lap.scale.x = s;
    lap.rotation.y = s * 0.35;
    torso.add(lap);
  }
  // holster on right hip, gun grip up
  const holster = group(-0.2, -0.02, 0.02, torso);
  holster.rotation.z = -0.12;
  const hol = cyl(0.045, 0.03, 0.24, 5, lam(K.leather), 0, -0.1, 0);
  hol.scale.z = 0.7;
  holster.add(hol);
  const holsterGun = revolver();
  holsterGun.g.rotation.x = Math.PI; // grip up
  holsterGun.g.position.set(0, -0.06, -0.02);
  holsterGun.g.scale.setScalar(0.9);
  holster.add(holsterGun.g);

  const [armL] = arm(torso, 0.2, 0.63, 0.66, 0.045, 0.075, K.red, K.redDark, K.skin, 0.05, 4);
  const [armR, handR] = arm(torso, -0.2, 0.63, 0.66, 0.045, 0.075, K.red, K.redDark, K.skin, 0.05, 4);
  // big turned-back cuffs and boxy shoulders, as on the sheet
  for (const a of [armL, armR]) {
    a.add(cyl(0.095, 0.105, 0.14, 6, lam(K.redDark), 0, -0.53, 0));
    const sh = ico(0.075, lam(K.red));
    sh.scale.set(1.1, 0.8, 1);
    sh.position.y = -0.02;
    a.add(sh);
  }
  const gun = revolver();
  gun.g.position.set(0, 0.04, 0.02);
  handR.add(gun.g);
  gun.g.visible = false;

  // tiny tapered head: wide brow, long narrow chin
  const head = group(0, 0.74, 0, torso);
  const skin = lam(K.skin);
  head.add(cyl(0.035, 0.04, 0.1, 5, skin, 0, 0.03, 0)); // neck
  const skull = cyl(0.1, 0.045, 0.3, 6, skin, 0, 0.2, 0.0);
  skull.scale.z = 0.95;
  head.add(skull);
  const nose = cyl(0.0, 0.035, 0.14, 4, lam(K.skinShade), 0, 0.2, 0.12);
  nose.rotation.x = 1.25;
  head.add(nose);
  // heavy brow + beady eyes
  const brow = cyl(0.016, 0.016, 0.17, 4, lam(K.ink), 0, 0.285, 0.09);
  brow.rotation.z = Math.PI / 2;
  head.add(brow);
  head.add(mesh(new THREE.IcosahedronGeometry(0.018, 0), lam(K.black), 0.04, 0.255, 0.095));
  head.add(mesh(new THREE.IcosahedronGeometry(0.018, 0), lam(K.black), -0.04, 0.255, 0.095));
  // handlebar mustache, way wider than his face, curling up at the tips
  const st = lam(K.stache);
  const half = [V(0.0, 0.135, 0.13), V(0.1, 0.12, 0.12), V(0.22, 0.07, 0.08), V(0.33, 0.05, 0.03), V(0.42, 0.1, -0.01), V(0.43, 0.18, -0.02), V(0.37, 0.21, -0.01)];
  const rf = (t: number) => 0.007 + 0.055 * Math.pow(1 - t, 1.2) * Math.min(1, 0.55 + t * 4);
  head.add(tube(half, rf, 12, 5, st));
  head.add(tube(mirror(half), rf, 12, 5, st));
  const mouth = group(0, 0.09, 0.12, head);

  // the hat: about 3x his shoulders, floppy faceted brim, tall pinched crown
  const hat = group(0, 0.33, 0, head);
  hat.rotation.x = -0.05;
  const brim = mesh(brimGeo(0.13, 0.72, 11, 0.045, (a, t) =>
    t * t * (-0.035 * Math.cos(2 * a) + 0.035 * Math.sin(a) - 0.03) + t * 0.02 * Math.sin(3 * a + 0.7)), lam2(K.hat));
  hat.add(brim);
  const crown = cyl(0.11, 0.16, 0.3, 5, lam(K.hat), 0, 0.15, -0.01);
  crown.rotation.y = 0.3;
  crown.scale.z = 0.85;
  hat.add(crown);
  const pinch = cyl(0.07, 0.11, 0.035, 5, lam(K.hatShade), 0, 0.317, -0.01);
  pinch.rotation.y = 0.3;
  pinch.scale.z = 0.85;
  hat.add(pinch);
  const band = cyl(0.152, 0.162, 0.06, 5, lam(K.hatBand), 0, 0.04, -0.01);
  band.rotation.y = 0.3;
  band.scale.z = 0.87;
  hat.add(band);

  // whiskey bottle for the heal swig
  const bottle = new THREE.Group();
  bottle.add(cyl(0.045, 0.05, 0.16, 6, lam(K.bottle), 0, -0.1, 0.05));
  bottle.add(cyl(0.018, 0.022, 0.08, 5, lam(K.bottle), 0, 0.0, 0.05));
  bottle.visible = false;
  handR.add(bottle);

  return finish({
    id: 'hector', root, body, hips, torso, head, hat, armL, armR, legL, legR, hipY,
    gunHand: gun.g, gunHolster: holsterGun.g, muzzle: gun.muzzle, mouth, bottle,
    burst: [K.red, K.hat, K.stache, K.shirt],
  });
}

// ---------------------------------------------------------------- Dusty
function buildDusty(): Rig {
  const root = new THREE.Group();
  const body = group(0, 0, 0, root);
  const hipY = 0.5;
  const hips = group(0, hipY, 0, body);
  const spurGeo = starGeo(8, 0.13, 0.05, 0.025);
  const legOpts = {
    thigh: 0.24, rT: 0.13, rK: 0.11, rA: 0.1, pants: K.pants, boot: K.boot,
    bow: 0.07, shaftR: 0.1, shaftH: 0.16, footL: 0.34, footH: 0.09,
  };
  const mkLeg = (x: number): THREE.Group => {
    const { pivot, ankle } = leg(hips, x, hipY, legOpts);
    const spur = mesh(spurGeo, lam(K.spur), x > 0 ? 0.15 : -0.15, 0.11, -0.04);
    spur.rotation.y = x > 0 ? 0.5 : -0.5;
    ankle.add(spur);
    put(ankle, cyl(0.014, 0.014, 0.1, 4, lam(K.metal), x > 0 ? 0.11 : -0.11, 0.11, -0.06)).rotation.x = Math.PI / 2;
    return pivot;
  };
  const legL = mkLeg(0.19);
  const legR = mkLeg(-0.19);

  const torso = group(0, 0, 0, hips);
  // squashed egg belly
  torso.add(lathe([
    [0.06, 0.8], [0.26, 0.74], [0.4, 0.58], [0.44, 0.36], [0.41, 0.16], [0.33, 0.02], [0.22, -0.06],
  ], 8, lam(K.shirt), { sz: 0.85 }));
  // shirt placket + buttons
  torso.add(cyl(0.012, 0.012, 0.5, 4, lam(K.hatShade), 0, 0.4, 0.37));
  for (let i = 0; i < 3; i++) torso.add(mesh(new THREE.IcosahedronGeometry(0.02, 0), lam(K.woodDark), 0.03, 0.56 - i * 0.14, 0.38 - Math.abs(i - 1) * 0.0));
  put(torso, cyl(0.37, 0.36, 0.09, 8, lam(K.woodDark), 0, 0.06, 0)).scale.z = 0.88; // belt
  torso.add(box(0.13, 0.09, 0.02, lam(K.brass), 0, 0.06, 0.33)); // buckle
  torso.add(cyl(0.3, 0.26, 0.18, 7, lam(K.pants), 0, -0.04, 0)); // seat
  // flared blue coat, open front, pleated back
  const coat = lathe([
    [0.14, 0.86], [0.34, 0.78], [0.47, 0.62], [0.48, 0.36], [0.46, 0.14], [0.5, -0.06], [0.58, -0.26],
  ], 10, lam2(K.blue), { gap: 1.25, pleat: 0.1, sz: 0.88 });
  torso.add(coat);
  torso.add(tube([V(0, 0.2, -0.42), V(0, -0.05, -0.47), V(0, -0.24, -0.52)], () => 0.014, 3, 3, lam(K.blueDark)));
  // big lapels
  for (const s of [1, -1]) {
    const lap = extrude([[0, 0], [0.12, 0.08], [0.06, 0.34], [-0.02, 0.32]], 0.03, lam(K.blueDark));
    lap.position.set(s * 0.16, 0.36, 0.33);
    lap.scale.x = s;
    lap.rotation.y = s * 0.55;
    torso.add(lap);
  }
  torso.add(lathe([[0.16, 0.9], [0.22, 0.84], [0.3, 0.76]], 8, lam2(K.blueDark), { gap: 1.6 })); // collar

  const [armL] = arm(torso, 0.44, 0.62, 0.46, 0.1, 0.13, K.blue, K.blueDark, K.skin, 0.085, 3);
  const [armR, handR] = arm(torso, -0.44, 0.62, 0.46, 0.1, 0.13, K.blue, K.blueDark, K.skin, 0.085, 3);
  const gun = shotgun();
  gun.g.position.set(0, 0.06, 0.02);
  handR.add(gun.g);
  gun.g.visible = false;
  // shotgun slung on the back when holstered
  const slung = shotgun();
  slung.g.position.set(0.1, 0.45, -0.46);
  slung.g.rotation.z = 2.4;
  torso.add(slung.g);

  const head = group(0, 0.74, 0.04, torso);
  const skull = ico(0.27, lam(K.skin), 1);
  skull.scale.set(1.05, 0.9, 0.95);
  skull.position.set(0, 0.22, 0);
  head.add(skull);
  // dark hair round the back of the head (front left open for the face)
  head.add(lathe([[0.06, 0.475], [0.21, 0.43], [0.295, 0.3], [0.295, 0.16], [0.25, 0.05]], 8, lam2(K.ink), { gap: Math.PI * 1.15, sz: 0.97 }));
  head.add(mesh(new THREE.IcosahedronGeometry(0.075, 0), lam(K.skinShade), 0, 0.19, 0.26)); // bulb nose
  head.add(mesh(new THREE.IcosahedronGeometry(0.06, 0), lam(K.skin), 0.28, 0.22, 0)); // ears
  head.add(mesh(new THREE.IcosahedronGeometry(0.06, 0), lam(K.skin), -0.28, 0.22, 0));
  // huge angry V brow
  const brow = extrude([[-0.23, 0.05], [-0.2, 0.0], [0, -0.035], [0.2, 0.0], [0.23, 0.05], [0.0, 0.02]], 0.08, lam(K.ink));
  brow.position.set(0, 0.345, 0.2);
  brow.rotation.x = -0.25;
  head.add(brow);
  for (const s of [1, -1]) {
    const eye = mesh(new THREE.IcosahedronGeometry(0.05, 0), lam(K.coif), s * 0.085, 0.27, 0.235);
    eye.scale.set(1, 0.7, 0.6);
    head.add(eye);
    head.add(mesh(new THREE.IcosahedronGeometry(0.022, 0), lam(K.black), s * 0.08, 0.265, 0.268));
  }
  // big walrus mustache, drooping
  const half = [V(0.0, 0.13, 0.27), V(0.1, 0.12, 0.25), V(0.18, 0.07, 0.21), V(0.21, 0.0, 0.17)];
  const rf = (t: number) => 0.065 - 0.035 * t;
  head.add(tube(half, rf, 6, 6, lam(K.ink)));
  head.add(tube(mirror(half), rf, 6, 6, lam(K.ink)));
  // cigar
  const cigar = group(0.09, 0.07, 0.29, head);
  put(cigar, cyl(0.018, 0.02, 0.17, 5, lam(K.cigar), 0, 0, 0.06)).rotation.x = Math.PI / 2;
  put(cigar, cyl(0.021, 0.021, 0.02, 5, basic(C.flame), 0, 0, 0.15)).rotation.x = Math.PI / 2;
  cigar.rotation.set(0.25, 0.3, 0);
  const mouth = group(0.08, 0.06, 0.42, head);

  // tiny hat
  const hat = group(0, 0.43, -0.01, head);
  hat.rotation.z = 0.12;
  hat.add(mesh(brimGeo(0.11, 0.26, 9, 0.03, (a, t) => t * t * 0.07 * Math.sin(a) ** 2 - t * 0.02 * Math.cos(a)), lam2(K.hat)));
  const crown = cyl(0.09, 0.13, 0.17, 5, lam(K.hat), 0, 0.085, 0);
  crown.rotation.y = 0.3;
  hat.add(crown);
  put(hat, cyl(0.135, 0.135, 0.04, 5, lam(K.hatBand), 0, 0.03, 0)).rotation.y = 0.3;

  return finish({
    id: 'dusty', root, body, hips, torso, head, hat, armL, armR, legL, legR, hipY,
    gunHand: gun.g, gunHolster: slung.g, muzzle: gun.muzzle, mouth,
    burst: [K.blue, K.shirt, K.ink, K.hat],
  });
}

// ---------------------------------------------------------------- Mercy
function buildMercy(): Rig {
  const root = new THREE.Group();
  const body = group(0, 0, 0, root);
  const hipY = 0.82;
  const hips = group(0, hipY, 0, body);
  // legs hidden under the habit; only shoes poke out
  const mkLeg = (x: number): THREE.Group => {
    const l = group(x, 0, 0, hips);
    l.add(cyl(0.04, 0.04, hipY * 0.8, 4, lam(K.habit), 0, -hipY * 0.5, 0, false));
    put(l, bootFoot(0.2, 0.07, 0.1, lam(K.black))).position.set(0, -hipY, 0.03);
    return l;
  };
  const legL = mkLeg(0.09);
  const legR = mkLeg(-0.09);
  // bell-shaped habit hangs from the hips, pleated at the hem
  const robe = lathe([
    [0.19, 0.06], [0.22, -0.12], [0.27, -0.4], [0.36, -0.68], [0.45, -0.8],
  ], 9, lam(K.habit), { pleat: 0.08 });
  hips.add(robe);

  const torso = group(0, 0, 0, hips);
  torso.add(lathe([[0.07, 0.66], [0.16, 0.62], [0.21, 0.5], [0.19, 0.24], [0.18, 0.0]], 8, lam(K.habit)));
  torso.add(cyl(0.2, 0.2, 0.05, 8, lam(K.ink), 0, 0.04, 0)); // cord belt
  // white collar bib, pointed in front
  const bib = lathe([[0.07, 0.7], [0.18, 0.62], [0.235, 0.52]], 8, lam2(K.coif));
  const bp = bib.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < bp.count; i++) {
    const z = bp.getZ(i);
    if (z > 0.1) bp.setY(i, bp.getY(i) - (z - 0.1) * 0.6);
  }
  bib.geometry.computeVertexNormals();
  torso.add(bib);
  // gold rosary: bead loop down the front + cross
  const gold = lam(K.brass);
  const bead = new THREE.IcosahedronGeometry(0.02, 0);
  for (let i = 0; i < 11; i++) {
    const t = i / 10;
    torso.add(mesh(bead, gold, Math.sin(t * Math.PI) * 0.09 - 0.04, 0.55 - t * 0.4, 0.2 + Math.sin(t * Math.PI) * 0.02, false));
  }
  const crossShape: [number, number][] = [
    [-0.012, -0.08], [0.012, -0.08], [0.012, 0.0], [0.04, 0.0], [0.04, 0.024], [0.012, 0.024],
    [0.012, 0.05], [-0.012, 0.05], [-0.012, 0.024], [-0.04, 0.024], [-0.04, 0.0], [-0.012, 0.0],
  ];
  put(torso, extrude(crossShape, 0.02, gold)).position.set(-0.04, 0.07, 0.22);
  // dangling rosary at the belt
  for (let i = 0; i < 6; i++) torso.add(mesh(bead, gold, 0.17 + Math.sin(i) * 0.01, 0.02 - i * 0.055, 0.12, false));
  put(torso, extrude(crossShape, 0.02, gold)).position.set(0.17, -0.34, 0.12);

  const [armL] = arm(torso, 0.23, 0.56, 0.58, 0.07, 0.14, K.habit, K.habitDark, K.skin, 0.055, 3);
  const [armR, handR] = arm(torso, -0.23, 0.56, 0.58, 0.07, 0.14, K.habit, K.habitDark, K.skin, 0.055, 3);

  // Bible with hidden lantern, held in right hand; barrel axis is -y like the guns
  const bible = new THREE.Group();
  bible.position.set(0, 0.0, 0.06);
  handR.add(bible);
  bible.add(box(0.05, 0.3, 0.22, lam(K.book), 0, -0.12, 0));
  const coverL = new THREE.Group();
  coverL.position.set(0.025, -0.12, 0.0);
  coverL.add(box(0.03, 0.3, 0.22, lam(K.book), 0.04, 0, 0));
  const cc = extrude(crossShape, 0.02, gold);
  cc.rotation.y = Math.PI / 2;
  cc.scale.setScalar(1.3);
  cc.position.set(0.06, 0.02, 0);
  coverL.add(cc);
  const coverR = new THREE.Group();
  coverR.position.set(-0.025, -0.12, 0.0);
  coverR.add(box(0.03, 0.3, 0.22, lam(K.book), -0.04, 0, 0));
  bible.add(coverL, coverR);
  bible.add(box(0.05, 0.27, 0.2, lam(K.paper), 0, -0.12, 0)); // pages
  const lantern = new THREE.Group();
  lantern.position.set(0, -0.14, 0.0);
  put(lantern, cyl(0.02, 0.065, 0.04, 4, lam(K.black), 0, 0.075, 0)).rotation.y = Math.PI / 4;
  put(lantern, cyl(0.06, 0.06, 0.025, 4, lam(K.black), 0, -0.065, 0)).rotation.y = Math.PI / 4;
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) lantern.add(cyl(0.006, 0.006, 0.13, 3, lam(K.black), x * 0.04, 0, z * 0.04));
  const glow = mesh(new THREE.OctahedronGeometry(0.05, 0), basic(C.flameCore), 0, 0, 0, false);
  glow.scale.y = 1.3;
  lantern.add(glow);
  bible.add(lantern);
  const muzzle = group(0, -0.34, 0, bible);

  // head: oval face inside a white coif
  const head = group(0, 0.66, 0, torso);
  const face = cyl(0.1, 0.07, 0.26, 6, lam(K.skin), 0, 0.17, 0.04);
  face.scale.z = 0.9;
  head.add(face);
  head.add(box(0.05, 0.012, 0.02, lam(K.ink), 0.045, 0.19, 0.125)); // closed eyes
  head.add(box(0.05, 0.012, 0.02, lam(K.ink), -0.045, 0.19, 0.125));
  head.add(box(0.04, 0.012, 0.02, lam(K.redDark), 0, 0.08, 0.115)); // calm mouth
  head.add(lathe([[0.03, 0.37], [0.14, 0.33], [0.165, 0.18], [0.155, 0.02], [0.19, -0.06]], 7, lam2(K.coif), { gap: 1.5 }));

  // pointed hood (acts as the 'hat' so it can fly off on a loss)
  const hat = new THREE.Group();
  hat.position.set(0, 0.36, -0.02);
  hat.add(lathe([
    [0.0, 0.14], [0.17, 0.0], [0.21, -0.2], [0.27, -0.46], [0.3, -0.62],
  ], 6, lam2(K.habit), { gap: 2.2, sz: 0.85, rot: 0 }));
  head.add(hat);
  const mouth = group(0, 0.08, 0.16, head);

  // halo: flat ring behind the head + glow disc
  const halo = new THREE.Group();
  halo.position.set(0, 0.24, -0.16);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.025, 4, 12), basic(C.gold));
  halo.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 12),
    new THREE.MeshBasicMaterial({ color: C.flameCore, transparent: true, opacity: 0.35, depthWrite: false }),
  );
  disc.position.z = -0.02;
  halo.add(disc);
  halo.visible = false;
  head.add(halo);

  // two candle pips above her head showing charge
  const pips: THREE.Mesh[] = [];
  const pipGroup = group(0, 0.78, 0, head);
  for (const x of [-0.1, 0.1]) {
    pipGroup.add(box(0.05, 0.1, 0.05, lam(C.cream), x, 0, 0, false));
    const flame = box(0.04, 0.06, 0.04, basic(C.flame), x, 0.08, 0, false);
    flame.visible = false;
    pipGroup.add(flame);
    pips.push(flame);
  }

  return finish({
    id: 'mercy', root, body, hips, torso, head, hat, armL, armR, legL, legR, hipY,
    gunHand: bible, gunHolster: null, muzzle, mouth,
    coverL, coverR, lanternGlow: glow, halo, pips,
    burst: [K.habit, K.coif, C.gold, C.cream],
  });
}

export function buildCharacter(id: CharacterId): Rig {
  if (id === 'hector') return buildHector();
  if (id === 'dusty') return buildDusty();
  return buildMercy();
}
