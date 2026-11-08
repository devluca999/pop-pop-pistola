import type { Stage } from '../render';
import type { AudioEngine } from '../audio';
import type { Input } from '../input';
import type { Settings } from '../settings';

/** Everything a screen needs. */
export interface AppCtx {
  stage: Stage;
  audio: AudioEngine;
  input: Input;
  settings: Settings;
  ui: HTMLElement;
  saveSettings(): void;
  applySettings(): void;
  /** Phones: first tap on the title (go fullscreen in a browser tab). */
  onFirstTap?(): void;
}
