import type { CharacterId, PlayerIndex } from '../types';
import { CONFIG, type CharacterStats, type Config, type DrawType, type PromptType } from './config';
import { makeRng, type Rng } from './rng';
import type {
  DrawOutcome, DrawWindow, ExchangePlan, ExchangeResult, FakePlan, FeintOutcome, InputEvent,
  MatchState, Outcome, PlayerState, PromptOutcome, PromptPlan, WillChoice,
} from './model';
import { KEY_SLOTS } from './model';

const other = (i: PlayerIndex): PlayerIndex => (i === 0 ? 1 : 0);
const stats = (c: CharacterId, cfg: Config): CharacterStats => cfg.characters[c];

// ---------------------------------------------------------------- match setup

export function newPlayer(character: CharacterId, cfg: Config = CONFIG): PlayerState {
  return {
    character,
    hearts: cfg.hearts,
    healsLeft: stats(character, cfg).heals,
    status: { blind: false, smoke: false },
    charge: 0,
    fullHealUsed: false,
  };
}

export function newMatch(a: CharacterId, b: CharacterId, cfg: Config = CONFIG): MatchState {
  return { players: [newPlayer(a, cfg), newPlayer(b, cfg)], exchange: 0, seen: [], winner: null };
}

/** Record which prompt/draw types this plan shows, so later plans skip their demos. */
export function markSeen(state: MatchState, plan: ExchangePlan): MatchState {
  const seen = new Set(state.seen);
  for (const p of plan.prompts) seen.add(p.type);
  seen.add(`draw:${plan.drawType}`);
  return { ...state, seen: [...seen] };
}

// ---------------------------------------------------------------- plan

export interface PlanOptions {
  /** Key labels for each player's 6 slots, used to avoid look-alike keys. */
  labels?: [string[], string[]];
  /** Types already seen this match (MatchState.seen). */
  seen?: string[];
}

function weighted<T extends string>(rng: Rng, w: Record<T, number>): T {
  const entries = Object.entries(w) as [T, number][];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let r = rng.next() * total;
  for (const [k, v] of entries) { r -= v; if (r <= 0) return k; }
  return entries[entries.length - 1][0];
}

/**
 * Assign key slots for a whole exchange so no two *different* look-alike labels appear
 * (across both players). Each request is a list of keys that must be distinct (IN ORDER),
 * usually of length 1. Randomised backtracking: always finds an answer when one exists.
 */
