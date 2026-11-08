/** Small seeded PRNG (mulberry32). Returns floats in [0, 1). */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = (): number => (Math.random() * 4294967296) >>> 0;

export const range = (rng: Rng, lo: number, hi: number): number => lo + (hi - lo) * rng();
export const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length) % arr.length]!;
export const intRange = (rng: Rng, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

/** Math.random-backed helpers for sound design where determinism doesn't matter. */
export const rnd = (lo: number, hi: number): number => lo + (hi - lo) * Math.random();
