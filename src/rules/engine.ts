import type { CharacterId, PlayerIndex } from '../types';
import { CONFIG, type CharacterStats, type Config } from './config';
import { makeRng } from './rng';
import type {
  DrawOutcome, ExchangePlan, ExchangeResult, FakePlan, FeintOutcome, InputEvent,
  MatchState, Outcome, PlayerState, PromptOutcome, WillChoice,
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
    carryFlinches: 0,
    charge: 0,
    fullHealUsed: false,
  };
}

export function newMatch(a: CharacterId, b: CharacterId, cfg: Config = CONFIG): MatchState {
  return { players: [newPlayer(a, cfg), newPlayer(b, cfg)], exchange: 0, smoke: [false, false], winner: null };
}

// ---------------------------------------------------------------- plan

export function generatePlan(seed: number, cfg: Config = CONFIG): ExchangePlan {
  const rng = makeRng(seed);
  const n = cfg.nerve;
  const prompts = [];
  for (let k = 0; k < n.prompts; k++) {
    prompts.push({
      t: cfg.readyMs + n.firstPromptDelayMs + k * n.promptGapMs,
      hold: rng.chance(n.holdChance),
      slots: [rng.int(KEY_SLOTS), rng.int(KEY_SLOTS)] as [number, number],
    });
  }
  const last = prompts[prompts.length - 1];
  const standoffStart = last.t + n.promptWindowMs + 200;
  const s = cfg.standoff;
  const len = Math.round(rng.range(s.minMs, s.maxMs));
  const bellT = standoffStart + len;

  const fakes: FakePlan[] = [];
  const kinds = ['crow', 'tumbleweed', 'door', 'cough'] as const;
  const want = s.minFakes + rng.int(s.maxFakes - s.minFakes + 1);
  const lo = standoffStart + s.fakeEdgeMs;
  const hi = bellT - s.fakeEdgeMs;
  for (let tries = 0; fakes.length < want && tries < 40; tries++) {
    if (hi <= lo) break;
    const t = Math.round(rng.range(lo, hi));
    if (fakes.every((f) => Math.abs(f.t - t) >= s.fakeMinGapMs)) fakes.push({ t, kind: rng.pick(kinds) });
  }
  fakes.sort((a, b) => a.t - b.t);

  return {
    seed,
    prompts,
    standoffStart,
    fakes,
    bellT,
    drawSlots: [rng.int(KEY_SLOTS), rng.int(KEY_SLOTS)],
  };
}

/** Time at which an exchange is guaranteed to be over. */
export function planEnd(plan: ExchangePlan, cfg: Config = CONFIG): number {
  return plan.bellT + cfg.draw.windowMs + cfg.draw.tradeWindowMs + 200;
}

// ---------------------------------------------------------------- small rules

/** Width (ms) of the perfect-draw gold band. */
export function goldBand(flinches: number, lastStand: boolean, cfg: Config = CONFIG): number {
  const d = cfg.draw;
  if (flinches >= d.maxFlinches) return 0;
  const w = d.goldBandMs + (lastStand ? d.lastStandBonusMs : 0) - d.goldShrinkPerFlinchMs * flinches;
  return Math.max(0, w);
}

export function isPerfect(reaction: number, band: number, cfg: Config = CONFIG): boolean {
  if (band <= 0) return false;
  return Math.abs(reaction - cfg.draw.goldCenterMs) <= band / 2;
}

export function canHeal(p: PlayerState, cfg: Config = CONFIG): boolean {
  return p.healsLeft > 0 && p.hearts < cfg.hearts && stats(p.character, cfg).healAmount > 0;
}

export function hasWill(p: PlayerState, cfg: Config = CONFIG): boolean {
  return p.character === 'mercy' && p.charge >= cfg.mercy.chargeForWill;
}

