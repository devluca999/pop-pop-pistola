import type { FakeKind, MapId } from '../../types';
import type { SkySpec } from '../textures';
import type { World } from '../world';

/** One piece of set dressing. Built by the reusable builders in props.ts. */
export type Prop = (w: World) => void;

type V3 = [number, number, number];

export interface LightSpec {
  hemi: { sky: number; ground: number; intensity: number };
  /** Main shadow-casting light (sun or moon). */
  key: { color: number; intensity: number; pos: V3; target: V3; shadow: { l: number; r: number; t: number; b: number; far: number } };
  /** Extra unshadowed directional fills. */
  fills: { color: number; intensity: number; pos: V3; target: V3 }[];
  fog: { color: number; near: number; far: number };
  /** Sky backdrop, or a flat background colour (interiors). */
  sky: SkySpec | number;
  /** Rim-light colour and strength for silhouettes. */
  rim: { color: number; strength: number };
  /** Base intensity for hanging lanterns. */
  lantern: number;
}

export interface CameraSpec {
  /** World z of the bell (at x = 0): the rival's head is lined up with it. */
  bellZ: number;
  /** Slow orbit used on the title screen. */
  title: { cx: number; cz: number; r: number; y: number; look: V3; fov: number };
}

export interface MapDef {
  id: MapId;
  name: string;
  /** Fake signals that can happen on this map. */
  fakes: FakeKind[];
  /** Colour-mode palette for the dither pass (up to 24, sRGB). */
  palette: number[];
  light: LightSpec;
  camera: CameraSpec;
  props: Prop[];
}

/** Colours every palette keeps so the duelists read the same on every map. */
export const CHAR_COLORS = [0x090808, 0xedebe7, 0xa8392a, 0x6e2219, 0xd9a33a, 0x2f4a86, 0xf9d8b0, 0xd49066];

/** Bell height that keeps the same angle above the rival's head as the noon church bell. */
export function bellY(z: number): number {
  return 1.4 + 0.257 * (5.5 - z);
}
