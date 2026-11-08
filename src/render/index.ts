import * as THREE from 'three';
import type { CharacterId, Pose, FxKind, FakeKind, ScreenSide, PostSettings, ViewOptions } from '../types';
import { buildCharacter, type Rig } from './characters';
import { Puppet } from './puppet';
import { Town } from './town';
import { Particles, rand, randDir } from './fx';
import { PostPass } from './post';
import { C } from './materials';

export const RES_W = 320;
export const RES_H = 180;

const NEAR_Z = 3.0;
const FAR_Z = -2.5;
const CAM_POS = new THREE.Vector3(1.5, 2.7, 8.6);
const CAM_LOOK = new THREE.Vector3(-0.3, 1.45, -2.5);
const BASE_FOV = 32;

interface Duelist {
  rig: Rig;
  puppet: Puppet;
  forward: THREE.Vector3;
  charge: number;
}

/** The whole 3D view: town, two duelists, FX, camera and the dither post-process. */
export class Stage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(BASE_FOV, RES_W / RES_H, 0.1, 220);
  private post = new PostPass(RES_W, RES_H);
  private town = new Town();
  private particles = new Particles();
  private duelists: Record<ScreenSide, Duelist | null> = { near: null, far: null };
  private sun: THREE.DirectionalLight;
  private flashLight = new THREE.PointLight(0xffc070, 0, 7, 1.5);
  private flashLightT = 0;
  private beam: THREE.Mesh;
  private beamT = 99;
  private cloud = new THREE.Group();
  private cloudAmt = 0;
  private cloudOn = false;
  private push = 0;
  private pushCur = 0;
  private punchAmt = 0;
  private shakeAmt = 0;
  private slowFactor = 1;
  private slowLeft = 0;
  private mode: 'title' | 'duel' = 'duel';
  private time = 0;
  private opts: ViewOptions = { shake: true, reducedMotion: false, reduceFlashing: false };
  private tmp = new THREE.Vector3();
  private coughCooldown = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(RES_W, RES_H, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    canvas.style.imageRendering = 'pixelated';

    this.scene.background = new THREE.Color(C.sky);
    this.scene.fog = new THREE.Fog(C.skyHaze, 30, 120);

    const hemi = new THREE.HemisphereLight(0xf4f0e4, 0x9c7650, 1.55);
    this.scene.add(hemi);
    // high noon: sun almost straight overhead, tipped toward the camera so faces read
    this.sun = new THREE.DirectionalLight(0xfff6e0, 3.1);
    this.sun.position.set(1.2, 14, 3.5);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -12; sc.right = 12; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 40;
    this.sun.shadow.bias = -0.002;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(this.flashLight);

    this.scene.add(this.town.group);
    this.scene.add(this.particles.group);

    // lantern beam (cone), hidden until fired
    const beamGeo = new THREE.CylinderGeometry(0.1, 0.85, 1, 10, 1, true);
    beamGeo.translate(0, 0.5, 0);
    this.beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
      color: C.flameCore, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }));
    this.beam.visible = false;
    this.scene.add(this.beam);

    // Dusty's lingering smoke cloud between the duelists
    for (let i = 0; i < 30; i++) {
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rand(0.14, 0.3), 0),
        new THREE.MeshLambertMaterial({ color: i % 2 === 0 ? C.white : C.smoke, flatShading: true, transparent: true, opacity: 0, depthWrite: false }),
      );
      const a = Math.random() * Math.PI * 2;
      m.position.set(Math.cos(a) * rand(0, 1.0), rand(0.9, 2.1), Math.sin(a) * rand(0, 0.5) + 0.2);
      m.userData.phase = Math.random() * 6;
      m.userData.base = m.position.clone();
      this.cloud.add(m);
    }
    this.cloud.visible = false;
    this.scene.add(this.cloud);

    this.setDuelists('hector', 'dusty');
    this.updateCamera(0);
  }

  // ------------------------------------------------------------ duelists
  setDuelists(near: CharacterId, far: CharacterId): void {
    for (const side of ['near', 'far'] as const) {
      const d = this.duelists[side];
      if (d) {
        this.scene.remove(d.rig.root);
        if (d.rig.hat.parent && d.rig.hat.parent !== d.rig.hatHome.parent) d.rig.hat.parent.remove(d.rig.hat);
      }
    }
    const mk = (id: CharacterId, side: ScreenSide): Duelist => {
      const rig = buildCharacter(id);
      const z = side === 'near' ? NEAR_Z : FAR_Z;
      rig.root.position.set(0, 0, z);
      rig.root.rotation.y = side === 'near' ? Math.PI : 0;
      this.scene.add(rig.root);
      const puppet = new Puppet(rig);
      const forward = new THREE.Vector3(0, 0, side === 'near' ? -1 : 1);
      puppet.onLand = () => this.fx('dust', side);
      return { rig, puppet, forward, charge: 0 };
    };
    this.duelists.near = mk(near, 'near');
    this.duelists.far = mk(far, 'far');
    this.particles.clear();
    this.setSmokeCloud(false);
    this.cloudAmt = 0;
  }

  setPose(side: ScreenSide, pose: Pose): void {
    const d = this.duelists[side];
    if (!d) return;
    d.puppet.setPose(pose);
    if (pose === 'dead') this.fx('hatFly', side);
  }

  setDrunk(side: ScreenSide, drunk: boolean): void {
    const d = this.duelists[side];
    if (d) d.puppet.drunk = drunk;
  }

  setHalo(side: ScreenSide, charge: number): void {
    const d = this.duelists[side];
    if (!d || !d.rig.halo) return;
    d.charge = Math.max(0, Math.min(2, charge));
    d.rig.halo.visible = d.charge > 0;
    d.rig.pips?.forEach((p, i) => (p.visible = i < d.charge));
  }

  // ------------------------------------------------------------ fx
  private world(o: THREE.Object3D, out = new THREE.Vector3()): THREE.Vector3 {
    o.updateWorldMatrix(true, false);
    return o.getWorldPosition(out);
  }

  fx(kind: FxKind, side: ScreenSide): void {
    const d = this.duelists[side];
    if (!d) return;
    const P = this.particles;
    const fwd = d.forward;
    const muzzle = this.world(d.rig.muzzle);
    const chest = this.world(d.rig.torso).add(new THREE.Vector3(0, 0.35, 0));
    const feet = d.rig.root.position.clone();
    const mouth = this.world(d.rig.mouth);
    switch (kind) {
      case 'muzzle': {
        P.spawn({ pos: muzzle, color: C.flameCore, size: 0.42, life: 0.07, fade: false });
        P.spawn({ pos: muzzle.clone().addScaledVector(fwd, 0.25), color: C.flame, size: 0.28, life: 0.09, fade: false });
        for (let i = 0; i < 10; i++) P.spawn({ pos: muzzle, vel: randDir(0.5, fwd, rand(4, 9)), color: i % 2 ? C.flame : C.gold, size: 0.05, life: rand(0.15, 0.35), gravity: 6 });
        for (let i = 0; i < 3; i++) P.spawn({ pos: muzzle, vel: randDir(0.4, fwd.clone().add(new THREE.Vector3(0, 0.6, 0)), rand(0.4, 1)), color: C.smoke, size: 0.18, life: rand(0.6, 1.1), grow: 1.6, drag: 2, shape: 'puff' });
        this.lightFlash(muzzle, 9, 0.09);
        break;
      }
      case 'shotgunBlast': {
        P.spawn({ pos: muzzle, color: C.flameCore, size: 0.7, life: 0.09, fade: false });
        P.spawn({ pos: muzzle.clone().addScaledVector(fwd, 0.4), color: C.flame, size: 0.5, life: 0.11, fade: false });
        for (let i = 0; i < 20; i++) P.spawn({ pos: muzzle, vel: randDir(0.8, fwd, rand(5, 11)), color: i % 3 ? C.flame : C.flameCore, size: 0.06, life: rand(0.15, 0.4), gravity: 5 });
        for (let i = 0; i < 10; i++) P.spawn({ pos: muzzle.clone().add(new THREE.Vector3(rand(-0.2, 0.2), rand(-0.1, 0.2), 0)), vel: randDir(0.7, fwd.clone().add(new THREE.Vector3(0, 0.4, 0)), rand(0.6, 1.8)), color: i % 2 ? C.smoke : C.cream, size: rand(0.25, 0.4), life: rand(1.2, 2.2), grow: 1.2, drag: 1.6, shape: 'puff' });
        this.lightFlash(muzzle, 14, 0.12);
        this.shake(0.7);
        break;
      }
      case 'smokePuff':
        for (let i = 0; i < 8; i++) P.spawn({ pos: muzzle.clone().add(new THREE.Vector3(rand(-0.15, 0.15), 0, rand(-0.15, 0.15))), vel: new THREE.Vector3(rand(-0.3, 0.3), rand(0.4, 1), rand(-0.3, 0.3)), color: i % 2 ? C.smoke : C.cream, size: rand(0.2, 0.32), life: rand(1.2, 2.4), grow: 1.1, drag: 1, shape: 'puff' });
        break;
      case 'dust':
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2;
          P.spawn({ pos: feet.clone().add(new THREE.Vector3(Math.cos(a) * 0.3, 0.1, Math.sin(a) * 0.3)), vel: new THREE.Vector3(Math.cos(a) * rand(1, 2.5), rand(0.3, 1.2), Math.sin(a) * rand(1, 2.5)), color: i % 2 ? C.dirtLight : C.dirt, size: rand(0.18, 0.32), life: rand(0.6, 1.2), grow: 1.4, drag: 3, shape: 'puff' });
        }
        break;
      case 'hatFly':
        d.puppet.flyHat(this.scene, fwd.clone().negate());
        break;
      case 'lanternFlash': {
        const target = side === 'near' ? this.duelists.far : this.duelists.near;
        const to = target ? this.world(target.rig.head) : muzzle.clone().addScaledVector(fwd, 6);
        const dir = to.clone().sub(muzzle);
        const len = dir.length();
        this.beam.position.copy(muzzle);
        this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        this.beam.scale.set(1, len, 1);
        this.beam.visible = true;
        this.beamT = 0;
        for (let i = 0; i < 16; i++) P.spawn({ pos: muzzle, vel: randDir(0.9, fwd.clone().add(new THREE.Vector3(0, 0.2, 0)), rand(2, 6)), color: i % 2 ? C.gold : C.flameCore, size: 0.06, life: rand(0.3, 0.7), drag: 2 });
        this.lightFlash(muzzle, 16, 0.4);
        break;
      }
      case 'cigarSmoke':
        for (let i = 0; i < 7; i++) P.spawn({ pos: mouth.clone().add(new THREE.Vector3(rand(-0.05, 0.05), 0.05, 0)), vel: new THREE.Vector3(rand(-0.2, 0.2), rand(0.5, 0.9), rand(-0.1, 0.1)).addScaledVector(fwd, 0.25), color: i % 2 ? C.smoke : C.cream, size: rand(0.1, 0.18), life: rand(1.4, 2.4), grow: 1.4, drag: 0.6, shape: 'puff' });
        break;
      case 'whiskey':
        for (let i = 0; i < 10; i++) P.spawn({ pos: mouth.clone(), vel: new THREE.Vector3(rand(-0.8, 0.8), rand(0.5, 1.6), rand(-0.8, 0.8)), color: i % 2 ? C.gold : C.flameCore, size: 0.05, life: rand(0.4, 0.8), gravity: 2 });
        break;
      case 'heal':
        for (let i = 0; i < 18; i++) {
          const a = Math.random() * Math.PI * 2;
          P.spawn({ pos: feet.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, rand(0.2, 1.6), Math.sin(a) * 0.5)), vel: new THREE.Vector3(0, rand(0.6, 1.4), 0), color: i % 3 === 0 ? C.white : C.gold, size: rand(0.05, 0.09), life: rand(0.7, 1.3), drag: 0.5 });
        }
        break;
      case 'vaporize': {
        const cols = d.rig.burst;
        for (let i = 0; i < 46; i++) {
          P.spawn({ pos: feet.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0.2, 2.0), rand(-0.3, 0.3))), vel: new THREE.Vector3(rand(-1.5, 1.5), rand(0.5, 3.5), rand(-1.5, 1.5)), color: cols[i % cols.length], size: rand(0.06, 0.14), life: rand(0.8, 1.8), gravity: 1.5, drag: 1 });
        }
        for (let i = 0; i < 16; i++) P.spawn({ pos: feet.clone().add(new THREE.Vector3(0, rand(0.3, 2), 0)), vel: new THREE.Vector3(rand(-0.6, 0.6), rand(1.5, 4), rand(-0.6, 0.6)), color: i % 2 ? C.gold : C.white, size: 0.07, life: rand(1, 2) });
        this.fx('dust', side);
        d.puppet.flyHat(this.scene, fwd.clone().negate());
        d.rig.root.visible = false;
        d.puppet.vaporized = true;
        break;
      }
      case 'sparks':
        for (let i = 0; i < 14; i++) P.spawn({ pos: chest, vel: randDir(1.2, fwd.clone().negate(), rand(2, 5)), color: i % 2 ? C.flame : C.flameCore, size: 0.05, life: rand(0.2, 0.45), gravity: 7 });
        for (let i = 0; i < 4; i++) P.spawn({ pos: chest, vel: randDir(0.8, new THREE.Vector3(0, 1, 0), rand(0.4, 1)), color: C.smoke, size: 0.14, life: rand(0.5, 0.9), grow: 1.5, drag: 2, shape: 'puff' });
        break;
    }
  }

  private lightFlash(at: THREE.Vector3, intensity: number, dur: number): void {
    this.flashLight.position.copy(at);
    this.flashLight.intensity = intensity;
    this.flashLightT = dur;
  }

  fake(kind: FakeKind): void {
    this.town.fake(kind);
  }

  ringBell(): void {
    this.town.ringBell();
  }

  setSmokeCloud(on: boolean): void {
    this.cloudOn = on;
    if (on) this.cloud.visible = true;
  }

  // ------------------------------------------------------------ camera
  setPush(level: number): void {
    this.push = Math.max(0, Math.min(3, level));
  }

  punch(): void {
    this.punchAmt = 1;
  }

  slowmo(factor: number, ms: number): void {
    this.slowFactor = factor;
    this.slowLeft = ms / 1000;
  }

  shake(intensity: number): void {
    if (!this.opts.shake || this.opts.reducedMotion) return;
    this.shakeAmt = Math.max(this.shakeAmt, intensity);
  }

  setPost(p: Partial<PostSettings>): void {
    this.post.set(p);
  }

  setOptions(o: Partial<ViewOptions>): void {
    Object.assign(this.opts, o);
    if (this.opts.reducedMotion || !this.opts.shake) this.shakeAmt = 0;
  }

  setMode(mode: 'title' | 'duel'): void {
    this.mode = mode;
  }

  screenPos(side: ScreenSide, part: 'head' | 'hand' | 'feet'): { x: number; y: number } {
    const d = this.duelists[side];
    if (!d) return { x: 0.5, y: 0.5 };
    let p: THREE.Vector3;
    if (part === 'head') p = this.world(d.rig.head, this.tmp).add(new THREE.Vector3(0, 0.45, 0));
    else if (part === 'hand') p = this.world(d.rig.gunHand, this.tmp);
    else p = this.tmp.copy(d.rig.root.position);
    this.camera.updateMatrixWorld();
    p.project(this.camera);
    return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
  }

  private updateCamera(dt: number): void {
    const cam = this.camera;
    const reduced = this.opts.reducedMotion;
    if (this.mode === 'title') {
      const a = Math.sin(this.time * 0.12) * 0.5;
      const r = 12;
      cam.position.set(Math.sin(a) * r * 0.6 + 1.5, 3.6 + Math.sin(this.time * 0.2) * 0.4, Math.cos(a) * r - 1);
      cam.lookAt(0, 3.2, -14);
      cam.fov = 42;
      cam.updateProjectionMatrix();
      return;
    }
    this.pushCur += (this.push - this.pushCur) * (1 - Math.exp(-6 * dt));
    this.punchAmt = Math.max(0, this.punchAmt - dt * 2.2);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    const pushK = this.pushCur * (reduced ? 0.03 : 0.055);
    cam.position.copy(CAM_POS).lerp(CAM_LOOK, pushK);
    const look = CAM_LOOK.clone();
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * this.shakeAmt * 0.25;
      cam.position.x += rand(-s, s);
      cam.position.y += rand(-s, s);
      look.x += rand(-s, s) * 0.5;
    }
    cam.lookAt(look);
    const pk = this.punchAmt * this.punchAmt;
    cam.fov = BASE_FOV - (reduced ? 2 : 7) * pk;
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ loop
  frame(dt: number): void {
    dt = Math.min(dt, 0.1);
    if (this.slowLeft > 0) this.slowLeft -= dt;
    const scale = this.slowLeft > 0 ? this.slowFactor : 1;
    const adt = dt * scale;
    this.time += adt;

    for (const side of ['near', 'far'] as const) {
      const d = this.duelists[side];
      if (!d) continue;
      d.puppet.update(adt, this.scene);
      if (d.rig.halo && d.charge > 0) {
        const k = d.charge >= 2 ? 1.6 + Math.sin(this.time * 6) * 0.12 : 1;
        d.rig.halo.scale.setScalar(k);
        d.rig.halo.rotation.z += adt * 0.6;
        const disc = d.rig.halo.children[1] as THREE.Mesh;
        (disc.material as THREE.MeshBasicMaterial).opacity = d.charge >= 2 ? 0.6 + Math.sin(this.time * 6) * 0.15 : 0.25;
      }
    }

    const { coughPuff } = this.town.update(adt);
    this.coughCooldown -= adt;
    if (coughPuff && this.coughCooldown <= 0) {
      this.coughCooldown = 0.18;
      this.particles.spawn({ pos: this.town.coughPuffAt.clone(), vel: new THREE.Vector3(rand(-1.2, -0.6), rand(0, 0.4), rand(-0.3, 0.3)), color: C.smoke, size: 0.14, life: 0.8, grow: 2, drag: 2, shape: 'puff' });
    }
    this.particles.update(adt);

    // muzzle light
    if (this.flashLightT > 0) {
      this.flashLightT -= adt;
      if (this.flashLightT <= 0) this.flashLight.intensity = 0;
    }
    // lantern beam
    if (this.beam.visible) {
      this.beamT += adt;
      const k = this.beamT / 0.7;
      const m = this.beam.material as THREE.MeshBasicMaterial;
      if (k >= 1) { this.beam.visible = false; m.opacity = 0; } else m.opacity = 0.75 * (1 - k);
    }
    // smoke cloud
    this.cloudAmt += ((this.cloudOn ? 1 : 0) - this.cloudAmt) * (1 - Math.exp(-2.5 * adt));
    if (this.cloud.visible) {
      for (const c of this.cloud.children as THREE.Mesh[]) {
        const ph = c.userData.phase as number;
        const b = c.userData.base as THREE.Vector3;
        c.position.set(b.x + Math.sin(this.time * 0.5 + ph) * 0.25, b.y + Math.sin(this.time * 0.7 + ph) * 0.12, b.z);
        c.rotation.y += adt * 0.2;
        (c.material as THREE.MeshLambertMaterial).opacity = 0.8 * this.cloudAmt;
      }
      if (!this.cloudOn && this.cloudAmt < 0.02) this.cloud.visible = false;
    }

    this.updateCamera(dt);

    this.renderer.setRenderTarget(this.post.target);
    this.renderer.render(this.scene, this.camera);
    this.post.render(this.renderer, this.time, 0);
  }

  dispose(): void {
    this.post.dispose();
    this.renderer.dispose();
  }
}

/** Scale the 320x180 canvas to the largest integer multiple that fits the window, centred. */
export function fitCanvas(canvas: HTMLCanvasElement): void {
  const s = Math.max(1, Math.floor(Math.min(window.innerWidth / RES_W, window.innerHeight / RES_H)));
  const w = RES_W * s;
  const h = RES_H * s;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.style.position = 'absolute';
  canvas.style.left = `${Math.floor((window.innerWidth - w) / 2)}px`;
  canvas.style.top = `${Math.floor((window.innerHeight - h) / 2)}px`;
  canvas.style.imageRendering = 'pixelated';
}
