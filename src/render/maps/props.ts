// Reusable prop builders. Each returns a Prop: (world) => void, so a map is a list of calls.
import * as THREE from 'three';
import type { Prop } from './types';
import type { World } from '../world';
import { C, lam, basic, box, cyl, ico, starGeo } from '../materials';
import { planks, shingles, stone, dirt, street as streetTex, texMat, texBox } from '../textures';
import { rand } from '../fx';

type V3 = [number, number, number];

/** x of the building fronts (outer edge of the boardwalk) at depth z: the street narrows toward the end. */
export function frontX(z: number): number {
  return 9.2 + z * 0.035;
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ ground

/** Big textured ground plane. */
export const ground = (color: number, size = 160, repeat = 70, seed = 5): Prop => (w) => {
  const t = dirt(color, seed).clone();
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: t }));
  m.rotation.x = -Math.PI / 2;
  m.receiveShadow = true;
  w.group.add(m);
};

/** Rutted street strip down the middle. */
export const street = (color: number, width = 8, length = 96, z = -30): Prop => (w) => {
  const t = streetTex(color).clone();
  t.repeat.set(1, 12);
  t.needsUpdate = true;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(width, length), new THREE.MeshLambertMaterial({ map: t }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.006, z);
  m.receiveShadow = true;
  w.group.add(m);
};

// ------------------------------------------------------------------ lights

/** Hanging lantern: iron frame, glowing glass, a soft glow and a warm point light. */
export function addLantern(w: World, x: number, z: number, y = 2.85, scale = 1.9, range = 5): void {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.scale.setScalar(scale);
  const iron = lam(0x231b19);
  g.add(box(0.03, 0.22, 0.03, iron, 0, -0.04, 0, false));
  g.add(box(0.06, 0.06, 0.06, iron, 0, -0.17, 0, false));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.12, 4), iron);
  cap.rotation.y = Math.PI / 4;
  cap.position.y = -0.24;
  g.add(cap);
  g.add(box(0.22, 0.04, 0.22, iron, 0, -0.52, 0, false));
  const flame = box(0.15, 0.24, 0.15, basic(0xf9d8b0), 0, -0.38, 0, false);
  g.add(flame);
  g.add(box(0.06, 0.1, 0.06, basic(0xd9a33a), 0, -0.42, 0, false));
  for (const [dx, dz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]] as const) g.add(box(0.025, 0.3, 0.025, iron, dx, -0.38, dz, false));
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(0.19, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xf8c08f, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  glow.position.y = -0.38;
  g.add(glow);
  const light = new THREE.PointLight(0xffc070, w.lanternBase, range, 1.6);
  light.position.set(0, -0.4, 0);
  g.add(light);
  w.lanterns.push({ flame, glow, light, dim: 1 });
  w.group.add(g);
}

export const lantern = (x: number, z: number, y = 2.85, scale = 1.9, range = 5): Prop => (w) => addLantern(w, x, z, y, scale, range);

/** Wooden lamp post with an iron bracket arm and a hanging lantern. */
export const lampPost = (x: number, z: number, armDir: number, range = 5): Prop => (w) => {
  const wood = texMat(planks(0x634337, true));
  w.group.add(texBox(0.2, 3.2, 0.2, wood, x, 1.6, z, 1));
  w.group.add(box(0.8, 0.07, 0.07, lam(0x231b19), x + armDir * 0.38, 3.0, z));
  const brace = box(0.55, 0.05, 0.05, lam(0x231b19), x + armDir * 0.2, 2.78, z);
  brace.rotation.z = armDir * 0.7;
  w.group.add(brace);
  addLantern(w, x + armDir * 0.72, z, 2.95, 1.8, range);
};

/** Fake 'flicker': every lantern sputters, dips almost out, and recovers. */
export const flickerFake = (): Prop => (w) => {
  let ft = 99;
  w.fakes.flicker = () => { ft = 0; };
  w.animators.push((_t, dt) => {
    ft += dt;
    const on = ft < 1.5;
    for (let i = 0; i < w.lanterns.length; i++) {
      const l = w.lanterns[i];
      if (!on) { l.dim += (1 - l.dim) * Math.min(1, dt * 8); continue; }
      // stuttering square-ish wave that bottoms out mid-way
      const s = Math.sin(ft * 47 + i) * Math.sin(ft * 13.1);
      const deep = ft > 0.45 && ft < 0.85 ? 0.04 : 0.25;
      l.dim = s > 0.1 ? 1 : deep;
    }
  });
};

// ------------------------------------------------------------------ town

export interface BuildingOpts {
  sign?: string;
  star?: boolean;
  horseshoe?: boolean;
  /** Swinging saloon doors (they drive the 'door' fake). */
  doors?: boolean;
  lantern?: 'near' | 'far';
}

