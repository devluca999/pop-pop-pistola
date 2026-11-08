import * as THREE from 'three';
import type { CharacterId, Pose, FxKind, FakeKind, ScreenSide, PostSettings, ViewOptions } from '../types';
import { buildCharacter, type Rig } from './characters';
import { Puppet } from './puppet';
import { Town, TOWER_Z } from './town';
import { Particles, rand, randDir } from './fx';
import { PostPass } from './post';
import { C } from './materials';
import { skyBackdrop, NOON_SKY } from './textures';
import { computeView, RES_H, type StageView, type Insets } from './view';

export { computeView, RES_H, ASPECT_MIN, ASPECT_MAX } from './view';
export type { StageView } from './view';

/** Reference internal width (16:9). The live width follows the screen: see StageView.resW. */
export const RES_W = 384;
/** Near duelist's three-quarter turn (radians) so we see their right side/back; eases toward square when shooting. */
const NEAR_TURN = 0.68;
const NEAR_TURN_DRAWN = 0.2;

const NEAR_Z = 3.0;
const FAR_Z = -4.2;
/** How far behind the near duelist the camera sits. */
const CAM_BACK = 2.5;
const BASE_FOV = 40;

/**
 * Vertical FOV for an aspect: a little wider on 4:3 (so the tower and near shoulder still fit),
 * a little tighter on 21:9 (so it never turns into a wide shot).
 */
