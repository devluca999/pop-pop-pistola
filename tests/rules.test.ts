import { describe, it, expect } from 'vitest';
import {
  CONFIG, newMatch, generatePlan, resolveExchange, applyExchange, goldBand, isPerfect, evalPrompt, drawWindow,
  cpuExchangeLog, cpuFeintReaction, cpuWantsHeal, makeRng, planEnd, markSeen, wheelDistance,
  type ExchangePlan, type InputEvent, type MatchState, type PromptPlan, type DrawType, type PromptType,
} from '../src/rules';
import type { CharacterId } from '../src/types';

const D = CONFIG.draw;
const N = CONFIG.nerve;

const pp = (type: PromptType, t: number, keys: [number[], number[]], extra: Partial<PromptPlan> = {}): PromptPlan =>
  ({ type, c: t - N.countdownMs, t, end: t + N.windowMs[type], demo: false, keys, ...extra });

/** A fixed plan so timings are easy to reason about. */
function plan(over: Partial<ExchangePlan> = {}): ExchangePlan {
  return {
    seed: 1,
    prompts: [
      pp('tap', 2100, [[0], [1]]),
      pp('tap', 3950, [[2], [3]]),
      pp('hold', 5800, [[4], [5]]),
    ],
    standoffStart: 7300,
    countdownEnd: 8500,
    drawType: 'ring',
    drawDemo: false,
    fakes: [{ t: 9000, kind: 'crow' }],
    bellT: 10000,
    drawSlots: [3, 2],
    wheelArc: [400, 500],
    ...over,
  };
}
const P = plan();
const B = P.bellT;
const press = (t: number, slot: number): InputEvent => ({ t, kind: 'press', slot });
const release = (t: number, slot: number): InputEvent => ({ t, kind: 'release', slot });
const action = (t: number): InputEvent => ({ t, kind: 'action' });

/** Clean nerve phase for both (player 0 slightly faster), then the given draw events. */
function clean(extra0: InputEvent[] = [], extra1: InputEvent[] = [], opts: { p1First?: boolean; pl?: ExchangePlan } = {}): [InputEvent[], InputEvent[]] {
  const a: InputEvent[] = [];
  const b: InputEvent[] = [];
  for (const pr of (opts.pl ?? P).prompts) {
    const [ta, tb] = opts.p1First ? [pr.t + 300, pr.t + 250] : [pr.t + 250, pr.t + 300];
    a.push(press(ta, pr.keys[0][0]), release(ta + (pr.type === 'hold' ? 700 : 80), pr.keys[0][0]));
    b.push(press(tb, pr.keys[1][0]), release(tb + (pr.type === 'hold' ? 700 : 80), pr.keys[1][0]));
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
    expect(goldBand(3, false)).toBe(0);
    expect(goldBand(5, true)).toBe(0);
  });
  it('is wider in Last Stand', () => {
    expect(goldBand(0, true)).toBe(D.goldBandMs + D.lastStandBonusMs);
  });
  it('perfect only inside the band', () => {
    const band = goldBand(0, false);
    expect(isPerfect(D.goldCenterMs, band)).toBe(true);
    expect(isPerfect(D.goldCenterMs + band / 2 + 1, band)).toBe(false);
    expect(isPerfect(D.goldCenterMs, 0)).toBe(false);
  });
  it('wheel arc and speed span shrink with flinches; no perfect at 3', () => {
    const w0 = drawWindow('wheel', 0, false), w2 = drawWindow('wheel', 2, false), w3 = drawWindow('wheel', 3, false);
    expect(w2.arcHalf).toBeLessThan(w0.arcHalf);
    expect(w3.arcHalf).toBeGreaterThan(0);
    expect(w3.perfect).toBe(0);
    expect(drawWindow('speed', 1, false).perfect).toBeLessThan(drawWindow('speed', 0, false).perfect);
    expect(drawWindow('speed', 3, false).perfect).toBe(0);
  });
});

