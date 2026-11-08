import { describe, it, expect } from 'vitest';
import {
  CONFIG, newMatch, generatePlan, resolveExchange, applyExchange, goldBand, isPerfect, evalPrompt,
  cpuExchangeLog, cpuFeintReaction, cpuWantsHeal, makeRng, planEnd,
  type ExchangePlan, type InputEvent, type MatchState,
} from '../src/rules';
import type { CharacterId } from '../src/types';

const D = CONFIG.draw;

/** A fixed plan so timings are easy to reason about. */
function plan(over: Partial<ExchangePlan> = {}): ExchangePlan {
  return {
    seed: 1,
    prompts: [
      { t: 2350, hold: false, slots: [0, 1] },
      { t: 4050, hold: false, slots: [2, 3] },
      { t: 5750, hold: true, slots: [4, 5] },
    ],
    standoffStart: 7050,
    fakes: [{ t: 8000, kind: 'crow' }],
    bellT: 10000,
    drawSlots: [3, 2],
    ...over,
  };
}
const P = plan();
const B = P.bellT;
const press = (t: number, slot: number): InputEvent => ({ t, kind: 'press', slot });
const release = (t: number, slot: number): InputEvent => ({ t, kind: 'release', slot });

/** Clean nerve phase for both (player 0 always slightly faster), then the given draw events. */
function clean(extra0: InputEvent[] = [], extra1: InputEvent[] = [], opts: { p1First?: boolean } = {}): [InputEvent[], InputEvent[]] {
  const a: InputEvent[] = [];
  const b: InputEvent[] = [];
  for (const pr of P.prompts) {
    const [ta, tb] = opts.p1First ? [pr.t + 300, pr.t + 250] : [pr.t + 250, pr.t + 300];
    a.push(press(ta, pr.slots[0]), release(ta + (pr.hold ? 700 : 80), pr.slots[0]));
    b.push(press(tb, pr.slots[1]), release(tb + (pr.hold ? 700 : 80), pr.slots[1]));
  }
  return [[...a, ...extra0], [...b, ...extra1]];
}
const match = (a: CharacterId, b: CharacterId, mut?: (s: MatchState) => void) => {
  const s = newMatch(a, b);
  mut?.(s);
  return s;
};
const END = 1e9;

describe('gold band / perfect draw window', () => {
  it('shrinks with each flinch and vanishes at 3', () => {
    expect(goldBand(0, false)).toBe(D.goldBandMs);
    expect(goldBand(1, false)).toBe(D.goldBandMs - D.goldShrinkPerFlinchMs);
    expect(goldBand(2, false)).toBe(D.goldBandMs - 2 * D.goldShrinkPerFlinchMs);
    expect(goldBand(3, false)).toBe(0);
    expect(goldBand(5, true)).toBe(0);
  });
  it('is wider in Last Stand', () => {
    expect(goldBand(0, true)).toBe(D.goldBandMs + D.lastStandBonusMs);
  });
  it('perfect only inside the band', () => {
    const band = goldBand(0, false);
    expect(isPerfect(D.goldCenterMs, band)).toBe(true);
    expect(isPerfect(D.goldCenterMs + band / 2, band)).toBe(true);
    expect(isPerfect(D.goldCenterMs + band / 2 + 1, band)).toBe(false);
    expect(isPerfect(D.goldCenterMs, 0)).toBe(false);
  });
});

