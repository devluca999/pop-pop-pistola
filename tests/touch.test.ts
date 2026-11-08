// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { TouchControls, intentFor, gestureText } from '../src/ui/touch';
import { CONFIG, BTN, type Button } from '../src/rules/config';
import type { Input } from '../src/input';
import type { PlayerIndex } from '../src/types';

type Ev = { p: PlayerIndex; kind: 'press' | 'release'; b: Button; t: number };
let events: Ev[];
const fakeInput = { emitTouch: (p: PlayerIndex, kind: 'press' | 'release', b: Button, t: number) => events.push({ p, kind, b, t }) } as unknown as Input;

function make(players: PlayerIndex[] = [0]) {
  const host = document.createElement('div');
  document.body.append(host);
  const tc = new TouchControls(host, fakeInput, players, (p) => (p === 0 ? 'left' : 'right'));
  tc.el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 400, right: 800, bottom: 400, x: 0, y: 0, toJSON: () => ({}) });
  return tc;
}
let clock = 1000;
const fire = (tc: TouchControls, type: string, x: number, y: number, id = 1) => {
  clock += 16;
  const e = new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(e, 'timeStamp', { value: clock });
  tc.el.dispatchEvent(e);
};
/** Drag from (x, y) through each step [dx, dy] in small moves. */
const drag = (tc: TouchControls, x: number, y: number, steps: [number, number][], id = 1, lift = true) => {
  fire(tc, 'pointerdown', x, y, id);
  for (const [dx, dy] of steps) {
    for (let k = 1; k <= 5; k++) fire(tc, 'pointermove', x + (dx * k) / 5, y + (dy * k) / 5, id);
    x += dx; y += dy;
  }
  if (lift) fire(tc, 'pointerup', x, y, id);
};
const presses = () => events.filter((e) => e.kind === 'press').map((e) => e.b);
const swipe = CONFIG.touch.swipeFrac * 400; // threshold on an 800x400 screen

beforeEach(() => { events = []; clock = 1000; });

describe('touch gestures', () => {
  it('a tap is ACTION, pressed on touch-down and released on lift', () => {
    const tc = make();
    tc.setIntent(0, { kind: 'tap', key: BTN.action });
    fire(tc, 'pointerdown', 200, 200);
    expect(events).toEqual([{ p: 0, kind: 'press', b: BTN.action, t: clock - CONFIG.touch.latencyMs }]);
    fire(tc, 'pointerup', 200, 200);
    expect(events[1].kind).toBe('release');
  });
  it('MASH / TIME IT / RELEASE map taps to the prompt button', () => {
    expect(intentFor('mash', [BTN.left])).toEqual({ kind: 'tap', key: BTN.left });
    expect(intentFor('time', [BTN.up])).toEqual({ kind: 'tap', key: BTN.up });
    expect(intentFor('release', [BTN.down])).toEqual({ kind: 'tap', key: BTN.down });
    expect(intentFor('tap', [BTN.right])).toEqual({ kind: 'swipe', dirs: [BTN.right] });
    expect(intentFor('hold', [BTN.action])).toEqual({ kind: 'tap', key: BTN.action });
  });
  it('a swipe is a direction; holding after the swipe keeps it held', () => {
    const tc = make();
    tc.setIntent(0, { kind: 'swipe', dirs: [BTN.right] });
    drag(tc, 200, 200, [[swipe * 2, 0]], 1, false);
    expect(events).toEqual([expect.objectContaining({ kind: 'press', b: BTN.right })]);
    fire(tc, 'pointerup', 400, 200);
    expect(events[1]).toMatchObject({ kind: 'release', b: BTN.right });
  });
  it('SEQUENCE: one stroke ↑ ← → (with a reversal) gives three presses in order', () => {
    const tc = make();
    tc.setIntent(0, { kind: 'swipe', dirs: [BTN.up, BTN.left, BTN.right] });
    drag(tc, 400, 300, [[0, -swipe * 2], [-swipe * 2, 0], [swipe * 2, 0]]);
    expect(presses()).toEqual([BTN.up, BTN.left, BTN.right]);
  });
  it('STANDOFF: a still tap is ACTION (timed at touch-down), a swipe up is a feint', () => {
    const tc = make();
    tc.setIntent(0, { kind: 'mixed', swipes: [BTN.up] });
    fire(tc, 'pointerdown', 200, 200);
    const downAt = clock;
    expect(events).toEqual([]);
    // until it is read, the online heartbeat can't claim past this touch
    expect(tc.safeTime(downAt + 500)).toBe(downAt - CONFIG.touch.latencyMs);
    fire(tc, 'pointerup', 200, 200);
    expect(events[0]).toMatchObject({ kind: 'press', b: BTN.action, t: downAt - CONFIG.touch.latencyMs });
    events = [];
    drag(tc, 200, 300, [[0, -swipe * 2]]);
    expect(presses()).toEqual([BTN.up]);
  });
  it('READY: swipe down and hold heals (DOWN stays held until lift)', () => {
    const tc = make();
    tc.setIntent(0, { kind: 'mixed', swipes: [BTN.down] });
    drag(tc, 200, 100, [[0, swipe * 2]], 1, false);
    expect(events).toEqual([expect.objectContaining({ kind: 'press', b: BTN.down })]);
    fire(tc, 'pointerup', 200, 300);
    expect(events[1]).toMatchObject({ kind: 'release', b: BTN.down });
  });
  it('split screen: each half drives its own player; the far player is turned 180°', () => {
    const tc = make([0, 1]);
    tc.setIntent(0, { kind: 'swipe', dirs: [BTN.up] });
    tc.setIntent(1, { kind: 'swipe', dirs: [BTN.up] });
    drag(tc, 200, 300, [[0, -swipe * 2]], 1);
    // right half: their "up" is our screen-down
    drag(tc, 600, 100, [[0, swipe * 2]], 2);
    expect(events.filter((e) => e.kind === 'press')).toEqual([
      expect.objectContaining({ p: 0, b: BTN.up }),
      expect.objectContaining({ p: 1, b: BTN.up }),
    ]);
  });
  it('Will of God: swipe left / right', () => {
    const tc = make();
    const picked: Button[] = [];
    tc.setChoiceHandler((_p, b) => picked.push(b));
    tc.setIntent(0, { kind: 'choice' });
    drag(tc, 400, 200, [[-swipe * 2, 0]]);
    expect(picked).toEqual([BTN.left]);
  });
  it('STEADY: the marker drifts out without a thumb on it -> one flinch press', () => {
    const tc = make();
    tc.setIntent(0, { kind: 'steady', until: 1e9 });
    for (let k = 0; k < 200; k++) tc.frame(16, 1000 + k * 16);
    expect(presses()).toEqual([BTN.action]);
  });
  it('idle: touches do nothing', () => {
    const tc = make();
    tc.setIntent(0, { kind: 'idle' });
    drag(tc, 200, 200, [[swipe * 2, 0]]);
    fire(tc, 'pointerdown', 200, 200, 3);
    fire(tc, 'pointerup', 200, 200, 3);
    expect(events).toEqual([]);
  });
  it('every prompt type has a gesture hint', () => {
    for (const t of ['tap', 'hold', 'mash', 'time', 'release', 'order', 'steady'] as const) expect(gestureText(t, [BTN.up, BTN.left, BTN.right]).length).toBeGreaterThan(2);
  });
});