describe('nerve prompt types', () => {
  const at = (type: PromptType, extra: Partial<PromptPlan> = {}) => pp(type, 1000, [[0, 1, 2], [3, 4, 5]], extra);
  it('TAP: ok, slow, wrong key, no press', () => {
    const p = at('tap');
    expect(evalPrompt([press(1200, 0)], p, 0, END).status).toBe('ok');
    expect(evalPrompt([press(1000 + N.slowMs + 10, 0)], p, 0, END).status).toBe('slow');
    expect(evalPrompt([press(1200, 1)], p, 0, END).status).toBe('miss');
    expect(evalPrompt([], p, 0, END).status).toBe('miss');
    expect(evalPrompt([], p, 0, 1010).status).toBe('pending');
  });
  it('HOLD: must be held', () => {
    const p = at('hold');
    expect(evalPrompt([press(1100, 0), release(1300, 0)], p, 0, END).status).toBe('miss');
    expect(evalPrompt([press(1100, 0), release(1700, 0)], p, 0, END).status).toBe('ok');
    expect(evalPrompt([press(1100, 0)], p, 0, 1200).holding).toBe(true);
  });
  it('MASH: N presses of the key', () => {
    const p = at('mash');
    const taps = (n: number, slot = 0) => [...Array(n).keys()].map((k) => press(1150 + k * 100, slot));
    expect(evalPrompt(taps(N.mashCount), p, 0, END).status).toBe('ok');
    expect(evalPrompt(taps(N.mashCount - 1), p, 0, END).status).toBe('miss');
    expect(evalPrompt(taps(2), p, 0, 1300).count).toBe(2);
    expect(evalPrompt([press(1150, 0), press(1250, 4)], p, 0, END).status).toBe('miss');
  });
  it('TIME IT: press inside the arc', () => {
    const p = at('time', { arcMs: [600, 700] });
    expect(evalPrompt([press(1600, 0)], p, 0, END).status).toBe('ok');
    expect(evalPrompt([press(1600 + N.timeArcHalfMs + 5, 0)], p, 0, END).status).toBe('miss');
    expect(evalPrompt([press(1700, 3)], p, 1, END).status).toBe('ok');
  });
  it('RELEASE: hold, then let go after the cue', () => {
    const p = at('release', { cueMs: 900 });
    expect(evalPrompt([press(1200, 0), release(2000, 0)], p, 0, END).status).toBe('ok');
    expect(evalPrompt([press(1200, 0), release(1800, 0)], p, 0, END).status).toBe('miss'); // before cue
    expect(evalPrompt([press(1200, 0)], p, 0, END).status).toBe('slow'); // never let go
    expect(evalPrompt([press(1000 + N.releasePressMs + 50, 0), release(2000, 0)], p, 0, END).status).toBe('miss');
  });
  it('IN ORDER: all keys in sequence', () => {
    const p = at('order');
    expect(evalPrompt([press(1200, 0), press(1350, 1), press(1500, 2)], p, 0, END).status).toBe('ok');
    expect(evalPrompt([press(1200, 0), press(1350, 2)], p, 0, END).status).toBe('miss');
    expect(evalPrompt([press(1200, 0), press(1350, 1)], p, 0, 1400).count).toBe(2);
  });
  it('STEADY: pressing anything is a flinch; nothing is ok', () => {
    const p = at('steady');
    expect(evalPrompt([], p, 0, END).status).toBe('ok');
    expect(evalPrompt([press(1300, 5)], p, 0, END).status).toBe('miss');
    expect(evalPrompt([], p, 0, 1100).status).toBe('pending');
  });
  it('stare-down: the later correct press flinches', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean(), B - 1);
    expect(r.prompts.every((p) => p[0].status === 'ok' && p[1].status === 'beaten')).toBe(true);
    expect(r.flinches).toEqual([0, 3]);
  });
  it("Dusty's cigar: his presses never count as first", () => {
    const s = match('dusty', 'hector', (m) => { m.players[0].hearts = 2; });
    const r = resolveExchange(P, s, clean([{ t: 500, kind: 'heal' }]), B - 1);
    expect(r.cigar[0]).toBe(true);
    expect(r.prompts.every((p) => p[0].status === 'beaten' && p[1].status === 'ok')).toBe(true);
  });
});

