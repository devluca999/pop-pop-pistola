/** Lowest allowed dither strength. */
export const DITHER_MIN = 0.35;

import * as THREE from 'three';
import type { FilterMode, PostSettings } from '../types';

/**
 * Master palette (sRGB): 16 colours k-means-sampled from refs/map.png, plus accents the clustering
 * missed: Hector's coat reds and the brass of bell/star/lanterns.
 */
export const PALETTE_16 = [
  0x090808, 0x231b19, 0x40302a, 0x634337, 0x5c5b67, 0x8f5843, 0xad7658, 0x69819d,
  0xae9386, 0xd49066, 0x97a6b6, 0xeda978, 0xf8c08f, 0xc4c9cf, 0xf9d8b0, 0xedebe7,
  0xa8392a, 0x6e2219, 0xd9a33a,
  0x2f4a86, // dusty-blue coat accent (Lil' Dusty reads blue in map.png)
];
const NOIR = [0x0e0c0c, 0x3a3836, 0x6e6b67, 0xa3a09a, 0xd6d3cc, 0xf6f3ea, 0x5c0c0a, 0xa3140f, 0xe02a1c];
const SEPIA = [0x1e140e, 0x45301f, 0x6e5034, 0x9a774f, 0xc4a374, 0xe6cfa2, 0xf6ead0];
const ONEBIT = [0x120d0b, 0xf2e6c9];

const FILTER_ID: Record<FilterMode, number> = { color: 0, noir: 1, onebit: 2, sepia: 3 };
const MAXP = 24;

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const frag = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec3 pal[${MAXP}];
uniform int palN;
uniform int filterMode;
uniform float dither;
uniform float spread;
uniform float flash;
uniform float washL;
uniform float washR;
uniform float vignette;
uniform vec3 brite;
uniform vec2 res;
varying vec2 vUv;

float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  if (i == 0) return 0.0;   if (i == 1) return 8.0;   if (i == 2) return 2.0;   if (i == 3) return 10.0;
  if (i == 4) return 12.0;  if (i == 5) return 4.0;   if (i == 6) return 14.0;  if (i == 7) return 6.0;
  if (i == 8) return 3.0;   if (i == 9) return 11.0;  if (i == 10) return 1.0;  if (i == 11) return 9.0;
  if (i == 12) return 15.0; if (i == 13) return 7.0;  if (i == 14) return 13.0; return 5.0;
}

vec3 toSRGB(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 nearest(vec3 c, int from, int to) {
  vec3 best = pal[0];
  float bd = 1e9;
  for (int i = 0; i < ${MAXP}; i++) {
    if (i < from || i >= to) continue;
    vec3 d = c - pal[i];
    float dist = dot(d * d, vec3(0.32, 0.5, 0.18));
    if (dist < bd) { bd = dist; best = pal[i]; }
  }
  return best;
}

void main() {
  vec2 px = floor(vUv * res);
  float b = (bayer4(px) + 0.5) / 16.0 - 0.5;   // -0.5..0.5
  float off = b * spread * dither;
  vec3 c = toSRGB(texture2D(tScene, vUv).rgb);

  vec2 q = vUv - 0.5;
  c *= 1.0 - vignette * dot(q, q) * 1.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));

  vec3 o;
  if (filterMode == 1) {
    // noir: grey ramp (0..5) + red accents (6..8)
    vec3 hsv = rgb2hsv(c);
    bool red = hsv.y > 0.5 && hsv.z > 0.22 && (hsv.x < 0.035 || hsv.x > 0.94);
    bool orange = hsv.y > 0.72 && hsv.z > 0.75 && hsv.x < 0.09;
    if (red || orange) o = nearest(vec3(hsv.z * 0.85, hsv.z * 0.1, hsv.z * 0.08) + off, 6, 9);
    else {
      float g = clamp((l - 0.5) * 1.3 + 0.5, 0.0, 1.0) + off;
      o = nearest(vec3(g), 0, 6);
    }
  } else if (filterMode == 2 || filterMode == 3) {
    float g = clamp((l - 0.5) * 1.25 + 0.5, 0.0, 1.0);
    // map luminance onto the ramp's own luminance range
    o = nearest(mix(pal[0], pal[palN - 1], g + off), 0, palN);
  } else {
    o = nearest(c + off, 0, palN);
  }

  float bb = b + 0.5;
  float side = vUv.x < 0.5 ? washL : washR;
  float edge = smoothstep(0.0, 0.08, abs(vUv.x - 0.5));
  float wash = side * mix(0.6, 1.0, edge);
  if (wash > bb * 0.999) o = mix(o, brite, min(1.0, wash * 1.3));
  if (flash > bb * 0.999) o = vec3(1.0, 0.98, 0.94);
  gl_FragColor = vec4(o, 1.0);
}
`;

/** Upscale pass: nearest-neighbour copy of the dithered image, dithered bars around it. */
const blitFrag = /* glsl */ `
precision highp float;
uniform sampler2D tLow;
uniform vec2 res;       // low-res size
uniform vec4 rect;      // image rect in device px: x, y (from bottom-left), w, h
uniform float scale;    // device px per low-res px
uniform vec3 barDark;
uniform vec3 barLite;
uniform float barAmt;

