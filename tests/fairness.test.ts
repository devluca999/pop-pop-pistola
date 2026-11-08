import { describe, it, expect } from 'vitest';
import {
  CONFIG, generatePlan, resolveExchange, newMatch, cpuExchangeLog, makeRng,
  type CpuProfile, type DrawType, type PromptType,
} from '../src/rules';
import type { PlayerIndex } from '../src/types';

/**
 * Fairness: the rules must never favour a side. Two identical bots play 1000 exchanges
 * per prompt type and per draw type from the same seeds; each side must win 50% ±3%.
 * Each seed is also replayed with the bots' dice swapped between seats, so any edge left
 * over can only come from the seat (P1 vs P2), not from luck.
 */

const BOT: CpuProfile = { ...CONFIG.cpu.normal };
const RUNS = 1000;

function play(seed: number, opts: { forcePrompt?: PromptType; forceDraw?: DrawType }, a: CpuProfile, b: CpuProfile, swap = false) {
  const plan = generatePlan(seed, { ...opts, seen: ['tap', 'hold', 'mash', 'time', 'release', 'order', 'steady', 'draw:ring', 'draw:wheel', 'draw:speed'] });
  const s = newMatch('hector', 'hector');
  // independent noise for each side, from the shared seed
  const logs: [ReturnType<typeof cpuExchangeLog>, ReturnType<typeof cpuExchangeLog>] = [
    cpuExchangeLog(plan, s, 0, a, makeRng(seed * 2 + (swap ? 2 : 1))),
    cpuExchangeLog(plan, s, 1, b, makeRng(seed * 2 + (swap ? 1 : 2))),
  ];
  return resolveExchange(plan, s, logs, 1e9);
}

/** Share of decided contests won by P1. */
function share(wins: [number, number]) {
  return wins[0] / (wins[0] + wins[1]);
}

describe('fairness: identical bots, same seeds', () => {
  for (const type of ['tap', 'hold', 'mash', 'time', 'release', 'order', 'steady'] as PromptType[]) {
    it(`prompt ${type}: P1 and P2 come out even`, () => {
      // who comes out of the nerve prompts cleaner (fewer flinches)
      const wins: [number, number] = [0, 0];
      for (let seed = 1; seed <= RUNS; seed++) {
        for (const swap of [false, true]) {
          const f = play(seed, { forcePrompt: type }, BOT, BOT, swap).flinches;
          if (f[0] < f[1]) wins[0]++;
          else if (f[1] < f[0]) wins[1]++;
        }
      }
      expect(wins[0] + wins[1]).toBeGreaterThan(RUNS * 0.2);
      expect(Math.abs(share(wins) - 0.5)).toBeLessThanOrEqual(0.03);
    });
  }
  for (const type of ['ring', 'wheel', 'speed'] as DrawType[]) {
    it(`draw ${type}: P1 and P2 win 50% ±3%`, () => {
      const wins: [number, number] = [0, 0];
      for (let seed = 1; seed <= RUNS; seed++) {
        for (const swap of [false, true]) {
          const o = play(seed, { forceDraw: type }, BOT, BOT, swap).outcome!;
          if (o.kind === 'shot') wins[o.actor as PlayerIndex]++;
          if (o.kind === 'early') wins[o.actor === 0 ? 1 : 0]++;
        }
      }
      expect(Math.abs(share(wins) - 0.5)).toBeLessThanOrEqual(0.03);
    });
  }
});

describe('fairness: CPU Normal vs a 290ms human', () => {
  it('wins about half the RING draws it takes part in', () => {
    // a steady human: 290ms ±70 reactions, the same aim, never falls for fakes
    const human: CpuProfile = { ...CONFIG.cpu.normal, fakeFallChance: 0, promptMissChance: 0, feintChance: 0, feintFallChance: 0 };
    const cpu: CpuProfile = { ...CONFIG.cpu.normal };
    const wins: [number, number] = [0, 0];
    for (let seed = 1; seed <= 2000; seed++) {
      const o = play(seed, { forceDraw: 'ring' }, cpu, human).outcome!;
      // speed duel only: early draws are a separate skill (nerve), counted in the next test
      if (o.kind === 'shot') wins[o.actor as PlayerIndex]++;
    }
    expect(Math.abs(share(wins) - 0.5)).toBeLessThanOrEqual(0.03);
  });
  it('its fake-outs come from the fake-fall chance, not from timing', () => {
    let early = 0;
    for (let seed = 1; seed <= 2000; seed++) if (play(seed, {}, CONFIG.cpu.normal, { ...CONFIG.cpu.normal, fakeFallChance: 0 }).outcome?.kind === 'early') early++;
    expect(early / 2000).toBeGreaterThan(0.05);
    expect(early / 2000).toBeLessThan(0.3);
  });
});