describe('draw at the bell: RING', () => {
  it('faster correct press shoots first (Hector hit = 1)', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean([press(B + 200, 3)], [press(B + 500, 2)]), END);
    expect(r.outcome?.kind).toBe('shot');
    expect(r.outcome?.damage).toEqual([0, 1]);
  });
  it('perfect draw doubles Hector damage', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean([press(B + D.goldCenterMs, 3)], [press(B + 900, 2)]), END);
    expect(r.outcome?.damage).toEqual([0, 2]);
  });
  it('trade inside the window', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean([press(B + 150, 3)], [press(B + 150 + D.tradeWindowMs, 2)]), END);
    expect(r.outcome?.kind).toBe('trade');
    expect(r.outcome?.damage).toEqual([1, 1]);
  });
  it('wrong key jams the gun', () => {
    const r = resolveExchange(P, match('hector', 'hector'),
      clean([press(B + 200, 0), press(B + 400, 3), press(B + 750, 3)], [press(B + 600, 2)]), END);
    expect(r.draws[0]?.reaction).toBe(750);
    expect(r.draws[0]?.jams).toBe(1);
    expect(r.outcome?.actor).toBe(1);
  });
  it('nobody draws -> reset', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean(), B + D.windowMs.ring);
    expect(r.outcome?.kind).toBe('reset');
  });
  it('waits for a possible trade before deciding', () => {
    const logs = clean([press(B + 300, 3)]);
    expect(resolveExchange(P, match('hector', 'hector'), logs, B + 350).done).toBe(false);
    expect(resolveExchange(P, match('hector', 'hector'), logs, B + 300 + D.tradeWindowMs).done).toBe(true);
  });
  it('Dusty: slower draw, hits for 2, wins trades (deals 2, takes 1), perfect 3', () => {
    expect(resolveExchange(P, match('dusty', 'hector'), clean([press(B + 200, 3)], [press(B + 900, 2)]), END).outcome?.damage).toEqual([0, 2]);
    expect(resolveExchange(P, match('dusty', 'hector'), clean([press(B + 200, 3)], [press(B + 300, 2)]), END).outcome?.damage).toEqual([1, 2]);
    expect(resolveExchange(P, match('dusty', 'hector'), clean([press(B + D.goldCenterMs, 3)], [press(B + 1200, 2)]), END).outcome?.damage).toEqual([0, 3]);
  });
});

describe('draw at the bell: WHEEL', () => {
  const W = plan({ drawType: 'wheel' });
  it('ACTION inside the arc draws; perfect in the thin slice', () => {
    const r = resolveExchange(W, match('hector', 'hector'), clean([action(B + 400)], [action(B + 700)]), END);
    expect(r.outcome?.actor).toBe(0);
    expect(r.outcome?.perfect[0]).toBe(true);
    expect(r.outcome?.damage).toEqual([0, 2]);
    const r2 = resolveExchange(W, match('hector', 'hector'), clean([action(B + 400 + 100)], [action(B + 1300)]), END);
    expect(r2.outcome?.perfect[0]).toBe(false);
    expect(r2.outcome?.damage).toEqual([0, 1]);
  });
  it('outside the arc jams; the needle comes round again', () => {
    const r = resolveExchange(W, match('hector', 'hector'), clean([action(B + 50), action(B + 400 + D.wheelPeriodMs)], []), END);
    expect(r.draws[0]?.jams).toBe(1);
    expect(r.draws[0]?.reaction).toBe(400 + D.wheelPeriodMs);
  });
  it('letter keys do nothing on the wheel', () => {
    const r = resolveExchange(W, match('hector', 'hector'), clean([press(B + 400, 3)], []), END);
    expect(r.outcome?.kind).toBe('reset');
  });
  it('circular distance', () => {
    expect(wheelDistance(880, 20, 900)).toBe(40);
    expect(wheelDistance(400, 400 + 900, 900)).toBe(0);
  });
});

