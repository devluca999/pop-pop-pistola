import type { Settings, Device } from '../settings';

const NAMED: Record<string, string> = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Space: 'SPC', Enter: 'ENT', Tab: 'TAB',
  ShiftLeft: 'SHF', ShiftRight: 'SHF', ControlLeft: 'CTL', ControlRight: 'CTL', AltLeft: 'ALT', AltRight: 'ALT',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: 'BKS', CapsLock: 'CAP',
};

/** Short keycap label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'N' + code.slice(6, 7);
  return NAMED[code] ?? code.slice(0, 3).toUpperCase();
}

const PAD = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'SEL', 'STA', 'LS', 'RS', '↑', '↓', '←', '→', 'HOM'];
export function padLabel(button: number): string {
  return PAD[button] ?? `B${button}`;
}

/** Labels for one player's binding set on the chosen device. */
export function bindingLabels(s: Settings, b: 0 | 1, device: Device) {
  if (device === 'gamepad') {
    const p = s.pads[b];
    return { prompt: p.prompt.map(padLabel), heal: padLabel(p.heal), feint: padLabel(p.feint), action: padLabel(p.action) };
  }
  const k = s.keys[b];
  const act = k.action === 'Space' ? 'SPACE' : k.action === 'Enter' ? 'ENTER' : keyLabel(k.action);
  return { prompt: k.prompt.map(keyLabel), heal: keyLabel(k.heal), feint: keyLabel(k.feint), action: act };
}