describe('nerve prompts', () => {
  const pr = P.prompts[0];
  it('ok, slow, wrong key, no press', () => {
    expect(evalPrompt([press(pr.t + 200, 0)], pr.t, 0, false, END).status).toBe('ok');
    expect(evalPrompt([press(pr.t + CONFIG.nerve.slowMs + 10, 0)], pr.t, 0, false, END).status).toBe('slow');
    expect(evalPrompt([press(pr.t + 200, 1)], pr.t, 0, false, END).status).toBe('miss');
    expect(evalPrompt([], pr.t, 0, false, END).status).toBe('miss');
    expect(evalPrompt([], pr.t, 0, false, pr.t + 10).status).toBe('pending');
  });
  it('hold prompts need the key held', () => {
    const t = pr.t + 100;
    expect(evalPrompt([press(t, 0), release(t + 200, 0)], pr.t, 0, true, END).status).toBe('miss');
    expect(evalPrompt([press(t, 0), release(t + 700, 0)], pr.t, 0, true, END).status).toBe('ok');
    expect(evalPrompt([press(t, 0)], pr.t, 0, true, t + 100).holding).toBe(true);
  });
  it('stare-down: the later correct press flinches', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean(), B - 1);
    expect(r.prompts.every((p) => p[0].status === 'ok' && p[1].status === 'beaten')).toBe(true);
    expect(r.flinches).toEqual([0, 3]);
    expect(r.goldBand).toEqual([D.goldBandMs, 0]);
  });
  it("Dusty's cigar: his presses never count as first", () => {
    const logs = clean([{ t: 500, kind: 'heal' }], [], { p1First: false });
    const s = match('dusty', 'hector', (m) => { m.players[0].hearts = 2; });
    const r = resolveExchange(P, s, logs, B - 1);
    expect(r.cigar[0]).toBe(true);
    expect(r.prompts.every((p) => p[0].status === 'beaten' && p[1].status === 'ok')).toBe(true);
  });
});

describe('draw resolution', () => {
  it('faster correct press shoots first (Hector hit = 1)', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean([press(B + 250, 3)], [press(B + 500, 2)]), END);
    expect(r.outcome?.kind).toBe('shot');
    expect(r.outcome?.actor).toBe(0);
    expect(r.outcome?.damage).toEqual([0, 1]);
  });
  it('perfect draw doubles Hector damage', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean([press(B + D.goldCenterMs, 3)], [press(B + 900, 2)]), END);
    expect(r.outcome?.perfect[0]).toBe(true);
    expect(r.outcome?.damage).toEqual([0, 2]);
  });
  it('trade inside the window: both take damage', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean([press(B + 150, 3)], [press(B + 150 + D.tradeWindowMs, 2)]), END);
    expect(r.outcome?.kind).toBe('trade');
    expect(r.outcome?.damage).toEqual([1, 1]);
  });
  it('just outside the trade window is a clean shot', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean([press(B + 300, 3)], [press(B + 301 + D.tradeWindowMs, 2)]), END);
    expect(r.outcome?.kind).toBe('shot');
  });
  it('wrong key jams the gun for 0.5s', () => {
    const r = resolveExchange(P, match('hector', 'hector'),
      clean([press(B + 200, 0), press(B + 400, 3), press(B + 750, 3)], [press(B + 600, 2)]), END);
    // press at 400 is ignored (jammed until 700), so player 0 draws at 750 and loses to 650
    expect(r.draws[0]?.reaction).toBe(750);
    expect(r.draws[0]?.jams).toBe(1);
    expect(r.outcome?.actor).toBe(1);
  });
  it('nobody presses within the window -> reset', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean(), B + D.windowMs);
    expect(r.outcome?.kind).toBe('reset');
    expect(r.outcome?.damage).toEqual([0, 0]);
  });
  it('waits for a possible trade before deciding', () => {
    const logs = clean([press(B + 300, 3)]);
    expect(resolveExchange(P, match('hector', 'hector'), logs, B + 350).done).toBe(false);
    expect(resolveExchange(P, match('hector', 'hector'), logs, B + 300 + D.tradeWindowMs).done).toBe(true);
  });
  it('Dusty draws slower but hits for 2', () => {
    // Dusty presses 100ms earlier but his 150ms delay loses... outside trade? 200 vs 300: effective 350 vs 300 -> trade
    const t = resolveExchange(P, match('dusty', 'hector'), clean([press(B + 200, 3)], [press(B + 300, 2)]), END);
    expect(t.outcome?.kind).toBe('trade');
    const s = resolveExchange(P, match('dusty', 'hector'), clean([press(B + 200, 3)], [press(B + 900, 2)]), END);
    expect(s.outcome?.damage).toEqual([0, 2]);
  });
  it('Dusty wins trades: deals 2, takes 1', () => {
    const r = resolveExchange(P, match('dusty', 'hector'), clean([press(B + 200, 3)], [press(B + 300, 2)]), END);
    expect(r.outcome?.damage).toEqual([1, 2]);
  });
  it('Dusty perfect = 3', () => {
    const r = resolveExchange(P, match('dusty', 'hector'), clean([press(B + D.goldCenterMs, 3)], [press(B + 1200, 2)]), END);
    expect(r.outcome?.damage).toEqual([0, 3]);
  });
});