describe('draw at the bell: SPEED TAP', () => {
  const S = plan({ drawType: 'speed' });
  const taps = (start: number, gap: number, slot: number) => [...Array(D.speedCount).keys()].map((k) => press(start + k * gap, slot));
  it('first to finish N taps shoots; tight taps = perfect', () => {
    const r = resolveExchange(S, match('hector', 'hector'), clean(taps(B + 200, 90, 3), taps(B + 200, 130, 2)), END);
    expect(r.outcome?.actor).toBe(0);
    expect(r.outcome?.perfect[0]).toBe(true);
    const slow = resolveExchange(S, match('hector', 'hector'), clean(taps(B + 200, 160, 3), taps(B + 900, 160, 2)), END);
    expect(slow.outcome?.perfect[0]).toBe(false);
    expect(slow.speedCount[0]).toBe(D.speedCount);
  });
  it('a wrong key jams but keeps the count', () => {
    const ev = [press(B + 200, 3), press(B + 300, 0), ...taps(B + 900, 80, 3)];
    const r = resolveExchange(S, match('hector', 'hector'), clean(ev), END);
    expect(r.draws[0]?.jams).toBe(1);
    expect(r.draws[0]?.pressT).toBe(B + 900 + 80 * (D.speedCount - 2));
  });
});

describe('fakes, early draws and feints', () => {
  it('drawing on a fake costs a heart', () => {
    const r = resolveExchange(P, match('hector', 'dusty'), clean([press(9200, 1)]), END);
    expect(r.outcome?.kind).toBe('early');
    expect(r.outcome?.damage).toEqual([1, 0]);
    expect(r.outcome?.fake?.kind).toBe('crow');
  });
  it('pressing during the draw countdown is early too', () => {
    const r = resolveExchange(P, match('hector', 'dusty'), clean([action(7800)]), END);
    expect(r.outcome?.kind).toBe('early');
  });
  it('feint bitten: victim gets 2 flinches and is not penalised', () => {
    const bit = resolveExchange(P, match('hector', 'hector'), clean([{ t: 9100, kind: 'feint' }], [press(9300, 0)]), B - 1);
    expect(bit.feints[0].status).toBe('bit');
    expect(bit.outcome).toBeNull();
    expect(bit.flinches[1]).toBe(3 + CONFIG.feint.victimFlinches);
  });
  it('feint whiffed: feinter gets 1 flinch', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean([{ t: 9100, kind: 'feint' }]), B - 1);
    expect(r.flinches[0]).toBe(CONFIG.feint.feinterFlinches);
  });
  it('Dusty cannot feint', () => {
    const r = resolveExchange(P, match('dusty', 'hector'), clean([{ t: 9100, kind: 'feint' }], [press(9300, 0)]), END);
    expect(r.feints.length).toBe(0);
    expect(r.outcome?.kind).toBe('early');
  });
});

describe('heals', () => {
  it('whiskey: +1 heart, drunk = 2 flinches, max 2 per match', () => {
    let s = match('hector', 'hector', (m) => { m.players[0].hearts = 1; });
    const logs = clean([{ t: 500, kind: 'heal' }, press(B + 900, 3)], [press(B + 200, 2)]);
    const r = resolveExchange(P, s, logs, END);
    expect(r.healed[0]).toBe(true);
    expect(r.flinches[0]).toBe(2);
    s = applyExchange(s, r).state;
    expect(s.players[0].healsLeft).toBe(1);
    s.players[0].healsLeft = 0;
    expect(resolveExchange(P, s, logs, END).healed[0]).toBe(false);
  });
  it('cannot heal at full hearts or after the ready beat', () => {
    const s = match('hector', 'dusty');
    expect(resolveExchange(P, s, clean([{ t: 500, kind: 'heal' }]), END).healed[0]).toBe(false);
    s.players[0].hearts = 2;
    expect(resolveExchange(P, s, clean([{ t: CONFIG.readyMs + 10, kind: 'heal' }]), END).healed[0]).toBe(false);
  });
});