/** Western storefront along the street: body, false front, boardwalk, awning, windows, sign. */
export const building = (side: number, zc: number, len: number, h: number, wall: number, o: BuildingOpts = {}): Prop => (w) => {
  const g = w.group;
  const fx = frontX(zc);
  const depth = 5;
  const wallMat = texMat(planks(wall, true));
  g.add(texBox(depth, h, len - 0.3, wallMat, side * (fx + depth / 2), h / 2, zc, 2));
  const ffH = h + 1.3;
  g.add(texBox(0.26, ffH, len - 0.05, wallMat, side * (fx + 0.13), ffH / 2, zc, 2));
  g.add(texBox(0.45, 0.25, len + 0.15, texMat(planks(0x4f3322, false)), side * (fx + 0.1), ffH + 0.05, zc, 1));
  g.add(texBox(depth + 0.4, 0.2, len - 0.1, texMat(shingles(0x4f3322)), side * (fx + depth / 2 + 0.2), h + 0.1, zc, 2));
  g.add(texBox(2.1, 0.3, len, texMat(planks(0xa3743f, false)), side * (fx - 1.05), 0.15, zc, 1.5));
  g.add(texBox(0.45, 0.15, 1.2, texMat(planks(0x7a5232, false)), side * (fx - 2.3), 0.075, zc - len / 2 + 1, 1));
  const aw = texBox(2.4, 0.14, len, texMat(shingles(0x7a5232)), side * (fx - 1.1), 3.0, zc, 2);
  aw.rotation.z = -side * 0.1;
  g.add(aw);
  const postMat = texMat(planks(0x7a5232, true));
  for (const pz of [zc - len / 2 + 0.3, zc, zc + len / 2 - 0.3]) g.add(texBox(0.16, 2.9, 0.16, postMat, side * (fx - 2.05), 1.45, pz, 1));

  const dark = lam(0x14100e);
  const frame = lam(0xf3e6c4);
  const facadeX = side * (fx - 0.01);
  for (const wz of [zc - len * 0.3, zc + len * 0.3]) {
    for (const wy of [1.55, h - 0.7]) {
      g.add(box(0.05, 0.98, 0.84, frame, facadeX, wy, wz, false));
      g.add(box(0.07, 0.86, 0.72, dark, facadeX, wy, wz, false));
      g.add(box(0.09, 0.05, 0.72, frame, facadeX, wy, wz, false));
    }
  }
  g.add(box(0.06, 2.2, 1.1, dark, facadeX, 1.1 + 0.3, zc, false));
  if (o.doors) {
    const mkDoor = (dz: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(side * (fx - 0.06), 1.5, zc + dz);
      pivot.add(texBox(0.06, 0.9, 0.5, texMat(planks(0xc69a62, true)), 0, 0, -Math.sign(dz) * 0.25, 0.5));
      g.add(pivot);
      return pivot;
    };
    swingDoors(w, mkDoor(0.52), mkDoor(-0.52), 'y');
  }
  if (o.sign) {
    const sw = Math.min(len * 0.82, 0.55 * o.sign.length + 1.4);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / 5), new THREE.MeshLambertMaterial({ map: signBoard(o.sign, !!o.horseshoe) }));
    m.position.set(side * (fx - 0.03), h + 0.45, zc);
    m.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(m);
  }
  if (o.star) {
    const star = new THREE.Mesh(starGeo(5, 0.85, 0.36, 0.12), lam(0xd9a33a));
    star.position.set(side * (fx - 0.08), h - 0.55, zc);
    star.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    star.castShadow = true;
    g.add(star);
    const bz = zc + len / 2 - 0.5;
    const bx = side * (fx - 0.95);
    g.add(box(1.7, 0.1, 0.1, lam(0x231b19), side * (fx - 0.85), h - 0.05, bz));
    g.add(texBox(1.5, 1.5, 0.1, texMat(planks(0x40302a, false)), bx, h - 0.95, bz, 1));
    for (const dz of [0.07, -0.07]) {
      const s2 = new THREE.Mesh(starGeo(5, 0.6, 0.25, 0.05), lam(0xd9a33a));
      s2.position.set(bx, h - 0.95, bz + dz);
      if (dz < 0) s2.rotation.y = Math.PI;
      g.add(s2);
    }
  }
  if (o.lantern) addLantern(w, side * (fx - 1.95), o.lantern === 'far' ? zc - len / 2 + 0.6 : zc + len / 2 - 0.6);
};

/** Spring-loaded pair of swinging doors; the 'door' fake kicks them open. */
export function swingDoors(w: World, l: THREE.Object3D, r: THREE.Object3D, axis: 'y'): void {
  let ang = 0;
  let vel = 0;
  w.fakes.door = () => { vel += 14; };
  w.animators.push((_t, dt) => {
    vel += -ang * 60 * dt;
    vel *= Math.exp(-2.5 * dt);
    ang += vel * dt;
    l.rotation[axis] = ang;
    r.rotation[axis] = -ang;
  });
}

/** Horse tied up side-on, idly nodding and flicking its tail. */
export const horse = (x: number, z: number, rotY = Math.PI / 2): Prop => (w) => {
  const h = new THREE.Group();
  h.position.set(x, 0, z);
  h.rotation.y = rotY;
  const coat = lam(0x7a5232);
  const dark = lam(0x2e1f17);
  h.add(box(0.55, 0.62, 1.5, coat, 0, 1.25, 0));
  for (const [lx, lz] of [[-0.18, 0.55], [0.18, 0.55], [-0.18, -0.55], [0.18, -0.55]] as const) {
    h.add(box(0.15, 0.95, 0.16, coat, lx, 0.5, lz));
    h.add(box(0.17, 0.12, 0.2, dark, lx, 0.06, lz + 0.02));
  }
  h.add(box(0.6, 0.12, 0.6, lam(0x8c2a1e), 0, 1.6, 0));
  h.add(box(0.4, 0.14, 0.42, lam(0x4f3322), 0, 1.69, 0));
  const neck = new THREE.Group();
  neck.position.set(0, 1.45, 0.65);
  const n = box(0.3, 0.75, 0.32, coat, 0, 0.3, 0.12);
  n.rotation.x = 0.55;
  neck.add(n);
  neck.add(box(0.08, 0.6, 0.22, dark, 0, 0.36, -0.02).rotateX(0.55));
  const head = box(0.26, 0.28, 0.62, coat, 0, 0.66, 0.5);
  head.rotation.x = 0.35;
  neck.add(head);
  neck.add(box(0.06, 0.14, 0.06, coat, 0.09, 0.88, 0.32));
  neck.add(box(0.06, 0.14, 0.06, coat, -0.09, 0.88, 0.32));
  h.add(neck);
  const tail = new THREE.Group();
  tail.position.set(0, 1.4, -0.75);
  const t = box(0.12, 0.7, 0.12, dark, 0, -0.3, -0.1);
  t.rotation.x = -0.3;
  tail.add(t);
  h.add(tail);
  w.group.add(h);
  w.animators.push((tt) => {
    neck.rotation.x = Math.sin(tt * 0.9) * 0.08 + (Math.sin(tt * 0.31) > 0.9 ? 0.25 : 0);
    tail.rotation.z = Math.sin(tt * 2.3) * 0.25 * (Math.sin(tt * 0.5) > 0.3 ? 1 : 0.2);
  });
};

/** Hitching rail with a water trough beside it. */
export const hitchingRail = (x0: number, z: number): Prop => (w) => {
  const g = w.group;
  for (const x of [x0, x0 + 3.2]) g.add(texBox(0.16, 1.15, 0.16, texMat(planks(0x634337, true)), x, 0.57, z, 1));
  g.add(texBox(3.6, 0.12, 0.12, texMat(planks(0xad7658, false)), x0 + 1.6, 1.05, z, 1));
  g.add(texBox(1.8, 0.55, 0.7, texMat(planks(0x634337, false)), x0 - 1.6, 0.28, z + 0.6, 1));
  g.add(box(1.64, 0.04, 0.54, lam(0x69819d), x0 - 1.6, 0.53, z + 0.6, false));
};

export const barrel = (x: number, z: number, y?: number): Prop => (w) => {
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.9, 10), texMat(planks(0x8a5a34, true)));
  b.position.set(x, y ?? 0.45 + 0.3 * (Math.abs(x) > frontX(z) - 2.2 ? 1 : 0), z);
  b.castShadow = true;
  b.receiveShadow = true;
  w.group.add(b);
  for (const ry of [-0.28, 0.28]) b.add(cyl(0.355, 0.355, 0.06, 10, lam(0x2e1f17), 0, ry, 0, false));
};