describe('fakes, early draws and feints', () => {
  it('drawing on a fake costs a heart', () => {
    const r = resolveExchange(P, match('hector', 'dusty'), clean([press(8200, 1)]), END);
    expect(r.outcome?.kind).toBe('early');
    expect(r.outcome?.actor).toBe(0);
    expect(r.outcome?.damage).toEqual([1, 0]);
    expect(r.outcome?.fake?.kind).toBe('crow');
    const s = applyExchange(match('hector', 'dusty'), r).state;
    expect(s.players[0].hearts).toBe(2);
  });
  it('feint bitten: victim gets 2 flinches and is not penalised for the press', () => {
    const r = resolveExchange(P, match('hector', 'hector'),
      clean([{ t: 9000, kind: 'feint' }]), B - 1);
    expect(r.feints[0].status).toBe('whiff');
    const bit = resolveExchange(P, match('hector', 'hector'),
      clean([{ t: 9000, kind: 'feint' }], [press(9200, 0)]), B - 1);
    expect(bit.feints[0].status).toBe('bit');
    expect(bit.outcome).toBeNull();
    expect(bit.flinches[1]).toBe(3 + CONFIG.feint.victimFlinches);
  });
  it('feint whiffed: feinter gets 1 flinch', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean([{ t: 9000, kind: 'feint' }]), B - 1);
    expect(r.flinches[0]).toBe(CONFIG.feint.feinterFlinches);
  });
  it('Dusty cannot feint', () => {
    const r = resolveExchange(P, match('dusty', 'hector'), clean([{ t: 9000, kind: 'feint' }], [press(9200, 0)]), END);
    expect(r.feints.length).toBe(0);
    expect(r.outcome?.kind).toBe('early');
  });
});

describe('heals', () => {
  it('whiskey: +1 heart, drunk = 2 flinches, max 2 per match', () => {
    let s = match('hector', 'hector', (m) => { m.players[0].hearts = 1; });
    const logs = clean([{ t: 500, kind: 'heal' }, press(B + 900, 3)], [press(B + 300, 2)]);
    const r = resolveExchange(P, s, logs, END);
    expect(r.healed[0]).toBe(true);
    expect(r.drunk[0]).toBe(true);
    expect(r.hearts[0]).toBe(2);
    expect(r.flinches[0]).toBe(2);
    s = applyExchange(s, r).state;
    expect(s.players[0].healsLeft).toBe(1);
    expect(s.players[0].hearts).toBe(1);
    s.players[0].healsLeft = 0;
    expect(resolveExchange(P, s, logs, END).healed[0]).toBe(false);
  });
  it('cannot heal at full hearts or outside the ready beat', () => {
    const s = match('hector', 'dusty');
    expect(resolveExchange(P, s, clean([{ t: 500, kind: 'heal' }]), END).healed[0]).toBe(false);
    s.players[0].hearts = 2;
    expect(resolveExchange(P, s, clean([{ t: 2500, kind: 'heal' }]), END).healed[0]).toBe(false);
  });
  it('Mercy has no normal heal', () => {
    const s = match('mercy', 'dusty', (m) => { m.players[0].hearts = 1; });
    expect(resolveExchange(P, s, clean([{ t: 500, kind: 'heal' }]), END).healed[0]).toBe(false);
  });
});

