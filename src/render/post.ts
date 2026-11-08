/** Lowest allowed dither strength. */
export const DITHER_MIN = 0.35;

import * as THREE from 'three';
import type { FilterMode, PostSettings } from '../types';

/** Limited palette for the 'color' filter (sRGB). */
const PALETTE = [
  0x0b0806, 0x221a16, 0x3a2a1e, 0x5a3b26, 0x7a5636, 0x9c7650, 0xb69a78, 0xcdb592, 0xe6d3a8, 0xf2e6c9, 0xfffbf0,
  0x3a3a3c, 0x6c6862, 0x9e988e, 0xc8c2b6,
  0x4a0f0c, 0x7a1712, 0xb3261e, 0xe0503a,
  0x16204a, 0x1f3270, 0x2f4c9c, 0x6f8fd0,
  0x8a6418, 0xd9a531, 0xffe28a, 0xff7a1a,
  0x3e5a2a, 0x5f7d3a,
  0xe0b48a, 0xc08f63, 0xa8b8b8, 0xdfe6e0,
];

const FILTER_ID: Record<FilterMode, number> = { color: 0, noir: 1, onebit: 2, sepia: 3 };

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const frag = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform vec3 palette[${PALETTE.length}];
uniform int filterMode;
uniform float dither;
uniform float flash;
uniform float washL;
uniform float washR;
uniform float vignette;
uniform float time;
uniform vec2 res;
varying vec2 vUv;

float bayer4(vec2 p) {
  int x = int(mod(p.x, 4.0));
  int y = int(mod(p.y, 4.0));
  int i = x + y * 4;
  // 4x4 Bayer matrix / 16
  if (i == 0) return 0.0;   if (i == 1) return 8.0;   if (i == 2) return 2.0;   if (i == 3) return 10.0;
  if (i == 4) return 12.0;  if (i == 5) return 4.0;   if (i == 6) return 14.0;  if (i == 7) return 6.0;
  if (i == 8) return 3.0;   if (i == 9) return 11.0;  if (i == 10) return 1.0;  if (i == 11) return 9.0;
  if (i == 12) return 15.0; if (i == 13) return 7.0;  if (i == 14) return 13.0; return 5.0;
}

vec3 toSRGB(vec3 c) { return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)); }

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 nearest(vec3 c) {
  vec3 best = palette[0];
  float bd = 1e9;
  for (int i = 0; i < ${PALETTE.length}; i++) {
    vec3 d = c - palette[i];
    float dist = dot(d * d, vec3(0.3, 0.55, 0.15));
    if (dist < bd) { bd = dist; best = palette[i]; }
  }
  return best;
}

float quant(float v, float levels, float b) {
  return floor(v * (levels - 1.0) + b) / (levels - 1.0);
}

void main() {
  vec2 px = floor(vUv * res);
  float b = (bayer4(px) + 0.5) / 16.0; // 0..1
  vec3 c = toSRGB(texture2D(tScene, vUv).rgb);

  // vignette
  vec2 q = vUv - 0.5;
  c *= 1.0 - vignette * dot(q, q) * 1.6;

  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float bd = mix(0.5, b, dither);  // dither offset, 0.5 = no dither
  vec3 o;
  if (filterMode == 0) {
    o = nearest(c + (bd - 0.5) * 0.11 * dither);
  } else if (filterMode == 1) {
    vec3 hsv = rgb2hsv(c);
    bool red = hsv.y > 0.5 && hsv.z > 0.22 && (hsv.x < 0.035 || hsv.x > 0.94);
    bool orange = hsv.y > 0.68 && hsv.z > 0.55 && hsv.x < 0.085;
    if (red || orange) {
      float v = quant(clamp(hsv.z * 1.1, 0.0, 1.0), 3.0, bd);
      o = mix(vec3(0.30, 0.03, 0.03), vec3(0.88, 0.12, 0.08), v);
    } else {
      float g = clamp((l - 0.5) * 1.35 + 0.5, 0.0, 1.0);
      o = vec3(quant(g, 5.0, bd));
      o = mix(vec3(0.04), vec3(0.96, 0.95, 0.92), o.r);
    }
  } else if (filterMode == 2) {
    float g = clamp((l - 0.5) * 1.3 + 0.5, 0.0, 1.0);
    o = g > mix(0.5, b, max(dither, 0.05)) ? vec3(0.95, 0.9, 0.79) : vec3(0.05, 0.035, 0.03);
  } else {
    float g = quant(clamp(l * 1.05, 0.0, 1.0), 6.0, bd);
    o = mix(vec3(0.16, 0.11, 0.08), vec3(0.95, 0.9, 0.79), g);
  }

  // half-screen blind wash with a dithered soft edge, then full flash
  float side = vUv.x < 0.5 ? washL : washR;
  float edge = smoothstep(0.0, 0.08, abs(vUv.x - 0.5));
  float wash = side * mix(0.6, 1.0, edge);
  if (wash > b * 0.999) o = mix(o, vec3(1.0, 0.98, 0.94), min(1.0, wash * 1.3));
  if (flash > b * 0.999) o = vec3(1.0, 0.98, 0.94);
  gl_FragColor = vec4(o, 1.0);
}
`;

export class PostPass {
  readonly target: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: THREE.ShaderMaterial;
  settings: PostSettings = { filter: 'color', dither: 1, flash: 0, washLeft: 0, washRight: 0, vignette: 0.35 };

  constructor(w: number, h: number) {
    this.target = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    const pal = PALETTE.map((hex) => {
      const c = new THREE.Color();
      c.setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255, THREE.LinearSRGBColorSpace);
      return new THREE.Vector3(c.r, c.g, c.b);
    });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        tScene: { value: this.target.texture },
        palette: { value: pal },
        filterMode: { value: 0 },
        dither: { value: 1 },
        flash: { value: 0 },
        washL: { value: 0 },
        washR: { value: 0 },
        vignette: { value: 0.35 },
        time: { value: 0 },
        res: { value: new THREE.Vector2(w, h) },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  set(p: Partial<PostSettings>): void {
    Object.assign(this.settings, p);
  }

  render(renderer: THREE.WebGLRenderer, time: number, extraFlash: number): void {
    const u = this.mat.uniforms;
    const s = this.settings;
    u.filterMode.value = FILTER_ID[s.filter];
    // The dithered look is non-negotiable: strength can be lowered, never switched off.
    u.dither.value = Math.min(1, Math.max(DITHER_MIN, s.dither));
    u.flash.value = Math.min(1, s.flash + extraFlash);
    u.washL.value = s.washLeft;
    u.washR.value = s.washRight;
    u.vignette.value = s.vignette;
    u.time.value = time;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }

  dispose(): void {
    this.target.dispose();
    this.mat.dispose();
  }
}
