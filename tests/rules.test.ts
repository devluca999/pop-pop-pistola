import { describe, it, expect } from 'vitest';
import {
  CONFIG, BTN, DIRECTIONS, newMatch, generatePlan, resolveExchange, applyExchange, goldBand, isPerfect, evalPrompt, drawWindow,
  cpuExchangeLog, cpuFeintReaction, cpuWantsHeal, makeRng, planEnd, markSeen, wheelDistance, wheelPhase,
  type ExchangePlan, type InputEvent, type MatchState, type PromptPlan, type DrawType, type PromptType, type Button,
} from '../src/rules';
import type { CharacterId } from '../src/types';

const D = CONFIG.draw;
const N = CONFIG.nerve;
const { up: U, down: DN, left: L, right: R, action: A } = BTN;

const pp = (type: PromptType, t: number, keys: Button[], extra: Partial<PromptPlan> = {}): PromptPlan =>
  ({ type, c: t - N.countdownMs, t, end: t + N.windowMs[type], demo: false, keys, ...extra });

/** A fixed plan so timings are easy to reason about. */
function plan(over: Partial<ExchangePlan> = {}): ExchangePlan {
  return {
    seed: 1,
    prompts: [
      pp('tap', 2600, [L]),
      pp('tap', 4450, [R]),
      pp('hold', 6300, [A]),
    ],
    standoffStart: 7800,
    announceEnd: 8700,
    drawType: 'ring',
    drawDemo: false,
    fakes: [{ t: 9300, kind: 'crow' }],
    bellT: 10500,
    wheel: { arc: 400, start: 0, dir: 1 },
    ...over,
  };
}
const P = plan();
const B = P.bellT;
const press = (t: number, slot: Button): InputEvent => ({ t, kind: 'press', slot });
const release = (t: number, slot: Button): InputEvent => ({ t, kind: 'release', slot });
const tapAt = (t: number, slot: Button, hold = 80): InputEvent[] => [press(t, slot), release(t + hold, slot)];
const shoot = (t: number) => tapAt(t, A);
const healHold = (t = 300, ms = CONFIG.heal.holdMs + 50) => [press(t, DN), release(t + ms, DN)];

/** Clean nerve phase for both (player 0 slightly faster), then the given extra events. */
function clean(extra0: InputEvent[] = [], extra1: InputEvent[] = [], opts: { p1First?: boolean; pl?: ExchangePlan } = {}): [InputEvent[], InputEvent[]] {
  const a: InputEvent[] = [];
  const b: InputEvent[] = [];
  for (const pr of (opts.pl ?? P).prompts) {
    const [ta, tb] = opts.p1First ? [pr.t + 300, pr.t + 250] : [pr.t + 250, pr.t + 300];
    const hold = pr.type === 'hold' ? 700 : 80;
    a.push(...tapAt(ta, pr.keys[0], hold));
    b.push(...tapAt(tb, pr.keys[0], hold));
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
  });
  it('is wider in Last Stand', () => {
    expect(goldBand(0, true)).toBe(D.goldBandMs + D.lastStandBonusMs);
  });
  it('perfect only inside the band', () => {
    expect(isPerfect(D.goldCenterMs, 100)).toBe(true);
    expect(isPerfect(D.goldCenterMs + 60, 100)).toBe(false);
    expect(isPerfect(D.goldCenterMs, 0)).toBe(false);
  });
  it('wheel arc and speed span shrink with flinches; no perfect at 3', () => {
    const w0 = drawWindow('wheel', 0, false), w1 = drawWindow('wheel', 1, false), w3 = drawWindow('wheel', 3, false);
    expect(w1.arcHalf).toBeLessThan(w0.arcHalf);
    expect(w3.perfect).toBe(0);
    expect(w3.arcHalf).toBeGreaterThanOrEqual(D.wheelArcMinHalfMs);
    expect(drawWindow('speed', 1, false).perfect).toBeLessThan(drawWindow('speed', 0, false).perfect);
    expect(drawWindow('speed', 3, false).perfect).toBe(0);
  });
});