describe('Sister Mercy', () => {
  it('winning the draw blinds: no damage, 2 flinches next, +1 charge', () => {
    let s = match('mercy', 'hector');
    const r = resolveExchange(P, s, clean([press(B + 250, 3)], [press(B + 500, 2)]), END);
    expect(r.outcome?.kind).toBe('blind');
    expect(r.outcome?.damage).toEqual([0, 0]);
    s = applyExchange(s, r).state;
    expect(s.players[0].charge).toBe(1);
    expect(s.players[1].carryFlinches).toBe(2);
    const next = resolveExchange(P, s, clean(), B - 1);
    expect(next.flinches[1]).toBe(2 + 3);
  });
  it('blind lands first in a trade', () => {
    const r = resolveExchange(P, match('mercy', 'dusty'), clean([press(B + 320, 3)], [press(B + 200, 2)]), END);
    expect(r.outcome?.kind).toBe('blind');
    expect(r.outcome?.damage).toEqual([0, 0]);
  });
  it('losing the draw resets her charge', () => {
    let s = match('mercy', 'hector', (m) => { m.players[0].charge = 1; });
    const r = resolveExchange(P, s, clean([press(B + 600, 3)], [press(B + 250, 2)]), END);
    s = applyExchange(s, r).state;
    expect(s.players[0].charge).toBe(0);
    expect(s.players[0].hearts).toBe(2);
  });
  it('two blinds in a row -> Will of God -> vaporize wins', () => {
    let s = match('mercy', 'hector');
    const win = clean([press(B + 250, 3)], [press(B + 600, 2)]);
    s = applyExchange(s, resolveExchange(P, s, win, END)).state;
    s = applyExchange(s, resolveExchange(P, s, win, END)).state;
    expect(s.players[0].charge).toBe(2);
    const r = resolveExchange(P, s, win, END);
    expect(r.will[0]).toBe(true);
    expect(r.outcome?.kind).toBe('will');
    const after = applyExchange(s, r, 'vaporize');
    expect(after.state.players[1].hearts).toBe(0);
    expect(after.state.winner).toBe(0);
  });
  it('Will of God full heal works once, then only vaporize', () => {
    let s = match('mercy', 'hector', (m) => { m.players[0].charge = 2; m.players[0].hearts = 1; });
    const win = clean([press(B + 250, 3)], [press(B + 600, 2)]);
    const a = applyExchange(s, resolveExchange(P, s, win, END), 'heal');
    expect(a.events.willChoice).toBe('heal');
    expect(a.state.players[0].hearts).toBe(3);
    expect(a.state.players[0].charge).toBe(0);
    s = { ...a.state, players: [{ ...a.state.players[0], charge: 2 }, a.state.players[1]] };
    const b = applyExchange(s, resolveExchange(P, s, win, END), 'heal');
    expect(b.events.willChoice).toBe('vaporize');
    expect(b.state.winner).toBe(0);
  });
  it('mercy vs mercy trade blinds both, nothing else', () => {
    const r = resolveExchange(P, match('mercy', 'mercy'), clean([press(B + 250, 3)], [press(B + 260, 2)]), END);
    expect(r.outcome?.kind).toBe('mutualBlind');
  });
});

describe('last stand, smoke, match end', () => {
  it('Last Stand at 1 heart', () => {
    const r = resolveExchange(P, match('hector', 'hector', (m) => { m.players[0].hearts = 1; }), clean(), B - 1);
    expect(r.lastStand).toEqual([true, false]);
    expect(r.goldBand[0]).toBe(D.goldBandMs + D.lastStandBonusMs);
  });
  it("Dusty's smoke hides the opponent's tile next exchange", () => {
    const s = match('dusty', 'hector');
    const r = resolveExchange(P, s, clean([press(B + 300, 3)], [press(B + 900, 2)]), END);
    expect(applyExchange(s, r).state.smoke).toEqual([false, true]);
  });
  it('first to zero loses; simultaneous zero is a draw', () => {
    const s = match('hector', 'hector', (m) => { m.players[0].hearts = 1; m.players[1].hearts = 1; });
    const r = resolveExchange(P, s, clean([press(B + 300, 3)], [press(B + 310, 2)]), END);
    expect(applyExchange(s, r).state.winner).toBe('draw');
    const r2 = resolveExchange(P, s, clean([press(B + 300, 3)], [press(B + 900, 2)]), END);
    expect(applyExchange(s, r2).state.winner).toBe(0);
  });
});

