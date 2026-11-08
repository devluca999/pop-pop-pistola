import type { PlayerIndex } from '../types';
import { CONFIG, BTN, BUTTONS, type Button, type Config, type CpuProfile, type Difficulty } from './config';
import { canHeal, drawWindow, hasWill } from './engine';
import type { ExchangePlan, InputEvent, MatchState, PromptPlan } from './model';
import type { Rng } from './rng';

/**
 * The CPU is a simulated human. It only uses what a player can see: it reacts a human
 * reaction time after a prompt or cue appears, aims at arcs/rings with an aim error,
 * and sometimes misses or falls for fakes. It never times anything off hidden state.
 */

const profileOf = (p: Difficulty | CpuProfile, cfg: Config): CpuProfile => (typeof p === 'string' ? cfg.cpu[p] : p);

function react(rng: Rng, mean: number, sd: number, cfg: Config) {
  return Math.max(cfg.cpuMinReactMs, rng.normal(mean, sd));
}

function wrongButton(rng: Rng, right: Button): Button {
  const others = BUTTONS.filter((b) => b !== right);
  return rng.pick(others);
}

/** Should the CPU heal this exchange? */
export function cpuWantsHeal(state: MatchState, me: PlayerIndex, diff: Difficulty | CpuProfile, rng: Rng, cfg: Config = CONFIG): boolean {
  const p = state.players[me];
  if (!canHeal(p, cfg)) return false;
  const th = profileOf(diff, cfg).healThreshold;
  if (p.hearts <= 1) return true;
  if (p.hearts <= th) return rng.chance(th <= 1 ? 0.3 : 0.55);
  return false;
}

const tap = (ev: InputEvent[], t: number, b: Button, hold = 90) => {
  ev.push({ t, kind: 'press', slot: b }, { t: t + hold, kind: 'release', slot: b });
};

/** One nerve prompt. Returns true if the CPU flubbed it. */
function cpuPrompt(ev: InputEvent[], p: PromptPlan, d: CpuProfile, rng: Rng, cfg: Config): boolean {
  const n = cfg.nerve;
  const k = p.keys;
  const r = react(rng, d.reactMean, d.reactSd, cfg);
  if (p.type === 'steady') {
    // the trap: sometimes the CPU can't sit still
    if (rng.chance(d.promptMissChance * 1.5)) { tap(ev, p.t + r, rng.pick(BUTTONS)); return true; }
    return false;
  }
  if (rng.chance(d.promptMissChance)) {
    if (rng.chance(0.5)) tap(ev, p.t + r, wrongButton(rng, k[0]));
    return true;
  }
  switch (p.type) {
    case 'tap': tap(ev, p.t + r, k[0]); break;
    case 'hold': tap(ev, p.t + r, k[0], n.holdMs + 60 + rng.range(0, 120)); break;
    case 'mash': {
      let t = p.t + r;
      for (let j = 0; j < n.mashCount; j++) { tap(ev, t, k[0], 40); t += Math.max(70, rng.normal(d.tapGap, d.tapGap * 0.15)); }
      break;
    }
    case 'time': {
      // watches the needle and presses as it reaches the arc
      const t = p.t + p.arcMs! + rng.normal(0, d.aimSd);
      tap(ev, Math.max(p.t + cfg.cpuMinReactMs, t), k[0]);
      break;
    }
    case 'release': {
      const press = p.t + Math.min(r, n.releasePressMs - 60);
      // lets go a reaction time after it sees LET GO
      const rel = p.t + (p.cueMs ?? n.releaseCueMin) + react(rng, d.reactMean, d.reactSd, cfg);
      ev.push({ t: press, kind: 'press', slot: k[0] }, { t: Math.max(press + 50, rel), kind: 'release', slot: k[0] });
      break;
    }
    case 'order': {
      let t = p.t + r;
      for (const s of k) { tap(ev, t, s, 50); t += Math.max(110, rng.normal(d.tapGap * 1.6, 30)); }
      break;
    }
  }
  return false;
}

/**
 * Plan the CPU's whole exchange: heal, nerve prompts, falling for fakes, an optional
 * feint, and the draw. Every press is a reaction to something already on screen.
 * Reacting to the opponent's feint is separate (cpuFeintReaction): it depends on the human.
 */