describe('nerve prompt types (directions + action only)', () => {
  const at = (type: PromptType, keys: Button[], extra: Partial<PromptPlan> = {}) => pp(type, 1000, keys, extra);
  it('TAP: ok, slow, wrong button, no press', () => {
    const p = at('tap', [L]);
    expect(evalPrompt([press(1200, L)], p, 0, END).status).toBe('ok');
    expect(evalPrompt([press(1000 + N.slowMs + 10, L)], p, 0, END).status).toBe('slow');
    expect(evalPrompt([press(1200, R)], p, 0, END).status).toBe('miss');
    expect(evalPrompt([], p, 0, END).status).toBe('miss');
    expect(evalPrompt([], p, 0, 1100).status).toBe('pending');
  });
  it('HOLD: must be held', () => {
    const p = at('hold', [A]);
    expect(evalPrompt(tapAt(1200, A, N.holdMs + 20), p, 0, END).status).toBe('ok');
    expect(evalPrompt(tapAt(1200, A, 100), p, 0, END).status).toBe('miss');
    expect(evalPrompt([press(1200, A)], p, 0, 1300).holding).toBe(true);
  });
  it('MASH: N presses of the button', () => {
    const p = at('mash', [U]);
    const ev = Array.from({ length: N.mashCount }, (_, k) => tapAt(1150 + k * 110, U, 40)).flat();
    expect(evalPrompt(ev, p, 0, END).status).toBe('ok');
    expect(evalPrompt(ev.slice(0, 4), p, 0, 1400).count).toBe(2);
    expect(evalPrompt([...tapAt(1150, U), ...tapAt(1250, DN)], p, 0, END).status).toBe('miss');
  });
  it('TIME IT: press inside the arc', () => {
    const p = at('time', [A], { arcMs: 600 });
    expect(evalPrompt([press(1600, A)], p, 0, END).status).toBe('ok');
    expect(evalPrompt([press(1600 + N.timeArcHalfMs + 20, A)], p, 0, END).status).toBe('miss');
  });
  it('RELEASE: hold, then let go after the cue', () => {
    const p = at('release', [R], { cueMs: 900 });
    expect(evalPrompt([press(1200, R), release(1950, R)], p, 0, END).status).toBe('ok');
    expect(evalPrompt([press(1200, R), release(1700, R)], p, 0, END).status).toBe('miss');
    expect(evalPrompt([press(1200, R)], p, 0, END).status).toBe('slow');
  });
  it('SEQUENCE: arrow combo in order', () => {
    const p = at('order', [U, L, R]);
    expect(evalPrompt([...tapAt(1200, U), ...tapAt(1350, L), ...tapAt(1500, R)], p, 0, END).status).toBe('ok');
    expect(evalPrompt([...tapAt(1200, U), ...tapAt(1350, R)], p, 0, END).status).toBe('miss');
  });
  it('STEADY: pressing anything is a flinch; nothing is ok', () => {
    const p = at('steady', []);
    expect(evalPrompt([press(1300, DN)], p, 0, END).status).toBe('miss');
    expect(evalPrompt([], p, 0, END).status).toBe('ok');
  });
  it('stare-down: the later correct press flinches', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean(), B - 1);
    expect(r.prompts[0][0].status).toBe('ok');
    expect(r.prompts[0][1].status).toBe('beaten');
    expect(r.flinches).toEqual([0, 3]);
  });
  it("Dusty's cigar: his presses never count as first", () => {
    const s = match('dusty', 'hector', (m) => { m.players[0].hearts = 2; });
    const r = resolveExchange(P, s, clean(healHold()), B - 1);
    expect(r.cigar[0]).toBe(true);
    expect(r.prompts[0][0].status).toBe('beaten');
  });
});

