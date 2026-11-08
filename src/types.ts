// Shared types used across rules, rendering, audio, input and networking.
export type CharacterId = 'hector' | 'dusty' | 'mercy';
export type PlayerIndex = 0 | 1;
/** Which duelist on screen: 'near' is seen from behind, 'far' faces the camera. */
export type ScreenSide = 'near' | 'far';

export type Pose =
  | 'idle' | 'ready' | 'draw' | 'fire' | 'hit' | 'dead' | 'heal'
  | 'feint' | 'win' | 'blinded' | 'flinch' | 'pray' | 'jam';

export type FxKind =
  | 'muzzle' | 'shotgunBlast' | 'smokePuff' | 'dust' | 'hatFly' | 'lanternFlash'
  | 'cigarSmoke' | 'whiskey' | 'vaporize' | 'heal' | 'sparks';

export type FakeKind = 'crow' | 'tumbleweed' | 'door' | 'cough';

export type FilterMode = 'color' | 'noir' | 'onebit' | 'sepia';

export interface PostSettings {
  filter: FilterMode;
  dither: number;        // 0..1 dither strength
  flash: number;         // 0..1 white flash amount (full screen)
  washLeft: number;      // 0..1 white wash on left half (blind)
  washRight: number;     // 0..1 white wash on right half (blind)
  vignette: number;      // 0..1
}

export interface ViewOptions {
  shake: boolean;
  reducedMotion: boolean;
  reduceFlashing: boolean;
}
