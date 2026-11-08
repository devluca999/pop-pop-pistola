import type { CharacterId } from '../types';

export type PromptType = 'tap' | 'hold' | 'mash' | 'time' | 'release' | 'order' | 'steady';
export type DrawType = 'ring' | 'wheel' | 'speed';

/**
 * Every tunable number in the game. Times are milliseconds.
 * Exchange timeline (relative to exchange start), about 12s:
 *   ready beat -> 3 x (mini countdown + nerve prompt) -> draw countdown (type revealed)
 *   -> wait (fakes, feints) -> bell -> draw window
 */
export const CONFIG = {
  hearts: 3,

  // Ready beat (heals)
  readyMs: 1500,

  // Nerve phase
  nerve: {
    prompts: 3,
    countdownMs: 600,          // quick 3-2-1 before each prompt
    demoMs: 1000,              // extra time the first time a type appears in a match
    gapMs: 150,                // after a prompt window closes
    slowMs: 750,               // tap/hold: pressing later than this = flinch
    holdMs: 550,
    mashCount: 4,
    orderLength: 3,
    // TIME IT: a needle sweeps once over the window; press inside the arc
    timeSweepMs: 1100,
    timeArcHalfMs: 140,
    timeArcCenterMin: 380,
    timeArcCenterMax: 820,
    // RELEASE: press and keep holding, then let go when the tile says RELEASE
    releasePressMs: 700,       // must be pressed within this
    releaseCueMin: 750,
    releaseCueMax: 1050,
    releaseWindowMs: 420,      // let go within this after the cue
    windowMs: { tap: 1100, hold: 1300, mash: 1400, time: 1200, release: 1550, order: 1500, steady: 1000 } as Record<PromptType, number>,
    weights: { tap: 3, hold: 2, mash: 1.5, time: 1.5, release: 1, order: 1.2, steady: 0.8 } as Record<PromptType, number>,
  },

  // Draw countdown + wait (standoff)
  standoff: {
    countdownMs: 1200,         // full 3-2-1 with ticks; draw type shown
    demoMs: 1000,              // first time a draw type appears
    minWaitMs: 700,
    maxWaitMs: 2600,
    minFakes: 1,
    maxFakes: 3,
    fakeMinGapMs: 600,
    fakeEdgeMs: 300,           // keep fakes away from the countdown end / bell
  },
  earlyDrawHeartLoss: 1,

  // Draw
  draw: {
    weights: { ring: 1, wheel: 1, speed: 1 } as Record<DrawType, number>,
    windowMs: { ring: 1500, wheel: 1800, speed: 1800 } as Record<DrawType, number>,
    tradeWindowMs: 120,        // both completions within this -> trade
    jamMs: 500,                // wrong key / missed wheel press locks the gun
    maxFlinches: 3,            // 3 flinches = no perfect possible
    // RING: closing ring passes the gold band
    ringMs: 900,
    goldCenterMs: 380,
    goldBandMs: 170,
    goldShrinkPerFlinchMs: 50,
    lastStandBonusMs: 90,
    // WHEEL: needle sweeps; press ACTION inside the arc, perfect in the thin slice
    wheelPeriodMs: 900,
    wheelArcCenterMin: 300,
    wheelArcCenterMax: 650,
    wheelArcHalfMs: 150,
    wheelArcShrinkPerFlinchMs: 30,
    wheelArcMinHalfMs: 55,
    wheelPerfectHalfMs: 30,
    wheelPerfectShrinkPerFlinchMs: 10,
    wheelLastStandBonusMs: 25,
    // SPEED TAP: hit your key N times; first to finish shoots
    speedCount: 5,
    speedPerfectSpanMs: 520,   // all N hits within this = perfect
    speedShrinkPerFlinchMs: 110,
    speedLastStandBonusMs: 120,
  },

  // Feint (Hector and Mercy only)
  feint: {
    perExchange: 1,
    reactWindowMs: 500,
    victimFlinches: 2,
    feinterFlinches: 1,
  },

  // Status effects: one exchange only, never stack
  drunkFlinches: 2,
  blindFlinches: 2,

  mercy: { chargeForWill: 2 },

  /**
   * Look-alike key labels. An exchange never shows two different keys from the same group,
   * across both players, so U/V/W, I/L/1, O/Q/0 etc. can't be confused.
   */
  confusables: [
    ['U', 'V', 'W', 'Y'],
    ['I', 'L', '1', 'J', '!', '|', '/', '\\'],
    ['O', 'Q', '0', 'D', 'C', 'G'],
    ['M', 'N', 'H'],
    ['E', 'F', 'P', 'R', 'B', '8'],
    ['S', '5', 'Z', '2'],
    ['6', '9'],
    [',', '.', ';', ':', "'", '`'],
    ['[', ']'],
    ['-', '='],
    ['K', 'X'],
  ] as string[][],

  characters: {
    hector: { name: 'Big Hat Hector', drawDelayMs: 0, hit: 1, perfect: 2, heals: 2, healAmount: 1, canFeint: true, blinds: false, winsTrades: false },
    dusty: { name: "Lil' Dusty", drawDelayMs: 150, hit: 2, perfect: 3, heals: 2, healAmount: 1, canFeint: false, blinds: false, winsTrades: true, tradeDeals: 2, tradeTakes: 1 },
    mercy: { name: "Sister Smokin' Mercy", drawDelayMs: 0, hit: 0, perfect: 0, heals: 0, healAmount: 0, canFeint: true, blinds: true, winsTrades: false },
  } satisfies Record<CharacterId, CharacterStats>,

  cpu: {
    easy:   { reactMean: 430, reactSd: 90, promptMissChance: 0.2,  fakeFallChance: 0.22,  feintFallChance: 0.6,  wrongKeyChance: 0.12,  feintChance: 0.2,  healThreshold: 1, aimSd: 120, tapGap: 150 },
    normal: { reactMean: 330, reactSd: 60, promptMissChance: 0.1,  fakeFallChance: 0.1,   feintFallChance: 0.35, wrongKeyChance: 0.06,  feintChance: 0.35, healThreshold: 2, aimSd: 70,  tapGap: 115 },
    hard:   { reactMean: 255, reactSd: 40, promptMissChance: 0.04, fakeFallChance: 0.035, feintFallChance: 0.15, wrongKeyChance: 0.025, feintChance: 0.5,  healThreshold: 2, aimSd: 40,  tapGap: 90 },
  },
  cpuMinReactMs: 150,
  cpuWillFocusMs: 35,

  // Presentation
  aftermathMs: 2600,
  resetMessageMs: 1600,
};

export interface CharacterStats {
  name: string;
  drawDelayMs: number;
  hit: number;
  perfect: number;
  heals: number;
  healAmount: number;
  canFeint: boolean;
  blinds: boolean;
  winsTrades: boolean;
  tradeDeals?: number;
  tradeTakes?: number;
}

export type Config = typeof CONFIG;
export type Difficulty = keyof Config['cpu'];

export const PROMPT_VERB: Record<PromptType, string> = {
  tap: 'TAP', hold: 'HOLD', mash: 'MASH', time: 'TIME IT', release: 'RELEASE', order: 'IN ORDER', steady: 'STEADY',
};
export const DRAW_LABEL: Record<DrawType, string> = { ring: 'RING', wheel: 'WHEEL', speed: 'SPEED TAP' };