float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  if (i == 0) return 0.0;   if (i == 1) return 8.0;   if (i == 2) return 2.0;   if (i == 3) return 10.0;
  if (i == 4) return 12.0;  if (i == 5) return 4.0;   if (i == 6) return 14.0;  if (i == 7) return 6.0;
  if (i == 8) return 3.0;   if (i == 9) return 11.0;  if (i == 10) return 1.0;  if (i == 11) return 9.0;
  if (i == 12) return 15.0; if (i == 13) return 7.0;  if (i == 14) return 13.0; return 5.0;
}

void main() {
  // low-res pixel under this device pixel (the grid carries on into the bars)
  vec2 lp = floor((gl_FragCoord.xy - rect.xy) / scale);
  if (lp.x >= 0.0 && lp.y >= 0.0 && lp.x < res.x && lp.y < res.y) {
    gl_FragColor = vec4(texture2D(tLow, (lp + 0.5) / res).rgb, 1.0);
    return;
  }
  // bars: sparse ordered-dither stipple, a touch denser right next to the image
  vec2 d = max(max(-lp, lp - (res - 1.0)), 0.0);
  float near = 1.0 - clamp(max(d.x, d.y) / 6.0, 0.0, 1.0);
  float t = barAmt * (0.55 + 0.45 * near);
  float b = (bayer4(lp) + 0.5) / 16.0;
  gl_FragColor = vec4(b < t ? barLite : barDark, 1.0);
}
`;

function toVecs(list: readonly number[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < MAXP; i++) out.push(hexVec(list[Math.min(i, list.length - 1)]));
  return out;
}

/** The two darkest colours of a palette (by luma). */
const luma = (c: THREE.Vector3) => c.x * 0.299 + c.y * 0.587 + c.z * 0.114;
function darkest(v: THREE.Vector3[], n: number): [THREE.Vector3, THREE.Vector3] {
  const sorted = v.slice(0, n).sort((a, b) => luma(a) - luma(b));
  return [sorted[0], sorted[1] ?? sorted[0]];
}
function brightest(v: THREE.Vector3[], n: number): THREE.Vector3 {
  return v.slice(0, n).reduce((a, b) => (luma(b) > luma(a) ? b : a));
}

const PALS: Record<FilterMode, { v: THREE.Vector3[]; n: number; spread: number }> = {
  color: { v: toVecs(PALETTE_16), n: PALETTE_16.length, spread: 0.24 },
  noir: { v: toVecs(NOIR), n: NOIR.length, spread: 0.22 },
  onebit: { v: toVecs(ONEBIT), n: ONEBIT.length, spread: 1.0 },
  sepia: { v: toVecs(SEPIA), n: SEPIA.length, spread: 0.2 },
};

/** Palette as 0..1 RGB vectors. */
function hexVec(h: number): THREE.Vector3 {
  return new THREE.Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
}

export class PostPass {
  /** Scene render target (low-res). */
  readonly target: THREE.WebGLRenderTarget;
  /** Dithered low-res image, before the upscale. */
  private low: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private blitScene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  private blit: THREE.ShaderMaterial;
  private colorPal = PALS.color;
  /** Where the image lands on the canvas, device px, origin top-left. */
  private rect = { x: 0, y: 0, w: 1, h: 1, scale: 1, devW: 1, devH: 1 };
  settings: PostSettings = { filter: 'color', dither: 1, flash: 0, washLeft: 0, washRight: 0, vignette: 0.3 };

  constructor(w: number, h: number) {
    this.target = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.low = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        tScene: { value: this.target.texture },
        pal: { value: PALS.color.v },
        palN: { value: PALS.color.n },
        filterMode: { value: 0 },
        dither: { value: 1 },
        spread: { value: 0.2 },
        flash: { value: 0 },
        washL: { value: 0 },
        washR: { value: 0 },
        vignette: { value: 0.3 },
        brite: { value: new THREE.Vector3(1, 1, 1) },
        res: { value: new THREE.Vector2(w, h) },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
    this.blit = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: blitFrag,
      uniforms: {
        tLow: { value: this.low.texture },
        res: { value: new THREE.Vector2(w, h) },
        rect: { value: new THREE.Vector4(0, 0, w, h) },
        scale: { value: 1 },
        barDark: { value: new THREE.Vector3() },
        barLite: { value: new THREE.Vector3() },
        barAmt: { value: 0.12 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const bq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blit);
    bq.frustumCulled = false;
    this.blitScene.add(bq);
  }

  /** Change the low-res size (scene target and dither pass). */
  resize(w: number, h: number): void {
    if (this.target.width === w && this.target.height === h) return;
    this.target.setSize(w, h);
    this.low.setSize(w, h);
    (this.mat.uniforms.res.value as THREE.Vector2).set(w, h);
    (this.blit.uniforms.res.value as THREE.Vector2).set(w, h);
  }

  /** Where the upscaled image goes on the canvas (device px, origin top-left). */
  place(x: number, y: number, w: number, h: number, scale: number, devW: number, devH: number): void {
    this.rect = { x, y, w, h, scale, devW, devH };
  }

  /** Colour-mode palette (each map has its own). Up to 24 colours, sRGB hex. */
  setPalette(colors: readonly number[]): void {
    const list = colors.slice(0, MAXP);
    this.colorPal = { v: toVecs(list), n: list.length, spread: PALS.color.spread };
  }

  set(p: Partial<PostSettings>): void {
    Object.assign(this.settings, p);
  }

  render(renderer: THREE.WebGLRenderer, _time: number, extraFlash: number): void {
    const u = this.mat.uniforms;
    const s = this.settings;
    const p = s.filter === 'color' ? this.colorPal : PALS[s.filter] ?? this.colorPal;
    u.filterMode.value = FILTER_ID[s.filter];
    u.pal.value = p.v;
    u.palN.value = p.n;
    u.spread.value = p.spread;
    // The dithered look is non-negotiable: strength can be lowered, never switched off.
    u.dither.value = Math.min(1, Math.max(DITHER_MIN, s.dither));
    u.flash.value = Math.min(1, s.flash + extraFlash);
    u.washL.value = s.washLeft;
    u.washR.value = s.washRight;
    u.vignette.value = s.vignette;
    (u.brite.value as THREE.Vector3).copy(brightest(p.v, p.n));
    renderer.setRenderTarget(this.low);
    renderer.render(this.scene, this.cam);

    // upscale to the canvas; bars use the two darkest steps of the active palette
    const b = this.blit.uniforms;
    const r = this.rect;
    (b.rect.value as THREE.Vector4).set(r.x, r.devH - r.y - r.h, r.w, r.h);
    b.scale.value = r.scale;
    const dark = darkest(p.v, p.n);
    (b.barDark.value as THREE.Vector3).copy(dark[0]);
    (b.barLite.value as THREE.Vector3).copy(dark[1]);
    b.barAmt.value = s.filter === 'onebit' ? 0.07 : 0.16;
    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, r.devW, r.devH);
    renderer.render(this.blitScene, this.cam);
  }

  dispose(): void {
    this.target.dispose();
    this.low.dispose();
    this.mat.dispose();
    this.blit.dispose();
  }
}
