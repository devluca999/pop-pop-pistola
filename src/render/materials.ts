import * as THREE from 'three';

/** Core palette (sRGB hex). Kept small so everything reads as one limited set. */
export const C = {
  sky: 0xeef0e4,
  skyHaze: 0xe8e4d4,
  dirt: 0xb69a78,
  dirtDark: 0x8f7658,
  dirtLight: 0xcdb592,
  wood: 0x7a5636,
  woodDark: 0x4a3220,
  woodLight: 0xa27a52,
  woodGray: 0x8c8274,
  plaster: 0xe7dcc4,
  plasterShade: 0xc9b99a,
  roof: 0x5a3b26,
  black: 0x141010,
  ink: 0x221a16,
  cream: 0xf2e6c9,
  white: 0xfaf6ea,
  skin: 0xe0b48a,
  skinShade: 0xc08f63,
  hat: 0xc2a580,
  hatBand: 0x5a3b26,
  stache: 0x5c4634,
  stacheGray: 0x77655a,
  red: 0xb3261e,
  redDark: 0x7a1712,
  blue: 0x2f4c9c,
  blueDark: 0x1f3270,
  shirt: 0xd8ccb2,
  pants: 0x6b5442,
  pantsDark: 0x4a3a2e,
  boot: 0x8a7462,
  metal: 0x9aa0a4,
  metalDark: 0x50565a,
  gold: 0xd9a531,
  goldDark: 0x8a6418,
  flame: 0xff7a1a,
  flameCore: 0xfff0b0,
  habit: 0x2a2420,
  habitLight: 0x3c342e,
  book: 0x4a2e1c,
  paper: 0xefe2c0,
  green: 0x5f7d3a,
  greenDark: 0x3e5a2a,
  water: 0x8fa6a8,
  smoke: 0xd8d2c4,
  mesa: 0xd8bf9c,
  crow: 0x1c1a20,
} as const;

const lamCache = new Map<number, THREE.MeshLambertMaterial>();
const basicCache = new Map<number, THREE.MeshBasicMaterial>();

/** Shared flat-shaded Lambert material. */
export function lam(hex: number): THREE.MeshLambertMaterial {
  let m = lamCache.get(hex);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
    lamCache.set(hex, m);
  }
  return m;
}

/** Shared unlit material (flames, glows). */
export function basic(hex: number): THREE.MeshBasicMaterial {
  let m = basicCache.get(hex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: hex });
    basicCache.set(hex, m);
  }
  return m;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

/** Unit box scaled; position is the box centre. */
export function box(
  w: number, h: number, d: number, mat: THREE.Material,
  x = 0, y = 0, z = 0, shadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

export function cyl(
  rTop: number, rBot: number, h: number, seg: number, mat: THREE.Material,
  x = 0, y = 0, z = 0, shadow = true,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = shadow;
  return m;
}

export function ico(r: number, mat: THREE.Material, detail = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, detail), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Small canvas texture with chunky pixel text, for shop signs. */
export function signTexture(text: string, bg: string, fg: string, w = 64, h = 16): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.font = `bold ${Math.floor(h * 0.7)}px monospace`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 1);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Flat star shape (for spurs). */
export function starGeo(points: number, rOut: number, rIn: number, depth: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = (i / (points * 2)) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}