/** Evaluate one player's attempt at one nerve prompt. */
export function evalPrompt(
  events: InputEvent[], start: number, slot: number, hold: boolean, now: number, cfg: Config = CONFIG,
): PromptOutcome {
  const n = cfg.nerve;
  const end = start + n.promptWindowMs;
  const press = events.find((e) => e.kind === 'press' && e.t >= start && e.t < end && e.t <= now);
  if (!press || press.kind !== 'press') {
    if (now >= end) return { status: 'miss', t: end, pressT: null, holding: false };
    return { status: 'pending', t: null, pressT: null, holding: false };
  }
  if (press.slot !== slot) return { status: 'miss', t: press.t, pressT: press.t, holding: false };
  let done = press.t;
  if (hold) {
    done = press.t + n.holdMs;
    const release = events.find((e) => e.kind === 'release' && e.slot === slot && e.t > press.t && e.t <= now);
    if (release && release.t < done) return { status: 'miss', t: release.t, pressT: press.t, holding: false };
    if (now < done) return { status: 'pending', t: null, pressT: press.t, holding: true };
  }
  // Slowness is judged on the press, so hold prompts aren't penalised for holding.
  if (press.t - start > n.slowMs) return { status: 'slow', t: done, pressT: press.t, holding: false };
  return { status: 'ok', t: done, pressT: press.t, holding: false };
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

  const flinches = idx.map((i) => ps[i].carryFlinches + (drunk[i] ? cfg.drunkFlinches : 0)) as [number, number];

  // Nerve phase
  const prompts: [PromptOutcome, PromptOutcome][] = plan.prompts.map((p) => {
    const r = idx.map((i) => evalPrompt(L[i], p.t, p.slots[i], p.hold, now, cfg)) as [PromptOutcome, PromptOutcome];
    // Stare-down race: when both completed correctly, the later one flinches.
    if (r[0].status === 'ok' && r[1].status === 'ok') {
      let loser: PlayerIndex | null = null;
      if (cigar[0] !== cigar[1]) loser = cigar[0] ? 0 : 1; // cigar presses never count as first
      else if (r[0].t! < r[1].t!) loser = 1;
      else if (r[1].t! < r[0].t!) loser = 0;
      if (loser !== null) r[loser] = { ...r[loser], status: 'beaten' };
    }
    // If one is ok and the other still pending, nothing is decided yet for the race.
    return r;
  });
  for (const r of prompts) for (const i of idx) if (r[i].status !== 'ok' && r[i].status !== 'pending') flinches[i]++;

  // Standoff: feints and early draws
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

  const goldBandW = idx.map((i) => goldBand(flinches[i], lastStand[i], cfg)) as [number, number];
  const base: Omit<ExchangeResult, 'done' | 'draws' | 'outcome' | 'jammedUntil'> = {
    healed, hearts, drunk, cigar, will, lastStand, prompts, feints, flinches, goldBand: goldBandW,
  };

  // Early draw: first prompt-key press in the standoff that was not a feint bite.
  let early: { by: PlayerIndex; t: number } | null = null;
  for (const i of idx) {
    const e = L[i].find(
      (ev) => ev.kind === 'press' && ev.t >= plan.standoffStart && ev.t < plan.bellT && ev.t <= now && !consumed.has(ev),
    );
    if (e && (!early || e.t < early.t)) early = { by: i, t: e.t };
  }
  if (early) {
    const fake = [...plan.fakes].reverse().find((f) => f.t <= early!.t && early!.t - f.t < 1500) ?? null;
    const damage: [number, number] = [0, 0];
    damage[early.by] = cfg.earlyDrawHeartLoss;
    return {
      ...base, done: true, draws: [null, null], jammedUntil: [0, 0],
      outcome: { kind: 'early', actor: early.by, damage, blinded: [false, false], perfect: [false, false], fake, t: early.t },
    };
  }

  // Draw phase
  const B = plan.bellT;
  const winEnd = B + cfg.draw.windowMs;
  const jammedUntil: [number, number] = [0, 0];
  const draws = idx.map((i) => {
    let lockedUntil = -Infinity;
    let jams = 0;
    for (const e of L[i]) {
      if (e.kind !== 'press' || e.t < B || e.t >= winEnd || e.t > now) continue;
      if (e.t < lockedUntil) continue;
      if (e.slot !== plan.drawSlots[i]) {
        jams++;
        lockedUntil = e.t + cfg.draw.jamMs;
        jammedUntil[i] = lockedUntil;
        continue;
      }
      const reaction = e.t - B;
      const d: DrawOutcome = {
        pressT: e.t,
        reaction,
        effective: reaction + stats(ps[i].character, cfg).drawDelayMs,
        perfect: isPerfect(reaction, goldBandW[i], cfg),
        jams,
      };
      return d;
    }
    return null;
  }) as [DrawOutcome | null, DrawOutcome | null];

  const pending = (): ExchangeResult => ({ ...base, done: false, draws, jammedUntil, outcome: null });

  if (now < B) return pending();

  const [d0, d1] = draws;
  if (!d0 && !d1) {
    if (now < winEnd) return pending();
    return {
      ...base, done: true, draws, jammedUntil,
      outcome: { kind: 'reset', actor: null, damage: [0, 0], blinded: [false, false], perfect: [false, false], fake: null, t: winEnd },
    };
  }

  // Only one has drawn so far: wait until the other can no longer trade or beat them.
  if (!d0 || !d1) {
    const a: PlayerIndex = d0 ? 0 : 1;
    const da = draws[a]!;
    const b = other(a);
    const lastChance = B + da.effective + cfg.draw.tradeWindowMs - stats(ps[b].character, cfg).drawDelayMs;
    const decideAt = Math.min(Math.max(lastChance, da.pressT), winEnd);
    if (now < decideAt) return pending();
    return { ...base, done: true, draws, jammedUntil, outcome: winDraw(a, draws, ps, will, cfg, Math.max(decideAt, da.pressT)) };
  }

  const tDecided = Math.max(d0.pressT, d1.pressT);
  const diff = d0.effective - d1.effective;
  if (Math.abs(diff) <= cfg.draw.tradeWindowMs) {
    return { ...base, done: true, draws, jammedUntil, outcome: trade(draws as [DrawOutcome, DrawOutcome], ps, will, cfg, tDecided) };
  }
  const a: PlayerIndex = diff < 0 ? 0 : 1;
  return { ...base, done: true, draws, jammedUntil, outcome: winDraw(a, draws, ps, will, cfg, tDecided) };
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
  // The lantern flash lands first in a trade.
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
  state: MatchState, res: ExchangeResult, choice: WillChoice | null = null, cfg: Config = CONFIG,
): { state: MatchState; events: ApplyEvents } {
  if (!res.outcome) throw new Error('exchange not finished');
  const o = res.outcome;
  const players = state.players.map((p, i) => ({
    ...p,
    hearts: res.hearts[i],
    healsLeft: p.healsLeft - (res.healed[i] ? 1 : 0),
    carryFlinches: 0,
  })) as [PlayerState, PlayerState];

  let willChoice: WillChoice | null = null;
  for (const i of [0, 1] as PlayerIndex[]) {
    players[i].hearts = Math.max(0, players[i].hearts - o.damage[i]);
    if (o.damage[i] > 0 && players[i].character === 'mercy') players[i].charge = 0;
    if (o.blinded[i]) players[i].carryFlinches = cfg.blindFlinches;
  }
  if (o.kind === 'blind' && o.actor !== null) players[o.actor].charge += 1;
  if (o.kind === 'will' && o.actor !== null) {
    const m = players[o.actor];
    const target = players[other(o.actor)];
    willChoice = choice === 'heal' && !m.fullHealUsed ? 'heal' : 'vaporize';
    if (willChoice === 'heal') {
      m.hearts = cfg.hearts;
      m.fullHealUsed = true;
    } else {
      target.hearts = 0;
    }
    m.charge = 0;
  }

  // Dusty's smoke hangs over the next exchange whenever he fired.
  const smoke: [boolean, boolean] = [false, false];
  for (const i of [0, 1] as PlayerIndex[]) {
    if (players[i].character === 'dusty' && res.draws[i]) smoke[other(i)] = true;
  }

  const dead: [boolean, boolean] = [players[0].hearts <= 0, players[1].hearts <= 0];
  let winner: MatchState['winner'] = null;
  if (dead[0] && dead[1]) winner = 'draw';
  else if (dead[0]) winner = 1;
  else if (dead[1]) winner = 0;

  return {
    state: { players, exchange: state.exchange + 1, smoke, winner },
    events: { willChoice, dead },
  };
}
