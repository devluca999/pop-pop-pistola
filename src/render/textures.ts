import * as THREE from 'three';

/** Small procedural pixel textures (NearestFilter). Cached by key. */
const cache = new Map<string, THREE.CanvasTexture>();

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hex(h: number): string {
  return `#${h.toString(16).padStart(6, '0')}`;
}

/** Shade a hex colour by factor (1 = same). */
function shade(h: number, f: number): string {
  const r = Math.min(255, Math.round(((h >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((h >> 8) & 255) * f));
  const b = Math.min(255, Math.round((h & 255) * f));
  return `rgb(${r},${g},${b})`;
}

function make(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed = 1): THREE.CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Wooden planks with grain and nail dots. vertical = boards run up-down (walls). */
export function planks(base: number, vertical: boolean, seed = 3): THREE.CanvasTexture {
  return make(`planks-${base}-${vertical}-${seed}`, 32, 32, (g, r) => {
    const n = 4; // planks per tile
    const pw = 32 / n;
    for (let i = 0; i < n; i++) {
      const f = 0.86 + r() * 0.26;
      g.fillStyle = shade(base, f);
      if (vertical) g.fillRect(i * pw, 0, pw, 32);
      else g.fillRect(0, i * pw, 32, pw);
      // grain streaks
      for (let k = 0; k < 6; k++) {
        g.fillStyle = shade(base, f * (r() > 0.5 ? 0.78 : 1.12));
        const a = Math.floor(r() * (pw - 2)) + 1;
        const b = Math.floor(r() * 24);
        const len = 4 + Math.floor(r() * 10);
        if (vertical) g.fillRect(i * pw + a, b, 1, len);
        else g.fillRect(b, i * pw + a, len, 1);
      }
      // a knot
      if (r() > 0.55) {
        g.fillStyle = shade(base, 0.55);
        const a = Math.floor(r() * (pw - 3)) + 1;
        const b = Math.floor(r() * 28);
        if (vertical) g.fillRect(i * pw + a, b, 2, 2);
        else g.fillRect(b, i * pw + a, 2, 2);
      }
      // gap between planks, with a sunlit cream edge beside it
      g.fillStyle = shade(base, 0.42);
      if (vertical) g.fillRect(i * pw, 0, 1, 32);
      else g.fillRect(0, i * pw, 32, 1);
      g.fillStyle = shade(base, 1.45);
      if (vertical) g.fillRect(i * pw + 1, 0, 1, 32);
      else g.fillRect(0, i * pw + 1, 32, 1);
      // nails
      g.fillStyle = '#2a201a';
      if (vertical) { g.fillRect(i * pw + 2, 2, 1, 1); g.fillRect(i * pw + pw - 3, 2, 1, 1); g.fillRect(i * pw + 2, 18, 1, 1); }
      else { g.fillRect(2, i * pw + 2, 1, 1); g.fillRect(2, i * pw + pw - 3, 1, 1); g.fillRect(18, i * pw + 2, 1, 1); }
    }
  }, seed);
}

/** Roof shingles: staggered rows with dark bottom edges. */
export function shingles(base: number): THREE.CanvasTexture {
  return make(`shingles-${base}`, 32, 32, (g, r) => {
    const rh = 6;
    for (let row = 0; row < 32 / rh + 1; row++) {
      const off = row % 2 ? 4 : 0;
      for (let x = -8; x < 32; x += 8) {
        g.fillStyle = shade(base, 0.8 + r() * 0.35);
        g.fillRect(x + off, row * rh, 8, rh);
        g.fillStyle = shade(base, 0.45);
        g.fillRect(x + off, row * rh + rh - 1, 8, 1);
        g.fillRect(x + off, row * rh, 1, rh);
      }
    }
  });
}

/** Stone/brick blocks with mortar lines (church). */
export function stone(base: number): THREE.CanvasTexture {
  return make(`stone-${base}`, 32, 32, (g, r) => {
    g.fillStyle = shade(base, 0.62);
    g.fillRect(0, 0, 32, 32);
    const bh = 8;
    for (let row = 0; row < 4; row++) {
      const off = row % 2 ? 5 : 0;
      for (let x = -11; x < 32; x += 11) {
        g.fillStyle = shade(base, 0.85 + r() * 0.3);
        g.fillRect(x + off + 1, row * bh + 1, 10, bh - 1);
        g.fillStyle = shade(base, 1.12);
        g.fillRect(x + off + 1, row * bh + 1, 10, 1);
        if (r() > 0.6) { g.fillStyle = shade(base, 0.72); g.fillRect(x + off + 2 + Math.floor(r() * 7), row * bh + 3 + Math.floor(r() * 3), 2, 1); }
      }
    }
  });
}

/** Speckled dirt with pebbles. */
export function dirt(base: number, seed = 5): THREE.CanvasTexture {
  return make(`dirt-${base}-${seed}`, 64, 64, (g, r) => {
    g.fillStyle = hex(base);
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 520; i++) {
      g.fillStyle = shade(base, r() > 0.5 ? 0.82 + r() * 0.08 : 1.06 + r() * 0.08);
      g.fillRect(Math.floor(r() * 64), Math.floor(r() * 64), 1, 1);
    }
    // pebbles: single texels (2-texel pebbles read as big bars right in front of the camera)
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(r() * 63);
      const y = Math.floor(r() * 63);
      g.fillStyle = shade(base, 0.72);
      g.fillRect(x, y + 1, 1, 1);
      g.fillStyle = shade(base, 1.12);
      g.fillRect(x, y, 1, 1);
    }
  }, seed);
}