describe('draw at the bell: RING (ACTION)', () => {
  it('faster ACTION shoots first (Hector hit = 1)', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean(shoot(B + 200), shoot(B + 500)), END);
    expect(r.outcome).toMatchObject({ kind: 'shot', actor: 0, damage: [0, 1] });
  });
  it('perfect draw doubles Hector damage', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean(shoot(B + D.goldCenterMs), shoot(B + 700)), END);
    expect(r.outcome).toMatchObject({ kind: 'shot', actor: 0, damage: [0, 2], perfect: [true, false] });
  });
  it('trade inside the window', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean(shoot(B + 250), shoot(B + 250 + D.tradeWindowMs - 10)), END);
    expect(r.outcome?.kind).toBe('trade');
  });
  it('directions at the bell do nothing', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean([...tapAt(B + 150, L), ...shoot(B + 500)], shoot(B + 300)), END);
    expect(r.outcome).toMatchObject({ kind: 'shot', actor: 1 });
  });
  it('nobody draws -> reset', () => {
    expect(resolveExchange(P, match('hector', 'hector'), clean(), END).outcome?.kind).toBe('reset');
  });
  it('waits for a possible trade before deciding', () => {
    const logs = clean(shoot(B + 200), []);
    expect(resolveExchange(P, match('hector', 'hector'), logs, B + 250).done).toBe(false);
    expect(resolveExchange(P, match('hector', 'hector'), logs, B + 200 + D.tradeWindowMs + 1).done).toBe(true);
  });
  it('Dusty: slower draw, hits for 2, wins trades (deals 2, takes 1), perfect 3', () => {
    const s = match('dusty', 'hector');
    expect(resolveExchange(P, s, clean(shoot(B + 250), shoot(B + 260)), END).outcome).toMatchObject({ kind: 'shot', actor: 1 });
    expect(resolveExchange(P, s, clean(shoot(B + 200), shoot(B + 500)), END).outcome).toMatchObject({ actor: 0, damage: [0, 2] });
    expect(resolveExchange(P, s, clean(shoot(B + 200), shoot(B + 330)), END).outcome).toMatchObject({ kind: 'trade', damage: [1, 2] });
    expect(resolveExchange(P, s, clean(shoot(B + D.goldCenterMs), shoot(B + 900)), END).outcome).toMatchObject({ damage: [0, 3] });
  });
});

describe('draw at the bell: WHEEL (accuracy, not speed)', () => {
  const W = plan({ drawType: 'wheel', wheel: { arc: 400, start: 0, dir: 1 } });
  const at = (dist: number) => B + 400 + dist; // the needle reaches the arc centre 400ms after the bell
  it('inside the arc beats outside, even when slower', () => {
    const r = resolveExchange(W, match('hector', 'hector'), clean(shoot(at(D.wheelArcHalfMs + 30)), shoot(at(40) + D.wheelPeriodMs)), END);
    expect(r.outcome).toMatchObject({ kind: 'shot', actor: 1 });
  });
  it('both inside: closer to the centre wins', () => {
    const r = resolveExchange(W, match('hector', 'hector'), clean(shoot(at(-80)), shoot(at(20))), END);
    expect(r.outcome).toMatchObject({ kind: 'shot', actor: 1 });
  });
  it('within 15ms of each other is a trade', () => {
    const r = resolveExchange(W, match('hector', 'hector'), clean(shoot(at(-50)), shoot(at(60))), END);
    expect(r.outcome?.kind).toBe('trade');
  });
  it('nobody inside: nobody hits', () => {
    const r = resolveExchange(W, match('hector', 'hector'), clean(shoot(at(300)), shoot(at(-300))), END);
    expect(r.outcome?.kind).toBe('reset');
  });
  it('perfect inside the thin slice; only the first shot counts', () => {
    const r = resolveExchange(W, match('hector', 'hector'), clean(shoot(at(5)), [...shoot(at(250)), ...shoot(at(0) + D.wheelPeriodMs)]), END);
    expect(r.outcome).toMatchObject({ kind: 'shot', actor: 0, perfect: [true, false], damage: [0, 2] });
  });
  it('waits for both shots before deciding', () => {
    const logs = clean(shoot(at(0)), []);
    expect(resolveExchange(W, match('hector', 'hector'), logs, at(0) + 300).done).toBe(false);
    expect(resolveExchange(W, match('hector', 'hector'), logs, B + D.windowMs.wheel).outcome).toMatchObject({ actor: 0 });
  });
  it('needle phase and circular distance', () => {
    expect(wheelPhase(W, B + 400)).toBe(400);
    expect(wheelPhase({ ...W, wheel: { arc: 0, start: 800, dir: -1 } }, B + 200)).toBe(100);
    expect(wheelDistance(10, 890, 900)).toBe(20);
  });
});

