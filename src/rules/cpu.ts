import type { PlayerIndex } from '../types';
import { CONFIG, type Config, type Difficulty } from './config';
import { canHeal, goldBand, hasWill } from './engine';
import type { ExchangePlan, InputEvent, MatchState } from './model';
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

/**
 * Plan the CPU's whole exchange up front: heals, nerve presses, falling for fakes,
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
  if (heal) ev.push({ t: Math.round(rng.range(300, cfg.readyMs - 300)), kind: 'heal' });

  let flinches = p.carryFlinches + (heal && p.character === 'hector' ? cfg.drunkFlinches : 0);
  for (const pr of plan.prompts) {
    const slot = pr.slots[me];
    const r = react(rng, d.reactMean, d.reactSd, cfg);
    if (rng.chance(d.promptMissChance)) {
      flinches++;
      if (rng.chance(0.5)) {
        const t = pr.t + r;
        ev.push({ t, kind: 'press', slot: wrongSlot(rng, slot) }, { t: t + 90, kind: 'release', slot: wrongSlot(rng, slot) });
      }
      continue;
    }
    const t = pr.t + r;
    ev.push({ t, kind: 'press', slot });
    ev.push({ t: t + (pr.hold ? cfg.nerve.holdMs + 60 + rng.range(0, 120) : 90), kind: 'release', slot });
  }

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
      if (t < plan.bellT) {
        ev.push({ t, kind: 'press', slot: rng.int(KEY_SLOTS) });
        break;
      }
    }
  }

  // Draw
  const B = plan.bellT;
  const right = plan.drawSlots[me];
  let r = react(rng, d.reactMean - focus, d.reactSd, cfg);
  // Hard CPUs sometimes aim for the gold band instead of pure speed.
  const band = goldBand(Math.min(flinches, cfg.draw.maxFlinches), p.hearts === 1, cfg);
  if (diff === 'hard' && band > 0 && rng.chance(0.45)) r = Math.max(cfg.cpuMinReactMs, rng.normal(cfg.draw.goldCenterMs, 25));
  if (rng.chance(d.wrongKeyChance)) {
    const tw = B + r * 0.8;
    ev.push({ t: tw, kind: 'press', slot: wrongSlot(rng, right) });
    r = r * 0.8 + cfg.draw.jamMs + react(rng, d.reactMean * 0.5, d.reactSd / 2, cfg);
  }
  ev.push({ t: B + r, kind: 'press', slot: right }, { t: B + r + 120, kind: 'release', slot: right });
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
