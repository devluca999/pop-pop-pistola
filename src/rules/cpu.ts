import type { PlayerIndex } from '../types';
import { CONFIG, type Config, type Difficulty } from './config';
import { canHeal, drawWindow, hasWill } from './engine';
import type { ExchangePlan, InputEvent, MatchState, PromptPlan } from './model';
import { KEY_SLOTS } from './model';
import type { Rng } from './rng';

function react(rng: Rng, mean: number, sd: number, cfg: Config) {
  return Math.max(cfg.cpuMinReactMs, rng.normal(mean, sd));
}

function wrongSlot(rng: Rng, right: number) {
  return (right + 1 + rng.int(KEY_SLOTS - 1)) % KEY_SLOTS;
}

/** Should the CPU heal this exchange? */
export function cpuWantsHeal(state: MatchState, me: PlayerIndex, diff: Difficulty, rng: Rng, cfg: Config = CONFIG): boolean {
  const p = state.players[me];
  if (!canHeal(p, cfg)) return false;
  const th = cfg.cpu[diff].healThreshold;
  if (p.hearts <= 1) return true;
  if (p.hearts <= th) return rng.chance(diff === 'easy' ? 0.3 : 0.55);
  return false;
}

const tap = (ev: InputEvent[], t: number, slot: number, hold = 90) => {
  ev.push({ t, kind: 'press', slot }, { t: t + hold, kind: 'release', slot });
};

/** One nerve prompt. Returns true if the CPU deliberately flubbed it. */
function cpuPrompt(ev: InputEvent[], p: PromptPlan, me: PlayerIndex, diff: Difficulty, rng: Rng, cfg: Config): boolean {
  const d = cfg.cpu[diff];
  const n = cfg.nerve;
  const k = p.keys[me];
  const r = react(rng, d.reactMean, d.reactSd, cfg);
  if (p.type === 'steady') {
    // the trap: sometimes the CPU can't sit still
    if (rng.chance(d.promptMissChance * 1.5)) { tap(ev, p.t + r, rng.int(KEY_SLOTS)); return true; }
    return false;
  }
  if (rng.chance(d.promptMissChance)) {
    if (rng.chance(0.5)) tap(ev, p.t + r, wrongSlot(rng, k[0]));
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
      const t = p.t + p.arcMs![me] + rng.normal(0, d.aimSd);
      tap(ev, Math.max(p.t + cfg.cpuMinReactMs, t), k[0]);
      break;
    }
    case 'release': {
      const press = p.t + Math.min(r, n.releasePressMs - 60);
      const rel = p.t + (p.cueMs ?? n.releaseCueMin) + react(rng, d.reactMean * 0.8, d.reactSd, cfg) * 0.8;
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
 * Plan the CPU's whole exchange up front: heals, nerve prompts, falling for fakes,
 * an optional feint, and the draw. Reacting to the opponent's feint is separate
 * (see cpuFeintReaction) because it depends on what the human does.
 */
export function cpuExchangeLog(
  plan: ExchangePlan, state: MatchState, me: PlayerIndex, diff: Difficulty, rng: Rng, cfg: Config = CONFIG,
): InputEvent[] {
  const d = cfg.cpu[diff];
  const p = state.players[me];
  const ch = cfg.characters[p.character];
  const will = hasWill(p, cfg);
  const focus = will ? cfg.cpuWillFocusMs : 0;
  const ev: InputEvent[] = [];

  const heal = cpuWantsHeal(state, me, diff, rng, cfg);
  if (heal) ev.push({ t: Math.round(rng.range(250, cfg.readyMs - 250)), kind: 'heal' });

  let flinches = (p.status.blind ? cfg.blindFlinches : 0) + (heal && p.character === 'hector' ? cfg.drunkFlinches : 0);
  for (const pr of plan.prompts) if (cpuPrompt(ev, pr, me, diff, rng, cfg)) flinches++;

  // Standoff: maybe feint, maybe fall for a fake.
  if (ch.canFeint && rng.chance(d.feintChance)) {
    const lo = plan.standoffStart + 300;
    const hi = plan.bellT - cfg.feint.reactWindowMs - 100;
    if (hi > lo) ev.push({ t: Math.round(rng.range(lo, hi)), kind: 'feint' });
  }
  const fall = will ? d.fakeFallChance / 2 : d.fakeFallChance;
  for (const f of plan.fakes) {
    if (rng.chance(fall)) {
      const t = f.t + react(rng, d.reactMean * 0.9, d.reactSd, cfg);
      if (t < plan.bellT) { ev.push({ t, kind: 'press', slot: rng.int(KEY_SLOTS) }); break; }
    }
  }

  // Draw
  const B = plan.bellT;
  const dr = cfg.draw;
  const win = drawWindow(plan.drawType, flinches, p.hearts === 1, cfg);
  if (plan.drawType === 'wheel') {
    // aim for the arc on the first sweep; a miss jams, then try the next sweep
    let t = B + plan.wheelArc[me] - focus + rng.normal(0, d.aimSd * 0.8);
    if (t < B + cfg.cpuMinReactMs) t += dr.wheelPeriodMs;
    ev.push({ t, kind: 'action' });
    ev.push({ t: t + dr.wheelPeriodMs + rng.normal(0, d.aimSd * 0.6), kind: 'action' });
  } else if (plan.drawType === 'speed') {
    const right = plan.drawSlots[me];
    let t = B + react(rng, d.reactMean - focus, d.reactSd, cfg);
    if (rng.chance(d.wrongKeyChance)) { tap(ev, t, wrongSlot(rng, right), 40); t += dr.jamMs + 40; }
    for (let j = 0; j < dr.speedCount; j++) { tap(ev, t, right, 40); t += Math.max(65, rng.normal(d.tapGap, d.tapGap * 0.12)); }
  } else {
    const right = plan.drawSlots[me];
    let r = react(rng, d.reactMean - focus, d.reactSd, cfg);
    // Hard CPUs sometimes aim for the gold band instead of pure speed.
    if (diff === 'hard' && win.perfect > 0 && rng.chance(0.45)) r = Math.max(cfg.cpuMinReactMs, rng.normal(dr.goldCenterMs, 25));
    if (rng.chance(d.wrongKeyChance)) {
      tap(ev, B + r * 0.8, wrongSlot(rng, right));
      r = r * 0.8 + dr.jamMs + react(rng, d.reactMean * 0.5, d.reactSd / 2, cfg);
    }
    tap(ev, B + r, right, 120);
  }
  return ev.sort((a, b) => a.t - b.t);
}

/** When the opponent feints: ms until the CPU flinches at it, or null if it keeps its nerve. */
export function cpuFeintReaction(diff: Difficulty, rng: Rng, cfg: Config = CONFIG): number | null {
  const d = cfg.cpu[diff];
  if (!rng.chance(d.feintFallChance)) return null;
  return Math.min(cfg.feint.reactWindowMs - 40, react(rng, d.reactMean * 0.8, d.reactSd, cfg));
}

/** Will of God choice: vaporize ends the match, so a CPU always takes it. */
export function cpuWillChoice(): 'vaporize' {
  return 'vaporize';
}
