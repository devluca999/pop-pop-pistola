import type { PlayerIndex } from '../types';
import type { Settings } from '../settings';
import { BTN, type Button } from '../rules/config';

/** A game button going down or up. Only four directions and ACTION exist. */
export type GameInput = { player: PlayerIndex; kind: 'press' | 'release'; slot: Button; t: number; pad: boolean };

export type MenuInput = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

type Listener<T> = (e: T) => void;

/**
 * Gamepad layout (standard mapping), fixed: d-pad or left stick = directions, A = ACTION,
 * RT = ACTION (shoot), and X / Y / B double as left / up / right.
 */
export const PAD_MAP: Record<number, Button> = {
  12: BTN.up, 13: BTN.down, 14: BTN.left, 15: BTN.right,
  0: BTN.action, 7: BTN.action,
  2: BTN.left, 3: BTN.up, 1: BTN.right,
};
const STICK = 0.55;

/**
 * Keyboard + Gamepad API. Emits game events (by player, with high-res timestamps)
 * and generic menu navigation. P1 = WASD + Space, P2 = arrows + Enter (or Right Shift).
 * Playing alone (CPU / online), both sets drive you.
 */
export class Input {
  private gameL: Listener<GameInput>[] = [];
  private menuL: Listener<MenuInput>[] = [];
  private rawL: Listener<KeyboardEvent>[] = [];
  private padRawL: Listener<{ pad: number; button: number }>[] = [];
  private padBtnL: Listener<{ pad: number; button: number }>[] = [];
  private padPrev: boolean[][] = [];
  private padAxisPrev: string[] = [];
  /** Per pad: how many physical sources hold each logical button down. */
  private padHeld: number[][] = [];
  private held = new Set<string>();
  /** When false, both keyboard sets drive `soloPlayer` (CPU/online). */
  twoPlayers = true;
  /** Online/CPU: the human plays as this player index. */
  soloPlayer: PlayerIndex = 0;
  /**
   * Which player each gamepad belongs to (index = pad slot). null = by order (pad 1 → P1,
   * the rest → P2). Set by the controller screen; a pad missing from the list drives no one.
   */
  padPlayers: (PlayerIndex | null)[] | null = null;
  /**
   * True while a duel is live. Pad face buttons are then game buttons only (B is RIGHT,
   * not "back"); START or SELECT pauses.
   */
  padGameMode = false;