describe('plan generation', () => {
  it('is deterministic per seed and well-formed', () => {
    for (let seed = 1; seed < 200; seed++) {
      const a = generatePlan(seed);
      expect(generatePlan(seed)).toEqual(a);
      expect(a.prompts.length).toBe(CONFIG.nerve.prompts);
      expect(a.bellT).toBeGreaterThan(a.standoffStart + CONFIG.standoff.minMs - 1);
      for (const f of a.fakes) {
        expect(f.t).toBeGreaterThan(a.standoffStart);
        expect(f.t).toBeLessThan(a.bellT);
      }
      expect(planEnd(a)).toBeGreaterThan(a.bellT);
    }
  });
});

describe('CPU', () => {
  it('reaction times are human-like with variance, harder = faster', () => {
    const avg = (diff: 'easy' | 'normal' | 'hard') => {
      let sum = 0;
      const n = 300;
      for (let i = 0; i < n; i++) {
        const p = generatePlan(i + 1);
        const log = cpuExchangeLog(p, newMatch('hector', 'hector'), 1, diff, makeRng(i * 7 + 3));
        const r = resolveExchange(p, newMatch('hector', 'hector'), [[], log], 1e9);
        if (r.draws[1]) sum += r.draws[1].reaction;
        else sum += 600;
      }
      return sum / n;
    };
    const e = avg('easy'), n = avg('normal'), h = avg('hard');
    expect(e).toBeGreaterThan(n);
    expect(n).toBeGreaterThan(h);
    expect(h).toBeGreaterThan(CONFIG.cpuMinReactMs);
  });
  it('sometimes falls for fakes (easy more than hard)', () => {
    const early = (diff: 'easy' | 'hard') => {
      let c = 0;
      for (let i = 0; i < 400; i++) {
        const p = generatePlan(i + 11);
        const log = cpuExchangeLog(p, newMatch('dusty', 'dusty'), 1, diff, makeRng(i + 99));
        if (resolveExchange(p, newMatch('dusty', 'dusty'), [[], log], 1e9).outcome?.kind === 'early') c++;
      }
      return c;
    };
    expect(early('easy')).toBeGreaterThan(early('hard'));
    expect(early('hard')).toBeGreaterThan(0);
  });
  it('heals sensibly: always at 1 heart, never at full', () => {
    const s = newMatch('hector', 'hector');
    expect(cpuWantsHeal(s, 1, 'hard', makeRng(1))).toBe(false);
    s.players[1].hearts = 1;
    expect(cpuWantsHeal(s, 1, 'easy', makeRng(1))).toBe(true);
    s.players[1].healsLeft = 0;
    expect(cpuWantsHeal(s, 1, 'easy', makeRng(1))).toBe(false);
  });
  it('Mercy CPU focuses harder when Will of God is up', () => {
    const avg = (charge: number) => {
      let sum = 0;
      for (let i = 0; i < 300; i++) {
        const s = newMatch('hector', 'mercy');
        s.players[1].charge = charge;
        const p = generatePlan(i + 5);
        const r = resolveExchange(p, s, [[], cpuExchangeLog(p, s, 1, 'normal', makeRng(i + 1))], 1e9);
        sum += r.draws[1]?.reaction ?? 600;
      }
      return sum / 300;
    };
    expect(avg(2)).toBeLessThan(avg(0));
  });
  it('feint reaction stays inside the window when it bites', () => {
    for (let i = 0; i < 100; i++) {
      const r = cpuFeintReaction('easy', makeRng(i));
      if (r !== null) expect(r).toBeLessThan(CONFIG.feint.reactWindowMs);
    }
  });
});
