import type { PlayerIndex } from '../types';
import { CONFIG, BTN, type Button, type PromptType } from '../rules/config';
import type { Input } from '../input';
import { h } from './dom';

/**
 * Touch controls. Gestures replace keys, one per prompt type:
 *   swipe = a direction, tap = ACTION (or the prompt's button for MASH / TIME IT),
 *   press-and-hold = HOLD / RELEASE, swipe chain = SEQUENCE, drag a marker = STEADY.
 * The duel tells this layer what each player is being asked for (`setIntent`), so a touch
 * is never ambiguous inside a prompt. In READY and the STANDOFF a touch could be a swipe
 * (heal / feint) or a tap (early draw), so it waits until the finger moves or lifts.
 *
 * Timing: touch screens report input later than keyboards, so touch times are moved back
 * by `touch.latencyMs`. A touch that is still being read holds back the online "known up to"
 * heartbeat (`safeTime`), so a late-recognised gesture can never change a decided result.
 */

export type Intent =
  | { kind: 'idle' }
  | { kind: 'swipe'; dirs: Button[] }              // TAP/HOLD on a direction; SEQUENCE (dirs in order)
  | { kind: 'tap'; key: Button }                    // ACTION prompts, MASH, TIME IT, RELEASE, the draw
  | { kind: 'mixed'; swipes: Button[] }             // READY (↓ heal) / STANDOFF (↑ feint, tap = early draw)
  | { kind: 'steady'; until: number }               // keep the marker centred until `until` (performance.now)
  | { kind: 'choice' };                             // Will of God: swipe ← / →

/** What gesture a nerve prompt asks for on touch. */
export function intentFor(type: PromptType, keys: Button[]): Intent {
  const k = keys[0];
  if (type === 'order') return { kind: 'swipe', dirs: keys };
  if (type === 'steady') return { kind: 'idle' };
  if ((type === 'tap' || type === 'hold') && k !== BTN.action) return { kind: 'swipe', dirs: [k] };
  return { kind: 'tap', key: k };
}

/** Short instruction shown on the prompt tile for touch players. */
export function gestureText(type: PromptType, keys: Button[]): string {
  const arrows = (b: Button) => ['↑', '↓', '←', '→', ''][b];
  const k = keys[0];
  switch (type) {
    case 'tap': return k === BTN.action ? 'TAP' : `SWIPE ${arrows(k)}`;
    case 'hold': return k === BTN.action ? 'PRESS + HOLD' : `SWIPE ${arrows(k)} + HOLD`;
    case 'mash': return 'TAP TAP TAP';
    case 'time': return 'TAP ON THE GOLD';
    case 'release': return 'HOLD, LIFT ON CUE';
    case 'order': return `SWIPE ${keys.map(arrows).join(' ')}`;
    case 'steady': return 'DRAG: KEEP IT CENTRED';
  }
}

interface Track {
  id: number;
  player: PlayerIndex;
  x0: number; y0: number; t0: number;
  /** Pivot for swipe chains. */
  px: number; py: number;
  held: Button | null;
  decided: boolean;
}

export class TouchControls {
  readonly el: HTMLElement;
  private intents: [Intent, Intent] = [{ kind: 'idle' }, { kind: 'idle' }];
  private chainIdx: [number, number] = [0, 0];
  private tracks = new Map<number, Track>();
  private steadyEls: (HTMLElement | null)[] = [null, null];
  private steadyX: [number, number] = [0, 0];
  private steadyV: [number, number] = [0, 0];
  private steadyFailed: [boolean, boolean] = [false, false];
  private onChoice: ((p: PlayerIndex, b: Button) => void) | null = null;

  /**
   * players: who is on this touchscreen. Two = split screen (left half P1, right half P2,
   * whose half is turned 180° for the player across the table).
   */
  constructor(host: HTMLElement, private input: Input, private players: PlayerIndex[], private sideOf: (p: PlayerIndex) => 'left' | 'right') {
    this.el = h('div', { class: `touch-layer ${players.length > 1 ? 'split' : ''}` });
    host.append(this.el);
    const opts = { passive: false } as AddEventListenerOptions;
    this.el.addEventListener('pointerdown', (e) => this.down(e), opts);
    this.el.addEventListener('pointermove', (e) => this.move(e), opts);
    this.el.addEventListener('pointerup', (e) => this.up(e), opts);
    this.el.addEventListener('pointercancel', (e) => this.up(e), opts);
    document.documentElement.classList.add('touch-play');
  }

