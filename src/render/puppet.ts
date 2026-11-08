import * as THREE from 'three';
import type { Pose } from '../types';
import type { Rig } from './characters';

/** Joint targets a pose resolves to; the puppet eases toward them. */
interface Targets {
  fall: number; lean: number; drop: number; back: number;
  hipsY: number; torsoX: number; torsoZ: number;
  headX: number; headY: number; headZ: number;
  armLX: number; armLZ: number; armRX: number; armRZ: number;
  legLX: number; legRX: number; spread: number;
  book: number;
}

const KEYS: (keyof Targets)[] = [
  'fall', 'lean', 'drop', 'back', 'hipsY', 'torsoX', 'torsoZ', 'headX', 'headY', 'headZ',
  'armLX', 'armLZ', 'armRX', 'armRZ', 'legLX', 'legRX', 'spread', 'book',
];

function base(): Targets {
  return {
    fall: 0, lean: 0, drop: 0, back: 0, hipsY: 0, torsoX: 0, torsoZ: 0,
    headX: 0, headY: 0, headZ: 0,
    armLX: 0, armLZ: 0.14, armRX: 0, armRZ: -0.14,
    legLX: 0, legRX: 0, spread: 0, book: 0,
  };
}

/** Procedural pose animator for one rig. */
export class Puppet {
  pose: Pose = 'idle';
  private t = 0;          // time in current pose
  private clock = Math.random() * 10;
  private cur: Targets = base();
  private recoil = 0;
  private hitT = 99;
  private flinchT = 99;
  private feintT = 99;
  drunk = false;
  private hatFlying = false;
  private hatVel = new THREE.Vector3();
  private hatSpin = new THREE.Vector3();
  vaporized = false;
  /** Fired once when a 'dead' fall lands, for dust fx. */
  onLand: (() => void) | null = null;
  private landed = false;

  constructor(public rig: Rig) {
    this.applyGun();
  }

  setPose(p: Pose): void {
    // transient poses layer an impulse over the current base pose
    if (p === 'flinch') { this.flinchT = 0; return; }
    if (p === 'feint') { this.feintT = 0; return; }
    if (p === 'fire') this.recoil = 1;
    if (p === 'hit') this.hitT = 0;
    if (p !== 'dead' && p !== 'hit') this.restore();
    if (p === 'dead') this.landed = false;
    if (p === this.pose && p !== 'fire') return;
    this.pose = p;
    this.t = 0;
    this.applyGun();
  }

  /** Bring back hat and visibility after a loss/vaporize. */
  restore(): void {
    if (this.hatFlying || this.rig.hat.parent !== this.rig.hatHome.parent) {
      this.hatFlying = false;
      this.rig.hatHome.parent.add(this.rig.hat);
      this.rig.hat.position.copy(this.rig.hatHome.pos);
      this.rig.hat.rotation.copy(this.rig.hatHome.rot);
    }
    if (this.vaporized) {
      this.vaporized = false;
      this.rig.root.visible = true;
    }
  }

  /** Detach the hat and send it flying. `world` is the scene to fly in. */
  flyHat(world: THREE.Object3D, dir: THREE.Vector3): void {
    if (this.hatFlying) return;
    this.hatFlying = true;
    world.attach(this.rig.hat);
    this.hatVel.set(dir.x * 1.6 + (Math.random() - 0.5), 4.2, dir.z * 1.6);
    this.hatSpin.set(Math.random() * 8 - 4, Math.random() * 10 - 5, Math.random() * 8 - 4);
  }

  private applyGun(): void {
    const r = this.rig;
    if (r.id === 'mercy') return; // Bible is always in hand
    const drawn = this.pose === 'draw' || this.pose === 'fire' || this.pose === 'jam' ||
      (this.pose === 'win' && r.id === 'dusty') || this.pose === 'hit';
    r.gunHand.visible = drawn;
    if (r.gunHolster) r.gunHolster.visible = !drawn;
    if (r.bottle) r.bottle.visible = this.pose === 'heal';
  }

