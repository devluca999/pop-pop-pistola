import type { CharacterId } from '../types';

export type SfxName =
  | 'bellToll' | 'gunshot' | 'shotgun' | 'click' | 'jam' | 'crow' | 'tumbleweed' | 'door' | 'cough'
  | 'spurs' | 'glassClink' | 'cigarPuff' | 'lanternWhoosh' | 'choir' | 'boo' | 'cheer' | 'heartCrack'
  | 'hit' | 'fall' | 'hatFly' | 'promptGood' | 'promptBad' | 'flinch' | 'perfect' | 'uiMove'
  | 'uiSelect' | 'uiBack' | 'pop' | 'fuego' | 'feint' | 'blind' | 'vaporize' | 'heal'
  | 'tapTick' | 'holdRise' | 'mashClick' | 'timeTick' | 'wheelTick' | 'releasePop' | 'orderBlip'
  | 'steadyHum' | 'countTick' | 'countGo'
  // map fakes
  | 'flicker' | 'whistle' | 'hawk' | 'glass';

export type MusicTrack = 'title' | 'duel' | 'win' | 'lose' | 'none';

export type VoiceMood = 'mutter' | 'hit' | 'gloat' | 'taunt' | 'hum' | 'drink' | 'death';

export interface SfxOptions { pan?: number; gain?: number; rate?: number }

export interface Volumes { master: number; music: number; sfx: number; voice: number }

export interface AudioEngine {
  /** Must be called from a user gesture; safe to call many times. */
  unlock(): void;
  sfx(name: SfxName, opts?: SfxOptions): void;
  drumroll(durationMs: number): void;
  voice(ch: CharacterId, mood: VoiceMood, opts?: { pan?: number }): void;
  music(track: MusicTrack): void;
  wind(on: boolean): void;
  heartbeat(on: boolean, bpm?: number): void;
  setVolumes(v: Volumes): void;
  duck(amount: number, ms: number): void;
}
