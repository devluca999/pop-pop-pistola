import type { Settings, Device } from '../settings';
import { BTN, type Button } from '../rules/config';

const NAMED: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Space: 'SPACE', Enter: 'ENTER', Tab: 'TAB',
  ShiftLeft: 'L-SHIFT', ShiftRight: 'R-SHIFT', ControlLeft: 'CTRL', ControlRight: 'CTRL', AltLeft: 'ALT', AltRight: 'ALT',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'BKSP', CapsLock: 'CAPS',
};

/** Short keycap label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'N' + code.slice(6, 7);
  return NAMED[code] ?? code.slice(0, 5).toUpperCase();
}

const PAD = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SEL', 'START', 'LS', 'RS', '↑', '↓', '←', '→', 'HOME'];
export function padLabel(button: number): string {
  return PAD[button] ?? `B${button}`;
}

/** Arrows are the same on every device; only ACTION changes. '◉' = tap (touch). */
export const ARROW: Record<number, string> = { [BTN.up]: '↑', [BTN.down]: '↓', [BTN.left]: '←', [BTN.right]: '→' };

export interface ButtonLabels {
  /** ACTION on nerve prompts. */
  action: string;
  /** ACTION on the draw (pads shoot with RT, A also works). */
  shoot: string;
  /** Short legend for the player's corner. */
  legend: string;
}

/**
 * Labels for one player on the device they chose. `solo` = playing alone, where both
 * keyboard sets work (WASD or arrows + Space).
 */
export function bindingLabels(s: Settings, b: 0 | 1, device: Device, solo = false): ButtonLabels {
  if (device === 'gamepad') return { action: 'A', shoot: 'RT', legend: 'D-PAD + A · RT SHOOTS' };
  if (device === 'touch') return { action: '◉', shoot: '◉', legend: 'SWIPE + TAP' };
  const k = s.keys[b];
  const act = keyLabel(k.action);
  if (solo) return { action: act, shoot: act, legend: `WASD / ARROWS + ${act}` };
  const dirs = [k.up, k.left, k.down, k.right].map(keyLabel).join('');
  const dirName = dirs === '↑←↓→' ? 'ARROWS' : dirs === 'WASD' ? 'WASD' : dirs;
  return { action: act, shoot: act, legend: `${dirName} + ${act}` };
}

/** Tile label for a button. */
export function buttonLabel(l: ButtonLabels, b: Button, draw = false): string {
  if (b === BTN.action) return draw ? l.shoot : l.action;
  return ARROW[b];
}
