import * as THREE from 'three';

interface P {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  max: number;
  grow: number;
  gravity: number;
  drag: number;
  fade: boolean;
  baseScale: number;
  alive: boolean;
}

export interface SpawnOpts {
  pos: THREE.Vector3;
  vel?: THREE.Vector3;
  color: number;
  size: number;
  life: number;
  grow?: number;      // scale multiplier per second (additive)
  gravity?: number;
  drag?: number;
  fade?: boolean;
  shape?: 'box' | 'puff';
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const puffGeo = new THREE.IcosahedronGeometry(0.5, 0);

/** Pooled particle system of tiny unlit meshes; the dither pass makes them look hand-drawn. */
export class Particles {
  group = new THREE.Group();
  private pool: P[] = [];
  private next = 0;

  constructor(size = 220) {
    for (let i = 0; i < size; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
      const mesh = new THREE.Mesh(boxGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.pool.push({
        mesh, mat, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, max: 1,
        grow: 0, gravity: 0, drag: 0, fade: true, baseScale: 1, alive: false,
      });
    }
  }

  spawn(o: SpawnOpts): void {
    const p = this.pool[this.next];
    this.next = (this.next + 1) % this.pool.length;
    p.alive = true;
    p.mesh.visible = true;
    p.mesh.geometry = o.shape === 'puff' ? puffGeo : boxGeo;
    p.mesh.position.copy(o.pos);
    p.vel.copy(o.vel ?? new THREE.Vector3());
    p.spin.set(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3);
    p.mat.color.setHex(o.color);
    p.mat.opacity = 1;
    p.life = 0;
    p.max = o.life;
    p.grow = o.grow ?? 0;
    p.gravity = o.gravity ?? 0;
    p.drag = o.drag ?? 0;
    p.fade = o.fade ?? true;
    p.baseScale = o.size;
    p.mesh.scale.setScalar(o.size);
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.max) {
        p.alive = false;
        p.mesh.visible = false;
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.vel.multiplyScalar(Math.exp(-p.drag * dt));
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.02 && p.gravity > 0) {
        p.mesh.position.y = 0.02;
        p.vel.set(p.vel.x * 0.3, Math.abs(p.vel.y) * 0.2, p.vel.z * 0.3);
      }
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      const k = p.life / p.max;
      p.mesh.scale.setScalar(p.baseScale * (1 + p.grow * p.life));
      if (p.fade) p.mat.opacity = 1 - k * k;
    }
  }

  clear(): void {
    for (const p of this.pool) {
      p.alive = false;
      p.mesh.visible = false;
    }
  }
}

export function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function randDir(spread: number, forward: THREE.Vector3, speed: number): THREE.Vector3 {
  const v = forward.clone().normalize();
  v.x += rand(-spread, spread);
  v.y += rand(-spread, spread);
  v.z += rand(-spread, spread);
  return v.normalize().multiplyScalar(speed);
}