describe('draw at the bell: SPEED TAP (ACTION x N)', () => {
  const S = plan({ drawType: 'speed' });
  const taps = (t0: number, gap: number) => Array.from({ length: D.speedCount }, (_, k) => shoot(t0 + k * gap)).flat();
  it('first to finish N taps shoots; tight taps = perfect', () => {
    const r = resolveExchange(S, match('hector', 'hector'), clean(taps(B + 200, 100), taps(B + 250, 140)), END);
    expect(r.outcome).toMatchObject({ kind: 'shot', actor: 0, perfect: [true, false] });
  });
  it('counts progress', () => {
    const r = resolveExchange(S, match('hector', 'hector'), clean(taps(B + 200, 100), []), B + 420);
    expect(r.speedCount[0]).toBe(3);
  });
});

describe('standoff: fakes, early draws and feints', () => {
  it('ACTION on a fake costs a heart', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean(shoot(9500)), END);
    expect(r.outcome).toMatchObject({ kind: 'early', actor: 0, damage: [1, 0] });
    expect(r.outcome?.fake?.kind).toBe('crow');
  });
  it('ACTION during the announcement is early too; other directions are not', () => {
    expect(resolveExchange(P, match('hector', 'hector'), clean(shoot(8000)), END).outcome?.kind).toBe('early');
    expect(resolveExchange(P, match('hector', 'hector'), clean([...tapAt(8000, L), ...tapAt(9000, DN)]), END).outcome?.kind).toBe('reset');
  });
  it('UP feint bitten: victim gets 2 flinches and is not penalised', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean(tapAt(9000, U), shoot(9200)), B - 1);
    expect(r.feints[0]).toMatchObject({ by: 0, status: 'bit' });
    expect(r.flinches[1]).toBe(3 + CONFIG.feint.victimFlinches);
    expect(r.outcome).toBeNull();
  });
  it('UP feint whiffed: feinter gets 1 flinch', () => {
    const r = resolveExchange(P, match('hector', 'hector'), clean(tapAt(9000, U)), B - 1);
    expect(r.feints[0].status).toBe('whiff');
    expect(r.flinches[0]).toBe(CONFIG.feint.feinterFlinches);
  });
  it('Dusty cannot feint; his UP is harmless', () => {
    const r = resolveExchange(P, match('dusty', 'hector'), clean(tapAt(9000, U), tapAt(9200, L)), END);
    expect(r.feints).toEqual([]);
    expect(r.outcome?.kind).toBe('reset');
  });
});

describe('heals: hold DOWN in READY', () => {
  it('whiskey: +1 heart, drunk = 2 flinches, max 2 per match', () => {
    let s = match('hector', 'hector', (m) => { m.players[0].hearts = 1; });
    const logs = clean([...healHold(), ...shoot(B + 900)], shoot(B + 200));
    const r = resolveExchange(P, s, logs, END);
    expect(r.healed[0]).toBe(true);
    expect(r.flinches[0]).toBe(2);
    s = applyExchange(s, r).state;
    expect(s.players[0].healsLeft).toBe(1);
    s.players[0].healsLeft = 0;
    expect(resolveExchange(P, s, logs, END).healed[0]).toBe(false);
  });
  it('a short hold does nothing; progress fills while holding', () => {
    const s = match('hector', 'dusty', (m) => { m.players[0].hearts = 2; });
    expect(resolveExchange(P, s, clean(healHold(300, 600)), END).healed[0]).toBe(false);
    expect(resolveExchange(P, s, clean([press(300, DN)]), 800).healProgress[0]).toBeCloseTo(0.5, 1);
  });
  it('must finish inside READY, and not at full hearts', () => {
    const s = match('hector', 'dusty', (m) => { m.players[0].hearts = 2; });
    expect(resolveExchange(P, s, clean(healHold(CONFIG.readyMs - 500)), END).healed[0]).toBe(false);
    s.players[0].hearts = 3;
    expect(resolveExchange(P, s, clean(healHold()), END).healed[0]).toBe(false);
  });
});