  private targets(): Targets {
    const T = base();
    const id = this.rig.id;
    const s = this.clock;
    const breathe = Math.sin(s * 2.1) * 0.02;
    T.torsoX = breathe;
    T.headX = -breathe * 0.5;
    switch (this.pose) {
      case 'idle':
        T.armLZ = 0.16 + breathe; T.armRZ = -0.16 - breathe;
        if (id === 'mercy') { T.armRX = -0.5; T.armRZ = 0.1; }
        break;
      case 'ready':
        T.hipsY = -0.05; T.torsoX = 0.08 + breathe; T.spread = 0.1;
        T.armRZ = -0.42; T.armRX = -0.12; T.armLZ = 0.38;
        if (id === 'mercy') { T.armRX = -0.7; T.armRZ = 0.15; T.armLZ = 0.3; T.headX = 0.1; }
        if (id === 'dusty') { T.armRZ = -0.5; T.armLZ = 0.5; }
        break;
      case 'draw': case 'fire': case 'jam':
        T.hipsY = -0.05; T.spread = 0.12; T.torsoX = 0.05;
        if (id === 'hector') { T.armRX = -1.55; T.armRZ = 0.04; T.armLZ = 0.5; T.torsoZ = 0.04; T.headY = 0.05; }
        if (id === 'dusty') { T.armRX = -1.25; T.armRZ = 0.25; T.armLX = -1.15; T.armLZ = -0.5; T.torsoX = 0.12; }
        if (id === 'mercy') { T.armRX = -1.45; T.armRZ = 0.08; T.armLX = -0.5; T.armLZ = 0.6; T.book = 1; T.headX = -0.05; }
        if (this.pose === 'jam') {
          T.armRX += Math.sin(s * 47) * 0.12; T.armRZ += Math.cos(s * 39) * 0.1;
          T.headX = 0.25; T.armLX = -1.2; T.armLZ = -0.3;
        }
        break;
      case 'hit':
        T.armLZ = 0.9; T.armRZ = -0.9; T.armLX = -0.4; T.armRX = -0.3; T.headX = -0.3;
        break;
      case 'dead': {
        const k = Math.min(1, this.t / 0.55);
        T.fall = -1.52 * (k * k); T.back = -0.25 * k;
        T.armLZ = 1.4; T.armRZ = -1.4; T.armLX = -0.3; T.armRX = -0.3; T.headX = -0.2;
        T.legLX = -0.3; T.legRX = 0.25; T.spread = 0.2;
        break;
      }
      case 'heal':
        if (id === 'hector') { T.armRX = -2.55; T.armRZ = 0.45; T.headX = -0.45; T.torsoX = -0.12; T.armLZ = 0.4; }
        else if (id === 'dusty') { T.armRX = -2.35; T.armRZ = 0.55; T.headX = -0.15; T.armLZ = 0.35; T.torsoX = -0.06 + Math.sin(s * 6) * 0.03; }
        else { T.armLX = -1.05; T.armLZ = -0.55; T.armRX = -1.05; T.armRZ = 0.55; T.headX = 0.35; }
        break;
      case 'pray':
        T.armLX = -1.05; T.armLZ = -0.55; T.armRX = -1.05; T.armRZ = 0.55; T.headX = 0.35;
        T.hipsY = -0.03;
        break;
      case 'win':
        if (id === 'hector') {
          T.headX = -0.45 + Math.sin(s * 14) * 0.08; T.torsoX = -0.15 + Math.sin(s * 14) * 0.05;
          T.armLX = -2.8; T.armLZ = 0.25; T.armRZ = -0.5; T.armRX = 0.2; T.drop = Math.abs(Math.sin(s * 7)) * 0.03;
        } else if (id === 'dusty') {
          T.armLX = -1.35; T.armLZ = -0.95; T.armRX = -1.3; T.armRZ = 0.95; T.headX = -0.15;
          T.drop = Math.abs(Math.sin(s * 5)) * 0.06; T.torsoZ = Math.sin(s * 2.5) * 0.06;
        } else {
          T.armLX = -1.05; T.armLZ = -0.55; T.armRX = -1.05; T.armRZ = 0.55; T.headX = 0.2;
          T.drop = -Math.sin(Math.min(1, this.t) * Math.PI / 2) * 0.12; // levitates slightly
        }
        break;
      case 'blinded':
        T.armLX = -2.5; T.armLZ = -0.65; T.headX = -0.35; T.armRZ = -0.7;
        T.torsoZ = Math.sin(s * 3.2) * 0.12; T.lean = Math.sin(s * 2.1) * 0.06;
        break;
      default:
        break;
    }
    if (this.drunk && this.pose !== 'dead') {
      T.torsoZ += Math.sin(s * 1.7) * 0.09;
      T.lean += Math.sin(s * 1.3) * 0.04;
      T.headZ += Math.sin(s * 2.3) * 0.12;
    }
    return T;
  }

