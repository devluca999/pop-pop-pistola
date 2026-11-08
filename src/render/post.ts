/** Lowest allowed dither strength. */
export const DITHER_MIN = 0.35;

import * as THREE from 'three';
import type { FilterMode, PostSettings } from '../types';

const FILTER_ID: Record<FilterMode, number> = { color: 0, noir: 1, onebit: 2, sepia: 3 };

const vert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// The scene is rendered smooth (MSAA, linear upscale). This pass runs at the canvas's
// physical resolution and lays a crisp ordered-dither pattern on top: one Bayer cell
// equals one internal scene pixel (~2x2 screen pixels on a 1080p display).
const frag = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform int filterMode;
uniform float dither;
uniform float flash;
uniform float washL;
uniform float washR;
uniform float vignette;
uniform float cell;
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

// ordered-dither quantization: bd is the per-cell threshold in 0..1
float quant(float v, float levels, float bd) {
  return clamp(floor(v * (levels - 1.0) + bd) / (levels - 1.0), 0.0, 1.0);
}
vec3 quant3(vec3 v, float levels, float bd) {
  return vec3(quant(v.r, levels, bd), quant(v.g, levels, bd), quant(v.b, levels, bd));
}

void main() {
  vec2 px = floor(gl_FragCoord.xy / cell);
  float b = (bayer4(px) + 0.5) / 16.0;
  float bd = mix(0.5, b, dither);
  vec3 c = toSRGB(texture2D(tScene, vUv).rgb);

  vec2 q = vUv - 0.5;
  c *= 1.0 - vignette * dot(q, q) * 1.5;

  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 o;
  if (filterMode == 0) {
    // gentle warm grade, then 7 levels per channel so the dither reads clearly
    c = mix(vec3(l), c, 1.06);
    c = c * vec3(1.02, 1.0, 0.97);
    o = quant3(c, 7.0, bd);
  } else if (filterMode == 1) {
    vec3 hsv = rgb2hsv(c);
    bool red = hsv.y > 0.5 && hsv.z > 0.22 && (hsv.x < 0.035 || hsv.x > 0.94);
    bool orange = hsv.y > 0.68 && hsv.z > 0.55 && hsv.x < 0.085;
    if (red || orange) {
      float v = quant(clamp(hsv.z * 1.1, 0.0, 1.0), 6.0, bd);
      o = mix(vec3(0.22, 0.02, 0.02), vec3(0.9, 0.1, 0.07), v);
    } else {
      float g = clamp((l - 0.5) * 1.35 + 0.5, 0.0, 1.0);
      g = quant(g, 9.0, bd);
      o = mix(vec3(0.03), vec3(0.97, 0.96, 0.93), g);
    }
  } else if (filterMode == 2) {
    // 1-bit stays coarse: 2x larger cells
    vec2 px2 = floor(gl_FragCoord.xy / (cell * 2.0));
    float b2 = (bayer4(px2) + 0.5) / 16.0;
    float g = clamp((l - 0.5) * 1.3 + 0.5, 0.0, 1.0);
    o = g > mix(0.5, b2, max(dither, 0.05)) ? vec3(0.95, 0.9, 0.79) : vec3(0.05, 0.035, 0.03);
  } else {
    float g = quant(clamp(l * 1.05, 0.0, 1.0), 7.0, bd);
    o = mix(vec3(0.16, 0.11, 0.08), vec3(0.96, 0.91, 0.8), g);
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
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      samples: 4,
      type: THREE.HalfFloatType,
    });
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        tScene: { value: this.target.texture },
        filterMode: { value: 0 },
        dither: { value: 1 },
        flash: { value: 0 },
        washL: { value: 0 },
        washR: { value: 0 },
        vignette: { value: 0.35 },
        cell: { value: 2 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Resize the scene target; `cell` = output pixels per internal pixel (dither cell size). */
  resize(w: number, h: number, cell: number): void {
    this.target.setSize(w, h);
    this.mat.uniforms.cell.value = Math.max(1, cell);
  }

  set(p: Partial<PostSettings>): void {
    Object.assign(this.settings, p);
  }

  render(renderer: THREE.WebGLRenderer, _time: number, extraFlash: number): void {
    const u = this.mat.uniforms;
    const s = this.settings;
    u.filterMode.value = FILTER_ID[s.filter];
    // The dithered look is non-negotiable: strength can be lowered, never switched off.
    u.dither.value = Math.min(1, Math.max(DITHER_MIN, s.dither));
    u.flash.value = Math.min(1, s.flash + extraFlash);
    u.washL.value = s.washLeft;
    u.washR.value = s.washRight;
    u.vignette.value = s.vignette;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.cam);
  }

  dispose(): void {
    this.target.dispose();
    this.mat.dispose();
  }
}
