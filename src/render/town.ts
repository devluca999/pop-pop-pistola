import * as THREE from 'three';
import type { FakeKind } from '../types';
import { C, lam, basic, box, cyl, ico, starGeo } from './materials';
import { planks, shingles, stone, dirt, street, texMat, texBox } from './textures';

/** x of the building fronts (outer edge of the boardwalk) at depth z: the street narrows toward the church. */
export function frontX(z: number): number {
  return 9.2 + z * 0.035;
}

/** World z of the church bell tower centre (the camera lines the far duelist's head up with it). */
export const TOWER_Z = -33.2;

interface BuildingOpts {
  sign?: string;
  star?: boolean;
  horseshoe?: boolean;
  doors?: boolean;
  lantern?: 'near' | 'far';
}

/** Main Street at high noon. */
export class Town {
  group = new THREE.Group();
  /** Warm point lights inside the hanging lanterns near the duel. */
  lanternLights: THREE.PointLight[] = [];
  bell: THREE.Group;
  private bellSwing = 0;
  private bellVel = 0;
  private doorL!: THREE.Group;
  private doorR!: THREE.Group;
  private doorAng = 0;
  private doorVel = 0;
  private crow: THREE.Group;
  private crowWingL: THREE.Group;
  private crowWingR: THREE.Group;
  private crowBeak: THREE.Mesh;
  private crowT = 99;
  private crowHome = new THREE.Vector3();
  private weed: THREE.Mesh;
  private weedT = 99;
  private cougher: THREE.Group;
  private coughT = 99;
  private coughBase = new THREE.Vector3();
  private horseHead!: THREE.Group;
  private horseTail!: THREE.Group;
  private lanternFlames: THREE.Mesh[] = [];
  coughPuffAt = new THREE.Vector3();
  private clock = 0;