  private intentKeys: [string, string] = ['', ''];
  /** Called every frame; only acts when the intent actually changes. */
  setIntent(p: PlayerIndex, intent: Intent) {
    const key = JSON.stringify(intent);
    if (key === this.intentKeys[p]) return;
    this.intentKeys[p] = key;
    const was = this.intents[p];
    this.intents[p] = intent;
    this.chainIdx[p] = 0;
    if (intent.kind === 'steady' && was.kind !== 'steady') this.startSteady(p);
    if (intent.kind !== 'steady' && was.kind === 'steady') this.stopSteady(p);
  }
  setChoiceHandler(f: (p: PlayerIndex, b: Button) => void) { this.onChoice = f; }

  /** Online: logs are only known complete up to this time (no unread touch before it). */
  safeTime(now: number): number {
    let t = now - CONFIG.touch.latencyMs;
    for (const tr of this.tracks.values()) if (!tr.decided) t = Math.min(t, tr.t0 - CONFIG.touch.latencyMs);
    return t;
  }

  private playerAt(x: number): PlayerIndex | null {
    if (this.players.length === 1) return this.players[0];
    const r = this.el.getBoundingClientRect();
    const left = x < r.left + r.width / 2;
    return this.players.find((p) => this.sideOf(p) === (left ? 'left' : 'right')) ?? null;
  }
  /** The far player's half is turned 180°: their up is our down. */
  private flip(p: PlayerIndex) { return this.players.length > 1 && this.sideOf(p) === 'right'; }

  private emit(p: PlayerIndex, kind: 'press' | 'release', b: Button, t: number) {
    this.input.emitTouch(p, kind, b, t - CONFIG.touch.latencyMs);
    if (kind === 'press') this.haptic('tick');
  }

  haptic(kind: 'tick' | 'good' | 'bad') {
    if (!navigator.vibrate) return;
    try { navigator.vibrate(kind === 'tick' ? 8 : kind === 'good' ? 18 : [40, 30, 40]); } catch { /* not allowed */ }
  }

