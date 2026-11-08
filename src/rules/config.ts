import type { CharacterId } from '../types';

export type PromptType = 'tap' | 'hold' | 'mash' | 'time' | 'release' | 'order' | 'steady';
export type DrawType = 'ring' | 'wheel' | 'speed';

/**
 * The only inputs in the game: four directions and one action button.
 * Keyboard: WASD/arrows + Space/Enter. Pad: d-pad/stick + A (RT shoots on draws). Touch: swipes + taps.
 */
export const BTN = { up: 0, down: 1, left: 2, right: 3, action: 4 } as const;
export type Button = (typeof BTN)[keyof typeof BTN];
export const BUTTONS: Button[] = [0, 1, 2, 3, 4];
export const DIRECTIONS: Button[] = [0, 1, 2, 3];

/**
 * Every tunable number in the game. Times are milliseconds.
 * Every exchange has the same beats (shown in the step strip):
 *   READY (heal window) -> NERVE (3 prompts, quick 3-2-1 before each)
 *   -> STANDOFF (draw type announced, random wait, fakes, feints) -> BELL + DRAW -> RESULT
 */
export const CONFIG = {
  hearts: 3,

  // READY: heal by holding DOWN
  readyMs: 2000,
  heal: {
    holdMs: 1000,              // hold DOWN this long, finishing inside READY
  },

  // NERVE
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
    // RELEASE: press and keep holding, then let go when the tile says LET GO
    releasePressMs: 700,
    releaseCueMin: 750,
    releaseCueMax: 1050,
    releaseWindowMs: 420,
    windowMs: { tap: 1100, hold: 1300, mash: 1400, time: 1200, release: 1550, order: 1500, steady: 1000 } as Record<PromptType, number>,
    weights: { tap: 3, hold: 2, mash: 1.5, time: 1.5, release: 1, order: 1.2, steady: 0.8 } as Record<PromptType, number>,
  },

  // STANDOFF: the draw type is announced, then a random wait until the bell
  standoff: {
    announceMs: 900,           // big draw-type label
    demoMs: 1000,              // first time a draw type appears
    minMs: 1500,               // whole standoff (announce included), random in [min, max]
    maxMs: 4000,
    minFakes: 1,
    maxFakes: 3,
    fakeMinGapMs: 600,
    fakeEdgeMs: 300,           // keep fakes away from the announcement and the bell
  },
  earlyDrawHeartLoss: 1,

  // DRAW (always the ACTION button)
  draw: {
    weights: { ring: 1, wheel: 1, speed: 1 } as Record<DrawType, number>,
    windowMs: { ring: 1500, wheel: 1800, speed: 1800 } as Record<DrawType, number>,
    tradeWindowMs: 120,        // RING / SPEED: both within this -> trade
    maxFlinches: 3,            // 3 flinches = no perfect possible
    // RING: closing ring passes the gold band
    ringMs: 900,
    goldCenterMs: 380,
    goldBandMs: 170,
    goldShrinkPerFlinchMs: 50,
    lastStandBonusMs: 90,
    // WHEEL: accuracy, not speed. One shot each; inside the arc beats outside,
    // both inside: closer to the perfect-slice centre wins, within wheelTradeMs = trade.
    wheelPeriodMs: 900,
    wheelArcCenterMin: 300,
    wheelArcCenterMax: 650,
    wheelArcHalfMs: 150,
    wheelArcShrinkPerFlinchMs: 30,
    wheelArcMinHalfMs: 55,
    wheelPerfectHalfMs: 30,
    wheelPerfectShrinkPerFlinchMs: 10,
    wheelLastStandBonusMs: 25,
    wheelTradeMs: 15,
    // SPEED TAP: hit ACTION N times; first to finish shoots
    speedCount: 5,
    speedPerfectSpanMs: 520,   // all N hits within this = perfect
    speedShrinkPerFlinchMs: 110,
    speedLastStandBonusMs: 120,
  },

  // Feint: tap UP during the standoff (Hector and Mercy only)
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

  characters: {
    hector: { name: 'Big Hat Hector', drawDelayMs: 0, hit: 1, perfect: 2, heals: 2, healAmount: 1, canFeint: true, blinds: false, winsTrades: false },
    dusty: { name: "Lil' Dusty", drawDelayMs: 150, hit: 2, perfect: 3, heals: 2, healAmount: 1, canFeint: false, blinds: false, winsTrades: true, tradeDeals: 2, tradeTakes: 1 },
    mercy: { name: "Sister Smokin' Mercy", drawDelayMs: 0, hit: 0, perfect: 0, heals: 0, healAmount: 0, canFeint: true, blinds: true, winsTrades: false },
  } satisfies Record<CharacterId, CharacterStats>,

  /**
   * CPU = a simulated human. It only uses what's on screen: it reacts after a prompt appears,
   * aims at the arc/ring it can see with an aim error, and sometimes misses or falls for fakes.
   */
  cpu: {
    easy:   { reactMean: 380, reactSd: 90, promptMissChance: 0.2,  fakeFallChance: 0.22,  feintFallChance: 0.6,  feintChance: 0.2,  healThreshold: 1, aimSd: 110, tapGap: 150 },
    normal: { reactMean: 290, reactSd: 70, promptMissChance: 0.1,  fakeFallChance: 0.1,   feintFallChance: 0.35, feintChance: 0.35, healThreshold: 2, aimSd: 65,  tapGap: 115 },
    hard:   { reactMean: 230, reactSd: 50, promptMissChance: 0.04, fakeFallChance: 0.035, feintFallChance: 0.15, feintChance: 0.5,  healThreshold: 2, aimSd: 40,  tapGap: 90 },
  } satisfies Record<string, CpuProfile>,
  cpuMinReactMs: 180,
  cpuWillFocusMs: 35,

  // Presentation
  aftermathMs: 1500,           // RESULT beat: freeze, damage
  resetMessageMs: 1500,
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

/** How a simulated player behaves (CPU difficulties, and bots in tests). */
export interface CpuProfile {
  reactMean: number;
  reactSd: number;
  promptMissChance: number;
  fakeFallChance: number;
  feintFallChance: number;
  feintChance: number;
  healThreshold: number;
  aimSd: number;
  tapGap: number;
}

export type Config = typeof CONFIG;
export type Difficulty = keyof Config['cpu'];

export const PROMPT_VERB: Record<PromptType, string> = {
  tap: 'TAP', hold: 'HOLD', mash: 'MASH', time: 'TIME IT', release: 'RELEASE', order: 'SEQUENCE', steady: 'STEADY',
};
export const DRAW_LABEL: Record<DrawType, string> = { ring: 'RING', wheel: 'WHEEL', speed: 'SPEED TAP' };