describe('status effects last exactly one exchange', () => {
  it('blind: 2 flinches next exchange, then gone', () => {
    let s = match('mercy', 'hector');
    s = applyExchange(s, resolveExchange(P, s, clean([press(B + 200, 3)], [press(B + 600, 2)]), END)).state;
    expect(s.players[1].status.blind).toBe(true);
    const next = resolveExchange(P, s, clean([], [], { p1First: true }), B - 1);
    expect(next.flinches[1]).toBe(CONFIG.blindFlinches);
    // Mercy loses this one -> no new blind, old one clears
    s = applyExchange(s, resolveExchange(P, s, clean([press(B + 900, 3)], [press(B + 200, 2)]), END)).state;
    expect(s.players[1].status.blind).toBe(false);
  });
  it('blind never stacks', () => {
    let s = match('mercy', 'hector');
    const win = clean([press(B + 200, 3)], [press(B + 600, 2)]);
    s = applyExchange(s, resolveExchange(P, s, win, END)).state;
    s = applyExchange(s, resolveExchange(P, s, win, END)).state;
    expect(resolveExchange(P, s, clean([], [], { p1First: true }), B - 1).flinches[1]).toBe(CONFIG.blindFlinches);
  });
  it("smoke: after Dusty fires or puffs his cigar, the rival's next exchange only", () => {
    let s = match('dusty', 'hector');
    s = applyExchange(s, resolveExchange(P, s, clean([press(B + 200, 3)], [press(B + 900, 2)]), END)).state;
    expect(s.players[1].status.smoke).toBe(true);
    s = applyExchange(s, resolveExchange(P, s, clean([], [press(B + 200, 2)]), END)).state;
    expect(s.players[1].status.smoke).toBe(false);
    s.players[0].hearts = 2;
    s = applyExchange(s, resolveExchange(P, s, clean([{ t: 500, kind: 'heal' }], [press(B + 200, 2)]), END)).state;
    expect(s.players[1].status.smoke).toBe(true);
  });
});

describe('Sister Mercy', () => {
  it('blind: no damage, +1 charge', () => {
    let s = match('mercy', 'hector');
    const r = resolveExchange(P, s, clean([press(B + 250, 3)], [press(B + 500, 2)]), END);
    expect(r.outcome?.kind).toBe('blind');
    s = applyExchange(s, r).state;
    expect(s.players[0].charge).toBe(1);
  });
  it('blind lands first in a trade', () => {
    const r = resolveExchange(P, match('mercy', 'dusty'), clean([press(B + 320, 3)], [press(B + 200, 2)]), END);
    expect(r.outcome?.kind).toBe('blind');
  });
  it('losing the draw resets her charge', () => {
    let s = match('mercy', 'hector', (m) => { m.players[0].charge = 1; });
    s = applyExchange(s, resolveExchange(P, s, clean([press(B + 600, 3)], [press(B + 200, 2)]), END)).state;
    expect(s.players[0].charge).toBe(0);
  });
  it('two blinds -> Will of God -> vaporize wins', () => {
    let s = match('mercy', 'hector');
    const win = clean([press(B + 250, 3)], [press(B + 600, 2)]);
    s = applyExchange(s, resolveExchange(P, s, win, END)).state;
    s = applyExchange(s, resolveExchange(P, s, win, END)).state;
    const r = resolveExchange(P, s, win, END);
    expect(r.outcome?.kind).toBe('will');
    expect(applyExchange(s, r, 'vaporize').state.winner).toBe(0);
  });
  it('full heal works once, then only vaporize', () => {
    let s = match('mercy', 'hector', (m) => { m.players[0].charge = 2; m.players[0].hearts = 1; });
    const win = clean([press(B + 250, 3)], [press(B + 600, 2)]);
    const a = applyExchange(s, resolveExchange(P, s, win, END), 'heal');
    expect(a.state.players[0].hearts).toBe(3);
    s = { ...a.state, players: [{ ...a.state.players[0], charge: 2 }, a.state.players[1]] };
    expect(applyExchange(s, resolveExchange(P, s, win, END), 'heal').events.willChoice).toBe('vaporize');
  });
});