  constructor(private settings: () => Settings) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.releaseAll());
  }

  onGame(f: Listener<GameInput>) { this.gameL.push(f); return () => { this.gameL = this.gameL.filter((x) => x !== f); }; }
  onMenu(f: Listener<MenuInput>) { this.menuL.push(f); return () => { this.menuL = this.menuL.filter((x) => x !== f); }; }
  /** Raw key capture (rebinding UI). Return value of listener ignored. */
  onRawKey(f: Listener<KeyboardEvent>) { this.rawL.push(f); return () => { this.rawL = this.rawL.filter((x) => x !== f); }; }
  onRawPad(f: Listener<{ pad: number; button: number }>) { this.padRawL.push(f); return () => { this.padRawL = this.padRawL.filter((x) => x !== f); }; }
  /** Every pad button press with the pad it came from. Unlike onRawPad it doesn't swallow game/menu events. */
  onPadButton(f: Listener<{ pad: number; button: number }>) { this.padBtnL.push(f); return () => { this.padBtnL = this.padBtnL.filter((x) => x !== f); }; }
  /** The player a pad drives, or null. */
  playerForPad(gi: number): PlayerIndex | null {
    if (this.padPlayers) return this.padPlayers[gi] ?? null;
    return gi === 0 ? 0 : 1;
  }

  /** Touch controls feed in here (see ui/touch.ts). */
  emitTouch(player: PlayerIndex, kind: 'press' | 'release', slot: Button, t: number) {
    this.emitGame({ player, kind, slot, t, pad: false }, true);
  }

  /**
   * Listener snapshot for the event being handled. One key can produce a game event and a
   * menu event (Enter is P2's action key and menu confirm); a screen opened by the first
   * must not also receive the second.
   */
  private snap: { game: Listener<GameInput>[]; menu: Listener<MenuInput>[] } | null = null;
  private emitGame(e: GameInput, direct = false) {
    if (!this.twoPlayers && !direct) e = { ...e, player: this.soloPlayer };
    for (const f of this.snap?.game ?? [...this.gameL]) if (this.gameL.includes(f)) f(e);
  }
  private emitMenu(m: MenuInput) { for (const f of this.snap?.menu ?? [...this.menuL]) if (this.menuL.includes(f)) f(m); }

  private releaseAll() {
    const t = performance.now();
    for (const code of [...this.held]) this.handleKey(code, false, t);
    this.held.clear();
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (this.rawL.length && down) {
      e.preventDefault();
      for (const f of [...this.rawL]) f(e);
      return;
    }
    if (down && e.repeat) { if (this.buttonFor(e.code)) e.preventDefault(); return; }
    if (down) this.held.add(e.code); else this.held.delete(e.code);
    this.snap = { game: [...this.gameL], menu: [...this.menuL] };
    try {
      const used = this.handleKey(e.code, down, e.timeStamp || performance.now());
      if (down) {
        const m = menuForKey(e.code);
        if (m) this.emitMenu(m);
        if (m || used) e.preventDefault();
      }
    } finally { this.snap = null; }
  }

  /** Which player/button a key code drives. */
  private buttonFor(code: string): { player: PlayerIndex; b: Button } | null {
    const s = this.settings();
    for (const p of [0, 1] as PlayerIndex[]) {
      const k = s.keys[p];
      if (code === k.up) return { player: p, b: BTN.up };
      if (code === k.down) return { player: p, b: BTN.down };
      if (code === k.left) return { player: p, b: BTN.left };
      if (code === k.right) return { player: p, b: BTN.right };
      if (code === k.action || (k.action2 && code === k.action2)) return { player: p, b: BTN.action };
    }
    return null;
  }

  private handleKey(code: string, down: boolean, t: number): boolean {
    const hit = this.buttonFor(code);
    if (!hit) return false;
    this.emitGame({ player: hit.player, kind: down ? 'press' : 'release', slot: hit.b, t, pad: false });
    return true;
  }

  /** Poll gamepads; call once per frame. */
  poll() {
    this.snap = { game: [...this.gameL], menu: [...this.menuL] };
    try { this.pollPads(); } finally { this.snap = null; }
  }

  private padButton(gi: number, player: PlayerIndex | null, b: Button, down: boolean, t: number) {
    const held = (this.padHeld[gi] ??= [0, 0, 0, 0, 0]);
    const before = held[b];
    held[b] = Math.max(0, before + (down ? 1 : -1));
    if (player === null) return;
    if (before === 0 && held[b] === 1) this.emitGame({ player, kind: 'press', slot: b, t, pad: true });
    if (before > 0 && held[b] === 0) this.emitGame({ player, kind: 'release', slot: b, t, pad: true });
  }

  private pollPads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let gi = 0; gi < pads.length; gi++) {
      const gp = pads[gi];
      if (!gp) continue;
      const prev = this.padPrev[gi] ?? [];
      const now = gp.buttons.map((b) => b.pressed || b.value > 0.5);
      const t = performance.now();
      const owner = this.playerForPad(gi);
      for (let bi = 0; bi < now.length; bi++) {
        if (now[bi] === !!prev[bi]) continue;
        const down = now[bi];
        if (down) for (const f of [...this.padRawL]) f({ pad: gi, button: bi });
        if (this.padRawL.length) continue;
        if (down) for (const f of [...this.padBtnL]) if (this.padBtnL.includes(f)) f({ pad: gi, button: bi });
        const b = PAD_MAP[bi];
        if (b !== undefined) this.padButton(gi, owner, b, down, t);
        if (down) {
          const m = this.padGameMode ? (bi === 8 || bi === 9 ? 'back' : null) : padMenu(bi);
          if (m) this.emitMenu(m);
        }
      }
      this.padPrev[gi] = now;
      // Left stick: directions in game, d-pad style in menus
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      const dir = ax < -STICK ? 'left' : ax > STICK ? 'right' : ay < -STICK ? 'up' : ay > STICK ? 'down' : '';
      const was = this.padAxisPrev[gi] ?? '';
      if (dir !== was) {
        if (was) this.padButton(gi, owner, BTN[was as 'up'], false, t);
        if (dir) {
          this.padButton(gi, owner, BTN[dir as 'up'], true, t);
          if (!this.padGameMode) this.emitMenu(dir as MenuInput);
        }
      }
      this.padAxisPrev[gi] = dir;
    }
  }

  connectedPads(): number {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    return Array.from(pads).filter(Boolean).length;
  }
}

function padMenu(bi: number): MenuInput | null {
  return bi === 12 ? 'up' : bi === 13 ? 'down' : bi === 14 ? 'left' : bi === 15 ? 'right'
    : bi === 0 || bi === 9 ? 'confirm' : bi === 1 || bi === 8 ? 'back' : null;
}

function menuForKey(code: string): MenuInput | null {
  switch (code) {
    case 'ArrowUp': return 'up';
    case 'ArrowDown': return 'down';
    case 'ArrowLeft': return 'left';
    case 'ArrowRight': return 'right';
    case 'Enter': case 'Space': return 'confirm';
    case 'Escape': case 'Backspace': return 'back';
    default: return null;
  }
}