export function assignKeys(
  requests: { player: PlayerIndex; count: number }[], labels: [string[], string[]] | undefined, rng: Rng, cfg: Config = CONFIG,
): number[][] {
  const slots = [...Array(KEY_SLOTS).keys()];
  const shuffled = () => { const a = [...slots]; for (let i = a.length - 1; i > 0; i--) { const j = rng.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const out: number[][] = requests.map(() => []);
  if (!labels) {
    requests.forEach((r, i) => { const a = shuffled(); out[i] = a.slice(0, r.count); });
    return out;
  }
  const group = (l: string) => cfg.confusables.findIndex((g) => g.includes(l.toUpperCase()));
  // flatten into single picks; order[i] = candidate order per pick (fixed up front for determinism)
  const picks: { req: number; player: PlayerIndex; cand: number[] }[] = [];
  requests.forEach((r, i) => { for (let k = 0; k < r.count; k++) picks.push({ req: i, player: r.player, cand: shuffled() }); });
  const used = new Map<number, string>(); // group -> label in use
  const useCount = new Map<number, number>();
  let budget = 5000;
  const solve = (i: number): boolean => {
    if (i === picks.length) return true;
    if (--budget < 0) return false;
    const pk = picks[i];
    for (const slot of pk.cand) {
      if (out[pk.req].includes(slot)) continue;
      const lbl = labels[pk.player][slot].toUpperCase();
      const g = group(lbl);
      if (g >= 0 && used.has(g) && used.get(g) !== lbl) continue;
      out[pk.req].push(slot);
      if (g >= 0) { used.set(g, lbl); useCount.set(g, (useCount.get(g) ?? 0) + 1); }
      if (solve(i + 1)) return true;
      out[pk.req].pop();
      if (g >= 0) { const c = (useCount.get(g) ?? 1) - 1; useCount.set(g, c); if (c === 0) used.delete(g); }
    }
    return false;
  };
  if (solve(0)) return out;
  // No clean answer (odd custom bindings): fall back to plain random distinct picks.
  return requests.map((r) => shuffled().slice(0, r.count));
}

export function generatePlan(seed: number, opts: PlanOptions = {}, cfg: Config = CONFIG): ExchangePlan {
  const rng = makeRng(seed);
  const n = cfg.nerve;
  const seen = new Set(opts.seen ?? []);
  const prompts: PromptPlan[] = [];
  let c = cfg.readyMs;
  let last: PromptType | null = null;
  for (let k = 0; k < n.prompts; k++) {
    let type = weighted(rng, n.weights);
    if (type === last) type = weighted(rng, n.weights); // fewer repeats, still possible
    last = type;
    const demo = !seen.has(type);
    seen.add(type);
    const t = c + n.countdownMs + (demo ? n.demoMs : 0);
    const end = t + n.windowMs[type];
    const p: PromptPlan = { type, c, t, end, demo, keys: [[], []] };
    if (type === 'release') p.cueMs = Math.round(rng.range(n.releaseCueMin, n.releaseCueMax));
    if (type === 'time') p.arcMs = [Math.round(rng.range(n.timeArcCenterMin, n.timeArcCenterMax)), Math.round(rng.range(n.timeArcCenterMin, n.timeArcCenterMax))];
    prompts.push(p);
    c = end + n.gapMs;
  }

  const s = cfg.standoff;
  const standoffStart = c;
  const drawType = weighted(rng, cfg.draw.weights);
  const drawDemo = !seen.has(`draw:${drawType}`);
  const countdownEnd = standoffStart + s.countdownMs + (drawDemo ? s.demoMs : 0);
  const bellT = countdownEnd + Math.round(rng.range(s.minWaitMs, s.maxWaitMs));

  const fakes: FakePlan[] = [];
  const kinds = ['crow', 'tumbleweed', 'door', 'cough'] as const;
  const want = s.minFakes + rng.int(s.maxFakes - s.minFakes + 1);
  const lo = countdownEnd + s.fakeEdgeMs;
  const hi = bellT - s.fakeEdgeMs;
  for (let tries = 0; fakes.length < want && tries < 40; tries++) {
    if (hi <= lo) break;
    const t = Math.round(rng.range(lo, hi));
    if (fakes.every((f) => Math.abs(f.t - t) >= s.fakeMinGapMs)) fakes.push({ t, kind: rng.pick(kinds) });
  }
  fakes.sort((a, b) => a.t - b.t);

  // Keys for the whole exchange at once, so look-alikes never share the screen.
  const reqs: { player: PlayerIndex; count: number }[] = [];
  for (const p of prompts) for (const pl of [0, 1] as PlayerIndex[]) reqs.push({ player: pl, count: p.type === 'order' ? n.orderLength : 1 });
  reqs.push({ player: 0, count: 1 }, { player: 1, count: 1 });
  const keys = assignKeys(reqs, opts.labels, rng, cfg);
  prompts.forEach((p, k) => { p.keys = [keys[k * 2], keys[k * 2 + 1]]; });
  const drawSlots: [number, number] = [keys[reqs.length - 2][0], keys[reqs.length - 1][0]];

  const d = cfg.draw;
  return {
    seed,
    prompts,
    standoffStart,
    countdownEnd,
    drawType,
    drawDemo,
    fakes,
    bellT,
    drawSlots,
    wheelArc: [Math.round(rng.range(d.wheelArcCenterMin, d.wheelArcCenterMax)), Math.round(rng.range(d.wheelArcCenterMin, d.wheelArcCenterMax))],
  };
}

/** Time at which an exchange is guaranteed to be over. */
export function planEnd(plan: ExchangePlan, cfg: Config = CONFIG): number {
  return plan.bellT + cfg.draw.windowMs[plan.drawType] + cfg.draw.tradeWindowMs + 200;
}

// ---------------------------------------------------------------- small rules

/** Width (ms) of the RING gold band. */
export function goldBand(flinches: number, lastStand: boolean, cfg: Config = CONFIG): number {
  const d = cfg.draw;
  if (flinches >= d.maxFlinches) return 0;
  return Math.max(0, d.goldBandMs + (lastStand ? d.lastStandBonusMs : 0) - d.goldShrinkPerFlinchMs * flinches);
}

export function isPerfect(reaction: number, band: number, cfg: Config = CONFIG): boolean {
  if (band <= 0) return false;
  return Math.abs(reaction - cfg.draw.goldCenterMs) <= band / 2;
}

/** The per-player numbers for this exchange's draw type. */
export function drawWindow(type: DrawType, flinches: number, lastStand: boolean, cfg: Config = CONFIG): DrawWindow {
  const d = cfg.draw;
  const f = Math.min(flinches, d.maxFlinches);
  const none = flinches >= d.maxFlinches;
  if (type === 'ring') return { perfect: goldBand(flinches, lastStand, cfg), arcHalf: 0 };
  if (type === 'wheel') {
    const ls = lastStand ? d.wheelLastStandBonusMs : 0;
    return {
      arcHalf: Math.max(d.wheelArcMinHalfMs, d.wheelArcHalfMs - d.wheelArcShrinkPerFlinchMs * f) + ls,
      perfect: none ? 0 : Math.max(0, d.wheelPerfectHalfMs - d.wheelPerfectShrinkPerFlinchMs * f) + ls,
    };
  }
  return { perfect: none ? 0 : Math.max(0, d.speedPerfectSpanMs - d.speedShrinkPerFlinchMs * f) + (lastStand ? d.speedLastStandBonusMs : 0), arcHalf: 0 };
}

/** Distance (ms) between two points on the wheel's circular sweep. */
export function wheelDistance(a: number, b: number, period: number): number {
  const d = Math.abs((((a - b) % period) + period) % period);
  return Math.min(d, period - d);
}

export function canHeal(p: PlayerState, cfg: Config = CONFIG): boolean {
  return p.healsLeft > 0 && p.hearts < cfg.hearts && stats(p.character, cfg).healAmount > 0;
}

export function hasWill(p: PlayerState, cfg: Config = CONFIG): boolean {
  return p.character === 'mercy' && p.charge >= cfg.mercy.chargeForWill;
}

const pend = (count = 0, pressT: number | null = null, holding = false): PromptOutcome => ({ status: 'pending', t: null, pressT, holding, count });
const res = (status: PromptOutcome['status'], t: number | null, pressT: number | null, count = 0): PromptOutcome => ({ status, t, pressT, holding: false, count });

/** Evaluate one player's attempt at one nerve prompt. */
export function evalPrompt(events: InputEvent[], p: PromptPlan, player: PlayerIndex, now: number, cfg: Config = CONFIG): PromptOutcome {
  const n = cfg.nerve;
  const start = p.t;
  const end = p.end;
  const keys = p.keys[player];
  const presses = events.filter((e) => e.kind === 'press' && e.t >= start && e.t < end && e.t <= now) as { t: number; slot: number }[];
  const releaseOf = (slot: number, after: number) =>
    events.find((e) => e.kind === 'release' && e.slot === slot && e.t > after && e.t <= now);
  const closed = now >= end;

  switch (p.type) {
    case 'steady': {
      const any = presses[0];
      if (any) return res('miss', any.t, any.t);
      return closed ? res('ok', null, null) : pend();
    }
    case 'tap': {
      const pr = presses[0];
      if (!pr) return closed ? res('miss', end, null) : pend();
      if (pr.slot !== keys[0]) return res('miss', pr.t, pr.t);
      return pr.t - start > n.slowMs ? res('slow', pr.t, pr.t) : res('ok', pr.t, pr.t);
    }
    case 'hold': {
      const pr = presses[0];
      if (!pr) return closed ? res('miss', end, null) : pend();
      if (pr.slot !== keys[0]) return res('miss', pr.t, pr.t);
      const done = pr.t + n.holdMs;
      const rel = releaseOf(keys[0], pr.t);
      if (rel && rel.t < done) return res('miss', rel.t, pr.t);
      if (now < done) return pend(0, pr.t, true);
      return pr.t - start > n.slowMs ? res('slow', done, pr.t) : res('ok', done, pr.t);
    }
    case 'mash': {
      let count = 0;
      for (const pr of presses) {
        if (pr.slot !== keys[0]) return res('miss', pr.t, presses[0].t, count);
        count++;
        if (count >= n.mashCount) return res('ok', pr.t, presses[0].t, count);
      }
      return closed ? res('miss', end, presses[0]?.t ?? null, count) : pend(count, presses[0]?.t ?? null);
    }
    case 'time': {
      const pr = presses[0];
      if (!pr) return closed ? res('miss', end, null) : pend();
      if (pr.slot !== keys[0]) return res('miss', pr.t, pr.t);
      const arc = p.arcMs![player];
      return Math.abs(pr.t - start - arc) <= n.timeArcHalfMs ? res('ok', pr.t, pr.t) : res('miss', pr.t, pr.t);
    }
    case 'release': {
      const pr = presses[0];
      const cue = start + (p.cueMs ?? n.releaseCueMin);
      if (!pr) return now >= start + n.releasePressMs ? res('miss', start + n.releasePressMs, null) : pend();
      if (pr.slot !== keys[0] || pr.t > start + n.releasePressMs) return res('miss', pr.t, pr.t);
      const rel = releaseOf(keys[0], pr.t);
      if (rel && rel.t < cue) return res('miss', rel.t, pr.t);
      if (rel && rel.t <= cue + n.releaseWindowMs) return res('ok', rel.t, pr.t);
      if (now >= cue + n.releaseWindowMs) return res('slow', cue + n.releaseWindowMs, pr.t);
      return pend(0, pr.t, true);
    }
    case 'order': {
      let idx = 0;
      for (const pr of presses) {
        if (pr.slot !== keys[idx]) return res('miss', pr.t, presses[0].t, idx);
        idx++;
        if (idx >= keys.length) return res('ok', pr.t, presses[0].t, idx);
      }
      return closed ? res('miss', end, presses[0]?.t ?? null, idx) : pend(idx, presses[0]?.t ?? null);
    }
  }
}

// ---------------------------------------------------------------- exchange

/**
 * Resolve an exchange from both players' input logs, as far as `now` allows.
 * Pure: the same plan, state and logs always give the same result. Call it every frame;
 * online, pass `now` = the latest time both logs are known up to.
 */
export function resolveExchange(
  plan: ExchangePlan,
  state: MatchState,
  logs: [InputEvent[], InputEvent[]],
  now: number,
  cfg: Config = CONFIG,
): ExchangeResult {
  const idx: PlayerIndex[] = [0, 1];
  const ps = state.players;
  const L = idx.map((i) => [...logs[i]].sort((a, b) => a.t - b.t)) as [InputEvent[], InputEvent[]];

  // Ready beat: heals
  const healed = idx.map((i) => {
    const h = L[i].find((e) => e.kind === 'heal' && e.t < cfg.readyMs && e.t <= now);
    return !!h && canHeal(ps[i], cfg);
  }) as [boolean, boolean];
  const hearts = idx.map((i) =>
    Math.min(cfg.hearts, ps[i].hearts + (healed[i] ? stats(ps[i].character, cfg).healAmount : 0)),
  ) as [number, number];
  const drunk = idx.map((i) => healed[i] && ps[i].character === 'hector') as [boolean, boolean];
  const cigar = idx.map((i) => healed[i] && ps[i].character === 'dusty') as [boolean, boolean];
  const will = idx.map((i) => hasWill(ps[i], cfg)) as [boolean, boolean];
  const lastStand = idx.map((i) => hearts[i] === 1) as [boolean, boolean];

  const flinches = idx.map((i) => (ps[i].status.blind ? cfg.blindFlinches : 0) + (drunk[i] ? cfg.drunkFlinches : 0)) as [number, number];

  // Nerve phase
  const prompts: [PromptOutcome, PromptOutcome][] = plan.prompts.map((p) => {
    const r = idx.map((i) => evalPrompt(L[i], p, i, now, cfg)) as [PromptOutcome, PromptOutcome];
    // Stare-down race: when both completed correctly, the later one flinches.
    if (p.type !== 'steady' && r[0].status === 'ok' && r[1].status === 'ok' && r[0].t !== null && r[1].t !== null) {
      let loser: PlayerIndex | null = null;
      if (cigar[0] !== cigar[1]) loser = cigar[0] ? 0 : 1; // cigar presses never count as first
      else if (r[0].t < r[1].t) loser = 1;
      else if (r[1].t < r[0].t) loser = 0;
      if (loser !== null) r[loser] = { ...r[loser], status: 'beaten' };
    }
    return r;
  });
  for (const r of prompts) for (const i of idx) if (r[i].status !== 'ok' && r[i].status !== 'pending') flinches[i]++;

  // Standoff (draw countdown + wait): feints and early draws
  const isDraw = (e: InputEvent) => e.kind === 'press' || e.kind === 'action';
  const feints: FeintOutcome[] = [];
  const consumed = new Set<InputEvent>();
  for (const i of idx) {
    if (!stats(ps[i].character, cfg).canFeint) continue;
    const f = L[i].find((e) => e.kind === 'feint' && e.t >= plan.standoffStart && e.t < plan.bellT && e.t <= now);
    if (!f) continue;
    const winEnd = Math.min(f.t + cfg.feint.reactWindowMs, plan.bellT);
    const v = other(i);
    const bite = L[v].find((e) => e.kind !== 'release' && e.t > f.t && e.t < winEnd && e.t <= now);
    if (bite) {
      // a pad press can arrive as press + action at once: both belong to the same bite
      for (const e of L[v]) if (isDraw(e) && e.t === bite.t) consumed.add(e);
      consumed.add(bite);
      flinches[v] += cfg.feint.victimFlinches;
      feints.push({ by: i, t: f.t, status: 'bit', biteT: bite.t });
    } else if (now >= winEnd) {
      flinches[i] += cfg.feint.feinterFlinches;
      feints.push({ by: i, t: f.t, status: 'whiff', biteT: null });
    } else {
      feints.push({ by: i, t: f.t, status: 'pending', biteT: null });
    }
  }

  const drawWin = idx.map((i) => drawWindow(plan.drawType, flinches[i], lastStand[i], cfg)) as [DrawWindow, DrawWindow];
  const goldBandW = idx.map((i) => goldBand(flinches[i], lastStand[i], cfg)) as [number, number];
  const base = { healed, hearts, drunk, cigar, will, lastStand, prompts, feints, flinches, drawWin, goldBand: goldBandW };

  let early: { by: PlayerIndex; t: number } | null = null;
  for (const i of idx) {
    const e = L[i].find((ev) => isDraw(ev) && ev.t >= plan.standoffStart && ev.t < plan.bellT && ev.t <= now && !consumed.has(ev));
    if (e && (!early || e.t < early.t)) early = { by: i, t: e.t };
  }
  if (early) {
    const fake = [...plan.fakes].reverse().find((f) => f.t <= early!.t && early!.t - f.t < 1500) ?? null;
    const damage: [number, number] = [0, 0];
    damage[early.by] = cfg.earlyDrawHeartLoss;
    return {
      ...base, done: true, draws: [null, null], jammedUntil: [0, 0], speedCount: [0, 0],
      outcome: { kind: 'early', actor: early.by, damage, blinded: [false, false], perfect: [false, false], fake, t: early.t },
    };
  }

  // Draw at the bell
  const B = plan.bellT;
  const d = cfg.draw;
  const winEnd = B + d.windowMs[plan.drawType];
  const jammedUntil: [number, number] = [0, 0];
  const speedCount: [number, number] = [0, 0];
  const draws = idx.map((i) => {
    let lockedUntil = -Infinity;
    let jams = 0;
    let count = 0;
    let first = 0;
    const done = (t: number, perfect: boolean): DrawOutcome => ({
      pressT: t, reaction: t - B, effective: t - B + stats(ps[i].character, cfg).drawDelayMs, perfect, jams,
    });
    const jam = (t: number) => { jams++; lockedUntil = t + d.jamMs; jammedUntil[i] = lockedUntil; };
    for (const e of L[i]) {
      if (e.t < B || e.t >= winEnd || e.t > now || e.t < lockedUntil) continue;
      if (plan.drawType === 'wheel') {
        if (e.kind !== 'action') continue;
        const dist = wheelDistance(e.t - B, plan.wheelArc[i], d.wheelPeriodMs);
        if (dist <= drawWin[i].arcHalf) return done(e.t, drawWin[i].perfect > 0 && dist <= drawWin[i].perfect);
        jam(e.t);
        continue;
      }
      if (e.kind !== 'press') continue;
      if (e.slot !== plan.drawSlots[i]) { jam(e.t); continue; }
      if (plan.drawType === 'ring') return done(e.t, isPerfect(e.t - B, drawWin[i].perfect, cfg));
      if (count === 0) first = e.t;
      count++;
      speedCount[i] = count;
      if (count >= d.speedCount) return done(e.t, drawWin[i].perfect > 0 && e.t - first <= drawWin[i].perfect);
    }
    return null;
  }) as [DrawOutcome | null, DrawOutcome | null];

  const pending = (): ExchangeResult => ({ ...base, done: false, draws, jammedUntil, speedCount, outcome: null });
  if (now < B) return pending();

  const [d0, d1] = draws;
  if (!d0 && !d1) {
    if (now < winEnd) return pending();
    return {
      ...base, done: true, draws, jammedUntil, speedCount,
      outcome: { kind: 'reset', actor: null, damage: [0, 0], blinded: [false, false], perfect: [false, false], fake: null, t: winEnd },
    };
  }

  if (!d0 || !d1) {
    const a: PlayerIndex = d0 ? 0 : 1;
    const da = draws[a]!;
    const b = other(a);
    const lastChance = B + da.effective + d.tradeWindowMs - stats(ps[b].character, cfg).drawDelayMs;
    const decideAt = Math.min(Math.max(lastChance, da.pressT), winEnd);
    if (now < decideAt) return pending();
    return { ...base, done: true, draws, jammedUntil, speedCount, outcome: winDraw(a, draws, ps, will, cfg, Math.max(decideAt, da.pressT)) };
  }

  const tDecided = Math.max(d0.pressT, d1.pressT);
  const diff = d0.effective - d1.effective;
  if (Math.abs(diff) <= d.tradeWindowMs) {
    return { ...base, done: true, draws, jammedUntil, speedCount, outcome: trade(draws as [DrawOutcome, DrawOutcome], ps, will, cfg, tDecided) };
  }
  const a: PlayerIndex = diff < 0 ? 0 : 1;
  return { ...base, done: true, draws, jammedUntil, speedCount, outcome: winDraw(a, draws, ps, will, cfg, tDecided) };
}

function dmgOf(c: CharacterId, perfect: boolean, cfg: Config) {
  const s = stats(c, cfg);
  return perfect ? s.perfect : s.hit;
}

function winDraw(
  a: PlayerIndex, draws: [DrawOutcome | null, DrawOutcome | null], ps: [PlayerState, PlayerState],
  will: [boolean, boolean], cfg: Config, t: number,
): Outcome {
  const b = other(a);
  const da = draws[a]!;
  const perfect: [boolean, boolean] = [false, false];
  perfect[a] = da.perfect;
  const damage: [number, number] = [0, 0];
  const blinded: [boolean, boolean] = [false, false];
  if (ps[a].character === 'mercy') {
    if (will[a]) return { kind: 'will', actor: a, damage, blinded, perfect, fake: null, t };
    blinded[b] = true;
    return { kind: 'blind', actor: a, damage, blinded, perfect, fake: null, t };
  }
  damage[b] = dmgOf(ps[a].character, da.perfect, cfg);
  return { kind: 'shot', actor: a, damage, blinded, perfect, fake: null, t };
}

function trade(
  draws: [DrawOutcome, DrawOutcome], ps: [PlayerState, PlayerState], will: [boolean, boolean], cfg: Config, t: number,
): Outcome {
  const c = [ps[0].character, ps[1].character];
  const perfect: [boolean, boolean] = [draws[0].perfect, draws[1].perfect];
  const isMercy = [c[0] === 'mercy', c[1] === 'mercy'];
  if (isMercy[0] && isMercy[1]) {
    return { kind: 'mutualBlind', actor: null, damage: [0, 0], blinded: [true, true], perfect, fake: null, t };
  }
  if (isMercy[0] || isMercy[1]) {
    const m: PlayerIndex = isMercy[0] ? 0 : 1;
    return winDraw(m, draws, ps, will, cfg, t);
  }
  const damage: [number, number] = [dmgOf(c[1], perfect[1], cfg), dmgOf(c[0], perfect[0], cfg)];
  const dusty = [stats(c[0], cfg).winsTrades, stats(c[1], cfg).winsTrades];
  for (const i of [0, 1] as PlayerIndex[]) {
    const o = other(i);
    if (dusty[i] && dusty[o]) {
      damage[i] = stats(c[i], cfg).tradeTakes ?? 1;
    } else if (dusty[i]) {
      const s = stats(c[i], cfg);
      damage[o] = Math.max(s.tradeDeals ?? s.hit, perfect[i] ? s.perfect : 0);
      damage[i] = s.tradeTakes ?? 1;
    }
  }
  return { kind: 'trade', actor: null, damage, blinded: [false, false], perfect, fake: null, t };
}

// ---------------------------------------------------------------- apply

export interface ApplyEvents {
  willChoice: WillChoice | null;
  dead: [boolean, boolean];
}

/** Apply a finished exchange to the match. `choice` is only used for Will of God. */
export function applyExchange(
  state: MatchState, r: ExchangeResult, choice: WillChoice | null = null, cfg: Config = CONFIG,
): { state: MatchState; events: ApplyEvents } {
  if (!r.outcome) throw new Error('exchange not finished');
  const o = r.outcome;
  // Status effects only ever last the next exchange: start from clean and set fresh ones.
  const players = state.players.map((p, i) => ({
    ...p,
    hearts: r.hearts[i],
    healsLeft: p.healsLeft - (r.healed[i] ? 1 : 0),
    status: { blind: false, smoke: false },
  })) as [PlayerState, PlayerState];

  let willChoice: WillChoice | null = null;
  for (const i of [0, 1] as PlayerIndex[]) {
    players[i].hearts = Math.max(0, players[i].hearts - o.damage[i]);
    if (o.damage[i] > 0 && players[i].character === 'mercy') players[i].charge = 0;
    if (o.blinded[i]) players[i].status.blind = true;
  }
  if (o.kind === 'blind' && o.actor !== null) players[o.actor].charge += 1;
  if (o.kind === 'will' && o.actor !== null) {
    const m = players[o.actor];
    const target = players[other(o.actor)];
    willChoice = choice === 'heal' && !m.fullHealUsed ? 'heal' : 'vaporize';
    if (willChoice === 'heal') { m.hearts = cfg.hearts; m.fullHealUsed = true; } else target.hearts = 0;
    m.charge = 0;
  }

  // Dusty's smoke (his shotgun or his cigar) hangs over the next exchange for his rival.
  for (const i of [0, 1] as PlayerIndex[]) {
    if (players[i].character === 'dusty' && (r.draws[i] || r.cigar[i])) players[other(i)].status.smoke = true;
  }

  const dead: [boolean, boolean] = [players[0].hearts <= 0, players[1].hearts <= 0];
  let winner: MatchState['winner'] = null;
  if (dead[0] && dead[1]) winner = 'draw';
  else if (dead[0]) winner = 1;
  else if (dead[1]) winner = 0;

  return { state: { ...state, players, exchange: state.exchange + 1, winner }, events: { willChoice, dead } };
}