describe('last stand and match end', () => {
  it('Last Stand widens the perfect window', () => {
    const r = resolveExchange(P, match('hector', 'hector', (m) => { m.players[0].hearts = 1; }), clean(), B - 1);
    expect(r.lastStand).toEqual([true, false]);
    expect(r.goldBand[0]).toBe(D.goldBandMs + D.lastStandBonusMs);
  });
  it('first to zero loses; simultaneous zero is a draw', () => {
    const s = match('hector', 'hector', (m) => { m.players[0].hearts = 1; m.players[1].hearts = 1; });
    expect(applyExchange(s, resolveExchange(P, s, clean([press(B + 200, 3)], [press(B + 210, 2)]), END)).state.winner).toBe('draw');
    expect(applyExchange(s, resolveExchange(P, s, clean([press(B + 200, 3)], [press(B + 900, 2)]), END)).state.winner).toBe(0);
  });
});

describe('plan generation', () => {
  const LABELS: [string[], string[]] = [['Q', 'W', 'E', 'A', 'S', 'D'], ['U', 'I', 'O', 'J', 'K', 'L']];
  it('is deterministic and well-formed; the bell never rings before the countdown ends', () => {
    for (let seed = 1; seed < 300; seed++) {
      const a = generatePlan(seed, { labels: LABELS });
      expect(generatePlan(seed, { labels: LABELS })).toEqual(a);
      expect(a.prompts.length).toBe(N.prompts);
      for (const p of a.prompts) {
        expect(p.t - p.c).toBeGreaterThanOrEqual(N.countdownMs);
        expect(p.end).toBeGreaterThan(p.t);
      }
      expect(a.countdownEnd - a.standoffStart).toBeGreaterThanOrEqual(CONFIG.standoff.countdownMs);
      expect(a.bellT).toBeGreaterThan(a.countdownEnd);
      for (const f of a.fakes) {
        expect(f.t).toBeGreaterThan(a.countdownEnd);
        expect(f.t).toBeLessThan(a.bellT);
      }
    }
  });
  it('never shows two look-alike keys in one exchange', () => {
    const groupOf = (l: string) => CONFIG.confusables.find((g) => g.includes(l));
    for (let seed = 1; seed < 400; seed++) {
      const p = generatePlan(seed, { labels: LABELS });
      const used = new Set<string>();
      for (const pr of p.prompts) for (const pl of [0, 1] as const) for (const k of pr.keys[pl]) used.add(LABELS[pl][k]);
      for (const pl of [0, 1] as const) used.add(LABELS[pl][p.drawSlots[pl]]);
      for (const a of used) for (const b of used) if (a !== b) expect(groupOf(a) && groupOf(a) === groupOf(b)).toBeFalsy();
    }
  });
  it('IN ORDER uses distinct keys', () => {
    for (let seed = 1; seed < 400; seed++) {
      for (const pr of generatePlan(seed).prompts) if (pr.type === 'order') for (const k of pr.keys) expect(new Set(k).size).toBe(k.length);
    }
  });
  it('demos only the first time a type appears in a match', () => {
    let s = newMatch('hector', 'dusty');
    const first = generatePlan(5, { seen: s.seen });
    expect(first.prompts[0].demo).toBe(true);
    expect(first.drawDemo).toBe(true);
    s = markSeen(s, first);
    const again = generatePlan(5, { seen: s.seen });
    expect(again.prompts.every((p) => !p.demo)).toBe(true);
    expect(again.drawDemo).toBe(false);
  });
  it('a full exchange stays around 12s once demos are done', () => {
    const all = ['tap', 'hold', 'mash', 'time', 'release', 'order', 'steady', 'draw:ring', 'draw:wheel', 'draw:speed'];
    let sum = 0;
    const n = 400;
    for (let seed = 1; seed <= n; seed++) {
      const p = generatePlan(seed, { seen: all });
      sum += p.bellT + 600; // typical draw
    }
    const avg = sum / n;
    expect(avg).toBeGreaterThan(10500);
    expect(avg).toBeLessThan(13000);
  });
  it('picks every draw type and prompt type', () => {
    const draws = new Set<DrawType>();
    const prompts = new Set<PromptType>();
    for (let seed = 1; seed < 300; seed++) {
      const p = generatePlan(seed);
      draws.add(p.drawType);
      for (const pr of p.prompts) prompts.add(pr.type);
    }
    expect(draws.size).toBe(3);
    expect(prompts.size).toBe(7);
  });
});

