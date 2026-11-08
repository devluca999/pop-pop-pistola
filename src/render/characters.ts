import * as THREE from 'three';
import type { CharacterId } from '../types';
import { C, lam, basic, box, cyl, ico, starGeo } from './materials';

/**
 * A character built from primitives. Local space: feet at origin, facing +z,
 * character's left hand on +x.
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

function group(x = 0, y = 0, z = 0, parent?: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  if (parent) parent.add(g);
  return g;
}

/** Arm hanging from a shoulder pivot along -y. Returns [pivot, handAnchor]. */
function arm(
  parent: THREE.Object3D, x: number, y: number, len: number, thick: number,
  sleeve: number, skin: number,
): [THREE.Group, THREE.Group] {
  const pivot = group(x, y, 0, parent);
  pivot.add(box(thick, len * 0.82, thick, lam(sleeve), 0, -len * 0.41, 0));
  pivot.add(box(thick * 1.15, len * 0.12, thick * 1.15, lam(sleeve), 0, -len * 0.78, 0)); // cuff
  const hand = group(0, -len, 0, pivot);
  hand.add(box(thick * 1.1, thick * 1.3, thick * 0.8, lam(skin), 0, -thick * 0.2, 0));
  // little thumb nub
  hand.add(box(thick * 0.35, thick * 0.5, thick * 0.35, lam(skin), x > 0 ? -thick * 0.55 : thick * 0.55, -thick * 0.1, thick * 0.25));
  return [pivot, hand];
}

function revolver(): { g: THREE.Group; muzzle: THREE.Object3D } {
  const g = new THREE.Group();
  // barrel points along -y (down the arm), so aiming the arm aims the gun
  g.add(box(0.05, 0.32, 0.06, lam(C.metal), 0, -0.2, 0.02));
  g.add(box(0.08, 0.1, 0.09, lam(C.metalDark), 0, -0.04, 0.03)); // cylinder
  g.add(box(0.06, 0.08, 0.14, lam(C.woodDark), 0, 0.02, -0.06)); // grip
  const muzzle = group(0, -0.38, 0.02, g);
  return { g, muzzle };
}

function shotgun(): { g: THREE.Group; muzzle: THREE.Object3D } {
  const g = new THREE.Group();
  g.add(cyl(0.035, 0.035, 0.42, 5, lam(C.metal), -0.035, -0.26, 0.03));
  g.add(cyl(0.035, 0.035, 0.42, 5, lam(C.metal), 0.035, -0.26, 0.03));
  g.add(box(0.12, 0.08, 0.1, lam(C.metalDark), 0, -0.05, 0.03));
  g.add(box(0.1, 0.12, 0.22, lam(C.wood), 0, 0.03, -0.09)); // stubby stock
  const muzzle = group(0, -0.5, 0.03, g);
  return { g, muzzle };
}

function boot(parent: THREE.Object3D, mat: THREE.Material, w: number, h: number, l: number, y: number): void {
  parent.add(box(w, h, w * 1.1, mat, 0, y + h / 2, 0));
  parent.add(box(w * 1.05, h * 0.35, l, mat, 0, y + h * 0.17, l * 0.3));
}

function hatMesh(brimR: number, brimSeg: number, crownR: number, crownH: number, band = true): THREE.Group {
  const g = new THREE.Group();
  const brim = cyl(brimR, brimR * 0.96, 0.05, brimSeg, lam(C.hat), 0, 0, 0);
  brim.rotation.y = Math.PI / brimSeg;
  g.add(brim);
  // upturned brim edges (goofy)
  const edgeL = box(brimR * 0.5, 0.05, brimR * 0.9, lam(C.hat), brimR * 0.78, 0.05, 0);
  edgeL.rotation.z = 0.35;
  const edgeR = box(brimR * 0.5, 0.05, brimR * 0.9, lam(C.hat), -brimR * 0.78, 0.05, 0);
  edgeR.rotation.z = -0.35;
  g.add(edgeL, edgeR);
  const crown = cyl(crownR * 0.8, crownR, crownH, 5, lam(C.hat), 0, crownH / 2, 0);
  g.add(crown);
  g.add(box(crownR * 1.6, crownH * 0.25, crownR * 0.25, lam(C.hat), 0, crownH * 0.95, 0)); // pinch
  if (band) g.add(cyl(crownR * 1.01, crownR * 1.01, crownH * 0.22, 5, lam(C.hatBand), 0, crownH * 0.14, 0, false));
  return g;
}