  constructor() {
    const g = this.group;

    // ------------------------------------------------ ground
    const groundTex = dirt(0xe6b48a, 5).clone();
    groundTex.repeat.set(70, 70);
    groundTex.needsUpdate = true;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshLambertMaterial({ map: groundTex }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    g.add(ground);
    const streetTex = street(0xf0bf92).clone();
    streetTex.repeat.set(1, 12);
    streetTex.needsUpdate = true;
    const st = new THREE.Mesh(new THREE.PlaneGeometry(8, 96), new THREE.MeshLambertMaterial({ map: streetTex }));
    st.rotation.x = -Math.PI / 2;
    st.position.set(0, 0.006, -30);
    st.receiveShadow = true;
    g.add(st);

    // ------------------------------------------------ buildings
    // [z centre, length along street, height, wall colour, opts]
    const left: [number, number, number, number, BuildingOpts][] = [
      [1.5, 6, 5.2, 0x634337, {}],
      [-6.6, 9, 6.6, 0x634337, { sign: 'SALOON', horseshoe: true, doors: true, lantern: 'far' }],
      [-14.6, 6, 5.0, 0x8f5843, { sign: 'BANK' }],
      [-20.6, 5, 4.2, 0x40302a, {}],
    ];
    const right: [number, number, number, number, BuildingOpts][] = [
      [1.5, 5, 4.8, 0x40302a, {}],
      [-5.2, 7.6, 5.4, 0x8f5843, { sign: 'GENERAL STORE', lantern: 'far' }],
      [-12.9, 7, 6.4, 0x634337, { sign: 'SHERIFF', star: true, lantern: 'near' }],
      [-19.8, 5.4, 4.4, 0x634337, { sign: 'HOTEL' }],
    ];
    for (const [z, len, h, col, o] of left) this.building(-1, z, len, h, col, o);
    for (const [z, len, h, col, o] of right) this.building(1, z, len, h, col, o);

    // cougher in the general store's lower window (right side)
    this.cougher = new THREE.Group();
    const storeFx = frontX(-5.2);
    this.coughBase.set(storeFx + 0.05, 0.95, -5.2 - 7.6 * 0.3);
    this.cougher.position.copy(this.coughBase);
    this.cougher.add(box(0.12, 0.24, 0.22, lam(C.skin), 0, 0.12, 0, false));
    this.cougher.add(box(0.14, 0.05, 0.36, lam(C.hat), 0, 0.27, 0, false));
    this.cougher.add(box(0.14, 0.1, 0.16, lam(C.hat), 0, 0.33, 0, false));
    this.cougher.visible = false;
    g.add(this.cougher);

    // ------------------------------------------------ props near the duel
    // hitching rail + horse (left mid-ground), with a trough beside it
    const railZ = -13.2;
    const railX0 = -6.6;
    for (const x of [railX0, railX0 + 3.2]) g.add(texBox(0.16, 1.15, 0.16, texMat(planks(0x634337, true)), x, 0.57, railZ, 1));
    g.add(texBox(3.6, 0.12, 0.12, texMat(planks(0xad7658, false)), railX0 + 1.6, 1.05, railZ, 1));
    this.horse(railX0 + 1.7, railZ - 0.75);
    g.add(texBox(1.8, 0.55, 0.7, texMat(planks(0x634337, false)), railX0 - 1.6, 0.28, railZ + 0.6, 1));
    g.add(box(1.64, 0.04, 0.54, lam(0x69819d), railX0 - 1.6, 0.53, railZ + 0.6, false));
    // lamp post near the camera on the left: its lantern hangs beside the near duelist's hat
    this.lampPost(-3.62, -1.0, 1);

    // barrels and crates
    this.barrel(-(frontX(0) - 2.5), 0.2);
    this.barrel(-(frontX(0) - 2.6), -0.7);
    this.barrel(frontX(-3) - 2.45, -2.6);
    this.barrel(-(frontX(-10) - 2.4), -10.4);
    this.crate(-(frontX(-9) - 2.6), -9.3, 0.7, 0);
    this.crate(-(frontX(-9) - 2.55), -9.25, 0.55, 0.7);
    this.crate(frontX(-9) - 2.5, -9.4, 0.8, 0);
    this.crate(frontX(-17) - 2.3, -16.6, 0.6, 0);

    // rail fence with the crow (right, in front of the store)
    const fenceX = frontX(-9) - 3.0;
    for (let i = 0; i < 3; i++) g.add(texBox(0.12, 1.1, 0.12, texMat(planks(0xae9386, true)), fenceX, 0.55, -8.3 - i * 1.0, 1));
    for (const y of [0.45, 0.9]) g.add(texBox(0.08, 0.1, 2.4, texMat(planks(0xae9386, false)), fenceX, y, -9.3, 1));
    // crow
    this.crow = new THREE.Group();
    this.crowHome.set(fenceX, 1.0, -8.6);
    this.crow.position.copy(this.crowHome);
    this.crow.rotation.y = -1.6;
    this.crow.add(box(0.14, 0.14, 0.3, lam(C.crow), 0, 0.12, 0));
    this.crow.add(box(0.12, 0.12, 0.12, lam(C.crow), 0, 0.24, 0.16));
    this.crowBeak = box(0.04, 0.04, 0.12, lam(C.woodGray), 0, 0.23, 0.27, false);
    this.crow.add(this.crowBeak);
    this.crow.add(box(0.08, 0.03, 0.16, lam(C.crow), 0, 0.12, -0.2));
    this.crowWingL = new THREE.Group();
    this.crowWingL.position.set(0.07, 0.16, 0);
    this.crowWingL.add(box(0.26, 0.03, 0.2, lam(C.crow), 0.11, 0, 0));
    this.crowWingR = new THREE.Group();
    this.crowWingR.position.set(-0.07, 0.16, 0);
    this.crowWingR.add(box(0.26, 0.03, 0.2, lam(C.crow), -0.11, 0, 0));
    this.crow.add(this.crowWingL, this.crowWingR);
    g.add(this.crow);

    // tumbleweed
    this.weed = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshLambertMaterial({ color: 0xa3743f, wireframe: true }));
    this.weed.add(ico(0.3, lam(0x7a5232)));
    this.weed.visible = false;
    this.weed.castShadow = true;
    g.add(this.weed);

    // dry shrubs along the street edges
    const rnd = mulberry(21);
    for (let i = 0; i < 22; i++) {
      const z = 4 - rnd() * 24;
      const side = rnd() > 0.5 ? 1 : -1;
      const x = side * (frontX(z) - 2.2 - rnd() * 0.4);
      this.shrub(x, z, 0.5 + rnd() * 0.4);
    }

    // ------------------------------------------------ the church at the end of the street
    this.bell = this.church();

    // rail fence across the end of the street, open in the middle
    for (const side of [-1, 1]) {
      for (let i = 0; i < 6; i++) g.add(texBox(0.12, 1.0, 0.12, texMat(planks(0xae9386, true)), side * (3.2 + i * 1.3), 0.5, -27.6, 1));
      for (const y of [0.4, 0.8]) g.add(texBox(6.6, 0.1, 0.08, texMat(planks(0xae9386, false)), side * 6.45, y, -27.6, 1));
    }

    // water tower (left of centre, behind the town)
    const wt = new THREE.Group();
    wt.position.set(-9.5, 0, -40);
    const legM = texMat(planks(0x40302a, true));
    for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]] as const) wt.add(texBox(0.24, 7.4, 0.24, legM, x, 3.7, z, 1));
    // cross bracing on the front
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
    const tRoof = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.3, 10), texMat(shingles(0x634337)));
    tRoof.position.set(0, 10.9, 0);
    wt.add(tRoof);
    g.add(wt);

    // cacti
    this.cactus(12.5, -9, 1.4);
    this.cactus(10.5, -26, 1.3);
    this.cactus(-12, -30, 1.0);
    this.cactus(16, -16, 1.5);

    // mesas on the horizon: tiered, flat-topped buttes with stepped cliffs, hazy blue-mauve
    const butte = (x: number, z: number, w: number, h: number, col: number): void => {
      const bg = new THREE.Group();
      bg.position.set(x, 0, z);
      bg.scale.set(1, 1, 0.45);
      const m = lam(col);
      const tier = (rBot: number, rTop: number, y0: number, ht: number): void => {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, ht, 7), m);
        t.position.y = y0 + ht / 2;
        bg.add(t);
      };
      tier(w, w * 0.86, 0, h * 0.22);              // talus slope
      tier(w * 0.78, w * 0.74, h * 0.22, h * 0.38); // first cliff
      tier(w * 0.7, w * 0.62, h * 0.6, h * 0.08);   // ledge
      tier(w * 0.5, w * 0.47, h * 0.68, h * 0.32);  // cap rock, flat top
      g.add(bg);
    };
    butte(-40, -150, 20, 15, 0xae9386);
    butte(-14, -175, 13, 10, 0x97a6b6);
    butte(18, -160, 17, 13, 0xae9386);
    butte(44, -140, 13, 9, 0x97a6b6);
    butte(-66, -130, 14, 8, 0x97a6b6);
    butte(70, -165, 18, 11, 0xae9386);
  }

  // ---------------------------------------------------------------- builders
  private building(side: number, zc: number, len: number, h: number, wall: number, o: BuildingOpts): void {
    const g = this.group;
    const fx = frontX(zc);
    const depth = 5;
    const wallMat = texMat(planks(wall, true));
    g.add(texBox(depth, h, len - 0.3, wallMat, side * (fx + depth / 2), h / 2, zc, 2));
    // false front, a little taller than the body
    const ffH = h + 1.3;
    g.add(texBox(0.26, ffH, len - 0.05, wallMat, side * (fx + 0.13), ffH / 2, zc, 2));
    g.add(texBox(0.45, 0.25, len + 0.15, texMat(planks(0x4f3322, false)), side * (fx + 0.1), ffH + 0.05, zc, 1));
    // roof behind the false front
    const roof = texBox(depth + 0.4, 0.2, len - 0.1, texMat(shingles(0x4f3322)), side * (fx + depth / 2 + 0.2), h + 0.1, zc, 2);
    g.add(roof);

    // boardwalk with steps down to the street
    const bw = texBox(2.1, 0.3, len, texMat(planks(0xa3743f, false)), side * (fx - 1.05), 0.15, zc, 1.5);
    g.add(bw);
    g.add(texBox(0.45, 0.15, 1.2, texMat(planks(0x7a5232, false)), side * (fx - 2.3), 0.075, zc - len / 2 + 1, 1));
    // awning on posts
    const aw = texBox(2.4, 0.14, len, texMat(shingles(0x7a5232)), side * (fx - 1.1), 3.0, zc, 2);
    aw.rotation.z = -side * 0.1;
    g.add(aw);
    const postMat = texMat(planks(0x7a5232, true));
    const posts = [zc - len / 2 + 0.3, zc, zc + len / 2 - 0.3];
    for (const pz of posts) g.add(texBox(0.16, 2.9, 0.16, postMat, side * (fx - 2.05), 1.45, pz, 1));

    // windows + door on the facade
    const dark = lam(0x14100e);
    const frame = lam(0xf3e6c4);
    const facadeX = side * (fx - 0.01);
    for (const wz of [zc - len * 0.3, zc + len * 0.3]) {
      for (const wy of [1.55, h - 0.7]) {
        g.add(box(0.05, 0.98, 0.84, frame, facadeX, wy, wz, false));
        g.add(box(0.07, 0.86, 0.72, dark, facadeX, wy, wz, false));
        g.add(box(0.09, 0.05, 0.72, frame, facadeX, wy, wz, false)); // mullion
      }
    }
    g.add(box(0.06, 2.2, 1.1, dark, facadeX, 1.1 + 0.3, zc, false));
    if (o.doors) {
      const mkDoor = (dz: number): THREE.Group => {
        const pivot = new THREE.Group();
        pivot.position.set(side * (fx - 0.06), 1.5, zc + dz);
        const leaf = texBox(0.06, 0.9, 0.5, texMat(planks(0xc69a62, true)), 0, 0, -Math.sign(dz) * 0.25, 0.5);
        pivot.add(leaf);
        g.add(pivot);
        return pivot;
      };
      this.doorL = mkDoor(0.52);
      this.doorR = mkDoor(-0.52);
    }

    // sign board above the awning
    if (o.sign) {
      const sw = Math.min(len * 0.82, 0.55 * o.sign.length + 1.4);
      const tex = signBoard(o.sign, !!o.horseshoe);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(sw, sw / 5), new THREE.MeshLambertMaterial({ map: tex }));
      m.position.set(side * (fx - 0.03), h + 0.45, zc);
      m.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(m);
    }
    if (o.star) {
      // big star on the facade, plus a hanging board sticking out over the boardwalk so the
      // star reads face-on from down the street
      const star = new THREE.Mesh(starGeo(5, 0.85, 0.36, 0.12), lam(0xd9a33a));
      star.position.set(side * (fx - 0.08), h - 0.55, zc);
      star.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      star.castShadow = true;
      g.add(star);
      const bz = zc + len / 2 - 0.5;
      const bx = side * (fx - 0.95);
      g.add(box(1.7, 0.1, 0.1, lam(0x231b19), side * (fx - 0.85), h - 0.05, bz)); // bracket arm
      const board = texBox(1.5, 1.5, 0.1, texMat(planks(0x40302a, false)), bx, h - 0.95, bz, 1);
      g.add(board);
      for (const dz of [0.07, -0.07]) {
        const s2 = new THREE.Mesh(starGeo(5, 0.6, 0.25, 0.05), lam(0xd9a33a));
        s2.position.set(bx, h - 0.95, bz + dz);
        if (dz < 0) s2.rotation.y = Math.PI;
        g.add(s2);
      }
    }
    if (o.lantern) {
      const lz = o.lantern === 'far' ? zc - len / 2 + 0.6 : zc + len / 2 - 0.6;
      this.lantern(side * (fx - 1.95), lz);
    }
  }

  /** Hanging lantern: dark iron frame, glowing glass, a soft dithered glow and a warm point light. */
  private lantern(x: number, z: number, y = 2.85, scale = 1.9): void {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.scale.setScalar(scale);
    const iron = lam(0x231b19);
    g.add(box(0.03, 0.22, 0.03, iron, 0, -0.04, 0, false));
    g.add(box(0.06, 0.06, 0.06, iron, 0, -0.17, 0, false)); // ring
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.12, 4), iron);
    cap.rotation.y = Math.PI / 4;
    cap.position.y = -0.24;
    g.add(cap);
    g.add(box(0.22, 0.04, 0.22, iron, 0, -0.52, 0, false));
    const flame = box(0.15, 0.24, 0.15, basic(0xf9d8b0), 0, -0.38, 0, false);
    g.add(flame);
    g.add(box(0.06, 0.1, 0.06, basic(0xd9a33a), 0, -0.42, 0, false));
    this.lanternFlames.push(flame);
    for (const [dx, dz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]] as const) g.add(box(0.025, 0.3, 0.025, iron, dx, -0.38, dz, false));
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xf8c08f, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    glow.position.y = -0.38;
    g.add(glow);
    const light = new THREE.PointLight(0xffc070, 2.4, 5, 1.6);
    light.position.set(0, -0.4, 0);
    g.add(light);
    this.lanternLights.push(light);
    this.group.add(g);
  }

  /** Wooden lamp post with an iron bracket arm and a hanging lantern. */
  private lampPost(x: number, z: number, armDir: number): void {
    const wood = texMat(planks(0x634337, true));
    this.group.add(texBox(0.2, 3.2, 0.2, wood, x, 1.6, z, 1));
    const arm = box(0.8, 0.07, 0.07, lam(0x231b19), x + armDir * 0.38, 3.0, z);
    this.group.add(arm);
    const brace = box(0.55, 0.05, 0.05, lam(0x231b19), x + armDir * 0.2, 2.78, z);
    brace.rotation.z = armDir * 0.7;
    this.group.add(brace);
    this.lantern(x + armDir * 0.72, z, 2.95, 1.8);
  }

  private horse(x: number, z: number): void {
    const h = new THREE.Group();
    h.position.set(x, 0, z);
    h.rotation.y = Math.PI / 2; // side-on, head toward the street centre (+x)
    const coat = lam(0x7a5232);
    const dark = lam(0x2e1f17);
    h.add(box(0.55, 0.62, 1.5, coat, 0, 1.25, 0));
    for (const [lx, lz] of [[-0.18, 0.55], [0.18, 0.55], [-0.18, -0.55], [0.18, -0.55]] as const) {
      h.add(box(0.15, 0.95, 0.16, coat, lx, 0.5, lz));
      h.add(box(0.17, 0.12, 0.2, dark, lx, 0.06, lz + 0.02));
    }
    h.add(box(0.6, 0.12, 0.6, lam(0x8c2a1e), 0, 1.6, 0)); // saddle blanket
    h.add(box(0.4, 0.14, 0.42, lam(0x4f3322), 0, 1.69, 0)); // saddle
    // neck + head (pivot for idle nodding)
    const neck = new THREE.Group();
    neck.position.set(0, 1.45, 0.65);
    const n = box(0.3, 0.75, 0.32, coat, 0, 0.3, 0.12);
    n.rotation.x = 0.55;
    neck.add(n);
    neck.add(box(0.08, 0.6, 0.22, dark, 0, 0.36, -0.02).rotateX(0.55)); // mane
    const head = box(0.26, 0.28, 0.62, coat, 0, 0.66, 0.5);
    head.rotation.x = 0.35;
    neck.add(head);
    neck.add(box(0.06, 0.14, 0.06, coat, 0.09, 0.88, 0.32));
    neck.add(box(0.06, 0.14, 0.06, coat, -0.09, 0.88, 0.32));
    h.add(neck);
    this.horseHead = neck;
    const tail = new THREE.Group();
    tail.position.set(0, 1.4, -0.75);
    const t = box(0.12, 0.7, 0.12, dark, 0, -0.3, -0.1);
    t.rotation.x = -0.3;
    tail.add(t);
    h.add(tail);
    this.horseTail = tail;
    this.group.add(h);
  }

  private barrel(x: number, z: number): void {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.9, 10), texMat(planks(0x8a5a34, true)));
    b.position.set(x, 0.45 + 0.3 * (Math.abs(x) > frontX(z) - 2.2 ? 1 : 0), z);
    b.castShadow = true;
    b.receiveShadow = true;
    this.group.add(b);
    for (const y of [-0.28, 0.28]) {
      const ring = cyl(0.355, 0.355, 0.06, 10, lam(0x2e1f17), 0, y, 0, false);
      b.add(ring);
    }
  }

  private crate(x: number, z: number, s: number, y: number): void {
    const c = texBox(s, s, s, texMat(planks(0xa3743f, false)), x, y + s / 2, z, s);
    c.rotation.y = (x * 7 + z) % 0.5;
    const brace = box(s * 1.02, 0.06, s * 0.08, lam(0x4f3322), 0, 0, 0, false);
    brace.rotation.z = Math.PI / 4;
    brace.scale.set(1.35, 1, 1.02);
    c.add(brace);
    this.group.add(c);
  }

  private shrub(x: number, z: number, s: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.scale.setScalar(s);
    const cols = [0x7a5232, 0x5b6b3a, 0xa3743f];
    for (let i = 0; i < 5; i++) {
      const m = ico(0.22, lam(cols[i % 3]));
      m.position.set(Math.sin(i * 2.3) * 0.25, 0.18 + (i % 2) * 0.12, Math.cos(i * 1.7) * 0.25);
      g.add(m);
    }
    this.group.add(g);
  }

  private cactus(x: number, z: number, s: number): void {
    const cg = new THREE.Group();
    cg.position.set(x, 0, z);
    cg.scale.setScalar(s);
    const gm = lam(0x5b6b3a);
    cg.add(cyl(0.22, 0.25, 2.6, 6, gm, 0, 1.3, 0));
    cg.add(cyl(0.15, 0.15, 0.6, 6, gm, 0.45, 1.3, 0).rotateZ(Math.PI / 2));
    cg.add(cyl(0.14, 0.15, 0.9, 6, gm, 0.7, 1.75, 0));
    cg.add(cyl(0.15, 0.15, 0.5, 6, gm, -0.4, 1.0, 0).rotateZ(Math.PI / 2));
    cg.add(cyl(0.13, 0.14, 0.7, 6, gm, -0.6, 1.35, 0));
    this.group.add(cg);
  }

  /**
   * Stone church centred at the end of the street (refs/map.png): gabled nave, a square tower rising
   * from the front gable with an open belfry, big brass bell, shingled spire cap and a cross.
   * Returns the bell pivot. Tower centre is at world z = TOWER_Z.
   */
  private church(): THREE.Group {
    const church = new THREE.Group();
    const frontZ = -34.0;
    church.position.set(0, 0, frontZ);
    // cool grey stone like map.png, which also keeps tan hats readable against it
    const st = texMat(stone(0x8f93a3));
    const dark = lam(0x231b19);
    // nave
    const naveW = 9;
    const naveD = 9;
    const wallH = 4.6;
    church.add(texBox(naveW, wallH, naveD, st, 0, wallH / 2, -naveD / 2, 1.5));
    // gable wall (front and back) as an extruded triangle
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
    church.add(gable);
    // roof slopes
    const slope = Math.atan2(gableH, naveW / 2);
    const slopeLen = Math.hypot(gableH, naveW / 2) + 0.4;
    for (const sd of [-1, 1]) {
      const r = texBox(slopeLen, 0.22, naveD + 0.6, texMat(shingles(0x634337)), sd * naveW / 4, wallH + gableH / 2 + 0.12, -naveD / 2, 1.5);
      r.rotation.z = -sd * slope;
      church.add(r);
    }
    // pointed windows + arched door
    const pointed = (x: number, y: number, w: number, h: number, z: number): void => {
      church.add(box(w, h, 0.1, dark, x, y, z, false));
      const cap = new THREE.Mesh(new THREE.ConeGeometry(w * 0.72, w * 0.7, 4), dark);
      cap.rotation.y = Math.PI / 4;
      cap.scale.z = 0.1;
      cap.position.set(x, y + h / 2 + w * 0.3, z);
      church.add(cap);
    };
    pointed(-2.8, 2.6, 0.7, 1.4, 0.06);
    pointed(2.8, 2.6, 0.7, 1.4, 0.06);
    // tower, protruding from the front
    const tw = 3.0;
    const towerH = 8.6;
    const tz = TOWER_Z - frontZ;
    church.add(texBox(tw, towerH, tw, st, 0, towerH / 2, tz, 1.5));
    church.add(box(1.4, 2.3, 0.1, lam(0x40302a), 0, 1.15, tz + tw / 2 + 0.02, false)); // door
    const doorCap = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.1, 10, 1, false, 0, Math.PI), lam(0x40302a));
    doorCap.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    doorCap.position.set(0, 2.3, tz + tw / 2 + 0.02);
    church.add(doorCap);
    pointed(0, 5.6, 0.6, 1.1, tz + tw / 2 + 0.02);
    // stone steps
    church.add(texBox(2.6, 0.18, 0.6, st, 0, 0.09, tz + tw / 2 + 0.3, 1));
    church.add(texBox(2.2, 0.18, 0.4, st, 0, 0.27, tz + tw / 2 + 0.2, 1));
    // open belfry: 4 posts, beam, cap
    const by = towerH;
    for (const [x, z] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]] as const) church.add(texBox(0.36, 2.8, 0.36, texMat(planks(0x634337, true)), x, by + 1.4, tz + z, 1));
    church.add(texBox(3.4, 0.36, 3.4, texMat(planks(0x40302a, false)), 0, by + 2.95, tz, 1.5));
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.9, 4), texMat(shingles(0x634337)));
    cap.rotation.y = Math.PI / 4;
    cap.position.set(0, by + 4.05, tz);
    church.add(cap);
    church.add(box(0.16, 1.4, 0.16, dark, 0, by + 5.6, tz));
    church.add(box(0.8, 0.16, 0.16, dark, 0, by + 5.85, tz));
    const bell = new THREE.Group();
    bell.position.set(0, by + 2.75, tz);
    bell.add(cyl(0.48, 0.9, 1.2, 12, lam(0xd9a33a), 0, -0.68, 0));
    bell.add(cyl(0.94, 0.94, 0.12, 12, lam(0x8f5843), 0, -1.25, 0));
    bell.add(box(0.2, 0.25, 0.2, lam(0x40302a), 0, -1.45, 0));
    church.add(bell);
    this.group.add(church);
    return bell;
  }

  // ---------------------------------------------------------------- animation
  ringBell(): void {
    this.bellVel += 4.5;
  }

  fake(kind: FakeKind): void {
    if (kind === 'crow') this.crowT = 0;
    if (kind === 'tumbleweed') { this.weedT = 0; this.weed.visible = true; }
    if (kind === 'door') this.doorVel += 14;
    if (kind === 'cough') { this.coughT = 0; this.cougher.visible = true; }
  }

  update(dt: number): { coughPuff: boolean } {
    this.clock += dt;
    const t = this.clock;
    this.bellVel += -this.bellSwing * 16 * dt;
    this.bellVel *= Math.exp(-0.9 * dt);
    this.bellSwing += this.bellVel * dt;
    this.bell.rotation.x = this.bellSwing;
    this.doorVel += -this.doorAng * 60 * dt;
    this.doorVel *= Math.exp(-2.5 * dt);
    this.doorAng += this.doorVel * dt;
    this.doorL.rotation.y = this.doorAng;
    this.doorR.rotation.y = -this.doorAng;
    // horse idles: slow nod, tail flick
    this.horseHead.rotation.x = Math.sin(t * 0.9) * 0.08 + (Math.sin(t * 0.31) > 0.9 ? 0.25 : 0);
    this.horseTail.rotation.z = Math.sin(t * 2.3) * 0.25 * (Math.sin(t * 0.5) > 0.3 ? 1 : 0.2);
    // lantern flicker
    for (let i = 0; i < this.lanternFlames.length; i++) {
      const f = 0.9 + Math.sin(t * 13 + i * 1.7) * 0.06 + Math.sin(t * 7.3 + i) * 0.04;
      this.lanternFlames[i].scale.set(0.14, 0.24 * f, 0.14);
      this.lanternLights[i].intensity = 2.2 * f;
    }
    // crow
    this.crowT += dt;
    const ct = this.crowT;
    if (ct < 1.6) {
      const hop = ct < 1.2 ? Math.sin((ct / 1.2) * Math.PI) * 0.9 : 0;
      this.crow.position.set(this.crowHome.x, this.crowHome.y + hop, this.crowHome.z);
      const flap = ct < 1.25 ? Math.sin(ct * 40) * 0.9 : 0;
      this.crowWingL.rotation.z = flap;
      this.crowWingR.rotation.z = -flap;
      this.crowBeak.rotation.x = ct < 0.5 ? -Math.abs(Math.sin(ct * 18)) * 0.5 : 0;
    } else {
      this.crow.position.copy(this.crowHome);
      this.crowWingL.rotation.z = 0;
      this.crowWingR.rotation.z = 0;
      this.crowBeak.rotation.x = 0;
      this.crow.rotation.y = 1.2 + (Math.sin(t * 0.7) > 0.95 ? 0.6 : 0);
    }
    // tumbleweed rolls across in front of the far duelist
    this.weedT += dt;
    if (this.weed.visible) {
      const k = this.weedT / 2.6;
      if (k >= 1) this.weed.visible = false;
      else {
        this.weed.position.set(-9 + k * 18, 0.45 + Math.abs(Math.sin(k * Math.PI * 5)) * 0.5, -1.2);
        this.weed.rotation.z = -k * 22;
        this.weed.rotation.x = k * 4;
      }
    }
    // cougher
    this.coughT += dt;
    let coughPuff = false;
    if (this.cougher.visible) {
      const ck = this.coughT;
      if (ck > 1.6) this.cougher.visible = false;
      else {
        const up = Math.min(1, ck * 6) * Math.min(1, (1.6 - ck) * 6);
        this.cougher.position.y = this.coughBase.y - 0.3 + up * 0.35;
        this.cougher.rotation.z = Math.sin(ck * 30) * 0.15 * (ck > 0.2 && ck < 1.0 ? 1 : 0);
        coughPuff = ck > 0.25 && ck < 1.0;
        this.coughPuffAt.copy(this.cougher.position).add(new THREE.Vector3(-0.3, 0.15, 0));
      }
    }
    return { coughPuff };
  }
}

/** Sign board texture: chunky letters, optional horseshoe emblem. */
function signBoard(text: string, horseshoe: boolean): THREE.CanvasTexture {
  const w = 160;
  const h = 32;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#2e1f17';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#f3e6c4';
  g.fillRect(2, 2, w - 4, h - 4);
  g.fillStyle = '#4f3322';
  g.fillRect(4, 4, w - 8, h - 8);
  g.fillStyle = '#f3e6c4';
  g.font = `bold ${text.length > 8 ? 13 : 17}px monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const tx = horseshoe ? w / 2 + 12 : w / 2;
  g.fillText(text, tx, h / 2 + 1);
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