export function cpuExchangeLog(
  plan: ExchangePlan, state: MatchState, me: PlayerIndex, diff: Difficulty | CpuProfile, rng: Rng, cfg: Config = CONFIG,
): InputEvent[] {
  const d = profileOf(diff, cfg);
  const p = state.players[me];
  const ch = cfg.characters[p.character];
  const will = hasWill(p, cfg);
  const focus = will ? cfg.cpuWillFocusMs : 0;
  const ev: InputEvent[] = [];

  // READY: hold DOWN for the heal
  const heal = cpuWantsHeal(state, me, d, rng, cfg);
  if (heal) {
    const t = Math.min(react(rng, d.reactMean, d.reactSd, cfg), cfg.readyMs - cfg.heal.holdMs - 80);
    ev.push({ t, kind: 'press', slot: BTN.down }, { t: t + cfg.heal.holdMs + rng.range(40, 120), kind: 'release', slot: BTN.down });
  }

  let flinches = (p.status.blind ? cfg.blindFlinches : 0) + (heal && p.character === 'hector' ? cfg.drunkFlinches : 0);
  for (const pr of plan.prompts) if (cpuPrompt(ev, pr, d, rng, cfg)) flinches++;

  // STANDOFF: maybe feint (UP), maybe fall for a fake (ACTION too early)
  if (ch.canFeint && rng.chance(d.feintChance)) {
    const lo = plan.announceEnd + 200;
    const hi = plan.bellT - cfg.feint.reactWindowMs - 100;
    if (hi > lo) tap(ev, Math.round(rng.range(lo, hi)), BTN.up, 80);
  }
  const fall = will ? d.fakeFallChance / 2 : d.fakeFallChance;
  for (const f of plan.fakes) {
    if (rng.chance(fall)) {
      const t = f.t + react(rng, d.reactMean * 0.9, d.reactSd, cfg);
      if (t < plan.bellT) { tap(ev, t, BTN.action, 60); break; }
    }
  }

  // DRAW: ACTION
  const B = plan.bellT;
  const dr = cfg.draw;
  const win = drawWindow(plan.drawType, flinches, p.hearts === 1, cfg);
  if (plan.drawType === 'wheel') {
    // reads the wheel, then waits for the needle to reach the arc it can see
    const P = dr.wheelPeriodMs;
    const firstAt = (((plan.wheel.arc - plan.wheel.start) % P) + P) % P;
    let target = B + firstAt;
    while (target < B + react(rng, d.reactMean, d.reactSd, cfg) + 120) target += P;
    tap(ev, target + rng.normal(0, d.aimSd * (will ? 0.7 : 1)), BTN.action, 60);
  } else if (plan.drawType === 'speed') {
    let t = B + react(rng, d.reactMean - focus, d.reactSd, cfg);
    for (let j = 0; j < dr.speedCount; j++) { tap(ev, t, BTN.action, 40); t += Math.max(65, rng.normal(d.tapGap, d.tapGap * 0.12)); }
  } else {
    let r = react(rng, d.reactMean - focus, d.reactSd, cfg);
    // skilled CPUs sometimes wait for the gold band instead of pure speed
    if (d.reactMean < 260 && win.perfect > 0 && rng.chance(0.45)) r = Math.max(cfg.cpuMinReactMs, rng.normal(dr.goldCenterMs, d.aimSd * 0.6));
    tap(ev, B + r, BTN.action, 120);
  }
  return ev.sort((a, b) => a.t - b.t);
}

/** When the opponent feints: ms until the CPU flinches at it, or null if it keeps its nerve. */
export function cpuFeintReaction(diff: Difficulty | CpuProfile, rng: Rng, cfg: Config = CONFIG): number | null {
  const d = profileOf(diff, cfg);
  if (!rng.chance(d.feintFallChance)) return null;
  return Math.min(cfg.feint.reactWindowMs - 40, react(rng, d.reactMean * 0.8, d.reactSd, cfg));
}

/** Will of God choice: vaporize ends the match, so a CPU always takes it. */
export function cpuWillChoice(): 'vaporize' {
  return 'vaporize';
}