function finish(r: Omit<Rig, 'hatHome'>): Rig {
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
  const legMat = lam(C.pants);
  const bootMat = lam(C.boot);
  const mkLeg = (x: number): THREE.Group => {
    const l = group(x, 0, 0, hips);
    l.rotation.z = x > 0 ? 0.09 : -0.09; // bowlegged
    l.add(box(0.075, hipY * 0.75, 0.08, legMat, 0, -hipY * 0.42, 0));
    const knee = group(0, -hipY * 0.68, 0, l);
    knee.rotation.z = x > 0 ? -0.18 : 0.18;
    boot(knee, bootMat, 0.11, 0.3, 0.26, -hipY * 0.34);
    return l;
  };
  const legL = mkLeg(0.1);
  const legR = mkLeg(-0.1);

  const torso = group(0, 0, 0, hips);
  torso.add(box(0.26, 0.66, 0.16, lam(C.shirt), 0, 0.34, 0.01));
  torso.add(box(0.1, 0.5, 0.05, lam(C.ink), 0, 0.34, 0.09)); // vest stripe
  torso.add(box(0.3, 0.07, 0.18, lam(C.woodDark), 0, 0.03, 0)); // belt
  torso.add(box(0.07, 0.06, 0.03, lam(C.gold), 0, 0.03, 0.1)); // buckle
  // long red coat: open front, flared panels
  const coat = lam(C.red);
  torso.add(box(0.36, 0.64, 0.1, coat, 0, 0.34, -0.08));
  const panelL = box(0.13, 1.0, 0.2, coat, 0.15, 0.08, 0.0);
  panelL.rotation.z = -0.13;
  const panelR = box(0.13, 1.0, 0.2, coat, -0.15, 0.08, 0.0);
  panelR.rotation.z = 0.13;
  const tail = box(0.34, 0.8, 0.06, coat, 0, -0.05, -0.12);
  tail.rotation.x = 0.12;
  torso.add(panelL, panelR, tail);
  // lapels
  const lapL = box(0.07, 0.24, 0.04, lam(C.redDark), 0.09, 0.56, 0.1);
  lapL.rotation.z = -0.4;
  const lapR = box(0.07, 0.24, 0.04, lam(C.redDark), -0.09, 0.56, 0.1);
  lapR.rotation.z = 0.4;
  torso.add(lapL, lapR);
  // holster on right hip
  const holster = group(-0.19, -0.02, 0.03, torso);
  holster.add(box(0.07, 0.22, 0.09, lam(C.woodDark), 0, -0.08, 0));
  const holsterGun = revolver();
  holsterGun.g.rotation.x = Math.PI; // grip up
  holsterGun.g.position.set(0, -0.05, 0);
  holsterGun.g.scale.setScalar(0.9);
  holster.add(holsterGun.g);

  const [armL] = arm(torso, 0.21, 0.62, 0.7, 0.08, C.red, C.skin);
  const [armR, handR] = arm(torso, -0.21, 0.62, 0.7, 0.08, C.red, C.skin);
  const gun = revolver();
  gun.g.position.set(0, -0.06, 0.02);
  handR.add(gun.g);
  gun.g.visible = false;

  const head = group(0, 0.7, 0, torso);
  head.add(box(0.05, 0.08, 0.05, lam(C.skin), 0, 0.02, 0)); // neck
  head.add(box(0.19, 0.34, 0.2, lam(C.skin), 0, 0.22, 0));
  head.add(box(0.06, 0.13, 0.09, lam(C.skinShade), 0, 0.2, 0.13)); // long nose
  head.add(box(0.13, 0.03, 0.02, lam(C.ink), 0, 0.29, 0.105)); // heavy brow
  head.add(box(0.035, 0.035, 0.02, lam(C.black), 0.045, 0.255, 0.105));
  head.add(box(0.035, 0.035, 0.02, lam(C.black), -0.045, 0.255, 0.105));
  // mustache bigger than his face, curled ends
  const st = lam(C.stache);
  head.add(box(0.2, 0.07, 0.06, st, 0, 0.12, 0.12));
  const wL = box(0.22, 0.06, 0.05, st, 0.18, 0.1, 0.11);
  wL.rotation.z = -0.35;
  const wR = box(0.22, 0.06, 0.05, st, -0.18, 0.1, 0.11);
  wR.rotation.z = 0.35;
  const cL = box(0.06, 0.12, 0.05, st, 0.3, 0.11, 0.1);
  cL.rotation.z = 0.5;
  const cR = box(0.06, 0.12, 0.05, st, -0.3, 0.11, 0.1);
  cR.rotation.z = -0.5;
  head.add(wL, wR, cL, cR);
  const mouth = group(0, 0.08, 0.13, head);

  const hat = hatMesh(0.62, 8, 0.15, 0.3);
  hat.position.set(0, 0.38, 0);
  hat.rotation.x = -0.06;
  head.add(hat);

  // whiskey bottle (heal), in left hand-ish but we attach to right hand for the swig
  const bottle = new THREE.Group();
  bottle.add(cyl(0.045, 0.05, 0.16, 6, lam(0x6f5a2a), 0, -0.1, 0.05));
  bottle.add(cyl(0.018, 0.022, 0.08, 5, lam(0x6f5a2a), 0, 0.0, 0.05));
  bottle.visible = false;
  handR.add(bottle);

  return finish({
    id: 'hector', root, body, hips, torso, head, hat, armL, armR, legL, legR, hipY,
    gunHand: gun.g, gunHolster: holsterGun.g, muzzle: gun.muzzle, mouth, bottle,
    burst: [C.red, C.hat, C.stache, C.shirt],
  });
}

