// Screen layout for the low-res render: internal size, upscale factor and where the image sits.
// Pure maths (no DOM) so it can be unit tested.

/** Internal render height in low-res pixels. Width follows the screen aspect. */
export const RES_H = 216;
/** Narrowest and widest image aspect. Outside this range the rest is dithered bars. */
export const ASPECT_MIN = 4 / 3;
export const ASPECT_MAX = 21 / 9;
export const RES_W_MIN = Math.ceil(RES_H * ASPECT_MIN);  // 288
export const RES_W_MAX = Math.round(RES_H * ASPECT_MAX); // 504
/** Use a whole-number upscale when it keeps at least this much of the fitted size. */
const INT_KEEP = 0.9;

export interface Insets { top: number; right: number; bottom: number; left: number }

/** Everything the renderer and the HUD need to know about the current screen. */
export interface StageView {
  /** Canvas size in CSS pixels (covers the whole container, bars included). */
  cssW: number;
  cssH: number;
  /** Canvas backing size in device pixels. */
  devW: number;
  devH: number;
  /** Device pixels per CSS pixel. */
  dpr: number;
  /** Internal low-res render size. resH is always RES_H. */
  resW: number;
  resH: number;
  /** Device pixels per low-res pixel. */
  scale: number;
  /** True when scale is a whole number (perfectly even pixels). */
  integer: boolean;
  /** The visible game image inside the canvas, in device pixels (origin top-left). */
  dev: { x: number; y: number; w: number; h: number };
  /** The same rect in CSS pixels, relative to the canvas/container top-left. */
  image: { x: number; y: number; w: number; h: number };
  /** HUD unit: min(imageW/320, imageH/180) in CSS pixels. */
  u: number;
}

/**
 * Fit the low-res image into a canvas of devW x devH device pixels, keeping clear of `pad`
 * (safe-area insets, CSS px). Height is fixed at 216 low-res pixels; width follows the aspect,
 * clamped to 4:3..21:9. A whole-number upscale is used when it costs at most 10% of the size.
 */
export function computeView(cssW: number, cssH: number, devW: number, devH: number, pad: Insets = { top: 0, right: 0, bottom: 0, left: 0 }): StageView {
  cssW = Math.max(1, cssW);
  cssH = Math.max(1, cssH);
  devW = Math.max(1, Math.round(devW));
  devH = Math.max(1, Math.round(devH));
  const dpr = devW / cssW;
  const fx = Math.round(pad.left * dpr);
  const fy = Math.round(pad.top * dpr);
  const fw = Math.max(1, devW - fx - Math.round(pad.right * dpr));
  const fh = Math.max(1, devH - fy - Math.round(pad.bottom * dpr));

  const aspect = Math.min(ASPECT_MAX, Math.max(ASPECT_MIN, fw / fh));
  const w0 = Math.round(RES_H * aspect);
  const fit = Math.min(fw / w0, fh / RES_H);
  const k = Math.floor(fit + 1e-6);
  let resW: number;
  let scale: number;
  let integer: boolean;
  if (k >= 1 && k >= fit * INT_KEEP - 1e-6) {
    scale = k;
    integer = true;
    // with a whole-number scale, widen the image into any spare width (still within 4:3..21:9)
    resW = Math.min(RES_W_MAX, Math.max(RES_W_MIN, Math.floor(fw / k)));
  } else {
    scale = fit;
    integer = false;
    resW = w0;
  }
  const w = resW * scale;
  const h = RES_H * scale;
  const x = fx + Math.round((fw - w) / 2);
  const y = fy + Math.round((fh - h) / 2);
  const image = { x: x / dpr, y: y / dpr, w: w / dpr, h: h / dpr };
  return {
    cssW, cssH, devW, devH, dpr, resW, resH: RES_H, scale, integer,
    dev: { x, y, w, h },
    image,
    u: Math.min(image.w / 320, image.h / 180),
  };
}
