import type { CharacterId } from '../types';

/**
 * Every tunable number in the game. Times are milliseconds.
 * Exchange timeline (relative to exchange start):
 *   ready beat -> 3 nerve prompts -> standoff (fakes, feints) -> bell -> draw window
 */
export const CONFIG = {
  hearts: 3,

  // Ready beat
  readyMs: 2000,

  // Nerve phase
  nerve: {
    prompts: 3,
    firstPromptDelayMs: 350,   // after ready beat ends
    promptGapMs: 1700,         // start-to-start
    promptWindowMs: 1100,      // prompt closes; no completion = flinch
    slowMs: 750,               // completing later than this = flinch (slow press)
    holdChance: 0.3,           // chance a prompt is a "hold" prompt
    holdMs: 550,               // how long a hold prompt must be held
  },

  // Standoff (between nerve phase and the bell)
  standoff: {
    minMs: 1800,
    maxMs: 5200,
    minFakes: 1,
    maxFakes: 3,
    fakeMinGapMs: 700,
    fakeEdgeMs: 450,           // keep fakes away from the standoff edges / bell
  },
  earlyDrawHeartLoss: 1,

  // Draw
  draw: {
    windowMs: 1500,            // nobody presses within this -> reset
    tradeWindowMs: 120,        // both shots within this -> trade
    jamMs: 500,                // wrong key locks the gun
    ringMs: 900,               // closing ring duration (visual)
    goldCenterMs: 380,         // the ring passes the gold band here
    goldBandMs: 170,           // full width of the gold band with 0 flinches
    goldShrinkPerFlinchMs: 50,
    maxFlinches: 3,            // 3 flinches = no gold band
    lastStandBonusMs: 90,      // extra width at 1 heart
  },

  // Feint (Hector and Mercy only)
  feint: {
    perExchange: 1,
    reactWindowMs: 500,
    victimFlinches: 2,
    feinterFlinches: 1,
  },

  // Carry-over flinch penalties
  drunkFlinches: 2,
  blindFlinches: 2,

  // Mercy
  mercy: {
    chargeForWill: 2,
  },

  characters: {
    hector: {
      name: 'Big Hat Hector',
      drawDelayMs: 0,
      hit: 1,
      perfect: 2,
      heals: 2,
      healAmount: 1,
      canFeint: true,
      blinds: false,
      winsTrades: false,
    },
    dusty: {
      name: "Lil' Dusty",
      drawDelayMs: 150,
      hit: 2,
      perfect: 3,
      heals: 2,
      healAmount: 1,
      canFeint: false,
      blinds: false,
      winsTrades: true,
      tradeDeals: 2,
      tradeTakes: 1,
    },
    mercy: {
      name: "Sister Smokin' Mercy",
      drawDelayMs: 0,
      hit: 0,
      perfect: 0,
      heals: 0,
      healAmount: 0,
      canFeint: true,
      blinds: true,
      winsTrades: false,
    },
  } satisfies Record<CharacterId, CharacterStats>,

  cpu: {
    easy:   { reactMean: 430, reactSd: 90, promptMissChance: 0.22, fakeFallChance: 0.22, feintFallChance: 0.6, wrongKeyChance: 0.12, feintChance: 0.2, healThreshold: 1 },
    normal: { reactMean: 330, reactSd: 60, promptMissChance: 0.1,  fakeFallChance: 0.1,  feintFallChance: 0.35, wrongKeyChance: 0.06, feintChance: 0.35, healThreshold: 2 },
    hard:   { reactMean: 255, reactSd: 40, promptMissChance: 0.04, fakeFallChance: 0.035, feintFallChance: 0.15, wrongKeyChance: 0.025, feintChance: 0.5, healThreshold: 2 },
  },
  cpuMinReactMs: 150,
  cpuWillFocusMs: 35,          // CPU Mercy reacts faster when Will of God is up

  // Presentation (not rules, but tunable)
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