// ---------------------------------------------------------------- Dusty
function buildDusty(): Rig {
  const root = new THREE.Group();
  const body = group(0, 0, 0, root);
  const hipY = 0.5;
  const hips = group(0, hipY, 0, body);
  const spurGeo = starGeo(6, 0.11, 0.045, 0.02);
  const mkLeg = (x: number): THREE.Group => {
    const l = group(x, 0, 0, hips);
    l.add(box(0.2, 0.32, 0.22, lam(C.pants), 0, -0.14, 0));
    boot(l, lam(C.boot), 0.19, 0.2, 0.32, -hipY);
    const spur = new THREE.Mesh(spurGeo, lam(C.cream));
    spur.position.set(x > 0 ? 0.12 : -0.12, -hipY + 0.08, -0.12);
    spur.rotation.y = Math.PI / 2;
    spur.castShadow = true;
    l.add(spur);
    return l;
  };
  const legL = mkLeg(0.16);
  const legR = mkLeg(-0.16);

  const torso = group(0, 0, 0, hips);
  torso.add(box(0.62, 0.58, 0.5, lam(C.shirt), 0, 0.32, 0.03)); // round belly shirt
  torso.add(box(0.5, 0.3, 0.1, lam(C.shirt), 0, 0.22, 0.26)); // belly push
  torso.add(box(0.68, 0.09, 0.56, lam(C.woodDark), 0, 0.06, 0.02)); // belt
  torso.add(box(0.12, 0.08, 0.03, lam(C.gold), 0, 0.06, 0.31));
  const coat = lam(C.blue);
  torso.add(box(0.78, 0.66, 0.36, coat, 0, 0.34, -0.12));
  const pL = box(0.2, 0.7, 0.5, coat, 0.32, 0.26, 0.02);
  pL.rotation.z = -0.08;
  const pR = box(0.2, 0.7, 0.5, coat, -0.32, 0.26, 0.02);
  pR.rotation.z = 0.08;
  torso.add(pL, pR);
  torso.add(box(0.8, 0.16, 0.5, lam(C.blueDark), 0, 0.66, -0.02)); // collar/shoulders

  const [armL] = arm(torso, 0.44, 0.6, 0.48, 0.15, C.blue, C.skin);
  const [armR, handR] = arm(torso, -0.44, 0.6, 0.48, 0.15, C.blue, C.skin);
  const gun = shotgun();
  gun.g.position.set(0, -0.06, 0.02);
  handR.add(gun.g);
  gun.g.visible = false;
  // shotgun slung on the back when holstered
  const slung = shotgun();
  slung.g.position.set(0.1, 0.45, -0.32);
  slung.g.rotation.z = 2.4;
  torso.add(slung.g);

  const head = group(0, 0.72, 0.02, torso);
  const skull = ico(0.27, lam(C.skin));
  skull.scale.set(1.05, 0.92, 0.95);
  skull.position.set(0, 0.22, 0);
  head.add(skull);
  head.add(box(0.12, 0.12, 0.1, lam(C.skinShade), 0, 0.2, 0.25)); // bulb nose
  head.add(box(0.1, 0.1, 0.1, lam(C.skin), 0.27, 0.22, 0)); // ears
  head.add(box(0.1, 0.1, 0.1, lam(C.skin), -0.27, 0.22, 0));
  // huge angry eyebrows
  const bL = box(0.2, 0.08, 0.08, lam(C.ink), 0.1, 0.33, 0.23);
  bL.rotation.z = -0.32;
  const bR = box(0.2, 0.08, 0.08, lam(C.ink), -0.1, 0.33, 0.23);
  bR.rotation.z = 0.32;
  head.add(bL, bR);
  head.add(box(0.05, 0.04, 0.02, lam(C.black), 0.08, 0.27, 0.255));
  head.add(box(0.05, 0.04, 0.02, lam(C.black), -0.08, 0.27, 0.255));
  // walrus mustache
  head.add(box(0.36, 0.1, 0.08, lam(C.ink), 0, 0.12, 0.24));
  const mL = box(0.12, 0.12, 0.07, lam(C.ink), 0.17, 0.08, 0.22);
  mL.rotation.z = 0.3;
  const mR = box(0.12, 0.12, 0.07, lam(C.ink), -0.17, 0.08, 0.22);
  mR.rotation.z = -0.3;
  head.add(mL, mR);
  // cigar
  const cigar = group(0.08, 0.06, 0.27, head);
  cigar.add(box(0.035, 0.035, 0.16, lam(0x6a4a2a), 0, 0, 0.06));
  cigar.add(box(0.04, 0.04, 0.02, basic(C.flame), 0, 0, 0.15));
  cigar.rotation.x = 0.25;
  const mouth = group(0.08, 0.06, 0.4, head);

  const hat = hatMesh(0.24, 7, 0.12, 0.16);
  hat.position.set(0, 0.44, 0);
  hat.rotation.z = 0.12;
  head.add(hat);

  return finish({
    id: 'dusty', root, body, hips, torso, head, hat, armL, armR, legL, legR, hipY,
    gunHand: gun.g, gunHolster: slung.g, muzzle: gun.muzzle, mouth,
    burst: [C.blue, C.shirt, C.ink, C.hat],
  });
}