export const crate = (x: number, z: number, s: number, y = 0): Prop => (w) => {
  const c = texBox(s, s, s, texMat(planks(0xa3743f, false)), x, y + s / 2, z, s);
  c.rotation.y = (x * 7 + z) % 0.5;
  const brace = box(s * 1.02, 0.06, s * 0.08, lam(0x4f3322), 0, 0, 0, false);
  brace.rotation.z = Math.PI / 4;
  brace.scale.set(1.35, 1, 1.02);
  c.add(brace);
  w.group.add(c);
};

/** Short rail fence running along z (posts plus two rails). */
export const fenceZ = (x: number, z0: number, posts: number, step = 1.0, color = 0xae9386): Prop => (w) => {
  for (let i = 0; i < posts; i++) w.group.add(texBox(0.12, 1.1, 0.12, texMat(planks(color, true)), x, 0.55, z0 - i * step, 1));
  const len = (posts - 1) * step + 0.4;
  for (const y of [0.45, 0.9]) w.group.add(texBox(0.08, 0.1, len, texMat(planks(color, false)), x, y, z0 - ((posts - 1) * step) / 2, 1));
};

/** Rail fence running along x, from x0 for `len`. */
export const fenceX = (x0: number, z: number, len: number, color = 0xae9386): Prop => (w) => {
  const n = Math.max(2, Math.round(len / 1.3) + 1);
  for (let i = 0; i < n; i++) w.group.add(texBox(0.12, 1.0, 0.12, texMat(planks(color, true)), x0 + (i * len) / (n - 1), 0.5, z, 1));
  for (const y of [0.4, 0.8]) w.group.add(texBox(len, 0.1, 0.08, texMat(planks(color, false)), x0 + len / 2, y, z, 1));
};

/** Crow perched at `at`; the 'crow' fake makes it hop, flap and caw. */
export const crow = (at: V3): Prop => (w) => {
  const c = new THREE.Group();
  const home = new THREE.Vector3(...at);
  c.position.copy(home);
  c.rotation.y = -1.6;
  c.add(box(0.14, 0.14, 0.3, lam(C.crow), 0, 0.12, 0));
  c.add(box(0.12, 0.12, 0.12, lam(C.crow), 0, 0.24, 0.16));
  const beak = box(0.04, 0.04, 0.12, lam(C.woodGray), 0, 0.23, 0.27, false);
  c.add(beak);
  c.add(box(0.08, 0.03, 0.16, lam(C.crow), 0, 0.12, -0.2));
  const wl = new THREE.Group();
  wl.position.set(0.07, 0.16, 0);
  wl.add(box(0.26, 0.03, 0.2, lam(C.crow), 0.11, 0, 0));
  const wr = new THREE.Group();
  wr.position.set(-0.07, 0.16, 0);
  wr.add(box(0.26, 0.03, 0.2, lam(C.crow), -0.11, 0, 0));
  c.add(wl, wr);
  w.group.add(c);
  let ct = 99;
  w.fakes.crow = () => { ct = 0; };
  w.animators.push((t, dt) => {
    ct += dt;
    if (ct < 1.6) {
      const hop = ct < 1.2 ? Math.sin((ct / 1.2) * Math.PI) * 0.9 : 0;
      c.position.set(home.x, home.y + hop, home.z);
      const flap = ct < 1.25 ? Math.sin(ct * 40) * 0.9 : 0;
      wl.rotation.z = flap;
      wr.rotation.z = -flap;
      beak.rotation.x = ct < 0.5 ? -Math.abs(Math.sin(ct * 18)) * 0.5 : 0;
    } else {
      c.position.copy(home);
      wl.rotation.z = 0;
      wr.rotation.z = 0;
      beak.rotation.x = 0;
      c.rotation.y = 1.2 + (Math.sin(t * 0.7) > 0.95 ? 0.6 : 0);
    }
  });
};

/** The 'tumbleweed' fake: one rolls across in front of the rival. */
export const tumbleweed = (z = -1.2): Prop => (w) => {
  const weed = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshLambertMaterial({ color: 0xa3743f, wireframe: true }));
  weed.add(ico(0.3, lam(0x7a5232)));
  weed.visible = false;
  weed.castShadow = true;
  w.group.add(weed);
  let k = 99;
  w.fakes.tumbleweed = () => { k = 0; weed.visible = true; };
  w.animators.push((_t, dt) => {
    if (!weed.visible) return;
    k += dt / 2.6;
    if (k >= 1) { weed.visible = false; return; }
    weed.position.set(-9 + k * 18, 0.45 + Math.abs(Math.sin(k * Math.PI * 5)) * 0.5, z);
    weed.rotation.z = -k * 22;
    weed.rotation.x = k * 4;
  });
};

/** The 'cough' fake: a head pops up in a window at `at`, shakes and puffs. */
export const cougher = (at: V3): Prop => (w) => {
  const c = new THREE.Group();
  const base = new THREE.Vector3(...at);
  c.position.copy(base);
  c.add(box(0.12, 0.24, 0.22, lam(C.skin), 0, 0.12, 0, false));
  c.add(box(0.14, 0.05, 0.36, lam(C.hat), 0, 0.27, 0, false));
  c.add(box(0.14, 0.1, 0.16, lam(C.hat), 0, 0.33, 0, false));
  c.visible = false;
  w.group.add(c);
  let ck = 99;
  let cool = 0;
  w.fakes.cough = () => { ck = 0; c.visible = true; };
  w.animators.push((_t, dt) => {
    ck += dt;
    cool -= dt;
    if (!c.visible) return;
    if (ck > 1.6) { c.visible = false; return; }
    const up = Math.min(1, ck * 6) * Math.min(1, (1.6 - ck) * 6);
    c.position.y = base.y - 0.3 + up * 0.35;
    c.rotation.z = Math.sin(ck * 30) * 0.15 * (ck > 0.2 && ck < 1.0 ? 1 : 0);
    if (ck > 0.25 && ck < 1.0 && cool <= 0) {
      cool = 0.18;
      w.particles.spawn({ pos: c.position.clone().add(new THREE.Vector3(-0.3, 0.15, 0)), vel: new THREE.Vector3(rand(-1.2, -0.6), rand(0, 0.4), rand(-0.3, 0.3)), color: C.smoke, size: 0.14, life: 0.8, grow: 2, drag: 2, shape: 'puff' });
    }
  });
};

export const shrub = (x: number, z: number, s: number): Prop => (w) => {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  const cols = [0x7a5232, 0x5b6b3a, 0xa3743f];
  for (let i = 0; i < 5; i++) {
    const m = ico(0.22, lam(cols[i % 3]));
    m.position.set(Math.sin(i * 2.3) * 0.25, 0.18 + (i % 2) * 0.12, Math.cos(i * 1.7) * 0.25);
    g.add(m);
  }
  w.group.add(g);
};

