import * as THREE from 'three';
import type { FakeKind } from '../types';
import type { MapDef } from './maps/types';
import type { Particles } from './fx';
import { RIM } from './materials';
import { sharedBoxGeo } from './materials';

/** A hanging lantern's moving parts (flicker, dimming). */
export interface Lantern {
  flame: THREE.Mesh;
  glow: THREE.Mesh;
  light: THREE.PointLight;
  /** Multiplier the 'flicker' fake drives (1 = normal). */
  dim: number;
}

/**
 * The set for one map: props, lights, the bell and every animated bit. Built from a MapDef;
 * throw it away and build another to change maps.
 */
export class World {
  readonly group = new THREE.Group();
  readonly def: MapDef;
  readonly particles: Particles;
  /** Bell pivot (swings when rung). Set by a bell prop. */
  bell: THREE.Object3D = new THREE.Group();
  lanterns: Lantern[] = [];
  /** Per-frame animation hooks: (t = seconds since build, dt). */
  animators: ((t: number, dt: number) => void)[] = [];
  /** Visual for each fake this map can show. */
  fakes: Partial<Record<FakeKind, () => void>> = {};
  /** Lantern base intensity. */
  lanternBase: number;
  /** The shadow-casting key light. */
  key: THREE.DirectionalLight;
  private bellSwing = 0;
  private bellVel = 0;
  private clock = 0;

  constructor(def: MapDef, particles: Particles) {
    this.def = def;
    this.particles = particles;
    const L = def.light;
    this.lanternBase = L.lantern;
    const g = this.group;
    g.add(new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity));
    const k = new THREE.DirectionalLight(L.key.color, L.key.intensity);
    k.position.set(...L.key.pos);
    k.target.position.set(...L.key.target);
    k.castShadow = true;
    k.shadow.mapSize.set(2048, 2048);
    const sc = k.shadow.camera;
    sc.left = L.key.shadow.l; sc.right = L.key.shadow.r; sc.top = L.key.shadow.t; sc.bottom = L.key.shadow.b;
    sc.near = 1; sc.far = L.key.shadow.far;
    k.shadow.bias = -0.0006;
    k.shadow.normalBias = 0.03;
    g.add(k, k.target);
    this.key = k;
    for (const f of L.fills) {
      const d = new THREE.DirectionalLight(f.color, f.intensity);
      d.position.set(...f.pos);
      d.target.position.set(...f.target);
      g.add(d, d.target);
    }
    for (const p of def.props) p(this);
  }

  /** Scene-wide settings this map owns (fog, rim). Background is set by the Stage (depends on aspect). */
  applyTo(scene: THREE.Scene): void {
    const L = this.def.light;
    scene.fog = new THREE.Fog(L.fog.color, L.fog.near, L.fog.far);
    RIM.color.set(L.rim.color);
    RIM.strength.value = L.rim.strength;
  }

  ringBell(): void {
    this.bellVel += 4.5;
  }

  fake(kind: FakeKind): void {
    this.fakes[kind]?.();
  }

  update(dt: number): void {
    this.clock += dt;
    const t = this.clock;
    this.bellVel += -this.bellSwing * 16 * dt;
    this.bellVel *= Math.exp(-0.9 * dt);
    this.bellSwing += this.bellVel * dt;
    this.bell.rotation.x = this.bellSwing;
    for (let i = 0; i < this.lanterns.length; i++) {
      const l = this.lanterns[i];
      const f = 0.9 + Math.sin(t * 13 + i * 1.7) * 0.06 + Math.sin(t * 7.3 + i) * 0.04;
      l.flame.scale.set(0.14, 0.24 * f * Math.max(0.3, l.dim), 0.14);
      l.light.intensity = this.lanternBase * f * l.dim;
      (l.glow.material as THREE.MeshBasicMaterial).opacity = 0.3 * l.dim;
    }
    for (const a of this.animators) a(t, dt);
  }

  /** Free per-map geometry (shared materials and textures are cached and kept). */
  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.geometry && m.geometry !== sharedBoxGeo) m.geometry.dispose();
      if ((o as THREE.Light).isLight) (o as THREE.Light).dispose?.();
    });
  }
}