export function fovForAspect(aspect: number): number {
  return BASE_FOV * Math.pow(16 / 9 / aspect, 0.4);
}

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
  private camera = new THREE.PerspectiveCamera(BASE_FOV, RES_W / RES_H, 0.1, 400);
  private post = new PostPass(RES_W, RES_H);
  private canvas: HTMLCanvasElement;
  private container: HTMLElement;
  private ro: ResizeObserver | null = null;
  /** Exact device-pixel size of the canvas when the browser reports it. */
  private devBox: { w: number; h: number } | null = null;
  private viewNow!: StageView;
  private resizeCbs: ((v: StageView) => void)[] = [];
  private baseFov = BASE_FOV;
  /** FOV chosen by frameShot (base for push-ins). */
  private shotFov = BASE_FOV;
  private skyW = 0;
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
  /** Over-the-shoulder framing, recomputed per matchup in frameShot(). */
  private camPos = new THREE.Vector3(0.95, 1.8, NEAR_Z + CAM_BACK);
  private camLook = new THREE.Vector3(0, 1.8, FAR_Z);
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
  private nearTurn = NEAR_TURN;

  /**
   * @param canvas the game canvas; it is sized to cover `container` (bars included).
   * @param container element whose size drives the view (default: the canvas's parent).
   *   Its padding (e.g. safe-area insets) is kept clear of the game image but still gets bars.
   */
  constructor(canvas: HTMLCanvasElement, container: HTMLElement = canvas.parentElement ?? document.body) {
    this.canvas = canvas;
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', imageRendering: 'pixelated' });

    this.scene.fog = new THREE.Fog(0xe6e2da, 90, 330);

    // low, cool ambient: shadows read blue-grey against the warm sunlit dirt
    const hemi = new THREE.HemisphereLight(0xc4c9cf, 0x6a4c34, 1.05);
    this.scene.add(hemi);
    // strong warm high-noon key, almost overhead: short, hard shadows under everything
    this.sun = new THREE.DirectionalLight(0xfff0dc, 3.5);
    this.sun.position.set(0.6, 14, 7.0);
    this.sun.target.position.set(0, 0, -4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -16; sc.right = 16; sc.top = 22; sc.bottom = -26; sc.near = 1; sc.far = 50;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
    // warm bounce off the bright street: lights both rows of facades (they face across the street)
    for (const sx of [-1, 1]) {
      const fill = new THREE.DirectionalLight(0xf8c08f, 1.25);
      fill.position.set(sx * 10, 3, 4);
      fill.target.position.set(0, 2, -6);
      this.scene.add(fill, fill.target);
    }
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

    // measure now so the very first frame is already the right size
    this.applyView(this.measure());
    this.setDuelists('hector', 'dusty');
    this.updateCamera(0);
    this.observe();
  }

  // ------------------------------------------------------------ screen size
  /** Current layout: internal resolution, upscale and the visible image rect. */
  get view(): StageView {
    return this.viewNow;
  }

  /** Called (synchronously, inside the resize observation) whenever the view changes. Returns an unsubscribe. */
  onResize(cb: (v: StageView) => void): () => void {
    this.resizeCbs.push(cb);
    return () => { this.resizeCbs = this.resizeCbs.filter((f) => f !== cb); };
  }

  private measure(): StageView {
    const c = this.container;
    const cssW = c.clientWidth || window.innerWidth;
    const cssH = c.clientHeight || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    let dev = { w: Math.round(cssW * dpr), h: Math.round(cssH * dpr) };
    // prefer the exact device-pixel box, unless it disagrees with css x dpr (stale or emulated)
    const b = this.devBox;
    if (b && Math.abs(b.w - cssW * dpr) <= 2 && Math.abs(b.h - cssH * dpr) <= 2) dev = b;
    const cs = getComputedStyle(c);
    const pad: Insets = {
      top: parseFloat(cs.paddingTop) || 0,
      right: parseFloat(cs.paddingRight) || 0,
      bottom: parseFloat(cs.paddingBottom) || 0,
      left: parseFloat(cs.paddingLeft) || 0,
    };
    return computeView(cssW, cssH, dev.w, dev.h, pad);
  }

  private applyView(v: StageView): void {
    const old = this.viewNow;
    this.viewNow = v;
    if (!old || old.devW !== v.devW || old.devH !== v.devH) this.renderer.setSize(v.devW, v.devH, false);
    this.post.resize(v.resW, v.resH);
    this.post.place(v.dev.x, v.dev.y, v.dev.w, v.dev.h, v.scale, v.devW, v.devH);
    if (!old || old.resW !== v.resW) {
      this.camera.aspect = v.resW / v.resH;
      this.baseFov = fovForAspect(this.camera.aspect);
      this.refreshSky();
      if (old) this.frameShot();
    }
  }

  private refreshSky(): void {
    const w = Math.round(108 * (this.viewNow.resW / this.viewNow.resH));
    if (w === this.skyW) return;
    this.skyW = w;
    this.scene.background = skyBackdrop(NOON_SKY, w);
  }

  /** Re-measure now and redraw at once, so a resize never shows a stretched or blank frame. */
  resize(): void {
    const v = this.measure();
    const o = this.viewNow;
    if (o && v.devW === o.devW && v.devH === o.devH && v.resW === o.resW && v.dev.x === o.dev.x && v.dev.y === o.dev.y && v.scale === o.scale) return;
    this.applyView(v);
    for (const cb of this.resizeCbs) cb(v);
    this.render(); // changing canvas size clears it: draw this frame immediately
  }

  private observe(): void {
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', () => this.resize());
      return;
    }
    this.ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.target === this.canvas) {
          const d = e.devicePixelContentBoxSize?.[0];
          this.devBox = d ? { w: d.inlineSize, h: d.blockSize } : null;
        }
      }
      this.resize();
    });
    this.ro.observe(this.container);
    try {
      this.ro.observe(this.canvas, { box: 'device-pixel-content-box' });
    } catch {
      this.ro.observe(this.canvas);
    }
    // zoom / moving between monitors changes the pixel ratio without a size change
    window.addEventListener('resize', () => this.resize());
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
      // noon sun is overhead: a 3x-wide hat would black out its own wearer. Hats skip shadow casting.
      rig.hat.traverse((o) => { (o as THREE.Mesh).castShadow = false; });
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
    this.frameShot();
    this.particles.clear();
    this.setSmokeCloud(false);
    this.cloudAmt = 0;
  }

  setPose(side: ScreenSide, pose: Pose): void {
    const d = this.duelists[side];
    if (!d) return;
    d.puppet.setPose(pose);
    if (pose === 'dead') this.fx('hatFly', side);
    if (side === 'near' && pose !== 'flinch' && pose !== 'feint') {
      this.nearTurn = pose === 'draw' || pose === 'fire' || pose === 'jam' ? NEAR_TURN_DRAWN : NEAR_TURN;
    }
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
        P.spawn({ pos: muzzle, color: C.flameCore, size: 0.3, life: 0.07, fade: false, shape: 'puff' });
        P.spawn({ pos: muzzle.clone().addScaledVector(fwd, 0.25), color: C.flame, size: 0.2, life: 0.09, fade: false, shape: 'puff' });
        for (let i = 0; i < 10; i++) P.spawn({ pos: muzzle, vel: randDir(0.5, fwd, rand(4, 9)), color: i % 2 ? C.flame : C.gold, size: 0.05, life: rand(0.15, 0.35), gravity: 6 });
        for (let i = 0; i < 3; i++) P.spawn({ pos: muzzle, vel: randDir(0.4, fwd.clone().add(new THREE.Vector3(0, 0.6, 0)), rand(0.4, 1)), color: C.smoke, size: 0.18, life: rand(0.6, 1.1), grow: 1.6, drag: 2, shape: 'puff' });
        this.lightFlash(muzzle, 9, 0.09);
        break;
      }
      case 'shotgunBlast': {
        P.spawn({ pos: muzzle, color: C.flameCore, size: 0.42, life: 0.09, fade: false, shape: 'puff' });
        P.spawn({ pos: muzzle.clone().addScaledVector(fwd, 0.4), color: C.flame, size: 0.3, life: 0.11, fade: false, shape: 'puff' });
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

  /**
   * Over-the-shoulder shot (refs/map.png, bottom panel). The near duelist stands in the left third,
   * turned three-quarters so we see their right side and back, cropped by the frame edge below the
   * knee. The opponent stands centred mid-ground, full body. The far duelist is nudged sideways so
   * the line from the camera through their head lands on the bell tower, and the camera slides right
   * until the near duelist (hat included) stays clear of the frame centre.
   */
  private frameShot(): void {
    const near = this.duelists.near;
    const far = this.duelists.far;
    if (!near || !far) return;
    this.nearTurn = NEAR_TURN;
    near.rig.root.rotation.y = Math.PI + NEAR_TURN;
    near.rig.root.updateMatrixWorld(true);
    far.rig.root.updateMatrixWorld(true);
    const hat = near.rig.hat;
    const hatParent = hat.parent;
    hatParent?.remove(hat);
    const body = new THREE.Box3().setFromObject(near.rig.root);
    hatParent?.add(hat);
    const hatBox = new THREE.Box3().setFromObject(hat);
    const nearHead = near.rig.head.getWorldPosition(new THREE.Vector3());
    const cornersOf = (b: THREE.Box3): THREE.Vector3[] => {
      const out: THREE.Vector3[] = [];
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) out.push(new THREE.Vector3(x, y, z));
      return out;
    };
    const bodyCorners = cornersOf(body);
    const hatCorners = cornersOf(hatBox);
    const camY = Math.max(1.0, nearHead.y * 0.8); // below the brim: we look past the shoulder
    const camZ = NEAR_Z + CAM_BACK;
    const towerZ = TOWER_Z;
    const bellTop = this.town.bell.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.3, 0));
    const cam = this.camera;
    cam.aspect = this.viewNow.resW / this.viewNow.resH;
    const ndc = (v: THREE.Vector3): THREE.Vector3 => v.clone().project(cam);
    // Start from the aspect's FOV; widen a little if the rival's feet or the bell would leave the frame.
    for (let widen = 0; widen <= 14; widen++) {
      cam.fov = this.baseFov + widen;
      cam.updateProjectionMatrix();
      let camX = 0.5;
      for (let iter = 0; iter < 40; iter++) {
        const farX = camX * (1 - (camZ - FAR_Z) / (camZ - towerZ));
        far.rig.root.position.x = farX;
        far.rig.root.rotation.y = Math.atan2(camX - farX, camZ - FAR_Z);
        far.rig.root.updateMatrixWorld(true);
        const farHead = far.rig.head.getWorldPosition(new THREE.Vector3());
        this.camPos.set(camX, camY, camZ);
        // aim between the opponent's knees and head so they sit centred, full body
        this.camLook.set(farX, farHead.y * 1.15, FAR_Z);
        cam.position.copy(this.camPos);
        cam.lookAt(this.camLook);
        cam.updateMatrixWorld();
        const maxX = (cs: THREE.Vector3[]): number => {
          let m = -1;
          for (const c of cs) {
            const p = c.clone().project(cam);
            if (p.z < 1) m = Math.max(m, p.x);
          }
          return m;
        };
        // body in the left third; the hat brim may reach a little further but never the centre
        if (maxX(bodyCorners) < -0.3 && maxX(hatCorners) < -0.04) break;
        camX += 0.05;
      }
      const feet = ndc(far.rig.root.position);
      const bell = ndc(bellTop);
      if (feet.y > -0.94 && bell.y < 0.94) break;
    }
    this.shotFov = cam.fov;
    far.forward.set(Math.sin(far.rig.root.rotation.y), 0, Math.cos(far.rig.root.rotation.y));
  }

  /**
   * Framing check in NDC (-1..1, y up) for tests: near body/hat right edge, rival feet/head,
   * bell position and the rival-to-bell horizontal offset.
   */
  framing(): { aspect: number; fov: number; nearBodyMaxX: number; nearHatMaxX: number; nearVisible: boolean; rivalX: number; rivalFeetY: number; rivalHeadY: number; bellX: number; bellY: number; ok: boolean } {
    const near = this.duelists.near!;
    const far = this.duelists.far!;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const hat = near.rig.hat;
    const hp = hat.parent;
    hp?.remove(hat);
    const body = new THREE.Box3().setFromObject(near.rig.root);
    hp?.add(hat);
    const hatBox = new THREE.Box3().setFromObject(hat);
    const xs = (b: THREE.Box3) => {
      let mx = -9;
      let mn = 9;
      for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
        const p = new THREE.Vector3(x, y, z).project(cam);
        mx = Math.max(mx, p.x);
        mn = Math.min(mn, p.x);
      }
      return { mx, mn };
    };
    const nb = xs(body);
    const nh = xs(hatBox);
    const head = this.world(far.rig.head).add(new THREE.Vector3(0, 0.45, 0)).project(cam);
    const feet = far.rig.root.position.clone().project(cam);
    const bell = this.town.bell.getWorldPosition(new THREE.Vector3()).project(cam);
    const r = {
      aspect: cam.aspect, fov: cam.fov,
      nearBodyMaxX: nb.mx, nearHatMaxX: nh.mx, nearVisible: nb.mx > -0.98,
      rivalX: feet.x, rivalFeetY: feet.y, rivalHeadY: head.y, bellX: bell.x, bellY: bell.y, ok: false,
    };
    r.ok = r.nearBodyMaxX < -0.28 && r.nearHatMaxX < 0 && r.nearVisible && Math.abs(r.rivalX) < 0.2 &&
      r.rivalFeetY > -1 && r.bellY < 1 && r.bellY > r.rivalHeadY && Math.abs(r.bellX - head.x) < 0.15;
    return r;
  }

  private updateCamera(dt: number): void {
    const cam = this.camera;
    const reduced = this.opts.reducedMotion;
    if (this.mode === 'title') {
      const a = Math.sin(this.time * 0.12) * 0.5;
      const r = 12;
      cam.position.set(Math.sin(a) * r * 0.6 + 1.5, 3.6 + Math.sin(this.time * 0.2) * 0.4, Math.cos(a) * r - 1);
      cam.lookAt(0, 3.2, -14);
      cam.fov = 42 * (this.baseFov / BASE_FOV);
      cam.updateProjectionMatrix();
      return;
    }
    this.pushCur += (this.push - this.pushCur) * (1 - Math.exp(-6 * dt));
    this.punchAmt = Math.max(0, this.punchAmt - dt * 2.2);
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.5);
    // Push-ins zoom rather than dolly, so the near duelist never leaves the frame.
    cam.position.copy(this.camPos);
    const look = this.camLook.clone();
    if (this.shakeAmt > 0) {
      const s = this.shakeAmt * this.shakeAmt * 0.25;
      cam.position.x += rand(-s, s);
      cam.position.y += rand(-s, s);
      look.x += rand(-s, s) * 0.5;
    }
    cam.lookAt(look);
    const pk = this.punchAmt * this.punchAmt;
    cam.fov = this.shotFov - this.pushCur * (reduced ? 1 : 2) - (reduced ? 2 : 7) * pk;
    cam.updateProjectionMatrix();
  }

  // ------------------------------------------------------------ loop
  frame(dt: number): void {
    dt = Math.min(dt, 0.1);
    if (this.slowLeft > 0) this.slowLeft -= dt;
    const scale = this.slowLeft > 0 ? this.slowFactor : 1;
    const adt = dt * scale;
    this.time += adt;

    const nd = this.duelists.near;
    if (nd) {
      const target = Math.PI + this.nearTurn;
      nd.rig.root.rotation.y += (target - nd.rig.root.rotation.y) * (1 - Math.exp(-10 * adt));
    }
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
    this.render();
  }

  private render(): void {
    this.renderer.setRenderTarget(this.post.target);
    this.renderer.render(this.scene, this.camera);
    this.post.render(this.renderer, this.time, 0);
  }

  dispose(): void {
    this.ro?.disconnect();
    this.post.dispose();
    this.renderer.dispose();
  }
}

/** @deprecated The Stage now sizes the canvas itself (it fills its container). Kept as a no-op. */
export function fitCanvas(_canvas: HTMLCanvasElement): void {
  /* no-op */
}