/** Street dirt: like dirt() plus two pairs of wheel ruts running along the tile's v axis. */
export function street(base: number): THREE.CanvasTexture {
  return make(`street-${base}`, 64, 64, (g, r) => {
    g.fillStyle = hex(base);
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 600; i++) {
      g.fillStyle = shade(base, r() > 0.5 ? 0.82 + r() * 0.08 : 1.06 + r() * 0.08);
      g.fillRect(Math.floor(r() * 64), Math.floor(r() * 64), 1, 1);
    }
    for (const x of [13, 19, 44, 50]) {
      for (let y = 0; y < 64; y++) {
        g.fillStyle = shade(base, 0.86 + r() * 0.05);
        g.fillRect(x + (r() > 0.85 ? 1 : 0), y, 2, 1);
        g.fillStyle = shade(base, 1.1);
        if (r() > 0.7) g.fillRect(x + 2, y, 1, 1);
      }
    }
    // pebbles: single texels (2-texel pebbles read as big bars right in front of the camera)
    for (let i = 0; i < 18; i++) {
      const x = Math.floor(r() * 63);
      const y = Math.floor(r() * 63);
      g.fillStyle = shade(base, 0.72);
      g.fillRect(x, y + 1, 1, 1);
      g.fillStyle = shade(base, 1.12);
      g.fillRect(x, y, 1, 1);
    }
  });
}

/** Screen-space sky: a gradient that thickens toward the top corners, an optional disc and stars. */
export interface SkySpec {
  key: string;
  /** [position 0..1, colour]: 0 = horizon band, 1 = top corners. */
  stops: [number, number][];
  /** Fraction of the height where the gradient bottoms out (horizon band). */
  horizon: number;
  /** How much the top corners darken beyond the centre. */
  corner: number;
  /** Sun or moon. x is an offset from the centre, in sky pixels (sky is 108 px tall). */
  disc?: { x: number; y: number; r: number; color: number; rim: number; halo: number; haloAmt: number };
  /** Number of single-pixel stars (night skies). */
  stars?: number;
  starColor?: number;
}

/**
 * High-noon sky (refs/map.png): mostly cream/off-white, with dusty blue that thickens toward the
 * top corners (the post pass turns the in-between tones into a blue stipple). A clean, round
 * pale-cream sun sits above and slightly left of the church cross, with a soft halo.
 */