// ---------------------------------------------------------------- Mercy
function buildMercy(): Rig {
  const root = new THREE.Group();
  const body = group(0, 0, 0, root);
  const hipY = 0.82;
  const hips = group(0, hipY, 0, body);
  // legs hidden under robe; only shoes poke out
  const mkLeg = (x: number): THREE.Group => {
    const l = group(x, 0, 0, hips);
    l.add(box(0.08, hipY * 0.8, 0.08, lam(C.habit), 0, -hipY * 0.5, 0, false));
    l.add(box(0.11, 0.07, 0.2, lam(C.black), 0, -hipY + 0.035, 0.05));
    return l;
  };
  const legL = mkLeg(0.09);
  const legR = mkLeg(-0.09);
  // robe hangs from hips as a flared hexagonal skirt (attached to hips, sways with them)
  const robe = cyl(0.26, 0.44, hipY + 0.02, 6, lam(C.habit), 0, -hipY / 2 + 0.03, 0);
  hips.add(robe);

  const torso = group(0, 0, 0, hips);
  torso.add(cyl(0.2, 0.26, 0.62, 6, lam(C.habit), 0, 0.3, 0));
  torso.add(box(0.06, 0.62, 0.04, lam(C.habitLight), 0, 0.3, 0.21)); // front seam
  torso.add(cyl(0.27, 0.27, 0.06, 6, lam(C.ink), 0, 0.04, 0)); // cord belt
  // white collar bib
  torso.add(cyl(0.21, 0.24, 0.1, 6, lam(C.white), 0, 0.6, 0.01));
  // gold rosary: bead loop down the front + cross
  const gold = lam(C.gold);
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const bead = box(0.035, 0.035, 0.035, gold, Math.sin(t * Math.PI) * 0.1 - 0.05, 0.58 - t * 0.45, 0.2 + Math.sin(t * Math.PI) * 0.03, false);
    torso.add(bead);
  }
  torso.add(box(0.03, 0.14, 0.03, gold, -0.05, 0.1, 0.23));
  torso.add(box(0.09, 0.03, 0.03, gold, -0.05, 0.13, 0.23));
  // dangling rosary at the belt
  for (let i = 0; i < 5; i++) torso.add(box(0.03, 0.03, 0.03, gold, 0.18, 0.02 - i * 0.06, 0.16, false));

  const [armL] = arm(torso, 0.24, 0.55, 0.58, 0.11, C.habit, C.skin);
  const [armR, handR] = arm(torso, -0.24, 0.55, 0.58, 0.11, C.habit, C.skin);

  // Bible with hidden lantern, held in right hand; barrel axis is -y like the guns
  const bible = new THREE.Group();
  bible.position.set(0, -0.08, 0.06);
  handR.add(bible);
  const spine = box(0.05, 0.3, 0.22, lam(C.book), 0, -0.12, 0);
  bible.add(spine);
  const coverL = new THREE.Group();
  coverL.position.set(0.025, -0.12, 0.0);
  coverL.add(box(0.03, 0.3, 0.22, lam(C.book), 0.04, 0, 0));
  coverL.add(box(0.02, 0.12, 0.03, gold, 0.06, 0.02, 0)); // gold cross
  coverL.add(box(0.02, 0.03, 0.09, gold, 0.06, 0.05, 0));
  const coverR = new THREE.Group();
  coverR.position.set(-0.025, -0.12, 0.0);
  coverR.add(box(0.03, 0.3, 0.22, lam(C.book), -0.04, 0, 0));
  bible.add(coverL, coverR);
  bible.add(box(0.05, 0.27, 0.2, lam(C.paper), 0, -0.12, 0)); // pages
  const lantern = new THREE.Group();
  lantern.position.set(0, -0.14, 0.0);
  lantern.add(box(0.1, 0.03, 0.1, lam(C.black), 0, 0.06, 0));
  lantern.add(box(0.1, 0.03, 0.1, lam(C.black), 0, -0.06, 0));
  const glow = box(0.07, 0.1, 0.07, basic(C.flameCore), 0, 0, 0, false);
  lantern.add(glow);
  bible.add(lantern);
  const muzzle = group(0, -0.34, 0, bible);

  // head with coif + veil
  const head = group(0, 0.66, 0, torso);
  head.add(box(0.2, 0.26, 0.18, lam(C.skin), 0, 0.17, 0.04));
  head.add(box(0.06, 0.012, 0.02, lam(C.ink), 0.05, 0.19, 0.135)); // closed eyes
  head.add(box(0.06, 0.012, 0.02, lam(C.ink), -0.05, 0.19, 0.135));
  head.add(box(0.05, 0.012, 0.02, lam(C.redDark), 0, 0.08, 0.135)); // calm mouth
  head.add(box(0.3, 0.06, 0.26, lam(C.white), 0, 0.33, 0.02)); // coif band
  head.add(box(0.06, 0.32, 0.24, lam(C.white), 0.13, 0.16, 0.02));
  head.add(box(0.06, 0.32, 0.24, lam(C.white), -0.13, 0.16, 0.02));
  // veil (acts as the 'hat' so it can fly off on a loss)
  const hat = new THREE.Group();
  hat.position.set(0, 0.36, -0.02);
  const veilTop = cyl(0.04, 0.24, 0.12, 4, lam(C.habit), 0, 0.03, 0);
  veilTop.rotation.y = Math.PI / 4;
  hat.add(veilTop);
  const veilBack = box(0.4, 0.62, 0.12, lam(C.habit), 0, -0.28, -0.12);
  veilBack.rotation.x = 0.12;
  hat.add(veilBack);
  const veilL = box(0.08, 0.5, 0.3, lam(C.habit), 0.2, -0.22, -0.02);
  veilL.rotation.z = -0.12;
  const veilR = box(0.08, 0.5, 0.3, lam(C.habit), -0.2, -0.22, -0.02);
  veilR.rotation.z = 0.12;
  hat.add(veilL, veilR);
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
    burst: [C.habit, C.white, C.gold, C.cream],
  });
}

export function buildCharacter(id: CharacterId): Rig {
  if (id === 'hector') return buildHector();
  if (id === 'dusty') return buildDusty();
  return buildMercy();
}