describe('status effects last exactly one exchange', () => {
  it('blind: 2 flinches next exchange, then gone', () => {
    let s = match('mercy', 'hector');
    s = applyExchange(s, resolveExchange(P, s, clean(shoot(B + 200), shoot(B + 600)), END)).state;
    expect(s.players[1].status.blind).toBe(true);
    const next = resolveExchange(P, s, clean([], [], { p1First: true }), B - 1);
    expect(next.flinches[1]).toBe(CONFIG.blindFlinches);
    s = applyExchange(s, resolveExchange(P, s, clean(shoot(B + 900), shoot(B + 200)), END)).state;
    expect(s.players[1].status.blind).toBe(false);
  });
  it('blind never stacks', () => {
    let s = match('mercy', 'hector');
    const win = clean(shoot(B + 200), shoot(B + 600));
    s = applyExchange(s, resolveExchange(P, s, win, END)).state;
    s = applyExchange(s, resolveExchange(P, s, win, END)).state;
    expect(resolveExchange(P, s, clean([], [], { p1First: true }), B - 1).flinches[1]).toBe(CONFIG.blindFlinches);
  });
  it("smoke: after Dusty fires or puffs his cigar, the rival's next exchange only", () => {
    let s = match('dusty', 'hector');
    s = applyExchange(s, resolveExchange(P, s, clean(shoot(B + 200), shoot(B + 900)), END)).state;
    expect(s.players[1].status.smoke).toBe(true);
    s = applyExchange(s, resolveExchange(P, s, clean([], shoot(B + 200)), END)).state;
    expect(s.players[1].status.smoke).toBe(false);
    s.players[0].hearts = 2;
    s = applyExchange(s, resolveExchange(P, s, clean(healHold(), shoot(B + 200)), END)).state;
    expect(s.players[1].status.smoke).toBe(true);
  });
});

describe('Sister Mercy', () => {
  it('blind: no damage, +1 charge', () => {
    let s = match('mercy', 'hector');
    const r = resolveExchange(P, s, clean(shoot(B + 250), shoot(B + 500)), END);
    expect(r.outcome?.kind).toBe('blind');
    s = applyExchange(s, r).state;
    expect(s.players[0].charge).toBe(1);
  });
  it('blind lands first in a trade', () => {
    expect(resolveExchange(P, match('mercy', 'dusty'), clean(shoot(B + 320), shoot(B + 200)), END).outcome?.kind).toBe('blind');
  });
  it('losing the draw resets her charge', () => {
    let s = match('mercy', 'hector', (m) => { m.players[0].charge = 1; });
    s = applyExchange(s, resolveExchange(P, s, clean(shoot(B + 600), shoot(B + 200)), END)).state;
    expect(s.players[0].charge).toBe(0);
  });
  it('two blinds -> Will of God -> vaporize wins', () => {
    let s = match('mercy', 'hector');
    const win = clean(shoot(B + 250), shoot(B + 600));
    s = applyExchange(s, resolveExchange(P, s, win, END)).state;
    s = applyExchange(s, resolveExchange(P, s, win, END)).state;
    const r = resolveExchange(P, s, win, END);
    expect(r.outcome?.kind).toBe('will');
    expect(applyExchange(s, r, 'vaporize').state.winner).toBe(0);
  });
  it('full heal works once, then only vaporize', () => {
    let s = match('mercy', 'hector', (m) => { m.players[0].charge = 2; m.players[0].hearts = 1; });
    const win = clean(shoot(B + 250), shoot(B + 600));
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
    expect(applyExchange(s, resolveExchange(P, s, clean(shoot(B + 200), shoot(B + 210)), END)).state.winner).toBe('draw');
    expect(applyExchange(s, resolveExchange(P, s, clean(shoot(B + 200), shoot(B + 900)), END)).state.winner).toBe(0);
  });
});