/** Scatter of dry shrubs, seeded; `xAt(z, side, r)` picks the x. */
export const shrubs = (n: number, seed: number, zMin: number, zMax: number, xAt: (z: number, side: number, r: () => number) => number): Prop => (w) => {
  const r = mulberry(seed);
  for (let i = 0; i < n; i++) {
    const z = zMax - r() * (zMax - zMin);
    const side = r() > 0.5 ? 1 : -1;
    shrub(xAt(z, side, r), z, 0.5 + r() * 0.4)(w);
  }
};

export const cactus = (x: number, z: number, s: number, col = 0x5b6b3a): Prop => (w) => {
  const cg = new THREE.Group();
  cg.position.set(x, 0, z);
  cg.scale.setScalar(s);
  const gm = lam(col);
  cg.add(cyl(0.22, 0.25, 2.6, 6, gm, 0, 1.3, 0));
  cg.add(cyl(0.15, 0.15, 0.6, 6, gm, 0.45, 1.3, 0).rotateZ(Math.PI / 2));
  cg.add(cyl(0.14, 0.15, 0.9, 6, gm, 0.7, 1.75, 0));
  cg.add(cyl(0.15, 0.15, 0.5, 6, gm, -0.4, 1.0, 0).rotateZ(Math.PI / 2));
  cg.add(cyl(0.13, 0.14, 0.7, 6, gm, -0.6, 1.35, 0));
  w.group.add(cg);
};

/** Tiered, flat-topped butte (horizon mesa). */
export const butte = (x: number, z: number, wd: number, h: number, col: number, depth = 0.45): Prop => (w) => {
  const bg = new THREE.Group();
  bg.position.set(x, 0, z);
  bg.scale.set(1, 1, depth);
  const m = lam(col);
  const tier = (rBot: number, rTop: number, y0: number, ht: number): void => {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, ht, 7), m);
    t.position.y = y0 + ht / 2;
    bg.add(t);
  };
  tier(wd, wd * 0.86, 0, h * 0.22);
  tier(wd * 0.78, wd * 0.74, h * 0.22, h * 0.38);
  tier(wd * 0.7, wd * 0.62, h * 0.6, h * 0.08);
  tier(wd * 0.5, wd * 0.47, h * 0.68, h * 0.32);
  w.group.add(bg);
};

/** Low faceted boulder. */
export const rock = (x: number, z: number, s: number, col: number): Prop => (w) => {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), lam(col));
  m.position.set(x, s * 0.45, z);
  m.scale.set(1.3, 0.75, 1);
  m.rotation.y = x * 3.1 + z;
  m.castShadow = true;
  m.receiveShadow = true;
  w.group.add(m);
};

/** Wooden water tower on four braced legs. */
export const waterTower = (x: number, z: number, s = 1): Prop => (w) => {
  const wt = new THREE.Group();
  wt.position.set(x, 0, z);
  wt.scale.setScalar(s);
  const legM = texMat(planks(0x40302a, true));
  for (const [lx, lz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]] as const) wt.add(texBox(0.24, 7.4, 0.24, legM, lx, 3.7, lz, 1));
  for (const y of [2.2, 5.0]) {
    const b1 = texBox(3.3, 0.14, 0.12, legM, 0, y, 1.25, 1);
    b1.rotation.z = 0.7;
    const b2 = texBox(3.3, 0.14, 0.12, legM, 0, y, 1.25, 1);
    b2.rotation.z = -0.7;
    wt.add(b1, b2);
  }
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 2.9, 10), texMat(planks(0x8f5843, true)));
  tank.position.set(0, 8.8, 0);
  tank.castShadow = true;
  wt.add(tank);
  for (const y of [7.8, 9.8]) wt.add(cyl(2.03, 2.03, 0.12, 10, lam(0x231b19), 0, y, 0, false));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.3, 10), texMat(shingles(0x634337)));
  roof.position.set(0, 10.9, 0);
  wt.add(roof);
  w.group.add(wt);
};

// ------------------------------------------------------------------ bells

/** Brass bell hung from a pivot at (x, y, z); it becomes the map's bell. */
export function hangBell(w: World, parent: THREE.Object3D, x: number, y: number, z: number, s = 1): THREE.Group {
  const bell = new THREE.Group();
  bell.position.set(x, y, z);
  bell.scale.setScalar(s);
  bell.add(cyl(0.48, 0.9, 1.2, 12, lam(0xd9a33a), 0, -0.68, 0));
  bell.add(cyl(0.94, 0.94, 0.12, 12, lam(0x8f5843), 0, -1.25, 0));
  bell.add(box(0.2, 0.25, 0.2, lam(0x40302a), 0, -1.45, 0));
  parent.add(bell);
  w.bell = bell;
  return bell;
}

/**
 * Stone church centred at the end of the street: gabled nave, square tower with an open belfry,
 * big brass bell, shingled cap and a cross. Tower centre at world z = towerZ.
 */
