/** Small seeded PRNG (mulberry32). Pure: same seed, same sequence. */
export interface Rng {
  next(): number;              // [0, 1)
  int(maxExclusive: number): number;
  range(min: number, max: number): number;
  normal(mean: number, sd: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    next,
    int: (n) => Math.floor(next() * n),
    range: (min, max) => min + next() * (max - min),
    normal: (mean, sd) => {
      const u = Math.max(next(), 1e-9);
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
  };
  return rng;
}

export function randomSeed(): number {
  return (Math.random() * 4294967296) >>> 0;
}
