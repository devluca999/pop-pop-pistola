import type { PlayerIndex } from '../types';
import type { Settings } from '../settings';

export type GameInput =
  | { player: PlayerIndex; kind: 'press' | 'release'; slot: number; t: number; pad: boolean }
  | { player: PlayerIndex; kind: 'heal' | 'feint' | 'action'; t: number; pad: boolean };

export type MenuInput = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back';

type Listener<T> = (e: T) => void;

/**
 * Keyboard + Gamepad API. Emits game events (by player, with high-res timestamps)
 * and generic menu navigation. Players are routed by binding, so P1 and P2 can
 * share one keyboard or use two pads.
 */
export class Input {
  private gameL: Listener<GameInput>[] = [];
  private menuL: Listener<MenuInput>[] = [];
  private rawL: Listener<KeyboardEvent>[] = [];
  private padRawL: Listener<{ pad: number; button: number }>[] = [];
  private padBtnL: Listener<{ pad: number; button: number }>[] = [];
  private padPrev: boolean[][] = [];
  private padAxisPrev: string[] = [];
  private held = new Set<string>();
  /** When false, P2 keyboard/pad events are ignored (CPU/online). */
  twoPlayers = true;
  /** Online/CPU: the human plays as this player index. */
  soloPlayer: PlayerIndex = 0;
  /**
   * Which player each gamepad belongs to (index = pad slot). null = by order (pad 1 → P1,
   * the rest → P2). Set by the controller screen; a pad missing from the list drives no one.
   */
  padPlayers: (PlayerIndex | null)[] | null = null;

  constructor(private settings: () => Settings) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.held.clear());
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

  /**
   * Listener snapshot for the event being handled. One key can produce a game event and a
   * menu event (Enter is P2's action key and menu confirm); a screen opened by the first
   * must not also receive the second.
   */
  private snap: { game: Listener<GameInput>[]; menu: Listener<MenuInput>[] } | null = null;
  private emitGame(e: GameInput) {
    if (!this.twoPlayers) {
      if (e.player !== 0) return;
      e = { ...e, player: this.soloPlayer };
    }
    for (const f of this.snap?.game ?? [...this.gameL]) if (this.gameL.includes(f)) f(e);
  }
  private emitMenu(m: MenuInput) { for (const f of this.snap?.menu ?? [...this.menuL]) if (this.menuL.includes(f)) f(m); }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (this.rawL.length && down) {
      e.preventDefault();
      for (const f of [...this.rawL]) f(e);
      return;
    }
    if (down && e.repeat) return;
    if (down) this.held.add(e.code); else this.held.delete(e.code);
    this.snap = { game: [...this.gameL], menu: [...this.menuL] };
    try { this.handleKey(e, down); } finally { this.snap = null; }
  }

  private handleKey(e: KeyboardEvent, down: boolean) {
    const s = this.settings();
    const t = e.timeStamp || performance.now();
    let used = false;
    for (const p of [0, 1] as PlayerIndex[]) {
      const b = s.keys[p];
      const slot = b.prompt.indexOf(e.code);
      if (slot >= 0) { this.emitGame({ player: p, kind: down ? 'press' : 'release', slot, t, pad: false }); used = true; }
      else if (down && e.code === b.action) { this.emitGame({ player: p, kind: 'action', t, pad: false }); used = true; }
      else if (down && e.code === b.heal) { this.emitGame({ player: p, kind: 'heal', t, pad: false }); used = true; }
      else if (down && e.code === b.feint) { this.emitGame({ player: p, kind: 'feint', t, pad: false }); used = true; }
    }
    if (down) {
      const m = menuForKey(e.code);
      if (m) this.emitMenu(m);
      if (m || used) e.preventDefault();
    }
  }

  /** Poll gamepads; call once per frame. */
  poll() {
    this.snap = { game: [...this.gameL], menu: [...this.menuL] };
    try { this.pollPads(); } finally { this.snap = null; }
  }

  private pollPads() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const s = this.settings();
    for (let gi = 0; gi < pads.length; gi++) {
      const gp = pads[gi];
      if (!gp) continue;
      const prev = this.padPrev[gi] ?? [];
      const now = gp.buttons.map((b) => b.pressed || b.value > 0.5);
      const t = performance.now();
      const owner = this.playerForPad(gi);
      const player: PlayerIndex = owner ?? 0;
      const b = s.pads[player];
      for (let bi = 0; bi < now.length; bi++) {
        if (now[bi] === !!prev[bi]) continue;
        const down = now[bi];
        if (down) for (const f of [...this.padRawL]) f({ pad: gi, button: bi });
        if (this.padRawL.length) continue;
        if (down) for (const f of [...this.padBtnL]) if (this.padBtnL.includes(f)) f({ pad: gi, button: bi });
        if (owner === null) {
          // an unassigned pad can still drive menus
          const m = down ? padMenu(bi) : null;
          if (m) this.emitMenu(m);
          continue;
        }
        const slot = b.prompt.indexOf(bi);
        // the action button can share a prompt button (A): it then fires both
        if (down && bi === b.action) this.emitGame({ player, kind: 'action', t, pad: true });
        if (slot >= 0) this.emitGame({ player, kind: down ? 'press' : 'release', slot, t, pad: true });
        else if (down && bi === b.heal) this.emitGame({ player, kind: 'heal', t, pad: true });
        else if (down && bi === b.feint) this.emitGame({ player, kind: 'feint', t, pad: true });
        if (down) {
          const m = padMenu(bi);
          if (m) this.emitMenu(m);
        }
      }
      this.padPrev[gi] = now;
      // Left stick as d-pad for menus
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      const dir = ax < -0.6 ? 'left' : ax > 0.6 ? 'right' : ay < -0.6 ? 'up' : ay > 0.6 ? 'down' : '';
      if (dir && dir !== this.padAxisPrev[gi]) this.emitMenu(dir as MenuInput);
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