export const church = (towerZ: number): Prop => (w) => {
  const c = new THREE.Group();
  const frontZ = towerZ - 0.8;
  c.position.set(0, 0, frontZ);
  const st = texMat(stone(0x8f93a3));
  const dark = lam(0x231b19);
  const naveW = 9;
  const naveD = 9;
  const wallH = 4.6;
  c.add(texBox(naveW, wallH, naveD, st, 0, wallH / 2, -naveD / 2, 1.5));
  const gableH = 3.2;
  const tri = new THREE.Shape();
  tri.moveTo(-naveW / 2, 0);
  tri.lineTo(naveW / 2, 0);
  tri.lineTo(0, gableH);
  tri.closePath();
  const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: naveD, bevelEnabled: false }), st);
  gable.position.set(0, wallH, -naveD);
  gable.castShadow = true;
  gable.receiveShadow = true;
  c.add(gable);
  const slope = Math.atan2(gableH, naveW / 2);
  const slopeLen = Math.hypot(gableH, naveW / 2) + 0.4;
  for (const sd of [-1, 1]) {
    const r = texBox(slopeLen, 0.22, naveD + 0.6, texMat(shingles(0x634337)), sd * naveW / 4, wallH + gableH / 2 + 0.12, -naveD / 2, 1.5);
    r.rotation.z = -sd * slope;
    c.add(r);
  }
  const pointed = (x: number, y: number, pw: number, ph: number, z: number): void => {
    c.add(box(pw, ph, 0.1, dark, x, y, z, false));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(pw * 0.72, pw * 0.7, 4), dark);
    cap.rotation.y = Math.PI / 4;
    cap.scale.z = 0.1;
    cap.position.set(x, y + ph / 2 + pw * 0.3, z);
    c.add(cap);
  };
  pointed(-2.8, 2.6, 0.7, 1.4, 0.06);
  pointed(2.8, 2.6, 0.7, 1.4, 0.06);
  const tw = 3.0;
  const towerH = 8.6;
  const tz = towerZ - frontZ;
  c.add(texBox(tw, towerH, tw, st, 0, towerH / 2, tz, 1.5));
  c.add(box(1.4, 2.3, 0.1, lam(0x40302a), 0, 1.15, tz + tw / 2 + 0.02, false));
  const doorCap = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.1, 10, 1, false, 0, Math.PI), lam(0x40302a));
  doorCap.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  doorCap.position.set(0, 2.3, tz + tw / 2 + 0.02);
  c.add(doorCap);
  pointed(0, 5.6, 0.6, 1.1, tz + tw / 2 + 0.02);
  c.add(texBox(2.6, 0.18, 0.6, st, 0, 0.09, tz + tw / 2 + 0.3, 1));
  c.add(texBox(2.2, 0.18, 0.4, st, 0, 0.27, tz + tw / 2 + 0.2, 1));
  const by = towerH;
  for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]] as const) c.add(texBox(0.36, 2.8, 0.36, texMat(planks(0x634337, true)), x, by + 1.4, tz + z, 1));
  c.add(texBox(3.4, 0.36, 3.4, texMat(planks(0x40302a, false)), 0, by + 2.95, tz, 1.5));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.9, 4), texMat(shingles(0x634337)));
  cap.rotation.y = Math.PI / 4;
  cap.position.set(0, by + 4.05, tz);
  c.add(cap);
  c.add(box(0.16, 1.4, 0.16, dark, 0, by + 5.6, tz));
  c.add(box(0.8, 0.16, 0.16, dark, 0, by + 5.85, tz));
  hangBell(w, c, 0, by + 2.75, tz);
  w.group.add(c);
};

/** Tall timber fire-bell tower: four braced legs, a small roof, bell hung at height `y`. */
export const bellTrestle = (z: number, y: number, wood = 0x40302a): Prop => (w) => {
  const g = new THREE.Group();
  g.position.set(0, 0, z);
  const m = texMat(planks(wood, true));
  const top = y + 0.5;
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    const leg = texBox(0.2, top + 0.2, 0.2, m, lx * 1.1, (top + 0.2) / 2, lz * 1.1, 1);
    g.add(leg);
  }
  for (let yy = 1.6; yy < top - 1.5; yy += 2.3) {
    for (const s of [-1, 1]) {
      const b = texBox(2.9, 0.12, 0.1, m, 0, yy + 1, 1.15, 1);
      b.rotation.z = s * 0.66;
      g.add(b);
    }
    g.add(texBox(2.4, 0.12, 0.12, m, 0, yy, 1.15, 1));
  }
  g.add(texBox(2.8, 0.25, 2.8, texMat(planks(0x231b19, false)), 0, top + 0.3, 0, 1));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(2.1, 1.3, 4), texMat(shingles(0x40302a)));
  cap.rotation.y = Math.PI / 4;
  cap.position.set(0, top + 1.05, 0);
  g.add(cap);
  hangBell(w, g, 0, top, 0, 0.8);
  w.group.add(g);
};

/** Adobe mission bell gable (espadaña): a stepped wall with an arched opening and a bell. */
export const missionGable = (z: number, y: number, col = 0xc8835a): Prop => (w) => {
  const g = new THREE.Group();
  g.position.set(0, 0, z);
  const m = lam(col);
  const wd = 4.4;
  const h = y + 1.2;
  // wall either side of the opening, lintel above, stepped top
  g.add(box(1.4, h, 0.9, m, -1.5, h / 2, 0));
  g.add(box(1.4, h, 0.9, m, 1.5, h / 2, 0));
  g.add(box(1.6, y - 2.0, 0.9, m, 0, (y - 2.0) / 2, 0));
  g.add(box(wd, 0.9, 0.9, m, 0, h + 0.45, 0));
  g.add(box(2.6, 0.8, 0.9, m, 0, h + 1.3, 0));
  const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.9, 10, 1, false, 0, Math.PI), m);
  arch.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  arch.position.set(0, h, 0);
  g.add(arch);
  g.add(box(0.14, 1.0, 0.14, lam(0x231b19), 0, h + 2.2, 0));
  g.add(box(0.6, 0.14, 0.14, lam(0x231b19), 0, h + 2.35, 0));
  // crumbling side walls
  g.add(box(5, 2.2, 0.7, m, -4.6, 1.1, -0.6));
  g.add(box(3.2, 1.4, 0.7, m, 4.2, 0.7, -0.6));
  hangBell(w, g, 0, y, 0, 0.75);
  w.group.add(g);
};

// ------------------------------------------------------------------ night

/** Silhouette of a dark building at the edge of the light (no detail needed). */
export const darkBlock = (x: number, z: number, wd: number, h: number, d: number, col: number): Prop => (w) => {
  const b = texBox(wd, h, d, texMat(planks(col, true)), x, h / 2, z, 2);
  w.group.add(b);
  w.group.add(box(wd + 0.2, 0.2, d + 0.2, lam(0x0b0a0c), x, h + 0.1, z));
};

/** Lit window: a warm glowing pane. */
export const litWindow = (x: number, y: number, z: number, rotY = 0, col = 0xeda978): Prop => (w) => {
  const m = box(0.06, 0.8, 0.7, basic(col), x, y, z, false);
  m.rotation.y = rotY;
  w.group.add(m);
};

// ------------------------------------------------------------------ train platform

/** Plank platform (top at y = h). */
export const platform = (x: number, z: number, wd: number, len: number, h = 0.5): Prop => (w) => {
  w.group.add(texBox(wd, h, len, texMat(planks(0x8f5843, false)), x, h / 2, z, 1.5));
  w.group.add(texBox(0.2, h + 0.02, len, texMat(planks(0x40302a, true)), x + wd / 2, h / 2, z, 1));
};

/** Railway track along z at x: ballast, sleepers, two rails. */
export const track = (x: number, z0: number, z1: number): Prop => (w) => {
  const len = z0 - z1;
  const zc = (z0 + z1) / 2;
  w.group.add(box(3.4, 0.12, len, lam(0x5c5b67), x, 0.06, zc, false));
  const sleeper = texMat(planks(0x40302a, false));
  for (let z = z0; z > z1; z -= 0.9) w.group.add(texBox(2.6, 0.1, 0.3, sleeper, x, 0.16, z, 1));
  for (const s of [-0.72, 0.72]) w.group.add(box(0.1, 0.14, len, lam(0x97a6b6), x + s, 0.27, zc, false));
};