describe('plan generation: one consistent loop', () => {
  it('is deterministic; beats come in order; standoff is 1.5-4s (+demo)', () => {
    for (let seed = 1; seed < 400; seed++) {
      const a = generatePlan(seed);
      expect(generatePlan(seed)).toEqual(a);
      expect(a.prompts.length).toBe(3);
      expect(a.prompts[0].c).toBe(CONFIG.readyMs);
      for (const p of a.prompts) expect(p.t - p.c).toBeGreaterThanOrEqual(N.countdownMs);
      const demo = a.drawDemo ? CONFIG.standoff.demoMs : 0;
      const standoff = a.bellT - a.standoffStart - demo;
      expect(standoff).toBeGreaterThanOrEqual(CONFIG.standoff.minMs);
      expect(standoff).toBeLessThanOrEqual(CONFIG.standoff.maxMs);
      expect(a.bellT).toBeGreaterThan(a.announceEnd);
      for (const f of a.fakes) {
        expect(f.t).toBeGreaterThan(a.announceEnd);
        expect(f.t).toBeLessThan(a.bellT);
      }
    }
  });
  it('prompts use only directions + action; sequences are arrow combos with no button twice in a row', () => {
    for (let seed = 1; seed < 400; seed++) {
      for (const p of generatePlan(seed).prompts) {
        for (const k of p.keys) expect([0, 1, 2, 3, 4]).toContain(k);
        if (p.type === 'order') {
          expect(p.keys.length).toBe(N.orderLength);
          for (const k of p.keys) expect(DIRECTIONS).toContain(k);
          for (let i = 1; i < p.keys.length; i++) expect(p.keys[i]).not.toBe(p.keys[i - 1]);
        }
        if (p.type === 'steady') expect(p.keys).toEqual([]);
      }
    }
  });
  it('uses the map fake list', () => {
    for (let seed = 1; seed < 100; seed++) for (const f of generatePlan(seed, { fakeKinds: ['whistle'] }).fakes) expect(f.kind).toBe('whistle');
  });
  it('demos only the first time a type appears in a match', () => {
    let s = newMatch('hector', 'dusty');
    const a = generatePlan(5, { seen: s.seen });
    expect(a.prompts[0].demo).toBe(true);
    s = markSeen(s, a);
    const b = generatePlan(5, { seen: s.seen });
    expect(b.prompts.every((p) => !p.demo)).toBe(true);
    expect(b.drawDemo).toBe(false);
  });
  it('a full exchange stays around 12s once demos are done', () => {
    const all = ['tap', 'hold', 'mash', 'time', 'release', 'order', 'steady', 'draw:ring', 'draw:wheel', 'draw:speed'];
    let total = 0;
    const n = 400;
    // the draw usually ends ~400ms after the bell, not at the window's end
    for (let seed = 1; seed <= n; seed++) { const pl = generatePlan(seed, { seen: all }); total += pl.bellT + 400 + CONFIG.aftermathMs; }
    const avg = total / n;
    expect(avg).toBeGreaterThan(10500);
    expect(avg).toBeLessThan(13500);
  });
  it('picks every draw type and prompt type', () => {
    const d = new Set<DrawType>(), p = new Set<PromptType>();
    for (let seed = 1; seed < 300; seed++) { const pl = generatePlan(seed); d.add(pl.drawType); pl.prompts.forEach((x) => p.add(x.type)); }
    expect(d.size).toBe(3);
    expect(p.size).toBe(7);
  });
  it('planEnd is after the draw window', () => {
    const pl = generatePlan(9);
    expect(planEnd(pl)).toBeGreaterThan(pl.bellT + D.windowMs[pl.drawType]);
  });
});