describe('CPU', () => {
  const avgReaction = (diff: 'easy' | 'normal' | 'hard') => {
    let sum = 0;
    const n = 300;
    for (let i = 0; i < n; i++) {
      const p = generatePlan(i + 1);
      const log = cpuExchangeLog(p, newMatch('hector', 'hector'), 1, diff, makeRng(i * 7 + 3));
      const r = resolveExchange(p, newMatch('hector', 'hector'), [[], log], 1e9);
      sum += r.draws[1]?.reaction ?? 1500;
    }
    return sum / n;
  };
  it('harder = faster, with human-like times', () => {
    const e = avgReaction('easy'), n = avgReaction('normal'), h = avgReaction('hard');
    expect(e).toBeGreaterThan(n);
    expect(n).toBeGreaterThan(h);
    expect(h).toBeGreaterThan(CONFIG.cpuMinReactMs);
  });
  it('handles every prompt type well on hard', () => {
    let ok = 0, total = 0;
    for (let i = 0; i < 300; i++) {
      const p = generatePlan(i + 31);
      const log = cpuExchangeLog(p, newMatch('dusty', 'dusty'), 1, 'hard', makeRng(i + 5));
      const r = resolveExchange(p, newMatch('dusty', 'dusty'), [[], log], p.standoffStart - 1);
      for (const pr of r.prompts) { total++; if (pr[1].status === 'ok') ok++; }
    }
    expect(ok / total).toBeGreaterThan(0.75);
  });
  it('draws on every draw type', () => {
    for (const type of ['ring', 'wheel', 'speed'] as DrawType[]) {
      let drew = 0;
      for (let i = 0; i < 100; i++) {
        const p = { ...generatePlan(i + 9), drawType: type, fakes: [] };
        const log = cpuExchangeLog(p, newMatch('hector', 'hector'), 1, 'normal', makeRng(i));
        if (resolveExchange(p, newMatch('hector', 'hector'), [[], log], 1e9).draws[1]) drew++;
      }
      expect(drew).toBeGreaterThan(70);
    }
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
  });
  it('heals sensibly', () => {
    const s = newMatch('hector', 'hector');
    expect(cpuWantsHeal(s, 1, 'hard', makeRng(1))).toBe(false);
    s.players[1].hearts = 1;
    expect(cpuWantsHeal(s, 1, 'easy', makeRng(1))).toBe(true);
  });
  it('Mercy CPU focuses harder when Will of God is up', () => {
    const avg = (charge: number) => {
      let sum = 0;
      for (let i = 0; i < 300; i++) {
        const s = newMatch('hector', 'mercy');
        s.players[1].charge = charge;
        const p = { ...generatePlan(i + 5), drawType: 'ring' as const };
        sum += resolveExchange(p, s, [[], cpuExchangeLog(p, s, 1, 'normal', makeRng(i + 1))], 1e9).draws[1]?.reaction ?? 1500;
      }
      return sum / 300;
    };
    expect(avg(2)).toBeLessThan(avg(0));
  });
  it('feint reaction stays inside the window', () => {
    for (let i = 0; i < 100; i++) {
      const r = cpuFeintReaction('easy', makeRng(i));
      if (r !== null) expect(r).toBeLessThan(CONFIG.feint.reactWindowMs);
    }
  });
});

void planEnd;