/** Station depot with a cupola belfry centred on the line of fire. */
export const depot = (z: number, bellAt: number): Prop => (w) => {
  const g = new THREE.Group();
  g.position.set(0, 0, z);
  const wall = texMat(planks(0xad7658, false));
  const trim = texMat(planks(0x634337, true));
  g.add(texBox(7, 4.4, 5, wall, 0, 2.2, -2.5, 2));
  // hip roof with wide eaves
  const roof = new THREE.Mesh(new THREE.ConeGeometry(5.6, 2.4, 4, 1), texMat(shingles(0x5c5b67)));
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1, 1, 0.5);
  roof.position.set(0, 5.6, -2.5);
  g.add(roof);
  for (const x of [-2.4, 2.4]) {
    g.add(box(1.0, 1.4, 0.08, lam(0x14100e), x, 2.4, 0.02, false));
    g.add(box(1.1, 0.08, 0.1, lam(0xf3e6c4), x, 3.15, 0.03, false));
  }
  g.add(box(1.3, 2.4, 0.08, lam(0x231b19), 0, 1.2, 0.02, false));
  // sign
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.68), new THREE.MeshLambertMaterial({ map: signBoard('DEPOT', false) }));
  sign.position.set(0, 3.8, 0.06);
  g.add(sign);
  // cupola belfry on the roof ridge
  const by = bellAt;
  for (const [x, zz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]] as const) g.add(texBox(0.22, by + 0.9 - 5.4, 0.22, trim, x, (by + 0.9 + 5.4) / 2, -1 + zz, 1));
  g.add(texBox(2.4, 0.25, 2.4, texMat(planks(0x40302a, false)), 0, by + 1.0, -1, 1));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.2, 4), texMat(shingles(0x634337)));
  cap.rotation.y = Math.PI / 4;
  cap.position.set(0, by + 1.7, -1);
  g.add(cap);
  hangBell(w, g, 0, by + 0.8, -1, 0.65);
  w.group.add(g);
};

/** Train that pulls through on the track at x every `every` seconds (ambient, not a fake). */
export const passingTrain = (x: number, first = 14, every = 45): Prop => (w) => {
  const t = new THREE.Group();
  const iron = lam(0x231b19);
  const red = lam(0x8c2a1e);
  // locomotive faces +z (toward the camera)
  const loco = new THREE.Group();
  const boiler = cyl(0.7, 0.7, 4.2, 10, iron, 0, 1.75, 0.6);
  boiler.rotation.x = Math.PI / 2;
  loco.add(boiler);
  loco.add(box(2.0, 0.4, 6.4, lam(0x40302a), 0, 0.75, 0));
  loco.add(box(1.9, 2.3, 1.8, red, 0, 2.0, -2.0)); // cab
  loco.add(box(2.2, 0.2, 2.1, iron, 0, 3.25, -2.0));
  const stack = cyl(0.42, 0.22, 1.2, 8, iron, 0, 3.0, 2.0);
  loco.add(stack);
  loco.add(cyl(0.3, 0.3, 0.5, 8, lam(0xd9a33a), 0, 2.55, 0.4)); // dome
  const plow = box(1.8, 0.7, 0.6, red, 0, 0.55, 3.3);
  plow.rotation.x = -0.6;
  loco.add(plow);
  loco.add(box(0.5, 0.5, 0.3, basic(0xf9d8b0), 0, 2.4, 2.75)); // headlamp
  for (const zz of [-1.4, 0, 1.4]) for (const s of [-1, 1]) {
    const wh = cyl(0.55, 0.55, 0.12, 10, lam(0x634337), s * 0.95, 0.55, zz);
    wh.rotation.z = Math.PI / 2;
    loco.add(wh);
  }
  t.add(loco);
  // cars behind
  for (let i = 0; i < 4; i++) {
    const car = new THREE.Group();
    car.position.z = -5.4 - i * 6.2;
    car.add(texBox(2.3, 2.4, 5.6, texMat(planks(i % 2 ? 0x8f5843 : 0x634337, false)), 0, 1.9, 0, 2));
    car.add(box(2.5, 0.2, 5.8, iron, 0, 3.2, 0));
    for (const zz of [-1.9, 1.9]) for (const s of [-1, 1]) {
      const wh = cyl(0.4, 0.4, 0.1, 8, iron, s * 0.95, 0.45, zz);
      wh.rotation.z = Math.PI / 2;
      car.add(wh);
    }
    t.add(car);
  }
  t.traverse((o) => { o.castShadow = true; });
  t.visible = false;
  w.group.add(t);
  const start = -80;
  const end = 40;
  const dur = 9;
  let clock = -first;
  let puff = 0;
  w.animators.push((_t, dt) => {
    clock += dt;
    if (clock < 0) return;
    const k = clock / dur;
    if (k >= 1) {
      t.visible = false;
      clock = -every;
      return;
    }
    t.visible = true;
    const e = k * (0.85 + 0.15 * k); // rolls in steadily, a touch faster as it leaves
    t.position.set(x, 0, start + (end - start) * e);
    puff -= dt;
    if (puff <= 0) {
      puff = 0.12;
      const p = stack.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.7, 0));
      w.particles.spawn({ pos: p, vel: new THREE.Vector3(rand(-0.4, 0.4), rand(1.5, 2.6), rand(-1.5, -0.5)), color: rand(0, 1) > 0.5 ? 0x5c5b67 : 0xc4c9cf, size: rand(0.35, 0.6), life: rand(1.4, 2.2), grow: 1.5, drag: 1, shape: 'puff' });
    }
  });
};

/** The 'whistle' fake: a jet of steam bursts in from beyond the right edge of frame. */
export const steamWhistle = (at: V3): Prop => (w) => {
  let st = 99;
  let cool = 0;
  w.fakes.whistle = () => { st = 0; };
  w.animators.push((_t, dt) => {
    st += dt;
    cool -= dt;
    if (st > 1.3 || cool > 0) return;
    cool = 0.03;
    const p = new THREE.Vector3(...at);
    w.particles.spawn({ pos: p.clone().add(new THREE.Vector3(rand(-0.2, 0.2), rand(-0.1, 0.2), rand(-0.3, 0.3))), vel: new THREE.Vector3(rand(-4.5, -2.8), rand(1.4, 2.8), rand(-0.6, 0.6)), color: rand(0, 1) > 0.3 ? 0xedebe7 : 0xc4c9cf, size: rand(0.3, 0.55), life: rand(1.0, 1.8), grow: 1.8, drag: 1.4, shape: 'puff' });
  });
};