export const NOON_SKY: SkySpec = {
  key: 'noon',
  stops: [[0, 0xedebe7], [0.35, 0xc4c9cf], [0.7, 0x97a6b6], [1, 0x69819d]],
  horizon: 66 / 108,
  corner: 0.55,
  disc: { x: -16, y: 11, r: 8, color: 0xf6eede, rim: 0xf3e4c8, halo: 0xd8dad8, haloAmt: 0.85 },
};

const rgbOf = (h: number): number[] => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

/** Sky backdrop texture `w` pixels wide (108 tall), so it is never stretched at any aspect. */
export function skyBackdrop(spec: SkySpec = NOON_SKY, w = 192): THREE.CanvasTexture {
  const H = 108;
  w = Math.max(16, Math.round(w));
  return make(`sky:${spec.key}:${w}`, w, H, (g, r) => {
    const img = g.createImageData(w, H);
    const stops = spec.stops.map(([p, c]) => [p, rgbOf(c)] as const);
    const mix = (a: readonly number[], b: readonly number[], t: number) => a.map((v, k) => v + (b[k] - v) * t);
    const grad = (b: number): number[] => {
      for (let i = 1; i < stops.length; i++) {
        if (b <= stops[i][0]) {
          const [p0, c0] = stops[i - 1];
          const [p1, c1] = stops[i];
          return mix(c0, c1, (b - p0) / Math.max(1e-6, p1 - p0));
        }
      }
      return [...stops[stops.length - 1][1]];
    };
    const d0 = spec.disc;
    const sunX = w / 2 + (d0?.x ?? 0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < w; x++) {
        const up = Math.max(0, 1 - y / (H * spec.horizon));
        const corner = Math.abs(x - w / 2) / (w / 2);
        const b = Math.min(1, up * (1 - spec.corner + 0.27 + spec.corner * corner));
        let c = grad(b);
        if (d0) {
          // halo fades the sky toward the halo colour around the disc
          const d = Math.hypot(x - sunX, (y - d0.y) * 1.05);
          if (d < d0.r * 3.2) {
            const h = 1 - (d - d0.r) / (d0.r * 2.2);
            if (h > 0) c = mix(c, rgbOf(d0.halo), Math.min(d0.haloAmt, h * 1.1));
          }
          if (d <= d0.r) c = rgbOf(d0.color);
          if (d <= d0.r && d > d0.r - 1.2) c = rgbOf(d0.rim);
        }
        const o = (y * w + x) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    }
    if (spec.stars) {
      const sc = rgbOf(spec.starColor ?? 0xedebe7);
      for (let i = 0; i < spec.stars * (w / 192); i++) {
        const x = Math.floor(r() * w);
        const y = Math.floor(Math.pow(r(), 1.6) * H * spec.horizon);
        if (d0 && Math.hypot(x - sunX, y - d0.y) < d0.r * 2.5) continue;
        const o = (y * w + x) * 4;
        img.data[o] = sc[0];
        img.data[o + 1] = sc[1];
        img.data[o + 2] = sc[2];
      }
    }
    g.putImageData(img, 0, 0);
  }, 11);
}

/** Pick a texture-backed Lambert material (white tint so the texture colour shows). */
const matCache = new Map<THREE.Texture, THREE.MeshLambertMaterial>();
export function texMat(t: THREE.Texture): THREE.MeshLambertMaterial {
  let m = matCache.get(t);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ map: t });
    matCache.set(t, m);
  }
  return m;
}

/**
 * Box with UVs scaled to world size so textures tile at a constant texel density
 * (`tile` world units per texture repeat).
 */
export function texBox(
  w: number, h: number, d: number, mat: THREE.Material,
  x = 0, y = 0, z = 0, tile = 2,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  // face order: +x, -x, +y, -y, +z, -z (4 verts each)
  const spans: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [su, sv] = spans[f];
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * su) / tile, (uv.getY(i) * sv) / tile);
    }
  }
  uv.needsUpdate = true;
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
