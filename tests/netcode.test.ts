import { describe, it, expect } from 'vitest';
import { generatePlan, resolveExchange, newMatch, cpuExchangeLog, makeRng, planEnd } from '../src/rules';

/**
 * Online play: each client resolves with now = min(local time, how far the rival's log is known).
 * The outcome must never depend on *when* the rival's packets arrive, only on the logs.
 */
describe('netcode determinism', () => {
  it('any partial "now" that is done agrees with the final result', () => {
    for (let seed = 1; seed < 120; seed++) {
      const plan = generatePlan(seed);
      const s = newMatch('hector', 'dusty');
      const logs: [ReturnType<typeof cpuExchangeLog>, ReturnType<typeof cpuExchangeLog>] = [
        cpuExchangeLog(plan, s, 0, 'normal', makeRng(seed * 3)),
        cpuExchangeLog(plan, s, 1, 'hard', makeRng(seed * 5)),
      ];
      const final = resolveExchange(plan, s, logs, planEnd(plan));
      expect(final.done).toBe(true);
      for (let now = 0; now <= planEnd(plan); now += 37) {
        const r = resolveExchange(plan, s, logs, now);
        if (r.done) {
          // t is when the result became knowable, which can be earlier; everything else must match
          expect({ ...r.outcome, t: 0 }).toEqual({ ...final.outcome, t: 0 });
          break;
        }
      }
    }
  });
  it('both clients compute the same result from swapped arrival order', () => {
    const plan = generatePlan(77);
    const s = newMatch('mercy', 'hector');
    const a = cpuExchangeLog(plan, s, 0, 'hard', makeRng(1));
    const b = cpuExchangeLog(plan, s, 1, 'hard', makeRng(2));
    const r1 = resolveExchange(plan, s, [a, b], planEnd(plan));
    const r2 = resolveExchange(plan, s, [[...a].reverse(), [...b].reverse()], planEnd(plan));
    expect(r2.outcome).toEqual(r1.outcome);
  });
});