// ------------------------------------------------------------------ mesa

/** The 'hawk' fake: a silhouette glides across the sky and its shadow sweeps the ground. */
export const hawk = (): Prop => (w) => {
  const bird = new THREE.Group();
  const black = basic(0x1d1028);
  const body = box(0.35, 0.22, 1.3, black, 0, 0, 0, false);
  bird.add(body);
  const wl = new THREE.Group();
  const wr = new THREE.Group();
  wl.add(box(1.8, 0.06, 0.6, black, 0.9, 0, -0.1, false));
  wr.add(box(1.8, 0.06, 0.6, black, -0.9, 0, -0.1, false));
  bird.add(wl, wr);
  bird.add(box(0.5, 0.06, 0.5, black, 0, 0, -0.85, false));
  bird.scale.setScalar(1.1);
  bird.visible = false;
  w.group.add(bird);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 12), new THREE.MeshBasicMaterial({ color: 0x1d1028, transparent: true, opacity: 0.45, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(2.6, 1.1, 1);
  shadow.visible = false;
  w.group.add(shadow);
  let ht = 99;
  w.fakes.hawk = () => { ht = 0; bird.visible = true; shadow.visible = true; };
  w.animators.push((_t, dt) => {
    if (!bird.visible) return;
    ht += dt;
    const k = ht / 2.4;
    if (k >= 1) { bird.visible = false; shadow.visible = false; return; }
    // swoops from the upper left to the right, dipping low over the rival
    const x = -16 + k * 32;
    const y = 7.2 - Math.sin(k * Math.PI) * 2.6;
    const z = -14 + Math.sin(k * Math.PI) * 2;
    bird.position.set(x, y, z);
    // banked hard so the spread wings face the camera
    bird.rotation.set(0, Math.PI / 2, 1.15 + Math.sin(k * Math.PI * 2) * 0.25);
    const flap = Math.sin(ht * 9) * 0.4 * (k < 0.25 || k > 0.75 ? 1 : 0.2);
    wl.rotation.z = flap;
    wr.rotation.z = -flap;
    shadow.position.set(x - 3, 0.03, z + 5);
  });
};

/** Wagon wheel leaning on something. */
export const wagonWheel = (x: number, z: number, rotY = 0): Prop => (w) => {
  const g = new THREE.Group();
  g.position.set(x, 0.75, z);
  g.rotation.set(0, rotY, 0.25);
  const m = lam(0x5a3a2a);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.07, 4, 14), m);
  g.add(rim);
  for (let i = 0; i < 6; i++) {
    const s = box(0.05, 1.45, 0.05, m, 0, 0, 0, false);
    s.rotation.z = (i * Math.PI) / 6;
    g.add(s);
  }
  g.add(cyl(0.14, 0.14, 0.2, 8, m, 0, 0, 0).rotateX(Math.PI / 2));
  w.group.add(g);
};

// ------------------------------------------------------------------ saloon interior

/** Saloon room shell: plank floor, wallpapered walls, beamed ceiling. Spans x ±hw, z from front to back. */
export const room = (hw: number, front: number, back: number, h: number): Prop => (w) => {
  const g = w.group;
  const d = front - back;
  const zc = (front + back) / 2;
  const floor = texBox(hw * 2, 0.1, d, texMat(planks(0x6e4426, false)), 0, -0.05, zc, 1.2);
  g.add(floor);
  const paper = texMat(planks(0x6e2a22, true, 7));
  const lower = texMat(planks(0x4a2e1c, true));
  for (const s of [-1, 1]) {
    g.add(texBox(0.3, h, d, paper, s * (hw + 0.15), h / 2, zc, 2));
    g.add(texBox(0.32, 1.2, d, lower, s * (hw + 0.1), 0.6, zc, 1)); // wainscot
  }
  g.add(texBox(hw * 2, h, 0.3, paper, 0, h / 2, back - 0.15, 2));
  g.add(texBox(hw * 2, 1.2, 0.32, lower, 0, 0.6, back - 0.1, 1));
  g.add(texBox(hw * 2, 0.3, d, texMat(planks(0x2a1a12, false)), 0, h + 0.15, zc, 2));
  for (let z = front - 1; z > back; z -= 3) g.add(texBox(hw * 2, 0.35, 0.35, texMat(planks(0x4a2e1c, false)), 0, h - 0.17, z, 1));
  // wall behind the camera, so nothing leaks in from outside
  g.add(texBox(hw * 2, h, 0.3, paper, 0, h / 2, front + 0.15, 2));
};

/** Bar counter across the back wall with shelves of bottles and a mirror; bell hung over the bar. */
export const bar = (z: number, bellAt: number): Prop => (w) => {
  const g = w.group;
  const wood = texMat(planks(0x4a2e1c, false));
  g.add(texBox(7.5, 1.15, 0.9, wood, 0, 0.58, z, 1));
  g.add(texBox(7.8, 0.12, 1.1, texMat(planks(0x9a6234, false)), 0, 1.2, z, 1));
  g.add(box(7.5, 0.1, 0.1, lam(0xd9a33a), 0, 0.15, z + 0.5, false)); // brass foot rail
  const backZ = z - 2.6;
  // back bar: mirror between shelves
  g.add(texBox(6.5, 1.0, 0.6, wood, 0, 0.5, backZ, 1));
  g.add(box(3.2, 1.6, 0.05, lam(0x8fa6a8), 0, 2.2, backZ - 0.25, false));
  g.add(texBox(3.6, 0.2, 0.2, texMat(planks(0x9a6234, false)), 0, 3.1, backZ - 0.2, 1));
  const r = mulberry(9);
  const bottle = [0x3c4a3a, 0x6e2a22, 0x9a6234, 0x8fa6a8];
  for (const s of [-1, 1]) {
    for (const y of [1.6, 2.4, 3.2]) {
      g.add(texBox(1.6, 0.08, 0.4, wood, s * 2.6, y, backZ - 0.1, 1));
      for (let i = 0; i < 5; i++) g.add(box(0.12, 0.38, 0.12, lam(bottle[Math.floor(r() * 4)]), s * 2.6 - 0.6 + i * 0.3, y + 0.23, backZ - 0.1, false));
    }
  }
  // bell bracket from the ceiling beam
  g.add(box(0.12, 7 - bellAt, 0.12, lam(0x231b19), 0, (7 + bellAt) / 2, z - 0.4));
  hangBell(w, g, 0, bellAt, z - 0.4, 0.55);
};