describe('CPU (a simulated human)', () => {
  // SPEED TAP's first tap is a pure reaction (RING can also be a gold-band aim)
  const ringReactions = (diff: 'easy' | 'normal' | 'hard') => {
    const out: number[] = [];
    for (let seed = 1; seed <= 600; seed++) {
      const pl = generatePlan(seed, { forceDraw: 'speed' });
      const ev = cpuExchangeLog(pl, newMatch('dusty', 'dusty'), 1, diff, makeRng(seed * 7));
      const shot = ev.find((e) => e.kind === 'press' && e.slot === A && e.t >= pl.bellT);
      if (shot) out.push(shot.t - pl.bellT);
    }
    return out;
  };
  it('reaction times match the difficulty and are never inhumanly fast', () => {
    for (const [diff, mean] of [['easy', 380], ['normal', 290], ['hard', 230]] as const) {
      const r = ringReactions(diff);
      const avg = r.reduce((a, b) => a + b, 0) / r.length;
      expect(Math.abs(avg - mean)).toBeLessThan(25);
      expect(Math.min(...r)).toBeGreaterThanOrEqual(CONFIG.cpuMinReactMs);
    }
  });
  it('handles every prompt type well on hard', () => {
    let ok = 0, total = 0;
    for (let seed = 1; seed < 300; seed++) {
      const pl = generatePlan(seed);
      const s = newMatch('hector', 'dusty');
      const ev = cpuExchangeLog(pl, s, 0, 'hard', makeRng(seed));
      const r = resolveExchange(pl, s, [ev, []], pl.bellT - 1);
      for (const pr of r.prompts) { total++; if (pr[0].status === 'ok') ok++; }
    }
    expect(ok / total).toBeGreaterThan(0.85);
  });
  it('draws on every draw type', () => {
    for (const dt of ['ring', 'wheel', 'speed'] as DrawType[]) {
      let drew = 0;
      for (let seed = 1; seed < 100; seed++) {
        const pl = generatePlan(seed, { forceDraw: dt });
        const s = newMatch('hector', 'dusty');
        const r = resolveExchange(pl, s, [cpuExchangeLog(pl, s, 0, 'hard', makeRng(seed)), []], END);
        if (r.draws[0]) drew++;
      }
      expect(drew).toBeGreaterThan(80);
    }
  });
  it('sometimes falls for fakes (easy more than hard)', () => {
    const early = (diff: 'easy' | 'hard') => {
      let n = 0;
      for (let seed = 1; seed < 600; seed++) {
        const pl = generatePlan(seed);
        const s = newMatch('dusty', 'dusty');
        const r = resolveExchange(pl, s, [cpuExchangeLog(pl, s, 0, diff, makeRng(seed)), []], END);
        if (r.outcome?.kind === 'early') n++;
      }
      return n;
    };
    const e = early('easy'), h = early('hard');
    expect(e).toBeGreaterThan(h);
    expect(h).toBeGreaterThan(0);
  });
  it('heals by holding DOWN when hurt', () => {
    const s = newMatch('hector', 'hector');
    s.players[0].hearts = 1;
    expect(cpuWantsHeal(s, 0, 'normal', makeRng(1))).toBe(true);
    const pl = generatePlan(3);
    const r = resolveExchange(pl, s, [cpuExchangeLog(pl, s, 0, 'normal', makeRng(4)), []], CONFIG.readyMs);
    expect(r.healed[0]).toBe(true);
  });
  it('feint reaction stays inside the window', () => {
    for (let seed = 1; seed < 200; seed++) {
      const d = cpuFeintReaction('easy', makeRng(seed));
      if (d !== null) expect(d).toBeLessThan(CONFIG.feint.reactWindowMs);
    }
  });
});
