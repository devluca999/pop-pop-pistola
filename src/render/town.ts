import * as THREE from 'three';
import type { FakeKind } from '../types';
import { C, lam, basic, box, cyl, ico, signTexture } from './materials';

/** Main Street at high noon. Static props merged where cheap; animated bits kept as groups. */
export class Town {
  group = new THREE.Group();
  private bell: THREE.Group;
  private bellSwing = 0;
  private bellVel = 0;
  private doorL: THREE.Group;
  private doorR: THREE.Group;
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
  /** World position where cough puffs should appear (set when coughing). */
  coughPuffAt = new THREE.Vector3();
  private clock = 0;

  constructor() {
    const g = this.group;

    // ground + street
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), lam(C.dirtLight));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    g.add(ground);
    const street = new THREE.Mesh(new THREE.PlaneGeometry(9, 90), lam(C.dirt));
    street.rotation.x = -Math.PI / 2;
    street.position.set(0, 0.005, -25);
    street.receiveShadow = true;
    g.add(street);
    // wagon ruts
    for (const x of [-1.6, -1.2, 1.3, 1.7]) {
      const rut = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 80), lam(C.dirtDark));
      rut.rotation.x = -Math.PI / 2;
      rut.position.set(x, 0.01, -25);
      rut.receiveShadow = true;
      g.add(rut);
    }
    // a few pebbles / tufts
    const rng = mulberry(7);
    for (let i = 0; i < 40; i++) {
      const p = box(0.08 + rng() * 0.1, 0.05, 0.08 + rng() * 0.1, lam(rng() > 0.5 ? C.dirtDark : C.woodGray),
        (rng() - 0.5) * 8, 0.025, 8 - rng() * 45, false);
      g.add(p);
    }

    // boardwalks both sides
    for (const side of [-1, 1]) {
      const walk = box(2.2, 0.28, 46, lam(C.woodLight), side * 5.6, 0.14, -14);
      g.add(walk);
      for (let z = 8; z > -36; z -= 2.2) g.add(box(2.2, 0.02, 0.05, lam(C.wood), side * 5.6, 0.285, z, false));
      // porch posts + awning
      for (let z = 6; z > -34; z -= 4) g.add(box(0.14, 2.8, 0.14, lam(C.wood), side * 4.65, 1.6, z));
      const awning = box(2.4, 0.12, 44, lam(C.woodDark), side * 5.6, 3.0, -14);
      awning.rotation.z = side * 0.08;
      g.add(awning);
    }

    // buildings: [x side, z centre, width(z), height, colour, sign]
    const left: [number, number, number, string, string | null][] = [
      [4, 7, 4.6, '#7a5636', null],
      [-6, 8, 6.2, '#a27a52', 'SALOON'],
      [-16, 7, 5.0, '#8c8274', 'BANK'],
      [-25, 8, 4.4, '#7a5636', null],
    ];
    const right: [number, number, number, string, string | null][] = [
      [5, 7, 4.2, '#8c8274', null],
      [-4, 9, 5.6, '#c9b99a', 'GEN. STORE'],
      [-14, 7, 4.8, '#a27a52', 'HOTEL'],
      [-24, 8, 4.0, '#7a5636', 'JAIL'],
    ];
    const build = (side: number, z: number, w: number, h: number, col: string, sign: string | null): void => {
      const colHex = parseInt(col.slice(1), 16);
      const x = side * 9.6;
      const b = box(5.4, h, w - 0.3, lam(colHex), x, h / 2, z);
      g.add(b);
      // false front taller facade
      g.add(box(0.3, h + 1.4, w - 0.1, lam(colHex), x - side * 2.75, (h + 1.4) / 2, z));
      g.add(box(0.4, 0.22, w + 0.1, lam(C.woodDark), x - side * 2.8, h + 1.45, z));
      // windows
      const winMat = lam(C.ink);
      for (const wz of [z - w * 0.28, z + w * 0.28]) {
        g.add(box(0.06, 0.9, 0.7, winMat, x - side * 2.92, 1.5, wz, false));
        g.add(box(0.06, 0.9, 0.7, winMat, x - side * 2.92, h - 0.9, wz, false));
      }
      if (sign) {
        const tex = signTexture(sign, '#f2e6c9', '#2a1c14', 96, 16);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.8, w * 0.8 / 6), new THREE.MeshLambertMaterial({ map: tex }));
        m.position.set(x - side * 2.95, h + 0.6, z);
        m.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        g.add(m);
      }
    };
    for (const [z, h, w, col, sign] of left) build(-1, z, w, h, col, sign);
    for (const [z, h, w, col, sign] of right) build(1, z, w, h, col, sign);

    // saloon swinging doors (left side, z = -6)
    const doorX = -6.82;
    const mkDoor = (dz: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(doorX, 1.45, -6 + dz);
      const leaf = box(0.06, 0.9, 0.42, lam(C.woodLight), 0, 0, -Math.sign(dz) * 0.21);
      pivot.add(leaf);
      g.add(pivot);
      return pivot;
    };
    this.doorL = mkDoor(0.45);
    this.doorR = mkDoor(-0.45);
    g.add(box(0.05, 2.2, 1.1, lam(C.ink), doorX - 0.06, 1.25, -6, false)); // dark doorway

    // cougher in the general store window (right side, z=-4 upper floor)
    this.cougher = new THREE.Group();
    const cx = 9.6 - 2.88;
    this.cougher.position.set(cx, 1.15, -4 - 9 * 0 - 1.6);
    this.cougher.add(box(0.12, 0.24, 0.22, lam(C.skin), 0, 0.12, 0, false));
    this.cougher.add(box(0.14, 0.06, 0.34, lam(C.hat), 0, 0.27, 0, false));
    this.cougher.add(box(0.14, 0.1, 0.16, lam(C.hat), 0, 0.33, 0, false));
    this.cougher.visible = false;
    g.add(this.cougher);

    // water trough + hitching posts (right side near the duel)
    g.add(box(0.7, 0.5, 2.0, lam(C.wood), 4.0, 0.25, -0.5));
    g.add(box(0.55, 0.05, 1.85, lam(C.water), 4.0, 0.48, -0.5, false));
    for (const [x, z] of [[-4.0, 1.5], [-4.0, -1.5]] as const) {
      g.add(box(0.14, 1.1, 0.14, lam(C.wood), x, 0.55, z));
    }
    g.add(box(0.1, 0.1, 3.2, lam(C.woodLight), -4.0, 1.0, 0));
    // fence with the crow (left, a bit further)
    for (let i = 0; i < 4; i++) g.add(box(0.12, 1.0, 0.12, lam(C.woodGray), -3.6, 0.5, -7 - i * 1.2));
    g.add(box(0.08, 0.12, 3.8, lam(C.woodGray), -3.6, 0.82, -8.8));
    g.add(box(0.08, 0.12, 3.8, lam(C.woodGray), -3.6, 0.45, -8.8));

    // crow
    this.crow = new THREE.Group();
    this.crowHome.set(-3.6, 0.95, -7.6);
    this.crow.position.copy(this.crowHome);
    this.crow.rotation.y = 0.8;
    this.crow.add(box(0.14, 0.14, 0.3, lam(C.crow), 0, 0.12, 0));
    this.crow.add(box(0.12, 0.12, 0.12, lam(C.crow), 0, 0.24, 0.16));
    this.crowBeak = box(0.04, 0.04, 0.12, lam(C.woodGray), 0, 0.23, 0.27, false);
    this.crow.add(this.crowBeak);
    this.crow.add(box(0.08, 0.03, 0.16, lam(C.crow), 0, 0.12, -0.2)); // tail
    this.crow.add(box(0.02, 0.1, 0.02, lam(C.woodGray), 0.04, 0.0, 0));
    this.crow.add(box(0.02, 0.1, 0.02, lam(C.woodGray), -0.04, 0.0, 0));
    this.crowWingL = new THREE.Group();
    this.crowWingL.position.set(0.07, 0.16, 0);
    this.crowWingL.add(box(0.26, 0.03, 0.2, lam(C.crow), 0.11, 0, 0));
    this.crowWingR = new THREE.Group();
    this.crowWingR.position.set(-0.07, 0.16, 0);
    this.crowWingR.add(box(0.26, 0.03, 0.2, lam(C.crow), -0.11, 0, 0));
    this.crow.add(this.crowWingL, this.crowWingR);
    g.add(this.crow);

    // tumbleweed
    this.weed = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), new THREE.MeshLambertMaterial({ color: C.woodLight, wireframe: true }));
    const weedCore = ico(0.3, lam(C.wood));
    this.weed.add(weedCore);
    this.weed.visible = false;
    this.weed.castShadow = true;
    g.add(this.weed);

    // church + bell tower at the end of the street
    const church = new THREE.Group();
    church.position.set(0, 0, -44);
    church.add(box(7, 4.2, 6, lam(C.plaster), 0, 2.1, -3));
    const roof = cyl(0, 4.6, 2.2, 4, lam(C.roof), 0, 5.3, -3);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1, 1, 0.9);
    church.add(roof);
    church.add(box(3.2, 7.5, 3.2, lam(C.plaster), 0, 3.75, 1.2));
    church.add(box(1.2, 2.1, 0.1, lam(C.woodDark), 0, 1.05, 2.82)); // door
    church.add(box(0.9, 1.2, 0.1, lam(C.ink), 0, 5.2, 2.82)); // window
    // belfry posts
    for (const [x, z] of [[-1.4, -0.2], [1.4, -0.2], [-1.4, 2.6], [1.4, 2.6]] as const) church.add(box(0.3, 2.6, 0.3, lam(C.plaster), x, 8.8, z));
    church.add(box(3.6, 0.3, 3.6, lam(C.plasterShade), 0, 10.2, 1.2));
    const spire = cyl(0, 2.6, 3.0, 4, lam(C.roof), 0, 11.8, 1.2);
    spire.rotation.y = Math.PI / 4;
    church.add(spire);
    church.add(box(0.12, 1.2, 0.12, lam(C.woodDark), 0, 13.8, 1.2));
    church.add(box(0.7, 0.12, 0.12, lam(C.woodDark), 0, 14.0, 1.2));
    this.bell = new THREE.Group();
    this.bell.position.set(0, 9.9, 1.2);
    const bellBody = cyl(0.45, 0.85, 1.1, 8, lam(C.gold), 0, -0.6, 0);
    this.bell.add(bellBody);
    this.bell.add(box(0.2, 0.25, 0.2, lam(C.goldDark), 0, -1.25, 0));
    church.add(this.bell);
    // clock face
    const clock = cyl(0.8, 0.8, 0.1, 12, lam(C.cream), 0, 6.6, 2.85);
    clock.rotation.x = Math.PI / 2;
    church.add(clock);
    church.add(box(0.06, 0.6, 0.04, lam(C.ink), 0, 6.85, 2.92, false));
    church.add(box(0.06, 0.45, 0.04, lam(C.ink), 0, 6.8, 2.93, false));
    g.add(church);

    // water tower (left back)
    const wt = new THREE.Group();
    wt.position.set(-13, 0, -32);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) wt.add(box(0.2, 6, 0.2, lam(C.woodDark), x, 3, z));
    wt.add(cyl(1.8, 1.8, 2.6, 8, lam(C.wood), 0, 7.3, 0));
    wt.add(cyl(0.1, 2.0, 1.2, 8, lam(C.roof), 0, 9.2, 0));
    g.add(wt);

    // cacti
    const cactus = (x: number, z: number, s: number): void => {
      const cg = new THREE.Group();
      cg.position.set(x, 0, z);
      cg.scale.setScalar(s);
      cg.add(cyl(0.22, 0.25, 2.6, 6, lam(C.green), 0, 1.3, 0));
      cg.add(cyl(0.15, 0.15, 0.6, 6, lam(C.green), 0.45, 1.3, 0).rotateZ(Math.PI / 2));
      cg.add(cyl(0.14, 0.15, 0.9, 6, lam(C.green), 0.7, 1.75, 0));
      cg.add(cyl(0.15, 0.15, 0.5, 6, lam(C.greenDark), -0.4, 1.0, 0).rotateZ(Math.PI / 2));
      cg.add(cyl(0.13, 0.14, 0.7, 6, lam(C.greenDark), -0.6, 1.35, 0));
      g.add(cg);
    };
    cactus(6.8, -36, 1.3);
    cactus(-7.5, -39, 1.0);
    cactus(16, -20, 1.5);

    // distant mesas
    const mesa = (x: number, z: number, w: number, h: number): void => {
      const m = cyl(w * 0.7, w, h, 6, lam(C.mesa), x, h / 2, z, false);
      g.add(m);
    };
    mesa(-30, -90, 14, 10);
    mesa(10, -100, 20, 13);
    mesa(40, -85, 10, 7);
    mesa(-55, -70, 12, 6);

    void basic;
  }

  ringBell(): void {
    this.bellVel += 4.5;
  }

  fake(kind: FakeKind): void {
    if (kind === 'crow') this.crowT = 0;
    if (kind === 'tumbleweed') { this.weedT = 0; this.weed.visible = true; }
    if (kind === 'door') this.doorVel += 14;
    if (kind === 'cough') { this.coughT = 0; this.cougher.visible = true; }
  }

  /** Returns true while the cougher is mid-cough (for puffs). */
  update(dt: number): { coughPuff: boolean } {
    this.clock += dt;
    // bell spring
    this.bellVel += -this.bellSwing * 16 * dt;
    this.bellVel *= Math.exp(-0.9 * dt);
    this.bellSwing += this.bellVel * dt;
    this.bell.rotation.x = this.bellSwing;
    // doors spring (they swing back and forth)
    this.doorVel += -this.doorAng * 60 * dt;
    this.doorVel *= Math.exp(-2.5 * dt);
    this.doorAng += this.doorVel * dt;
    this.doorL.rotation.y = this.doorAng;
    this.doorR.rotation.y = -this.doorAng;
    // crow: caw (beak + head bob), hop up flapping, settle
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
      // idle head twitch
      this.crow.rotation.y = 0.8 + (Math.sin(this.clock * 0.7) > 0.95 ? 0.6 : 0);
    }
    // tumbleweed rolls across in front of the far duelist
    this.weedT += dt;
    if (this.weed.visible) {
      const dur = 2.6;
      const k = this.weedT / dur;
      if (k >= 1) this.weed.visible = false;
      else {
        this.weed.position.set(-11 + k * 22, 0.45 + Math.abs(Math.sin(k * Math.PI * 5)) * 0.5, -1.2);
        this.weed.rotation.z = -k * 22;
        this.weed.rotation.x = k * 4;
      }
    }
    // cougher
    this.coughT += dt;
    let coughPuff = false;
    if (this.cougher.visible) {
      const t = this.coughT;
      if (t > 1.6) this.cougher.visible = false;
      else {
        const up = Math.min(1, t * 6) * Math.min(1, (1.6 - t) * 6);
        this.cougher.position.y = 0.85 + up * 0.35;
        this.cougher.rotation.x = Math.sin(t * 30) * 0.15 * (t > 0.2 && t < 1.0 ? 1 : 0);
        coughPuff = t > 0.25 && t < 1.0;
        this.coughPuffAt.copy(this.cougher.position).add(new THREE.Vector3(-0.3, 0.15, 0));
      }
    }
    return { coughPuff };
  }
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