/** The 'glass' fake: a bottle on the bar shatters into shards. Bottle sits at `at`. */
export const breakingBottle = (at: V3): Prop => (w) => {
  const b = new THREE.Group();
  b.position.set(...at);
  b.add(box(0.14, 0.32, 0.14, lam(0x3c4a3a), 0, 0.16, 0, false));
  b.add(box(0.06, 0.14, 0.06, lam(0x3c4a3a), 0, 0.39, 0, false));
  w.group.add(b);
  let gt = 99;
  w.fakes.glass = () => {
    gt = 0;
    b.visible = false;
    const p = b.position.clone().add(new THREE.Vector3(0, 0.2, 0));
    for (let i = 0; i < 22; i++) w.particles.spawn({ pos: p, vel: new THREE.Vector3(rand(-2.2, 2.2), rand(0.8, 3), rand(-0.6, 1.8)), color: i % 3 === 0 ? 0xedebe7 : i % 3 === 1 ? 0x8fa6a8 : 0x3c4a3a, size: rand(0.04, 0.09), life: rand(0.6, 1.1), gravity: 9 });
    for (let i = 0; i < 6; i++) w.particles.spawn({ pos: p, vel: new THREE.Vector3(rand(-0.6, 0.6), rand(-0.5, 0.5), rand(0, 0.8)), color: 0xe8b870, size: rand(0.06, 0.1), life: rand(0.4, 0.7), gravity: 6 });
  };
  w.animators.push((_t, dt) => {
    gt += dt;
    if (!b.visible && gt > 3.5) b.visible = true;
  });
};

/** Upright piano against a wall (facing +x or -x). */
export const piano = (x: number, z: number, face: number): Prop => (w) => {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = face > 0 ? Math.PI / 2 : -Math.PI / 2;
  const wood = texMat(planks(0x2a1a12, true));
  g.add(texBox(2.2, 1.9, 0.7, wood, 0, 0.95, 0, 1));
  g.add(box(2.0, 0.12, 0.35, lam(0xedebe7), 0, 1.0, 0.45, false)); // keys
  for (let i = 0; i < 12; i++) g.add(box(0.07, 0.06, 0.2, lam(0x090808), -0.85 + i * 0.155, 1.07, 0.38, false));
  g.add(texBox(2.2, 0.1, 0.5, wood, 0, 0.92, 0.42, 1));
  g.add(box(0.5, 0.5, 0.4, lam(0x6e2a22), 0, 0.25, 1.2)); // stool
  g.add(box(0.2, 0.3, 0.2, lam(0xd9a33a), 0.7, 2.05, 0.1, false)); // candle holder
  w.group.add(g);
};

/** Swinging doors set in a side wall at (x, z) with daylight beyond; drives the 'door' fake. */
export const sideDoors = (x: number, z: number): Prop => (w) => {
  const s = Math.sign(x);
  w.group.add(box(0.1, 2.6, 1.7, basic(0xf6dca4), x + s * 0.12, 1.3, z, false)); // bright doorway
  const mk = (dz: number): THREE.Group => {
    const p = new THREE.Group();
    p.position.set(x - s * 0.06, 1.45, z + dz);
    p.add(texBox(0.06, 1.0, 0.75, texMat(planks(0xc69a62, true)), 0, 0, -Math.sign(dz) * 0.4, 0.5));
    w.group.add(p);
    return p;
  };
  swingDoors(w, mk(0.82), mk(-0.82), 'y');
};

/** Dusty light shafts: additive slanted boxes from high windows, slowly breathing. */
export const lightShafts = (shafts: { x: number; z: number; tilt: number }[], h: number): Prop => (w) => {
  const mats: THREE.MeshBasicMaterial[] = [];
  for (const s of shafts) {
    const m = new THREE.MeshBasicMaterial({ color: 0xe8b870, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending });
    mats.push(m);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(1.1, h * 1.3, 0.8), m);
    shaft.position.set(s.x, h / 2, s.z);
    shaft.rotation.z = s.tilt;
    w.group.add(shaft);
    w.group.add(box(0.05, 1.0, 0.9, basic(0xf6dca4), Math.sign(s.x) * 7.98, h - 1.4, s.z, false)); // window
  }
  w.animators.push((t) => mats.forEach((m, i) => (m.opacity = 0.13 + Math.sin(t * 0.4 + i) * 0.03)));
};

/** Round table with two chairs. */
export const table = (x: number, z: number): Prop => (w) => {
  const wood = lam(0x6e4426);
  w.group.add(cyl(0.7, 0.7, 0.08, 10, wood, x, 0.85, z));
  w.group.add(cyl(0.08, 0.12, 0.85, 6, lam(0x2a1a12), x, 0.42, z));
  for (const s of [-1, 1]) {
    w.group.add(box(0.45, 0.06, 0.45, wood, x + s * 0.9, 0.5, z));
    w.group.add(box(0.06, 0.5, 0.45, wood, x + s * 1.1, 0.75, z));
    for (const lx of [-0.18, 0.18]) for (const lz of [-0.18, 0.18]) w.group.add(box(0.05, 0.5, 0.05, wood, x + s * 0.9 + lx, 0.25, z + lz, false));
  }
  w.group.add(box(0.08, 0.2, 0.08, lam(0x8fa6a8), x + 0.2, 0.99, z, false));
};

/** Ceiling oil lamp (hanging lantern on a long chain). */
export const ceilingLamp = (x: number, z: number, y: number, ceil: number, range = 8): Prop => (w) => {
  w.group.add(box(0.03, ceil - y, 0.03, lam(0x231b19), x, (ceil + y) / 2, z, false));
  addLantern(w, x, z, y, 1.9, range);
};

// ------------------------------------------------------------------ helpers

/** Sign board texture: chunky letters, optional horseshoe emblem. */
export function signBoard(text: string, horseshoe: boolean): THREE.CanvasTexture {
  const wd = 160;
  const h = 32;
  const c = document.createElement('canvas');
  c.width = wd;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2e1f17';
  g.fillRect(0, 0, wd, h);
  g.fillStyle = '#f3e6c4';
  g.fillRect(2, 2, wd - 4, h - 4);
  g.fillStyle = '#4f3322';
  g.fillRect(4, 4, wd - 8, h - 8);
  g.fillStyle = '#f3e6c4';
  g.font = `bold ${text.length > 8 ? 13 : 17}px monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, horseshoe ? wd / 2 + 12 : wd / 2, h / 2 + 1);
  if (horseshoe) {
    g.strokeStyle = '#e0a23a';
    g.lineWidth = 4;
    g.beginPath();
    g.arc(22, 14, 8, Math.PI * 0.85, Math.PI * 2.15, false);
    g.stroke();
    g.fillStyle = '#e0a23a';
    g.fillRect(12, 18, 4, 6);
    g.fillRect(28, 18, 4, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