  update(dt: number, world: THREE.Object3D): void {
    this.t += dt;
    this.clock += dt;
    const T = this.targets();
    const rate = this.pose === 'dead' ? 30 : this.pose === 'draw' || this.pose === 'fire' ? 26 : 12;
    const k = 1 - Math.exp(-rate * dt);
    for (const key of KEYS) this.cur[key] += (T[key] - this.cur[key]) * k;
    const c = this.cur;
    const r = this.rig;

    // impulses
    this.recoil = Math.max(0, this.recoil - dt * 4);
    this.hitT += dt;
    this.flinchT += dt;
    this.feintT += dt;
    const rec = this.recoil * this.recoil;
    const hitW = this.hitT < 1.2 ? Math.sin(this.hitT * 22) * Math.exp(-this.hitT * 4) : 0;
    const hitBack = this.hitT < 1.2 ? Math.exp(-this.hitT * 3) : 0;
    const flinch = this.flinchT < 0.35 ? Math.sin((this.flinchT / 0.35) * Math.PI) : 0;
    const feint = this.feintT < 0.3 ? Math.sin((this.feintT / 0.3) * Math.PI) : 0;

    r.body.rotation.x = c.fall + hitBack * -0.18 + flinch * -0.08;
    r.body.rotation.z = c.lean + hitW * 0.12;
    r.body.position.z = c.back - rec * 0.14 - hitBack * 0.18;
    r.hips.position.y = r.hipY + c.hipsY - c.drop - flinch * 0.03;
    r.torso.rotation.x = c.torsoX - rec * 0.18 + hitW * 0.2;
    r.torso.rotation.z = c.torsoZ;
    r.head.rotation.set(c.headX - rec * 0.15 + flinch * 0.15, c.headY, c.headZ + hitW * 0.3);
    r.armL.rotation.set(c.armLX, 0, c.armLZ);
    r.armR.rotation.set(c.armRX - rec * 0.75 - feint * 0.35, 0, c.armRZ - feint * 0.35);
    r.legL.rotation.set(c.legLX, 0, c.spread);
    r.legR.rotation.set(c.legRX, 0, -c.spread);
    if (r.coverL && r.coverR) {
      r.coverL.rotation.y = c.book * 1.25;
      r.coverR.rotation.y = -c.book * 1.25;
    }
    if (r.lanternGlow) r.lanternGlow.visible = c.book > 0.3;

    if (this.pose === 'dead' && !this.landed && this.t > 0.5) {
      this.landed = true;
      this.onLand?.();
    }

    // hat: drunk wobble or flight
    if (this.hatFlying) {
      const h = r.hat;
      this.hatVel.y -= 9.8 * dt;
      h.position.addScaledVector(this.hatVel, dt);
      if (h.position.y < 0.04) {
        h.position.y = 0.04;
        this.hatVel.set(this.hatVel.x * 0.4, 0, this.hatVel.z * 0.4);
        this.hatSpin.multiplyScalar(0.5);
        h.rotation.x += (0 - h.rotation.x) * 0.3;
        h.rotation.z += (0 - h.rotation.z) * 0.3;
      } else {
        h.rotation.x += this.hatSpin.x * dt;
        h.rotation.y += this.hatSpin.y * dt;
        h.rotation.z += this.hatSpin.z * dt;
      }
    } else {
      const home = r.hatHome.rot;
      const wob = this.drunk ? Math.sin(this.clock * 4.3) * 0.22 : 0;
      r.hat.rotation.set(home.x + (this.drunk ? Math.sin(this.clock * 3.1) * 0.1 : 0), home.y, home.z + wob);
      r.hat.position.y = r.hatHome.pos.y + flinch * 0.08 + hitBack * 0.06;
    }
    void world;
  }
}