  private dirOf(dx: number, dy: number, p: PlayerIndex): Button {
    if (this.flip(p)) { dx = -dx; dy = -dy; }
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? BTN.right : BTN.left;
    return dy > 0 ? BTN.down : BTN.up;
  }
  private threshold() {
    const r = this.el.getBoundingClientRect();
    return Math.max(18, Math.min(r.width, r.height) * CONFIG.touch.swipeFrac);
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    const p = this.playerAt(e.clientX);
    if (p === null) return;
    try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic or already gone */ }
    const tr: Track = { id: e.pointerId, player: p, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, px: e.clientX, py: e.clientY, held: null, decided: false };
    this.tracks.set(e.pointerId, tr);
    const it = this.intents[p];
    if (it.kind === 'tap') {
      // ACTION / MASH / TIME IT / RELEASE / the draw: the touch itself is the press
      tr.decided = true;
      tr.held = it.key;
      this.emit(p, 'press', it.key, e.timeStamp);
    } else if (it.kind === 'steady') {
      tr.decided = true;
    } else if (it.kind === 'idle') {
      tr.decided = true;
    }
  }

  private move(e: PointerEvent) {
    const tr = this.tracks.get(e.pointerId);
    if (!tr) return;
    e.preventDefault();
    const p = tr.player;
    const it = this.intents[p];
    if (it.kind === 'steady') {
      // the thumb pushes the marker back toward the centre
      const dx = (e.clientX - tr.px) * (this.flip(p) ? -1 : 1);
      tr.px = e.clientX;
      this.steadyX[p] += dx / (this.el.getBoundingClientRect().width * 0.25);
      return;
    }
    const dx = e.clientX - tr.px, dy = e.clientY - tr.py;
    // still going the same way: carry the reference point along, so a reversal is
    // measured from the far end of the stroke
    if (tr.held !== null && tr.held !== BTN.action && this.dirOf(dx, dy, p) === tr.held) {
      tr.px = e.clientX;
      tr.py = e.clientY;
      return;
    }
    if (Math.hypot(dx, dy) < this.threshold()) return;
    const dir = this.dirOf(dx, dy, p);
    tr.px = e.clientX;
    tr.py = e.clientY;
    if (it.kind === 'swipe') {
      // SEQUENCE: each new direction in one drag (or across several swipes) is the next arrow
      if (tr.held === dir) return;
      if (tr.held !== null) this.emit(p, 'release', tr.held, e.timeStamp);
      tr.held = dir;
      tr.decided = true;
      this.emit(p, 'press', dir, e.timeStamp);
      this.chainIdx[p]++;
    } else if (it.kind === 'mixed' && !tr.decided) {
      tr.decided = true;
      tr.held = dir;
      this.emit(p, 'press', dir, e.timeStamp);
    } else if (it.kind === 'choice' && !tr.decided) {
      tr.decided = true;
      if (dir === BTN.left || dir === BTN.right) this.onChoice?.(p, dir);
    }
  }

  private up(e: PointerEvent) {
    const tr = this.tracks.get(e.pointerId);
    if (!tr) return;
    e.preventDefault();
    this.tracks.delete(e.pointerId);
    const p = tr.player;
    const it = this.intents[p];
    if (!tr.decided && it.kind === 'mixed') {
      // never moved: a tap. In the standoff that's ACTION (an early draw).
      this.emit(p, 'press', BTN.action, tr.t0);
      this.emit(p, 'release', BTN.action, e.timeStamp);
      return;
    }
    if (tr.held !== null) this.emit(p, 'release', tr.held, e.timeStamp);
  }

  // ---------------------------------------------------------------- STEADY on touch

  private startSteady(p: PlayerIndex) {
    this.stopSteady(p);
    const zone = h('div', { class: `steady-track ${this.flip(p) ? 'flip' : ''} ${this.sideOf(p)}` }, h('i', { class: 'steady-safe' }), h('b', { class: 'steady-dot' }));
    this.el.append(zone);
    this.steadyEls[p] = zone;
    this.steadyX[p] = 0;
    this.steadyV[p] = (Math.random() < 0.5 ? -1 : 1) * CONFIG.touch.steadyDrift;
    this.steadyFailed[p] = false;
  }
  private stopSteady(p: PlayerIndex) {
    this.steadyEls[p]?.remove();
    this.steadyEls[p] = null;
  }

  /** Call every frame. The marker drifts; leaving the safe zone is a flinch (a press). */
  frame(dtMs: number, now: number) {
    for (const p of this.players) {
      const it = this.intents[p];
      const el = this.steadyEls[p];
      if (it.kind !== 'steady' || !el) continue;
      // drift, with a little wobble that changes direction now and then
      if (Math.random() < dtMs / 900) this.steadyV[p] = -this.steadyV[p];
      this.steadyX[p] += this.steadyV[p] * (dtMs / 1000);
      this.steadyX[p] = Math.max(-1.2, Math.min(1.2, this.steadyX[p]));
      el.style.setProperty('--x', String(this.steadyX[p]));
      const out = Math.abs(this.steadyX[p]) > CONFIG.touch.steadySafe;
      el.classList.toggle('out', out);
      if (out && !this.steadyFailed[p] && now < it.until) {
        this.steadyFailed[p] = true;
        this.emit(p, 'press', BTN.action, now);
        this.emit(p, 'release', BTN.action, now + 40);
        this.haptic('bad');
      }
    }
  }

  dispose() {
    this.el.remove();
    document.documentElement.classList.remove('touch-play');
  }
}

/** True on phones / tablets (coarse pointer or touch points). */
export function isTouchDevice(): boolean {
  return (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || (navigator.maxTouchPoints ?? 0) > 0;
}
